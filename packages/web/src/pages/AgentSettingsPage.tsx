import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Bot, PlayCircle, Save, Store, Wrench } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { AGENT_TOOL_KEYS, agentToForm, buildAgentPayload, emptyAgentForm } from './home-agent-form'
import type { AgentFormState } from './home-agent-form'

type TabKey = 'basic' | 'capability' | 'knowledge' | 'publish' | 'runtime'
const tabs: { key: TabKey; label: string; Icon: any }[] = [
  { key: 'basic', label: '基础', Icon: Bot },
  { key: 'capability', label: '能力', Icon: Wrench },
  { key: 'knowledge', label: '知识库', Icon: BookOpen },
  { key: 'publish', label: '发布', Icon: Store },
  { key: 'runtime', label: '运行', Icon: PlayCircle },
]

export default function AgentSettingsPage() {
  const { agentId } = useParams()
  const navigate = useNavigate()
  const isNew = !agentId
  const [activeTab, setActiveTab] = useState<TabKey>('basic')
  const [agent, setAgent] = useState<any>(null)
  const [form, setForm] = useState<AgentFormState>(emptyAgentForm())
  const [skills, setSkills] = useState<any[]>([])
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '', enabled: true })
  const [knowledge, setKnowledge] = useState<any>(null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const canEdit = isNew || agent?.canEdit !== false
  const title = isNew ? '新建 Agent' : (agent?.name || 'Agent 设置')

  useEffect(() => {
    if (isNew) { setForm(emptyAgentForm()); return }
    void load()
  }, [agentId])

  async function load() {
    if (!agentId) return
    setLoading(true)
    try {
      const detail = await api.getAgentDetail(agentId)
      setAgent(detail.agent)
      setForm(agentToForm(detail.agent))
      setSkills(detail.skills || [])
      await refreshKnowledge()
    } finally {
      setLoading(false)
    }
  }

  async function refreshKnowledge() {
    if (!agentId) return
    try { setKnowledge(await api.getAgentKnowledge(agentId)) } catch (err: any) { setKnowledge({ error: err.message || '知识库状态加载失败' }) }
  }

  async function saveAgent() {
    const name = form.name.trim()
    if (!name) { setMessage('请先填写 Agent 名称'); return }
    setSaving(true)
    try {
      const body = buildAgentPayload(form)
      if (isNew) {
        const created = await api.createAgent(body)
        setMessage('Agent 已创建')
        navigate(`/agents/${created.agent.id}/settings`, { replace: true })
      } else if (agentId) {
        const result: any = await api.updateAgent(agentId, body)
        setAgent(result.agent || { ...agent, ...body })
        setMessage('Agent 已保存')
        await load()
      }
    } catch (err: any) {
      setMessage(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleTool = (key: keyof AgentFormState['tools']) => setForm((prev) => ({ ...prev, tools: { ...prev.tools, [key]: !prev.tools[key] } }))
  const startNewSkill = () => { setEditingSkillId('new'); setSkillForm({ name: '', description: '', content: '# 新 Skill\n\n## 适用场景\n\n## 操作步骤\n', enabled: true }) }
  const startEditSkill = (skill: any) => { setEditingSkillId(skill.id); setSkillForm({ name: skill.name || '', description: skill.description || '', content: skill.content || '', enabled: skill.enabled !== false }) }
  async function saveSkill() {
    if (!agentId || !skillForm.name.trim()) return
    if (editingSkillId === 'new') await api.createAgentSkill(agentId, { ...skillForm, name: skillForm.name.trim() })
    else if (editingSkillId) await api.updateAgentSkill(agentId, editingSkillId, { ...skillForm, name: skillForm.name.trim() })
    setEditingSkillId(null)
    await load()
  }
  async function removeSkill(skillId: string) { if (agentId) { await api.deleteAgentSkill(agentId, skillId); await load() } }

  const tabBody = useMemo(() => {
    if (activeTab === 'basic') return <BasicTab form={form} setForm={setForm} readonly={!canEdit} />
    if (activeTab === 'capability') return <CapabilityTab form={form} toggleTool={toggleTool as any} readonly={!canEdit} skills={skills} editingSkillId={editingSkillId} skillForm={skillForm} setSkillForm={setSkillForm} setEditingSkillId={setEditingSkillId} startNewSkill={startNewSkill} startEditSkill={startEditSkill} saveSkill={saveSkill} removeSkill={removeSkill} canEdit={canEdit && !isNew} isNew={isNew} />
    if (activeTab === 'knowledge') return <KnowledgeTab agent={agent} knowledge={knowledge} refresh={refreshKnowledge} isNew={isNew} />
    if (activeTab === 'publish') return <PublishTab agent={agent} isNew={isNew} />
    return <RuntimeTab agent={agent} knowledge={knowledge} isNew={isNew} />
  }, [activeTab, form, skills, editingSkillId, skillForm, knowledge, agent, canEdit, isNew])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-3 sm:px-4">
          <button onClick={() => navigate(-1)} className="fc-pressable flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200" title="返回"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold text-gray-900">{title}</h1><p className="truncate text-xs text-gray-400">Agent 独立设置 · 多 Tab 管理</p></div>
          {canEdit && <button onClick={saveAgent} disabled={saving} className="fc-pressable hidden items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60 sm:inline-flex"><Save className="h-4 w-4" />{saving ? '保存中' : '保存'}</button>}
        </div>
        <div className="mx-auto max-w-5xl overflow-x-auto px-3 pb-2 sm:px-4 fc-scrollbar-hide"><div className="inline-flex min-w-max gap-1 rounded-2xl bg-gray-100 p-1">{tabs.map(({ key, label, Icon }) => <button key={key} onClick={() => setActiveTab(key)} className={`fc-pressable flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm ${activeTab === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}><Icon className="h-4 w-4" />{label}</button>)}</div></div>
      </header>
      <main className="mx-auto max-w-5xl px-3 py-4 pb-24 sm:px-4 sm:py-6">
        {message && <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}
        {loading ? <div className="rounded-2xl bg-white p-6 text-sm text-gray-400">加载中...</div> : tabBody}
      </main>
      {canEdit && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden"><button onClick={saveAgent} disabled={saving} className="fc-pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-60"><Save className="h-4 w-4" />{saving ? '保存中' : '保存'}</button></div>}
    </div>
  )
}

function BasicTab({ form, setForm, readonly }: { form: AgentFormState; setForm: any; readonly: boolean }) {
  return <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 sm:p-5"><div><h2 className="font-semibold text-gray-800">基础信息</h2><p className="text-sm text-gray-500">定义 Agent 的身份、职责和提示词。</p></div><input value={form.name} disabled={readonly} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm disabled:bg-gray-50" placeholder="Agent 名称" /><input value={form.description} disabled={readonly} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm disabled:bg-gray-50" placeholder="职责描述" /><input value={form.specialties} disabled={readonly} onChange={(e) => setForm({ ...form, specialties: e.target.value })} className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm disabled:bg-gray-50" placeholder="专长，逗号分隔" /><textarea value={form.systemPrompt} disabled={readonly} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} rows={6} className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm disabled:bg-gray-50" placeholder="系统提示词" /><textarea value={form.agentMarkdown} disabled={readonly} onChange={(e) => setForm({ ...form, agentMarkdown: e.target.value })} rows={10} className="w-full rounded-xl border px-3 py-2 font-mono text-sm disabled:bg-gray-50" placeholder="AGENT.md" /></section>
}

function CapabilityTab(props: any) {
  const { form, toggleTool, readonly, skills, editingSkillId, skillForm, setSkillForm, setEditingSkillId, startNewSkill, startEditSkill, saveSkill, removeSkill, canEdit, isNew } = props
  return <div className="space-y-4"><section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5"><h2 className="font-semibold text-gray-800">工具权限</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{AGENT_TOOL_KEYS.map((key) => <label key={key} className="rounded-xl border bg-gray-50 px-3 py-2 text-sm"><input className="mr-2" type="checkbox" disabled={readonly} checked={form.tools[key]} onChange={() => toggleTool(key)} />{key}</label>)}</div></section><section className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-gray-800">Skills</h2><p className="text-sm text-gray-500">Agent 的可复用技能说明。</p></div>{canEdit && <button onClick={startNewSkill} className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-600">新建</button>}</div>{isNew && <p className="mt-3 rounded-xl border border-dashed p-3 text-sm text-gray-400">创建 Agent 后可维护 Skills。</p>}<div className="mt-3 space-y-2">{skills.map((skill: any) => <div key={skill.id} className="rounded-xl border p-3"><div className="flex justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{skill.name}</p><p className="truncate text-xs text-gray-400">{skill.description}</p></div>{canEdit && <div className="flex gap-2 text-xs"><button onClick={() => startEditSkill(skill)} className="text-blue-600">编辑</button><button onClick={() => removeSkill(skill.id)} className="text-red-500">删除</button></div>}</div></div>)}</div>{editingSkillId && <div className="mt-3 space-y-2 rounded-2xl bg-blue-50 p-3"><input value={skillForm.name} onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Skill 名称" /><input value={skillForm.description} onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Skill 描述" /><label className="text-xs"><input type="checkbox" checked={skillForm.enabled} onChange={(e) => setSkillForm({ ...skillForm, enabled: e.target.checked })} /> 启用</label><textarea value={skillForm.content} onChange={(e) => setSkillForm({ ...skillForm, content: e.target.value })} rows={8} className="w-full rounded-xl border px-3 py-2 font-mono text-xs" /><div className="flex justify-end gap-2"><button onClick={() => setEditingSkillId(null)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs">取消</button><button onClick={saveSkill} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">保存</button></div></div>}</section></div>
}

function KnowledgeTab({ agent, knowledge, refresh, isNew }: any) {
  return <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-800">Agent 知识库</h2><p className="text-sm text-gray-500">知识库文件保存在 Agent Client 本地，Agent 运行时可读取。</p></div>{!isNew && <button onClick={refresh} className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-600">刷新</button>}</div>{isNew ? <p className="rounded-xl border border-dashed p-4 text-sm text-gray-400">创建并由 Agent Client 接管后可管理知识库。</p> : <div className="grid gap-3 sm:grid-cols-2"><Info label="接管状态" value={knowledge?.managedByClient ? '已接管' : '未接管'} /><Info label="客户端" value={knowledge?.client?.name || '-'} /><Info label="状态" value={knowledge?.client?.status || '-'} /><Info label="最近在线" value={knowledge?.client?.lastSeenAt ? new Date(knowledge.client.lastSeenAt).toLocaleString() : '-'} /></div>}<div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-700"><p>{knowledge?.knowledge?.message || '请在 Agent Client 控制台管理具体知识库文件。'}</p><p className="mt-2">客户端本地 API：<code>/api/local/agents/{agent?.id || ':agentId'}/knowledge</code></p></div></section>
}
function PublishTab({ agent, isNew }: any) { return <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5"><h2 className="font-semibold text-gray-800">发布</h2>{isNew ? <p className="text-sm text-gray-400">创建后可上架市场。</p> : <><Info label="发布方/收费方" value={agent?.ownerName || agent?.ownerId || '-'} /><Info label="市场状态" value={agent?.marketListed ? '已上架' : '未上架'} /><p className="text-sm text-gray-500">上架/下架仍可在通讯录 Agent 卡片快捷操作中完成，后续这里会承载计费规则。</p></>}</section> }
function RuntimeTab({ agent, knowledge, isNew }: any) { return <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5"><h2 className="font-semibold text-gray-800">运行</h2>{isNew ? <p className="text-sm text-gray-400">创建并接管后显示运行状态。</p> : <><Info label="执行位置" value={agent?.deployment || 'client'} /><Info label="客户端" value={knowledge?.client?.name || agent?.clientConnectorName || '-'} /><Info label="在线状态" value={knowledge?.client?.status || agent?.clientConnectorStatus || '-'} /><Info label="最近在线" value={(knowledge?.client?.lastSeenAt || agent?.clientLastSeenAt) ? new Date(knowledge?.client?.lastSeenAt || agent?.clientLastSeenAt).toLocaleString() : '-'} /></>}</section> }
function Info({ label, value }: { label: string; value: any }) { return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><p className="text-xs text-gray-400">{label}</p><p className="mt-1 break-words text-sm text-gray-800">{value || '-'}</p></div> }
