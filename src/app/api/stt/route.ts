import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

// Известные Whisper-галлюцинации на русском при тишине/шуме
// Источник: openai/whisper#1606, community.openai.com/t/125300
const WHISPER_HALLUCINATIONS = new Set([
  'спасибо', 'спасибо.', 'спасибо!',
  'спасибо за просмотр', 'спасибо за просмотр.',
  'до свидания', 'до свидания.',
  'продолжение следует', 'продолжение следует...',
  'подписывайтесь на канал',
  'субтитры создавались при поддержке субтитры создавались при поддержке',
  'всё', 'всё.', 'ага', 'ага.', 'угу', 'угу.',
  'да', 'да.', 'нет', 'нет.',
  'хорошо', 'хорошо.', 'понятно', 'понятно.',
  'thank you', 'thank you.', 'thanks', 'you',
  'goodbye', 'bye', 'okay', 'ok',
])

interface WhisperVerboseResponse {
  text: string
  segments?: Array<{
    no_speech_prob: number
  }>
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return new Response('OPENAI_API_KEY not set', { status: 500 })

  const formData = await request.formData()
  const audio = formData.get('audio') as Blob | null
  if (!audio) return new Response('No audio', { status: 400 })

  const whisperForm = new FormData()
  whisperForm.append('file', audio, 'recording.webm')
  whisperForm.append('model', 'whisper-1')
  whisperForm.append('language', 'ru')
  whisperForm.append('response_format', 'verbose_json')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: whisperForm,
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[stt] Whisper error:', res.status, err)
    return new Response('STT error', { status: res.status })
  }

  const data = await res.json() as WhisperVerboseResponse
  const text = data.text.trim()

  // Проверяем no_speech_prob — если Whisper сам считает что речи нет, игнорируем
  if (data.segments && data.segments.length > 0) {
    const avgNoSpeechProb = data.segments.reduce((s, seg) => s + seg.no_speech_prob, 0) / data.segments.length
    if (avgNoSpeechProb > 0.6) {
      console.log(`[stt] Discarded hallucination (no_speech_prob=${avgNoSpeechProb.toFixed(2)}): "${text}"`)
      return Response.json({ text: '' })
    }
  }

  // Фильтр известных галлюцинаций Whisper на тишине
  if (WHISPER_HALLUCINATIONS.has(text.toLowerCase())) {
    console.log(`[stt] Discarded known hallucination: "${text}"`)
    return Response.json({ text: '' })
  }

  return Response.json({ text })
}
