import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'

function sourceLabel(profile: any) {
  if (!profile) return '平台默认'
  if (profile.isOwner) return '我的模型'
  if (profile.visibility === 'platform') return '平台模型'
  return '共享模型'
}

function feeHint(profile: any) {
  if (!profile) return '使用平台默认模型：小蜜享受每日免费次数，超出后按平台模型费用计费。'
  if (profile.isOwner) return '使用你的自带模型 API Key：平台不收模型费用，仅记录用量。'
  if (profile.visibility === 'platform') return '使用平台模型：小蜜享受每日免费次数，超出后按平台模型费用计费。'
  return '使用他人共享/市场模型：模型费用按提供者定价结算。'
}

export function AgentModelDialog({ roomId, agent, onClose, onSaved, feedback }: any) {
  const [profiles, setProfiles] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const cfg = agent?.roomModelConfig || {}
  const [form, setForm] = useState<any>({ modelProfileId: cfg.modelProfileId || '', model: cfg.model || '', runtime: 'claude-code', maxTokens: cfg.maxTokens || 4096, temperature: cfg.temperature ?? '' })
  useEffect(() => { api.getModelProfiles().then((data) => setProfiles((data.profiles || []).filter((p: any) => p.canUse))).catch(() => setProfiles([])) }, [])
  if (!agent) return null
  const selectedProfile = profiles.find((p) => p.id === form.modelProfileId)
  const modelOptions = selectedProfile?.models || []
  const currentSource = sourceLabel(selectedProfile)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!roomId) return
    setSaving(true)
    try {
      const payload: any = { ...form }
      if (!payload.modelProfileId) delete payload.modelProfileId
      if (!payload.model) delete payload.model
      if (payload.temperature === '') delete payload.temperature
      await api.updateRoomAgentModel(roomId, agent.id, payload)
      feedback?.success?.('Agent 模型配置已保存，下一次调用生效')
      onSaved?.(); onClose?.()
    } catch (err: any) { feedback?.error?.(err?.message || '保存失败') }
    finally { setSaving(false) }
  }
  return <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
    <form onSubmit={save} className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
      <div><h2 className="text-lg font-semibold text-gray-800">设置 Agent 模型</h2><p className="text-sm text-gray-500 mt-1">{agent.name} · 配置保存在当前项目里的 Agent 实例上。</p></div>
      <label className="block"><span className="text-xs font-medium text-gray-500">模型配置来源</span><select value={form.modelProfileId} onChange={(e) => { const p = profiles.find((x) => x.id === e.target.value); setForm({ ...form, modelProfileId: e.target.value, model: p?.defaultModel || '' }) }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">系统默认 / 平台模型</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {sourceLabel(p)} · {p.defaultModel || '未设默认'}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="text-xs font-medium text-gray-500">模型</span>{modelOptions.length > 0 ? <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">使用配置默认</option>{modelOptions.map((m: string) => <option key={m} value={m}>{m}</option>)}</select> : <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="留空使用默认" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />}</label><label className="block"><span className="text-xs font-medium text-gray-500">Max tokens</span><input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label><label className="block"><span className="text-xs font-medium text-gray-500">Temperature</span><input type="number" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="默认" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label></div>
      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">当前来源：{currentSource}。{feeHint(selectedProfile)} 保存后不会中断当前运行；下一次 Agent 被唤起时生效。API Key 由模型配置提供者维护，其他成员不可查看。</div>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600">取消</button><button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-60">{saving ? '保存中...' : '保存'}</button></div>
    </form>
  </div>
}
