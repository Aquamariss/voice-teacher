import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DisciplineClient from './DisciplineClient'
import { type Topic, type PracticeTaskWithResult } from '@/types/db'

async function getData(disciplineId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: discipline } = await supabase
    .from('disciplines')
    .select('*')
    .eq('id', disciplineId)
    .eq('user_id', user.id)
    .single()

  if (!discipline) notFound()

  const { data: topics } = await supabase
    .from('topics')
    .select('*')
    .eq('discipline_id', disciplineId)
    .order('order_idx')

  // Fetch practice tasks with their latest results
  const { data: practiceTasks } = await supabase
    .from('practice_tasks')
    .select('*, practice_results(*)')
    .eq('discipline_id', disciplineId)
    .order('task_number')

  const tasksWithResults: PracticeTaskWithResult[] = (practiceTasks ?? []).map(t => {
    const results = (t.practice_results ?? []) as import('@/types/db').PracticeResult[]
    const latest = results.sort((a, b) =>
      new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    )[0] ?? null
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { practice_results: _, ...task } = t
    return { ...task, result: latest }
  })

  // Build lesson progress per topic: topicId → { total, completed }
  const topicIds = (topics ?? []).map(t => t.id)
  const progress: Record<string, { total: number; completed: number }> = {}
  for (const id of topicIds) progress[id] = { total: 0, completed: 0 }

  if (topicIds.length > 0) {
    const { data: modules } = await supabase
      .from('modules')
      .select('id, topic_id')
      .in('topic_id', topicIds)

    const moduleIds = (modules ?? []).map(m => m.id)
    const moduleToTopic = Object.fromEntries((modules ?? []).map(m => [m.id, m.topic_id]))

    if (moduleIds.length > 0) {
      const { data: lessons } = await supabase
        .from('lessons')
        .select('module_id, status')
        .in('module_id', moduleIds)

      for (const lesson of lessons ?? []) {
        const topicId = moduleToTopic[lesson.module_id]
        if (!topicId) continue
        progress[topicId].total++
        if (lesson.status === 'completed') progress[topicId].completed++
      }
    }
  }

  return {
    discipline,
    topics: (topics ?? []) as Topic[],
    practiceTasks: tasksWithResults,
    progress,
  }
}

export default async function DisciplinePage({
  params,
}: {
  params: Promise<{ disciplineId: string }>
}) {
  const { disciplineId } = await params
  const { discipline, topics, practiceTasks, progress } = await getData(disciplineId)
  return (
    <DisciplineClient
      discipline={discipline}
      topics={topics}
      practiceTasks={practiceTasks}
      progress={progress}
    />
  )
}
