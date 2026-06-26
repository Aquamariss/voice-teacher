'use client'

import { useState, useRef, useEffect } from 'react'
import { SPEEDS, SPEED_KEY, getSavedSpeed } from '@/lib/playback-speed'

interface AudioPlayerProps {
  title: string
  partLabel: string
  text: string
  onClose: () => void
  onEnded?: () => void
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error'

function splitIntoChunks(text: string, maxChars = 800): string[] {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = ''
    }
    if (para.length > maxChars) {
      const sentences = para.match(/[^.!?]+[.!?]+\s*/g) ?? [para]
      for (const sent of sentences) {
        if (current.length + sent.length > maxChars && current.length > 0) {
          chunks.push(current.trim())
          current = ''
        }
        current += sent
      }
    } else {
      current += (current ? '\n\n' : '') + para
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

export default function AudioPlayer({ title, partLabel, text, onClose, onEnded }: AudioPlayerProps) {
  const [state, setState]             = useState<PlayerState>('idle')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)
  const [error, setError]             = useState('')
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunksReady, setChunksReady] = useState(0)
  const [speed, setSpeed]             = useState<number>(getSavedSpeed)

  const speedRef        = useRef(getSavedSpeed())
  const audioRef        = useRef<HTMLAudioElement | null>(null)
  const mediaSourceRef  = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const pendingBuffers  = useRef<ArrayBuffer[]>([])
  const cancelledRef    = useRef(false)
  const userPausedRef   = useRef(false)

