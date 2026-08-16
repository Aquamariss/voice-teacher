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

export interface QuizLevel1Question {
  id: number
  question: string
  answer: string
}

export interface QuizLevel2Question {
  id: number
  question: string
  key_points: string[]
}

export interface QuizData {
  level1: QuizLevel1Question[]
  level2: QuizLevel2Question[]
}

export interface QuizResultItem {
  id: number
  question: string
  user_answer: string
  feedback: string
  correct?: boolean
  correct_answer?: string
  score?: number
  key_points?: string[]
}

export interface QuizResults {
  completed_at: string
  level1_score: number
  level1_total: number
  level2_score: number
  level2_total: number
  level1: QuizResultItem[]
  level2: QuizResultItem[]
}

export interface Lesson {
  id: string
  module_id: string
  name: string
  description: string | null
  order_idx: number
  status: LessonStatus
  content_outline: string | null
  quiz_data: QuizData | null
  quiz_results: QuizResults | null
  created_at: string
}

export interface LessonImage {
  query: string         // заголовок статьи Wikipedia, по которой нашли картинку
  title: string         // название файла изображения
  thumbnail_url: string
  full_url: string
  author: string
  license: string
  source_page_url: string
  description?: string  // краткое описание из Wikidata / первое предложение статьи
}

export interface LessonPart {
  id: string
  lesson_id: string
  part_number: number
  content: string | null
  status: PartStatus
  images: LessonImage[] | null
  created_at: string
}

export interface LessonWithParts extends Lesson {
  parts: LessonPart[]
}

export interface ModuleWithLessons extends Module {
  lessons: LessonWithParts[]
}

// ── Практический модуль ─────────────────────────────────────────────────────

export type PracticeTaskType = 'case_study' | 'calculation'

export interface PracticeTask {
  id: string
  discipline_id: string
  task_number: number
  title: string
  content: string
  task_type: PracticeTaskType
  image_url: string | null
  image_attribution: string | null
  model_answer: string
  created_at: string
}

export interface PracticeResult {
  id: string
  task_id: string
  user_response: string
  score: number
  feedback: string
  submitted_at: string
}

export interface PracticeTaskWithResult extends PracticeTask {
  result: PracticeResult | null
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
