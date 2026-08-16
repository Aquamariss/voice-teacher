'use client'

import { useEffect, useRef, useState } from 'react'
import type { LessonImage } from '@/types/db'

// Strips LaTeX blocks, ## headings and **bold** markers for TTS narration
export function stripLatex(text: string): string {
  return text
    .replace(/\$\$[\s\S]+?\$\$/g, '')   // display math $$...$$
    .replace(/\$[^$\n]+\$/g, '')          // inline math $...$
    .replace(/^##\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── LaTeX block renderer ─────────────────────────────────────────────────────

function LatexBlock({ formula }: { formula: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    import('katex').then(({ default: katex }) => {
      try {
        katex.render(formula, ref.current!, {
          throwOnError: false,
          displayMode: true,
          output: 'html',
        })
      } catch {
        setError(true)
      }
    })
  }, [formula])

  if (error) return null
  return (
    <div
      ref={ref}
      className="my-3 overflow-x-auto py-2 text-center text-gray-700"
    />
  )
}

// ── Inline renderer: bold and LaTeX within a line ────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  // Match $$...$$ before $...$ so double-dollar display math is captured first
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\*\*[^*\n]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
      return <LatexBlock key={i} formula={part.slice(2, -2)} />
    }
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      return <LatexBlock key={i} formula={part.slice(1, -1)} />
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
    }
    return <span key={i}>{part}</span>
  })
}

// ── Part text with headings, bold and LaTeX support ──────────────────────────

export function PartText({ content }: { content: string }) {
  // Split into paragraph blocks (double newline)
  const blocks = content.split(/\n\n+/)

  return (
    <div className="text-sm text-gray-800 leading-relaxed">
      {blocks.map((block, i) => {
        const trimmed = block.trim()
        if (!trimmed) return null

        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={i} className="text-sm font-semibold text-gray-900 mt-4 mb-1 uppercase tracking-wide">
              {trimmed.slice(3)}
            </h2>
          )
        }

        return (
          <div key={i} className="mb-3">
            {renderInline(trimmed)}
          </div>
        )
      })}
    </div>
  )
}

// ── Image cards ──────────────────────────────────────────────────────────────

function ImageCards({ images }: { images: LessonImage[] }) {
  const [activeIdx, setActiveIdx] = useState(0)
  if (images.length === 0) return null
  const img = images[activeIdx]

  return (
    <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="relative bg-gray-50 flex items-center justify-center min-h-[160px] p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.thumbnail_url}
          alt={img.title}
          className="max-h-64 max-w-full object-contain rounded"
        />
      </div>
      <div className="px-4 py-2 border-t border-gray-100">
        {img.description && (
          <p className="text-xs text-gray-700 mb-1 leading-snug">{img.description}</p>
        )}
        <p className="text-xs text-gray-400">
          {img.author} · {img.license} ·{' '}
          <a
            href={img.source_page_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-blue-600"
          >
            Wikipedia
          </a>
        </p>
      </div>
      {images.length > 1 && (
        <div className="flex border-t border-gray-100">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`flex-1 py-1.5 text-xs transition-colors ${
                i === activeIdx
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-400 hover:bg-gray-50'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function PartContent({
  content,
  images,
}: {
  content: string
  images?: LessonImage[] | null
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
      <PartText content={content} />
      {images && images.length > 0 && <ImageCards images={images} />}
    </div>
  )
}
