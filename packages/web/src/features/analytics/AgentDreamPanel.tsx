import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

export default function AgentDreamPanel({ roomId }: { roomId: string }) {
  const [dreams, setDreams] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await api.getAgentDreams(roomId)
      setDreams(data.dreams || [])
    } catch (err: any) {
      setError(err?.message || '加载梦境失败')
    } finally {
      setLoading(false)
    }
  }

  const run = async () => {
    try {
      setRunning(true)
      setError('')
      await api.runAgentDreams({ roomId })
      await load()
    } catch (err: any) {
      setError(err?.message || '运行梦境失败')
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => { load() }, [roomId])

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">梦境复盘</h2>
          <p className="text-sm text-gray-500 mt-1">夜间根据 Agent 当天失败自动写入避错记忆，不直接改 Skill/描述。</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-60">刷新</button>
          <button onClick={run} disabled={running} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">{running ? '复盘中...' : '手动复盘'}</button>
        </div>
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {loading ? <p className="text-sm text-gray-400">加载中...</p> : dreams.length === 0 ? <p className="text-sm text-gray-400">暂无梦境记录。</p> : (
        <div className="space-y-3">
          {dreams.slice(0, 8).map((dream) => (
            <div key={dream.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">{dream.agentName || dream.agentId}</span>
                <span>{dream.date}</span>
                <span className={`rounded-full px-2 py-0.5 ${dream.status === 'applied' ? 'bg-green-100 text-green-700' : dream.status === 'no_safe_fix' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{dream.status}</span>
                <span>失败信号 {dream.errorCount}</span>
              </div>
              <p className="mt-2 text-sm text-gray-700 break-words [overflow-wrap:anywhere]">{dream.summary}</p>
              {dream.appliedChanges?.length > 0 && <div className="mt-2 space-y-1 text-xs text-gray-500">
                {dream.appliedChanges.map((item: any, index: number) => <div key={index}>- {item.text}</div>)}
              </div>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
