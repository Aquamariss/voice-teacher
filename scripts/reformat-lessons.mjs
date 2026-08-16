// One-time script: add ## subheadings and **bold** terms to cosmology lesson parts
// Run: node scripts/reformat-lessons.mjs

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const COSMOLOGY_LESSON_IDS = [
  '7d5b6c17-e9e7-4716-8c5a-a7114bed5ee9',  // Гравитация
  '850f28e8-4f85-42ee-8cf3-378326f301d6',  // Орбитальная механика
  'e9c3c338-8696-4bab-9f5f-499c05afb617',  // Законы Кеплера
]

const SYSTEM_PROMPT = `Ты редактируешь текст учебной лекции. Твоя задача — добавить визуальную структуру, не меняя слова и смысл.

Правила:
1. Раздели текст на 2–3 смысловых блока. Перед каждым блоком добавь подзаголовок: ## Короткое название (3–6 слов).
2. При ПЕРВОМ упоминании ключевых терминов (законы, эффекты, специальные понятия, имена собственные в научном контексте) добавь ** вокруг термина: **перигелий**, **закон Ньютона**, **первая космическая скорость**.
3. Не выделяй жирным обычные слова, числа или целые предложения.
4. LaTeX-формулы ($...$) оставь строго без изменений.
5. Весь остальной текст — слово в слово, без перефразирования.

Выведи только отредактированный текст, без объяснений.`

async function reformatPart(content) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  })
  return msg.content[0].text.trim()
}

async function main() {
  const { data: parts, error } = await supabase
    .from('lesson_parts')
    .select('id, lesson_id, part_number, content')
    .in('lesson_id', COSMOLOGY_LESSON_IDS)
    .not('content', 'is', null)
    .order('lesson_id')
    .order('part_number')

  if (error) { console.error('DB error:', error); process.exit(1) }

  console.log(`Found ${parts.length} parts to reformat\n`)

  for (const part of parts) {
    console.log(`Reformatting lesson ${part.lesson_id} part ${part.part_number}...`)
    try {
      const newContent = await reformatPart(part.content)
      const { error: updateErr } = await supabase
        .from('lesson_parts')
        .update({ content: newContent })
        .eq('id', part.id)
      if (updateErr) throw updateErr
      console.log(`  ✓ Updated (${newContent.length} chars)`)
    } catch (e) {
      console.error(`  ✗ Failed:`, e.message)
    }
  }

  console.log('\nDone.')
}

main()
