import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export interface ImageConcept {
  concept: string
  wikipedia_title: string
}

const SYSTEM_PROMPT = `You extract visual concepts from educational text for Wikipedia image lookup.

Given a text fragment from a lesson, output a JSON array (0–2 items) of concepts that would genuinely benefit from a diagram or illustration — things like physical laws, orbital mechanics, force diagrams, wave phenomena, geometric constructions, chemical processes, etc.

ONLY include concepts where a visual genuinely aids understanding of calculations, motion, or processes. Skip abstract ideas, historical narratives, or purely descriptive passages.

For each concept output:
- "concept": short name in Russian (1–4 words)
- "wikipedia_title": the most likely English Wikipedia article title for this concept (2–6 words, no extra words like "diagram" — just the article name)

Output ONLY a JSON array, no prose. Example:
[{"concept":"законы Кеплера","wikipedia_title":"Kepler's laws of planetary motion"},{"concept":"гравитационный манёвр","wikipedia_title":"Gravity assist"}]

If nothing is genuinely visualizable, output: []`

export async function extractImageConcepts(partText: string): Promise<ImageConcept[]> {
  const cleanText = partText.replace(/\$[^$]+\$/g, '').trim()
  if (cleanText.length < 50) return []

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: cleanText.slice(0, 2000) }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()

  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) return parsed.slice(0, 2)
  } catch {
    // non-fatal
  }
  return []
}
