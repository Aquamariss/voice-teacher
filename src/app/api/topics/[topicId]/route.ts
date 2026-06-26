import { createClient } from '@/lib/supabase/server'

// GET /api/topics/[topicId] — topic + modules + lessons
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Проверяем что тема принадлежит пользователю через discipline
  const { data: topic } = await supabase
    .from('topics')
    .select('*, discipline:disciplines!inner(user_id)')
    .eq('id', topicId)
    .eq('disciplines.user_id', user.id)
    .single()

  if (!topic) return Response.json({ error: 'Not found' }, { status: 404 })

  const { data: modules } = await supabase
    .from('modules')
    .select('*')
    .eq('topic_id', topicId)
    .order('order_idx')

  const moduleIds = (modules ?? []).map(m => m.id)

  let lessons: unknown[] = []
  if (moduleIds.length > 0) {
    const { data } = await supabase
      .from('lessons')
      .select('*')
      .in('module_id', moduleIds)
      .order('order_idx')
    lessons = data ?? []
  }

  return Response.json({ topic, modules: modules ?? [], lessons })
}

// PATCH /api/topics/[topicId] — сохранить/обновить структуру
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { topicId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Проверяем право доступа
  const { data: topic } = await supabase
    .from('topics')
    .select('id, discipline:disciplines!inner(user_id)')
    .eq('id', topicId)
    .eq('disciplines.user_id', user.id)
    .single()

  if (!topic) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()

  // Обновить поля самой темы (name, complexity, depth, lesson_duration_minutes)
  if (body.topic) {
    await supabase.from('topics').update(body.topic).eq('id', topicId)
  }

  // Полная замена структуры (modules + lessons) — используется при первом сохранении от агента
  if (body.replace_structure) {
    // Удаляем старые модули (lessons удалятся каскадно если настроен FK)
    // Если cascade не настроен — удаляем явно
    const { data: oldModules } = await supabase
      .from('modules')
      .select('id')
      .eq('topic_id', topicId)

    if (oldModules && oldModules.length > 0) {
      const oldIds = oldModules.map(m => m.id)
      await supabase.from('lessons').delete().in('module_id', oldIds)
      await supabase.from('modules').delete().eq('topic_id', topicId)
    }

    // Вставляем новые модули и занятия
    for (const mod of body.replace_structure.modules ?? []) {
      const { data: insertedModule } = await supabase
        .from('modules')
        .insert({ topic_id: topicId, name: mod.name, order_idx: mod.order })
        .select()
        .single()

      if (insertedModule && mod.lessons) {
        for (const lesson of mod.lessons) {
          await supabase.from('lessons').insert({
            module_id: insertedModule.id,
            name: lesson.name,
            description: lesson.description ?? null,
            order_idx: lesson.order,
            status: 'pending',
          })
        }
      }
    }
  }

  // Точечные обновления отдельных уроков (inline редактирование)
  if (body.lessons) {
    for (const lesson of body.lessons) {
      if (lesson._delete && lesson.id) {
        await supabase.from('lessons').delete().eq('id', lesson.id)
        continue
      }
      if (lesson.id) {
        const { id, _delete, ...fields } = lesson
        await supabase.from('lessons').update(fields).eq('id', id)
      }
    }
  }

  // Точечные обновления модулей
  if (body.modules) {
    for (const mod of body.modules) {
      if (mod._delete && mod.id) {
        const { data: modLessons } = await supabase
          .from('lessons').select('id').eq('module_id', mod.id)
        if (modLessons?.length) {
          await supabase.from('lessons').delete().in('id', modLessons.map(l => l.id))
        }
        await supabase.from('modules').delete().eq('id', mod.id)
        continue
      }
      if (mod.id) {
        const { id, _delete, ...fields } = mod
        await supabase.from('modules').update(fields).eq('id', id)
      }
    }
  }

  return Response.json({ ok: true })
}
