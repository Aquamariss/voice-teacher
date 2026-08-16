import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 120

const client = new Anthropic()

const basePrompt = readFileSync(
  join(process.cwd(), 'src/lib/agents/topic-structure-agent-prompt.md'),
  'utf-8'
)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // topicContext: { disciplineName, topicName, complexity, depth, lesson_duration_minutes }
  // existingStructure: [{ name, lessons: [{ name, description }] }] — если тема уже имеет структуру
  const { messages, topicContext, existingStructure } = await request.json()

  let systemPrompt = basePrompt
  if (topicContext) {
    systemPrompt += `\n\n## Данные темы\n\n\`\`\`json\n${JSON.stringify(topicContext, null, 2)}\n\`\`\``
  }
  if (existingStructure?.length) {
    systemPrompt += `\n\n## Текущая структура темы\n\nПользователь редактирует уже существующую структуру. Работай именно с ней — не придумывай новую. Текущие модули и занятия:\n\n\`\`\`json\n${JSON.stringify(existingStructure, null, 2)}\n\`\`\``
  }

  const encoder = new TextEncoder()

  const body = new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        })

        stream.on('text', (text) => {
          try { controller.enqueue(encoder.encode(text)) } catch { /* disconnected */ }
        })

        const msg = await stream.finalMessage()
        if (msg.stop_reason === 'max_tokens') {
          controller.enqueue(encoder.encode('\n\n[Ответ обрезан. Попроси сократить структуру.]'))
        }
        controller.close()
      } catch (err) {
        console.error('[chat-topic] error:', err)
        try { controller.error(err) } catch { /* already closed */ }
      }
    },
  })

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
