'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { type Discipline, type Topic } from '@/types/db'

type Role = 'user' | 'assistant'
type Message = { role: Role; content: string }

const EDIT_MARKER = 'ИЗМЕНЕНИЯ_ГОТОВЫ:'

interface EditChanges {
  discipline?: { name?: string }
  topics_update?: Array<{ id: string; name?: string; complexity?: string; depth?: string; lesson_duration_minutes?: number }>
  topics_add?: Array<{ name: string; description?: string; order_idx?: number; complexity: string; depth: string; lesson_duration_minutes: number }>
  topics_delete?: string[]
}

function extractChanges(text: string): EditChanges | null {
  const idx = text.indexOf(EDIT_MARKER)
  if (idx === -1) return null
  const jsonStart = text.indexOf('```json', idx)
  const jsonEnd = text.indexOf('```', jsonStart + 7)
  if (jsonStart === -1 || jsonEnd === -1) return null
  try {
    return JSON.parse(text.slice(jsonStart + 7, jsonEnd).trim())
  } catch {
    return null
  }
}

export default function EditDisciplineClient({
  discipline,
  topics,
}: {
  discipline: Discipline
  topics: Topic[]
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [changes, setChanges] = useState<EditChanges | null>(null)
  const [saving, setSaving] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)

  // Контекст для агента — дисциплина + только pending/in_progress темы (completed не передаём)
  const disciplineContext = {
    id: discipline.id,
    name: discipline.name,
    description: discipline.description,
    topics: topics.map(t => ({
      id: t.id,
      name: t.name,
      order_idx: t.order_idx,
      complexity: t.complexity,
      depth: t.depth,
      lesson_duration_minutes: t.lesson_duration_minutes,
      status: t.status,
    })),
  }

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    sendToAgent([])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendToAgent(history: Message[], userMessage?: string) {
    const apiMessages: Message[] = userMessage
      ? [...history, { role: 'user', content: userMessage }]
      : [{ role: 'user', content: '__INIT__' }]

    if (userMessage) {
      setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    }

    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, disciplineContext }),
      })

      if (!res.ok || !res.body) throw new Error('API error')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: fullText }
          return updated
        })
      }

      const parsed = extractChanges(fullText)
      if (parsed) setChanges(parsed)
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Что-то пошло не так. Попробуй ещё раз.',
        }
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const history = messages.filter(m => m.content !== '')
    sendToAgent(history, text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  async function applyChanges() {
    if (!changes) return
    setSaving(true)
    try {
      const patchBody: Record<string, unknown> = {}

      if (changes.discipline) {
        patchBody.discipline = changes.discipline
      }

      const topicsPayload: unknown[] = []

      if (changes.topics_update) {
        for (const t of changes.topics_update) {
          topicsPayload.push(t)
        }
      }
      if (changes.topics_add) {
        for (const t of changes.topics_add) {
          topicsPayload.push(t)
        }
      }
      if (changes.topics_delete) {
        for (const id of changes.topics_delete) {
          topicsPayload.push({ id, _delete: true })
        }
      }

      if (topicsPayload.length > 0) {
        patchBody.topics = topicsPayload
      }

      const res = await fetch(`/api/disciplines/${discipline.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })

      if (res.ok) {
        router.push(`/dashboard/${discipline.id}`)
      } else {
        const data = await res.json()
        alert('Ошибка: ' + (data.error ?? 'unknown'))
      }
    } finally {
      setSaving(false)
    }
  }

  const changesCount =
    (changes?.topics_update?.length ?? 0) +
    (changes?.topics_add?.length ?? 0) +
    (changes?.topics_delete?.length ?? 0) +
    (changes?.discipline ? 1 : 0)

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Заголовок */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          href={`/dashboard/${discipline.id}`}
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← {discipline.name}
        </Link>
        <span className="text-gray-300">|</span>
        <h1 className="text-lg font-semibold text-gray-900">Редактировать с агентом</h1>
      </div>

      {/* Лента сообщений */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
              }`}
            >
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

      {/* Кнопка применить изменения */}
      {changes && (
        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
          <span className="text-sm text-blue-800 font-medium">
            {changesCount} {changesCount === 1 ? 'изменение' : 'изменений'} готово к применению
          </span>
          <button
            disabled={saving}
            onClick={applyChanges}
            className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Сохраняем...' : 'Применить'}
          </button>
        </div>
      )}

      {/* Поле ввода */}
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Что изменить?"
          rows={1}
          disabled={loading}
          className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
          style={{ minHeight: '48px' }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-blue-600 text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
        >
          →
        </button>
      </form>
    </div>
  )
}
