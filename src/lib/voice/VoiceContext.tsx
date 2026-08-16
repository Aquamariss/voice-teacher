'use client'

import {
  createContext, useContext, useRef, useState,
  useEffect, useCallback, type ReactNode,
} from 'react'
import { vlog, vwarn, verr, logEnvironment } from './debugLog'
import { unlockEarcons, earconFor } from './earcons'

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
  /** Аудио-элемент, разблокированный жестом пользователя при включении микрофона.
   *  Его можно проигрывать из async-кода без нового жеста (важно для iOS). */
  getPlaybackAudio: () => HTMLAudioElement | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Гистерезис: начинать запись строго, прекращать мягко.
// Один общий порог обрывал фразу на спаде громкости — речь на 30 единицах
// считалась тишиной, и вопрос уезжал в Whisper недоговорённым.
const VOICE_START_THRESHOLD = 42  // энергия 0-255, порог начала записи
const VOICE_STOP_THRESHOLD  = 25  // ниже этого считаем, что человек замолчал

const SILENCE_MS       = 2200 // мс тишины перед отправкой (было 1400 — резало паузы в речи)
const MIN_RECORD_MS    = 500  // мин. длина записи
const MIN_VOICE_FRAMES = 8    // кадров подряд выше порога для старта записи (~130 мс)
// Перебивание ассистента: планка выше, чтобы его собственный голос из динамика
// не запускал запись. Эхоподавление даёт 3-8 единиц, редкие всплески до 31.
const BARGE_IN_FRAMES  = 18   // ~300 мс уверенной речи поверх ответа

const RECORDER_BITRATE = 32000 // бит/с; речи хватает, а заливка с мобильной сети быстрее

// Признак пропавшего входного потока: Bluetooth-гарнитура при смене профиля
// оставляет MediaStream живым, но выдаёт нули.
const DEAD_SIGNAL_LEVEL = 0.3
const DEAD_SIGNAL_MS    = 5000

// Односэмпловый беззвучный WAV. Проигрывается по клику, чтобы «разблокировать»
// аудио-элемент — после этого iOS разрешает play() из асинхронного кода.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA=='

// Слова-команды для управления лекцией.
// Используем tokenMatchesAny() — точное совпадение токена, не includes()
const STOP_WORDS    = ['стоп', 'пауза', 'остановись', 'стоп-лекция']
// Возобновление проверяем регуляркой по формам глагола, а не списком слов:
// Whisper возвращает то «продолжи», то «продолжай», то «продолжаю».
// Именно из-за жёсткого списка команда «продолжаю занятие» уходила ассистенту
// как обычный вопрос. Перечисление окончаний, а не основа «продолж», —
// чтобы «продолжительность» не считалась командой.
const RESUME_RE = /^(продолж(и|им|ими|ить|ите|ай|айте|аю|аем)|дальше|вперёд|вперед|поехали)$/
const SLOWER_WORDS  = ['помедленнее', 'медленнее', 'помедленней', 'медленней', 'потише', 'медленно']
const FASTER_WORDS  = ['побыстрее', 'быстрее', 'побыстрей', 'ускорь', 'ускори', 'побыстрее']

const AUTO_ENABLE_KEY = 'voice-auto-enable'

// Разбиваем текст по пробелам/знакам препинания и проверяем точное совпадение токена.
// Это предотвращает ложные срабатывания: "продолжительность" НЕ содержит "продолжи" как слово.
function tokenize(text: string): string[] {
  return text
    .split(/[\s,.!?;:–—()]+/)
    .map(t => t.toLowerCase().replace(/[^а-яёa-z0-9]/g, ''))
    .filter(Boolean)
}

function tokenMatchesAny(text: string, words: string[]): boolean {
  const tokens = tokenize(text)
  return words.some(w => tokens.includes(w))
}

function tokenMatchesRe(text: string, re: RegExp): boolean {
  return tokenize(text).some(t => re.test(t))
}

