'use client'

import { useState, useEffect } from 'react'
import { useVoice, type VoiceStatus } from '@/lib/voice/VoiceContext'

const statusLabel: Record<VoiceStatus, string> = {
  idle:         'Голос',
  listening:    'Слушаю',
  recording:    'Запись',
  transcribing: 'Распознаю',
  processing:   'Думаю',
  speaking:     'Говорю',
}

const activeClass: Record<VoiceStatus, string> = {
  idle:         'border-gray-200 bg-white text-gray-400',
  listening:    'border-green-300 bg-green-50 text-green-700',
  recording:    'border-red-300 bg-red-50 text-red-700',
  transcribing: 'border-yellow-300 bg-yellow-50 text-yellow-700',
  processing:   'border-blue-200 bg-blue-50 text-blue-700',
  speaking:     'border-blue-200 bg-blue-50 text-blue-700',
}

export default function VoiceIndicator() {
  const { isActive, voiceStatus, voiceError, toggleVoice } = useVoice()
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    const handle = (e: Event) => setPanelOpen((e as CustomEvent<{ open: boolean }>).detail.open)
    window.addEventListener('panel:state-change', handle)
    return () => window.removeEventListener('panel:state-change', handle)
  }, [])

  if (panelOpen) return null

  const isPulsing = voiceStatus === 'listening' || voiceStatus === 'recording'
  // Распознавание и обдумывание — самая долгая часть ожидания. Обе фазы
  // должны читаться как «занят», иначе пользователь переспрашивает.
  const isSpinning = voiceStatus === 'transcribing' || voiceStatus === 'processing'

  const icon = voiceStatus === 'recording'    ? '🔴'
    : voiceStatus === 'speaking'              ? '🔊'
    : isSpinning                              ? '⟳'
    : '🎙️'

  // На мобильном подпись обычно скрыта ради места, но когда система занята,
  // она важнее компактности
  const busy = isSpinning || voiceStatus === 'speaking'

  const colorClass = isActive
    ? activeClass[voiceStatus]
    : 'border-gray-200 bg-white text-gray-400 hover:border-blue-300 hover:text-blue-500'

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1">
      <button
        onClick={toggleVoice}
        title={isActive ? 'Выключить голосовое управление' : 'Включить голосовое управление'}
        className={`
          flex items-center gap-1.5 border rounded-full px-3 py-1.5 text-sm
          shadow-md hover:shadow-lg transition-all duration-200 select-none
          ${colorClass}
          ${isPulsing ? 'animate-pulse' : ''}
        `}
      >
        <span className={isSpinning ? 'inline-block animate-spin' : ''}>{icon}</span>
        <span className={`text-xs font-medium ${busy ? 'inline' : 'hidden sm:inline'}`}>
          {statusLabel[voiceStatus]}
        </span>
      </button>

      {voiceError && (
        <span className="text-xs text-red-500 bg-white border border-red-100 rounded shadow-sm px-2 py-0.5">
          {voiceError}
        </span>
      )}
    </div>
  )
}
