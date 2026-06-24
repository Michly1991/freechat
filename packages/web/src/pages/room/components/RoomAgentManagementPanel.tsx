import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import { AgentConfigEditor } from './AgentConfigEditor'
import { TemplatePermissionPanel } from './TemplatePermissionPanel'

interface Props {
  roomAgents: any[]
  feedback: any
}

export function RoomAgentManagementPanel({ roomAgents, feedback }: Props) {
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [scenes, setScenes] = useState<any[]>([])
  const [agentTemplates, setAgentTemplates] = useState<any[]>([])
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null)
  const [sceneForm, setSceneForm] = useState<{ name: string; description: string; agents: any[] }>({ name: '', description: '', agents: [] })
  const [selectedGlobalAgentId, setSelectedGlobalAgentId] = useState('')

  const selected = roomAgents.find((agent) => agent.id === selectedAgentId) || roomAgents[0]

  useEffect(() => {
    if (roomAgents.length > 0 && !selectedAgentId) setSelectedAgentId(roomAgents[0].id)
  }, [roomAgents.length, selectedAgentId])

  useEffect(() => { loadScenesAndTemplates() }, [])

  const loadScenesAndTemplates = async () => {
    try {
      const [sceneData, agentData] = await Promise.all([api.getScenes(), api.getAgents()])
      setScenes(sceneData.scenes || [])
      setAgentTemplates(agentData.agents || [])
    } catch (err) { console.error(err) }
  }

  const startNewScene = () => {
    setEditingSceneId('new')
    setSceneForm({ name: '新场景', description: '', agents: [] })
    setSelectedGlobalAgentId('')
  }

  const startEditScene = (scene: any) => {
    if (scene.canEdit === false) return
    setEditingSceneId(scene.id)
    setSceneForm({
      name: scene.name || '',
      description: scene.description || '',
      agents: (scene.agents || []).map((item: any) => ({ ...item })),
    })
    setSelectedGlobalAgentId(scene.agents?.[0]?.agentId || '')
  }

  const saveScene = async () => {
    if (!editingSceneId || !sceneForm.name.trim()) return
    const current = scenes.find((scene) => scene.id === editingSceneId)
    if (current?.canEdit === false) return
    if (editingSceneId === 'new' && sceneForm.name.replace(/\s+/g, '') === 'Agent管理') {
      feedback.error('Agent 管理是系统内置项目，不能重复创建')
      return
    }
    const payload = { name: sceneForm.name.trim(), description: sceneForm.description, agents: sceneForm.agents }
    if (editingSceneId === 'new') await api.createScene(payload)
    else await api.updateScene(editingSceneId, payload)
    setEditingSceneId(null)
    setSelectedGlobalAgentId('')
    await loadScenesAndTemplates()
  }

  const addSceneAgent = () => {
    const first = agentTemplates.find((item) => !sceneForm.agents.some((a) => a.agentId === item.id))
    setSceneForm({ ...sceneForm, agents: [...sceneForm.agents, { agentId: first?.id || '', name: first?.name || '', autoEnabled: false, priority: sceneForm.agents.length }] })
    if (first?.id) setSelectedGlobalAgentId(first.id)
  }

  const setSceneAgent = (index: number, agentId: string) => {
    const selected = agentTemplates.find((a) => a.id === agentId)
    setSceneForm({ ...sceneForm, agents: sceneForm.agents.map((x, i) => i === index ? { ...x, agentId, name: selected?.name || x.name, autoEnabled: x.autoEnabled } : x) })
    setSelectedGlobalAgentId(agentId)
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div><p className="text-xs text-gray-500">项目内 Agent 能力管理</p><h2 className="text-xl font-semibold text-gray-900">Agent 管理</h2><p className="text-sm text-gray-500 mt-1">这里编辑的是项目内克隆的 Agent 副本，不影响外部模板。</p></div>
            <select value={selected?.id || ''} onChange={(e) => setSelectedAgentId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm">{roomAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </div>
        </div>

        {!selected && <div className="text-center text-gray-400 py-12">当前项目还没有 Agent。</div>}
        {selected && <AgentConfigEditor agentId={selected.id} feedback={feedback} scopeLabel="项目内 Agent 副本配置：只影响当前项目。" />}

        <section className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-3"><div><h3 className="font-semibold text-gray-900">场景管理</h3><p className="text-xs text-gray-400 mt-1">场景只维护全局 Agent 配置及默认加入关系；不再配置项目页面。</p></div><button onClick={startNewScene} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 shrink-0">新增场景</button></div>
          <div className="space-y-3">{(editingSceneId === 'new' ? [{ id: 'new', name: '新场景', description: '', agents: [] }, ...scenes] : scenes).map((scene) => {
            const editing = editingSceneId === scene.id
            return <div key={scene.id} className="border border-gray-100 rounded-xl p-3">
              {editing ? <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-2"><input value={sceneForm.name} disabled={scene.isBuiltIn} onChange={(e) => setSceneForm({ ...sceneForm, name: e.target.value })} className="px-3 py-2 border rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-400" placeholder="场景名称" /><input value={sceneForm.description} disabled={scene.isBuiltIn} onChange={(e) => setSceneForm({ ...sceneForm, description: e.target.value })} className="px-3 py-2 border rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-400" placeholder="场景描述" /></div>
                {scene.isBuiltIn && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">Agent 管理是系统内置项目，不能删除，也不能作为普通场景重复创建；这里仅维护它关联的全局 Agent 配置。</p>}
                <TemplatePermissionPanel targetType="scene" targetId={scene.id} canEdit={scene.canEdit !== false} feedback={feedback} />
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-2"><div className="flex justify-between"><div><p className="text-sm font-medium text-gray-700">全局 Agent</p><p className="text-xs text-gray-400">这里编辑的是全局 Agent 模板，新项目会从它克隆；已创建项目副本不会自动变化。</p></div><button onClick={addSceneAgent} className="text-xs text-blue-600">+ 添加</button></div>{sceneForm.agents.map((item, index) => <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_110px_90px] gap-2 bg-white border border-gray-100 rounded-lg p-2"><select value={item.agentId || ''} onChange={(e) => setSceneAgent(index, e.target.value)} className="px-2 py-2 border rounded text-xs"><option value="">选择全局 Agent</option>{agentTemplates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!item.autoEnabled} onChange={(e) => setSceneForm({ ...sceneForm, agents: sceneForm.agents.map((x, i) => i === index ? { ...x, autoEnabled: e.target.checked } : { ...x, autoEnabled: e.target.checked ? false : x.autoEnabled }) })} />协调者</label><div className="flex justify-end gap-2"><button onClick={() => setSelectedGlobalAgentId(item.agentId)} className="text-xs text-blue-600">配置</button><button onClick={() => setSceneForm({ ...sceneForm, agents: sceneForm.agents.filter((_, i) => i !== index) })} className="text-xs text-red-500">删除</button></div></div>)}</div>
                {selectedGlobalAgentId && <div className="rounded-xl border border-blue-100 bg-blue-50/20 p-3"><AgentConfigEditor agentId={selectedGlobalAgentId} feedback={feedback} scopeLabel="全局 Agent 模板配置：通讯录和场景共用，影响后续克隆到新项目的 Agent。" onSaved={loadScenesAndTemplates} /></div>}
                <div className="flex justify-end gap-2"><button onClick={() => { setEditingSceneId(null); setSelectedGlobalAgentId('') }} className="px-3 py-1.5 bg-gray-100 rounded text-sm">取消</button><button onClick={saveScene} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">保存场景</button></div>
              </div> : <div><div className="flex items-center justify-between"><div><p className="font-medium text-gray-800">{scene.name}{scene.isBuiltIn && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">内置</span>}{scene.canEdit === false && <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">只读</span>}</p><p className="text-xs text-gray-500 mt-1">{scene.description || '暂无描述'}</p></div>{scene.canEdit !== false && <button onClick={() => startEditScene(scene)} className="text-sm text-blue-600">编辑</button>}</div><div className="mt-3 flex flex-wrap gap-1">{(scene.agents || []).map((a: any) => <span key={a.agentId} className="text-[11px] px-2 py-1 rounded-full bg-violet-50 text-violet-600">{a.name}{a.autoEnabled ? ' · 自动' : ''}</span>)}</div></div>}
            </div>
          })}</div>
        </section>
      </div>
    </div>
  )
}
