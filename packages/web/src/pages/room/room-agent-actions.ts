import { api } from '../../lib/api'

export function createRoomAgentActions({ roomId, errorAgents, workingAgents, feedback, refreshAgents }: any) {
  const restartAgent = async (agent: any, mode: 'soft' | 'force' = 'soft') => {
    if (!roomId) return
    const force = mode === 'force'
    const ok = await feedback.confirm({
      title: force ? '强制重启 Agent？' : '重启 Agent？',
      message: force
        ? `将强制中断「${agent.name}」当前运行，清理会话并恢复为在线状态。当前输出可能丢失。`
        : `将软重启「${agent.name}」，清理会话并恢复为在线状态。`,
      confirmText: force ? '强制重启' : '重启'
    })
    if (!ok) return
    try {
      await api.restartRoomAgent(roomId, agent.id, true, mode)
      feedback.success(force ? 'Agent 已强制重启' : 'Agent 已重启')
      await refreshAgents?.()
    } catch (err: any) {
      feedback.error(err?.message || (force ? '强制重启失败' : '重启失败'))
    }
  }
  const forceRestartAgent = (agent: any) => restartAgent(agent, 'force')
  const restartAllErrorAgents = async () => {
    if (!roomId) return
    const ok = await feedback.confirm({ title: '一键恢复异常 Agent？', message: `将软重启 ${errorAgents.length} 个异常 Agent。`, confirmText: '一键恢复' })
    if (!ok) return
    try {
      await Promise.all(errorAgents.map((agent: any) => api.restartRoomAgent(roomId, agent.id, true, 'soft')))
      feedback.success('异常 Agent 已恢复')
      await refreshAgents?.()
    } catch (err: any) {
      feedback.error(err?.message || '一键恢复失败')
    }
  }
  const forceRestartAllWorkingAgents = async () => {
    if (!roomId || !workingAgents?.length) return
    const ok = await feedback.confirm({ title: '强制重启运行中的 Agent？', message: `将强制中断 ${workingAgents.length} 个运行中的 Agent，当前输出可能丢失。`, confirmText: '强制重启' })
    if (!ok) return
    try {
      await Promise.all(workingAgents.map((agent: any) => api.restartRoomAgent(roomId, agent.id, true, 'force')))
      feedback.success('运行中的 Agent 已强制重启')
      await refreshAgents?.()
    } catch (err: any) {
      feedback.error(err?.message || '强制重启失败')
    }
  }
  return { restartAgent, forceRestartAgent, restartAllErrorAgents, forceRestartAllWorkingAgents }
}
