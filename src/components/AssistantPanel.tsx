'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useVoice } from '@/lib/voice/VoiceContext'
import { type AgentStructure, type Discipline, type Topic } from '@/types/db'
import { SPEEDS, SPEED_KEY, getSavedSpeed } from '@/lib/playback-speed'
import { PartText } from '@/components/PartContent'

type Role       = 'user' | 'assistant'
type Message    = { role: Role; content: string }
type PanelState = 'collapsed' | 'open'
type PanelMode  = 'assistant' | 'new-discipline' | 'edit-discipline' | 'topic-structure'

const STRUCTURE_MARKER       = 'СТРУКТУРА_ГОТОВА:'
const EDIT_MARKER            = 'ИЗМЕНЕНИЯ_ГОТОВЫ:'
const TOPIC_STRUCTURE_MARKER = 'СТРУКТУРА_ТЕМЫ_ГОТОВА:'

interface EditChanges {
  discipline?: { name?: string }
  topics_update?: Array<{ id: string; name?: string; complexity?: string; depth?: string; lesson_duration_minutes?: number }>
  topics_add?: Array<{ name: string; description?: string; order_idx?: number; complexity: string; depth: string; lesson_duration_minutes: number }>
  topics_delete?: string[]
}

function extractEditChanges(text: string): EditChanges | null {
  const idx = text.indexOf(EDIT_MARKER)
  if (idx === -1) return null
  const jsonStart = text.indexOf('```json', idx)
  const jsonEnd   = text.indexOf('```', jsonStart + 7)
  if (jsonStart === -1 || jsonEnd === -1) return null
  try { return JSON.parse(text.slice(jsonStart + 7, jsonEnd).trim()) }
  catch { return null }
}

interface AgentTopicStructure {
  modules: Array<{
    name: string
    order: number
    lessons: Array<{ name: string; description: string; order: number }>
  }>
}

interface TopicStructureCtx {
  topicId: string
  topicContext: {
    disciplineName: string
    topicName: string
    complexity: string
    depth: string
    lesson_duration_minutes: number
  }
  existingStructure?: Array<{
    name: string
    lessons: Array<{ name: string; description: string | null }>
  }>
}

function extractTopicStructure(text: string): AgentTopicStructure | null {
  const idx = text.indexOf(TOPIC_STRUCTURE_MARKER)
  if (idx === -1) return null
  const jsonStart = text.indexOf('```json', idx)
  const jsonEnd   = text.indexOf('```', jsonStart + 7)
  if (jsonStart === -1 || jsonEnd === -1) return null
  try { return JSON.parse(text.slice(jsonStart + 7, jsonEnd).trim()) }
  catch { return null }
}

function extractStructure(text: string): AgentStructure | null {
  const idx = text.indexOf(STRUCTURE_MARKER)
  if (idx === -1) return null
  const jsonStart = text.indexOf('```json', idx)
  const jsonEnd   = text.indexOf('```', jsonStart + 7)
  if (jsonStart === -1 || jsonEnd === -1) return null
  try { return JSON.parse(text.slice(jsonStart + 7, jsonEnd).trim()) }
  catch { return null }
}

function parsePathContext(pathname: string) {
  const topicMatch = pathname.match(/\/dashboard\/([^/]+)\/topics\/([^/]+)/)
  if (topicMatch) return { disciplineId: topicMatch[1], topicId: topicMatch[2] }
  const discMatch = pathname.match(/\/dashboard\/([^/]+)/)
  if (discMatch && discMatch[1] !== 'new') return { disciplineId: discMatch[1] }
  return {}
}

