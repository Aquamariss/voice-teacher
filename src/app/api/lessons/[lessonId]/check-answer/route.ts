import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const client = new Anthropic()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { question, answer, correctAnswer, keyPoints, level } = await request.json() as {
    question: string
    answer: string
    correctAnswer?: string
    keyPoints?: string[]
    level: 1 | 2
  }

  if (!question || !answer) return Response.json({ error: 'Missing fields' }, { status: 400 })

  let prompt: string
  if (level === 1) {
    prompt = `Вопрос: «${question}»\nПравильный ответ: «${correctAnswer}»\nОтвет ученика: «${answer}»\n\nОцени ответ ученика. Ответ засчитывается как верный, если ученик передал ключевую суть, пусть и другими словами. Точное совпадение не требуется.\n\nОтветь ТОЛЬКО JSON: {"correct": true/false, "feedback": "одно предложение на языке вопроса — если верно: краткое подтверждение; если неверно: краткое объяснение правильного ответа"}`
  } else {
    const kp = (keyPoints ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n')
    prompt = `Вопрос: «${question}»\nКлючевые идеи хорошего ответа:\n${kp}\n\nОтвет ученика: «${answer}»\n\nОцени глубину понимания. Не требуй точных формулировок — оценивай суть.\n\nОтветь ТОЛЬКО JSON: {"score": 1/2/3, "feedback": "2–3 предложения на языке вопроса: что понял верно, что упустил или можно глубже"}`
  }

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    const result = JSON.parse(clean)
    return Response.json(result)
  } catch (err) {
    console.error('[check-answer]', err)
    return Response.json({ error: 'Check failed' }, { status: 500 })
  }
}
