import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@/lib/supabase/server'

// Увеличиваем таймаут роута до 120 секунд (Next.js default 60s недостаточен для большого JSON)
export const maxDuration = 120

const client = new Anthropic()

const systemPrompt = readFileSync(
  join(process.cwd(), 'src/lib/agents/discipline-agent-prompt.md'),
  'utf-8'
)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { messages } = await request.json()

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
            // клиент отключился — ничего не делаем
          }
        })

        const msg = await stream.finalMessage()

        if (msg.stop_reason === 'max_tokens') {
          controller.enqueue(encoder.encode('\n\n[Ответ обрезан — слишком длинный. Попроси сократить структуру.]'))
        }

        controller.close()
      } catch (err) {
        console.error('[chat/route] error:', err)
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