export default function AssistantPanel() {
  const router   = useRouter()
  const pathname = usePathname()
  const voice    = useVoice()

  const [panelState,          setPanelState]          = useState<PanelState>('collapsed')
  const [mode,                setMode]                = useState<PanelMode>('assistant')
  const [messages,            setMessages]            = useState<Message[]>([])
  const [input,               setInput]               = useState('')
  const [loading,             setLoading]             = useState(false)
  const [disciplineStructure, setDisciplineStructure] = useState<AgentStructure | null>(null)
  const [saving,              setSaving]              = useState(false)
  const [editContext,         setEditContext]         = useState<{ discipline: Discipline; topics: Topic[] } | null>(null)
  const [editChanges,         setEditChanges]         = useState<EditChanges | null>(null)
  const [applying,            setApplying]            = useState(false)
  const [topicStructureCtx,   setTopicStructureCtx]  = useState<TopicStructureCtx | null>(null)
  const [topicStructure,      setTopicStructure]      = useState<AgentTopicStructure | null>(null)
  const [savingTopic,         setSavingTopic]         = useState(false)
  const [showScrollButton,    setShowScrollButton]    = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef           = useRef<HTMLTextAreaElement>(null)
  const isAtBottomRef      = useRef(true)
  const sendMsgRef         = useRef<(t: string) => void>(() => {})
  const sendDiscMsgRef     = useRef<(t: string) => void>(() => {})
  const sendEditMsgRef     = useRef<(t: string) => void>(() => {})
  const sendTopicMsgRef    = useRef<(t: string) => void>(() => {})
  const editContextRef     = useRef<{ discipline: Discipline; topics: Topic[] } | null>(null)
  const topicCtxRef        = useRef<TopicStructureCtx | null>(null)
  const modeRef        = useRef<PanelMode>('assistant')
  const assistAudioRef = useRef<HTMLAudioElement | null>(null)
  const ttsBlobUrlRef  = useRef<string | null>(null)
  // Tracks the currently viewed lesson (for quiz context)
  const activeLessonIdRef = useRef<string | null>(null)

  const pageContext = parsePathContext(pathname)

  useEffect(() => { modeRef.current = mode }, [mode])

  function checkAtBottom(): boolean {
    const el = scrollContainerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }

  function scrollToBottom() {
    const el = scrollContainerRef.current
    if (!el) return
    // instant — not smooth, so the onScroll event fires once and we can ignore it
    el.scrollTop = el.scrollHeight
  }

  function handleChatScroll() {
    const atBottom = checkAtBottom()
    isAtBottomRef.current = atBottom
    if (atBottom) {
      setShowScrollButton(false)
    } else if (loading) {
      setShowScrollButton(true)
    }
  }

  // Panel opens → reset to bottom
  useEffect(() => {
    if (panelState === 'open') {
      isAtBottomRef.current = true
      setShowScrollButton(false)
      scrollToBottom()
      if (!voice.isActive) inputRef.current?.focus()
    }
  }, [panelState]) // eslint-disable-line react-hooks/exhaustive-deps

  // New message / streaming chunk → scroll only if user is already at bottom
  useEffect(() => {
    if (panelState !== 'open') return
    if (isAtBottomRef.current) {
      scrollToBottom()
    } else if (loading) {
      setShowScrollButton(true)
    }
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  // Streaming ended → hide button if we're at bottom
  useEffect(() => {
    if (!loading && checkAtBottom()) setShowScrollButton(false)
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile keyboard resize → recheck bottom
  useEffect(() => {
    const onResize = () => {
      if (checkAtBottom()) {
        isAtBottomRef.current = true
        setShowScrollButton(false)
        scrollToBottom()
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── TTS ───────────────────────────────────────────────────────────────────────

  function stopAssistantAudio() {
    if (assistAudioRef.current) {
      assistAudioRef.current.onended = null
      assistAudioRef.current.onerror = null
      assistAudioRef.current.pause()
      assistAudioRef.current = null
    }
    if (ttsBlobUrlRef.current) {
      URL.revokeObjectURL(ttsBlobUrlRef.current)
      ttsBlobUrlRef.current = null
    }
  }

  async function playAssistantTTS(text: string) {
    if (!voice.isActive) return
    stopAssistantAudio()
    voice.setBusy(true)
    voice.setVoiceStatus('speaking')
    try {
      const res = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok || !voice.isActive) { voice.setBusy(false); return }
      const blob = await res.blob()
      if (!voice.isActive) { voice.setBusy(false); return }
      const url = URL.createObjectURL(blob)
      ttsBlobUrlRef.current = url
      const audio = new Audio(url)
      audio.playbackRate = getSavedSpeed()
      assistAudioRef.current = audio
      const onDone = () => {
        if (ttsBlobUrlRef.current) { URL.revokeObjectURL(ttsBlobUrlRef.current); ttsBlobUrlRef.current = null }
        assistAudioRef.current = null
        voice.setBusy(false)
      }
      audio.onended = onDone
      audio.onerror = onDone
      audio.play().catch(onDone)
    } catch { voice.setBusy(false) }
  }

  useEffect(() => {
    const handle = () => stopAssistantAudio()
    window.addEventListener('voice:interrupt-audio', handle)
    return () => window.removeEventListener('voice:interrupt-audio', handle)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Голосовая команда скорости — применяем к текущему аудио ассистента
  useEffect(() => {
    const handle = (e: Event) => {
      const { direction } = (e as CustomEvent<{ direction: 'slower' | 'faster' }>).detail
      const cur    = getSavedSpeed()
      const idx    = SPEEDS.indexOf(cur)
      const newIdx = direction === 'faster'
        ? Math.min(idx + 1, SPEEDS.length - 1)
        : Math.max(idx - 1, 0)
      const next = SPEEDS[newIdx]
      if (next === cur) return
      localStorage.setItem(SPEED_KEY, String(next))
      if (assistAudioRef.current) assistAudioRef.current.playbackRate = next
    }
    window.addEventListener('voice:change-speed', handle)
    return () => window.removeEventListener('voice:change-speed', handle)
  }, [])

  // ── Discipline creation mode ───────────────────────────────────────────────────

  const sendDisciplineMessage = useCallback(async (history: Message[], userText?: string) => {
    const apiMessages = userText
      ? [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: userText }]
      : [{ role: 'user', content: '__INIT__' }]

    if (userText) setMessages(prev => [...prev, { role: 'user', content: userText }])

    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        // Скрываем JSON-блок структуры из чата — показываем только видимый текст
        const display = fullText.includes(STRUCTURE_MARKER)
          ? fullText.slice(0, fullText.indexOf(STRUCTURE_MARKER)).trim()
          : fullText
        setMessages(prev => {
          const u = [...prev]
          u[u.length - 1] = { role: 'assistant', content: display }
          return u
        })
      }

      const structure = extractStructure(fullText)
      if (structure) setDisciplineStructure(structure)

      if (voice.isActive && fullText) {
        const visible = fullText.split(STRUCTURE_MARKER)[0].trim()
        if (visible) playAssistantTTS(visible)
        else voice.setBusy(false)
      } else {
        voice.setBusy(false)
      }
    } catch {
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: 'Что-то пошло не так. Попробуй ещё раз.' }
        return u
      })
      voice.setBusy(false)
    } finally {
      setLoading(false)
    }
  }, [voice]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sendDiscMsgRef.current = (text: string) => {
      const history = messages.filter(m => m.content !== '')
      sendDisciplineMessage(history, text)
    }
  }, [messages, sendDisciplineMessage])

  // Открыть панель в режиме создания дисциплины
  useEffect(() => {
    const handle = () => {
      setMode('new-discipline')
      setDisciplineStructure(null)
      setMessages([])
      setPanelState('open')
      window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: true } }))
      sendDisciplineMessage([], undefined)
    }
    window.addEventListener('assistant:new-discipline', handle)
    return () => window.removeEventListener('assistant:new-discipline', handle)
  }, [sendDisciplineMessage])

  async function saveDiscipline() {
    if (!disciplineStructure) return
    setSaving(true)
    try {
      const res = await fetch('/api/disciplines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(disciplineStructure),
      })
      const data = await res.json()
      if (res.ok) {
        setMode('assistant')
        setDisciplineStructure(null)
        setMessages([])
        setPanelState('collapsed')
        router.push('/dashboard')
        router.refresh()
      } else {
        alert('Ошибка: ' + data.error)
      }
    } finally {
      setSaving(false)
    }
  }

  function exitDisciplineMode() {
    setMode('assistant')
    setDisciplineStructure(null)
    setMessages([])
  }

  // ── Edit-discipline mode ────────────────────────────────────────────────────────

  const sendEditMessage = useCallback(async (history: Message[], userText?: string) => {
    const editContext = editContextRef.current
    if (!editContext) return
    const disciplineCtx = {
      id:          editContext.discipline.id,
      name:        editContext.discipline.name,
      description: editContext.discipline.description,
      topics:      editContext.topics.map(t => ({
        id: t.id, name: t.name, order_idx: t.order_idx,
        complexity: t.complexity, depth: t.depth,
        lesson_duration_minutes: t.lesson_duration_minutes, status: t.status,
      })),
    }
    const apiMessages = userText
      ? [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: userText }]
      : [{ role: 'user', content: '__INIT__' }]

    if (userText) setMessages(prev => [...prev, { role: 'user', content: userText }])
    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, disciplineContext: disciplineCtx }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        const display = fullText.includes(EDIT_MARKER)
          ? fullText.slice(0, fullText.indexOf(EDIT_MARKER)).trim()
          : fullText
        setMessages(prev => {
          const u = [...prev]
          u[u.length - 1] = { role: 'assistant', content: display }
          return u
        })
      }

      const changes = extractEditChanges(fullText)
      if (changes) setEditChanges(changes)

      if (voice.isActive && fullText) {
        const visible = fullText.split(EDIT_MARKER)[0].trim()
        if (visible) playAssistantTTS(visible)
        else voice.setBusy(false)
      } else {
        voice.setBusy(false)
      }
    } catch {
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: 'Что-то пошло не так. Попробуй ещё раз.' }
        return u
      })
      voice.setBusy(false)
    } finally {
      setLoading(false)
    }
  }, [voice]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sendEditMsgRef.current = (text: string) => {
      const history = messages.filter(m => m.content !== '')
      sendEditMessage(history, text)
    }
  }, [messages, sendEditMessage])

  useEffect(() => {
    const handle = (e: Event) => {
      const { discipline, topics } = (e as CustomEvent<{ discipline: Discipline; topics: Topic[] }>).detail
      editContextRef.current = { discipline, topics }  // сразу, без ожидания state
      setMode('edit-discipline')
      setEditContext({ discipline, topics })
      setEditChanges(null)
      setMessages([])
      setPanelState('open')
      window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: true } }))
      sendEditMessage([], undefined)  // context уже в ref — stale closure не страшна
    }
    window.addEventListener('assistant:edit-discipline', handle)
    return () => window.removeEventListener('assistant:edit-discipline', handle)
  }, [sendEditMessage])

  async function applyEditChanges() {
    if (!editChanges || !editContext) return
    setApplying(true)
    try {
      const patchBody: Record<string, unknown> = {}
      if (editChanges.discipline) patchBody.discipline = editChanges.discipline

      const topicsPayload: unknown[] = [
        ...(editChanges.topics_update ?? []),
        ...(editChanges.topics_add    ?? []),
        ...(editChanges.topics_delete ?? []).map(id => ({ id, _delete: true })),
      ]
      if (topicsPayload.length > 0) patchBody.topics = topicsPayload

      const res = await fetch(`/api/disciplines/${editContext.discipline.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      if (res.ok) {
        setMode('assistant')
        setEditContext(null)
        setEditChanges(null)
        setMessages([])
        setPanelState('collapsed')
        window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: false } }))
        router.push(`/dashboard/${editContext.discipline.id}`)
        router.refresh()
      } else {
        const data = await res.json()
        alert('Ошибка: ' + (data.error ?? 'unknown'))
      }
    } finally {
      setApplying(false)
    }
  }

  function exitEditMode() {
    setMode('assistant')
    setEditContext(null)
    setEditChanges(null)
    setMessages([])
  }

  // ── Topic-structure mode ────────────────────────────────────────────────────────

  const sendTopicMessage = useCallback(async (history: Message[], userText?: string) => {
    const ctx = topicCtxRef.current
    if (!ctx) return
    const apiMessages = userText
      ? [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: userText }]
      : [{ role: 'user', content: '__INIT__' }]

    if (userText) setMessages(prev => [...prev, { role: 'user', content: userText }])
    setLoading(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat-topic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          topicContext: ctx.topicContext,
          existingStructure: ctx.existingStructure,
        }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        const display = fullText.includes(TOPIC_STRUCTURE_MARKER)
          ? fullText.slice(0, fullText.indexOf(TOPIC_STRUCTURE_MARKER)).trim()
          : fullText
        setMessages(prev => {
          const u = [...prev]
          u[u.length - 1] = { role: 'assistant', content: display }
          return u
        })
      }

      const structure = extractTopicStructure(fullText)
      if (structure) setTopicStructure(structure)

      if (voice.isActive && fullText) {
        const visible = fullText.split(TOPIC_STRUCTURE_MARKER)[0].trim()
        if (visible) playAssistantTTS(visible)
        else voice.setBusy(false)
      } else {
        voice.setBusy(false)
      }
    } catch {
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: 'Что-то пошло не так. Попробуй ещё раз.' }
        return u
      })
      voice.setBusy(false)
    } finally {
      setLoading(false)
    }
  }, [voice]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sendTopicMsgRef.current = (text: string) => {
      const history = messages.filter(m => m.content !== '')
      sendTopicMessage(history, text)
    }
  }, [messages, sendTopicMessage])

  useEffect(() => {
    const handle = (e: Event) => {
      const detail = (e as CustomEvent<TopicStructureCtx>).detail
      topicCtxRef.current = detail
      setMode('topic-structure')
      setTopicStructureCtx(detail)
      setTopicStructure(null)
      setMessages([])
      setPanelState('open')
      window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: true } }))
      sendTopicMessage([], undefined)
    }
    window.addEventListener('assistant:topic-structure', handle)
    return () => window.removeEventListener('assistant:topic-structure', handle)
  }, [sendTopicMessage])

  async function saveTopicStructure() {
    const ctx = topicCtxRef.current
    if (!topicStructure || !ctx) return
    setSavingTopic(true)
    try {
      const res = await fetch(`/api/topics/${ctx.topicId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_structure: topicStructure }),
      })
      if (res.ok) {
        setMode('assistant')
        setTopicStructureCtx(null)
        setTopicStructure(null)
        setMessages([])
        setPanelState('collapsed')
        window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: false } }))
        window.dispatchEvent(new CustomEvent('topic:structure-saved', { detail: { topicId: ctx.topicId } }))
      } else {
        const data = await res.json()
        alert('Ошибка: ' + (data.error ?? 'unknown'))
      }
    } finally {
      setSavingTopic(false)
    }
  }

  function exitTopicStructureMode() {
    setMode('assistant')
    setTopicStructureCtx(null)
    setTopicStructure(null)
    setMessages([])
  }

  // ── Intent router: switch_mode от главного ассистента ─────────────────────────

  useEffect(() => {
    const handle = async (e: Event) => {
      const { mode, topicId, initialMessage } = (e as CustomEvent<{
        mode: string; topicId?: string; initialMessage?: string
      }>).detail

      if (mode !== 'topic-structure') return
      const tid = topicId || pageContext.topicId
      if (!tid) return

      try {
        const res = await fetch(`/api/topics/${tid}`)
        if (!res.ok) return
        const data = await res.json()
        const t = data.topic
        const ctx: TopicStructureCtx = {
          topicId: tid,
          topicContext: {
            disciplineName: (t.discipline as { name?: string } | null)?.name ?? '',
            topicName:      t.name,
            complexity:     t.complexity,
            depth:          t.depth,
            lesson_duration_minutes: t.lesson_duration_minutes,
          },
          existingStructure: (data.modules ?? []).map((m: { id: string; name: string }) => ({
            name: m.name,
            lessons: (data.lessons ?? [])
              .filter((l: { module_id: string }) => l.module_id === m.id)
              .map((l: { name: string; description: string | null }) => ({
                name: l.name, description: l.description ?? null,
              })),
          })),
        }
        topicCtxRef.current = ctx
        setMode('topic-structure')
        setTopicStructureCtx(ctx)
        setTopicStructure(null)
        setMessages([])
        setPanelState('open')
        window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: true } }))
        sendTopicMessage([], initialMessage)
      } catch { /* ignore fetch errors */ }
    }
    window.addEventListener('assistant:switch-mode', handle)
    return () => window.removeEventListener('assistant:switch-mode', handle)
  }, [pageContext, sendTopicMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lesson context tracking (for quiz) ────────────────────────────────────────

  useEffect(() => {
    const handle = (e: Event) => {
      const { lessonId } = (e as CustomEvent<{ lessonId: string | null }>).detail
      activeLessonIdRef.current = lessonId
    }
    window.addEventListener('context:lesson-changed', handle)
    return () => window.removeEventListener('context:lesson-changed', handle)
  }, [])

  // Лекция завершена → предлагаем тест
  useEffect(() => {
    const handle = (e: Event) => {
      const { lessonName } = (e as CustomEvent<{ lessonName: string; lessonId: string }>).detail
      const quizMsg = `Лекция «${lessonName}» завершена! Когда будете готовы — скажите «начать тест» и я проведу проверку знаний.`
      setPanelState('open')
      window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: true } }))
      setMessages(prev => [...prev, { role: 'assistant', content: quizMsg }])
      if (voice.isActive) playAssistantTTS(quizMsg)
    }
    window.addEventListener('lesson:audio-ended', handle)
    return () => window.removeEventListener('lesson:audio-ended', handle)
  }, [voice]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Assistant mode sendMessage ──────────────────────────────────────────────────

  const sendMessage = useCallback(async (userText: string) => {
    const userMsg: Message = { role: 'user', content: userText }
    const newMessages      = [...messages, userMsg]
    setMessages([...newMessages, { role: 'assistant', content: '' }])
    setLoading(true)
    if (!voice.isActive) setInput('')

    try {
      const mergedContext = activeLessonIdRef.current
        ? { ...pageContext, lessonId: activeLessonIdRef.current }
        : pageContext

      const res = await fetch('/api/chat-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          pageContext: mergedContext,
          voiceMode: voice.isActive,
        }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const block of events) {
          const lines     = block.trim().split('\n')
          const eventLine = lines.find(l => l.startsWith('event:'))
          const dataLine  = lines.find(l => l.startsWith('data:'))
          if (!eventLine || !dataLine) continue

          const event = eventLine.replace('event:', '').trim()
          const data  = JSON.parse(dataLine.replace('data:', '').trim())

          if (event === 'text') {
            fullText += data.text
            setMessages(prev => {
              const u = [...prev]
              u[u.length - 1] = { role: 'assistant', content: fullText }
              return u
            })
          } else if (event === 'navigate') {
            const { page, discipline_id, topic_id } = data as {
              page: string; discipline_id?: string; topic_id?: string
            }
            if (page === 'new_discipline') {
              window.dispatchEvent(new CustomEvent('assistant:new-discipline'))
            } else {
              let url = '/dashboard'
              if (page === 'discipline' && discipline_id) url = `/dashboard/${discipline_id}`
              else if (page === 'topic' && discipline_id && topic_id) url = `/dashboard/${discipline_id}/topics/${topic_id}`
              router.push(url)
            }
          } else if (event === 'switch_mode') {
            window.dispatchEvent(new CustomEvent('assistant:switch-mode', { detail: data }))
          } else if (event === 'quiz_saved') {
            window.dispatchEvent(new CustomEvent('quiz:voice-completed', { detail: data }))
          }
        }
      }

      setMessages(prev => {
        const u = [...prev]
        if (fullText && u[u.length - 1].role === 'assistant')
          u[u.length - 1] = { role: 'assistant', content: fullText }
        return u
      })

      if (voice.isActive && fullText) playAssistantTTS(fullText)
      else voice.setBusy(false)
    } catch {
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: 'Что-то пошло не так. Попробуй ещё раз.' }
        return u
      })
      voice.setBusy(false)
    } finally {
      setLoading(false)
    }
  }, [messages, pageContext, router, voice]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sendMsgRef.current = sendMessage }, [sendMessage])

  // Голосовые сообщения маршрутизируются в зависимости от текущего режима панели
  useEffect(() => {
    const handle = (e: Event) => {
      const { text } = (e as CustomEvent<{ text: string }>).detail
      if (modeRef.current === 'new-discipline')       sendDiscMsgRef.current(text)
      else if (modeRef.current === 'edit-discipline') sendEditMsgRef.current(text)
      else if (modeRef.current === 'topic-structure') sendTopicMsgRef.current(text)
      else sendMsgRef.current(text)
    }
    window.addEventListener('voice:user-message', handle)
    return () => window.removeEventListener('voice:user-message', handle)
  }, [])

  // ── Form ────────────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    if (mode === 'new-discipline') {
      const history = messages.filter(m => m.content !== '')
      sendDisciplineMessage(history, text)
    } else if (mode === 'edit-discipline') {
      const history = messages.filter(m => m.content !== '')
      sendEditMessage(history, text)
    } else if (mode === 'topic-structure') {
      const history = messages.filter(m => m.content !== '')
      sendTopicMessage(history, text)
    } else {
      sendMessage(text)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  function toggle() {
    setPanelState(s => {
      const next = s === 'collapsed' ? 'open' : 'collapsed'
      window.dispatchEvent(new CustomEvent('panel:state-change', { detail: { open: next === 'open' } }))
      return next
    })
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────────

  const statusLabel: Record<string, string> = {
    idle: 'Голосовой режим', listening: 'Слушаю...', recording: 'Записываю...',
    transcribing: 'Распознаю...', processing: 'Думаю...', speaking: 'Говорю...',
  }

  const micIcon  = voice.voiceStatus === 'speaking' ? '🔊'
    : voice.voiceStatus === 'recording'             ? '🔴'
    : voice.voiceStatus === 'transcribing'          ? '⟳'
    : '🎙️'
  const micPulse = voice.voiceStatus === 'listening' || voice.voiceStatus === 'recording'

  // ── Collapsed ───────────────────────────────────────────────────────────────────

  if (panelState === 'collapsed') {
    return (
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
        <button
          onClick={voice.toggleVoice}
          title={voice.isActive ? 'Выключить голос' : 'Включить голос'}
          className={`
            flex items-center justify-center w-10 h-10 rounded-full border shadow-md transition-all
            ${voice.isActive
              ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
              : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-500'}
            ${micPulse ? 'animate-pulse' : ''}
          `}
        >
          <span className={voice.voiceStatus === 'transcribing' ? 'animate-spin' : ''}>{micIcon}</span>
        </button>
        <button
          onClick={toggle}
          className="flex items-center gap-2 bg-gray-900 text-white rounded-full px-4 py-2.5 shadow-lg hover:bg-gray-800 transition-all active:scale-95"
          aria-label="Открыть ассистента"
        >
          <span className="text-base">✦</span>
          <span className="text-sm font-medium hidden sm:inline">Ассистент</span>
          {messages.length > 0 && <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />}
        </button>
      </div>
    )
  }

  // ── Open ────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 sm:hidden" onClick={toggle} />
      <div className="
        fixed z-50 bg-white border border-gray-200 shadow-2xl flex flex-col
        bottom-0 left-0 right-0 h-[70vh] rounded-t-2xl
        sm:top-0 sm:right-0 sm:bottom-0 sm:left-auto sm:w-96 sm:h-full sm:rounded-none sm:rounded-l-2xl sm:border-l
      ">
        {/* Шапка */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">✦ Ассистент</span>
            {mode === 'new-discipline' && (
              <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Новая дисциплина</span>
            )}
            {mode === 'edit-discipline' && (
              <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                Редактирование{editContext ? `: ${editContext.discipline.name}` : ''}
              </span>
            )}
            {mode === 'topic-structure' && (
              <span className="text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
                Структура{topicStructureCtx ? `: ${topicStructureCtx.topicContext.topicName}` : ''}
              </span>
            )}
            {mode === 'assistant' && voice.isActive && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {statusLabel[voice.voiceStatus]}
              </span>
            )}
            {mode === 'assistant' && !voice.isActive && pageContext.disciplineId && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">в дисциплине</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {mode === 'new-discipline' && (
              <button onClick={exitDisciplineMode} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                отмена
              </button>
            )}
            {mode === 'edit-discipline' && (
              <button onClick={exitEditMode} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                отмена
              </button>
            )}
            {mode === 'topic-structure' && (
              <button onClick={exitTopicStructureMode} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                отмена
              </button>
            )}
            {mode === 'assistant' && messages.length > 0 && (
              <button onClick={() => setMessages([])} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                очистить
              </button>
            )}
            <button onClick={toggle} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors">
              ✕
            </button>
          </div>
        </div>

        {/* История */}
        <div
          ref={scrollContainerRef}
          onScroll={handleChatScroll}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        >
          {messages.length === 0 && mode === 'assistant' && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400">Привет! Спроси что угодно.</p>
              <div className="flex flex-wrap gap-2 justify-center mt-4">
                {['Какой мой прогресс?', 'Объясни текущую тему', 'Дай задачу на расчёт по теме'].map(hint => (
                  <button
                    key={hint}
                    onClick={() => { setInput(hint); inputRef.current?.focus() }}
                    className="text-xs border border-gray-200 rounded-full px-3 py-1.5 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
                  >
                    {hint}
                  </button>
                ))}
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('assistant:new-discipline'))}
                  className="text-xs border border-gray-200 rounded-full px-3 py-1.5 text-gray-500 hover:border-green-300 hover:text-green-600 transition-colors"
                >
                  + Новая дисциплина
                </button>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}>
                {msg.role === 'assistant'
                  ? msg.content
                    ? <PartText content={msg.content} />
                    : (
                      <span className="inline-flex gap-1 items-center text-gray-400">
                        <span className="animate-bounce">·</span>
                        <span className="animate-bounce [animation-delay:0.1s]">·</span>
                        <span className="animate-bounce [animation-delay:0.2s]">·</span>
                      </span>
                    )
                  : msg.content
                }
              </div>
            </div>
          ))}
        </div>

        {/* Кнопка сохранить — появляется когда структура готова */}
        {mode === 'new-discipline' && disciplineStructure && (
          <div className="px-4 py-2.5 border-t border-green-100 bg-green-50 flex items-center justify-between shrink-0">
            <span className="text-sm text-green-800 font-medium">Структура готова</span>
            <button
              disabled={saving}
              onClick={saveDiscipline}
              className="bg-green-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        )}

        {/* Кнопка применить изменения дисциплины */}
        {mode === 'edit-discipline' && editChanges && (() => {
          const count =
            (editChanges.topics_update?.length ?? 0) +
            (editChanges.topics_add?.length    ?? 0) +
            (editChanges.topics_delete?.length ?? 0) +
            (editChanges.discipline ? 1 : 0)
          return (
            <div className="px-4 py-2.5 border-t border-blue-100 bg-blue-50 flex items-center justify-between shrink-0">
              <span className="text-sm text-blue-800 font-medium">
                {count} {count === 1 ? 'изменение' : 'изменений'} готово
              </span>
              <button
                disabled={applying}
                onClick={applyEditChanges}
                className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {applying ? 'Применяем...' : 'Применить'}
              </button>
            </div>
          )
        })()}

        {/* Кнопка сохранить структуру темы */}
        {mode === 'topic-structure' && topicStructure && (
          <div className="px-4 py-2.5 border-t border-purple-100 bg-purple-50 flex items-center justify-between shrink-0">
            <span className="text-sm text-purple-800 font-medium">
              {topicStructure.modules.length} модулей,{' '}
              {topicStructure.modules.reduce((s, m) => s + m.lessons.length, 0)} занятий
            </span>
            <button
              disabled={savingTopic}
              onClick={saveTopicStructure}
              className="bg-purple-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {savingTopic ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        )}

        {/* Голосовой статус-бар */}
        {voice.isActive && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`text-base shrink-0 ${micPulse ? 'animate-pulse' : ''}`}>{micIcon}</span>
              <span className="text-sm font-medium text-gray-700 truncate">{statusLabel[voice.voiceStatus]}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {voice.voiceStatus === 'speaking' && (
                <button
                  onClick={() => { stopAssistantAudio(); voice.setBusy(false) }}
                  className="text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-100 transition-colors font-medium"
                >
                  ◼ Стоп
                </button>
              )}
              <button
                onClick={voice.toggleVoice}
                className="text-sm bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
              >
                Только текст
              </button>
            </div>
          </div>
        )}

        {/* Кнопка «прокрутить вниз» — появляется при стриминге если пользователь уехал вверх */}
        {showScrollButton && (
          <div className="flex justify-center py-2 shrink-0">
            <button
              onClick={() => {
                isAtBottomRef.current = true
                scrollToBottom()
                setShowScrollButton(false)
              }}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-xs px-4 py-2 rounded-full shadow-md hover:bg-blue-700 transition-colors active:scale-95 min-h-[44px] min-w-[44px]"
            >
              ↓ новый ответ
            </button>
          </div>
        )}

        {/* Ввод */}
        <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-gray-100 flex gap-2 items-end shrink-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'new-discipline'   ? 'Расскажи что хочешь изучить...'
              : mode === 'edit-discipline' ? 'Что изменить?'
              : mode === 'topic-structure' ? 'Скорректируй структуру...'
              : voice.isActive ? 'Или печатайте здесь...'
              : 'Напиши или нажми 🎤'
            }
            rows={1}
            disabled={loading}
            className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-24 overflow-y-auto bg-gray-50"
            style={{ minHeight: '40px' }}
          />
          <button
            type="button"
            onClick={voice.toggleVoice}
            className={`w-9 h-9 flex items-center justify-center rounded-xl border text-base shrink-0 transition-all ${
              voice.isActive
                ? 'border-blue-400 bg-blue-100 text-blue-600 hover:bg-blue-200'
                : 'border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-500'
            } ${micPulse ? 'animate-pulse' : ''}`}
            title={voice.isActive ? 'Выключить голос' : 'Включить голосовой режим'}
          >
            🎤
          </button>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-9 h-9 flex items-center justify-center bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
          >
            →
          </button>
        </form>
      </div>
    </>
  )
}
