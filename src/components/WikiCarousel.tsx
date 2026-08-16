'use client'
import { useState } from 'react'

export interface WikiImage {
  title: string
  url: string
  thumbnail: string
}

export default function WikiCarousel({ images }: { images: WikiImage[] }) {
  const [idx, setIdx] = useState(0)
  if (!images.length) return null

  const img = images[idx]
  const multi = images.length > 1

  return (
    <div className="mt-2 rounded-lg overflow-hidden bg-gray-200">
      <a href={img.url} target="_blank" rel="noopener noreferrer" className="block relative">
        <img
          src={img.thumbnail}
          alt={img.title}
          className="w-full h-40 object-cover"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
          <p className="text-white text-xs truncate">{img.title}</p>
        </div>
      </a>
      {multi && (
        <div className="flex items-center justify-between px-2 py-1">
          <button
            onClick={() => setIdx(i => (i - 1 + images.length) % images.length)}
            className="text-gray-500 hover:text-gray-700 text-base leading-none px-1"
            aria-label="Предыдущее"
          >
            ‹
          </button>
          <div className="flex gap-1.5 items-center">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-gray-600' : 'bg-gray-400'}`}
                aria-label={`Фото ${i + 1}`}
              />
            ))}
          </div>
          <button
            onClick={() => setIdx(i => (i + 1) % images.length)}
            className="text-gray-500 hover:text-gray-700 text-base leading-none px-1"
            aria-label="Следующее"
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
