import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

type Role = 'payer' | 'agent_provider' | 'model_provider'
const roles: Array<{ id: Role; label: string }> = [
  { id: 'payer', label: '使用方账单' },
  { id: 'agent_provider', label: 'Agent 收入' },
  { id: 'model_provider', label: '模型收入' },
]
function fmt(n: any) { return Number(n || 0).toLocaleString() }
function abs(n: any) { return Math.abs(Number(n || 0)).toLocaleString() }

export function BillingPanel() {
  const [role, setRole] = useState<Role>('payer')
  const [summary, setSummary] = useState<any>(null)
  const [ledger, setLedger] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const [s, l] = await Promise.all([api.getBillingSummary({ role }), api.getBillingLedger({ role, limit: 30 })])
      setSummary(s); setLedger(l.items || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [role])
  const cards = [
    ['余额', fmt(summary?.account?.balance)],
    ['收入余额', fmt(summary?.account?.incomeBalance)],
    ['本视角 Credit', role === 'payer' ? abs(summary?.summary?.credits) : fmt(summary?.summary?.credits)],
    ['总 token', fmt(summary?.summary?.totalTokens)],
    ['前 token', fmt(summary?.summary?.inputTokens)],
    ['后 token', fmt(summary?.summary?.outputTokens)],
  ]
  const unbilled = summary?.unbilledUsage
  const hasUnbilled = role === 'payer' && Number(unbilled?.count || 0) > 0
  return <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm border border-gray-100 space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-gray-800">账单与收入</h2><p className="text-sm text-gray-500 mt-1">按使用方、Agent 提供方、模型提供方三种视角查看。</p></div><div className="flex gap-2 overflow-x-auto">{roles.map((item) => <button key={item.id} onClick={() => setRole(item.id)} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${role === item.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{item.label}</button>)}</div></div>
    {loading && <p className="text-sm text-gray-400">加载中...</p>}
    {hasUnbilled && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">有 {fmt(unbilled.count)} 次 Agent 调用已记录用量但未生成 Credit 流水，通常是缺少模型/Agent 计费规则。未计费 token：{fmt(unbilled.totalTokens)}。</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{cards.map(([k, v]) => <div key={k} className="rounded-xl bg-gray-50 p-4"><p className="text-xs text-gray-400">{k}</p><p className="mt-1 text-xl font-semibold text-gray-800">{v}</p></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-4"><Group title="按项目" items={summary?.byProject || []} nameKey="roomName" /><Group title="按 Agent" items={summary?.byAgent || []} nameKey="agentName" /><Group title="按模型" items={summary?.byModel || []} nameKey="model" /><Group title="每日趋势" items={summary?.daily || []} nameKey="date" /></div>
    <div><h3 className="mb-2 font-medium text-gray-800">最近流水</h3><div className="overflow-x-auto rounded-xl border border-gray-100"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">项目</th><th className="px-3 py-2 text-left">Agent</th><th className="px-3 py-2 text-left">模型</th><th className="px-3 py-2 text-right">Token</th><th className="px-3 py-2 text-right">Credit</th></tr></thead><tbody>{ledger.length === 0 && <tr><td className="px-3 py-6 text-center text-gray-400" colSpan={6}>暂无流水</td></tr>}{ledger.map((row) => <tr key={row.id} className="border-t border-gray-100"><td className="px-3 py-2 text-gray-600">{row.entry_type}</td><td className="px-3 py-2 text-gray-600">{row.roomName || row.room_id}</td><td className="px-3 py-2 text-gray-600">{row.agentName || row.agent_id}</td><td className="px-3 py-2 text-gray-600">{row.model || 'unknown'}</td><td className="px-3 py-2 text-right text-gray-600">{fmt(row.total_tokens)}</td><td className="px-3 py-2 text-right font-medium text-gray-800">{fmt(row.credit_amount)}</td></tr>)}</tbody></table></div></div>
  </section>
}

function Group({ title, items, nameKey }: any) {
  return <div className="rounded-xl border border-gray-100 p-4"><h3 className="mb-3 font-medium text-gray-800">{title}</h3><div className="space-y-2">{items.length === 0 && <p className="text-sm text-gray-400">暂无数据</p>}{items.map((item: any, i: number) => <div key={i} className="flex items-center justify-between gap-2 text-sm"><span className="truncate text-gray-600">{item[nameKey] || 'unknown'}</span><span className="shrink-0 font-medium text-gray-800">{fmt(item.credits)} cr</span></div>)}</div></div>
}
