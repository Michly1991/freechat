import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { api } from '../../../lib/api'

const nf = new Intl.NumberFormat('zh-CN')
function n(value: any) { return nf.format(Math.round(Number(value || 0))) }
function ms(value: any) {
  const v = Number(value || 0)
  if (!v) return '-'
  if (v < 1000) return `${Math.round(v)}ms`
  if (v < 60000) return `${(v / 1000).toFixed(1)}s`
  return `${Math.floor(v / 60000)}m ${Math.round((v % 60000) / 1000)}s`
}
function time(value: any) { return value ? new Date(Number(value)).toLocaleString() : '-' }
function statusText(status: string) {
  if (status === 'running') return '运行中'
  if (status === 'succeeded') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'timeout') return '超时'
  if (status === 'cancelled') return '已取消'
  return status || '未知'
}
function statusClass(status: string) {
  if (status === 'running') return 'bg-yellow-100 text-yellow-700'
  if (status === 'succeeded') return 'bg-green-100 text-green-700'
  if (status === 'timeout') return 'bg-orange-100 text-orange-700'
  if (status === 'failed') return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-600'
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-xs text-gray-400">{label}</div><div className="mt-1 text-lg font-semibold text-gray-800">{value}</div></div>
}

export function AgentRunsPanel({ roomId, roomAgents, restartAgent, feedback }: any) {
  const [runs, setRuns] = useState<any[]>([])
  const [overview, setOverview] = useState<any | null>(null)
  const [detail, setDetail] = useState<any | null>(null)
  const [agentId, setAgentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!roomId) return
    setLoading(true)
    setError('')
    try {
      const [summary, list] = await Promise.all([
        api.getRoomAnalytics(roomId),
        api.getRoomAnalyticsRuns(roomId, { pageSize: 30, ...(agentId ? { agentId } : {}) }),
      ])
      setOverview(summary)
      setRuns((list as any).items || [])
    } catch (err: any) {
      setError(err?.message || '加载 Agent 执行记录失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [roomId, agentId])

  const openRun = async (runId: string) => {
    try { setDetail(await api.getRoomAnalyticsRunDetail(roomId, runId)) }
    catch (err: any) { feedback?.error?.(err?.message || '运行详情加载失败') }
  }

  const failedAgent = detail ? roomAgents?.find((agent: any) => agent.id === detail.run?.agentId && ['failed', 'timeout'].includes(detail.run?.status)) : null
  const runningAgent = detail ? roomAgents?.find((agent: any) => agent.id === detail.run?.agentId && detail.run?.status === 'running') : null
  const s = overview?.summary || {}

  return <div className="h-full overflow-y-auto bg-gray-50 p-3 md:p-5">
    <section className="mx-auto max-w-5xl space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Agent 执行</h2>
            <p className="mt-1 text-xs text-gray-400">查看本房间 Agent 最近运行、耗时、token、工具调用和失败原因。</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
              <option value="">全部 Agent</option>
              {(roomAgents || []).map((agent: any) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-60"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />刷新</button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Agent 调用" value={n(s.runCount)} />
        <MiniStat label="成功 / 失败" value={`${n(s.successCount)} / ${n(s.failedCount)}`} />
        <MiniStat label="平均耗时" value={ms(s.avgDurationMs)} />
        <MiniStat label="工具调用" value={n(s.toolCallCount)} />
      </div>

      <div className="space-y-3">
        {runs.map((run) => <button key={run.runId} onClick={() => openRun(run.runId)} className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/30">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-gray-900">{run.agentName}</span><span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(run.status)}`}>{statusText(run.status)}</span></div>
              <p className="mt-1 text-xs text-gray-400">{time(run.startedAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-gray-500"><span>耗时 {ms(run.durationMs)}</span><span>Token {n(run.totalTokens)}</span><span>工具 {n(run.toolCallCount)}</span></div>
          </div>
          <p className="mt-3 line-clamp-2 text-sm text-gray-600">{run.inputPreview || '无输入预览'}</p>
          {run.outputPreview && <p className={`mt-2 line-clamp-2 text-xs ${run.status === 'failed' || run.status === 'timeout' ? 'text-red-500' : 'text-gray-400'}`}>{run.outputPreview}</p>}
        </button>)}
        {!loading && runs.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">暂无 Agent 执行记录。触发 Agent 后这里会显示最近运行状态。</div>}
      </div>
    </section>

    {detail && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setDetail(null)}>
      <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-gray-900">运行详情</h3><p className="mt-1 text-xs text-gray-400">{detail.run.agentName} · {statusText(detail.run.status)} · {time(detail.run.startedAt)}</p></div><button onClick={() => setDetail(null)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100" title="关闭"><X className="w-4 h-4" /></button></div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4"><MiniStat label="总 Token" value={n(detail.run.totalTokens)} /><MiniStat label="耗时" value={ms(detail.run.durationMs)} /><MiniStat label="工具" value={n(detail.run.toolCallCount)} /><MiniStat label="工具耗时" value={ms(detail.run.toolDurationMs)} /></div>
        <div className="mt-4 flex flex-wrap gap-2">{failedAgent && <button onClick={() => restartAgent?.(failedAgent)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700">软恢复 {failedAgent.name}</button>}{runningAgent && <button onClick={() => restartAgent?.(runningAgent, 'force')} className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">强制重启 {runningAgent.name}</button>}</div>
        <div className="mt-4"><div className="mb-1 text-xs text-gray-500">输入</div><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-xs text-gray-700">{detail.run.input || '-'}</pre></div>
        {(detail.run.output || detail.run.error) && <div className="mt-4"><div className="mb-1 text-xs text-gray-500">输出 / 错误</div><pre className={`max-h-48 overflow-auto whitespace-pre-wrap rounded-xl p-3 text-xs ${detail.run.error ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>{detail.run.error || detail.run.output}</pre></div>}
        <div className="mt-4"><div className="mb-2 text-xs text-gray-500">工具调用</div><div className="space-y-2">{detail.toolCalls.map((call: any) => <div key={call.id} className="rounded-xl border border-gray-100 p-3 text-xs"><div className="flex justify-between gap-2"><b className="break-all text-gray-800">{call.toolName}</b><span className={call.status === 'failed' ? 'text-red-600' : 'text-green-600'}>{call.status}</span></div><div className="mt-1 text-gray-400">耗时 {ms(call.durationMs)} · {time(call.startedAt)}</div>{call.inputSummary && <div className="mt-2 break-words text-gray-500">输入：{call.inputSummary}</div>}{call.errorMessage && <div className="mt-2 break-words text-red-600">{call.errorCode}: {call.errorMessage}</div>}</div>)}{detail.toolCalls.length === 0 && <p className="text-sm text-gray-400">本次运行没有工具调用记录。</p>}</div></div>
      </div>
    </div>}
  </div>
}
