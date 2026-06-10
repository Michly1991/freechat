import { ListTodo } from 'lucide-react'

const statusColors: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-700',
  assigned: 'bg-blue-100 text-blue-700',
  doing: 'bg-yellow-100 text-yellow-700',
  review: 'bg-purple-100 text-purple-700',
  blocked: 'bg-red-100 text-red-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-400',
}

const kanbanCols = [
  { key: 'todo', label: '待办', statuses: ['todo', 'assigned'] },
  { key: 'doing', label: '进行中', statuses: ['doing', 'blocked'] },
  { key: 'review', label: '待审核', statuses: ['review'] },
]

export const archivedTaskStatuses = ['done', 'failed', 'cancelled']

export function getEffectiveTaskStatus(task: any) {
  const summary = task.subtaskSummary || {}
  const hasChildProgress = (summary.doing || 0) > 0 || (summary.review || 0) > 0 || (summary.blocked || 0) > 0 || (summary.done || 0) > 0
  if ((task.status === 'todo' || task.status === 'assigned') && hasChildProgress) return 'doing'
  return task.status
}

function getNextTaskStatus(task: any, colKey?: string) {
  const status = getEffectiveTaskStatus(task)
  if (status === 'todo' || status === 'assigned') return 'doing'
  if (status === 'doing' || status === 'blocked') return 'review'
  if (status === 'review') return 'done'
  if (colKey === 'todo') return 'doing'
  if (colKey === 'doing') return 'review'
  if (colKey === 'review') return 'done'
  return null
}

function getTaskAdvanceLabel(task: any) {
  const status = getEffectiveTaskStatus(task)
  if (status === 'todo' || status === 'assigned') return '开始处理'
  if (status === 'doing' || status === 'blocked') return '提交审核'
  if (status === 'review') return '标记完成'
  return ''
}

interface RoomTasksPanelProps {
  tasks: any[]
  sendError: string
  wsNoticeDismissed: boolean
  setWsNoticeDismissed: (value: boolean) => void
  newTaskTitle: string
  setNewTaskTitle: (value: string) => void
  creatingTask: boolean
  createTask: () => void
  expandedTaskIds: string[]
  toggleTaskExpanded: (taskId: string) => void
  newSubtaskTitles: Record<string, string>
  setNewSubtaskTitles: React.Dispatch<React.SetStateAction<Record<string, string>>>
  showArchivedTasks: boolean
  setShowArchivedTasks: React.Dispatch<React.SetStateAction<boolean>>
  updateTaskStatus: (task: any, status: string) => void
  retryTaskFailedItems: (task: any) => void
  deleteTask: (task: any) => void
  createSubtask: (task: any) => void
  updateSubtaskStatus: (subtask: any, status: string) => void
  retrySubtask: (subtask: any) => void
  deleteSubtask: (subtask: any) => void
  renderAssigneeBadge: (item: any, compact?: boolean) => React.ReactNode
}

