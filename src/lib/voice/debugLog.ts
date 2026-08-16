// Кольцевой буфер логов голосового режима.
// Нужен потому, что на телефоне нет консоли разработчика —
// VoiceDebugPanel показывает эти записи прямо на экране.

export interface LogEntry {
  t:     number
  level: 'info' | 'warn' | 'error'
  msg:   string
}

const MAX_ENTRIES = 300

// Пересоздаём массив на каждую запись: useSyncExternalStore сравнивает
// снимки по ссылке и при мутации на месте не стал бы перерисовывать панель.
let entries: LogEntry[] = []
const listeners = new Set<() => void>()

function safeStringify(data: unknown): string {
  if (data === undefined) return ''
  if (typeof data === 'string') return data
  if (data instanceof Error) return `${data.name}: ${data.message}`
  try { return JSON.stringify(data) } catch { return String(data) }
}

function push(level: LogEntry['level'], msg: string, data?: unknown) {
  const extra = safeStringify(data)
  const line  = extra ? `${msg} — ${extra}` : msg
  const next  = entries.length >= MAX_ENTRIES ? entries.slice(1) : entries.slice()
  next.push({ t: Date.now(), level, msg: line })
  entries = next
  listeners.forEach(fn => fn())
  // Дублируем в консоль — полезно при отладке на десктопе
  const c = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  c('[voice]', line)
}

export const vlog  = (msg: string, data?: unknown) => push('info',  msg, data)
export const vwarn = (msg: string, data?: unknown) => push('warn',  msg, data)
export const verr  = (msg: string, data?: unknown) => push('error', msg, data)

export function getLogEntries(): LogEntry[] {
  return entries
}

export function clearLog() {
  entries = []
  listeners.forEach(fn => fn())
}

export function subscribeLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// Сводка окружения — первое, что стоит увидеть в отчёте с телефона
export function logEnvironment() {
  const ua = navigator.userAgent
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ маскируется под macOS, отличаем по наличию тач-точек
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)

  vlog('env.platform', isIOS ? 'iOS' : isAndroid ? 'Android' : 'desktop')
  vlog('env.ua', ua)
  vlog('env.mediaDevices', typeof navigator.mediaDevices?.getUserMedia === 'function')
  vlog('env.MediaRecorder', typeof MediaRecorder !== 'undefined')
  vlog('env.AudioContext', typeof AudioContext !== 'undefined')
  vlog('env.secureContext', window.isSecureContext)

  if (typeof MediaRecorder !== 'undefined') {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg']
    const supported = types.filter(t => MediaRecorder.isTypeSupported(t))
    vlog('env.recorderTypes', supported.join(', ') || 'НЕТ ПОДДЕРЖИВАЕМЫХ')
  }
}
