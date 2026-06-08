export type ClientLogLevel = 'info' | 'warn' | 'error'
export type ClientLogSource = 'ws' | 'api' | 'auth' | 'ui'

export interface ClientLogEntry {
  id: number
  time: number
  level: ClientLogLevel
  source: ClientLogSource
  message: string
  detail?: unknown
}

type Listener = (logs: ClientLogEntry[]) => void

const MAX_LOGS = 200
let seq = 0
let logs: ClientLogEntry[] = []
const listeners = new Set<Listener>()

function safeDetail(detail: unknown) {
  if (detail === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(detail, (_key, value) => {
      if (typeof value === 'string' && value.length > 1200) return `${value.slice(0, 1200)}…`
      return value
    }))
  } catch {
    return String(detail)
  }
}

export function addClientLog(level: ClientLogLevel, source: ClientLogSource, message: string, detail?: unknown) {
  const entry: ClientLogEntry = {
    id: ++seq,
    time: Date.now(),
    level,
    source,
    message,
    detail: safeDetail(detail),
  }
  logs = [...logs, entry].slice(-MAX_LOGS)
  listeners.forEach((listener) => listener(logs))
}

export function getClientLogs() {
  return logs
}

export function clearClientLogs() {
  logs = []
  listeners.forEach((listener) => listener(logs))
}

export function subscribeClientLogs(listener: Listener) {
  listeners.add(listener)
  listener(logs)
  return () => listeners.delete(listener)
}

export function formatClientLog(entry: ClientLogEntry) {
  const time = new Date(entry.time).toLocaleTimeString()
  const detail = entry.detail === undefined ? '' : ` ${JSON.stringify(entry.detail)}`
  return `${time} [${entry.level}] [${entry.source}] ${entry.message}${detail}`
}

export function formatClientLogs(entries = logs) {
  return entries.map(formatClientLog).join('\n')
}