  function fmt(sec: number) {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function flushPending() {
    const sb = sourceBufferRef.current
    const ms = mediaSourceRef.current
    if (!sb || sb.updating || pendingBuffers.current.length === 0) return
    if (!ms || ms.readyState !== 'open') return
    const buf = pendingBuffers.current.shift()!
    try {
      sb.appendBuffer(buf)
    } catch {
      pendingBuffers.current.unshift(buf) // вернуть, если не получилось
    }
  }

  function tryPlay(audio: HTMLAudioElement) {
    if (cancelledRef.current || userPausedRef.current || !audio.paused) return
    audio.play().catch(() => {})
  }

  async function fetchChunk(chunkText: string): Promise<void> {
    if (cancelledRef.current) return
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunkText }),
    })
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      let msg = `Ошибка TTS (${res.status})`
      try {
        const detail = (JSON.parse(body) as { detail?: { code?: string; message?: string } }).detail
        if (detail?.code === 'quota_exceeded') msg = 'Квота ElevenLabs исчерпана — пополни план на elevenlabs.io'
        else if (detail?.message) msg = detail.message
      } catch { /* body не JSON */ }
      throw new Error(msg)
    }

    const reader = res.body.getReader()
    const audio  = audioRef.current!
    while (true) {
      if (cancelledRef.current) { reader.cancel(); return }
      const { done, value } = await reader.read()
      if (done || cancelledRef.current) break
      const buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      pendingBuffers.current.push(buf)
      flushPending()
      if (audio.readyState >= 2) tryPlay(audio)
    }
  }

  // Запускается из sourceopen — никакого await перед этим
  async function streamChunks(chunks: string[], ms: MediaSource, sb: SourceBuffer) {
    if (cancelledRef.current) return
    const audio = audioRef.current!

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (cancelledRef.current) return
        await fetchChunk(chunks[i])
        if (cancelledRef.current) return
        setChunksReady(i + 1)
        if (i === 0) tryPlay(audio)
      }
      if (cancelledRef.current) return

      // Ждём очистки очереди, потом закрываем поток
      const close = () => {
        if (cancelledRef.current) return
        if (pendingBuffers.current.length === 0 && !sb.updating && ms.readyState === 'open') {
          try { ms.endOfStream() } catch { /* already closed */ }
        } else setTimeout(close, 50)
      }
      close()

      if (audio.readyState >= 2) tryPlay(audio)
      else audio.addEventListener('canplay', () => tryPlay(audio), { once: true })

    } catch (err) {
      if (cancelledRef.current) return
      console.error('[AudioPlayer] stream error:', err)
      setState('error')
      setError('Не удалось загрузить аудио')
    }
  }

  // Запасной вариант: blob по чанкам (без MSE)
  async function fallbackBlobChunks(chunks: string[]) {
    const audio = audioRef.current!
    let currentUrl: string | null = null

    const waitEnded = () => new Promise<void>(resolve => {
      audio.addEventListener('ended', () => resolve(), { once: true })
    })
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (cancelledRef.current) break
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunks[i] }),
        })
        if (!res.ok || cancelledRef.current) break
        const blob = await res.blob()
        if (cancelledRef.current) break
        if (currentUrl) URL.revokeObjectURL(currentUrl)
        currentUrl = URL.createObjectURL(blob)
        audio.src = currentUrl
        audio.load()
        setChunksReady(i + 1)
        if (!userPausedRef.current) audio.play().catch(() => {})
        await waitEnded()
      }
      if (!cancelledRef.current) { setState('done'); onEnded?.() }
    } catch {
      if (!cancelledRef.current) { setState('error'); setError('Ошибка воспроизведения') }
    } finally {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  }

  function startStream() {
    cancelledRef.current = false
    userPausedRef.current = false
    setState('loading')
    setError('')

    const chunks = splitIntoChunks(text)
    setChunksTotal(chunks.length)
    setChunksReady(0)

    const audio = new Audio()
    audioRef.current = audio

    audio.addEventListener('timeupdate', () => {
      if (!cancelledRef.current) setCurrentTime(audio.currentTime)
    })
    audio.addEventListener('durationchange', () => {
      if (isFinite(audio.duration) && !cancelledRef.current) setDuration(audio.duration)
    })
    audio.addEventListener('playing', () => {
      window.dispatchEvent(new CustomEvent('voice:lecture-playing'))
      if (!cancelledRef.current) setState('playing')
    })
    audio.addEventListener('pause', () => {
      window.dispatchEvent(new CustomEvent('voice:lecture-paused'))
      if (!cancelledRef.current) setState(s => s !== 'done' ? 'paused' : 'done')
    })
    audio.addEventListener('ended', () => {
      window.dispatchEvent(new CustomEvent('voice:lecture-paused'))
      if (cancelledRef.current) return
      setState('done'); onEnded?.()
    })
    audio.addEventListener('error', () => {
      if (!cancelledRef.current) { setState('error'); setError('Ошибка воспроизведения') }
    })
    audio.addEventListener('canplay', () => {
      if (!cancelledRef.current) tryPlay(audio)
    }, { once: true })

    const ms = new MediaSource()
    mediaSourceRef.current = ms

    // sourceopen — единственное место старта стриминга, никаких await до этого
    ms.addEventListener('sourceopen', () => {
      if (cancelledRef.current) return
      try {
        const sb = ms.addSourceBuffer('audio/mpeg')
        sb.addEventListener('updateend', flushPending)
        sourceBufferRef.current = sb
        streamChunks(chunks, ms, sb)
      } catch {
        fallbackBlobChunks(chunks)
      }
    }, { once: true })

    audio.src = URL.createObjectURL(ms)
    audio.load()
    // После load() браузер сбрасывает playbackRate → восстанавливаем сохранённое значение
    audio.playbackRate = speedRef.current
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      userPausedRef.current = false
      audio.play().catch(() => {})
    } else {
      userPausedRef.current = true
      audio.pause()
    }
  }

  function stop() {
    cancelledRef.current = true
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.src = '' }
    audioRef.current = null
    mediaSourceRef.current = null
    sourceBufferRef.current = null
    pendingBuffers.current = []
    setState('idle')
    setCurrentTime(0)
    setDuration(0)
    onClose()
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current
    if (!audio || !isFinite(audio.duration)) return
    audio.currentTime = Number(e.target.value)
    setCurrentTime(audio.currentTime)
  }

  function changeSpeed(s: number) {
    setSpeed(s)
    speedRef.current = s
    localStorage.setItem(SPEED_KEY, String(s))
    if (audioRef.current) audioRef.current.playbackRate = s
  }

  useEffect(() => {
    startStream()

    // Голос обнаружен — ставим на паузу (не стоп), чтобы можно было возобновить
    const handleVoiceInterrupt = () => { audioRef.current?.pause() }
    const handleStopLecture    = () => { audioRef.current?.pause() }
    const handleResumeLecture  = () => { audioRef.current?.play().catch(() => {}) }

    const handleChangeSpeed = (e: Event) => {
      const { direction } = (e as CustomEvent<{ direction: 'slower' | 'faster' }>).detail
      setSpeed(prev => {
        const idx     = SPEEDS.indexOf(prev)
        const newIdx  = direction === 'faster'
          ? Math.min(idx + 1, SPEEDS.length - 1)
          : Math.max(idx - 1, 0)
        const next = SPEEDS[newIdx]
        if (next === prev) return prev
        speedRef.current = next
        localStorage.setItem(SPEED_KEY, String(next))
        if (audioRef.current) audioRef.current.playbackRate = next
        return next
      })
    }

    window.addEventListener('voice:interrupt-audio', handleVoiceInterrupt)
    window.addEventListener('voice:stop-lecture',    handleStopLecture)
    window.addEventListener('voice:resume-lecture',  handleResumeLecture)
    window.addEventListener('voice:change-speed',    handleChangeSpeed)

    return () => {
      cancelledRef.current = true
      window.removeEventListener('voice:interrupt-audio', handleVoiceInterrupt)
      window.removeEventListener('voice:stop-lecture',    handleStopLecture)
      window.removeEventListener('voice:resume-lecture',  handleResumeLecture)
      window.removeEventListener('voice:change-speed',    handleChangeSpeed)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="
      fixed z-40 bg-white border border-gray-200 shadow-xl
      bottom-0 left-0 right-0
      sm:bottom-5 sm:left-5 sm:right-auto sm:w-[420px] sm:rounded-2xl
      rounded-t-2xl px-4 py-3
    ">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 mr-2">
          <p className="text-xs text-gray-400 truncate">{partLabel}</p>
          <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
        </div>
        <button onClick={stop}
          className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors rounded-full hover:bg-gray-100">
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-400 w-8 text-right shrink-0">{fmt(currentTime)}</span>
        <div className="relative flex-1 h-1.5 bg-gray-200 rounded-full">
          <div className="absolute left-0 top-0 h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progress}%` }} />
          <input type="range" min={0} max={duration || 100} value={currentTime}
            onChange={seek} disabled={!duration}
            className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-default" />
        </div>
        <span className="text-xs text-gray-400 w-8 shrink-0">{duration ? fmt(duration) : '--:--'}</span>
      </div>

      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => changeSpeed(s)}
              className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                speed === s
                  ? 'bg-blue-100 text-blue-700 font-semibold'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {error ? (
            <p className="text-xs text-red-500">{error}</p>
          ) : state === 'loading' ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="inline-block animate-spin">⟳</span>
              {chunksTotal > 1 ? `Фрагмент 1 из ${chunksTotal}...` : 'Генерирую...'}
            </div>
          ) : (
            <>
              <button onClick={togglePlay}
                className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors text-lg">
                {state === 'playing' ? '⏸' : '▶'}
              </button>
              {state !== 'done' && chunksTotal > 1 && chunksReady < chunksTotal && (
                <span className="text-xs text-gray-400">{chunksReady + 1}/{chunksTotal}</span>
              )}
              {state === 'done' && (
                <span className="text-xs text-green-600 font-medium">✓ Прослушано</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
