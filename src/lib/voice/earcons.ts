// Короткие звуковые метки голосового режима.
//
// Зачем: основной сценарий — телефон в кармане, за рулём, на пробежке.
// Визуальный индикатор там бесполезен, а понимать «меня услышали» и
// «можно замолчать и ждать» пользователю нужно.
//
// Тоны генерируются в WAV-data-URI и проигрываются обычным <audio>, а НЕ через
// AudioContext захвата: подключение к его destination меняет маршрут аудио и
// глушит микрофон (см. историю с AirPods).

const EARCONS_KEY = 'voice-earcons'

let el: HTMLAudioElement | null = null
let startUri  = ''
let endUri    = ''
let silentUri = ''

function encodeWav(samples: Float32Array, sampleRate: number): string {
  const len  = samples.length
  const buf  = new ArrayBuffer(44 + len * 2)
  const view = new DataView(buf)
  const wr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  wr(0, 'RIFF')
  view.setUint32(4, 36 + len * 2, true)
  wr(8, 'WAVE')
  wr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)           // PCM
  view.setUint16(22, 1, true)           // моно
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  wr(36, 'data')
  view.setUint32(40, len * 2, true)

  let offset = 44
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s * 0x7fff, true)
    offset += 2
  }

  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return 'data:audio/wav;base64,' + btoa(bin)
}

// Плавный переход частоты + затухание по краям, чтобы не было щелчков.
// Громкость зашита в сами сэмплы: iOS игнорирует HTMLAudioElement.volume.
function tone(fromHz: number, toHz: number, durMs: number, amp = 0.16): string {
  const sampleRate = 22050
  const n   = Math.floor(sampleRate * durMs / 1000)
  const out = new Float32Array(n)
  let phase = 0

  for (let i = 0; i < n; i++) {
    const t = i / n
    const f = fromHz + (toHz - fromHz) * t
    phase += (2 * Math.PI * f) / sampleRate
    const fade = Math.min(1, t / 0.15, (1 - t) / 0.15)
    out[i] = Math.sin(phase) * amp * fade
  }
  return encodeWav(out, sampleRate)
}

function ensureBuilt() {
  if (typeof window === 'undefined') return
  if (!el) {
    el = new Audio()
    el.preload = 'auto'
  }
  if (!startUri) {
    startUri  = tone(660, 880, 110)   // восходящий — «слушаю»
    endUri    = tone(880, 520, 150)   // нисходящий — «понял, думаю»
    silentUri = tone(440, 440, 40, 0) // беззвучный, только для разблокировки
  }
}

export function earconsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(EARCONS_KEY) !== 'off'
}

export function setEarconsEnabled(on: boolean) {
  localStorage.setItem(EARCONS_KEY, on ? 'on' : 'off')
}

/** Вызывать синхронно внутри жеста пользователя — иначе iOS не разрешит
 *  проигрывание позже, из асинхронного кода. */
export function unlockEarcons() {
  ensureBuilt()
  if (!el) return
  el.src = silentUri
  el.play().catch(() => { /* разблокировка не критична */ })
}

function play(uri: string) {
  if (!earconsEnabled()) return
  ensureBuilt()
  if (!el) return
  el.src = uri
  el.play().catch(() => { /* звук-подсказка, молча пропускаем */ })
}

export const earconStart = () => play(startUri)
export const earconEnd   = () => play(endUri)
