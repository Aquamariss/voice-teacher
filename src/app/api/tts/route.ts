import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID!
const API_KEY = process.env.ELEVENLABS_API_KEY!

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { text, voiceId } = await request.json() as { text: string; voiceId?: string }
  if (!text?.trim()) return new Response('No text', { status: 400 })

  const effectiveVoiceId = voiceId?.trim() || VOICE_ID

  const t0 = Date.now()
  console.log(`[tts] → ElevenLabs, chars=${text.length}, voice=${effectiveVoiceId}`)

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${effectiveVoiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          // style и use_speaker_boost убраны — они удваивают время генерации
        },
      }),
    }
  )

  console.log(`[tts] ← headers in ${Date.now() - t0}ms, status=${res.status}`)

  if (!res.ok) {
    const err = await res.text()
    console.error('[tts] ElevenLabs error:', res.status, err)
    return new Response('TTS error: ' + err, { status: res.status })
  }

  // Проксируем аудио-стрим напрямую клиенту
  return new Response(res.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  })
}
