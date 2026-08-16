import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { type Discipline } from '@/types/db'
import NewDisciplineCard from '@/components/NewDisciplineCard'
import VoiceSettings from '@/components/VoiceSettings'

async function getDisciplines(): Promise<Discipline[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('disciplines')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}

const complexityLabel: Record<string, string> = {
  easy: 'Лёгкая',
  medium: 'Средняя',
  hard: 'Сложная',
}

export default async function DashboardPage() {
  const disciplines = await getDisciplines()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Мои дисциплины</h1>
      <p className="text-gray-500 text-sm mb-8">
        {disciplines.length === 0
          ? 'Создайте первую дисциплину чтобы начать обучение'
          : 'Выберите дисциплину или создайте новую'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {disciplines.map(d => (
          <Link
            key={d.id}
            href={`/dashboard/${d.id}`}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
          >
            <h2 className="font-medium text-gray-900 group-hover:text-blue-700 transition-colors mb-1">
              {d.name}
            </h2>
            {d.description && (
              <p className="text-sm text-gray-500 line-clamp-2">{d.description}</p>
            )}
            <p className="text-xs text-gray-400 mt-3">
              {new Date(d.created_at).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
              })}
            </p>
          </Link>
        ))}

        <NewDisciplineCard />
      </div>

      <VoiceSettings />
    </div>
  )
}
