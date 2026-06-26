'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { type Discipline, type Topic, type ModuleWithLessons, type LessonWithParts, type LessonPart } from '@/types/db'
import AudioPlayer from '@/components/AudioPlayer'

// ─── Типы ────────────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant'
type Message = { role: Role; content: string }

interface AgentTopicStructure {
  modules: Array<{
    name: string
    order: number
    lessons: Array<{ name: string; description: string; order: number }>
  }>
}

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

// Состояние генерации
interface GenState {
  lessonId: string
  phase: 'outline' | 'part'
  message: string
  currentPart: number
  totalParts: number
  // Накопленный текст по частям (partNumber → text)
  partTexts: Record<number, string>
  outline: OutlineData | null
}

const STRUCTURE_MARKER = 'СТРУКТУРА_ТЕМЫ_ГОТОВА:'

function extractStructure(text: string): AgentTopicStructure | null {
  const idx = text.indexOf(STRUCTURE_MARKER)
  if (idx === -1) return null
  const jsonStart = text.indexOf('```json', idx)
  const jsonEnd = text.indexOf('```', jsonStart + 7)
  if (jsonStart === -1 || jsonEnd === -1) return null
  try { return JSON.parse(text.slice(jsonStart + 7, jsonEnd).trim()) }
  catch { return null }
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

  // Чат-агент для структуры
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [agentStructure, setAgentStructure] = useState<AgentTopicStructure | null>(null)
  const [savingStructure, setSavingStructure] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)

  // Генерация контента
  const [genState, setGenState] = useState<GenState | null>(null)

  // Просмотр части
  const [viewingPart, setViewingPart] = useState<{ lesson: LessonWithParts; part: LessonPart } | null>(null)
  // Воспроизведение части
  const [playingPart, setPlayingPart] = useState<LessonPart | null>(null)

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

  // Авто-старт агента если нет структуры
  useEffect(() => {
    if (structureSaved || initializedRef.current) return
    initializedRef.current = true
    sendToAgent([])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Чат-агент ──────────────────────────────────────────────────────────────

  async function sendToAgent(history: Message[], userMessage?: string) {
    const apiMessages: Message[] = userMessage
      ? [...history, { role: 'user', content: userMessage }]
      : [{ role: 'user', content: '__INIT__' }]

    if (userMessage) setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, topicContext }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setMessages(prev => {
          const u = [...prev]
          u[u.length - 1] = { role: 'assistant', content: fullText }
          return u
        })
      }

      const parsed = extractStructure(fullText)
      if (parsed) setAgentStructure(parsed)
    } catch {
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: 'Что-то пошло не так. Попробуй ещё раз.' }
        return u
      })
    } finally {
      setChatLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || chatLoading) return
    setInput('')
    sendToAgent(messages.filter(m => m.content !== ''), text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent) }
  }

  // ── Сохранение структуры ───────────────────────────────────────────────────

  async function saveStructure() {
    if (!agentStructure) return
    setSavingStructure(true)
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_structure: agentStructure }),
      })
      if (!res.ok) { alert('Ошибка сохранения'); return }

      const data = await fetch(`/api/topics/${topic.id}`).then(r => r.json())
      const mods: ModuleWithLessons[] = (data.modules ?? []).map((m: ModuleWithLessons) => ({
        ...m,
        lessons: (data.lessons ?? []).map((l: LessonWithParts) => ({ ...l, parts: [] }))
          .filter((l: LessonWithParts) => l.module_id === m.id),
      }))
      setModules(mods)
      setStructureSaved(true)
      setAgentStructure(null)
    } finally {
      setSavingStructure(false)
    }
  }

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

  async function startGeneration(lesson: LessonWithParts) {
    setGenState({
      lessonId: lesson.id,
      phase: 'outline',
      message: 'Составляю план занятия...',
      currentPart: 0,
      totalParts: 1,
      partTexts: {},
      outline: null,
    })

    try {
      const res = await fetch(`/api/lessons/${lesson.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
          phase: data.phase as 'outline' | 'part',
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
          // Обновляем локальное состояние модулей
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
                created_at: new Date().toISOString(),
              }
              return { ...l, parts: [...existingParts, newPart].sort((a, b) => a.part_number - b.part_number) }
            }),
          })))
          return prev
        })
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

  // Первое занятие без контента
  const firstUnprepared = modules.flatMap(m =>
    m.lessons.map(l => ({ lesson: l, mod: m }))
  ).find(({ lesson }) => lesson.status === 'pending' && lesson.parts.length === 0)

  // ── Просмотр части ────────────────────────────────────────────────────────

  if (viewingPart) {
    const { lesson, part } = viewingPart
    const totalParts = lesson.parts.length
    const hasPrev = part.part_number > 1
    const hasNext = part.part_number < totalParts
    const partLabel = totalParts > 1
      ? `${lesson.name} · Часть ${part.part_number} из ${totalParts}`
      : lesson.name

    const goPrev = () => {
      const prev = lesson.parts.find(p => p.part_number === part.part_number - 1)
      if (prev) setViewingPart({ lesson, part: prev })
    }
    const goNext = () => {
      const next = lesson.parts.find(p => p.part_number === part.part_number + 1)
      if (next) setViewingPart({ lesson, part: next })
    }

    // Навигация между занятиями — плоский список всех уроков с готовым контентом
    const allLessons = modules.flatMap(m => m.lessons)
    const currentIdx = allLessons.findIndex(l => l.id === lesson.id)
    const prevLesson = allLessons.slice(0, currentIdx).reverse().find(l => l.parts.length > 0)
    const nextLesson = allLessons.slice(currentIdx + 1).find(l => l.parts.length > 0)

    const goToLesson = (l: LessonWithParts) => {
      const firstPart = [...l.parts].sort((a, b) => a.part_number - b.part_number)[0]
      if (firstPart) setViewingPart({ lesson: l, part: firstPart })
    }

    return (
      <div className="max-w-2xl pb-28">
        {/* Навигация */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setViewingPart(null)} className="text-sm text-gray-500 hover:text-gray-800">
            ← Назад к структуре
          </button>
          {/* Кнопка Слушать */}
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

        <h2 className="text-xl font-semibold text-gray-900 mb-0.5">{lesson.name}</h2>
        {totalParts > 1 && (
          <p className="text-sm text-blue-600 mb-1">Часть {part.part_number} из {totalParts}</p>
        )}
        <p className="text-xs text-gray-400 mb-6">
          {topic.lesson_duration_minutes} мин · {complexityLabel[topic.complexity]} · {depthLabel[topic.depth]}
        </p>

        <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap bg-white border border-gray-200 rounded-xl p-6 mb-4">
          {part.content}
        </div>

        {totalParts > 1 && (
          <div className="flex justify-between">
            <button
              onClick={goPrev}
              disabled={!hasPrev}
              className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-30 transition-colors"
            >
              ← Часть {part.part_number - 1}
            </button>
            <button
              onClick={goNext}
              disabled={!hasNext}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-30 transition-colors font-medium"
            >
              Часть {part.part_number + 1} →
            </button>
          </div>
        )}

        {(prevLesson || nextLesson) && (
          <div className="flex justify-between mt-4 pt-4 border-t border-gray-100">
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
            text={part.content}
            onClose={() => setPlayingPart(null)}
            onEnded={() => {
              // Автопереход к следующей части
              if (hasNext) goNext()
            }}
          />
        )}
      </div>
    )
  }

  // ── Нет структуры → чат-агент ─────────────────────────────────────────────

  if (!structureSaved) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
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

        <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
              }`}>
                {msg.content || (
                  <span className="inline-flex gap-1 items-center text-gray-400">
                    <span className="animate-bounce">·</span>
                    <span className="animate-bounce [animation-delay:0.1s]">·</span>
                    <span className="animate-bounce [animation-delay:0.2s]">·</span>
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {agentStructure && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between">
            <span className="text-sm text-green-800 font-medium">
              Структура: {agentStructure.modules.length} модулей,{' '}
              {agentStructure.modules.reduce((s, m) => s + m.lessons.length, 0)} занятий
            </span>
            <button
              disabled={savingStructure}
              onClick={saveStructure}
              className="bg-green-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {savingStructure ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Скорректируй структуру..."
            rows={1}
            disabled={chatLoading}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ minHeight: '48px' }}
          />
          <button
            type="submit"
            disabled={chatLoading || !input.trim()}
            className="bg-blue-600 text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
          >
            →
          </button>
        </form>
      </div>
    )
  }

  // ── Структура есть → показываем модули/занятия ────────────────────────────

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link href={`/dashboard/${discipline.id}`} className="text-sm text-gray-400 hover:text-gray-600 mb-1 inline-block">
            ← {discipline.name}
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">{topic.name}</h1>
          <div className="flex gap-2 mt-1 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{complexityLabel[topic.complexity]}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{depthLabel[topic.depth]}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{topic.lesson_duration_minutes} мин / занятие</span>
          </div>
        </div>
        <button
          onClick={() => { setStructureSaved(false); setMessages([]); initializedRef.current = false; setTimeout(() => { initializedRef.current = false; sendToAgent([]) }, 0) }}
          className="flex items-center gap-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors shrink-0"
        >
          ✦ Редактировать с агентом
        </button>
      </div>

      {/* ── Панель генерации (отображается поверх структуры) ── */}
      {genState && (
        <div className="mb-6 p-4 bg-white border border-blue-200 rounded-xl">
          <p className="text-sm font-medium text-gray-700 mb-2">{genState.message}</p>
          {genState.totalParts > 1 && (
            <div className="flex gap-1 mb-3">
              {Array.from({ length: genState.totalParts }, (_, i) => i + 1).map(n => (
                <div key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${
                  n < genState.currentPart ? 'bg-blue-500' :
                  n === genState.currentPart ? 'bg-blue-300 animate-pulse' : 'bg-gray-200'
                }`} />
              ))}
            </div>
          )}
          {genState.outline && (
            <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
              {genState.outline.outline}
            </p>
          )}
          {genState.currentPart > 0 && genState.partTexts[genState.currentPart] && (
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
                      <span className="text-xs text-gray-400 shrink-0 w-5 pt-0.5">{li + 1}</span>

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
                          <span
                            className="text-sm font-medium text-gray-800 cursor-pointer hover:text-blue-700 block"
                            onClick={() => setEditingLesson(lesson.id)}
                          >
                            {lesson.name}
                          </span>
                        )}
                        {lesson.description && (
                          <p className="text-xs text-gray-400 mt-0.5">{lesson.description}</p>
                        )}

                        {/* Части занятия */}
                        {readyParts.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {readyParts.map(part => (
                              <button
                                key={part.id}
                                onClick={() => setViewingPart({ lesson, part })}
                                className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium"
                              >
                                {readyParts.length > 1 ? `Часть ${part.part_number}` : 'Читать'} →
                              </button>
                            ))}
                          </div>
                        )}

                        {isGenerating && (
                          <p className="text-xs text-blue-500 animate-pulse mt-1">генерирую...</p>
                        )}
                      </div>

                      <div className="shrink-0 pt-0.5">
                        {lesson.status === 'completed' && (
                          <span className="text-xs text-green-600 font-medium">✓ Пройдено</span>
                        )}
                        {lesson.status === 'in_progress' && (
                          <span className="text-xs text-blue-600 font-medium">В процессе</span>
                        )}
                        {lesson.status === 'pending' && readyParts.length === 0 && !isGenerating && (
                          <span className="text-xs text-gray-300">не готово</span>
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

      {/* Кнопка подготовить первое занятие */}
      {firstUnprepared && !genState && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-900">Готов к первому занятию?</p>
            <p className="text-xs text-blue-600 mt-0.5">
              «{firstUnprepared.lesson.name}» · {topic.lesson_duration_minutes} мин
            </p>
          </div>
          <button
            onClick={() => startGeneration(firstUnprepared.lesson)}
            className="bg-blue-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Подготовить занятие →
          </button>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Нажми на название модуля или занятия — чтобы переименовать.
      </p>
    </div>
  )
}
