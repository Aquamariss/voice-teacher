import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 120

const client = new Anthropic()

const basePrompt = readFileSync(
  join(process.cwd(), 'src/lib/agents/discipline-edit-agent-prompt.md'),
  'utf-8'
)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // disciplineContext содержит JSON текущей структуры (discipline + topics)
  const { messages, disciplineContext } = await request.json()

  const systemPrompt = disciplineContext
    ? `${basePrompt}\n\n## Текущая структура\n\n\`\`\`json\n${JSON.stringify(disciplineContext, null, 2)}\n\`\`\``
    : basePrompt

  const encoder = new TextEncoder()

  const body = new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: systemPrompt,
          messages,
        })

        stream.on('text', (text) => {
          try {
            controller.enqueue(encoder.encode(text))
          } catch {
            // клиент отключился
          }
        })

        const msg = await stream.finalMessage()

        if (msg.stop_reason === 'max_tokens') {
          controller.enqueue(encoder.encode('\n\n[Ответ обрезан. Попроси сократить.]'))
        }

        controller.close()
      } catch (err) {
        console.error('[chat-edit/route] error:', err)
        try {
          controller.error(err)
        } catch {
          // контроллер уже закрыт
        }
      }
    },
  })

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
