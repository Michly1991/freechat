export type NotificationSoundKind = 'message' | 'mention' | 'done' | 'error'

export interface NotificationSoundPrefs {
  soundEnabled: boolean
  strongSoundEnabled: boolean
  messageSoundEnabled: boolean
}

const PREF_KEY = 'freechat:notificationSoundPrefs'
const DEFAULT_PREFS: NotificationSoundPrefs = { soundEnabled: true, strongSoundEnabled: true, messageSoundEnabled: false }
const lastPlayed = new Map<string, number>()
let audioCtx: AudioContext | null = null

export function getNotificationSoundPrefs(): NotificationSoundPrefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } }
  catch { return DEFAULT_PREFS }
}

export function setNotificationSoundPrefs(prefs: Partial<NotificationSoundPrefs>) {
  const next = { ...getNotificationSoundPrefs(), ...prefs }
  localStorage.setItem(PREF_KEY, JSON.stringify(next))
  return next
}

function getAudioContext() {
  const Ctor = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) audioCtx = new Ctor()
  return audioCtx
}

export async function unlockNotificationSound() {
  const ctx = getAudioContext()
  if (!ctx) return false
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
  return ctx.state === 'running'
}

function canPlay(key: string, intervalMs = 5000) {
  const now = Date.now()
  const last = lastPlayed.get(key) || 0
  if (now - last < intervalMs) return false
  lastPlayed.set(key, now)
  return true
}

function tone(ctx: AudioContext, start: number, freq: number, duration: number, volume: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

export async function playNotificationSound(kind: NotificationSoundKind, key: string = kind, force = false) {
  const prefs = getNotificationSoundPrefs()
  if (!force) {
    if (!prefs.soundEnabled) return false
    if (kind === 'message' && !prefs.messageSoundEnabled) return false
    if (kind !== 'message' && !prefs.strongSoundEnabled) return false
    if (!canPlay(key)) return false
  }
  const ctx = getAudioContext()
  if (!ctx) return false
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
  if (ctx.state !== 'running') return false
  const t = ctx.currentTime
  if (kind === 'message') tone(ctx, t, 740, 0.08, 0.035)
  else if (kind === 'mention') { tone(ctx, t, 660, 0.09, 0.045); tone(ctx, t + 0.12, 880, 0.1, 0.04) }
  else if (kind === 'done') { tone(ctx, t, 600, 0.08, 0.04); tone(ctx, t + 0.1, 900, 0.12, 0.04) }
  else { tone(ctx, t, 220, 0.14, 0.05) }
  return true
}

export function soundKindForNotification(notification: any): NotificationSoundKind {
  if (notification?.type === 'agent_done') return 'done'
  if (notification?.type === 'mention' || notification?.type === 'task_assigned') return 'mention'
  return 'message'
}

export function isStrongNotification(notification: any) {
  return ['mention', 'task_assigned', 'agent_done'].includes(notification?.type)
}
