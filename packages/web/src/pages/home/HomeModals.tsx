import type { CreateRoomModalProps, JoinRoomModalProps } from './types'

export function JoinRoomModal({ show, inviteCode, joining, setInviteCode, setShowJoin, handleJoinRoom }: JoinRoomModalProps) {
  if (!show) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">加入项目</h3>
        <form onSubmit={handleJoinRoom} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邀请码</label>
            <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="输入别人发给你的邀请码" autoFocus required />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowJoin(false); setInviteCode('') }} className="px-4 py-2 text-gray-600 hover:text-gray-800">取消</button>
            <button type="submit" disabled={joining} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">{joining ? '加入中...' : '加入'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function CreateRoomModal(props: CreateRoomModalProps) {
  const {
    show,
    newName,
    newDesc,
    friends,
    agents,
    selectedFriendIds,
    selectedAgents,
    setNewName,
    setNewDesc,
    setShowCreate,
    setSelectedAgents,
    handleCreate,
    toggleSelectedFriend,
    toggleSelectedAgent,
    setAgentAutoEnabled,
  } = props
  if (!show) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">新建项目</h3>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目名称</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="输入项目名称" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">描述（可选）</label>
            <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="项目描述" rows={3} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">选择协作者（可选）</label>
            <CollaboratorPicker
              friends={friends}
              agents={agents}
              selectedFriendIds={selectedFriendIds}
              selectedAgents={selectedAgents}
              toggleSelectedFriend={toggleSelectedFriend}
              toggleSelectedAgent={toggleSelectedAgent}
              setAgentAutoEnabled={setAgentAutoEnabled}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowCreate(false); setSelectedAgents([]) }} className="px-4 py-2 text-gray-600 hover:text-gray-800">取消</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">创建</button>
          </div>
        </form>
      </div>
    </div>
  )
}

type CollaboratorPickerProps = Pick<CreateRoomModalProps,
  'friends' | 'agents' | 'selectedFriendIds' | 'selectedAgents' | 'toggleSelectedFriend' | 'toggleSelectedAgent' | 'setAgentAutoEnabled'
>

function CollaboratorPicker({ friends, agents, selectedFriendIds, selectedAgents, toggleSelectedFriend, toggleSelectedAgent, setAgentAutoEnabled }: CollaboratorPickerProps) {
  return (
    <>
      {friends.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">人员</p>
          <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
            {friends.map((f) => (
              <label key={f.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedFriendIds.includes(f.id)} onChange={() => toggleSelectedFriend(f.id)} />
                {f.avatar ? <img src={f.avatar} className="w-6 h-6 rounded-full object-cover" /> : <span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">{(f.nickname || f.username || '?')[0].toUpperCase()}</span>}
                <span>{f.nickname || f.username}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {agents.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1">Agent</p>
          <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
            {agents.map((a) => {
              const selected = selectedAgents.find((item) => item.agentId === a.id)
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-gray-50 text-sm">
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
                    <input type="checkbox" checked={!!selected} onChange={() => toggleSelectedAgent(a.id)} />
                    <span className="truncate">{a.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 shrink-0">{a.roleType === 'assistant' ? '助理' : '专家'}</span>
                  </label>
                  {selected && <select value={selected.autoEnabled ? 'auto' : 'specialist'} onChange={(e) => setAgentAutoEnabled(a.id, e.target.value === 'auto')} className="text-xs border border-gray-200 rounded px-2 py-1"><option value="specialist">专家</option><option value="auto">自动助理</option></select>}
                </div>
              )
            })}
          </div>
          {selectedAgents.filter((a) => a.autoEnabled).length > 1 && <p className="text-xs text-orange-500 mt-1">只会启用第一个自动助理，其他会自动作为专家加入。</p>}
        </div>
      )}
      {friends.length === 0 && agents.length === 0 && <p className="text-sm text-gray-400">通讯录暂无可选协作者。</p>}
    </>
  )
}
