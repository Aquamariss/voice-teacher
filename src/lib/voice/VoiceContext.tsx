'use client'

import {
  createContext, useContext, useRef, useState,
  useEffect, useCallback, type ReactNode,
} from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type VoiceStatus =
  | 'idle' | 'listening' | 'recording'
  | 'transcribing' | 'processing' | 'speaking'

interface VoiceContextValue {
  voiceStatus:    VoiceStatus
  setVoiceStatus: (s: VoiceStatus) => void
  isActive:       boolean
  autoEnable:     boolean
  voiceError:     string
  toggleVoice:    () => void
  setAutoEnable:  (val: boolean) => void
  setBusy:        (busy: boolean) => void
  getAudioCtx:    () => AudioContext | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VOICE_THRESHOLD  = 42   // энергия 0-255; поднято с 35 для снижения фантомных срабатываний
const SILENCE_MS       = 1400 // мс тишины перед отправкой
const MIN_RECORD_MS    = 500  // мин. длина записи
const MIN_VOICE_FRAMES = 8    // кадров подряд выше порога для старта записи (~130 мс)

// Слова-команды для управления лекцией.
// Используем tokenMatchesAny() — точное совпадение токена, не includes()
const STOP_WORDS    = ['стоп', 'пауза', 'остановись', 'стоп-лекция']
const RESUME_WORDS  = ['продолжи', 'продолжим', 'продолжить', 'продолжите', 'дальше', 'вперёд', 'вперед']
const SLOWER_WORDS  = ['помедленнее', 'медленнее', 'помедленней', 'медленней', 'потише', 'медленно']
const FASTER_WORDS  = ['побыстрее', 'быстрее', 'побыстрей', 'ускорь', 'ускори', 'побыстрее']

const AUTO_ENABLE_KEY = 'voice-auto-enable'

// Разбиваем текст по пробелам/знакам препинания и проверяем точное совпадение токена.
// Это предотвращает ложные срабатывания: "продолжительность" НЕ содержит "продолжи" как слово.
function tokenMatchesAny(text: string, words: string[]): boolean {
  const tokens = text
    .split(/[\s,.!?;:–—()]+/)
    .map(t => t.toLowerCase().replace(/[^а-яёa-z0-9]/g, ''))
    .filter(Boolean)
  return words.some(w => tokens.includes(w))
}

// ── Context ───────────────────────────────────────────────────────────────────

const VoiceContext = createContext<VoiceContextValue | null>(null)

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used within VoiceProvider')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [isActive,    setIsActive]    = useState(false)
  const [autoEnable,  setAutoEnableState] = useState(false)
  const [voiceError,  setVoiceError]  = useState('')

  const streamRef          = useRef<MediaStream | null>(null)
  const audioCtxRef        = useRef<AudioContext | null>(null)
  const analyserRef        = useRef<AnalyserNode | null>(null)
  const recorderRef        = useRef<MediaRecorder | null>(null)
  const chunksRef          = useRef<Blob[]>([])
  const isRecordingRef     = useRef(false)
  const silenceTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordStartRef     = useRef(0)
  const voiceFramesRef     = useRef(0)  // счётчик кадров подряд выше порога
  const vadActiveRef       = useRef(false)
  const busyRef            = useRef(false)
  const isActiveRef        = useRef(false)
  const isLecturePlayingRef = useRef(false)  // true пока лекция воспроизводится

  useEffect(() => { isActiveRef.current = isActive }, [isActive])

  // ── Слушаем состояние AudioPlayer ─────────────────────────────────────────

  useEffect(() => {
    const onPlay  = () => { isLecturePlayingRef.current = true }
    const onPause = () => { isLecturePlayingRef.current = false }
    window.addEventListener('voice:lecture-playing', onPlay)
    window.addEventListener('voice:lecture-paused',  onPause)
    return () => {
      window.removeEventListener('voice:lecture-playing', onPlay)
      window.removeEventListener('voice:lecture-paused',  onPause)
    }
  }, [])

  // ── setBusy ───────────────────────────────────────────────────────────────

  const setBusy = useCallback((busy: boolean) => {
    busyRef.current = busy
    if (!busy && isActiveRef.current) setVoiceStatus('listening')
  }, [])

  // ── Auto-enable on mount ──────────────────────────────────────────────────

