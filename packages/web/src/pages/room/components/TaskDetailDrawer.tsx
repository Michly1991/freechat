import { MessageSquare, X, Paperclip, Clock, User, CheckCircle2, AlertCircle } from 'lucide-react'

export interface TaskDetail {
  id: string
  title: string
  description?: string
  status: string
  assigneeId?: string
  assigneeName?: string
  creatorId?: string
  creatorName?: string
  progress?: number
  progressNote?: string
  createdAt?: number
  updatedAt?: number
  attachments?: Array<{ id: string; name: string; url: string; size: number }>
  comments?: Array<{ id: string; userId: string; userName: string; content: string; createdAt: number }>
}

interface TaskDetailDrawerProps {
  open: boolean
  onClose: () => void
  task: TaskDetail | null
}

const statusColors: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-600',
  doing: 'bg-blue-50 text-blue-600',
  review: 'bg-purple-50 text-purple-600',
  done: 'bg-green-50 text-green-600',
  blocked: 'bg-red-50 text-red-600',
}

const statusLabels: Record<string, string> = {
  todo: '待办',
  doing: '进行中',
  review: '待审核',
  done: '已完成',
  blocked: '阻塞',
}

export function TaskDetailDrawer({ open, onClose, task }: TaskDetailDrawerProps) {
  if (!open || !task) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">任务详情</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{task.title}</h3>
              {task.description && <p className="mt-2 text-sm text-gray-600">{task.description}</p>}
            </div>

            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[task.status] || 'bg-gray-100 text-gray-600'}`}>
                {statusLabels[task.status] || task.status}
              </span>
              {task.progress !== undefined && (
                <span className="text-xs text-gray-500">进度 {task.progress}%</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <User className="w-4 h-4 text-gray-400" />
                <span>创建人：{task.creatorName || '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <User className="w-4 h-4 text-gray-400" />
                <span>负责人：{task.assigneeName || '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-4 h-4 text-gray-400" />
                <span>创建：{task.createdAt ? new Date(task.createdAt).toLocaleDateString() : '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-4 h-4 text-gray-400" />
                <span>更新：{task.updatedAt ? new Date(task.updatedAt).toLocaleDateString() : '-'}</span>
              </div>
            </div>

            {task.progressNote && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-blue-700">最近进展</p>
                    <p className="text-sm text-blue-800 mt-1">{task.progressNote}</p>
                  </div>
                </div>
              </div>
            )}

            {task.attachments && task.attachments.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                  <Paperclip className="w-4 h-4" />附件 ({task.attachments.length})
                </h4>
                <div className="space-y-2">
                  {task.attachments.map((att) => (
                    <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 transition">
                      <Paperclip className="w-4 h-4 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-700 truncate">{att.name}</p>
                        <p className="text-xs text-gray-400">{(att.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-gray-200 pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4" />评论 ({task.comments?.length || 0})
              </h4>
              {!task.comments || task.comments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">暂无评论</p>
              ) : (
                <div className="space-y-3">
                  {task.comments.map((comment) => (
                    <div key={comment.id} className="rounded-xl bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-xs font-medium text-gray-700">{comment.userName}</span>
                        <span className="text-xs text-gray-400">
                          {comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{comment.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
