'use client'

import { useVoiceSettings } from '@/lib/voice/voiceSettings'

const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

export default function VoiceSettings() {
  const { language, gender, setLanguage, setGender } = useVoiceSettings()

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mt-8">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Настройки голоса</h2>
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-gray-500 mb-2">Язык обучения</p>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  language === l.code
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Использование выбранного языка будет реализовано в следующей версии.</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2">Голос учителя</p>
          <div className="flex gap-1.5">
            {(['male', 'female'] as const).map(g => (
              <button
                key={g}
                onClick={() => setGender(g)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  gender === g
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {g === 'male' ? 'Мужской' : 'Женский'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
