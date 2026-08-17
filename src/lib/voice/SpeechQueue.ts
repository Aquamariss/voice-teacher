import { vlog, verr } from './debugLog'

// Последовательная озвучка сегментов на одном аудио-элементе.
//
// Зачем очередь, а не один запрос на весь ответ: раньше синтез начинался
// только после того, как модель дописала ответ целиком — это давало около
// четырёх секунд тишины. Теперь первое же законченное предложение уходит на
// синтез сразу, а остальные догружаются, пока оно звучит.
//
// Элемент переиспользуется всегда один и тот же — тот, что разблокирован
// жестом при включении микрофона. Создавать новый Audio() на каждый сегмент
// нельзя: на iOS он будет заблокирован политикой автовоспроизведения.

export interface SpeechQueueOptions {
  /** Разблокированный жестом элемент; null — воспроизводить нечем */
  getAudio:   () => HTMLAudioElement | null
  /** null означает «сегмент не удалось синтезировать» — он будет пропущен */
  fetchAudio: (text: string) => Promise<Blob | null>
  getSpeed:   () => number
  onFirstSound?: () => void
  onDone?:       () => void
}

interface Item {
  text: string
  blob: Promise<Blob | null>
}

export class SpeechQueue {
  private items: Item[] = []
  private next = 0
  private inputEnded = false
  private cancelled  = false
  private running    = false
  private firstSoundSent = false
  private wake: (() => void) | null = null

  constructor(private opts: SpeechQueueOptions) {}

  /** Добавить сегмент. Синтез стартует сразу, не дожидаясь очереди. */
  push(text: string) {
    const trimmed = text.trim()
    if (!trimmed || this.cancelled || this.inputEnded) return
    vlog(`speech: сегмент +${trimmed.length} симв.`)
    this.items.push({ text: trimmed, blob: this.opts.fetchAudio(trimmed) })
    this.wake?.()
    void this.pump()
  }

  /** Сегментов больше не будет; очередь завершится, когда доиграет последний. */
  end() {
    if (this.cancelled) return
    this.inputEnded = true
    this.wake?.()
    void this.pump()
  }

  /** Немедленно оборвать — перебивание, выключение голоса, размонтирование. */
  cancel() {
    if (this.cancelled) return
    this.cancelled = true
    this.wake?.()
    const audio = this.opts.getAudio()
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      // src намеренно не трогаем: очистка сбрасывает разблокировку на iOS
    }
  }

  get isCancelled() { return this.cancelled }

  private waitForMore(): Promise<void> {
    return new Promise(resolve => { this.wake = () => { this.wake = null; resolve() } })
  }

  private async pump() {
    if (this.running) return
    this.running = true

    try {
      while (!this.cancelled) {
        if (this.next >= this.items.length) {
          if (this.inputEnded) break
          await this.waitForMore()
          continue
        }

        const item = this.items[this.next++]
        let blob: Blob | null = null
        try {
          blob = await item.blob
        } catch (e) {
          verr('speech: синтез сегмента не удался', e)
        }
        if (this.cancelled) break
        if (!blob) continue

        await this.playOne(blob)
      }
    } finally {
      this.running = false
      if (!this.cancelled) this.opts.onDone?.()
    }
  }

  private playOne(blob: Blob): Promise<void> {
    const audio = this.opts.getAudio()
    if (!audio) return Promise.resolve()

    const url = URL.createObjectURL(blob)

    return new Promise<void>(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        audio.onended = null
        audio.onerror = null
        URL.revokeObjectURL(url)
        resolve()
      }

      audio.onended = finish
      audio.onerror = () => {
        verr('speech: ошибка элемента',
          audio.error ? `code=${audio.error.code} ${audio.error.message}` : 'unknown')
        finish()
      }

      // Без load(): он сбрасывает разрешение на автовоспроизведение на iOS
      audio.src = url
      audio.playbackRate = this.opts.getSpeed()

      audio.play().then(() => {
        audio.playbackRate = this.opts.getSpeed()  // смена src сбрасывает скорость
        if (!this.firstSoundSent) {
          this.firstSoundSent = true
          this.opts.onFirstSound?.()
        }
      }).catch((e: Error) => {
        verr(`speech: play() отклонён (${e.name})`, e.message)
        finish()
      })
    })
  }
}

// ── Нарезка потока на сегменты ───────────────────────────────────────────────

// Первый сегмент отдаём на синтез как можно раньше — от него зависит
// ощущаемая задержка. Дальше берём куски покрупнее: меньше запросов и
// ровнее интонация на стыках.
const FIRST_SEGMENT_MIN = 24
const NEXT_SEGMENT_MIN  = 180

/** Возвращает готовые к озвучке сегменты и остаток, который ещё копится. */
export function takeCompleteSegments(
  buffer: string,
  isFirst: boolean,
): { segments: string[]; rest: string } {
  const segments: string[] = []
  let rest = buffer

  for (;;) {
    const min = isFirst && segments.length === 0 ? FIRST_SEGMENT_MIN : NEXT_SEGMENT_MIN
    // Конец предложения: знак препинания, за которым пробел или конец строки
    const re = /[.!?…](?=\s)|[.!?…]$|\n\n/g
    let cut = -1
    let m: RegExpExecArray | null
    while ((m = re.exec(rest)) !== null) {
      if (m.index + 1 >= min) { cut = m.index + m[0].length; break }
    }
    if (cut === -1) break
    const piece = rest.slice(0, cut).trim()
    if (piece) segments.push(piece)
    rest = rest.slice(cut)
  }

  return { segments, rest }
}
