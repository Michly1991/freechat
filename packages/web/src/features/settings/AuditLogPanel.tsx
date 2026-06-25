import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useFeedback } from '../../components/FeedbackProvider'
import { Shield, Clock, User, ChevronDown, ChevronUp, Search, Filter, Download } from 'lucide-react'

const actionLabels: Record<string, string> = {
  'user.login': '登录',
  'user.register': '注册',
  'user.logout': '登出',
  'agent.create': '创建 Agent',
  'agent.update': '更新 Agent',
  'agent.delete': '删除 Agent',
  'agent.publish': '上架 Agent',
  'agent.unpublish': '下架 Agent',
  'room.create': '创建房间',
  'room.delete': '删除房间',
  'room.invite': '邀请成员',
  'room.member_add': '加入房间',
  'room.member_remove': '移除成员',
  'billing.topup': '充值',
  'billing.charge': '扣费',
  'billing.refund': '退款',
  'file.upload': '上传文件',
  'file.delete': '删除文件',
  'scene.create': '创建场景',
  'scene.update': '更新场景',
  'scene.delete': '删除场景',
  'scene.purchase': '购买场景',
  'model.add': '添加模型',
  'model.update': '更新模型',
  'model.delete': '删除模型',
  'workgroup.create': '创建工作组',
  'workgroup.update': '更新工作组',
  'workgroup.member_add': '加入工作组',
  'workgroup.member_remove': '移除工作组成员',
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  return `${Math.floor(diff / day)} 天前`
}

export function AuditLogPanel() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<any>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterAction, setFilterAction] = useState('')
  const [filterUserId, setFilterUserId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const feedback = useFeedback()

  const loadLogs = async () => {
    try {
      const res: any = await api.getAuditLogs({
        action: filterAction || undefined,
        userId: filterUserId || undefined,
        limit: 50,
        offset,
      })
      setLogs(res?.logs || [])
      setTotal(res?.total || 0)
      setIsAdmin(true)
    } catch (err: any) {
      if (err.message?.includes('仅管理员') || err.message?.includes('FORBIDDEN')) {
        setIsAdmin(false)
      }
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const res: any = await api.getAuditStats()
      setStats(res)
    } catch {}
  }

  useEffect(() => {
    loadLogs()
    loadStats()
  }, [filterAction, filterUserId, offset])

  const exportCsv = () => {
    const headers = ['时间', '操作', '用户', '目标类型', '目标ID', '目标名称', 'IP']
    const rows = logs.map((log) => [
      formatDate(log.createdAt),
      actionLabels[log.action] || log.action,
      log.username || log.userId,
      log.targetType || '-',
      log.targetId || '-',
      log.targetName || '-',
      log.ip || '-',
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().slice(0, 10)
    a.download = `freechat-audit-log-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
    feedback.success('审计日志已导出')
  }

  const allActions = Array.from(new Set([...Object.keys(actionLabels), ...logs.map((l) => l.action)])).sort()

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <Shield className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <h3 className="font-semibold text-gray-800 mb-2">审计日志</h3>
        <p className="text-sm text-gray-500">仅管理员可查看审计日志</p>
      </div>
    )
  }

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      log.username?.toLowerCase().includes(q) ||
      log.userId?.toLowerCase().includes(q) ||
      log.targetName?.toLowerCase().includes(q) ||
      log.action?.toLowerCase().includes(q) ||
      log.ip?.toLowerCase().includes(q)
    )
  })

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">审计日志</h2>
              <p className="text-xs text-gray-500">记录所有关键操作，支持筛选和导出</p>
            </div>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs">
              <div className="px-3 py-1.5 bg-gray-50 rounded-lg">
                <span className="text-gray-500">总记录：</span>
                <span className="font-medium text-gray-800 ml-1">{stats.total}</span>
              </div>
              <div className="px-3 py-1.5 bg-blue-50 rounded-lg">
                <span className="text-gray-500">24h 内：</span>
                <span className="font-medium text-blue-600 ml-1">{stats.last24h}</span>
              </div>
              <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition">
                <Download className="w-3.5 h-3.5" />
                导出 CSV
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索用户、操作、IP..."
              className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setOffset(0) }}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none appearance-none bg-white"
            >
              <option value="">所有操作</option>
              {allActions.map((action) => (
                <option key={action} value={action}>
                  {actionLabels[action] || action}
                </option>
              ))}
            </select>
          </div>
          <input
            value={filterUserId}
            onChange={(e) => { setFilterUserId(e.target.value); setOffset(0) }}
            placeholder="筛选用户 ID..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">加载中...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="p-8 text-center">
          <Shield className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm text-gray-500">暂无审计日志记录</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {filteredLogs.map((log) => (
            <div key={log.id} className="group">
              <div
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-gray-50 cursor-pointer transition"
              >
                <div className="text-gray-400">
                  {expandedId === log.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
                <div className="w-24 flex-none text-xs">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${log.action.includes('delete') || log.action.includes('remove') ? 'bg-red-50 text-red-600' : log.action.includes('login') || log.action.includes('create') ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
                    {actionLabels[log.action] || log.action}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-sm text-gray-700">
                      <User className="w-3.5 h-3.5 text-gray-400" />
                      <span className="truncate max-w-[120px]">{log.username || log.userId?.slice(0, 8)}</span>
                    </div>
                    {log.targetName && (
                      <span className="text-sm text-gray-500 truncate">
                        · {log.targetType || ''} <span className="font-medium text-gray-700">{log.targetName}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatRelativeTime(log.createdAt)}
                  </div>
                  <div className="text-[10px] text-gray-300 hidden group-hover:block">
                    {log.ip || '-'}
                  </div>
                </div>
              </div>

              {expandedId === log.id && log.metadata && (
                <div className="px-4 sm:px-5 pb-3 pl-12 sm:pl-14">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-2">详细信息</p>
                    <pre className="text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap font-mono">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {total > 50 && (
        <div className="p-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">显示 {offset + 1}-{Math.min(offset + 50, total)} / 共 {total} 条</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - 50))}
              disabled={offset === 0}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              onClick={() => setOffset(offset + 50)}
              disabled={offset + 50 >= total}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
