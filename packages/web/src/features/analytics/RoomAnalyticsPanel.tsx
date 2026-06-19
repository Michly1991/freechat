import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../lib/api'

type Props = { roomId: string }

type Analytics = {
  summary: any
  agents: any[]
  tools: any[]
  errorCodes: any[]
  recentErrors: any[]
}

const nf = new Intl.NumberFormat('zh-CN')

function n(value: any) { return nf.format(Math.round(Number(value || 0))) }
function pct(value: any) { return `${(Number(value || 0) * 100).toFixed(1)}%` }
function ms(value: any) {
  const v = Number(value || 0)
  if (!v) return '-'
  if (v < 1000) return `${Math.round(v)}ms`
  if (v < 60000) return `${(v / 1000).toFixed(1)}s`
  return `${Math.floor(v / 60000)}m ${Math.round((v % 60000) / 1000)}s`
}
function time(value: any) { return value ? new Date(Number(value)).toLocaleString() : '-' }

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
  </div>
}

export default function RoomAnalyticsPanel({ roomId }: Props) {
  const [data, setData] = useState<Analytics | null>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<any | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [overview, runList] = await Promise.all([
        api.getRoomAnalytics(roomId),
        api.getRoomAnalyticsRuns(roomId, { pageSize: 10 }),
      ])
      setData(overview as Analytics)
      setRuns((runList as any).items || [])
    } catch (err: any) {
      setError(err?.message || '分析数据加载失败')
      setData(null)
      setRuns([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [roomId])

  const openRun = async (runId: string) => {
    try {
      const next = await api.getRoomAnalyticsRunDetail(roomId, runId)
      setDetail(next)
    } catch (err: any) {
      setError(err?.message || '运行详情加载失败')
    }
  }

  if (!data) {
    return <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">分析</h2>
        <button onClick={load} className="text-sm text-blue-600">刷新</button>
      </div>
      <p className="mt-3 text-sm text-gray-500">{loading ? '正在加载分析数据…' : (error || '暂无分析数据。Agent 运行后会自动记录 token、耗时和工具错误。')}</p>
    </section>
  }

  const s = data.summary || {}

  return <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-6">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">分析</h2>
        <p className="text-xs text-gray-400 mt-1">统计本房间 Agent token、运行耗时、工具耗时和工具报错。</p>
      </div>
      <button onClick={load} className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200">刷新</button>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="Agent 调用" value={n(s.runCount)} sub={`成功 ${n(s.successCount)} / 失败 ${n(s.failedCount)}`} />
      <StatCard label="总 Token" value={n(s.totalTokens)} sub={`前 ${n(s.inputTokens)} / 后 ${n(s.outputTokens)}`} />
      <StatCard label="平均运行耗时" value={ms(s.avgDurationMs)} sub={`总 ${ms(s.totalDurationMs)}`} />
      <StatCard label="工具调用" value={n(s.toolCallCount)} sub={`工具耗时 ${ms(s.toolDurationMs)}`} />
    </div>

    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Agent token 用量</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left p-2">Agent</th><th className="text-right p-2">调用</th><th className="text-right p-2">前 token</th><th className="text-right p-2">后 token</th><th className="text-right p-2">总 token</th><th className="text-right p-2">均耗时</th></tr></thead>
          <tbody>
            {data.agents.map((a) => <tr key={a.agentId} className="border-t border-gray-100">
              <td className="p-2 whitespace-nowrap">{a.agentName}<span className="ml-2 text-xs text-gray-400">{a.roleType}</span></td>
              <td className="p-2 text-right">{n(a.runCount)}</td>
              <td className="p-2 text-right">{n(a.inputTokens)}</td>
              <td className="p-2 text-right">{n(a.outputTokens)}</td>
              <td className="p-2 text-right font-medium">{n(a.totalTokens)}</td>
              <td className="p-2 text-right">{ms(a.avgDurationMs)}</td>
            </tr>)}
            {data.agents.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-400">暂无 Agent 运行记录</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">工具耗时与失败率</h3>
      <div className="grid md:grid-cols-2 gap-3">
        {data.tools.map((t) => <div key={t.toolName} className="rounded-lg border border-gray-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-gray-800 break-all">{t.toolName}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${t.failedCount ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{pct(t.failureRate)}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-500">
            <span>调用 {n(t.callCount)}</span><span>失败 {n(t.failedCount)}</span><span>均耗时 {ms(t.avgDurationMs)}</span>
          </div>
          {t.lastFailedAt && <div className="mt-2 text-xs text-red-500">最近错误：{time(t.lastFailedAt)}</div>}
        </div>)}
        {data.tools.length === 0 && <p className="text-sm text-gray-400">暂无工具调用记录</p>}
      </div>
    </div>

    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">工具报错分析</h3>
      <div className="space-y-2">
        {data.errorCodes.map((e) => <div key={`${e.toolName}:${e.errorCode}`} className="rounded-lg border border-red-100 bg-red-50/50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium text-gray-800">{e.toolName}</span><span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{e.errorCode}</span><span className="text-xs text-gray-500">{n(e.count)} 次</span></div>
          {e.sampleMessage && <p className="mt-1 text-xs text-red-600 break-words">{e.sampleMessage}</p>}
        </div>)}
        {data.errorCodes.length === 0 && <p className="text-sm text-gray-400">暂无工具错误。挺好。</p>}
      </div>
    </div>

    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">最近运行</h3>
      <div className="space-y-2">
        {runs.map((r) => <button key={r.runId} onClick={() => openRun(r.runId)} className="w-full text-left rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
          <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">{r.agentName}</span><span className="text-xs text-gray-400">{time(r.startedAt)}</span></div>
          <div className="mt-1 text-xs text-gray-500 line-clamp-2">{r.inputPreview}</div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400"><span>{r.status}</span><span>Token {n(r.totalTokens)}</span><span>耗时 {ms(r.durationMs)}</span><span>工具 {n(r.toolCallCount)}</span></div>
        </button>)}
      </div>
    </div>

    {detail && <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setDetail(null)}>
      <div className="bg-white w-full sm:max-w-3xl max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">运行详情</h3><button onClick={() => setDetail(null)} className="text-gray-400"><X className="w-4 h-4" /></button></div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2"><StatCard label="总 Token" value={n(detail.run.totalTokens)} /><StatCard label="前 token" value={n(detail.run.inputTokens)} /><StatCard label="后 token" value={n(detail.run.outputTokens)} /><StatCard label="耗时" value={ms(detail.run.durationMs)} /></div>
        <div className="mt-4"><div className="text-xs text-gray-500 mb-1">输入</div><pre className="whitespace-pre-wrap text-xs bg-gray-50 rounded p-3 max-h-40 overflow-auto">{detail.run.input}</pre></div>
        <div className="mt-4"><div className="text-xs text-gray-500 mb-1">工具调用</div><div className="space-y-2">{detail.toolCalls.map((c: any) => <div key={c.id} className="rounded border border-gray-100 p-2 text-xs"><div className="flex justify-between gap-2"><b>{c.toolName}</b><span className={c.status === 'failed' ? 'text-red-600' : 'text-green-600'}>{c.status}</span></div><div className="text-gray-400 mt-1">耗时 {ms(c.durationMs)}</div>{c.errorMessage && <div className="text-red-600 mt-1 break-words">{c.errorCode}: {c.errorMessage}</div>}</div>)}</div></div>
      </div>
    </div>}
  </section>
}
