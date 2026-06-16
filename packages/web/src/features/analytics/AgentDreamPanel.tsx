import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

export default function AgentDreamPanel({ roomId }: { roomId: string }) {
  const [dreams, setDreams] = useState<any[]>([])
  const [growth, setGrowth] = useState<any>({ reviews: [], proposals: [], memories: [] })
  const [loading, setLoading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setLoading(true)
      setError('')
      const [dreamData, growthData] = await Promise.all([api.getAgentDreams(roomId), api.getAgentGrowth(roomId)])
      setDreams(dreamData.dreams || [])
      setGrowth(growthData || { reviews: [], proposals: [], memories: [] })
    } catch (err: any) {
      setError(err?.message || '加载梦境成长失败')
    } finally {
      setLoading(false)
    }
  }

  const optimizeAgent = async () => {
    try {
      setOptimizing(true)
      setError('')
      await api.runAgentDreams({ roomId })
      await api.runAgentGrowth(roomId)
      await load()
    } catch (err: any) {
      setError(err?.message || '优化 Agent 失败')
    } finally {
      setOptimizing(false)
    }
  }
  const accept = async (id: string) => { try { await api.acceptAgentGrowthProposal(id); await load() } catch (err: any) { setError(err?.message || '采纳失败') } }
  const reject = async (id: string) => { try { await api.rejectAgentGrowthProposal(id); await load() } catch (err: any) { setError(err?.message || '忽略失败') } }
  const deleteMemory = async (id: string) => { try { await api.deleteAgentGrowthMemory(id); await load() } catch (err: any) { setError(err?.message || '删除记忆失败') } }

  useEffect(() => { load() }, [roomId])

  const proposals = growth.proposals || []
  const pending = proposals.filter((p: any) => p.status === 'pending')
  const memories = growth.memories || []

  return <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">梦境成长</h2>
        <p className="text-sm text-gray-500 mt-1">点击“优化 Agent”会同时执行避错复盘和习惯学习；成长建议默认等待你确认后才写入 Agent 记忆。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={load} disabled={loading} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-60">刷新</button>
        <button onClick={optimizeAgent} disabled={optimizing} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">{optimizing ? '优化中...' : '优化 Agent'}</button>
      </div>
    </div>
    {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">待确认成长建议</h3>
      {loading ? <p className="text-sm text-gray-400">加载中...</p> : pending.length === 0 ? <p className="text-sm text-gray-400">暂无待确认建议。可以手动生成，或等待每日成长复盘。</p> : <div className="space-y-3">
        {pending.map((item: any) => <div key={item.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><span className="rounded-full bg-white px-2 py-0.5 text-blue-600">{item.type}</span><span>{item.scope === 'agent' ? `Agent：${item.agentName || item.agentId}` : '项目记忆'}</span><span>置信度 {Math.round((item.confidence || 0) * 100)}%</span></div>
          <p className="mt-2 text-sm text-gray-800 break-words [overflow-wrap:anywhere]">{item.text}</p>
          {item.evidence?.length > 0 && <div className="mt-2 space-y-1 text-xs text-gray-500">{item.evidence.map((e: string, i: number) => <div key={i}>证据：{e}</div>)}</div>}
          <div className="mt-3 flex gap-2"><button onClick={() => accept(item.id)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">采纳</button><button onClick={() => reject(item.id)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200">忽略</button></div>
        </div>)}
      </div>}
    </div>

    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">已采纳记忆</h3>
      {memories.length === 0 ? <p className="text-sm text-gray-400">暂无已采纳记忆。采纳成长建议后会注入 Agent prompt 和工作区。</p> : <div className="space-y-2">
        {memories.map((item: any) => <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><span>{item.scope === 'agent' ? `Agent：${item.agentName || item.agentId}` : '项目记忆'}</span><span>{item.type}</span></div><p className="mt-1 text-sm text-gray-700 break-words [overflow-wrap:anywhere]">{item.text}</p></div>
          <button onClick={() => deleteMemory(item.id)} className="shrink-0 text-xs text-red-500 hover:text-red-700">删除</button>
        </div>)}
      </div>}
    </div>

    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">最近梦境复盘</h3>
      {dreams.length === 0 ? <p className="text-sm text-gray-400">暂无梦境记录。</p> : <div className="space-y-3">
        {dreams.slice(0, 6).map((dream: any) => <div key={dream.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><span className="font-medium text-gray-700">{dream.agentName || dream.agentId}</span><span>{dream.date}</span><span className={`rounded-full px-2 py-0.5 ${dream.status === 'applied' ? 'bg-green-100 text-green-700' : dream.status === 'no_safe_fix' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{dream.status}</span><span>失败信号 {dream.errorCount}</span></div>
          <p className="mt-2 text-sm text-gray-700 break-words [overflow-wrap:anywhere]">{dream.summary}</p>
        </div>)}
      </div>}
    </div>
  </section>
}
