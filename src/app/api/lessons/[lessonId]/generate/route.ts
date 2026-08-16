import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@/lib/supabase/server'
import { type QuizData } from '@/types/db'
import { extractImageConcepts } from '@/lib/image-concepts'
import { fetchWikipediaImages } from '@/lib/wikipedia'

export const maxDuration = 300 // 5 минут — для многочастных занятий

const client = new Anthropic()

// Читаем промпты при каждом запросе — изменения в .md подхватываются без перезапуска сервера
function loadPrompts() {
  const base = join(process.cwd(), 'src/lib/agents')
  return {
    outlinePrompt: readFileSync(join(base, 'lesson-outline-prompt.md'), 'utf-8'),
    partPrompt:    readFileSync(join(base, 'lesson-part-prompt.md'),    'utf-8'),
    quizPrompt:    readFileSync(join(base, 'lesson-quiz-prompt.md'),    'utf-8'),
  }
}

interface OutlineData {
  total_parts: number
  outline: string
  parts: Array<{
    part_number: number
    title: string
    duration_minutes: number
    key_points: string[]
  }>
}

interface LessonContext {
  disciplineName: string
  topicName: string
  moduleName: string
  lessonName: string
  lessonDescription: string | null
  complexity: string
  depth: string
  lesson_duration_minutes: number
}

// Генерирует план занятия (быстрый первый вызов)
async function generateOutline(lessonContext: LessonContext, outlinePrompt: string): Promise<OutlineData> {
  const system = `${outlinePrompt}\n\n## Контекст занятия\n\n\`\`\`json\n${JSON.stringify(lessonContext, null, 2)}\n\`\`\``

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: 'Составь план занятия.' }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(jsonStr) as OutlineData
}

