'use client'

import { useState, useEffect, useCallback } from 'react'

const MALE_VOICE_ID = 'dDrxNxaZh4FWXi47dZ7y'
const FEMALE_VOICE_ID = 'xyu8HSCv1JYrhLx4m8UG'
const STORAGE_KEY = 'voice_settings'

export type VoiceGender = 'male' | 'female'

interface StoredSettings {
  language: string
  gender: VoiceGender
  voiceId: string
}

const DEFAULTS: StoredSettings = {
  language: 'ru',
  gender: 'male',
  voiceId: MALE_VOICE_ID,
}

function readStorage(): StoredSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function writeStorage(s: StoredSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

/** Read-only synchronous accessor — safe to call inside event handlers after hydration */
export function getVoiceId(): string {
  return readStorage().voiceId
}

export function useVoiceSettings() {
  const [settings, setSettings] = useState<StoredSettings>(DEFAULTS)

  useEffect(() => {
    setSettings(readStorage())
  }, [])

  const setLanguage = useCallback((language: string) => {
    setSettings(prev => {
      const next = { ...prev, language }
      writeStorage(next)
      return next
    })
  }, [])

  const setGender = useCallback((gender: VoiceGender) => {
    setSettings(prev => {
      const next = { ...prev, gender, voiceId: gender === 'male' ? MALE_VOICE_ID : FEMALE_VOICE_ID }
      writeStorage(next)
      return next
    })
  }, [])

  return { ...settings, setLanguage, setGender }
}
