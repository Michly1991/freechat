import { useEffect, useState } from 'react'
import { api } from '../../../lib/api'

type TargetType = 'agent' | 'scene'

interface Props {
  targetType: TargetType
  targetId: string
  canEdit?: boolean
  feedback: any
}

export function TemplatePermissionPanel({ targetType, targetId, canEdit, feedback }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ canManage: boolean; members: any[]; requests: any[] } | null>(null)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<any[]>([])
  const [requestMessage, setRequestMessage] = useState('')

  useEffect(() => {
    if (open) void load()
  }, [open, targetId])

  const methods = targetType === 'agent' ? {
    get: api.getAgentPermissions,
    grant: api.grantAgentPermission,
    revoke: api.revokeAgentPermission,
    request: api.requestAgentPermission,
    resolve: api.resolveAgentPermissionRequest,
  } : {
    get: api.getScenePermissions,
    grant: api.grantScenePermission,
    revoke: api.revokeScenePermission,
    request: api.requestScenePermission,
    resolve: api.resolveScenePermissionRequest,
  }

  const load = async () => {
    try {
      setLoading(true)
      setData(await methods.get(targetId))
    } catch (err: any) {
      feedback.error(err?.message || '加载权限失败')
    } finally {
      setLoading(false)
    }
  }

  const search = async () => {
    if (!query.trim()) return
    const res = await api.searchUsers(query.trim())
    setUsers(res.users || [])
  }

  const grant = async (userId: string) => {
    await methods.grant(targetId, userId, 'editor')
    setUsers([])
    setQuery('')
    await load()
    feedback.success('已授予编辑权限')
  }

  const revoke = async (userId: string) => {
    await methods.revoke(targetId, userId)
    await load()
    feedback.success('已移除权限')
  }

  const requestEdit = async () => {
    await methods.request(targetId, requestMessage)
    setRequestMessage('')
    feedback.success('已提交权限申请')
  }

  const resolveRequest = async (requestId: string, decision: 'approve' | 'reject') => {
    await methods.resolve(targetId, requestId, decision)
    await load()
    feedback.success(decision === 'approve' ? '已批准申请' : '已拒绝申请')
  }

  return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="font-medium text-gray-800">编辑权限</p>
        <p className="text-xs text-gray-500 mt-0.5">全局共享模板：所有人可看可用，owner/admin/editor 可改。</p>
      </div>
      <button onClick={() => setOpen(!open)} className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600">{open ? '收起' : '权限'}</button>
    </div>
    {open && <div className="mt-3 space-y-3">
      {loading && <p className="text-xs text-gray-400">加载中...</p>}
      {data?.canManage ? <>
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">成员</p>
          {(data.members || []).map((member) => <div key={member.userId} className="flex items-center justify-between gap-2 bg-white border border-gray-100 rounded-lg px-3 py-2">
            <div><p className="text-sm text-gray-800">{member.user?.nickname || member.user?.username || member.userId}</p><p className="text-[11px] text-gray-400">{member.role}{member.builtInOwner ? ' · owner' : ''}</p></div>
            {!member.builtInOwner && member.role !== 'owner' && <button onClick={() => revoke(member.userId)} className="text-xs text-red-500">移除</button>}
          </div>)}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">授权编辑者</p>
          <div className="flex gap-2"><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="搜索用户名/昵称" className="flex-1 px-3 py-2 border rounded-lg text-xs" /><button onClick={search} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs">搜索</button></div>
          {users.map((user) => <div key={user.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2"><span className="text-xs text-gray-700">{user.nickname || user.username}</span><button onClick={() => grant(user.id)} className="text-xs text-blue-600">授予 editor</button></div>)}
        </div>
        {(data.requests || []).length > 0 && <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">权限申请</p>
          {data.requests.map((req) => <div key={req.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-gray-700">{req.nickname || req.username || req.requesterId}</span><span className="text-[11px] text-gray-400">{req.status}</span></div>
            {req.message && <p className="text-xs text-gray-500">{req.message}</p>}
            {req.status === 'pending' && <div className="flex justify-end gap-2"><button onClick={() => resolveRequest(req.id, 'reject')} className="text-xs text-gray-500">拒绝</button><button onClick={() => resolveRequest(req.id, 'approve')} className="text-xs text-blue-600">批准</button></div>}
          </div>)}
        </div>}
      </> : canEdit === false ? <div className="space-y-2">
        <p className="text-xs text-amber-600">你当前没有编辑权限，可向 owner 申请 editor 权限。</p>
        <textarea value={requestMessage} onChange={(e) => setRequestMessage(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg text-xs" placeholder="申请说明，可选" />
        <button onClick={requestEdit} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs">申请编辑权限</button>
      </div> : <p className="text-xs text-gray-400">你可以编辑，但只有 owner/admin 可以授权他人。</p>}
    </div>}
  </div>
}
