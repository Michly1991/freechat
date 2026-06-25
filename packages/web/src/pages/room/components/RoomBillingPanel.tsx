import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'

function fmtInt(n: any) { return Number(n || 0).toLocaleString() }
function fmtCredit(n: any) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 }) }
function fmtDateTime(ts: any) { const n = Number(ts || 0); return n ? new Date(n).toLocaleString() : '-' }
function labelType(type: string) {
  const map: Record<string, string> = { usage_record: '0元用量', run_charge: '运行扣费', usage_charge: '模型扣费', model_usage_charge: '模型扣费', agent_usage_charge: 'Agent 扣费' }
  return map[type] || type
}

function Metric({ label, value, suffix, tone = 'gray' }: any) {
  const toneMap: Record<string, string> = {
    gray: 'border-gray-100 bg-gray-50 text-gray-900',
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
  }
  return <div className={`rounded-2xl border p-4 ${toneMap[tone] || toneMap.gray}`}><p className="text-xs font-medium opacity-70">{label}</p><p className="mt-2 text-2xl font-semibold">{value} <span className="text-sm font-medium opacity-60">{suffix}</span></p></div>
}

function DimensionList({ title, items, nameKey }: { title: string; items: any[]; nameKey: string }) {
  return <div className="rounded-2xl border border-gray-100 bg-white p-4"><h3 className="font-semibold text-gray-800">{title}</h3><div className="mt-3 space-y-2">{items.length === 0 && <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-400">暂无数据</p>}{items.map((item, index) => <div key={`${title}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-800">{item[nameKey] || '-'}</p><p className="text-xs text-gray-400">{fmtInt(item.count)} 次 · {fmtInt(item.totalTokens)} token</p></div><p className="shrink-0 text-sm font-semibold text-gray-900">{fmtCredit(Math.abs(Number(item.credits || 0)))} cr</p></div>)}</div></div>
}

export function RoomBillingPanel({ roomId }: { roomId: string }) {
  const [summary, setSummary] = useState<any | null>(null)
  const [ledger, setLedger] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!roomId) return
    setLoading(true); setError('')
    try {
      const [s, l] = await Promise.all([api.getRoomBillingSummary(roomId), api.getRoomBillingLedger(roomId, { limit: 50 })])
      setSummary(s); setLedger(l.items || [])
    } catch (err: any) { setError(err?.message || '加载房间账单失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [roomId])

  const s = summary?.summary || {}
  const spend = Math.abs(Number(s.credits || 0))
  const unbilled = summary?.unbilledUsage
  const hasUnbilled = Number(unbilled?.count || 0) > 0
  const scopeText = summary?.canViewFullRoomBilling ? '房主视图：展示当前房间全部支出' : '使用者视图：仅展示你在当前分享/房间中的支出'

  return <section className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6 space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-gray-900">房间账单</h2><p className="mt-1 text-sm text-gray-500">{scopeText}</p></div><button onClick={load} disabled={loading} className="w-fit rounded-lg bg-white px-3 py-2 text-sm text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60">{loading ? '刷新中...' : '刷新'}</button></div>
    {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
    {hasUnbilled && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">有 {fmtInt(unbilled.count)} 次运行已记录用量但未生成 Credit 流水，通常是模型计费规则为免费或缺少规则。未计费 token：{fmtInt(unbilled.totalTokens)}。</div>}

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Metric label="本房间支出" value={fmtCredit(spend)} suffix="cr" tone="rose" />
      <Metric label="运行次数" value={fmtInt(s.count)} suffix="次" tone="blue" />
      <Metric label="总 token" value={fmtInt(s.totalTokens)} suffix="tok" />
      <Metric label="输入 token" value={fmtInt(s.inputTokens)} suffix="tok" />
      <Metric label="输出 token" value={fmtInt(s.outputTokens)} suffix="tok" />
    </div>

    <div className="grid gap-4 xl:grid-cols-3">
      <DimensionList title="按 Agent" items={summary?.byAgent || []} nameKey="agentName" />
      <DimensionList title="按模型" items={summary?.byModel || []} nameKey="model" />
      <DimensionList title="按使用者" items={summary?.byPayer || []} nameKey="userName" />
    </div>

    <div className="rounded-2xl border border-gray-100 bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-gray-800">流水明细</h3><p className="text-xs text-gray-400">最近 50 条</p></div><div className="hidden overflow-x-auto rounded-xl border border-gray-100 md:block"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-left">时间</th><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">使用者</th><th className="px-3 py-2 text-left">Agent</th><th className="px-3 py-2 text-left">模型</th><th className="px-3 py-2 text-right">Token</th><th className="px-3 py-2 text-right">模型费</th><th className="px-3 py-2 text-right">Agent费</th><th className="px-3 py-2 text-right">合计</th></tr></thead><tbody>{ledger.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">暂无流水</td></tr>}{ledger.map((row) => <tr key={row.id} className="border-t border-gray-100"><td className="px-3 py-2 text-gray-500">{fmtDateTime(row.created_at)}</td><td className="px-3 py-2 text-gray-600">{labelType(row.entry_type)}</td><td className="px-3 py-2 text-gray-600">{row.payerName || '-'}</td><td className="px-3 py-2 text-gray-600">{row.agentName || '-'}</td><td className="px-3 py-2 text-gray-600">{row.model || '-'}</td><td className="px-3 py-2 text-right text-gray-600">{fmtInt(row.total_tokens)}</td><td className="px-3 py-2 text-right text-gray-700">{fmtCredit(Math.abs(Number(row.model_credit_amount || 0)))}</td><td className="px-3 py-2 text-right text-gray-700">{fmtCredit(Math.abs(Number(row.agent_credit_amount || 0)))}</td><td className="px-3 py-2 text-right font-medium text-gray-900">{fmtCredit(Math.abs(Number(row.credit_amount || 0)))}</td></tr>)}</tbody></table></div><div className="space-y-2 md:hidden">{ledger.length === 0 && <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-400">暂无流水</p>}{ledger.map((row) => <div key={`${row.id}-card`} className="rounded-xl border border-gray-100 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-gray-800">{row.agentName || row.model || '运行'}</p><p className="text-sm font-semibold text-gray-900">{fmtCredit(Math.abs(Number(row.credit_amount || 0)))} cr</p></div><p className="mt-1 text-xs text-gray-400">{fmtDateTime(row.created_at)} · {labelType(row.entry_type)}</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500"><span>使用者：{row.payerName || '-'}</span><span>Token：{fmtInt(row.total_tokens)}</span><span>模型费：{fmtCredit(Math.abs(Number(row.model_credit_amount || 0)))}</span><span>Agent费：{fmtCredit(Math.abs(Number(row.agent_credit_amount || 0)))}</span></div></div>)}</div></div>
  </section>
}
