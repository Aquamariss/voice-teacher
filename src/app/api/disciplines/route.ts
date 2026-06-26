import { createClient } from '@/lib/supabase/server'
import { type AgentStructure } from '@/types/db'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const structure: AgentStructure = await request.json()

  // 1. Создаём дисциплину
  const { data: discipline, error: dErr } = await supabase
    .from('disciplines')
    .insert({
      user_id: user.id,
      name: structure.discipline.name,
      description: structure.discipline.description,
    })
    .select('id')
    .single()

  if (dErr || !discipline) {
    return Response.json({ error: dErr?.message }, { status: 500 })
  }

  // 2. Создаём темы, модули, занятия
  for (const topic of structure.topics) {
    const { data: topicRow, error: tErr } = await supabase
      .from('topics')
      .insert({
        discipline_id: discipline.id,
        name: topic.name,
        description: topic.description,
        order_idx: topic.order,
        complexity: topic.complexity,
        depth: topic.depth,
        lesson_duration_minutes: topic.lesson_duration_minutes,
      })
      .select('id')
      .single()

    if (tErr || !topicRow) continue

    for (const mod of topic.modules) {
      const { data: moduleRow, error: mErr } = await supabase
        .from('modules')
        .insert({
          topic_id: topicRow.id,
          name: mod.name,
          order_idx: mod.order,
        })
        .select('id')
        .single()

      if (mErr || !moduleRow) continue

      const lessonsToInsert = mod.lessons.map(l => ({
        module_id: moduleRow.id,
        name: l.name,
        description: l.description,
        order_idx: l.order,
      }))

      await supabase.from('lessons').insert(lessonsToInsert)
    }
  }

  return Response.json({ id: discipline.id })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('disciplines')
    .select('id, name, description, created_at')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data)
}
