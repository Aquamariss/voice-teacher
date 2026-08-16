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

  return {
    discipline,
    topics: (topics ?? []) as Topic[],
    practiceTasks: tasksWithResults,
  }
}

export default async function DisciplinePage({
  params,
}: {
  params: Promise<{ disciplineId: string }>
}) {
  const { disciplineId } = await params
  const { discipline, topics, practiceTasks } = await getData(disciplineId)
  return (
    <DisciplineClient
      discipline={discipline}
      topics={topics}
      practiceTasks={practiceTasks}
    />
  )
}
