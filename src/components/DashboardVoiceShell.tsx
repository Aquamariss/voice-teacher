'use client'

import { VoiceProvider } from '@/lib/voice/VoiceContext'
import AssistantPanel from './AssistantPanel'

export default function DashboardVoiceShell() {
  return (
    <VoiceProvider>
      <AssistantPanel />
    </VoiceProvider>
  )
}
