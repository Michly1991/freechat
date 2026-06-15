import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { ms, n, pct, StatCard, time } from './analytics-format'

type Scope = 'member' | 'owned' | 'triggered'

type Analytics = {
  range: { scope: Scope }
  summary: any
  agents: any[]
  rooms: any[]
  tools: any[]
}

export default function PersonalAnalyticsPanel() {
  const navigate = useNavigate()
  const [scope, setScope] = useState<Scope>('member')
  const [data, setData] = useState<Analytics | null>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [detail, setDetail] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(() => typeof window === 'undefined' ? true : window.innerWidth >= 640)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [overview, runList] = await Promise.all([
        api.getPersonalAnalytics({ scope }),
        api.getPersonalAnalyticsRuns({ scope, pageSize: 10 }),
      ])
      setData(overview as Analytics)
      setRuns((runList as any).items || [])
    } catch (err: any) {
      setError(err?.message || '全局分析加载失败')
      setData(null)
      setRuns([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [scope])

  const openRun = async (runId: string) => {
    try {
      setDetail(await api.getPersonalAnalyticsRunDetail(runId))
    } catch (err: any) {
      setError(err?.message || '运行详情加载失败')
    }
  }

  const s = data?.summary || {}

  return <section className="bg-white rounded-xl p-6 shadow-sm space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">全局分析</h2>
        <p className="text-xs text-gray-400 mt-1">统计你参与的项目中各 Agent 的 token、耗时和工具健康度。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {([
          ['member', '我参与的'],
          ['owned', '我创建的'],
          ['triggered', '我触发的'],
        ] as [Scope, string][]).map(([key, label]) => <button key={key} onClick={() => setScope(key)} className={`px-3 py-1.5 rounded-lg text-xs ${scope === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{label}</button>)}
        <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 text-gray-600">刷新</button>
        <button onClick={() => setExpanded((value) => !value)} className="sm:hidden px-3 py-1.5 rounded-lg text-xs bg-gray-100 text-gray-600">{expanded ? '收起详情' : '展开详情'}</button>
      </div>
    </div>

    {!data && <p className="text-sm text-gray-500">{loading ? '正在加载全局分析…' : (error || '暂无全局分析数据。')}</p>}

    {data && <>
      {error && <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="总 Token" value={n(s.totalTokens)} sub={`前 ${n(s.inputTokens)} / 后 ${n(s.outputTokens)}`} />
        <StatCard label="Agent 调用" value={n(s.runCount)} sub={`成功 ${n(s.successCount)} / 失败 ${n(s.failedCount)}`} />
        <StatCard label="项目 / Agent" value={`${n(s.roomCount)} / ${n(s.agentCount)}`} sub={`实例 ${n(s.agentInstanceCount)}`} />
        <StatCard label="工具失败率" value={pct(s.toolFailureRate)} sub={`失败 ${n(s.toolFailedCount)} / 调用 ${n(s.toolCallCount)}`} />
      </div>

      {expanded && <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">各 Agent 消耗排行</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left p-2">Agent</th><th className="text-right p-2">项目</th><th className="text-right p-2">调用</th><th className="text-right p-2">前 token</th><th className="text-right p-2">后 token</th><th className="text-right p-2">总 token</th><th className="text-right p-2">均耗时</th></tr></thead>
            <tbody>
              {data.agents.map((a) => <tr key={a.agentKey} className="border-t border-gray-100">
                <td className="p-2 whitespace-nowrap">{a.agentName}<span className="ml-2 text-xs text-gray-400">{a.roleType}</span></td>
                <td className="p-2 text-right">{n(a.roomCount)}</td>
                <td className="p-2 text-right">{n(a.runCount)}</td>
                <td className="p-2 text-right">{n(a.inputTokens)}</td>
                <td className="p-2 text-right">{n(a.outputTokens)}</td>
                <td className="p-2 text-right font-medium">{n(a.totalTokens)}</td>
                <td className="p-2 text-right">{ms(a.avgDurationMs)}</td>
              </tr>)}
              {data.agents.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-400">暂无 Agent 运行记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>}

      {expanded && <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">项目消耗排行</h3>
          <div className="space-y-2">
            {data.rooms.slice(0, 8).map((r) => <button key={r.roomId} onClick={() => navigate(`/room/${r.roomId}/settings`)} className="w-full text-left rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
              <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm truncate">{r.roomName}</span><span className="text-xs text-gray-400">{n(r.totalTokens)} token</span></div>
              <div className="mt-1 text-xs text-gray-500">调用 {n(r.runCount)} · 工具 {n(r.toolCallCount)} · 失败 {n(r.toolFailedCount)}</div>
            </button>)}
            {data.rooms.length === 0 && <p className="text-sm text-gray-400">暂无项目统计</p>}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">工具健康度</h3>
          <div className="space-y-2">
            {data.tools.slice(0, 8).map((t) => <div key={t.toolName} className="rounded-lg border border-gray-100 p-3">
              <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm break-all">{t.toolName}</span><span className={`text-xs px-2 py-0.5 rounded-full ${t.failedCount ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{pct(t.failureRate)}</span></div>
              <div className="mt-1 text-xs text-gray-500">调用 {n(t.callCount)} · 失败 {n(t.failedCount)} · 均耗时 {ms(t.avgDurationMs)}</div>
            </div>)}
            {data.tools.length === 0 && <p className="text-sm text-gray-400">暂无工具统计</p>}
          </div>
        </div>
      </div>}

      {expanded && <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">最近运行</h3>
        <div className="space-y-2">
          {runs.map((r) => <button key={r.runId} onClick={() => openRun(r.runId)} className="w-full text-left rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
            <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">{r.agentName}</span><span className="text-xs text-gray-400">{time(r.startedAt)}</span></div>
            <div className="mt-1 text-xs text-gray-500 truncate">{r.roomName}</div>
            <div className="mt-1 text-xs text-gray-500 line-clamp-2 break-words">{r.inputPreview}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400"><span>{r.status}</span><span>Token {n(r.totalTokens)}</span><span>耗时 {ms(r.durationMs)}</span></div>
          </button>)}
          {runs.length === 0 && <p className="text-sm text-gray-400">暂无运行记录</p>}
        </div>
      </div>}
    </>}

    {detail && <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setDetail(null)}>
      <div className="bg-white w-full sm:max-w-3xl max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">运行详情</h3><button onClick={() => setDetail(null)} className="text-gray-400">✕</button></div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2"><StatCard label="总 Token" value={n(detail.run.totalTokens)} /><StatCard label="前 token" value={n(detail.run.inputTokens)} /><StatCard label="后 token" value={n(detail.run.outputTokens)} /><StatCard label="耗时" value={ms(detail.run.durationMs)} /></div>
        <div className="mt-4"><div className="text-xs text-gray-500 mb-1">输入</div><pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs bg-gray-50 rounded p-3 max-h-40 overflow-auto">{detail.run.input}</pre></div>
        <div className="mt-4"><div className="text-xs text-gray-500 mb-1">工具调用</div><div className="space-y-2">{detail.toolCalls.map((c: any) => <div key={c.id} className="rounded border border-gray-100 p-2 text-xs"><div className="flex justify-between gap-2"><b>{c.toolName}</b><span className={c.status === 'failed' ? 'text-red-600' : 'text-green-600'}>{c.status}</span></div><div className="text-gray-400 mt-1">耗时 {ms(c.durationMs)}</div>{c.errorMessage && <div className="text-red-600 mt-1 break-words [overflow-wrap:anywhere]">{c.errorCode}: {c.errorMessage}</div>}</div>)}</div></div>
      </div>
    </div>}
  </section>
}
