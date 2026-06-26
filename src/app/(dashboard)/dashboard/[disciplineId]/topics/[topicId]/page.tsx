import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TopicClient from './TopicClient'
import { type Topic, type ModuleWithLessons, type LessonWithParts, type LessonPart } from '@/types/db'

async function getData(disciplineId: string, topicId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: discipline } = await supabase
    .from('disciplines')
    .select('id, name')
    .eq('id', disciplineId)
    .eq('user_id', user.id)
    .single()

  if (!discipline) notFound()

  const { data: topic } = await supabase
    .from('topics')
    .select('*')
    .eq('id', topicId)
    .eq('discipline_id', disciplineId)
    .single()

  if (!topic) notFound()

  const { data: modules } = await supabase
    .from('modules')
    .select('*')
    .eq('topic_id', topicId)
    .order('order_idx')

  const moduleIds = (modules ?? []).map((m: { id: string }) => m.id)

  let lessons: LessonWithParts[] = []
  if (moduleIds.length > 0) {
    const { data: rawLessons } = await supabase
      .from('lessons')
      .select('*')
      .in('module_id', moduleIds)
      .order('order_idx')

    const lessonIds = (rawLessons ?? []).map((l: { id: string }) => l.id)

    let parts: LessonPart[] = []
    if (lessonIds.length > 0) {
      const { data: rawParts } = await supabase
        .from('lesson_parts')
        .select('*')
        .in('lesson_id', lessonIds)
        .order('part_number')
      parts = (rawParts ?? []) as LessonPart[]
    }

    lessons = (rawLessons ?? []).map((l: LessonWithParts) => ({
      ...l,
      parts: parts.filter(p => p.lesson_id === l.id),
    }))
  }

  const modulesWithLessons: ModuleWithLessons[] = (modules ?? []).map((m: { id: string; topic_id: string; name: string; order_idx: number; created_at: string }) => ({
    ...m,
    lessons: lessons.filter(l => l.module_id === m.id),
  }))

  return { discipline, topic: topic as Topic, modules: modulesWithLessons }
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ disciplineId: string; topicId: string }>
}) {
  const { disciplineId, topicId } = await params
  const { discipline, topic, modules } = await getData(disciplineId, topicId)

  return (
    <TopicClient
      discipline={discipline}
      topic={topic}
      initialModules={modules}
    />
  )
}
