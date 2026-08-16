import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { fetchWikipediaImages } from '@/lib/wikipedia'

const anthropic = new Anthropic()

function loadPrompt() {
  return readFileSync(
    join(process.cwd(), 'src/lib/agents/practice-task-prompt.md'),
    'utf-8'
  ).replace(/^---[\s\S]+?---\n/, '').trim()
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ disciplineId: string }> }
) {
  const { disciplineId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify discipline belongs to user
  const { data: discipline } = await supabase
    .from('disciplines')
    .select('id, name')
    .eq('id', disciplineId)
    .eq('user_id', user.id)
    .single()
  if (!discipline) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch topics
  const { data: topics } = await supabase
    .from('topics')
    .select('id, name, complexity, depth')
    .eq('discipline_id', disciplineId)
    .order('order_idx')

  if (!topics?.length) {
    return NextResponse.json({ error: 'No topics' }, { status: 400 })
  }

  // Fetch lesson content samples + check for formulas
  const topicIds = topics.map(t => t.id)
  const { data: modules } = await supabase
    .from('modules')
    .select('id')
    .in('topic_id', topicIds)

  const moduleIds = (modules ?? []).map(m => m.id)
  let contentSamples: string[] = []
  let hasFormulas = false

  if (moduleIds.length > 0) {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, name')
      .in('module_id', moduleIds)

    const lessonIds = (lessons ?? []).map(l => l.id)

    if (lessonIds.length > 0) {
      const { data: parts } = await supabase
        .from('lesson_parts')
        .select('content')
        .in('lesson_id', lessonIds)
        .not('content', 'is', null)
        .limit(12)

      for (const part of parts ?? []) {
        if (!part.content) continue
        contentSamples.push(part.content.slice(0, 400))
        if (/\$[^$]+\$|\$\$/.test(part.content)) hasFormulas = true
      }
    }
  }

  const complexity = topics[0]?.complexity ?? 'medium'
  const topicsSummary = topics.map((t, i) => `${i + 1}. ${t.name}`).join('\n')
  const contentSample = contentSamples.slice(0, 6).join('\n\n---\n\n')

  const promptTemplate = loadPrompt()
  const prompt = promptTemplate
    .replace('$discipline_name', discipline.name)
    .replace('$topics_summary', topicsSummary)
    .replace('$content_sample', contentSample || '(нет контента)')
    .replace('$complexity', complexity)
    .replace('$has_formulas', String(hasFormulas))

  // Generate tasks with Claude
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = (message.content[0] as { text: string }).text.trim()
  const jsonMatch = raw.match(/\{[\s\S]+\}/)
  if (!jsonMatch) {
    return NextResponse.json({ error: 'Failed to parse tasks' }, { status: 500 })
  }

  let parsed: { tasks: Array<{
    task_number: number
    title: string
    content: string
    task_type: string
    model_answer: string
    image_query: string
  }> }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({ error: 'Invalid JSON from model' }, { status: 500 })
  }

  // Delete existing tasks for this discipline
  await supabase.from('practice_tasks').delete().eq('discipline_id', disciplineId)

  // Fetch images and save tasks
  const savedTasks = []
  for (const task of parsed.tasks) {
    const images = await fetchWikipediaImages(task.image_query, 1).catch(() => [])
    const img = images[0] ?? null

    const { data: saved, error } = await supabase
      .from('practice_tasks')
      .insert({
        discipline_id: disciplineId,
        task_number: task.task_number,
        title: task.title,
        content: task.content,
        task_type: task.task_type,
        model_answer: task.model_answer,
        image_url: img?.thumbnail_url ?? null,
        image_attribution: img ? `${img.author} · ${img.license} · ${img.source_page_url}` : null,
      })
      .select()
      .single()

    if (saved) savedTasks.push({ ...saved, result: null })
  }

  return NextResponse.json({ tasks: savedTasks })
}
