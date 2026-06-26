import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DisciplineClient from './DisciplineClient'
import { type Topic } from '@/types/db'

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

  return { discipline, topics: (topics ?? []) as Topic[] }
}

export default async function DisciplinePage({
  params,
}: {
  params: Promise<{ disciplineId: string }>
}) {
  const { disciplineId } = await params
  const { discipline, topics } = await getData(disciplineId)
  return <DisciplineClient discipline={discipline} topics={topics} />
}
