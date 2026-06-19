import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

function fmtCredit(n: any) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function Field({ label, children }: any) {
  return <label className="block"><span className="text-xs font-medium text-gray-500">{label}</span><div className="mt-1">{children}</div></label>
}

export function ModelProfilesPanel() {
  const [profiles, setProfiles] = useState<any[]>([])
  const [selected, setSelected] = useState<any | null>(null)
  const [rules, setRules] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<any>({ name: '', baseUrl: '', apiKey: '', defaultModel: '', models: '', visibility: 'private' })
  const [ruleForm, setRuleForm] = useState<any>({ model: '', inputCreditPerMillion: 0, outputCreditPerMillion: 0, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0 })

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.getModelProfiles()
      setProfiles(data.profiles || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const selectProfile = async (profile: any) => {
    setSelected(profile)
    setForm({ name: profile.name || '', baseUrl: profile.baseUrl || '', apiKey: '', defaultModel: profile.defaultModel || '', models: (profile.models || []).join(', '), visibility: profile.visibility || 'private' })
    try { const data = await api.getModelBillingRules(profile.id); setRules(data.rules || []) } catch { setRules([]) }
  }
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setMessage('')
    try {
      const payload = { ...form, models: form.models }
      const result = selected ? await api.updateModelProfile(selected.id, payload) : await api.createModelProfile(payload)
      setMessage(selected ? '模型配置已更新' : '模型配置已创建')
      await load(); await selectProfile(result.profile)
      if (!selected) setSelected(result.profile)
    } catch (err: any) { setMessage(err?.message || '保存失败') }
  }
  const saveRule = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selected || !ruleForm.model) return
    try {
      await api.upsertModelBillingRule(selected.id, ruleForm.model, ruleForm)
      const data = await api.getModelBillingRules(selected.id)
      setRules(data.rules || [])
      setMessage('模型计费规则已保存')
    } catch (err: any) { setMessage(err?.message || '规则保存失败') }
  }

  return <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm border border-gray-100 space-y-4">
    <div><h2 className="text-lg font-semibold text-gray-800">我的模型服务</h2><p className="text-sm text-gray-500 mt-1">配置自己的 Key/Base URL。private 仅自己使用；shared/platform 可作为模型提供方统计收入。</p></div>
    <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
      <div className="space-y-2">
        <button onClick={() => { setSelected(null); setRules([]); setForm({ name: '', baseUrl: '', apiKey: '', defaultModel: '', models: '', visibility: 'private' }) }} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">新增模型配置</button>
        {loading && <p className="text-sm text-gray-400">加载中...</p>}
        {profiles.map((p) => <button key={p.id} onClick={() => selectProfile(p)} className={`w-full rounded-xl border p-3 text-left text-sm ${selected?.id === p.id ? 'border-blue-200 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}><p className="font-medium text-gray-800 truncate">{p.name}</p><p className="text-xs text-gray-400 truncate">{p.defaultModel || '未设默认模型'} · {p.visibility}</p><p className="text-xs text-gray-400 truncate">Key ****{p.apiKeyLast4 || '未填'}</p></button>)}
      </div>
      <div className="space-y-5">
        <form onSubmit={saveProfile} className="grid gap-3 sm:grid-cols-2">
          <Field label="名称"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required /></Field>
          <Field label="可见性"><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="private">private 自用</option><option value="shared">shared 共享</option><option value="platform">platform 平台</option></select></Field>
          <Field label="Base URL"><input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="https://..." /></Field>
          <Field label="API Key"><input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder={selected ? '留空则不修改' : 'sk / ark / ...'} /></Field>
          <Field label="默认模型"><input value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="qwen3.7-max" /></Field>
          <Field label="模型列表，逗号分隔"><input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></Field>
          <div className="sm:col-span-2"><button className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">保存模型配置</button></div>
        </form>
        {selected && <div className="rounded-xl border border-gray-100 p-4 space-y-3"><h3 className="font-medium text-gray-800">Credit 计费规则</h3><div className="space-y-2">{rules.length === 0 && <p className="text-sm text-gray-400">暂无规则。未配置规则的运行只记 token，不扣 credit。</p>}{rules.map((r) => <div key={r.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{r.model}：前 {fmtCredit(r.inputCreditPerMillion)}/百万，后 {fmtCredit(r.outputCreditPerMillion)}/百万，最低 {fmtCredit(r.minCreditsPerRun)}</div>)}</div><form onSubmit={saveRule} className="grid gap-2 sm:grid-cols-3"><input placeholder="模型名" value={ruleForm.model} onChange={(e) => setRuleForm({ ...ruleForm, model: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><input type="number" step="0.01" placeholder="前 token/百万" value={ruleForm.inputCreditPerMillion} onChange={(e) => setRuleForm({ ...ruleForm, inputCreditPerMillion: Number(e.target.value) })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><input type="number" step="0.01" placeholder="后 token/百万" value={ruleForm.outputCreditPerMillion} onChange={(e) => setRuleForm({ ...ruleForm, outputCreditPerMillion: Number(e.target.value) })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><input type="number" step="0.01" placeholder="cache 写/百万" value={ruleForm.cacheWriteCreditPerMillion} onChange={(e) => setRuleForm({ ...ruleForm, cacheWriteCreditPerMillion: Number(e.target.value) })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><input type="number" step="0.01" placeholder="cache 读/百万" value={ruleForm.cacheReadCreditPerMillion} onChange={(e) => setRuleForm({ ...ruleForm, cacheReadCreditPerMillion: Number(e.target.value) })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><input type="number" step="0.01" placeholder="最低/次" value={ruleForm.minCreditsPerRun} onChange={(e) => setRuleForm({ ...ruleForm, minCreditsPerRun: Number(e.target.value) })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button className="sm:col-span-3 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">保存规则</button></form></div>}
        {message && <p className="text-sm text-blue-600">{message}</p>}
      </div>
    </div>
  </section>
}
