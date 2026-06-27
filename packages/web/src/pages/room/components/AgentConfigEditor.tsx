import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { TemplatePermissionPanel } from './TemplatePermissionPanel'
import { KnowledgePanel } from './KnowledgePanel'
import { AgentModelDialog } from './AgentModelDialog'

const TOOL_KEYS = ['chat', 'task', 'file', 'tab', 'interaction', 'members']

function formatAgentPrice(_agent: any, rule: any | null) {
  if (!rule || rule.enabled === false) return 'Agent 免费（模型费另计）'
  const quota = Number(rule.modelFreeRunsPerDay || 0) > 0 ? `；模型费每日前 ${Number(rule.modelFreeRunsPerDay)} 次免费，超出后收费` : ''
  if (rule.billingMode === 'free') return `Agent 免费（模型费另计${quota}）`
  return `Agent 按 token 计费：输入 ${fmtCredit(rule.inputCreditPerMillion)} / 输出 ${fmtCredit(rule.outputCreditPerMillion)} cr/百万 token（模型费另计${quota}）`
}

function fmtCredit(value: any) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

interface Props {
  agentId: string
  feedback: any
  scopeLabel: string
  emptyText?: string
  onSaved?: () => void
}

export function AgentConfigEditor({ agentId, feedback, scopeLabel, emptyText = '请选择 Agent', onSaved }: Props) {
  const [detail, setDetail] = useState<{ agent: any; skills: any[]; scripts: any[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ name: '', description: '', specialties: '', systemPrompt: '', tools: {} as Record<string, boolean> })
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '', enabled: true })
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null)
  const [scriptForm, setScriptForm] = useState({ name: '', description: '', language: 'bash', content: '', enabled: true, runPolicy: 'manual_only' })
  const [billingRule, setBillingRule] = useState<any | null>(null)
  const [showModelDialog, setShowModelDialog] = useState(false)
  const [billingForm, setBillingForm] = useState({ billingMode: 'free', inputCreditPerMillion: 0, outputCreditPerMillion: 0, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0, modelFreeRunsPerDay: 0, modelOveragePolicy: 'charge', enabled: true })

  useEffect(() => {
    if (!agentId) { setDetail(null); return }
    loadDetail(agentId)
  }, [agentId])

  const loadDetail = async (id = agentId) => {
    if (!id) return
    try {
      setLoading(true)
      const next = await api.getAgentDetail(id)
      setDetail(next)
      try {
        const br = await api.getAgentBillingRule(id)
        setBillingRule(br.rule)
        const rule = br.rule
        setBillingForm({
          billingMode: rule?.billingMode || 'free',
          inputCreditPerMillion: Number(rule?.inputCreditPerMillion || 0),
          outputCreditPerMillion: Number(rule?.outputCreditPerMillion || 0),
          cacheWriteCreditPerMillion: Number(rule?.cacheWriteCreditPerMillion || 0),
          cacheReadCreditPerMillion: Number(rule?.cacheReadCreditPerMillion || 0),
          minCreditsPerRun: Number(rule?.minCreditsPerRun || 0),
          modelFreeRunsPerDay: Number(rule?.modelFreeRunsPerDay || 0),
          modelOveragePolicy: rule?.modelOveragePolicy || 'charge',
          enabled: rule?.enabled !== false,
        })
      } catch { setBillingRule(null) }
      setEditingProfile(false)
      setEditingSkillId(null)
      setEditingScriptId(null)
      setShowModelDialog(false)
    } catch (err: any) {
      feedback.error(err?.message || '加载 Agent 配置失败')
    } finally {
      setLoading(false)
    }
  }

  const agent = detail?.agent
  const canEdit = agent?.canEdit !== false
  const tools = { chat: true, task: true, file: true, tab: true, interaction: true, members: true, ...(agent?.config?.tools || {}) }
  const priceText = formatAgentPrice(agent, billingRule)

  const startEditProfile = () => {
    if (!canEdit) return
    setProfileForm({
      name: agent?.name || '',
      description: agent?.description || '',
      specialties: (agent?.specialties || []).join('、'),
      systemPrompt: agent?.config?.systemPrompt || '',
      tools,
    })
    setEditingProfile(true)
  }

  const saveProfile = async () => {
    if (!canEdit || !agent?.id || !profileForm.name.trim()) return
    await api.updateAgent(agent.id, {
      name: profileForm.name.trim(),
      description: profileForm.description,
      specialties: profileForm.specialties.split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
      config: { ...(agent.config || {}), systemPrompt: profileForm.systemPrompt, tools: profileForm.tools },
    })
    feedback.success('Agent 配置已更新')
    await loadDetail(agent.id)
    onSaved?.()
  }

  const startNewSkill = () => {
    if (!canEdit) return
    setEditingSkillId('new')
    setSkillForm({ name: '', description: '', content: '# 新 Skill\n\n## 适用场景\n\n## 操作步骤\n', enabled: true })
  }
  const startEditSkill = (skill: any) => {
    if (!canEdit) return
    setEditingSkillId(skill.id)
    setSkillForm({ name: skill.name || '', description: skill.description || '', content: skill.content || '', enabled: skill.enabled !== false })
  }
  const saveSkill = async () => {
    if (!canEdit || !agent?.id || !skillForm.name.trim() || !editingSkillId) return
    if (editingSkillId === 'new') await api.createAgentSkill(agent.id, { ...skillForm, name: skillForm.name.trim() })
    else await api.updateAgentSkill(agent.id, editingSkillId, { ...skillForm, name: skillForm.name.trim() })
    setEditingSkillId(null)
    await loadDetail(agent.id)
    onSaved?.()
  }
  const deleteSkill = async (skillId: string) => {
    if (!canEdit || !agent?.id) return
    await api.deleteAgentSkill(agent.id, skillId)
    await loadDetail(agent.id)
    onSaved?.()
  }

  const startNewScript = () => {
    if (!canEdit) return
    setEditingScriptId('new')
    setScriptForm({ name: '', description: '', language: 'bash', content: '#!/usr/bin/env bash\n', enabled: true, runPolicy: 'manual_only' })
  }
  const startEditScript = (script: any) => {
    if (!canEdit) return
    setEditingScriptId(script.id)
    setScriptForm({ name: script.name || '', description: script.description || '', language: script.language || 'bash', content: script.content || '', enabled: script.enabled !== false, runPolicy: script.runPolicy || 'manual_only' })
  }
  const saveScript = async () => {
    if (!canEdit || !agent?.id || !scriptForm.name.trim() || !editingScriptId) return
    if (editingScriptId === 'new') await api.createAgentScript(agent.id, { ...scriptForm, name: scriptForm.name.trim() })
    else await api.updateAgentScript(agent.id, editingScriptId, { ...scriptForm, name: scriptForm.name.trim() })
    setEditingScriptId(null)
    await loadDetail(agent.id)
    onSaved?.()
  }
  const deleteScript = async (scriptId: string) => {
    if (!canEdit || !agent?.id) return
    await api.deleteAgentScript(agent.id, scriptId)
    await loadDetail(agent.id)
    onSaved?.()
  }

  const saveBillingRule = async () => {
    if (!canEdit || !agent?.id) return
    const body = billingForm.billingMode === 'free'
      ? { ...billingForm, billingMode: 'free', inputCreditPerMillion: 0, outputCreditPerMillion: 0, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0, enabled: true }
      : billingForm
    const result = await api.upsertAgentBillingRule(agent.id, body)
    setBillingRule(result.rule)
    setBillingForm({
      billingMode: result.rule?.billingMode || 'free',
      inputCreditPerMillion: Number(result.rule?.inputCreditPerMillion || 0),
      outputCreditPerMillion: Number(result.rule?.outputCreditPerMillion || 0),
      cacheWriteCreditPerMillion: Number(result.rule?.cacheWriteCreditPerMillion || 0),
      cacheReadCreditPerMillion: Number(result.rule?.cacheReadCreditPerMillion || 0),
      minCreditsPerRun: Number(result.rule?.minCreditsPerRun || 0),
      modelFreeRunsPerDay: Number(result.rule?.modelFreeRunsPerDay || 0),
      modelOveragePolicy: result.rule?.modelOveragePolicy || 'charge',
      enabled: result.rule?.enabled !== false,
    })
    feedback.success('Agent 计费规则已保存')
    onSaved?.()
  }

  if (!agentId) return <div className="text-center text-gray-400 py-8">{emptyText}</div>
  if (loading && !detail) return <div className="text-sm text-gray-400 py-4">加载中...</div>
  if (!agent) return <div className="text-sm text-gray-400 py-4">未找到 Agent。</div>

  return <div className="space-y-4">
    <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{canEdit ? '基础配置' : 'AI 介绍'}</h3>
          <p className="text-xs text-gray-400 mt-1">{canEdit ? scopeLabel : 'AI 市场公开信息：介绍、发布人和价格。'}</p>
          {agent?.builtInKey === 'default_assistant' && <p className="text-xs text-amber-600 mt-1">系统默认协调者已锁定：可查看和使用，不可编辑或删除。</p>}
          {!canEdit && agent?.builtInKey !== 'default_assistant' && <p className="text-xs text-amber-600 mt-1">你可以查看/使用该 AI，但只有发布人/admin 可以查看完整配置并修改。</p>}
        </div>
        {canEdit && <button onClick={startEditProfile} className="text-sm text-blue-600">编辑</button>}
      </div>
      {canEdit && agent?.builtInKey !== 'default_assistant' && <TemplatePermissionPanel targetType="agent" targetId={agent.id} canEdit={canEdit} feedback={feedback} />}
      {editingProfile ? <div className="space-y-3 mt-3">
        <input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="AI 名称" />
        <textarea value={profileForm.description} onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="描述" />
        <input value={profileForm.specialties} onChange={(e) => setProfileForm({ ...profileForm, specialties: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="专长，顿号/逗号分隔" />
        <textarea value={profileForm.systemPrompt} onChange={(e) => setProfileForm({ ...profileForm, systemPrompt: e.target.value })} rows={5} className="w-full px-3 py-2 border rounded-lg text-sm font-mono" placeholder="System Prompt" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{TOOL_KEYS.map((key) => <label key={key} className="text-sm flex items-center gap-2 border rounded-lg px-3 py-2"><input type="checkbox" checked={profileForm.tools[key] !== false} onChange={() => setProfileForm({ ...profileForm, tools: { ...profileForm.tools, [key]: profileForm.tools[key] === false } })} />{key}</label>)}</div>
        <div className="flex justify-end gap-2"><button onClick={() => setEditingProfile(false)} className="px-3 py-2 bg-gray-100 rounded-lg text-sm">取消</button><button onClick={saveProfile} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">保存</button></div>
      </div> : <div>
        <div className="flex items-center gap-2 flex-wrap"><h4 className="text-lg font-semibold text-gray-900">{agent.name}</h4><span className="text-xs px-2 py-1 rounded-full bg-violet-50 text-violet-600">Agent</span>{agent.builtInKey === 'default_assistant' && <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-600">系统内置</span>}{agent.autoEnabled && <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600">协调者</span>}{canEdit && agent.isModified && <span className="text-xs px-2 py-1 rounded-full bg-orange-50 text-orange-600">本地已修改</span>}</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl bg-gray-50 px-3 py-2"><p className="text-[11px] text-gray-400">发布人</p><p className="text-sm text-gray-700">{agent.ownerName || agent.ownerId || '未知'}</p></div>
          <div className="rounded-xl bg-blue-50 px-3 py-2"><p className="text-[11px] text-blue-400">价格</p><p className="text-sm text-blue-700">{priceText}</p></div>
        </div>
        <div className="mt-4"><p className="text-xs font-medium text-gray-500 mb-1">介绍</p><p className="text-sm text-gray-600 whitespace-pre-wrap leading-6">{agent.description || '发布人暂未填写介绍。'}</p></div>
        <div className="mt-4"><p className="text-xs font-medium text-gray-500 mb-2">专长 / 适用场景</p>{agent.specialties?.length > 0 ? <div className="flex gap-2 flex-wrap">{agent.specialties.map((item: string) => <span key={item} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">{item}</span>)}</div> : <p className="text-sm text-gray-400">发布人暂未填写专长。</p>}</div>
        {canEdit && <pre className="text-xs bg-gray-900 text-gray-100 rounded-xl p-3 overflow-auto max-h-40 whitespace-pre-wrap mt-3">{agent.config?.systemPrompt || '暂无自定义提示词'}</pre>}
      </div>}
    </section>

    <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3"><div><h3 className="font-semibold text-gray-900">模型与运行</h3><p className="text-xs text-gray-400 mt-1">通讯录 Agent 默认模型。项目房间默认继承，也可在房间里单独覆盖。</p></div>{canEdit && <button onClick={() => setShowModelDialog(true)} className="text-sm text-blue-600">设置模型</button>}</div>
      <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
        {agent.defaultModelConfig?.model || agent.defaultModelConfig?.modelProfileName ? <><p className="font-medium text-gray-800">{agent.defaultModelConfig.modelProfileName || '默认模型配置'}{agent.defaultModelConfig.model ? ` · ${agent.defaultModelConfig.model}` : ''}</p><p className="text-xs text-gray-500 mt-1">{agent.defaultModelConfig.modelSource === 'user_owned' ? '我的模型' : agent.defaultModelConfig.modelSource === 'platform' ? '平台模型' : agent.defaultModelConfig.modelSource === 'marketplace' ? '共享/市场模型' : '模型配置'}{agent.defaultModelConfig.allowPaidSharedModel ? ' · 允许按模型定价售卖' : ''}</p></> : <p>未设置 Agent 默认模型；运行时使用平台默认，或由项目房间单独覆盖。</p>}
      </div>
    </section>
    {showModelDialog && <AgentModelDialog mode="agent-default" agent={agent} onClose={() => setShowModelDialog(false)} onSaved={() => loadDetail(agent.id)} feedback={feedback} />}

    {canEdit && <KnowledgePanel scope="agent" agentId={agent.id} feedback={feedback} compact />}

    {canEdit && <>
    <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3"><div><h3 className="font-semibold text-gray-900">Agent 服务计费</h3><p className="text-xs text-gray-400 mt-1">Agent 服务费和模型费免费额度可独立设置。免费额度内平台承担模型费，超出后按模型规则扣使用方 credit。</p></div><span className={`text-xs rounded-full px-2 py-1 ${billingForm.billingMode === 'per_token' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{billingForm.billingMode === 'per_token' ? '按 token 收费' : '服务免费'}</span></div>
      <div className="space-y-3">
        <select value={billingForm.billingMode} onChange={(e) => setBillingForm({ ...billingForm, billingMode: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm"><option value="free">Agent 服务免费</option><option value="per_token">Agent 服务按 token 计费</option></select>
        <div className="grid gap-2 sm:grid-cols-2 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
          <label className="text-xs text-gray-500">模型费每日免费次数<input type="number" min="0" step="1" value={billingForm.modelFreeRunsPerDay} onChange={(e) => setBillingForm({ ...billingForm, modelFreeRunsPerDay: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">超额策略<select value={billingForm.modelOveragePolicy} onChange={(e) => setBillingForm({ ...billingForm, modelOveragePolicy: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"><option value="charge">超额后收费</option><option value="block">超额后阻止（预留）</option></select></label>
          <p className="text-xs text-violet-600 sm:col-span-2">免费次数只抵扣模型费，不影响 Agent 服务费；0 表示不提供模型费免费额度。</p>
        </div>
        {billingForm.billingMode === 'per_token' && <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-500">输入 token / 百万<input type="number" step="0.0001" value={billingForm.inputCreditPerMillion} onChange={(e) => setBillingForm({ ...billingForm, inputCreditPerMillion: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">输出 token / 百万<input type="number" step="0.0001" value={billingForm.outputCreditPerMillion} onChange={(e) => setBillingForm({ ...billingForm, outputCreditPerMillion: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">缓存写 / 百万<input type="number" step="0.0001" value={billingForm.cacheWriteCreditPerMillion} onChange={(e) => setBillingForm({ ...billingForm, cacheWriteCreditPerMillion: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500">缓存读 / 百万<input type="number" step="0.0001" value={billingForm.cacheReadCreditPerMillion} onChange={(e) => setBillingForm({ ...billingForm, cacheReadCreditPerMillion: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500 sm:col-span-2">单次最低收费（可选）<input type="number" step="0.0001" value={billingForm.minCreditsPerRun} onChange={(e) => setBillingForm({ ...billingForm, minCreditsPerRun: Number(e.target.value) })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
        </div>}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2"><p className="text-sm text-gray-600">当前：{priceText}</p><button onClick={saveBillingRule} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">保存计费</button></div>
      </div>
    </section>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Skills</h3>{canEdit && <button onClick={startNewSkill} className="text-sm text-blue-600">+ 新建</button>}</div>
        {(detail?.skills || []).length === 0 && <p className="text-sm text-gray-400">暂无 Skill。</p>}
        <div className="space-y-3">{(detail?.skills || []).map((skill) => <div key={skill.id} className="border border-gray-100 rounded-xl p-3">
          <div className="flex items-center justify-between"><b className="text-sm">{skill.name}</b>{canEdit && <div className="flex gap-2"><button onClick={() => startEditSkill(skill)} className="text-xs text-blue-600">编辑</button><button onClick={() => deleteSkill(skill.id)} className="text-xs text-red-500">删除</button></div>}</div>
          <p className="text-xs text-gray-500 mt-1">{skill.description || '暂无描述'}</p>
          <pre className="text-xs bg-gray-50 rounded-lg p-2 mt-2 max-h-28 overflow-auto whitespace-pre-wrap">{skill.content}</pre>
        </div>)}</div>
        {canEdit && editingSkillId && <div className="mt-3 border border-blue-100 bg-blue-50/40 rounded-xl p-3 space-y-2"><input value={skillForm.name} onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" placeholder="Skill 名称" /><input value={skillForm.description} onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" placeholder="描述" /><label className="text-xs flex items-center gap-2"><input type="checkbox" checked={skillForm.enabled} onChange={(e) => setSkillForm({ ...skillForm, enabled: e.target.checked })} />启用</label><textarea value={skillForm.content} onChange={(e) => setSkillForm({ ...skillForm, content: e.target.value })} rows={8} className="w-full px-3 py-2 border rounded text-xs font-mono" /><div className="flex justify-end gap-2"><button onClick={() => setEditingSkillId(null)} className="text-sm px-3 py-1.5 bg-gray-100 rounded">取消</button><button onClick={saveSkill} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded">保存</button></div></div>}
      </section>
      <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Scripts</h3>{canEdit && <button onClick={startNewScript} className="text-sm text-blue-600">+ 新建</button>}</div>
        {(detail?.scripts || []).length === 0 && <p className="text-sm text-gray-400">暂无脚本。</p>}
        <div className="space-y-3">{(detail?.scripts || []).map((script) => <div key={script.id} className="border border-gray-100 rounded-xl p-3">
          <div className="flex items-center justify-between"><b className="text-sm">{script.name}</b>{canEdit && <div className="flex gap-2"><button onClick={() => startEditScript(script)} className="text-xs text-blue-600">编辑</button><button onClick={() => deleteScript(script.id)} className="text-xs text-red-500">删除</button></div>}</div>
          <p className="text-xs text-gray-500 mt-1">{script.description || '暂无描述'}</p>
          <pre className="text-xs bg-gray-50 rounded-lg p-2 mt-2 max-h-28 overflow-auto whitespace-pre-wrap">{script.content}</pre>
        </div>)}</div>
        {canEdit && editingScriptId && <div className="mt-3 border border-blue-100 bg-blue-50/40 rounded-xl p-3 space-y-2"><input value={scriptForm.name} onChange={(e) => setScriptForm({ ...scriptForm, name: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" placeholder="脚本名称" /><input value={scriptForm.description} onChange={(e) => setScriptForm({ ...scriptForm, description: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" placeholder="描述" /><div className="grid grid-cols-2 gap-2"><input value={scriptForm.language} onChange={(e) => setScriptForm({ ...scriptForm, language: e.target.value })} className="px-3 py-2 border rounded text-sm" placeholder="language" /><select value={scriptForm.runPolicy} onChange={(e) => setScriptForm({ ...scriptForm, runPolicy: e.target.value })} className="px-3 py-2 border rounded text-sm"><option value="manual_only">manual_only</option><option value="agent_allowed">agent_allowed</option><option value="disabled">disabled</option></select></div><label className="text-xs flex items-center gap-2"><input type="checkbox" checked={scriptForm.enabled} onChange={(e) => setScriptForm({ ...scriptForm, enabled: e.target.checked })} />启用</label><textarea value={scriptForm.content} onChange={(e) => setScriptForm({ ...scriptForm, content: e.target.value })} rows={8} className="w-full px-3 py-2 border rounded text-xs font-mono" /><div className="flex justify-end gap-2"><button onClick={() => setEditingScriptId(null)} className="text-sm px-3 py-1.5 bg-gray-100 rounded">取消</button><button onClick={saveScript} className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded">保存</button></div></div>}
      </section>
    </div>
    </>}
  </div>
}
