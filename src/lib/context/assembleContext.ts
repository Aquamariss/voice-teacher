import { createClient } from '@/lib/supabase/server'

export interface PageContext {
  disciplineId?: string
  topicId?: string
  lessonId?: string
}

export interface AssembledContext {
  learner: string        // компактный текст для промпта
  discipline: string     // память дисциплины (пустая строка если не в дисциплине)
}

/**
 * Собирает контекст для агента: профиль ученика + память дисциплины.
 * Вызывается на сервере в API-роутах.
 */
export async function assembleContext(
  userId: string,
  page?: PageContext
): Promise<AssembledContext> {
  const supabase = await createClient()

  // ── Профиль ученика ──────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('learner_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  let learner = ''
  if (profile) {
    const parts: string[] = []
    if (profile.goals) parts.push(`Цель: ${profile.goals}`)
    parts.push(`Темп: ${profile.pace === 'slow' ? 'медленный' : profile.pace === 'fast' ? 'быстрый' : 'комфортный'}`)
    if (profile.strong_areas?.length) parts.push(`Сильные стороны: ${profile.strong_areas.join(', ')}`)
    if (profile.challenging_areas?.length) parts.push(`Трудности: ${profile.challenging_areas.join(', ')}`)
    if (profile.avg_quiz_score != null) parts.push(`Средний балл тестов: ${Math.round(profile.avg_quiz_score * 100)}%`)
    parts.push(`Пройдено сессий: ${profile.sessions_completed}`)
    const style = profile.style as Record<string, boolean>
    const styleNotes: string[] = []
    if (style?.prefers_analogies) styleNotes.push('любит аналогии')
    if (style?.asks_many_questions) styleNotes.push('задаёт много вопросов')
    if (style?.needs_repetition) styleNotes.push('нужно повторение')
    if (style?.prefers_formal) styleNotes.push('предпочитает формальный стиль')
    if (styleNotes.length) parts.push(`Стиль: ${styleNotes.join(', ')}`)
    if (profile.notes) parts.push(`Заметки: ${profile.notes}`)
    learner = parts.join('\n')
  } else {
    learner = 'Профиль ученика ещё не заполнен.'
  }

  // ── Память дисциплины ────────────────────────────────────────────────────
  let discipline = ''
  if (page?.disciplineId) {
    const { data: memory } = await supabase
      .from('discipline_memories')
      .select('*')
      .eq('user_id', userId)
      .eq('discipline_id', page.disciplineId)
      .single()

    if (memory?.summary) {
      discipline = memory.summary
      if (memory.open_questions?.length) {
        discipline += `\nОткрытые вопросы: ${memory.open_questions.join('; ')}`
      }
    }
  }

  return { learner, discipline }
}

/**
 * Создаёт профиль ученика при первом входе (если не существует).
 */
export async function ensureLearnerProfile(userId: string): Promise<void> {
  const supabase = await createClient()
  await supabase
    .from('learner_profiles')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
}

/**
 * Логирует событие сессии.
 */
export async function logEvent(
  userId: string,
  eventType: string,
  data: Record<string, unknown> = {},
  refs?: { disciplineId?: string; lessonId?: string }
): Promise<void> {
  const supabase = await createClient()
  await supabase.from('session_events').insert({
    user_id: userId,
    event_type: eventType,
    data,
    discipline_id: refs?.disciplineId ?? null,
    lesson_id: refs?.lessonId ?? null,
  })
}