// SSE-хелпер: шлёт событие клиенту через ReadableStream
function makeEventStream() {
  const encoder = new TextEncoder()
  let enqueue: (chunk: Uint8Array) => void
  let close: () => void

  const stream = new ReadableStream({
    start(controller) {
      enqueue = (chunk) => { try { controller.enqueue(chunk) } catch { /* disconnected */ } }
      close = () => { try { controller.close() } catch { /* already closed */ } }
    },
  })

  function send(event: string, data: unknown) {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    enqueue(encoder.encode(line))
  }

  return { stream, send, close: () => close() }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: lesson } = await supabase
    .from('lessons')
    .select(`
      *,
      module:modules!inner(
        name,
        topic:topics!inner(
          name, complexity, depth, lesson_duration_minutes,
          discipline:disciplines!inner(name, user_id)
        )
      )
    `)
    .eq('id', lessonId)
    .eq('modules.topics.disciplines.user_id', user.id)
    .single()

  if (!lesson) return new Response('Not found', { status: 404 })

  const body = await request.json() as { resume?: boolean; quiz_only?: boolean }
  const resume = body.resume === true
  const quizOnly = body.quiz_only === true

  const prompts = loadPrompts()

  const mod = lesson.module as { name: string; topic: { name: string; complexity: string; depth: string; lesson_duration_minutes: number; discipline: { name: string } } }
  const lessonContext: LessonContext = {
    disciplineName: mod.topic.discipline.name,
    topicName: mod.topic.name,
    moduleName: mod.name,
    lessonName: lesson.name,
    lessonDescription: lesson.description,
    complexity: mod.topic.complexity,
    depth: mod.topic.depth,
    lesson_duration_minutes: mod.topic.lesson_duration_minutes,
  }

  // ── Режим quiz_only: обновить только вопросы ────────────────────────────
  if (quizOnly) {
    const { stream, send, close } = makeEventStream()
    ;(async () => {
      try {
        send('status', { phase: 'quiz', message: 'Обновляю проверочные вопросы...' })

        const { data: savedParts } = await supabase
          .from('lesson_parts')
          .select('part_number, content')
          .eq('lesson_id', lessonId)
          .eq('status', 'ready')
          .order('part_number')

        const fullText = (savedParts ?? []).map(p => p.content ?? '').join('\n\n')
        if (!fullText.trim()) {
          send('error', { message: 'Нет готовых частей для создания вопросов.' })
          return
        }

        const quizSystem = `${prompts.quizPrompt}\n\n## Контекст занятия\n\n\`\`\`json\n${JSON.stringify(lessonContext, null, 2)}\n\`\`\``
        const quizMsg = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: quizSystem,
          messages: [{ role: 'user', content: `Текст занятия:\n\n${fullText}\n\nСоставь вопросы.` }],
        })

        const raw = quizMsg.content[0].type === 'text' ? quizMsg.content[0].text : ''
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
        const quizData: QuizData = JSON.parse(jsonStr)

        await supabase.from('lessons').update({ quiz_data: quizData, quiz_results: null }).eq('id', lessonId)
        send('quiz_ready', { quizData })
        send('done', { totalParts: 0 })
      } catch (err) {
        console.error('[lesson/generate quiz_only]', err)
        send('error', { message: String(err) })
      } finally {
        close()
      }
    })()
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  }

  const { stream, send, close } = makeEventStream()

  ;(async () => {
    try {
      // ── Шаг 1: Outline ────────────────────────────────────────────────────
      send('status', { phase: 'outline', message: resume ? 'Проверяю план занятия...' : 'Составляю план занятия...' })

      let outline: OutlineData
      try {
        outline = await generateOutline(lessonContext, prompts.outlinePrompt)
      } catch {
        send('error', { message: 'Не удалось составить план занятия.' })
        close()
        return
      }

      await supabase.from('lessons').update({ content_outline: outline.outline }).eq('id', lessonId)

      let existingReadyContents: Record<number, string> = {}

      if (resume) {
        const { data: existingParts } = await supabase
          .from('lesson_parts')
          .select('part_number, content, status')
          .eq('lesson_id', lessonId)
          .order('part_number')

        for (const p of existingParts ?? []) {
          if (p.status === 'ready' && p.content) {
            existingReadyContents[p.part_number] = p.content
          }
        }

        const existingNums = new Set(Object.keys(existingReadyContents).map(Number))
        const missingParts = outline.parts.filter(p => !existingNums.has(p.part_number))
        if (missingParts.length > 0) {
          await supabase.from('lesson_parts').insert(
            missingParts.map(p => ({ lesson_id: lessonId, part_number: p.part_number, status: 'pending' }))
          )
        }
        await supabase.from('lesson_parts')
          .update({ status: 'pending' })
          .eq('lesson_id', lessonId)
          .eq('status', 'generating')
      } else {
        await supabase.from('lesson_parts').delete().eq('lesson_id', lessonId)
        await supabase.from('lesson_parts').insert(
          outline.parts.map(p => ({ lesson_id: lessonId, part_number: p.part_number, status: 'pending' }))
        )
      }

      send('outline', { outline, totalParts: outline.total_parts })

      // ── Шаг 2: Генерируем каждую часть ──────────────────────────────────
      let previousPartEnding = ''

      for (const partInfo of outline.parts) {
        if (resume && existingReadyContents[partInfo.part_number]) {
          const content = existingReadyContents[partInfo.part_number]
          previousPartEnding = content.split(/\s+/).slice(-200).join(' ')
          send('part_skipped', { partNumber: partInfo.part_number })
          continue
        }

        send('status', {
          phase: 'part',
          partNumber: partInfo.part_number,
          totalParts: outline.total_parts,
          message: `Генерирую часть ${partInfo.part_number} из ${outline.total_parts}...`,
        })

        await supabase
          .from('lesson_parts')
          .update({ status: 'generating' })
          .eq('lesson_id', lessonId)
          .eq('part_number', partInfo.part_number)

        const isFirst = partInfo.part_number === 1
        const isLast = partInfo.part_number === outline.total_parts

        const partSystemPrompt = buildPartSystemPrompt(
          lessonContext, outline, partInfo, isFirst, isLast, previousPartEnding, prompts.partPrompt
        )

        let partContent = ''
        const partStream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: partSystemPrompt,
          messages: [{ role: 'user', content: 'Напиши текст этой части занятия.' }],
        })

        partStream.on('text', (text) => {
          partContent += text
          send('chunk', { partNumber: partInfo.part_number, text })
        })

        await partStream.finalMessage()

        await supabase
          .from('lesson_parts')
          .update({ content: partContent, status: 'ready' })
          .eq('lesson_id', lessonId)
          .eq('part_number', partInfo.part_number)

        send('part_done', { partNumber: partInfo.part_number })

        // Ищем иллюстрации асинхронно — не блокируем генерацию следующей части
        ;(async () => {
          try {
            const concepts = await extractImageConcepts(partContent)
            if (concepts.length === 0) return

            const imageResults = await Promise.all(
              concepts.map(c => fetchWikipediaImages(c.wikipedia_title, 1))
            )
            const images = imageResults.flat().slice(0, 2)
            if (images.length === 0) return

            await supabase
              .from('lesson_parts')
              .update({ images })
              .eq('lesson_id', lessonId)
              .eq('part_number', partInfo.part_number)

            send('part_images', { partNumber: partInfo.part_number, images })
          } catch (e) {
            console.warn(`[lesson/generate] images for part ${partInfo.part_number}:`, e)
          }
        })()

        previousPartEnding = partContent.split(/\s+/).slice(-200).join(' ')
      }

      // ── Шаг 3: Генерируем квиз ───────────────────────────────────────────
      send('status', { phase: 'quiz', message: 'Составляю проверочные вопросы...' })

      try {
        const { data: savedParts } = await supabase
          .from('lesson_parts')
          .select('part_number, content')
          .eq('lesson_id', lessonId)
          .order('part_number')

        const fullText = (savedParts ?? []).map(p => p.content ?? '').join('\n\n')

        const quizSystem = `${prompts.quizPrompt}\n\n## Контекст занятия\n\n\`\`\`json\n${JSON.stringify(lessonContext, null, 2)}\n\`\`\``
        const quizMsg = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: quizSystem,
          messages: [{ role: 'user', content: `Текст занятия:\n\n${fullText}\n\nСоставь вопросы.` }],
        })

        const raw = quizMsg.content[0].type === 'text' ? quizMsg.content[0].text : ''
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
        const quizData: QuizData = JSON.parse(jsonStr)

        await supabase.from('lessons').update({ quiz_data: quizData }).eq('id', lessonId)
        send('quiz_ready', { quizData })
      } catch (e) {
        console.warn('[lesson/generate] quiz generation failed:', e)
      }

      send('done', { totalParts: outline.total_parts })
    } catch (err) {
      console.error('[lesson/generate]', err)
      send('error', { message: String(err) })
    } finally {
      close()
    }
  })()

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

function buildPartSystemPrompt(
  ctx: LessonContext,
  outline: OutlineData,
  part: OutlineData['parts'][number],
  isFirst: boolean,
  isLast: boolean,
  previousPartEnding: string,
  partPrompt: string,
): string {
  const contextJson = JSON.stringify({
    disciplineName: ctx.disciplineName,
    topicName: ctx.topicName,
    moduleName: ctx.moduleName,
    lessonName: ctx.lessonName,
    complexity: ctx.complexity,
    depth: ctx.depth,
    lessonOutline: outline.outline,
    totalParts: outline.total_parts,
    currentPart: {
      number: part.part_number,
      title: part.title,
      duration_minutes: part.duration_minutes,
      key_points: part.key_points,
      isFirst,
      isLast,
    },
    ...(previousPartEnding ? { previousPartEnding } : {}),
  }, null, 2)

  return `${partPrompt}\n\n## Контекст\n\n\`\`\`json\n${contextJson}\n\`\`\``
}
