'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { type Discipline, type Topic, type Complexity, type Depth, type PracticeTaskWithResult } from '@/types/db'
import PracticeModule from '@/components/PracticeModule'

const complexityOptions: { value: Complexity; label: string }[] = [
  { value: 'easy', label: 'Лёгкая' },
  { value: 'medium', label: 'Средняя' },
  { value: 'hard', label: 'Сложная' },
]

const depthOptions: { value: Depth; label: string }[] = [
  { value: 'surface', label: 'Поверхностная' },
  { value: 'medium', label: 'Средняя' },
  { value: 'deep', label: 'Глубокая' },
]

const complexityColor: Record<Complexity, string> = {
  easy: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  hard: 'bg-red-100 text-red-700',
}

const depthColor: Record<Depth, string> = {
  surface: 'bg-blue-50 text-blue-600',
  medium: 'bg-blue-100 text-blue-700',
  deep: 'bg-blue-200 text-blue-800',
}

type EditableField = 'name' | 'complexity' | 'depth' | 'duration' | null

interface EditState {
  topicId: string
  field: EditableField
}

export default function DisciplineClient({
  discipline,
  topics: initialTopics,
  practiceTasks,
  progress,
}: {
  discipline: Discipline
  topics: Topic[]
  practiceTasks: PracticeTaskWithResult[]
  progress: Record<string, { total: number; completed: number }>
}) {
  const router = useRouter()
  const [topics, setTopics] = useState<Topic[]>(initialTopics)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [editDisciplineName, setEditDisciplineName] = useState(false)
  const [disciplineName, setDisciplineName] = useState(discipline.name)

  async function saveTopic(topic: Topic) {
    setSaving(topic.id)
    try {
      await fetch(`/api/disciplines/${discipline.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics: [{ id: topic.id, name: topic.name, complexity: topic.complexity, depth: topic.depth, lesson_duration_minutes: topic.lesson_duration_minutes }] }),
      })
    } finally {
      setSaving(null)
      setEditing(null)
    }
  }

  async function saveDisciplineName() {
    if (disciplineName.trim() === discipline.name) { setEditDisciplineName(false); return }
    await fetch(`/api/disciplines/${discipline.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discipline: { name: disciplineName.trim() } }),
    })
    setEditDisciplineName(false)
    router.refresh()
  }

  async function deleteTopic(topicId: string) {
    if (!confirm('Удалить тему?')) return
    await fetch(`/api/disciplines/${discipline.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topics: [{ id: topicId, _delete: true }] }),
    })
    setTopics(prev => prev.filter(t => t.id !== topicId))
  }

  function updateTopicLocal(id: string, field: keyof Topic, value: unknown) {
    setTopics(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }

  const isEditing = (topicId: string, field: EditableField) =>
    editing?.topicId === topicId && editing?.field === field

  const allTopicsCompleted = topics.length > 0 && topics.every(t => t.status === 'completed')

  return (
    <div>
      {/* Заголовок */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 mb-1 inline-block">
            ← Все дисциплины
          </Link>
          {editDisciplineName ? (
            <input
              autoFocus
              value={disciplineName}
              onChange={e => setDisciplineName(e.target.value)}
              onBlur={saveDisciplineName}
              onKeyDown={e => e.key === 'Enter' && saveDisciplineName()}
              className="text-2xl font-semibold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent w-full"
            />
          ) : (
            <h1
              className="text-2xl font-semibold text-gray-900 cursor-pointer hover:text-blue-700 transition-colors"
              title="Нажми чтобы переименовать"
              onClick={() => setEditDisciplineName(true)}
            >
              {disciplineName}
            </h1>
          )}
          <p className="text-sm text-gray-400 mt-1">{topics.length} тем</p>
        </div>
        <Link
          href={`/dashboard/${discipline.id}/edit`}
          className="flex items-center gap-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors"
        >
          ✦ Редактировать с агентом
        </Link>
      </div>

      {/* Таблица тем */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 w-8">#</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">
                <span className="block">Тема</span>
                <span className="block font-normal text-gray-400">Сложность / глубина / длительность</span>
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 w-16">Статус</th>
              <th className="w-8 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic, i) => {
              const completed = topic.status === 'completed'
              const canEdit = !completed

              return (
                <tr
                  key={topic.id}
                  className={`border-b border-gray-50 last:border-0 group ${completed ? 'opacity-60' : 'hover:bg-gray-50/50'}`}
                >
                  {/* # */}
                  <td className="px-4 py-3 text-gray-400">{i + 1}</td>

                  {/* Название + параметры */}
                  <td className="px-4 py-3">
                    {isEditing(topic.id, 'name') ? (
                      <input
                        autoFocus
                        value={topic.name}
                        onChange={e => updateTopicLocal(topic.id, 'name', e.target.value)}
                        onBlur={() => saveTopic(topic)}
                        onKeyDown={e => e.key === 'Enter' && saveTopic(topic)}
                        className="w-full border-b border-blue-400 outline-none bg-transparent text-gray-900"
                      />
                    ) : (
                      <span className="flex items-center gap-1">
                        <Link
                          href={`/dashboard/${discipline.id}/topics/${topic.id}`}
                          className="font-medium text-gray-800 hover:text-blue-700 transition-colors"
                        >
                          {topic.name}
                          {saving === topic.id && <span className="ml-1 text-gray-300 text-xs">сохр...</span>}
                        </Link>
                        {canEdit && (
                          <button
                            onClick={() => setEditing({ topicId: topic.id, field: 'name' })}
                            className="text-gray-300 hover:text-gray-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Переименовать"
                          >
                            ✎
                          </button>
                        )}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {isEditing(topic.id, 'complexity') ? (
                        <select
                          autoFocus
                          value={topic.complexity}
                          onChange={e => {
                            const updated = { ...topic, complexity: e.target.value as Complexity }
                            setTopics(prev => prev.map(t => t.id === updated.id ? updated : t))
                            saveTopic(updated)
                          }}
                          className="border border-gray-200 rounded px-1 py-0.5 text-xs outline-none"
                        >
                          {complexityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium ${complexityColor[topic.complexity]} ${canEdit ? 'cursor-pointer' : ''}`}
                          onClick={() => canEdit && setEditing({ topicId: topic.id, field: 'complexity' })}
                        >
                          {complexityOptions.find(o => o.value === topic.complexity)?.label}
                        </span>
                      )}
                      <span className="text-gray-300 text-xs">/</span>
                      {isEditing(topic.id, 'depth') ? (
                        <select
                          autoFocus
                          value={topic.depth}
                          onChange={e => {
                            const updated = { ...topic, depth: e.target.value as Depth }
                            setTopics(prev => prev.map(t => t.id === updated.id ? updated : t))
                            saveTopic(updated)
                          }}
                          className="border border-gray-200 rounded px-1 py-0.5 text-xs outline-none"
                        >
                          {depthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium ${depthColor[topic.depth]} ${canEdit ? 'cursor-pointer' : ''}`}
                          onClick={() => canEdit && setEditing({ topicId: topic.id, field: 'depth' })}
                        >
                          {depthOptions.find(o => o.value === topic.depth)?.label}
                        </span>
                      )}
                      <span className="text-gray-300 text-xs">/</span>
                      {isEditing(topic.id, 'duration') ? (
                        <input
                          autoFocus
                          type="number"
                          min={5}
                          max={120}
                          value={topic.lesson_duration_minutes}
                          onChange={e => updateTopicLocal(topic.id, 'lesson_duration_minutes', Number(e.target.value))}
                          onBlur={() => saveTopic(topic)}
                          onKeyDown={e => e.key === 'Enter' && saveTopic(topic)}
                          className="w-14 border-b border-blue-400 outline-none bg-transparent text-center text-xs"
                        />
                      ) : (
                        <span
                          className={`text-xs text-gray-400 ${canEdit ? 'cursor-pointer hover:text-blue-600' : ''}`}
                          onClick={() => canEdit && setEditing({ topicId: topic.id, field: 'duration' })}
                        >
                          {topic.lesson_duration_minutes} мин
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Статус */}
                  <td className="px-4 py-3">
                    {(() => {
                      const p = progress[topic.id]
                      if (!p || p.total === 0) return <span className="text-xs text-gray-400">—</span>
                      if (p.completed === p.total)
                        return <span className="text-xs font-medium text-green-600">✓ {p.completed}/{p.total}</span>
                      if (p.completed > 0)
                        return <span className="text-xs font-medium text-blue-600">{p.completed}/{p.total}</span>
                      return <span className="text-xs text-gray-400">0/{p.total}</span>
                    })()}
                  </td>

                  {/* Удалить */}
                  <td className="px-2">
                    {canEdit && topic.status === 'pending' && (
                      <button
                        onClick={() => deleteTopic(topic.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none"
                        title="Удалить тему"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>

        {topics.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            Нет тем. Добавь через агента.
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Нажми на параметр темы — чтобы изменить. Завершённые темы не редактируются.
      </p>

      <PracticeModule
        disciplineId={discipline.id}
        allTopicsCompleted={allTopicsCompleted}
        initialTasks={practiceTasks}
      />
    </div>
  )
}
