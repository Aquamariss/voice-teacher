import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

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

  const data = await res.json() as { text: string }
  return Response.json({ text: data.text.trim() })
}
