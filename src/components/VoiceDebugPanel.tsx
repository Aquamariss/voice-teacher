'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { getLogEntries, subscribeLog, clearLog, type LogEntry } from '@/lib/voice/debugLog'

const DEBUG_KEY = 'voice-debug'

function fmtTime(t: number) {
  const d = new Date(t)
  return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${Math.floor(d.getMilliseconds() / 100)}`
}

const EMPTY: LogEntry[] = []

export default function VoiceDebugPanel() {
  const [enabled,  setEnabled]  = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied,   setCopied]   = useState(false)

  // Включаем через ?vdebug=1 (запоминается) либо ?vdebug=0 для выключения
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('vdebug')
    if (param === '1')      localStorage.setItem(DEBUG_KEY, '1')
    else if (param === '0') localStorage.removeItem(DEBUG_KEY)
    setEnabled(localStorage.getItem(DEBUG_KEY) === '1')
  }, [])

  const entries = useSyncExternalStore(
    subscribeLog,
    getLogEntries,
    () => EMPTY,
  )

  if (!enabled) return null

  const errorCount = entries.filter(e => e.level === 'error').length

  async function copyAll() {
    const text = entries.map(e => `${fmtTime(e.t)} [${e.level}] ${e.msg}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard может быть недоступен — показываем текст для ручного выделения
      setExpanded(true)
    }
  }

  return (
    <div className="fixed left-2 bottom-2 z-[80] font-mono text-[10px] max-w-[calc(100vw-1rem)]">
      {expanded ? (
        <div className="bg-black/90 text-green-300 rounded-lg shadow-2xl w-[min(92vw,480px)]">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/15">
            <span className="font-semibold text-white">voice log ({entries.length})</span>
            {errorCount > 0 && <span className="text-red-400">{errorCount} err</span>}
            <div className="ml-auto flex gap-2">
              <button onClick={copyAll} className="px-1.5 py-0.5 bg-white/15 rounded text-white">
                {copied ? '✓' : 'copy'}
              </button>
              <button onClick={clearLog} className="px-1.5 py-0.5 bg-white/15 rounded text-white">clr</button>
              <button onClick={() => setExpanded(false)} className="px-1.5 py-0.5 bg-white/15 rounded text-white">▾</button>
            </div>
          </div>
          <div className="max-h-[45vh] overflow-y-auto p-2 space-y-0.5 select-text">
            {entries.length === 0 && <p className="text-white/40">пусто</p>}
            {entries.map((e, i) => (
              <div
                key={i}
                className={
                  e.level === 'error' ? 'text-red-400'
                  : e.level === 'warn' ? 'text-yellow-300'
                  : 'text-green-300'
                }
              >
                <span className="text-white/35">{fmtTime(e.t)} </span>
                {e.msg}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="bg-black/80 text-white px-2.5 py-1.5 rounded-lg shadow-lg"
        >
          log {entries.length}{errorCount > 0 ? ` · ${errorCount}❗` : ''}
        </button>
      )}
    </div>
  )
}
