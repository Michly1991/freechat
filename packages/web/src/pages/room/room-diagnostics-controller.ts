import { useEffect, useState } from 'react'
import { addClientLog, formatClientLogs, getClientLogs, subscribeClientLogs, type ClientLogEntry } from '../../lib/clientLog'

interface DiagnosticsDeps {
  roomId?: string
  user?: any
  token?: string | null
  wsStatus: string
  getCurrentToken: () => string
}

export function useRoomDiagnostics({ roomId, user, token, wsStatus, getCurrentToken }: DiagnosticsDeps) {
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [clientLogs, setClientLogs] = useState<ClientLogEntry[]>(getClientLogs())

  useEffect(() => {
    const unsubscribe = subscribeClientLogs(setClientLogs)
    return () => { unsubscribe() }
  }, [])

  useEffect(() => {
    addClientLog('info', 'auth', 'auth state changed', {
      token: getCurrentToken() ? 'present' : 'missing',
      user: user?.username || user?.nickname || null,
    })
  }, [token, user?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setShowDiagnostics((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const diagnosticsText = formatClientLogs(clientLogs)
  const copyDiagnostics = async () => {
    const status = [
      `Host: ${window.location.host}`,
      `Room: ${roomId || ''}`,
      `WebSocket: ${wsStatus}`,
      `Token: ${getCurrentToken() ? 'present' : 'missing'}`,
      `User: ${user?.username || user?.nickname || ''}`,
      '',
      diagnosticsText,
    ].join('\n')
    await navigator.clipboard?.writeText(status)
    addClientLog('info', 'ui', 'diagnostics copied')
  }

  return { showDiagnostics, setShowDiagnostics, clientLogs, diagnosticsText, copyDiagnostics }
}
