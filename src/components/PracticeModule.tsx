'use client'

import { useState } from 'react'
import type { PracticeTaskWithResult, PracticeResult } from '@/types/db'

const SCORE_COLORS = [
  'bg-red-50 text-red-700',
  'bg-orange-50 text-orange-700',
  'bg-yellow-50 text-yellow-700',
  'bg-green-50 text-green-700',
]
const SCORE_LABELS = ['Не зачтено', 'Слабо', 'Хорошо', 'Отлично']

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${SCORE_COLORS[score]}`}>
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className={i < score ? 'opacity-100' : 'opacity-20'}>★</span>
      ))}
      {SCORE_LABELS[score]}
    </span>
  )
}

function TaskCard({
  task,
  index,
  onResult,
}: {
  task: PracticeTaskWithResult
  index: number
  onResult: (taskId: string, result: PracticeResult | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [response, setResponse] = useState(task.result?.user_response ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [localResult, setLocalResult] = useState<PracticeResult | null>(task.result)

  async function handleSubmit() {
    if (!response.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/practice/${task.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setLocalResult(data.result)
      onResult(task.id, data.result)
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  function handleRetry() {
    setLocalResult(null)
    setResponse('')
    onResult(task.id, null)
  }

  const hasResult = !!localResult

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-50/70 transition-colors"
      >
        <span className={`flex-shrink-0 w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5 ${hasResult ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
          {hasResult ? '✓' : index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
          {hasResult && (
            <div className="mt-1.5">
              <ScoreBadge score={localResult!.score} />
            </div>
          )}
        </div>
        <span className="text-gray-300 text-xs mt-1">{open ? '▲' : '▼'}</span>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="bg-white">
          {/* Thematic image */}
          {task.image_url && (
            <div className="bg-gray-50 flex justify-center px-5 py-4 border-y border-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={task.image_url}
                alt={task.title}
                className="max-h-44 max-w-full object-contain rounded opacity-80"
              />
            </div>
          )}

          <div className="px-5 py-4 space-y-4">
            {/* Task statement */}
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {task.content}
            </div>

            {/* Answer section */}
            {!hasResult ? (
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ваше решение</p>
                <textarea
                  value={response}
                  onChange={e => setResponse(e.target.value)}
                  placeholder="Опишите ваш анализ и решение задачи..."
                  rows={6}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 placeholder-gray-300 resize-y focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition"
                />
                <button
                  onClick={handleSubmit}
                  disabled={!response.trim() || submitting}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Проверяем...' : 'Проверить решение'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Submitted answer */}
                <div className="bg-gray-50 rounded-lg px-4 py-3">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Ваш ответ</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{localResult!.user_response}</p>
                </div>

                {/* Feedback */}
                <div className={`rounded-lg px-4 py-3 ${localResult!.score >= 2 ? 'bg-green-50' : localResult!.score === 1 ? 'bg-yellow-50' : 'bg-red-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Оценка</p>
                    <ScoreBadge score={localResult!.score} />
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{localResult!.feedback}</p>
                </div>

                <button
                  onClick={handleRetry}
                  className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                >
                  ↩ Попробовать снова
                </button>
              </div>
            )}

            {/* Image attribution */}
            {task.image_url && task.image_attribution && (
              <p className="text-xs text-gray-300">{task.image_attribution}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PracticeModule({
  disciplineId,
  allTopicsCompleted,
  initialTasks,
}: {
  disciplineId: string
  allTopicsCompleted: boolean
  initialTasks: PracticeTaskWithResult[]
}) {
  const [tasks, setTasks] = useState<PracticeTaskWithResult[]>(initialTasks)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasTasks = tasks.length > 0
  const completedCount = tasks.filter(t => t.result).length
  const totalScore = tasks.reduce((s, t) => s + (t.result?.score ?? 0), 0)
  const maxScore = tasks.length * 3

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/disciplines/${disciplineId}/practice/generate`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка генерации')
      setTasks(data.tasks)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setGenerating(false)
    }
  }

  function handleResult(taskId: string, result: PracticeResult | null) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, result } : t))
  }

  return (
    <div className="mt-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-gray-900">Практический модуль</span>
          {hasTasks && completedCount > 0 && (
            <span className="text-xs text-gray-400">
              {completedCount}/{tasks.length} выполнено · {totalScore}/{maxScore} баллов
            </span>
          )}
        </div>
        {allTopicsCompleted && hasTasks && !generating && (
          <button
            onClick={generate}
            className="text-xs text-gray-400 hover:text-blue-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-blue-300 transition-colors"
          >
            ↻ Обновить задачи
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Locked */}
        {!allTopicsCompleted && !hasTasks && (
          <div className="px-6 py-10 text-center">
            <div className="text-3xl mb-3 opacity-40">🔒</div>
            <p className="text-sm text-gray-400 leading-relaxed">
              Здесь появятся практические задачи,<br/>когда вы пройдёте все темы курса.
            </p>
          </div>
        )}

        {/* Unlocked, not yet generated */}
        {allTopicsCompleted && !hasTasks && !generating && (
          <div className="px-6 py-10 text-center">
            <div className="text-3xl mb-3">✦</div>
            <p className="text-sm font-medium text-gray-800 mb-1">Все темы пройдены!</p>
            <p className="text-sm text-gray-400 mb-5 leading-relaxed">
              Готовы проверить себя на практике?<br/>Составим 5 задач на применение знаний.
            </p>
            <button
              onClick={generate}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Подготовить задачи
            </button>
          </div>
        )}

        {/* Generating */}
        {generating && (
          <div className="px-6 py-10 text-center">
            <div className="text-2xl mb-3 animate-spin inline-block">⚙</div>
            <p className="text-sm text-gray-500">Составляем задачи по материалам курса...</p>
            <p className="text-xs text-gray-400 mt-1">Это займёт около 15–30 секунд</p>
          </div>
        )}

        {/* Error */}
        {error && !generating && (
          <div className="px-5 py-3 bg-red-50 border-b border-red-100">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Task list */}
        {hasTasks && !generating && (
          <div>
            {tasks.map((task, i) => (
              <TaskCard
                key={task.id}
                task={task}
                index={i}
                onResult={handleResult}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
