import { createClient } from '@/lib/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ disciplineId: string }> }) {
  const { disciplineId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: discipline, error } = await supabase
    .from('disciplines')
    .select('*')
    .eq('id', disciplineId)
    .eq('user_id', user.id)
    .single()

  if (error || !discipline) return Response.json({ error: 'Not found' }, { status: 404 })

  const { data: topics } = await supabase
    .from('topics')
    .select('*')
    .eq('discipline_id', disciplineId)
    .order('order_idx')

  return Response.json({ ...discipline, topics: topics ?? [] })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ disciplineId: string }> }) {
  const { disciplineId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Обновляем дисциплину (name, description)
  if (body.discipline) {
    const { error } = await supabase
      .from('disciplines')
      .update(body.discipline)
      .eq('id', disciplineId)
      .eq('user_id', user.id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // Обновляем/добавляем/удаляем темы
  if (body.topics) {
    for (const topic of body.topics) {
      if (topic._delete && topic.id) {
        // Удаляем только pending темы (без прогресса)
        await supabase.from('topics').delete()
          .eq('id', topic.id)
          .eq('discipline_id', disciplineId)
        continue
      }
      if (topic.id) {
        // Обновляем существующую тему
        const { id, _delete, ...fields } = topic
        await supabase.from('topics').update(fields)
          .eq('id', id)
          .eq('discipline_id', disciplineId)
      } else {
        // Добавляем новую тему
        await supabase.from('topics').insert({ ...topic, discipline_id: disciplineId })
      }
    }
  }

  return Response.json({ ok: true })
}
