'use client'

import { VoiceProvider } from '@/lib/voice/VoiceContext'
import AssistantPanel from './AssistantPanel'
import VoiceDebugPanel from './VoiceDebugPanel'

export default function DashboardVoiceShell() {
  return (
    <VoiceProvider>
      <AssistantPanel />
      <VoiceDebugPanel />
    </VoiceProvider>
  )
}
