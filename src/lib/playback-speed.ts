export const SPEED_KEY = 'voice-teacher:playback-speed'
export const SPEEDS    = [0.75, 1, 1.25, 1.5]

export function getSavedSpeed(): number {
  if (typeof window === 'undefined') return 1
  const saved = parseFloat(localStorage.getItem(SPEED_KEY) ?? '1')
  return SPEEDS.includes(saved) ? saved : 1
}
