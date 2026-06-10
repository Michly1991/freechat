import { api } from '../../lib/api'
import { addClientLog } from '../../lib/clientLog'
import type { FileNode, Tab } from '../room-page-model'

export function createRoomFileActions(deps: any) {
  const { roomId, fileDirty, currentFile, setCurrentFile, setFileDirty, fileDialogType, fileDialogPath, setFileDialogType, setFileDialogPath, feedback, loadFiles } = deps
  const openFile = async (node: FileNode) => {
    if (node.type === 'directory') return
    if (fileDirty && currentFile) {
      const ok = await feedback.confirm({ title: '切换文件？', message: '当前文件有未保存内容，切换后会丢失修改。', confirmText: '继续切换' })
      if (!ok) return
    }
    try { const data = await api.getFileContent(roomId!, node.path); setCurrentFile({ path: node.path, content: data.content }); setFileDirty(false) }
    catch (err: any) { feedback.error(err?.message || '打开文件失败'); addClientLog('error', 'ui', 'open file failed', { path: node.path, message: err?.message }) }
  }
  const saveFile = async () => {
    if (!currentFile || !roomId) return
    try { await api.saveFile(roomId, currentFile.path, currentFile.content); setFileDirty(false); feedback.success('文件已保存'); loadFiles() }
    catch (err: any) { feedback.error(err?.message || '保存文件失败'); addClientLog('error', 'ui', 'save file failed', { path: currentFile.path, message: err?.message }) }
  }
  const deleteFile = async (path: string) => {
    if (!roomId) return
    const ok = await feedback.confirm({ title: '删除文件？', message: `确定删除 ${path} 吗？`, confirmText: '删除', danger: true })
    if (!ok) return
    try { await api.deleteFile(roomId, path); feedback.success('文件已删除'); loadFiles(); if (currentFile?.path === path) { setCurrentFile(null); setFileDirty(false) } }
    catch (err: any) { feedback.error(err?.message || '删除文件失败') }
  }
  const createFile = () => { setFileDialogType('file'); setFileDialogPath('') }
  const createFolder = () => { setFileDialogType('folder'); setFileDialogPath('') }
  const uploadLocalFile = async (file: File) => {
    if (!roomId) return
    try {
      const uploaded = await api.uploadFile(roomId, file)
      feedback.success(`已上传：${uploaded.path}`)
      loadFiles()
    } catch (err: any) {
      feedback.error(err?.message || '上传失败')
      addClientLog('error', 'ui', 'upload file failed', { name: file.name, message: err?.message })
    }
  }
  const submitFileDialog = async () => {
    if (!roomId || !fileDialogType) return
    const name = fileDialogPath.trim().replace(/^\/+/, '')
    if (!name) { feedback.warning('路径不能为空'); return }
    if (name.includes('..')) { feedback.error('路径不能包含 ..'); return }
    try { if (fileDialogType === 'file') await api.saveFile(roomId, name, ''); else await api.mkdir(roomId, name); feedback.success(fileDialogType === 'file' ? '文件已创建' : '目录已创建'); setFileDialogType(null); setFileDialogPath(''); loadFiles() }
    catch (err: any) { feedback.error(err?.message || '创建失败') }
  }
  return { openFile, saveFile, deleteFile, createFile, createFolder, uploadLocalFile, submitFileDialog }
}

