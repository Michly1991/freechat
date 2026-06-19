import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

function Field({ label, hint, children }: any) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-gray-600">{label}</span>{children}{hint && <span className="block text-[11px] leading-4 text-gray-400">{hint}</span>}</label>
}

function fmtCredit(n: any) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100'

export function ModelMarketSection() {
  const [profiles, setProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<any>({ name: '', baseUrl: '', apiKey: '', defaultModel: '', models: '', visibility: 'shared', inputCreditPerMillion: 0, outputCreditPerMillion: 0, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0 })

  const load = async () => { setLoading(true); try { const data = await api.getModelProfiles(); setProfiles((data.profiles || []).filter((p: any) => p.visibility === 'shared' || p.visibility === 'platform')) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])

  const beginEdit = async (p: any) => {
    setEditingId(p.id)
    let rule: any = null
    try { const data = await api.getModelBillingRules(p.id); rule = (data.rules || []).find((r) => r.model === p.defaultModel) || data.rules?.[0] } catch {}
    setForm({
      name: p.name || '',
      baseUrl: p.baseUrl || '',
      apiKey: '',
      defaultModel: p.defaultModel || '',
      models: (p.models || []).join(','),
      visibility: p.visibility || 'shared',
      enabled: p.enabled !== false,
      inputCreditPerMillion: rule?.inputCreditPerMillion || 0,
      outputCreditPerMillion: rule?.outputCreditPerMillion || 0,
      cacheWriteCreditPerMillion: rule?.cacheWriteCreditPerMillion || 0,
      cacheReadCreditPerMillion: rule?.cacheReadCreditPerMillion || 0,
      minCreditsPerRun: rule?.minCreditsPerRun || 0,
    })
  }
  const toggleFollow = async (profile: any) => {
    if (profile.isOwner || profile.visibility === 'platform') return
    if (profile.isFollowing) await api.unfollowMarketTarget('model', profile.id)
    else await api.followMarketTarget('model', profile.id)
    await load()
  }

  const save = async () => {
    if (!editingId) return
    await api.updateModelProfile(editingId, form)
    if (form.defaultModel) await api.upsertModelBillingRule(editingId, form.defaultModel, {
      inputCreditPerMillion: form.inputCreditPerMillion,
      outputCreditPerMillion: form.outputCreditPerMillion,
      cacheWriteCreditPerMillion: form.cacheWriteCreditPerMillion,
      cacheReadCreditPerMillion: form.cacheReadCreditPerMillion,
      minCreditsPerRun: form.minCreditsPerRun,
    })
    setEditingId(null)
    await load()
  }

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-800">模型市场</h2><p className="text-sm text-gray-500 mt-1">这里只能发现和关注已上架模型服务；新增和编辑请到通讯录。</p></div></div>
    {loading && <p className="text-sm text-gray-400">加载中...</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{profiles.map((p) => <div key={p.id} className={`rounded-2xl border bg-white p-3.5 space-y-3 shadow-sm ${editingId === p.id ? 'border-blue-200 ring-2 ring-blue-50' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="text-sm font-semibold text-gray-800 truncate">{p.name}</h3><p className="text-xs text-gray-400 truncate">发布人：{p.ownerName || p.ownerId || '未知'}</p></div><span className="text-[10px] px-2 py-1 rounded-full bg-blue-50 text-blue-600">{p.visibility === 'platform' ? '平台' : p.visibility === 'shared' ? '公开售卖' : '私有'}</span></div>
      <p className="text-xs text-gray-500">Base URL：{p.canEdit ? (p.baseUrl || '未配置') : (p.baseUrlHost || '已隐藏')}</p>
      <p className="text-xs text-gray-500">默认模型：{p.defaultModel || '未配置'}</p>
      {p.models?.length > 0 && <p className="text-xs text-gray-400 line-clamp-1">支持：{p.models.join('、')}</p>}
      <p className="text-xs text-blue-600">价格：{p.priceSummary || '暂无定价'}</p>
      <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:flex-wrap sm:border-t-0 sm:pt-0">{p.isOwner ? <span className="flex min-h-10 items-center justify-center rounded-xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-600 sm:min-h-0 sm:rounded-lg sm:px-3 sm:py-1.5 sm:text-xs">我的上架服务</span> : <p className="text-xs text-gray-400">API Key 与完整配置仅发布人可见。</p>}{!p.isOwner && p.visibility !== 'platform' && <button onClick={() => toggleFollow(p)} className={`min-h-10 w-full rounded-xl px-4 py-2 text-sm font-medium active:scale-[0.98] sm:min-h-0 sm:w-auto sm:rounded-lg sm:px-3 sm:py-1.5 sm:text-xs ${p.isFollowing ? 'bg-gray-100 text-gray-600' : 'bg-emerald-600 text-white shadow-sm sm:bg-emerald-50 sm:text-emerald-600 sm:shadow-none'}`}>{p.isFollowing ? '已关注' : '关注模型'}</button>}</div>
    </div>)}</div>
    {editingId && <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm space-y-4">
      <div className="flex flex-col gap-1 border-b border-gray-100 pb-3"><h3 className="text-base font-semibold text-gray-900">编辑模型售卖配置</h3><p className="text-xs text-gray-500">所有价格单位都是 credit/百万 token；界面保留两位小数，内部用 microcredit 精算。</p></div>

      <div className="space-y-3 rounded-xl bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-800">基础信息</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="服务名称" hint="展示在模型市场里的名称，例如：平台通义千问"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="服务名称" /></Field>
          <Field label="可见性" hint="私有仅自己可用；公开售卖/平台可被其他用户选择"><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className={inputClass}><option value="private">私有</option><option value="shared">公开售卖</option><option value="platform">平台</option></select></Field>
          <Field label="Base URL" hint="模型服务的兼容接口地址"><input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className={inputClass} placeholder="https://..." /></Field>
          <Field label="API Key" hint="留空表示不修改现有 Key"><input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className={inputClass} placeholder="留空不修改" /></Field>
        </div>
      </div>

      <div className="space-y-3 rounded-xl bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-800">模型列表</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="默认模型" hint="房间未指定时默认使用的模型名"><input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} className={inputClass} placeholder="qwen3.7-max" /></Field>
          <Field label="支持模型" hint="多个模型用英文逗号分隔"><input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} className={inputClass} placeholder="model-a, model-b" /></Field>
        </div>
      </div>

      <div className="space-y-3 rounded-xl bg-blue-50/60 p-3">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-gray-800">计费规则</p><p className="text-xs text-blue-600">预览：输入 {fmtCredit(form.inputCreditPerMillion)} / 输出 {fmtCredit(form.outputCreditPerMillion)} cr/百万</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="输入 token" hint="每百万输入 token 收费"><input type="number" step="0.01" value={form.inputCreditPerMillion} onChange={(e) => setForm({ ...form, inputCreditPerMillion: Number(e.target.value) })} className={inputClass} placeholder="输入/百万" /></Field>
          <Field label="输出 token" hint="每百万输出 token 收费"><input type="number" step="0.01" value={form.outputCreditPerMillion} onChange={(e) => setForm({ ...form, outputCreditPerMillion: Number(e.target.value) })} className={inputClass} placeholder="输出/百万" /></Field>
          <Field label="Cache 写" hint="每百万缓存写入 token"><input type="number" step="0.01" value={form.cacheWriteCreditPerMillion} onChange={(e) => setForm({ ...form, cacheWriteCreditPerMillion: Number(e.target.value) })} className={inputClass} placeholder="cache 写/百万" /></Field>
          <Field label="Cache 读" hint="每百万缓存命中读取 token"><input type="number" step="0.01" value={form.cacheReadCreditPerMillion} onChange={(e) => setForm({ ...form, cacheReadCreditPerMillion: Number(e.target.value) })} className={inputClass} placeholder="cache 读/百万" /></Field>
          <Field label="最低/次" hint="每次调用最低收费，0 表示不设"><input type="number" step="0.01" value={form.minCreditsPerRun} onChange={(e) => setForm({ ...form, minCreditsPerRun: Number(e.target.value) })} className={inputClass} placeholder="最低/次" /></Field>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => setEditingId(null)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">取消</button><button onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">保存配置</button></div>
    </div>}
  </div>
}
