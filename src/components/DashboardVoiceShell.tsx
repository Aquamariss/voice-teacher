'use client'

import { VoiceProvider } from '@/lib/voice/VoiceContext'
import AssistantPanel from './AssistantPanel'
import VoiceIndicator from './VoiceIndicator'

export default function DashboardVoiceShell() {
  return (
    <VoiceProvider>
      <AssistantPanel />
      <VoiceIndicator />
    </VoiceProvider>
  )
}
