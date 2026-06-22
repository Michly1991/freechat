import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

type Role = 'payer' | 'agent_provider' | 'model_provider' | 'scene_provider'
const roles: Array<{ id: Role; label: string; hint: string }> = [
  { id: 'payer', label: '支出明细', hint: '模型运行等消费' },
  { id: 'agent_provider', label: 'Agent 收入', hint: 'Agent token 服务收入' },
  { id: 'model_provider', label: '模型收入', hint: '模型调用收入' },
  { id: 'scene_provider', label: '场景收入', hint: '场景被购买收入' },
]
function fmtInt(n: any) { return Number(n || 0).toLocaleString() }
function fmtCredit(n: any) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 }) }
function signedCredit(n: any) { const v = Number(n || 0); return `${v >= 0 ? '+' : '-'}${fmtCredit(Math.abs(v))}` }
function fmtDate(ts: any) { const n = Number(ts || 0); return n ? new Date(n).toLocaleDateString() : '-' }
function ledgerTypeLabel(type: string) {
  const map: Record<string, string> = {
    run_charge: '运行扣费',
    agent_income: 'Agent 收入',
    model_income: '模型收入',
    scene_purchase: '场景购买',
    scene_income: '场景收入',
    usage_charge: '模型扣费',
    model_usage_charge: '模型扣费',
    agent_usage_charge: 'Agent 扣费',
  }
  return map[type] || type
}

