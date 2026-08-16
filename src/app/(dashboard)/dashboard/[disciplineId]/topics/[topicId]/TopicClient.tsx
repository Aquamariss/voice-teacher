'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  type Discipline, type Topic,
  type ModuleWithLessons, type LessonWithParts, type LessonPart,
  type QuizData, type QuizLevel1Question, type QuizLevel2Question, type QuizResults,
} from '@/types/db'
import AudioPlayer from '@/components/AudioPlayer'
import PartContent, { prepareForSpeech } from '@/components/PartContent'

// ─── Типы ────────────────────────────────────────────────────────────────────

interface OutlineData {
  total_parts: number
  outline: string
  parts: Array<{
    part_number: number
    title: string
    duration_minutes: number
    key_points: string[]
  }>
}

interface GenState {
  lessonId: string
  phase: 'outline' | 'part' | 'quiz'
  message: string
  currentPart: number
  totalParts: number
  partTexts: Record<number, string>
  outline: OutlineData | null
}

interface QuizAnswer {
  text: string
  feedback: string
  correct?: boolean
  score?: number
  checked: boolean
}

const complexityLabel: Record<string, string> = {
  easy: 'Лёгкая', medium: 'Средняя', hard: 'Сложная',
}
const depthLabel: Record<string, string> = {
  surface: 'Поверхностная', medium: 'Средняя', deep: 'Глубокая',
}

// ─── Главный компонент ───────────────────────────────────────────────────────

