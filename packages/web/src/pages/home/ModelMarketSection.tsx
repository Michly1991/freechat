import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

export function ModelMarketSection() {
  const [profiles, setProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<any>({ name: '', baseUrl: '', apiKey: '', defaultModel: '', models: '', visibility: 'shared', inputCreditPerMillion: 0, outputCreditPerMillion: 0, minCreditsPerRun: 0 })

  const load = async () => { setLoading(true); try { const data = await api.getModelProfiles(); setProfiles(data.profiles || []) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])

  const beginEdit = async (p: any) => {
    setEditingId(p.id)
    let rule: any = null
    try { const data = await api.getModelBillingRules(p.id); rule = (data.rules || []).find((r) => r.model === p.defaultModel) || data.rules?.[0] } catch {}
    setForm({ name: p.name || '', baseUrl: p.baseUrl || '', apiKey: '', defaultModel: p.defaultModel || '', models: (p.models || []).join(','), visibility: p.visibility || 'shared', enabled: p.enabled !== false, inputCreditPerMillion: rule?.inputCreditPerMillion || 0, outputCreditPerMillion: rule?.outputCreditPerMillion || 0, minCreditsPerRun: rule?.minCreditsPerRun || 0 })
  }
  const save = async () => {
    if (!editingId) return
    await api.updateModelProfile(editingId, form)
    if (form.defaultModel) await api.upsertModelBillingRule(editingId, form.defaultModel, { inputCreditPerMillion: form.inputCreditPerMillion, outputCreditPerMillion: form.outputCreditPerMillion, minCreditsPerRun: form.minCreditsPerRun })
    setEditingId(null)
    await load()
  }

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-800">模型市场</h2><p className="text-sm text-gray-500 mt-1">发布和售卖自己的模型 Key / Base URL；别人只能看到摘要和售价。</p></div></div>
    {loading && <p className="text-sm text-gray-400">加载中...</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{profiles.map((p) => <div key={p.id} className="rounded-xl border border-gray-100 bg-white p-3 space-y-2">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="text-sm font-semibold text-gray-800 truncate">{p.name}</h3><p className="text-xs text-gray-400 truncate">发布人：{p.ownerName || p.ownerId || '未知'}</p></div><span className="text-[10px] px-2 py-1 rounded-full bg-blue-50 text-blue-600">{p.visibility === 'platform' ? '平台' : p.visibility === 'shared' ? '公开售卖' : '私有'}</span></div>
      <p className="text-xs text-gray-500">Base URL：{p.canEdit ? (p.baseUrl || '未配置') : (p.baseUrlHost || '已隐藏')}</p>
      <p className="text-xs text-gray-500">默认模型：{p.defaultModel || '未配置'}</p>
      {p.models?.length > 0 && <p className="text-xs text-gray-400 line-clamp-1">支持：{p.models.join('、')}</p>}
      <p className="text-xs text-blue-600">价格：{p.priceSummary || '暂无定价'}</p>
      {p.canEdit ? <button onClick={() => beginEdit(p)} className="text-xs text-blue-600">编辑售卖配置</button> : <p className="text-xs text-gray-400">API Key 与完整配置仅发布人可见。</p>}
    </div>)}</div>
    {editingId && <div className="rounded-2xl border border-blue-100 bg-blue-50/30 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-800">编辑模型售卖配置</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" placeholder="名称" /><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className="px-3 py-2 border rounded-lg text-sm"><option value="private">私有</option><option value="shared">公开售卖</option><option value="platform">平台</option></select></div>
      <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Base URL" />
      <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="API Key（留空不修改）" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" placeholder="默认模型" /><input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" placeholder="模型列表，逗号分隔" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><input type="number" value={form.inputCreditPerMillion} onChange={(e) => setForm({ ...form, inputCreditPerMillion: Number(e.target.value) })} className="px-3 py-2 border rounded-lg text-sm" placeholder="输入/百万" /><input type="number" value={form.outputCreditPerMillion} onChange={(e) => setForm({ ...form, outputCreditPerMillion: Number(e.target.value) })} className="px-3 py-2 border rounded-lg text-sm" placeholder="输出/百万" /><input type="number" value={form.minCreditsPerRun} onChange={(e) => setForm({ ...form, minCreditsPerRun: Number(e.target.value) })} className="px-3 py-2 border rounded-lg text-sm" placeholder="最低/次" /></div>
      <div className="flex justify-end gap-2"><button onClick={() => setEditingId(null)} className="px-3 py-2 bg-gray-100 rounded-lg text-sm">取消</button><button onClick={save} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">保存</button></div>
    </div>}
  </div>
}
