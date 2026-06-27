import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'

type Mode = 'agent-default' | 'room-override'

function sourceLabel(profile: any) {
  if (!profile) return '平台默认'
  if (profile.isOwner) return '我的模型'
  if (profile.visibility === 'platform') return '平台模型'
  return '共享/市场模型'
}

function feeHint(profile: any, mode: Mode, allowPaidSharedModel: boolean) {
  if (!profile) return mode === 'agent-default' ? '未设置时，Agent 会在项目中使用平台默认模型，或由项目单独覆盖。' : '恢复继承后，会优先使用通讯录 Agent 默认模型；若未配置则使用平台默认模型。'
  if (profile.isOwner && profile.visibility !== 'shared') return '使用你的自带模型 API Key：你自己使用时平台不收模型费用；若要让别人付费使用，请先将模型上架为共享模型并设置价格。'
  if (profile.visibility === 'platform') return '使用平台模型：小蜜享受每日免费次数，超出后按平台模型费用计费。'
  return allowPaidSharedModel ? '使用共享/市场模型：他人在项目中使用该 Agent 时，模型费用按模型提供者定价结算。' : '使用共享/市场模型：费用按提供者定价结算。'
}

export function AgentModelDialog({ mode = 'room-override', roomId, agent, onClose, onSaved, feedback }: any & { mode?: Mode }) {
  const [profiles, setProfiles] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const cfg = mode === 'agent-default' ? agent?.defaultModelConfig || {} : agent?.roomModelConfig || {}
  const [form, setForm] = useState<any>({ modelProfileId: cfg.modelProfileId || '', model: cfg.model || '', runtime: 'claude-code', maxTokens: cfg.maxTokens || 4096, temperature: cfg.temperature ?? '', allowPaidSharedModel: cfg.allowPaidSharedModel || false })
  useEffect(() => { api.getModelProfiles().then((data) => setProfiles((data.profiles || []).filter((p: any) => p.canUse))).catch(() => setProfiles([])) }, [])
  if (!agent) return null
  const selectedProfile = profiles.find((p) => p.id === form.modelProfileId)
  const modelOptions = selectedProfile?.models || []
  const isAgentDefault = mode === 'agent-default'
  const title = isAgentDefault ? '设置 Agent 默认模型' : '仅覆盖当前房间模型'
  const subtitle = isAgentDefault ? `${agent.name} · 保存后该 Agent 在所有房间、私聊和工作组入口默认统一生效。` : `${agent.name} · 这里只影响当前项目；留空保存会恢复继承通讯录 Agent 默认模型。`
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!agent?.id) return
    setSaving(true)
    try {
      const payload: any = { ...form }
      if (!payload.modelProfileId) delete payload.modelProfileId
      if (!payload.model) delete payload.model
      if (payload.temperature === '') delete payload.temperature
      if (!isAgentDefault) delete payload.allowPaidSharedModel
      if (isAgentDefault) await api.updateAgentDefaultModel(agent.id, payload)
      else await api.updateRoomAgentModel(roomId, agent.id, payload)
      feedback?.success?.(isAgentDefault ? 'Agent 默认模型已保存' : '本房间模型配置已保存')
      onSaved?.(); onClose?.()
    } catch (err: any) { feedback?.error?.(err?.message || '保存失败') }
    finally { setSaving(false) }
  }
  return <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
    <form onSubmit={save} className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
      <div><h2 className="text-lg font-semibold text-gray-800">{title}</h2><p className="text-sm text-gray-500 mt-1">{subtitle}</p></div>
      {!isAgentDefault && <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">一般无需设置。这里仅用于让当前项目使用不同模型；不设置则始终继承通讯录 Agent 的默认模型。</div>}
      <label className="block"><span className="text-xs font-medium text-gray-500">模型配置来源</span><select value={form.modelProfileId} onChange={(e) => { const p = profiles.find((x) => x.id === e.target.value); setForm({ ...form, modelProfileId: e.target.value, model: p?.defaultModel || '', allowPaidSharedModel: form.allowPaidSharedModel && p?.visibility === 'shared' }) }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">{isAgentDefault ? '不设置 / 使用平台默认' : '恢复继承通讯录 Agent 默认模型'}</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {sourceLabel(p)} · {p.defaultModel || '未设默认'}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="text-xs font-medium text-gray-500">模型</span>{modelOptions.length > 0 ? <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">使用配置默认</option>{modelOptions.map((m: string) => <option key={m} value={m}>{m}</option>)}</select> : <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="留空使用默认" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />}</label><label className="block"><span className="text-xs font-medium text-gray-500">Max tokens</span><input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label><label className="block"><span className="text-xs font-medium text-gray-500">Temperature</span><input type="number" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="默认" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label></div>
      {isAgentDefault && selectedProfile?.visibility === 'shared' && <label className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-xs text-emerald-700"><input type="checkbox" checked={!!form.allowPaidSharedModel} onChange={(e) => setForm({ ...form, allowPaidSharedModel: e.target.checked })} className="mt-0.5" /><span>允许其他用户使用此 Agent 时调用该共享模型，并按模型定价结算给模型提供者。后续模型售卖会沿用这条规则。</span></label>}
      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">当前来源：{sourceLabel(selectedProfile)}。{feeHint(selectedProfile, mode, !!form.allowPaidSharedModel)} API Key 由模型配置提供者维护，其他成员不可查看。</div>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600">取消</button><button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-60">{saving ? '保存中...' : '保存'}</button></div>
    </form>
  </div>
}
