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
          if (toolUse && toolUse.type === 'tool_use' && toolUse.name === 'navigate') {
            send('navigate', toolUse.input)
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
