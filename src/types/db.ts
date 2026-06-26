export type Complexity = 'easy' | 'medium' | 'hard'
export type Pace = 'slow' | 'comfortable' | 'fast'

export interface LearnerProfile {
  user_id: string
  goals: string | null
  pace: Pace
  style: {
    prefers_analogies?: boolean
    asks_many_questions?: boolean
    needs_repetition?: boolean
    prefers_formal?: boolean
  }
  strong_areas: string[]
  challenging_areas: string[]
  avg_quiz_score: number | null
  sessions_completed: number
  notes: string | null
  updated_at: string
}

export interface DisciplineMemory {
  id: string
  user_id: string
  discipline_id: string
  summary: string | null
  open_questions: string[]
  last_session_at: string | null
  updated_at: string
}

export interface SessionEvent {
  id: string
  user_id: string
  discipline_id: string | null
  lesson_id: string | null
  event_type: string
  data: Record<string, unknown>
  created_at: string
}
export type Depth = 'surface' | 'medium' | 'deep'
export type LessonStatus = 'pending' | 'in_progress' | 'completed'
export type TopicStatus = 'pending' | 'in_progress' | 'completed'
export type PartStatus = 'pending' | 'generating' | 'ready'

export interface Discipline {
  id: string
  user_id: string
  name: string
  description: string | null
  lang: string
  created_at: string
}

export interface Topic {
  id: string
  discipline_id: string
  name: string
  description: string | null
  order_idx: number
  complexity: Complexity
  depth: Depth
  lesson_duration_minutes: number
  status: TopicStatus
  created_at: string
}

export interface Module {
  id: string
  topic_id: string
  name: string
  order_idx: number
  created_at: string
}

export interface Lesson {
  id: string
  module_id: string
  name: string
  description: string | null
  order_idx: number
  status: LessonStatus
  content_outline: string | null
  created_at: string
}

export interface LessonPart {
  id: string
  lesson_id: string
  part_number: number
  content: string | null
  status: PartStatus
  created_at: string
}

export interface LessonWithParts extends Lesson {
  parts: LessonPart[]
}

export interface ModuleWithLessons extends Module {
  lessons: LessonWithParts[]
}

// Структура из агента (до сохранения в БД)
export interface AgentLesson {
  name: string
  description: string
  order: number
}

export interface AgentModule {
  name: string
  order: number
  lessons: AgentLesson[]
}

export interface AgentTopic {
  name: string
  description: string
  order: number
  complexity: Complexity
  depth: Depth
  lesson_duration_minutes: number
  modules: AgentModule[]  // [] при первом сохранении, заполняется при открытии темы
}

export interface AgentStructure {
  discipline: {
    name: string
    description: string
  }
  topics: AgentTopic[]
}