  useEffect(() => {
    const stored = localStorage.getItem(AUTO_ENABLE_KEY)
    if (stored === 'true') {
      setAutoEnableState(true)
      activateVoice().catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── VAD ───────────────────────────────────────────────────────────────────

  function startVAD() {
    const analyser = analyserRef.current
    if (!analyser || vadActiveRef.current) return
    vadActiveRef.current = true

    const buf = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      if (!vadActiveRef.current) return

      analyser.getByteFrequencyData(buf)
      const energy  = buf.reduce((s, v) => s + v, 0) / buf.length
      const isVoice = energy > VOICE_THRESHOLD

      if (isVoice) {
        voiceFramesRef.current++
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = null
        }
        if (
          voiceFramesRef.current >= MIN_VOICE_FRAMES &&
          !isRecordingRef.current &&
          !busyRef.current
        ) beginRecording()
      } else {
        voiceFramesRef.current = 0  // сбрасываем при тишине
      }

      if (!isVoice && isRecordingRef.current) {
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            silenceTimerRef.current = null
            finishRecording()
          }, SILENCE_MS)
        }
      }

      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  }

  // Остановить VAD, подождать delay мс, запустить снова.
  // Нужно после команд, чтобы не поймать эхо лекции или хвост своего голоса.
  function restartVADAfter(delayMs: number) {
    vadActiveRef.current = false
    setTimeout(() => {
      if (isActiveRef.current) startVAD()
    }, delayMs)
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  function beginRecording() {
    const stream = streamRef.current
    if (!stream || isRecordingRef.current) return

    window.dispatchEvent(new CustomEvent('voice:interrupt-audio'))

    isRecordingRef.current = true
    chunksRef.current      = []
    recordStartRef.current = Date.now()
    setVoiceStatus('recording')

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''

    const mr = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)
    recorderRef.current = mr

    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      isRecordingRef.current = false
      const duration = Date.now() - recordStartRef.current
      if (duration < MIN_RECORD_MS || chunksRef.current.length === 0) {
        if (isActiveRef.current) setVoiceStatus('listening')
        return
      }
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      sendToWhisper(new Blob(chunksRef.current, { type: mimeType || 'audio/webm' }), ext)
    }

    mr.start(100)
  }

  function finishRecording() {
    if (!isRecordingRef.current || !recorderRef.current) return
    if (recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    recorderRef.current = null
  }

  // ── Whisper + логика команд ───────────────────────────────────────────────

  async function sendToWhisper(blob: Blob, ext = 'webm') {
    // Блокируем VAD на время транскрипции — предотвращаем параллельные записи
    busyRef.current = true
    setVoiceStatus('transcribing')

    try {
      const form = new FormData()
      form.append('audio', blob, `recording.${ext}`)

      const res = await fetch('/api/stt', { method: 'POST', body: form })
      if (!res.ok) throw new Error('STT failed')

      const { text } = await res.json() as { text: string }
      const normalized = text.trim().toLowerCase()

      // ── КОМАНДЫ СКОРОСТИ — работают в любом режиме ──────────────────────
      if (tokenMatchesAny(normalized, SLOWER_WORDS)) {
        window.dispatchEvent(new CustomEvent('voice:change-speed', { detail: { direction: 'slower' } }))
        busyRef.current = false
        if (isActiveRef.current) setVoiceStatus('listening')
        restartVADAfter(600)
        return
      }
      if (tokenMatchesAny(normalized, FASTER_WORDS)) {
        window.dispatchEvent(new CustomEvent('voice:change-speed', { detail: { direction: 'faster' } }))
        busyRef.current = false
        if (isActiveRef.current) setVoiceStatus('listening')
        restartVADAfter(600)
        return
      }

      // ── РЕЖИМ ЛЕКЦИИ (лекция воспроизводится) ───────────────────────────
      // Принимаем только стоп-команды; всё остальное — тихо игнорируем.
      // Это защищает от фантомных сообщений из-за фонового шума и звука лекции.
      if (isLecturePlayingRef.current) {
        if (tokenMatchesAny(normalized, STOP_WORDS)) {
          window.dispatchEvent(new CustomEvent('voice:stop-lecture'))
          // AudioPlayer выдаст voice:lecture-paused → isLecturePlayingRef = false
          busyRef.current = false
          if (isActiveRef.current) setVoiceStatus('listening')
          restartVADAfter(800)
        } else {
          // Игнорируем: не отправляем ассистенту
          busyRef.current = false
          if (isActiveRef.current) setVoiceStatus('listening')
        }
        return
      }

      // ── РЕЖИМ ДИАЛОГА (лекция на паузе или не запущена) ─────────────────

      // Команда «продолжи» — возобновляем лекцию, ассистента не трогаем
      if (tokenMatchesAny(normalized, RESUME_WORDS)) {
        window.dispatchEvent(new CustomEvent('voice:resume-lecture'))
        busyRef.current = false
        if (isActiveRef.current) setVoiceStatus('listening')
        // Даём 1 сек чтобы эхо лекции не попало в следующую запись
        restartVADAfter(1000)
        return
      }

      // Обычное сообщение → ассистент
      if (text.trim() && isActiveRef.current) {
        // busyRef остаётся true до завершения TTS ассистента
        setVoiceStatus('processing')
        window.dispatchEvent(new CustomEvent('voice:user-message', { detail: { text: text.trim() } }))
      } else {
        busyRef.current = false
        if (isActiveRef.current) setVoiceStatus('listening')
      }
    } catch {
      busyRef.current = false
      if (isActiveRef.current) setVoiceStatus('listening')
    }
  }

  // ── Activate / Deactivate ─────────────────────────────────────────────────

  async function activateVoice() {
    setVoiceError('')

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    streamRef.current = stream

    const ctx     = new AudioContext()
    audioCtxRef.current = ctx
    if (ctx.state === 'suspended') await ctx.resume()
    const src     = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.3
    src.connect(analyser)
    analyserRef.current = analyser

    busyRef.current      = false
    vadActiveRef.current = false

    setIsActive(true)
    setVoiceStatus('listening')
    startVAD()
  }

  function deactivateVoice() {
    vadActiveRef.current = false

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    finishRecording()

    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null }
    analyserRef.current   = null
    busyRef.current        = false
    isRecordingRef.current = false

    setIsActive(false)
    setVoiceStatus('idle')
  }

  async function toggleVoice() {
    if (isActive) {
      deactivateVoice()
    } else {
      try { await activateVoice() }
      catch { setVoiceError('Нет доступа к микрофону. На iPhone: Настройки → Chrome → Микрофон → включить') }
    }
  }

  function setAutoEnable(val: boolean) {
    setAutoEnableState(val)
    localStorage.setItem(AUTO_ENABLE_KEY, String(val))
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      vadActiveRef.current = false
      if (streamRef.current)   streamRef.current.getTracks().forEach(t => t.stop())
      if (audioCtxRef.current) audioCtxRef.current.close()
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <VoiceContext.Provider value={{
      voiceStatus, setVoiceStatus,
      isActive, autoEnable, voiceError,
      toggleVoice, setAutoEnable, setBusy,
      getAudioCtx: () => audioCtxRef.current,
    }}>
      {children}
    </VoiceContext.Provider>
  )
}