export function BillingPanel() {
  const [role, setRole] = useState<Role>('payer')
  const [summaries, setSummaries] = useState<Record<Role, any>>({ payer: null, agent_provider: null, model_provider: null, scene_provider: null })
  const [ledger, setLedger] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const [payer, agentProvider, modelProvider, sceneProvider, l] = await Promise.all([
        api.getBillingSummary({ role: 'payer' }),
        api.getBillingSummary({ role: 'agent_provider' }),
        api.getBillingSummary({ role: 'model_provider' }),
        api.getBillingSummary({ role: 'scene_provider' }),
        api.getBillingLedger({ role, limit: 30 }),
      ])
      setSummaries({ payer, agent_provider: agentProvider, model_provider: modelProvider, scene_provider: sceneProvider })
      setLedger(l.items || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [role])

  const summary = summaries[role]
  const spend = Math.abs(Number(summaries.payer?.summary?.credits || 0))
  const agentIncome = Number(summaries.agent_provider?.summary?.credits || 0)
  const modelIncome = Number(summaries.model_provider?.summary?.credits || 0)
  const sceneIncome = Number(summaries.scene_provider?.summary?.credits || 0)
  const totalIncome = agentIncome + modelIncome + sceneIncome
  const net = totalIncome - spend
  const unbilled = summaries.payer?.unbilledUsage
  const hasUnbilled = Number(unbilled?.count || 0) > 0
  const activeRole = roles.find((item) => item.id === role) || roles[0]
  const tokenCards = [
    ['总 token', fmtInt(summary?.summary?.totalTokens)],
    ['前 token', fmtInt(summary?.summary?.inputTokens)],
    ['后 token', fmtInt(summary?.summary?.outputTokens)],
    ['缓存读', fmtInt(summary?.summary?.cacheReadTokens)],
    ['缓存写', fmtInt(summary?.summary?.cacheWriteTokens)],
  ]

  return <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm border border-gray-100 space-y-5">
    <div className="flex flex-col gap-1"><h2 className="text-lg font-semibold text-gray-800">账单与收入</h2><p className="text-sm text-gray-500">支出、Agent 收入、模型收入放在一起对比；下方切换查看各类明细。</p></div>
    {loading && <p className="text-sm text-gray-400">加载中...</p>}

    <div className="grid gap-3 md:grid-cols-[1.2fr,1fr]">
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <p className="text-xs font-medium text-blue-500">账户余额</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Metric label="可用余额" value={fmtCredit(summaries.payer?.account?.balance)} suffix="cr" />
          <Metric label="收入余额" value={fmtCredit(summaries.payer?.account?.incomeBalance)} suffix="cr" />
        </div>
      </div>
      <div className={`rounded-2xl border p-4 ${net >= 0 ? 'border-emerald-100 bg-emerald-50' : 'border-rose-100 bg-rose-50'}`}>
        <p className={`text-xs font-medium ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>净额 = 总收入 - 总支出</p>
        <p className={`mt-2 text-3xl font-semibold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{signedCredit(net)} <span className="text-base font-medium">cr</span></p>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <CompareCard title="总支出" value={spend} tone="rose" subtitle="模型运行/消费" />
      <CompareCard title="Agent 收入" value={agentIncome} tone="amber" subtitle="Agent token 服务费" />
      <CompareCard title="模型收入" value={modelIncome} tone="emerald" subtitle="模型调用分成" />
      <CompareCard title="场景收入" value={sceneIncome} tone="purple" subtitle="场景被购买" />
      <CompareCard title="总收入" value={totalIncome} tone="blue" subtitle="Agent + 模型 + 场景" />
    </div>

    {hasUnbilled && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">有 {fmtInt(unbilled.count)} 次 Agent 调用已记录用量但未生成 Credit 流水，通常是缺少模型/Agent 计费规则。未计费 token：{fmtInt(unbilled.totalTokens)}。</div>}

    <div className="flex gap-2 overflow-x-auto rounded-xl bg-gray-50 p-1">
      {roles.map((item) => <button key={item.id} onClick={() => setRole(item.id)} className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition ${role === item.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><span className="block font-medium">{item.label}</span><span className="block text-[11px] opacity-70">{item.hint}</span></button>)}
    </div>

    <div className="rounded-2xl border border-gray-100 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-gray-800">{activeRole.label}</h3><p className="text-xs text-gray-400">{activeRole.hint}</p></div><p className="text-lg font-semibold text-gray-900">{fmtCredit(role === 'payer' ? spend : summary?.summary?.credits)} <span className="text-xs font-normal text-gray-400">cr</span></p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{tokenCards.map(([k, v]) => <div key={k} className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-400">{k}</p><p className="mt-1 text-lg font-semibold text-gray-800">{v}</p></div>)}</div>
      <p className="text-xs text-gray-400">说明：总 token = 前 token + 后 token + 缓存读 + 缓存写；Agent 服务费与模型费都按 token 结算，分别归到 Agent / 模型账单。</p>
    </div>

    <DimensionAnalysis summary={summary} role={role} />
    <div><h3 className="mb-2 font-medium text-gray-800">最近流水</h3><div className="overflow-x-auto rounded-xl border border-gray-100"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">项目</th><th className="px-3 py-2 text-left">Agent</th><th className="px-3 py-2 text-left">模型</th><th className="px-3 py-2 text-right">Token</th><th className="px-3 py-2 text-right">缓存</th><th className="px-3 py-2 text-right">模型费</th><th className="px-3 py-2 text-right">Agent费</th><th className="px-3 py-2 text-right">合计</th></tr></thead><tbody>{ledger.length === 0 && <tr><td className="px-3 py-6 text-center text-gray-400" colSpan={9}>暂无流水</td></tr>}{ledger.map((row) => <tr key={row.id} className="border-t border-gray-100"><td className="px-3 py-2 text-gray-600">{ledgerTypeLabel(row.entry_type)}</td><td className="px-3 py-2 text-gray-600">{row.sceneName || row.roomName || row.room_id || '未关联项目'}</td><td className="px-3 py-2 text-gray-600">{row.agentName || row.agent_id || '-'}</td><td className="px-3 py-2 text-gray-600">{row.model || '-'}</td><td className="px-3 py-2 text-right text-gray-600">{fmtInt(row.total_tokens)}</td><td className="px-3 py-2 text-right text-gray-500">{fmtInt(Number(row.cache_read_tokens || 0) + Number(row.cache_write_tokens || 0))}</td><td className="px-3 py-2 text-right text-gray-700">{fmtCredit(row.model_credit_amount)}</td><td className="px-3 py-2 text-right text-gray-700">{fmtCredit(row.agent_credit_amount)}</td><td className="px-3 py-2 text-right font-medium text-gray-800">{fmtCredit(row.credit_amount)}</td></tr>)}</tbody></table></div></div>
  </section>
}

function Metric({ label, value, suffix }: any) {
  return <div><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold text-gray-900">{value} <span className="text-sm font-medium text-gray-400">{suffix}</span></p></div>
}

function CompareCard({ title, value, subtitle, tone }: any) {
  const toneMap: Record<string, string> = {
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    purple: 'border-purple-100 bg-purple-50 text-purple-700',
  }
  return <div className={`rounded-2xl border p-4 ${toneMap[tone] || toneMap.blue}`}><p className="text-xs font-medium opacity-80">{title}</p><p className="mt-2 text-2xl font-semibold">{fmtCredit(value)} <span className="text-sm font-medium opacity-60">cr</span></p><p className="mt-1 text-xs opacity-70">{subtitle}</p></div>
}

function DimensionAnalysis({ summary, role }: { summary: any; role: Role }) {
  const [active, setActive] = useState('project')
  const tabs = [
    { id: 'project', label: '项目', hint: '项目运行与购买归属', items: summary?.byProject || [], nameKey: 'roomName', columns: ['count', 'tokens'] },
    { id: 'agent', label: 'Agent', hint: 'Agent token 服务费/收入', items: summary?.byAgent || [], nameKey: 'agentName', columns: ['count', 'tokens'] },
    { id: 'model', label: '模型', hint: '模型调用费/收入', items: summary?.byModel || [], nameKey: 'model', columns: ['count', 'tokens'] },
    { id: 'scene', label: role === 'scene_provider' ? '场景收入' : '场景购买', hint: role === 'payer' ? '已购买场景费用' : role === 'scene_provider' ? '场景被购买收入' : '当前视角暂无场景数据', items: summary?.byScenePurchase || [], nameKey: 'sceneName', columns: ['count', 'lastPurchasedAt'] },
    { id: 'daily', label: '每日', hint: '按天汇总趋势', items: summary?.daily || [], nameKey: 'date', columns: ['count', 'tokens'] },
  ]
  const current = tabs.find((tab) => tab.id === active) || tabs[0]
  return <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-4"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold text-gray-800">维度分析</h3><p className="text-xs text-gray-400">切换维度查看金额、次数和 token；场景购买费用单独统计，不再混在项目里。</p></div><p className="text-xs text-gray-400">{current.hint}</p></div><div className="flex gap-2 overflow-x-auto rounded-xl bg-gray-50 p-1">{tabs.map((tab) => <button key={tab.id} onClick={() => setActive(tab.id)} className={`shrink-0 rounded-lg px-3 py-2 text-sm transition ${active === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{tab.label}</button>)}</div><div className="hidden overflow-x-auto rounded-xl border border-gray-100 md:block"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-left">名称</th><th className="px-3 py-2 text-right">金额</th><th className="px-3 py-2 text-right">次数</th>{current.columns.includes('tokens') && <th className="px-3 py-2 text-right">Token</th>}{current.columns.includes('lastPurchasedAt') && <th className="px-3 py-2 text-right">最近购买</th>}</tr></thead><tbody>{current.items.length === 0 && <tr><td className="px-3 py-6 text-center text-gray-400" colSpan={5}>暂无数据</td></tr>}{current.items.map((item: any, index: number) => <tr key={`${current.id}-${index}`} className="border-t border-gray-100"><td className="px-3 py-2 text-gray-700">{item[current.nameKey] || '-'}</td><td className="px-3 py-2 text-right font-medium text-gray-900">{fmtCredit(item.credits)} cr</td><td className="px-3 py-2 text-right text-gray-600">{fmtInt(item.count)}</td>{current.columns.includes('tokens') && <td className="px-3 py-2 text-right text-gray-600">{fmtInt(item.totalTokens)}</td>}{current.columns.includes('lastPurchasedAt') && <td className="px-3 py-2 text-right text-gray-600">{fmtDate(item.lastPurchasedAt)}</td>}</tr>)}</tbody></table></div><div className="space-y-2 md:hidden">{current.items.length === 0 && <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-400">暂无数据</p>}{current.items.map((item: any, index: number) => <div key={`${current.id}-card-${index}`} className="rounded-xl border border-gray-100 p-3"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium text-gray-800">{item[current.nameKey] || '-'}</p><p className="shrink-0 text-sm font-semibold text-gray-900">{fmtCredit(item.credits)} cr</p></div><div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500"><span>次数：{fmtInt(item.count)}</span>{current.columns.includes('tokens') && <span>Token：{fmtInt(item.totalTokens)}</span>}{current.columns.includes('lastPurchasedAt') && <span>最近购买：{fmtDate(item.lastPurchasedAt)}</span>}</div></div>)}</div></div>
}