// Расширение файла по MIME — Whisper определяет формат именно по имени файла
function extFromMime(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'mp4'
  if (mime.includes('ogg'))  return 'ogg'
  if (mime.includes('wav'))  return 'wav'
  if (mime.includes('mpeg')) return 'mp3'
  return 'webm'
}

// Выбираем первый поддерживаемый контейнер.
// iOS умеет только audio/mp4, Android/десктоп — webm/opus.
function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
  ]
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
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
  const [voiceStatus, setVoiceStatusState] = useState<VoiceStatus>('idle')
  const [isActive,    setIsActive]    = useState(false)
  const [autoEnable,  setAutoEnableState] = useState(false)
  const [voiceError,  setVoiceError]  = useState('')

  const streamRef          = useRef<MediaStream | null>(null)
  const audioCtxRef        = useRef<AudioContext | null>(null)
  const micSourceRef       = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef        = useRef<AnalyserNode | null>(null)
  const recoveringRef      = useRef(false)
  const deadSinceRef       = useRef(0)
  const voiceStatusRef     = useRef<VoiceStatus>('idle')
  const recorderRef        = useRef<MediaRecorder | null>(null)
  const recorderMimeRef    = useRef('')
  const chunksRef          = useRef<Blob[]>([])
  const isRecordingRef     = useRef(false)
  const silenceTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordStartRef     = useRef(0)
  const voiceFramesRef     = useRef(0)  // счётчик кадров подряд выше порога
  const vadActiveRef       = useRef(false)
  const busyRef            = useRef(false)
  const isActiveRef        = useRef(false)
  const isLecturePlayingRef = useRef(false)  // true пока лекция воспроизводится
  const playbackAudioRef   = useRef<HTMLAudioElement | null>(null)

  useEffect(() => { isActiveRef.current = isActive }, [isActive])

  useEffect(() => { logEnvironment() }, [])

  // Статус нужен и синхронно (в цикле VAD), поэтому дублируем его в ref.
  // Здесь же единственная точка, где звучат метки — так ни один переход
  // не окажется беззвучным и ни один не прозвучит дважды.
  const setVoiceStatus = useCallback((s: VoiceStatus) => {
    if (voiceStatusRef.current === s) return
    voiceStatusRef.current = s
    setVoiceStatusState(s)
    earconFor(s)
  }, [])

  // ── Слушаем состояние AudioPlayer ─────────────────────────────────────────

  useEffect(() => {
    const onPlay  = () => { isLecturePlayingRef.current = true }
    const onPause = () => { isLecturePlayingRef.current = false }
    // Лекция возобновилась — даём ей секунду разогнаться, чтобы первые такты
    // не попали в запись как «речь пользователя»
    const onResume = () => {
      busyRef.current = false
      if (isActiveRef.current) setVoiceStatus('listening')
      restartVADAfter(1000)
    }
    window.addEventListener('voice:lecture-playing', onPlay)
    window.addEventListener('voice:lecture-paused',  onPause)
    window.addEventListener('voice:resume-lecture',  onResume)
    return () => {
      window.removeEventListener('voice:lecture-playing', onPlay)
      window.removeEventListener('voice:lecture-paused',  onPause)
      window.removeEventListener('voice:resume-lecture',  onResume)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      vlog('autoEnable: активируем без жеста')
      activateVoice().catch(e => verr('autoEnable failed', e))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Разблокировка воспроизведения ─────────────────────────────────────────
  // ВАЖНО: вызывать строго синхронно из обработчика клика, до любого await.
  // iOS/Android разрешают play() без жеста только для элемента, который уже
  // хоть раз проигрался в контексте жеста.

  function unlockPlaybackAudio() {
    let audio = playbackAudioRef.current
    if (!audio) {
      audio = new Audio()
      audio.preload = 'auto'
      playbackAudioRef.current = audio
    }
    try {
      audio.src = SILENT_WAV
      const p = audio.play()
      if (p && typeof p.then === 'function') {
        p.then(() => vlog('unlock: аудио разблокировано'))
         .catch(e => vwarn('unlock: play() отклонён', (e as Error)?.name ?? e))
      } else {
        vlog('unlock: play() без промиса (старый браузер)')
      }
    } catch (e) {
      vwarn('unlock: исключение', e)
    }
  }

  // ── VAD ───────────────────────────────────────────────────────────────────

  function startVAD() {
    const analyser = analyserRef.current
    if (!analyser) { vwarn('VAD: нет analyser'); return }
    if (vadActiveRef.current) { vlog('VAD: уже запущен'); return }
    vadActiveRef.current = true
    vlog('VAD: запущен')

    const buf = new Uint8Array(analyser.frequencyBinCount)

    // Периодически логируем уровень сигнала — так видно, доходит ли звук с
    // микрофона вообще (главный симптом «кнопка мигает, но записи нет»).
    let peak = 0
    let lastReport = Date.now()

    const tick = () => {
      if (!vadActiveRef.current) return

      analyser.getByteFrequencyData(buf)
      const energy = buf.reduce((s, v) => s + v, 0) / buf.length

      const aboveStart = energy > VOICE_START_THRESHOLD
      const aboveStop  = energy > VOICE_STOP_THRESHOLD

      if (energy > peak) peak = energy
      if (Date.now() - lastReport > 3000) {
        vlog(`VAD: пик ${peak.toFixed(1)} / порог ${VOICE_START_THRESHOLD}` +
             `${peak < 1 ? ' — СИГНАЛА НЕТ' : peak < VOICE_START_THRESHOLD ? ' — слишком тихо' : ''}`)
        peak = 0
        lastReport = Date.now()
      }

      // ── Детектор мёртвого потока ──────────────────────────────────────
      // Смена Bluetooth-профиля оставляет трек «живым», но данные — нули.
      if (energy < DEAD_SIGNAL_LEVEL) {
        if (deadSinceRef.current === 0) deadSinceRef.current = Date.now()
        else if (
          Date.now() - deadSinceRef.current > DEAD_SIGNAL_MS &&
          !isRecordingRef.current && !recoveringRef.current
        ) {
          deadSinceRef.current = 0
          recoverMic()
        }
      } else {
        deadSinceRef.current = 0
      }

      // ── Старт записи ──────────────────────────────────────────────────
      // Во время речи ассистента запись разрешена — это перебивание, но с
      // повышенной планкой, чтобы его собственный голос её не запускал.
      const speaking     = voiceStatusRef.current === 'speaking'
      const framesNeeded = speaking ? BARGE_IN_FRAMES : MIN_VOICE_FRAMES
      const mayRecord    = !isRecordingRef.current && (!busyRef.current || speaking)

      if (aboveStart) {
        voiceFramesRef.current++
        if (voiceFramesRef.current >= framesNeeded && mayRecord) beginRecording()
      } else {
        voiceFramesRef.current = 0
      }

      // ── Остановка записи ──────────────────────────────────────────────
      // Порог ниже, чем для старта: тихий хвост фразы не считается тишиной.
      if (isRecordingRef.current) {
        if (aboveStop) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        } else if (!silenceTimerRef.current) {
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

  // ── Восстановление микрофона ──────────────────────────────────────────────
  // Bluetooth-гарнитура при переключении профиля (воспроизведение ↔ запись)
  // оставляет трек в состоянии live, но поток отдаёт нули. Единственное
  // лекарство — перезахватить getUserMedia. AudioContext при этом сохраняем:
  // повторный resume() на iOS ненадёжен.

  function attachTrackWatchers(stream: MediaStream) {
    const track = stream.getAudioTracks()[0]
    if (!track) return
    track.onmute   = () => { vwarn('mic: трек заглушён системой'); recoverMic() }
    track.onended  = () => { vwarn('mic: трек завершён');          recoverMic() }
    track.onunmute = () => vlog('mic: трек снова активен')
  }

  async function recoverMic() {
    if (recoveringRef.current || !isActiveRef.current) return
    recoveringRef.current = true
    vwarn('mic: сигнал пропал — перезахватываем поток')

    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream

      const ctx = audioCtxRef.current
      if (ctx) {
        if (ctx.state === 'suspended') await ctx.resume()
        if (micSourceRef.current) { try { micSourceRef.current.disconnect() } catch { /* уже отключён */ } }
        const src = ctx.createMediaStreamSource(stream)
        if (analyserRef.current) src.connect(analyserRef.current)
        micSourceRef.current = src
      }

      attachTrackWatchers(stream)
      deadSinceRef.current = 0
      vlog(`mic: поток восстановлен, трек «${stream.getAudioTracks()[0]?.label || 'без имени'}»`)
    } catch (e) {
      verr('mic: восстановить не удалось', e)
      setVoiceError('Микрофон отключился. Выключи и включи голосовой режим.')
    } finally {
      recoveringRef.current = false
    }
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

    // Перебивание: ассистент говорил, но человек начал спрашивать.
    // Снимаем блокировку, иначе запись останется заперта до конца ответа.
    const bargingIn = voiceStatusRef.current === 'speaking'
    if (bargingIn) {
      vlog('перебивание: останавливаем ответ ассистента')
      busyRef.current = false
    }

    window.dispatchEvent(new CustomEvent('voice:interrupt-audio'))

    isRecordingRef.current = true
    chunksRef.current      = []
    recordStartRef.current = Date.now()
    setVoiceStatus('recording')

    const mimeType = recorderMimeRef.current

    let mr: MediaRecorder
    try {
      mr = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: RECORDER_BITRATE })
        : new MediaRecorder(stream, { audioBitsPerSecond: RECORDER_BITRATE })
    } catch (e) {
      verr('MediaRecorder не создан', e)
      isRecordingRef.current = false
      setVoiceError('Запись не поддерживается этим браузером')
      return
    }
    recorderRef.current = mr

    const actualMime = mr.mimeType || mimeType || 'audio/webm'
    vlog(`rec: старт, mime=${actualMime}`)

    mr.onerror = e => verr('MediaRecorder error', (e as unknown as { error?: Error }).error)
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      isRecordingRef.current = false
      const duration = Date.now() - recordStartRef.current
      const blob = new Blob(chunksRef.current, { type: actualMime })
      vlog(`rec: стоп, ${duration}мс, ${blob.size} байт, чанков ${chunksRef.current.length}`)

      if (duration < MIN_RECORD_MS || chunksRef.current.length === 0) {
        vlog('rec: слишком коротко — пропускаем')
        if (isActiveRef.current) setVoiceStatus('listening')
        return
      }
      sendToWhisper(blob, extFromMime(actualMime))
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

      vlog(`stt: отправка recording.${ext}, ${blob.size} байт`)
      const res = await fetch('/api/stt', { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        verr(`stt: HTTP ${res.status}`, body.slice(0, 200))
        setVoiceError(`Ошибка распознавания (${res.status})`)
        throw new Error('STT failed')
      }

      const { text } = await res.json() as { text: string }
      vlog('stt: результат', text || '(пусто)')
      const normalized = text.trim().toLowerCase()

      // ── КОМАНДЫ СКОРОСТИ — работают в любом режиме ──────────────────────
      if (tokenMatchesAny(normalized, SLOWER_WORDS)) {
        vlog('cmd: медленнее')
        window.dispatchEvent(new CustomEvent('voice:change-speed', { detail: { direction: 'slower' } }))
        busyRef.current = false
        if (isActiveRef.current) setVoiceStatus('listening')
        restartVADAfter(600)
        return
      }
      if (tokenMatchesAny(normalized, FASTER_WORDS)) {
        vlog('cmd: быстрее')
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
          vlog('cmd: стоп-лекция')
          window.dispatchEvent(new CustomEvent('voice:stop-lecture'))
          // AudioPlayer выдаст voice:lecture-paused → isLecturePlayingRef = false
          busyRef.current = false
          if (isActiveRef.current) setVoiceStatus('listening')
          restartVADAfter(800)
        } else {
          vlog('lecture-mode: не команда — игнорируем')
          busyRef.current = false
          if (isActiveRef.current) setVoiceStatus('listening')
        }
        return
      }

      // ── РЕЖИМ ДИАЛОГА (лекция на паузе или не запущена) ─────────────────

      // Команда «продолжи» — возобновляем лекцию, ассистента не трогаем.
      // Сначала короткое голосовое подтверждение: без него на слух непонятно,
      // вернулась лекция или ассистент всё ещё отвечает на вопрос.
      // busyRef остаётся true — его снимет TTS подтверждения.
      if (tokenMatchesRe(normalized, RESUME_RE)) {
        vlog('cmd: продолжить лекцию')
        window.dispatchEvent(new CustomEvent('voice:say-and-resume', {
          detail: { text: 'Хорошо, продолжаю лекцию.' },
        }))
        return
      }

      // Обычное сообщение → ассистент
      if (text.trim() && isActiveRef.current) {
        // busyRef остаётся true до завершения TTS ассистента
        vlog('→ ассистенту')
        setVoiceStatus('processing')
        window.dispatchEvent(new CustomEvent('voice:user-message', { detail: { text: text.trim() } }))
      } else {
        vlog('stt: пустой текст — ничего не отправляем')
        busyRef.current = false
        if (isActiveRef.current) setVoiceStatus('listening')
      }
    } catch (e) {
      verr('stt: исключение', e)
      busyRef.current = false
      if (isActiveRef.current) setVoiceStatus('listening')
    }
  }

  // ── Activate / Deactivate ─────────────────────────────────────────────────

  async function activateVoice() {
    setVoiceError('')
    vlog('activate: запрашиваем микрофон')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch (e) {
      const err = e as Error
      verr(`getUserMedia: ${err.name}`, err.message)
      throw e
    }
    streamRef.current = stream

    const track = stream.getAudioTracks()[0]
    vlog(`activate: трек «${track?.label || 'без имени'}», enabled=${track?.enabled}, state=${track?.readyState}`)

    recorderMimeRef.current = pickRecorderMime()
    vlog('activate: контейнер записи', recorderMimeRef.current || 'по умолчанию')

    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    vlog(`activate: AudioContext state=${ctx.state}, sampleRate=${ctx.sampleRate}`)
    if (ctx.state === 'suspended') {
      await ctx.resume()
      vlog(`activate: после resume() state=${ctx.state}`)
    }

    const src      = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.3
    src.connect(analyser)
    micSourceRef.current = src
    analyserRef.current  = analyser

    attachTrackWatchers(stream)

    busyRef.current      = false
    vadActiveRef.current = false
    deadSinceRef.current = 0

    setIsActive(true)
    setVoiceStatus('listening')
    startVAD()
    vlog('activate: готово')
  }

  function deactivateVoice() {
    vlog('deactivate')
    vadActiveRef.current = false

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    finishRecording()

    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null }
    micSourceRef.current  = null
    analyserRef.current   = null
    busyRef.current        = false
    isRecordingRef.current = false
    deadSinceRef.current   = 0

    setIsActive(false)
    setVoiceStatus('idle')
  }

  // НЕ async: разблокировка звука должна произойти синхронно внутри жеста,
  // иначе iOS не считает play() пользовательским действием.
  function toggleVoice() {
    if (isActive) {
      deactivateVoice()
      return
    }
    unlockPlaybackAudio()
    unlockEarcons()
    activateVoice().catch(() => {
      setVoiceError('Нет доступа к микрофону. На iPhone: Настройки → Chrome → Микрофон → включить')
    })
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
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <VoiceContext.Provider value={{
      voiceStatus, setVoiceStatus,
      isActive, autoEnable, voiceError,
      toggleVoice, setAutoEnable, setBusy,
      getPlaybackAudio: () => playbackAudioRef.current,
    }}>
      {children}
    </VoiceContext.Provider>
  )
}
