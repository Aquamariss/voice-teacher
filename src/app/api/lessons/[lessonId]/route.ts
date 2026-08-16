import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: lesson } = await supabase
    .from('lessons')
    .select('id, module:modules!inner(topic:topics!inner(discipline:disciplines!inner(user_id)))')
    .eq('id', lessonId)
    .single()

  if (!lesson) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json() as { status?: string; quiz_results?: unknown }
  const update: Record<string, unknown> = {}

  if (body.status !== undefined) {
    const allowed = ['pending', 'in_progress', 'completed']
    if (!allowed.includes(body.status)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 })
    }
    update.status = body.status
  }

  if (body.quiz_results !== undefined) {
    update.quiz_results = body.quiz_results
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  await supabase.from('lessons').update(update).eq('id', lessonId)
  return Response.json({ ok: true })
}