export function RoomTasksPanel(props: RoomTasksPanelProps) {
  const {
    tasks, sendError, wsNoticeDismissed, setWsNoticeDismissed, newTaskTitle, setNewTaskTitle, creatingTask,
    createTask, expandedTaskIds, toggleTaskExpanded, newSubtaskTitles, setNewSubtaskTitles, showArchivedTasks,
    setShowArchivedTasks, updateTaskStatus, retryTaskFailedItems, deleteTask, createSubtask, updateSubtaskStatus, retrySubtask, deleteSubtask, renderAssigneeBadge,
  } = props

  const renderTaskCard = (task: any, colKey?: string) => {
    const nextStatus = getNextTaskStatus(task, colKey)
    const label = getTaskAdvanceLabel(task)
    const subtasks = task.subtasks || []
    const summary = task.subtaskSummary || { total: 0, done: 0, doing: 0, review: 0, blocked: 0, progress: 0 }
    const expanded = expandedTaskIds.includes(task.id)
    const hasRetryable = subtasks.some((item: any) => ['failed', 'cancelled', 'blocked'].includes(item.status))
    const summaryParts = [
      summary.todo ? `待办${summary.todo}` : '',
      summary.assigned ? `已分配${summary.assigned}` : '',
      summary.doing ? `进行中${summary.doing}` : '',
      summary.review ? `待审${summary.review}` : '',
      summary.blocked ? `阻塞${summary.blocked}` : '',
      summary.failed ? `失败${summary.failed}` : '',
    ].filter(Boolean)
    return (
      <div key={task.id} className={`fc-enter fc-card-hover bg-white rounded-xl p-3 sm:p-3 shadow-sm border ${getEffectiveTaskStatus(task) === 'review' ? 'border-purple-200 fc-review-glow' : 'border-gray-100'}`}>
        <p className="text-sm font-medium text-gray-800 leading-5 break-words">{task.title}</p>
        {task.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[getEffectiveTaskStatus(task)] || 'bg-gray-100'}`}>{getEffectiveTaskStatus(task)}</span>
          {renderAssigneeBadge(task)}
        </div>
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${task.progressNote ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-400'}`}>
          <span className="font-medium">最近进展：</span>{task.progressNote || '暂无进展'}
        </div>
        {summary.total > 0 && <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/70 p-2"><div className="flex items-center justify-between text-xs text-gray-500"><span className="font-medium text-gray-600">子任务 {summary.done}/{summary.total}</span><span>{summary.progress}%</span></div><div className="mt-1 h-1.5 rounded-full bg-white overflow-hidden"><div className={`h-full rounded-full fc-progress-bar ${summary.progress > 0 ? 'fc-progress-shine' : ''} ${summary.blocked ? 'bg-red-400' : 'bg-blue-500'}`} style={{ width: `${summary.progress}%` }} /></div>{summaryParts.length > 0 && <p className="mt-1 text-[11px] text-gray-400 truncate">{summaryParts.join(' · ')}</p>}<div className="mt-2 space-y-1.5">{subtasks.map((subtask: any, index: number) => <div key={subtask.id} className="fc-enter rounded-lg bg-white p-2 border border-gray-100"><div className="flex items-start gap-2"><button onClick={() => updateSubtaskStatus(subtask, subtask.status === 'done' ? 'todo' : 'done')} className={`fc-pressable mt-0.5 w-5 h-5 rounded border text-xs flex items-center justify-center shrink-0 ${subtask.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 text-transparent'}`}>✓</button><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className={`text-xs font-medium break-words ${subtask.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>{index + 1}. {subtask.title}</p><button onClick={() => deleteSubtask(subtask)} className="shrink-0 text-xs text-red-400 px-1">×</button></div><div className="mt-1 flex flex-wrap items-center gap-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[subtask.status] || 'bg-gray-100'}`}>{subtask.status}</span>{renderAssigneeBadge(subtask, true)}{subtask.dependencies?.length > 0 && <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">依赖 {subtask.dependencies.length} 项</span>}{subtask.retryCount > 0 && <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">重试 {subtask.retryCount}</span>}{subtask.blockedReason && <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{subtask.blockedReason}</span>}<button onClick={() => retrySubtask(subtask)} className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hover:bg-blue-100">重试</button></div></div></div></div>)}</div></div>}
        <div className="mt-3 flex gap-2">
          {nextStatus && label && <button onClick={() => updateTaskStatus(task, nextStatus)} className="fc-pressable flex-1 sm:flex-none rounded-lg bg-blue-50 px-3 py-2 text-sm sm:text-xs font-medium text-blue-600 hover:bg-blue-100 active:bg-blue-200">{label}</button>}
          {hasRetryable && <button onClick={() => retryTaskFailedItems(task)} className="fc-pressable rounded-lg bg-amber-50 px-3 py-2 text-sm sm:text-xs font-medium text-amber-600 hover:bg-amber-100">重试失败项</button>}
          <button onClick={() => toggleTaskExpanded(task.id)} className="fc-pressable rounded-lg bg-gray-50 px-3 py-2 text-sm sm:text-xs font-medium text-gray-500 hover:bg-gray-100">{expanded ? '收起新增' : '新增子任务'}</button>
          <button onClick={() => deleteTask(task)} className="fc-pressable rounded-lg bg-red-50 px-3 py-2 text-sm sm:text-xs font-medium text-red-500 hover:bg-red-100 active:bg-red-200">删除</button>
        </div>
        {expanded && <div className="mt-3 border-t border-gray-100 pt-3"><div className="flex gap-2 pt-1"><input value={newSubtaskTitles[task.id] || ''} onChange={(e) => setNewSubtaskTitles((prev) => ({ ...prev, [task.id]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && createSubtask(task)} placeholder="新增子任务..." className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" /><button onClick={() => createSubtask(task)} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-600">添加</button></div></div>}
      </div>
    )
  }

  const activeTasks = tasks.filter((t) => !archivedTaskStatuses.includes(t.status))
  const archivedTasks = tasks.filter((t) => archivedTaskStatuses.includes(t.status))

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-3 sm:p-4 bg-white border-b border-gray-200 shrink-0">
        {sendError && !wsNoticeDismissed && <div className="mb-2 flex items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700"><span>{sendError.replace('正在重连...', '实时同步暂不可用，但消息可正常发送')}</span><button type="button" onClick={() => setWsNoticeDismissed(true)} className="text-amber-500 hover:text-amber-700">×</button></div>}
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} placeholder="输入新任务标题..." className="flex-1 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" onKeyDown={(e) => e.key === 'Enter' && createTask()} disabled={creatingTask} />
          <button onClick={createTask} disabled={creatingTask} className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60">{creatingTask ? '创建中...' : '创建任务'}</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-gradient-to-b from-gray-50/80 to-white md:bg-none">
        {tasks.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-gray-400"><div><ListTodo className="w-10 h-10 mx-auto mb-2 text-gray-300" /><p className="text-sm">暂无任务，先创建一个吧</p></div></div>
        ) : (
          <div className="space-y-4">
            {activeTasks.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">暂无进行中的任务</div> : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                {kanbanCols.map((col) => {
                  const colTasks = activeTasks.filter((t) => col.statuses.includes(getEffectiveTaskStatus(t)))
                  return <section key={col.key} className="fc-mobile-card bg-white md:bg-gray-100 rounded-2xl md:rounded-lg border md:border-0 border-gray-100 p-3 shadow-sm md:shadow-none"><h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between"><span>{col.label}</span><span className="text-xs font-normal text-gray-400 bg-gray-100 md:bg-white px-2 py-0.5 rounded-full">{colTasks.length}</span></h3><div className="space-y-2">{colTasks.length === 0 ? <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 py-6 text-center text-xs text-gray-400">暂无任务</div> : colTasks.map((task) => renderTaskCard(task, col.key))}</div></section>
                })}
              </div>
            )}
            {archivedTasks.length > 0 && <section className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm"><button type="button" onClick={() => setShowArchivedTasks((value) => !value)} className="w-full flex items-center justify-between text-left text-sm font-semibold text-gray-600"><span>已归档</span><span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{archivedTasks.length} · {showArchivedTasks ? '收起' : '展开'}</span></button>{showArchivedTasks && <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">{archivedTasks.map((task) => renderTaskCard(task, 'done'))}</div>}</section>}
          </div>
        )}
      </div>
    </div>
  )
}
