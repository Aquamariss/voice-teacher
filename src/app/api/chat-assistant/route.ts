import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@/lib/supabase/server'
import { assembleContext, type PageContext } from '@/lib/context/assembleContext'

export const maxDuration = 120

const client = new Anthropic()

const basePrompt = readFileSync(
  join(process.cwd(), 'src/lib/agents/assistant-prompt.md'),
  'utf-8'
)

interface SaveQuizInput {
  lessonId: string
  level1: Array<{ id: number; question: string; user_answer: string; correct: boolean; feedback: string }>
  level2: Array<{ id: number; question: string; user_answer: string; score: number; feedback: string }>
}

const tools: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description: 'Перейти на страницу приложения',
    input_schema: {
      type: 'object' as const,
      properties: {
        page: {
          type: 'string',
          enum: ['dashboard', 'new_discipline', 'discipline', 'topic'],
          description: 'Куда перейти',
        },
        discipline_id: { type: 'string', description: 'ID дисциплины' },
        topic_id: { type: 'string', description: 'ID темы' },
      },
      required: ['page'],
    },
  },
  {
    name: 'switch_mode',
    description: 'Переключиться в режим редактирования структуры темы. Используй когда пользователь хочет изменить модули или занятия в текущей теме (добавить, убрать, переименовать).',
    input_schema: {
      type: 'object' as const,
      properties: {
        mode: {
          type: 'string',
          enum: ['topic-structure'],
          description: 'Режим — всегда topic-structure',
        },
        topicId: {
          type: 'string',
          description: 'ID темы из pageContext.topicId',
        },
        initialMessage: {
          type: 'string',
          description: 'Точный запрос пользователя — передаётся агенту структуры напрямую',
        },
      },
      required: ['mode', 'topicId'],
    },
  },
  {
    name: 'save_quiz_results',
    description: 'Сохранить результаты пройденного теста в базу данных. Вызывай в том же ответе где поздравляешь пользователя — после ответа на последний вопрос Уровня 2.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lessonId: { type: 'string', description: 'ID занятия из pageContext.lessonId' },
        level1: {
          type: 'array',
          description: 'Ответы на вопросы Уровня 1 (воспроизведение)',
          items: {
            type: 'object',
            properties: {
              id:          { type: 'number' },
              question:    { type: 'string' },
              user_answer: { type: 'string', description: 'Дословный ответ пользователя' },
              correct:     { type: 'boolean' },
              feedback:    { type: 'string', description: 'Твой фидбэк этому ответу' },
            },
            required: ['id', 'question', 'user_answer', 'correct', 'feedback'],
          },
        },
        level2: {
          type: 'array',
          description: 'Ответы на вопросы Уровня 2 (критическое мышление)',
          items: {
            type: 'object',
            properties: {
              id:          { type: 'number' },
              question:    { type: 'string' },
              user_answer: { type: 'string', description: 'Дословный ответ пользователя' },
              score:       { type: 'number', description: '1 (слабо), 2 (хорошо) или 3 (отлично)' },
              feedback:    { type: 'string', description: 'Твой фидбэк этому ответу' },
            },
            required: ['id', 'question', 'user_answer', 'score', 'feedback'],
          },
        },
      },
      required: ['lessonId', 'level1', 'level2'],
    },
  },
]

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { messages, pageContext, voiceMode } = await request.json() as {
    messages: Anthropic.MessageParam[]
    pageContext?: PageContext
    voiceMode?: boolean
  }

  // Собираем контекст ученика
  const ctx = await assembleContext(user.id, pageContext)

  const contextBlock = [
    '## Профиль ученика',
    ctx.learner || 'Нет данных.',
    ctx.discipline ? `\n## Память дисциплины\n${ctx.discipline}` : '',
    pageContext ? `\n## Текущая страница\n${JSON.stringify(pageContext)}` : '',
    ctx.topicStructure ? `\n## Структура текущей темы\n${ctx.topicStructure}` : '',
    ctx.quizContext ? `\n## Проверочные вопросы текущего занятия\n${ctx.quizContext}` : '',
  ].filter(Boolean).join('\n')

  const voiceHint = voiceMode
    ? '\n\n## Голосовой режим\nОтвечай коротко: 1–3 предложения. Без markdown, заголовков, списков и символов форматирования — только живая речь.'
    : ''

  const systemPrompt = `${basePrompt}\n\n${contextBlock}${voiceHint}`

  const encoder = new TextEncoder()

  const body = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch { /* disconnected */ }
      }

      try {
        const stream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          tools,
          messages,
        })

        stream.on('text', (text) => send('text', { text }))

        const msg = await stream.finalMessage()

        // Если агент хочет использовать tool
        if (msg.stop_reason === 'tool_use') {
          const toolUse = msg.content.find(b => b.type === 'tool_use')
          if (toolUse?.type === 'tool_use') {
            if (toolUse.name === 'navigate') {
              send('navigate', toolUse.input)
            } else if (toolUse.name === 'switch_mode') {
              send('switch_mode', toolUse.input)
            } else if (toolUse.name === 'save_quiz_results') {
              const input = toolUse.input as SaveQuizInput
              const results = {
                completed_at: new Date().toISOString(),
                level1_score: input.level1.filter(q => q.correct).length,
                level1_total: input.level1.length,
                level2_score: input.level2.reduce((s, q) => s + (q.score ?? 0), 0),
                level2_total: input.level2.length * 3,
                level1: input.level1,
                level2: input.level2,
              }
              const { error } = await supabase.from('lessons').update({
                status: 'completed',
                quiz_results: results,
              }).eq('id', input.lessonId)
              if (!error) {
                send('quiz_saved', { lessonId: input.lessonId, results })
              } else {
                console.error('[chat-assistant] save_quiz_results DB error:', error)
              }
            }
          }
        }

        send('done', {})
        controller.close()
      } catch (err) {
        console.error('[chat-assistant]', err)
        send('error', { message: String(err) })
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}
