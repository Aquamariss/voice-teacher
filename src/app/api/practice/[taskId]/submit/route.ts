import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { response: userResponse } = await req.json() as { response: string }
  if (!userResponse?.trim()) {
    return NextResponse.json({ error: 'Empty response' }, { status: 400 })
  }

  // Fetch task (verify it belongs to user's discipline)
  const { data: task } = await supabase
    .from('practice_tasks')
    .select('*, disciplines!inner(user_id)')
    .eq('id', taskId)
    .single()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((task as unknown as { disciplines: { user_id: string } }).disciplines.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const evalPrompt = `Ты оцениваешь ответ студента на практическую задачу курса.

## Задача
${task.title}

${task.content}

## Эталонное решение
${task.model_answer}

## Ответ студента
${userResponse}

## Инструкция оценки

Оцени ответ от 0 до 3 баллов:
- 3 — полный, точный ответ; все ключевые аспекты раскрыты; логика верна
- 2 — основные идеи верны, но есть пробелы или неточности
- 1 — частично верно, есть понимание, но существенные пробелы
- 0 — ответ отсутствует, нерелевантен или принципиально неверен

Дай конструктивную обратную связь на русском языке (3–6 предложений):
- что сделано правильно
- что пропущено или неточно
- что было бы идеальным ответом (кратко)

Выведи строго JSON:
{"score": 0-3, "feedback": "..."}`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: evalPrompt }],
  })

  const raw = (message.content[0] as { text: string }).text.trim()
  const jsonMatch = raw.match(/\{[\s\S]+\}/)
  if (!jsonMatch) {
    return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 })
  }

  let evaluation: { score: number; feedback: string }
  try {
    evaluation = JSON.parse(jsonMatch[0])
    evaluation.score = Math.max(0, Math.min(3, Math.round(evaluation.score)))
  } catch {
    return NextResponse.json({ error: 'Invalid evaluation JSON' }, { status: 500 })
  }

  // Delete previous result if exists, then insert new
  await supabase.from('practice_results').delete().eq('task_id', taskId)

  const { data: result } = await supabase
    .from('practice_results')
    .insert({
      task_id: taskId,
      user_response: userResponse,
      score: evaluation.score,
      feedback: evaluation.feedback,
    })
    .select()
    .single()

  return NextResponse.json({ result })
}