export default function TopicClient({
  discipline,
  topic,
  initialModules,
}: {
  discipline: Pick<Discipline, 'id' | 'name'>
  topic: Topic
  initialModules: ModuleWithLessons[]
}) {
  const hasStructure = initialModules.length > 0

  const [modules, setModules] = useState<ModuleWithLessons[]>(initialModules)
  const [structureSaved, setStructureSaved] = useState(hasStructure)

  const [genState, setGenState] = useState<GenState | null>(null)

  const [viewingPart, setViewingPart] = useState<{ lesson: LessonWithParts; part: LessonPart } | null>(null)
  const [playingPart, setPlayingPart] = useState<LessonPart | null>(null)

  // Quiz state
  const [viewingQuiz, setViewingQuiz] = useState<LessonWithParts | null>(null)
  const viewingQuizIdRef = useRef<string | null>(null)
  useEffect(() => { viewingQuizIdRef.current = viewingQuiz?.id ?? null }, [viewingQuiz?.id])
  const [quizLevel, setQuizLevel] = useState<1 | 2 | 'done'>(1)
  const [quizIdx, setQuizIdx] = useState(0)
  const [quizAnswers, setQuizAnswers] = useState<Record<string, QuizAnswer>>({})
  const [quizInput, setQuizInput] = useState('')
  const [quizChecking, setQuizChecking] = useState(false)
  const [viewingResultsId, setViewingResultsId] = useState<string | null>(null)
  const [regeneratingQuiz, setRegeneratingQuiz] = useState<string | null>(null)

  // Inline-редактирование
  const [editingModule, setEditingModule] = useState<string | null>(null)
  const [editingLesson, setEditingLesson] = useState<string | null>(null)

  const topicContext = {
    disciplineName: discipline.name,
    topicName: topic.name,
    complexity: topic.complexity,
    depth: topic.depth,
    lesson_duration_minutes: topic.lesson_duration_minutes,
  }

  // Открываем боковой ассистент при отсутствии структуры
  useEffect(() => {
    if (structureSaved) return
    window.dispatchEvent(new CustomEvent('assistant:topic-structure', {
      detail: { topicId: topic.id, topicContext }
    }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Слушаем сохранение структуры из AssistantPanel
  useEffect(() => {
    const handle = async (e: Event) => {
      const { topicId } = (e as CustomEvent<{ topicId: string }>).detail
      if (topicId !== topic.id) return
      const data = await fetch(`/api/topics/${topic.id}`).then(r => r.json())
      const mods: ModuleWithLessons[] = (data.modules ?? []).map((m: ModuleWithLessons) => ({
        ...m,
        lessons: (data.lessons ?? []).map((l: LessonWithParts) => ({ ...l, parts: [] }))
          .filter((l: LessonWithParts) => l.module_id === m.id),
      }))
      setModules(mods)
      setStructureSaved(true)
    }
    window.addEventListener('topic:structure-saved', handle)
    return () => window.removeEventListener('topic:structure-saved', handle)
  }, [topic.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Сообщаем ассистенту какое занятие открыто — часть, тест или результаты
  useEffect(() => {
    const lessonId = viewingPart?.lesson.id ?? viewingQuiz?.id ?? viewingResultsId ?? null
    window.dispatchEvent(new CustomEvent('context:lesson-changed', {
      detail: { lessonId }
    }))
  }, [viewingPart?.lesson.id, viewingQuiz?.id, viewingResultsId])

  // Голосовой тест завершён — ассистент сохранил результаты в БД
  useEffect(() => {
    const handle = (e: Event) => {
      const { lessonId, results } = (e as CustomEvent<{ lessonId: string; results: QuizResults }>).detail
      setModules(prev => prev.map(m => ({
        ...m,
        lessons: m.lessons.map(l =>
          l.id === lessonId ? { ...l, status: 'completed' as const, quiz_results: results } : l
        ),
      })))
      // Если сейчас открыт тест именно этого занятия — переходим к результатам
      if (viewingQuizIdRef.current === lessonId) {
        setViewingQuiz(null)
        setViewingResultsId(lessonId)
      }
    }
    window.addEventListener('quiz:voice-completed', handle)
    return () => window.removeEventListener('quiz:voice-completed', handle)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inline-редактирование ─────────────────────────────────────────────────

  async function saveModuleName(modId: string, name: string) {
    setEditingModule(null)
    await fetch(`/api/topics/${topic.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: [{ id: modId, name }] }),
    })
    setModules(prev => prev.map(m => m.id === modId ? { ...m, name } : m))
  }

  async function saveLessonName(modId: string, lessonId: string, name: string) {
    setEditingLesson(null)
    await fetch(`/api/topics/${topic.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessons: [{ id: lessonId, name }] }),
    })
    setModules(prev => prev.map(m =>
      m.id === modId
        ? { ...m, lessons: m.lessons.map(l => l.id === lessonId ? { ...l, name } : l) }
        : m
    ))
  }

  // ── Генерация контента (SSE) ──────────────────────────────────────────────

  async function startGeneration(lesson: LessonWithParts, resume = false) {
    setGenState({
      lessonId: lesson.id,
      phase: 'outline',
      message: resume ? 'Проверяю план занятия...' : 'Составляю план занятия...',
      currentPart: 0,
      totalParts: 1,
      partTexts: {},
      outline: null,
    })

    try {
      const res = await fetch(`/api/lessons/${lesson.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume }),
      })

      if (!res.ok || !res.body) throw new Error('API error')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventBlock of events) {
          const lines = eventBlock.trim().split('\n')
          const eventLine = lines.find(l => l.startsWith('event:'))
          const dataLine = lines.find(l => l.startsWith('data:'))
          if (!eventLine || !dataLine) continue

          const event = eventLine.replace('event:', '').trim()
          const data = JSON.parse(dataLine.replace('data:', '').trim())

          handleSSEEvent(event, data, lesson)
        }
      }
    } catch (err) {
      console.error('Generation error:', err)
      setGenState(null)
      alert('Ошибка генерации. Попробуй ещё раз.')
    }
  }

  function handleSSEEvent(event: string, data: Record<string, unknown>, lesson: LessonWithParts) {
    switch (event) {
      case 'status':
        setGenState(prev => prev ? {
          ...prev,
          phase: data.phase as GenState['phase'],
          message: data.message as string,
          currentPart: (data.partNumber as number) || prev.currentPart,
          totalParts: (data.totalParts as number) || prev.totalParts,
        } : null)
        break

      case 'outline':
        setGenState(prev => prev ? {
          ...prev,
          outline: data.outline as OutlineData,
          totalParts: data.totalParts as number,
        } : null)
        break

      case 'chunk':
        setGenState(prev => {
          if (!prev) return null
          const pn = data.partNumber as number
          return {
            ...prev,
            partTexts: {
              ...prev.partTexts,
              [pn]: (prev.partTexts[pn] ?? '') + (data.text as string),
            },
          }
        })
        break

      case 'part_done': {
        const partNumber = data.partNumber as number
        setGenState(prev => {
          if (!prev) return null
          const content = prev.partTexts[partNumber] ?? ''
          setModules(mods => mods.map(m => ({
            ...m,
            lessons: m.lessons.map(l => {
              if (l.id !== lesson.id) return l
              const existingParts = l.parts.filter(p => p.part_number !== partNumber)
              const newPart: LessonPart = {
                id: `local-${partNumber}`,
                lesson_id: lesson.id,
                part_number: partNumber,
                content,
                status: 'ready',
                images: null,
                created_at: new Date().toISOString(),
              }
              return { ...l, parts: [...existingParts, newPart].sort((a, b) => a.part_number - b.part_number) }
            }),
          })))
          return prev
        })
        break
      }

      case 'part_skipped':
        // Already-ready part in resume mode — state is already correct, nothing to do
        break

      case 'part_images': {
        const { partNumber: pn, images } = data as { partNumber: number; images: import('@/types/db').LessonImage[] }
        setModules(mods => mods.map(m => ({
          ...m,
          lessons: m.lessons.map(l => {
            if (l.id !== lesson.id) return l
            return {
              ...l,
              parts: l.parts.map(p =>
                p.part_number === pn ? { ...p, images } : p
              ),
            }
          }),
        })))
        break
      }

      case 'quiz_ready': {
        const quizData = data.quizData as QuizData
        setModules(mods => mods.map(m => ({
          ...m,
          lessons: m.lessons.map(l =>
            l.id === lesson.id ? { ...l, quiz_data: quizData } : l
          ),
        })))
        break
      }

      case 'done':
        setGenState(null)
        break

      case 'error':
        setGenState(null)
        alert('Ошибка: ' + (data.message as string))
        break
    }
  }

  // Lesson started but interrupted: has some parts but not all ready, or missing quiz
  function isIncomplete(lesson: LessonWithParts) {
    if (lesson.parts.length === 0) return false
    const hasPendingParts = lesson.parts.some(p => p.status !== 'ready')
    const missingQuiz = !lesson.quiz_data
    return hasPendingParts || missingQuiz
  }

  // ── Квиз ─────────────────────────────────────────────────────────────────

  function enterQuiz(lesson: LessonWithParts) {
    setViewingQuiz(lesson)
    setViewingPart(null)
    setQuizLevel(1)
    setQuizIdx(0)
    setQuizAnswers({})
    setQuizInput('')
  }

  async function checkAnswer(lesson: LessonWithParts) {
    const qd = lesson.quiz_data
    if (!qd || !quizInput.trim() || quizChecking || quizLevel === 'done') return

    setQuizChecking(true)
    const key = `${quizLevel}_${quizIdx}`
    const q = quizLevel === 1 ? qd.level1[quizIdx] : qd.level2[quizIdx]

    try {
      const res = await fetch(`/api/lessons/${lesson.id}/check-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q.question,
          answer: quizInput,
          level: quizLevel,
          ...(quizLevel === 1 ? { correctAnswer: (q as QuizLevel1Question).answer } : {}),
          ...(quizLevel === 2 ? { keyPoints: (q as QuizLevel2Question).key_points } : {}),
        }),
      })
      const result = await res.json()
      setQuizAnswers(prev => ({
        ...prev,
        [key]: {
          text: quizInput,
          feedback: result.feedback ?? '',
          correct: result.correct,
          score: result.score,
          checked: true,
        },
      }))
    } catch {
      alert('Ошибка проверки. Попробуй ещё раз.')
    } finally {
      setQuizChecking(false)
    }
  }

  function buildResults(qd: QuizData, answers: Record<string, QuizAnswer>): QuizResults {
    const level1 = qd.level1.map((q, idx) => {
      const ans = answers[`1_${idx}`]
      return {
        id: q.id,
        question: q.question,
        user_answer: ans?.text ?? '',
        correct_answer: q.answer,
        correct: ans?.correct ?? false,
        feedback: ans?.feedback ?? '',
      }
    })
    const level2 = qd.level2.map((q, idx) => {
      const ans = answers[`2_${idx}`]
      return {
        id: q.id,
        question: q.question,
        user_answer: ans?.text ?? '',
        score: ans?.score ?? 0,
        key_points: q.key_points,
        feedback: ans?.feedback ?? '',
      }
    })
    return {
      completed_at: new Date().toISOString(),
      level1_score: level1.filter(q => q.correct).length,
      level1_total: level1.length,
      level2_score: level2.reduce((s, q) => s + (q.score ?? 0), 0),
      level2_total: level2.length * 3,
      level1,
      level2,
    }
  }

  function nextQuestion(lesson: LessonWithParts) {
    const qd = lesson.quiz_data!
    setQuizInput('')

    if (quizLevel === 1) {
      if (quizIdx + 1 < qd.level1.length) {
        setQuizIdx(quizIdx + 1)
      } else {
        setQuizLevel(2)
        setQuizIdx(0)
      }
    } else {
      if (quizIdx + 1 < qd.level2.length) {
        setQuizIdx(quizIdx + 1)
      } else {
        setQuizLevel('done')
        const results = buildResults(qd, quizAnswers)
        markLessonCompleted(lesson.id, results)
      }
    }
  }

  async function markLessonCompleted(lessonId: string, results?: QuizResults) {
    const updateBody: Record<string, unknown> = { status: 'completed' }
    if (results) updateBody.quiz_results = results

    await fetch(`/api/lessons/${lessonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody),
    })
    setModules(prev => prev.map(m => ({
      ...m,
      lessons: m.lessons.map(l =>
        l.id === lessonId
          ? { ...l, status: 'completed' as const, ...(results ? { quiz_results: results } : {}) }
          : l
      ),
    })))
    if (viewingQuiz?.id === lessonId) {
      setViewingQuiz(prev => prev ? {
        ...prev,
        status: 'completed',
        ...(results ? { quiz_results: results } : {}),
      } : prev)
    }
  }

  async function regenerateQuiz(lesson: LessonWithParts) {
    setRegeneratingQuiz(lesson.id)
    // Don't clear results view yet — show loading state inside it

    try {
      const res = await fetch(`/api/lessons/${lesson.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_only: true }),
      })
      if (!res.ok || !res.body) throw new Error('API error')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let newQuizData: QuizData | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const block of events) {
          const lines = block.trim().split('\n')
          const ev = lines.find(l => l.startsWith('event:'))?.replace('event:', '').trim()
          const dl = lines.find(l => l.startsWith('data:'))?.replace('data:', '').trim()
          if (!ev || !dl) continue
          const d = JSON.parse(dl) as Record<string, unknown>
          if (ev === 'quiz_ready') {
            newQuizData = d.quizData as QuizData
            setModules(mods => mods.map(m => ({
              ...m,
              lessons: m.lessons.map(l =>
                l.id === lesson.id ? { ...l, quiz_data: newQuizData, quiz_results: null } : l
              ),
            })))
          }
          if (ev === 'error') alert('Ошибка: ' + (d.message as string))
        }
      }

      if (newQuizData) {
        setViewingResultsId(null)
        enterQuiz({ ...lesson, quiz_data: newQuizData, quiz_results: null })
      } else {
        alert('Не удалось обновить вопросы. Попробуй ещё раз.')
      }
    } catch (err) {
      console.error('Quiz regeneration error:', err)
      alert('Ошибка обновления вопросов.')
    } finally {
      setRegeneratingQuiz(null)
    }
  }

  // ── Results view ──────────────────────────────────────────────────────────

  if (viewingResultsId) {
    const lesson = modules.flatMap(m => m.lessons).find(l => l.id === viewingResultsId)
    if (!lesson) { setViewingResultsId(null); return null }
    const results = lesson.quiz_results

    if (!results) {
      return (
        <div className="max-w-2xl pb-28">
          <button onClick={() => setViewingResultsId(null)} className="text-sm text-gray-500 hover:text-gray-800 mb-6">
            ← Назад
          </button>
          {regeneratingQuiz === lesson.id ? (
            <p className="text-sm text-blue-500 animate-pulse">Обновляю вопросы...</p>
          ) : (
            <p className="text-sm text-gray-500">Результатов пока нет. Пройдите тест.</p>
          )}
        </div>
      )
    }

    const l1Pct = Math.round((results.level1_score / results.level1_total) * 100)
    const l2Pct = results.level2_total > 0 ? Math.round((results.level2_score / results.level2_total) * 100) : 0

    return (
      <div className="max-w-2xl pb-28">
        <button onClick={() => setViewingResultsId(null)} className="text-sm text-gray-500 hover:text-gray-800 mb-4">
          ← Назад к занятию
        </button>

        <p className="text-xs font-medium text-green-500 uppercase tracking-wide mb-0.5">Результаты теста</p>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">{lesson.name}</h2>
        <p className="text-xs text-gray-400 mb-5">
          Пройдено {new Date(results.completed_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>

        {/* Score summary */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
            <p className="text-xs text-blue-500 mb-1">Уровень 1 — Воспроизведение</p>
            <p className="text-2xl font-bold text-blue-700">{results.level1_score}/{results.level1_total}</p>
            <p className="text-xs text-blue-400">{l1Pct}%</p>
          </div>
          {results.level2.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
              <p className="text-xs text-indigo-500 mb-1">Уровень 2 — Понимание</p>
              <p className="text-2xl font-bold text-indigo-700">{results.level2_score}/{results.level2_total}</p>
              <p className="text-xs text-indigo-400">{l2Pct}%</p>
            </div>
          )}
        </div>

        {/* Level 1 breakdown */}
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Уровень 1 — Воспроизведение</h3>
        <div className="space-y-3 mb-6">
          {results.level1.map((item, i) => (
            <div key={i} className={`border rounded-xl p-4 ${item.correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-start gap-2 mb-2">
                <span className={`text-sm font-bold shrink-0 ${item.correct ? 'text-green-600' : 'text-red-500'}`}>
                  {item.correct ? '✓' : '✗'}
                </span>
                <p className="text-sm font-medium text-gray-800">{item.question}</p>
              </div>
              <div className="ml-5 space-y-1">
                <p className="text-xs text-gray-500">Ваш ответ: <span className="text-gray-700 italic">{item.user_answer || '—'}</span></p>
                {!item.correct && item.correct_answer && (
                  <p className="text-xs text-green-700">Правильно: <span className="font-medium">{item.correct_answer}</span></p>
                )}
                {item.feedback && <p className="text-xs text-gray-500">{item.feedback}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Level 2 breakdown */}
        {results.level2.length > 0 && (
          <>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Уровень 2 — Критическое мышление</h3>
            <div className="space-y-3 mb-6">
              {results.level2.map((item, i) => (
                <div key={i} className="border border-indigo-200 bg-indigo-50 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-medium text-gray-800">{item.question}</p>
                    <span className="text-sm font-bold text-indigo-600 shrink-0">Баллы: {item.score}/3</span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">Ваш ответ: <span className="text-gray-700 italic">{item.user_answer || '—'}</span></p>
                    {item.feedback && <p className="text-xs text-gray-500">{item.feedback}</p>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => { setViewingResultsId(null); enterQuiz(lesson) }}
            className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50 transition-colors font-medium"
          >
            Перепройти тест
          </button>
          <button
            onClick={() => regenerateQuiz(lesson)}
            disabled={regeneratingQuiz === lesson.id}
            className="flex-1 py-2.5 border border-purple-200 text-purple-700 text-sm rounded-xl hover:bg-purple-50 disabled:opacity-50 transition-colors font-medium"
          >
            {regeneratingQuiz === lesson.id ? 'Обновляю...' : 'Обновить вопросы'}
          </button>
        </div>
      </div>
    )
  }

  // ── Quiz view ─────────────────────────────────────────────────────────────

  if (viewingQuiz) {
    const lesson = viewingQuiz
    const qd = lesson.quiz_data

    if (!qd) {
      return (
        <div className="max-w-2xl pb-28">
          <button onClick={() => setViewingQuiz(null)} className="text-sm text-gray-500 hover:text-gray-800 mb-6">
            ← Назад к занятию
          </button>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 text-center">
            <p className="text-sm text-yellow-800">Проверочные вопросы ещё не созданы. Попробуй позже.</p>
          </div>
        </div>
      )
    }

    const l1Correct = Object.entries(quizAnswers).filter(([k, v]) => k.startsWith('1_') && v.correct).length
    const l2TotalScore = Object.entries(quizAnswers)
      .filter(([k]) => k.startsWith('2_'))
      .reduce((s, [, v]) => s + (v.score ?? 0), 0)

    const quizReadyParts = lesson.parts.filter(p => p.status === 'ready').sort((a, b) => a.part_number - b.part_number)
    const quizTotalParts = quizReadyParts.length
    const quizLastPart = quizReadyParts[quizTotalParts - 1]
    const quizNavRow = quizTotalParts > 0 ? (
      <div className="grid grid-cols-3 items-center text-sm py-1 mb-3">
        <div>
          <button
            onClick={() => quizLastPart && setViewingPart({ lesson, part: quizLastPart })}
            className="text-gray-500 hover:text-gray-800 transition-colors"
          >
            ← Часть {quizTotalParts}
          </button>
        </div>
        <div className="text-center">
          <span className="text-xs text-purple-600 font-medium">Тест</span>
        </div>
        <div />
      </div>
    ) : null

    return (
      <div className="max-w-2xl pb-28">
        <button onClick={() => setViewingQuiz(null)} className="text-sm text-gray-500 hover:text-gray-800 mb-4">
          ← Назад к занятию
        </button>

        {quizNavRow}

        <p className="text-xs font-medium text-purple-400 uppercase tracking-wide mb-0.5">Проверка знаний</p>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">{lesson.name}</h2>

        {quizLevel === 'done' ? (
          <div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-8 mb-4 text-center">
              <div className="text-4xl mb-3">🎉</div>
              <h3 className="text-lg font-semibold text-green-800 mb-1">Занятие завершено!</h3>
              <p className="text-sm text-green-700 mt-2">
                Уровень 1: {l1Correct} из {qd.level1.length} верно
              </p>
              {qd.level2.length > 0 && (
                <p className="text-sm text-green-700">
                  Уровень 2: {l2TotalScore} из {qd.level2.length * 3} баллов
                </p>
              )}
            </div>
            <div className="flex gap-3 mb-3">
              <button
                onClick={() => { setViewingResultsId(lesson.id); setViewingQuiz(null) }}
                className="flex-1 py-2.5 bg-purple-600 text-white text-sm rounded-xl font-medium hover:bg-purple-700 transition-colors"
              >
                Подробные результаты →
              </button>
              <button
                onClick={() => enterQuiz(lesson)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl font-medium hover:bg-gray-50 transition-colors"
              >
                Перепройти
              </button>
            </div>
            <button
              onClick={() => setViewingQuiz(null)}
              className="w-full py-2 text-gray-500 text-sm rounded-xl hover:bg-gray-50 transition-colors"
            >
              Вернуться к теме
            </button>
          </div>
        ) : (
          <>
            {/* Индикатор уровня */}
            <div className={`text-center py-2 px-4 rounded-xl text-sm font-medium border mb-6 ${
              quizLevel === 1
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-indigo-50 text-indigo-700 border-indigo-200'
            }`}>
              {quizLevel === 1
                ? `Уровень 1 — Воспроизведение · Вопрос ${quizIdx + 1} из ${qd.level1.length}`
                : `Уровень 2 — Критическое мышление · Вопрос ${quizIdx + 1} из ${qd.level2.length}`
              }
            </div>

            {/* Текущий вопрос */}
            {(() => {
              const q = quizLevel === 1 ? qd.level1[quizIdx] : qd.level2[quizIdx]
              const key = `${quizLevel}_${quizIdx}`
              const ans = quizAnswers[key]

              return (
                <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
                  <p className="text-sm font-medium text-gray-900 leading-relaxed mb-4">{q.question}</p>

                  {ans?.checked ? (
                    <div>
                      <div className={`text-sm px-3 py-2.5 rounded-lg mb-4 border leading-relaxed ${
                        quizLevel === 1
                          ? ans.correct
                            ? 'bg-green-50 text-green-800 border-green-200'
                            : 'bg-red-50 text-red-800 border-red-200'
                          : 'bg-blue-50 text-blue-800 border-blue-200'
                      }`}>
                        {quizLevel === 1 && (
                          <span className="font-semibold">{ans.correct ? '✓ Верно' : '✗ Неверно'} — </span>
                        )}
                        {quizLevel === 2 && ans.score !== undefined && (
                          <span className="font-semibold">Баллы: {ans.score}/3 — </span>
                        )}
                        {ans.feedback}
                      </div>
                      <button
                        onClick={() => nextQuestion(lesson)}
                        className="w-full py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 transition-colors font-medium"
                      >
                        {quizLevel === 1
                          ? (quizIdx + 1 < qd.level1.length ? 'Следующий вопрос →' : 'Перейти к уровню 2 →')
                          : (quizIdx + 1 < qd.level2.length ? 'Следующий вопрос →' : 'Завершить занятие →')
                        }
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-gray-400 mb-2">
                        {quizLevel === 1
                          ? 'Ответь своими словами — важна суть, а не точное совпадение'
                          : 'Порассуждай — ответа нет в тексте напрямую'
                        }
                      </p>
                      <textarea
                        value={quizInput}
                        onChange={e => setQuizInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && e.ctrlKey) checkAnswer(lesson)
                        }}
                        placeholder={quizLevel === 1 ? 'Ваш ответ...' : 'Ваши рассуждения...'}
                        rows={quizLevel === 2 ? 4 : 2}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3 bg-gray-50"
                      />
                      <button
                        onClick={() => checkAnswer(lesson)}
                        disabled={!quizInput.trim() || quizChecking}
                        className="w-full py-2.5 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium"
                      >
                        {quizChecking ? 'Проверяю...' : 'Проверить'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Прогресс-точки */}
            <div className="flex gap-2 justify-center mb-4">
              {(quizLevel === 1 ? qd.level1 : qd.level2).map((_, i) => {
                const key = `${quizLevel}_${i}`
                const ans = quizAnswers[key]
                return (
                  <div key={i} className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    ans?.checked
                      ? quizLevel === 1
                        ? (ans.correct ? 'bg-green-500' : 'bg-red-400')
                        : 'bg-blue-500'
                      : i === quizIdx ? 'bg-gray-400' : 'bg-gray-200'
                  }`} />
                )
              })}
            </div>

            <p className="text-xs text-center text-gray-400">
              Также можно обсудить тест голосом с ассистентом →
            </p>
          </>
        )}
      </div>
    )
  }

  // ── Просмотр части ────────────────────────────────────────────────────────

  if (viewingPart) {
    const { part } = viewingPart
    // Always use live lesson state so quiz_results, status etc. reflect latest changes
    const lesson = modules.flatMap(m => m.lessons).find(l => l.id === viewingPart.lesson.id) ?? viewingPart.lesson
    // Only count ready parts for navigation
    const readyPartsForNav = lesson.parts.filter(p => p.status === 'ready').sort((a, b) => a.part_number - b.part_number)
    const totalParts = readyPartsForNav.length
    const currentNavIdx = readyPartsForNav.findIndex(p => p.part_number === part.part_number)
    const hasPrev = currentNavIdx > 0
    const hasNext = currentNavIdx < totalParts - 1
    const isLastPart = !hasNext
    const partLabel = totalParts > 1
      ? `${lesson.name} · Часть ${currentNavIdx + 1} из ${totalParts}`
      : lesson.name

    const goPrev = () => {
      const prev = readyPartsForNav[currentNavIdx - 1]
      if (prev) setViewingPart({ lesson, part: prev })
    }
    const goNext = () => {
      const next = readyPartsForNav[currentNavIdx + 1]
      if (next) setViewingPart({ lesson, part: next })
    }

    const allLessons = modules.flatMap(m => m.lessons)
    const currentIdx = allLessons.findIndex(l => l.id === lesson.id)
    const prevLesson = allLessons.slice(0, currentIdx).reverse().find(l => l.parts.length > 0)
    const nextLesson = allLessons.slice(currentIdx + 1).find(l => l.parts.length > 0)

    const goToLesson = (l: LessonWithParts) => {
      const firstPart = [...l.parts].sort((a, b) => a.part_number - b.part_number)[0]
      if (firstPart) setViewingPart({ lesson: l, part: firstPart })
    }

    const partNavRow = totalParts > 1 ? (
      <div className="grid grid-cols-3 items-center text-sm py-1">
        <div>
          {hasPrev && (
            <button onClick={goPrev} className="text-gray-500 hover:text-gray-800 transition-colors">
              ← Часть {currentNavIdx}
            </button>
          )}
        </div>
        <div className="text-center">
          <span className="text-xs text-blue-600 font-medium">
            Часть {currentNavIdx + 1} из {totalParts}
          </span>
        </div>
        <div className="text-right">
          {hasNext ? (
            <button onClick={goNext} className="text-blue-600 hover:text-blue-800 transition-colors font-medium">
              Часть {currentNavIdx + 2} →
            </button>
          ) : lesson.quiz_data ? (
            <button onClick={() => enterQuiz(lesson)} className="text-purple-600 hover:text-purple-800 transition-colors font-medium">
              Тест →
            </button>
          ) : null}
        </div>
      </div>
    ) : null

    return (
      <div className="max-w-2xl pb-28">
        {/* Навигация */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setViewingPart(null)} className="text-sm text-gray-500 hover:text-gray-800">
            ← Назад к структуре
          </button>
          {part.content && (
            <button
              onClick={() => setPlayingPart(part)}
              className="flex items-center gap-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors font-medium"
            >
              ▶ Слушать
            </button>
          )}
        </div>

        {(prevLesson || nextLesson) && (
          <div className="flex justify-between mb-4 text-xs">
            {prevLesson ? (
              <button
                onClick={() => goToLesson(prevLesson)}
                className="text-gray-400 hover:text-gray-700 transition-colors truncate max-w-[45%] text-left"
              >
                ← {prevLesson.name}
              </button>
            ) : <div />}
            {nextLesson ? (
              <button
                onClick={() => goToLesson(nextLesson)}
                className="text-blue-400 hover:text-blue-600 transition-colors truncate max-w-[45%] text-right"
              >
                {nextLesson.name} →
              </button>
            ) : <div />}
          </div>
        )}

        {partNavRow && <div className="mb-3">{partNavRow}</div>}
        <p className="text-xs font-medium text-purple-400 uppercase tracking-wide mb-0.5">Занятие</p>
        <h2 className="text-xl font-semibold text-gray-900 mb-0.5">{lesson.name}</h2>
        <p className="text-xs text-gray-400 mb-6">
          {topic.lesson_duration_minutes} мин · {complexityLabel[topic.complexity]} · {depthLabel[topic.depth]}
        </p>

        <PartContent content={part.content ?? ''} images={part.images} />

        {partNavRow && <div className="mt-6 mb-4 border-t border-gray-100 pt-4">{partNavRow}</div>}

        {/* Проверка знаний — только после последней части */}
        {isLastPart && lesson.quiz_data && (
          <div className="mt-2 p-4 bg-purple-50 border border-purple-200 rounded-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-purple-900">Проверка знаний</p>
                {lesson.quiz_results ? (
                  <p className="text-xs text-purple-600 mt-0.5">
                    Уровень 1: {lesson.quiz_results.level1_score}/{lesson.quiz_results.level1_total} · Уровень 2: {lesson.quiz_results.level2_score}/{lesson.quiz_results.level2_total}
                  </p>
                ) : (
                  <p className="text-xs text-purple-600 mt-0.5">5 вопросов на память + 3 вопроса на понимание</p>
                )}
              </div>
              {lesson.quiz_results ? (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setViewingPart(null); setViewingResultsId(lesson.id) }}
                    className="bg-green-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    Результаты
                  </button>
                  <button
                    onClick={() => { setViewingPart(null); enterQuiz(lesson) }}
                    className="border border-purple-300 text-purple-700 text-sm px-3 py-2 rounded-lg hover:bg-purple-100 transition-colors font-medium"
                  >
                    Перепройти
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => enterQuiz(lesson)}
                  className="bg-purple-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors font-medium shrink-0"
                >
                  Пройти тест →
                </button>
              )}
            </div>
          </div>
        )}

        {isLastPart && !lesson.quiz_data && (
          <p className="text-xs text-gray-400 text-center mt-4">Вопросы для проверки скоро появятся</p>
        )}

        {(prevLesson || nextLesson) && (
          <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
            {prevLesson ? (
              <button
                onClick={() => goToLesson(prevLesson)}
                className="flex flex-col items-start text-sm text-gray-500 hover:text-gray-800 transition-colors max-w-[45%]"
              >
                <span className="text-xs text-gray-400 mb-0.5">← Предыдущее занятие</span>
                <span className="truncate font-medium">{prevLesson.name}</span>
              </button>
            ) : <div />}
            {nextLesson ? (
              <button
                onClick={() => goToLesson(nextLesson)}
                className="flex flex-col items-end text-sm text-blue-600 hover:text-blue-800 transition-colors max-w-[45%]"
              >
                <span className="text-xs text-blue-400 mb-0.5">Следующее занятие →</span>
                <span className="truncate font-medium">{nextLesson.name}</span>
              </button>
            ) : <div />}
          </div>
        )}

        {/* Аудио-плеер */}
        {playingPart?.id === part.id && part.content && (
          <AudioPlayer
            title={lesson.name}
            partLabel={partLabel}
            text={prepareForSpeech(part.content)}
            onClose={() => setPlayingPart(null)}
            onEnded={() => {
              if (hasNext) {
                goNext()
              } else {
                // Последняя часть — сообщаем ассистенту
                window.dispatchEvent(new CustomEvent('lesson:audio-ended', {
                  detail: { lessonId: lesson.id, lessonName: lesson.name }
                }))
              }
            }}
          />
        )}
      </div>
    )
  }

  // ── Нет структуры → плейсхолдер ──────────────────────────────────────────

  if (!structureSaved) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <Link href={`/dashboard/${discipline.id}`} className="text-sm text-gray-400 hover:text-gray-600">
            ← {discipline.name}
          </Link>
          <span className="text-gray-300">›</span>
          <span className="text-sm font-medium text-gray-700">{topic.name}</span>
          <span className="ml-auto flex gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{complexityLabel[topic.complexity]}</span>
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{depthLabel[topic.depth]}</span>
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{topic.lesson_duration_minutes} мин</span>
          </span>
        </div>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-purple-50 flex items-center justify-center mb-4">
            <span className="text-2xl">✦</span>
          </div>
          <p className="text-sm font-medium text-gray-600 mb-1">Ассистент создаёт структуру занятий</p>
          <p className="text-xs text-gray-400">Смотри панель справа →</p>
        </div>
      </div>
    )
  }

  // ── Структура есть → показываем модули/занятия ────────────────────────────

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link href={`/dashboard/${discipline.id}`} className="text-sm text-gray-400 hover:text-gray-600 mb-1 inline-block">
            ← Дисциплина: {discipline.name}
          </Link>
          <p className="text-xs font-medium text-purple-500 uppercase tracking-wide mb-0.5">Тема</p>
          <h1 className="text-2xl font-semibold text-gray-900">{topic.name}</h1>
          <div className="flex gap-2 mt-1 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{complexityLabel[topic.complexity]}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{depthLabel[topic.depth]}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{topic.lesson_duration_minutes} мин / занятие</span>
          </div>
        </div>
      </div>

      {/* Панель генерации */}
      {genState && (
        <div className="mb-6 p-4 bg-white border border-blue-200 rounded-xl">
          <p className="text-sm font-medium text-gray-700 mb-2">{genState.message}</p>
          {genState.phase !== 'quiz' && genState.totalParts > 1 && (
            <div className="flex gap-1 mb-3">
              {Array.from({ length: genState.totalParts }, (_, i) => i + 1).map(n => (
                <div key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${
                  n < genState.currentPart ? 'bg-blue-500' :
                  n === genState.currentPart ? 'bg-blue-300 animate-pulse' : 'bg-gray-200'
                }`} />
              ))}
            </div>
          )}
          {genState.phase === 'quiz' && (
            <div className="flex gap-1.5 items-center">
              <span className="text-xs text-purple-600 animate-pulse">◉</span>
              <span className="text-xs text-purple-600">Составляю проверочные вопросы...</span>
            </div>
          )}
          {genState.outline && genState.phase !== 'quiz' && (
            <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
              {genState.outline.outline}
            </p>
          )}
          {genState.currentPart > 0 && genState.partTexts[genState.currentPart] && genState.phase === 'part' && (
            <div className="mt-3 text-xs text-gray-500 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto border-t border-gray-100 pt-3">
              {genState.partTexts[genState.currentPart].slice(-600)}
              <span className="inline-block w-1 h-3 bg-blue-400 animate-pulse ml-0.5 align-middle" />
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {modules.map((mod) => (
          <div key={mod.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <span className="text-xs font-medium text-purple-400 uppercase tracking-wide shrink-0">Модуль</span>
              {editingModule === mod.id ? (
                <input
                  autoFocus
                  defaultValue={mod.name}
                  onBlur={e => saveModuleName(mod.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveModuleName(mod.id, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setEditingModule(null)
                  }}
                  className="flex-1 text-sm font-semibold text-gray-700 border-b border-blue-400 outline-none bg-transparent"
                />
              ) : (
                <span
                  className="text-sm font-semibold text-gray-700 cursor-pointer hover:text-blue-700"
                  onClick={() => setEditingModule(mod.id)}
                  title="Нажми чтобы переименовать"
                >
                  {mod.name}
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400">{mod.lessons.length} занятий</span>
            </div>

            <div className="divide-y divide-gray-50">
              {mod.lessons.map((lesson, li) => {
                const readyParts = lesson.parts.filter(p => p.status === 'ready')
                const isGenerating = genState?.lessonId === lesson.id

                return (
                  <div key={lesson.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-300 shrink-0 pt-0.5 whitespace-nowrap">Занятие {li + 1}</span>

                      <div className="flex-1 min-w-0">
                        {editingLesson === lesson.id ? (
                          <input
                            autoFocus
                            defaultValue={lesson.name}
                            onBlur={e => saveLessonName(mod.id, lesson.id, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveLessonName(mod.id, lesson.id, (e.target as HTMLInputElement).value)
                              if (e.key === 'Escape') setEditingLesson(null)
                            }}
                            className="w-full text-sm font-medium text-gray-800 border-b border-blue-400 outline-none bg-transparent"
                          />
                        ) : (
                          <span className="flex items-center gap-1 group/lesson">
                            {readyParts.length > 0 ? (
                              <button
                                onClick={() => setViewingPart({ lesson, part: readyParts[0] })}
                                className="text-sm font-medium text-gray-800 hover:text-blue-700 transition-colors text-left"
                              >
                                {lesson.name}
                              </button>
                            ) : (
                              <span className="text-sm font-medium text-gray-800">{lesson.name}</span>
                            )}
                            <button
                              onClick={() => setEditingLesson(lesson.id)}
                              className="text-gray-300 hover:text-gray-500 text-xs opacity-0 group-hover/lesson:opacity-100 transition-opacity shrink-0"
                              title="Переименовать"
                            >
                              ✎
                            </button>
                          </span>
                        )}
                        {lesson.description && (
                          <p className="text-xs text-gray-400 mt-0.5">{lesson.description}</p>
                        )}

                        {/* Кнопки занятия */}
                        {isGenerating ? (
                          <p className="text-xs text-blue-500 animate-pulse mt-1">генерирую...</p>
                        ) : (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {readyParts.map((part, pi) => (
                              <button
                                key={part.id}
                                onClick={() => setViewingPart({ lesson, part })}
                                className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium"
                              >
                                {readyParts.length > 1 ? `Часть ${pi + 1}` : 'Читать'} →
                              </button>
                            ))}
                            {/* Тест или результаты */}
                            {lesson.quiz_results ? (
                              <button
                                onClick={() => setViewingResultsId(lesson.id)}
                                className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700 hover:bg-green-100 transition-colors font-medium"
                              >
                                Результаты →
                              </button>
                            ) : lesson.quiz_data ? (
                              <button
                                onClick={() => enterQuiz(lesson)}
                                className="text-xs px-2.5 py-1 rounded-full bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors font-medium"
                              >
                                Тест →
                              </button>
                            ) : null}
                            {/* Завершить прерванную генерацию */}
                            {isIncomplete(lesson) && (
                              <button
                                onClick={() => startGeneration(lesson, true)}
                                className="text-xs px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors font-medium"
                              >
                                ↺ Завершить генерацию
                              </button>
                            )}
                            {/* Подготовить занятие — если ещё не начато */}
                            {readyParts.length === 0 && !isIncomplete(lesson) && (
                              <button
                                onClick={() => startGeneration(lesson)}
                                className="text-xs px-2.5 py-1 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium"
                              >
                                Подготовить →
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 pt-0.5">
                        {lesson.status === 'completed' && lesson.quiz_results && (
                          <span className="text-xs text-green-600 font-medium">
                            ✓ {lesson.quiz_results.level1_score}/{lesson.quiz_results.level1_total} · {lesson.quiz_results.level2_score}/{lesson.quiz_results.level2_total}
                          </span>
                        )}
                        {lesson.status === 'completed' && !lesson.quiz_results && (
                          <span className="text-xs text-green-600 font-medium">✓ Пройдено</span>
                        )}
                        {lesson.status === 'in_progress' && (
                          <span className="text-xs text-blue-600 font-medium">В процессе</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Нажми на название модуля — чтобы переименовать. У занятий — иконка ✎ при наведении.
      </p>
    </div>
  )
}
