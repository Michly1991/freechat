import { X } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { AGENT_TOOL_KEYS } from '../home-agent-form'
import type { AgentFormState, AgentToolKey } from '../home-agent-form'

interface AgentEditorDialogProps {
  open: boolean
  editingAgentId: string | null
  currentAgent: any | null
  agentForm: AgentFormState
  setAgentForm: Dispatch<SetStateAction<AgentFormState>>
  canEdit: boolean
  skills: any[]
  editingSkillId: string | null
  skillForm: { name: string; description: string; content: string; enabled: boolean }
  skillSaving: boolean
  onClose: () => void
  onSaveAgent: () => void
  onToggleTool: (key: AgentToolKey) => void
  onStartNewSkill: () => void
  onStartEditSkill: (skill: any) => void
  onRemoveSkill: (skillId: string) => void
  onSetEditingSkillId: (value: string | null) => void
  onSetSkillForm: Dispatch<SetStateAction<{ name: string; description: string; content: string; enabled: boolean }>>
  onSaveSkill: () => void
}

export function AgentEditorDialog({
  open,
  editingAgentId,
  currentAgent,
  agentForm,
  setAgentForm,
  canEdit,
  skills,
  editingSkillId,
  skillForm,
  skillSaving,
  onClose,
  onSaveAgent,
  onToggleTool,
  onStartNewSkill,
  onStartEditSkill,
  onRemoveSkill,
  onSetEditingSkillId,
  onSetSkillForm,
  onSaveSkill,
}: AgentEditorDialogProps) {
  if (!open) return null
  const readonly = !canEdit
  const title = editingAgentId ? (readonly ? '查看 Agent' : '编辑 Agent') : '新建 Agent'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex h-[96dvh] w-full max-w-4xl flex-col rounded-t-3xl bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 p-4 sm:p-5">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">集中维护 Agent 的基础描述、工具权限、Skills 与客户端知识库状态。</p>
            {currentAgent?.builtInKey === 'default_assistant' && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">系统默认助理已锁定，仅支持查看详情。</p>}
          </div>
          <button onClick={onClose} className="fc-pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200" title="关闭" aria-label="关闭"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
              <div><p className="text-sm font-semibold text-gray-800">基础信息</p><p className="text-xs text-gray-400">面向用户展示，也会影响 Agent 运行提示词。</p></div>
              <input value={agentForm.name} disabled={readonly} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="Agent 名称，例如：需求分析师" />
              <input value={agentForm.description} disabled={readonly} onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="职责描述" />
              <input value={agentForm.specialties} disabled={readonly} onChange={(e) => setAgentForm({ ...agentForm, specialties: e.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="专长，逗号分隔" />
              <textarea value={agentForm.systemPrompt} disabled={readonly} onChange={(e) => setAgentForm({ ...agentForm, systemPrompt: e.target.value })} rows={5} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="系统提示词" />
              <textarea value={agentForm.agentMarkdown} disabled={readonly} onChange={(e) => setAgentForm({ ...agentForm, agentMarkdown: e.target.value })} rows={7} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-xs font-mono disabled:bg-gray-50 disabled:text-gray-500" placeholder="AGENT.md：Agent 介绍、Description、明细、资源/Skill 使用说明（留空则自动生成）" />
            </section>

            <div className="space-y-4">
              <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4">
                <div><p className="text-sm font-semibold text-gray-800">工具权限</p><p className="text-xs text-gray-400">控制 Agent 可使用的房间工具。</p></div>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {AGENT_TOOL_KEYS.map((key) => <label key={key} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"><input type="checkbox" disabled={readonly} checked={agentForm.tools[key]} onChange={() => onToggleTool(key)} />{key}</label>)}
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
                <div><p className="text-sm font-semibold text-gray-800">知识库</p><p className="text-xs text-gray-500">Agent 知识库由 Agent Client 本地维护；服务端编辑页只展示客户端上报状态/元数据。后续接入客户端知识库管理 API 后在这里显示索引、文件数和同步状态。</p></div>
                <div className="rounded-xl border border-dashed border-blue-200 bg-white p-3 text-xs text-blue-700">
                  {currentAgent?.managedByClient ? `执行客户端：${currentAgent.clientConnectorName || '未命名客户端'}${currentAgent.clientConnectorStatus ? ` · ${currentAgent.clientConnectorStatus}` : ''}` : '当前 Agent 暂未显示客户端知识库元数据。'}
                </div>
              </section>
            </div>
          </div>

          {editingAgentId && (
            <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-gray-700">Skills</p><p className="text-xs text-gray-400">维护这个 Agent 的技能说明，运行时会写入 skills/。</p></div>{canEdit && <button onClick={onStartNewSkill} className="fc-pressable rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-600 hover:bg-blue-100">+ 新建 Skill</button>}</div>
              {skills.length === 0 && editingSkillId !== 'new' && <p className="rounded-xl border border-dashed border-gray-200 p-3 text-xs text-gray-400">暂无 Skill。</p>}
              <div className="space-y-2">{skills.map((skill) => <div key={skill.id} className="rounded-xl border border-gray-100 p-3"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-700">{skill.name}</p>{skill.description && <p className="truncate text-xs text-gray-400">{skill.description}</p>}</div>{canEdit && <div className="flex shrink-0 gap-2"><button onClick={() => onStartEditSkill(skill)} className="text-xs text-blue-600">编辑</button><button onClick={() => onRemoveSkill(skill.id)} className="text-xs text-red-500">删除</button></div>}</div></div>)}</div>
              {editingSkillId && <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3 space-y-2"><input value={skillForm.name} onChange={(e) => onSetSkillForm({ ...skillForm, name: e.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="Skill 名称" /><input value={skillForm.description} onChange={(e) => onSetSkillForm({ ...skillForm, description: e.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="Skill 描述" /><label className="flex items-center gap-2 text-xs text-gray-500"><input type="checkbox" checked={skillForm.enabled} onChange={(e) => onSetSkillForm({ ...skillForm, enabled: e.target.checked })} />启用</label><textarea value={skillForm.content} onChange={(e) => onSetSkillForm({ ...skillForm, content: e.target.value })} rows={8} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-xs font-mono" placeholder="SKILL.md 内容" /><div className="flex justify-end gap-2"><button onClick={() => onSetEditingSkillId(null)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-600">取消</button><button onClick={onSaveSkill} disabled={skillSaving || !skillForm.name.trim()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-60">{skillSaving ? '保存中...' : '保存 Skill'}</button></div></div>}
            </section>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-gray-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
          <button onClick={onClose} className="fc-pressable min-h-11 flex-1 rounded-xl bg-gray-100 px-4 py-2 text-gray-600 hover:bg-gray-200 sm:flex-none">{canEdit ? '取消' : '关闭'}</button>
          {canEdit && <button onClick={onSaveAgent} disabled={!agentForm.name.trim()} className="fc-pressable min-h-11 flex-1 rounded-xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60 sm:flex-none">{editingAgentId ? '保存修改' : '保存 Agent'}</button>}
        </div>
      </div>
    </div>
  )
}
