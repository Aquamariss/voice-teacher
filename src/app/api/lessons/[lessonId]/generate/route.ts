import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300 // 5 минут — для многочастных занятий

const client = new Anthropic()

const outlinePrompt = readFileSync(
  join(process.cwd(), 'src/lib/agents/lesson-outline-prompt.md'),
  'utf-8'
)
const partPrompt = readFileSync(
  join(process.cwd(), 'src/lib/agents/lesson-part-prompt.md'),
  'utf-8'
)

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
async function generateOutline(lessonContext: LessonContext): Promise<OutlineData> {
  const system = `${outlinePrompt}\n\n## Контекст занятия\n\n\`\`\`json\n${JSON.stringify(lessonContext, null, 2)}\n\`\`\``

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: 'Составь план занятия.' }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  // Убираем возможную markdown-обёртку
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

  // Проверяем доступ через цепочку lesson → module → topic → discipline → user
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

  // Собираем контекст
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

  const { stream, send, close } = makeEventStream()

  // Запускаем генерацию в фоне
  ;(async () => {
    try {
      // ── Шаг 1: Генерируем outline ──────────────────────────────────────
      send('status', { phase: 'outline', message: 'Составляю план занятия...' })

      let outline: OutlineData
      try {
        outline = await generateOutline(lessonContext)
      } catch (e) {
        send('error', { message: 'Не удалось составить план занятия.' })
        close()
        return
      }

      // Сохраняем outline в lesson
      await supabase
        .from('lessons')
        .update({ content_outline: outline.outline })
        .eq('id', lessonId)

      // Создаём строки для каждой части
      await supabase.from('lesson_parts').delete().eq('lesson_id', lessonId)
      await supabase.from('lesson_parts').insert(
        outline.parts.map(p => ({
          lesson_id: lessonId,
          part_number: p.part_number,
          status: 'pending',
        }))
      )

      send('outline', { outline, totalParts: outline.total_parts })

      // ── Шаг 2: Генерируем каждую часть ──────────────────────────────────
      let previousPartEnding = ''

      for (const partInfo of outline.parts) {
        send('status', {
          phase: 'part',
          partNumber: partInfo.part_number,
          totalParts: outline.total_parts,
          message: `Генерирую часть ${partInfo.part_number} из ${outline.total_parts}...`,
        })

        // Помечаем как generating
        await supabase
          .from('lesson_parts')
          .update({ status: 'generating' })
          .eq('lesson_id', lessonId)
          .eq('part_number', partInfo.part_number)

        const isFirst = partInfo.part_number === 1
        const isLast = partInfo.part_number === outline.total_parts

        const partSystemPrompt = buildPartSystemPrompt(
          lessonContext,
          outline,
          partInfo,
          isFirst,
          isLast,
          previousPartEnding
        )

        // Стриминг части
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

        // Сохраняем часть
        await supabase
          .from('lesson_parts')
          .update({ content: partContent, status: 'ready' })
          .eq('lesson_id', lessonId)
          .eq('part_number', partInfo.part_number)

        send('part_done', { partNumber: partInfo.part_number })

        // Берём последние ~200 слов для плавного перехода
        const words = partContent.split(/\s+/)
        previousPartEnding = words.slice(-200).join(' ')
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
  previousPartEnding: string
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
