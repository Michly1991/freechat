import { useEffect, useState } from 'react'
import { Clipboard, Trash2 } from 'lucide-react'
import { addClientLog, clearClientLogs, formatClientLogs, getClientLogs, subscribeClientLogs, type ClientLogEntry } from '../../lib/clientLog'

type Props = {
  roomId?: string
  user?: any
  wsStatus?: string
  hasToken?: boolean
  note?: string
}

export function RoomDiagnosticsPanel({ roomId, user, wsStatus = '设置页不保持房间实时连接', hasToken = false, note }: Props) {
  const [clientLogs, setClientLogs] = useState<ClientLogEntry[]>(getClientLogs())

  useEffect(() => {
    const unsubscribe = subscribeClientLogs(setClientLogs)
    return () => { unsubscribe() }
  }, [])

  const diagnosticsText = formatClientLogs(clientLogs)
  const copyDiagnostics = async () => {
    const status = [
      `Host: ${window.location.host}`,
      `Path: ${window.location.pathname}`,
      `Room: ${roomId || ''}`,
      `WebSocket: ${wsStatus}`,
      `Token: ${hasToken ? 'present' : 'missing'}`,
      `User: ${user?.username || user?.nickname || ''}`,
      '',
      diagnosticsText,
    ].join('\n')
    await navigator.clipboard?.writeText(status)
    addClientLog('info', 'ui', 'diagnostics copied')
  }

  const clearLogs = () => {
    clearClientLogs()
    addClientLog('info', 'ui', 'diagnostics cleared')
  }

  return <section className="rounded-lg border border-gray-200 bg-white p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">诊断日志</h2>
        <p className="mt-1 text-sm text-gray-500">用于排查连接、鉴权和前端请求问题；日志只保存在当前浏览器内存，不包含完整 token。</p>
        {note && <p className="mt-1 text-xs text-gray-400">{note}</p>}
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={copyDiagnostics} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"><Clipboard className="w-4 h-4" />复制</button>
        <button onClick={clearLogs} className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"><Trash2 className="w-4 h-4" />清空</button>
      </div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
      <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-400">WS</span><div className="mt-1 font-mono break-all text-gray-700">{wsStatus}</div></div>
      <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-400">Token</span><div className="mt-1 font-mono text-gray-700">{hasToken ? 'present' : 'missing'}</div></div>
      <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-400">Room</span><div className="mt-1 font-mono truncate text-gray-700">{roomId || '-'}</div></div>
      <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-400">Host</span><div className="mt-1 font-mono truncate text-gray-700">{window.location.host}</div></div>
      <div className="rounded-lg bg-gray-50 p-3"><span className="text-gray-400">Logs</span><div className="mt-1 font-mono text-gray-700">{clientLogs.length}</div></div>
    </div>

    <pre className="mt-4 max-h-[55vh] min-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-950 p-4 text-[11px] leading-relaxed text-gray-100">{diagnosticsText || '暂无日志'}</pre>
  </section>
}