export function createRoomTabActions(deps: any) {
  const { roomId, newTabName, newTabContent, setNewTabName, setNewTabContent, setShowCreateTab, setTabError, feedback, loadTabs, activeTabId, setActiveTabId, editingTabTitle, editingTabContent, setEditingTabId, setEditingTabTitle, setEditingTabContent } = deps
  const createTab = async () => { if (!newTabName.trim() || !roomId) return; try { setTabError(''); await api.createTab(roomId, { title: newTabName, content: newTabContent || '<h1>Hello</h1>' }); setNewTabName(''); setNewTabContent(''); setShowCreateTab(false); feedback.success('标签页已创建'); loadTabs() } catch (err: any) { const msg = err?.message || '创建标签失败'; setTabError(msg); feedback.error(msg) } }
  const deleteTab = async (tabId: string) => { if (!roomId) return; const ok = await feedback.confirm({ title: '删除标签页？', message: '确定删除这个标签页吗？', confirmText: '删除', danger: true }); if (!ok) return; try { setTabError(''); await api.deleteTab(roomId, tabId); feedback.success('标签页已删除'); loadTabs(); if (activeTabId === tabId) setActiveTabId(null) } catch (err: any) { const msg = err?.message || '删除标签失败'; setTabError(msg); feedback.error(msg) } }
  const updateTab = async (tabId: string) => { if (!roomId) return; try { setTabError(''); await api.updateTab(roomId, tabId, { title: editingTabTitle, content: editingTabContent }); feedback.success('标签页已保存'); loadTabs(); setEditingTabId(null) } catch (err: any) { const msg = err?.message || '保存标签失败'; setTabError(msg); feedback.error(msg) } }
  const beginEditTab = (tab: Tab) => { setEditingTabId(tab.id); setEditingTabTitle(tab.title || tab.name || '未命名'); setEditingTabContent(tab.content || ''); setTabError('') }
  return { createTab, deleteTab, updateTab, beginEditTab }
}

export function createRoomTaskActions(deps: any) {
  const { newTaskTitle, setNewTaskTitle, setCreatingTask, newSubtaskTitles, setNewSubtaskTitles, feedback, sendWs, setExpandedTaskIds } = deps
  const createTask = async () => { const title = newTaskTitle.trim(); if (!title) { feedback.warning('请输入任务标题'); return } setCreatingTask(true); try { if (!sendWs('task.create', { title, status: 'todo' })) { feedback.error('实时连接不可用，任务创建失败'); return } setNewTaskTitle(''); feedback.success('任务已创建') } finally { setCreatingTask(false) } }
  const updateTaskStatus = (task: any, status: string) => { if (!sendWs('task.update', { id: task.id, status })) feedback.error('实时连接不可用，任务更新失败') }
  const retryTaskFailedItems = async (task: any) => { const ok = await feedback.confirm({ title: '重试失败项？', message: `重新打开「${task.title}」里的失败/阻塞子任务，并唤醒对应 Agent。`, confirmText: '重试' }); if (!ok) return; if (!sendWs('task.retry', { id: task.id, reason: '用户手动重试失败项' })) feedback.error('实时连接不可用，重试失败') }
  const deleteTask = async (task: any) => { const ok = await feedback.confirm({ title: '删除任务？', message: `确定删除「${task.title}」吗？`, confirmText: '删除', danger: true }); if (!ok) return; if (!sendWs('task.delete', { id: task.id })) { feedback.error('实时连接不可用，删除任务失败'); return } feedback.success('任务已删除') }
  const toggleTaskExpanded = (taskId: string) => setExpandedTaskIds((prev: string[]) => prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId])
  const createSubtask = (task: any) => { const title = (newSubtaskTitles[task.id] || '').trim(); if (!title) { feedback.warning('请输入子任务标题'); return } if (!sendWs('task.subtask.add', { taskId: task.id, title })) { feedback.error('实时连接不可用，子任务创建失败'); return } setNewSubtaskTitles((prev: any) => ({ ...prev, [task.id]: '' })); feedback.success('子任务已创建') }
  const updateSubtaskStatus = (subtask: any, status: string) => { if (!sendWs('task.subtask.update', { id: subtask.id, status })) feedback.error('实时连接不可用，子任务更新失败') }
  const retrySubtask = async (subtask: any) => { const ok = await feedback.confirm({ title: '重试子任务？', message: `重新打开「${subtask.title}」，并在有处理人时重新唤醒。`, confirmText: '重试' }); if (!ok) return; if (!sendWs('task.subtask.retry', { id: subtask.id, reason: '用户手动重试' })) feedback.error('实时连接不可用，重试失败') }
  const deleteSubtask = async (subtask: any) => { const ok = await feedback.confirm({ title: '删除子任务？', message: `确定删除「${subtask.title}」吗？`, confirmText: '删除', danger: true }); if (!ok) return; if (!sendWs('task.subtask.delete', { id: subtask.id })) feedback.error('实时连接不可用，子任务删除失败') }
  return { createTask, updateTaskStatus, retryTaskFailedItems, deleteTask, toggleTaskExpanded, createSubtask, updateSubtaskStatus, retrySubtask, deleteSubtask }
}
