import { api } from '../../lib/api'

export function createRoomAgentActions({ roomId, errorAgents, feedback }: any) {
  const restartAgent = async (agent: any) => {
    if (!roomId) return
    const ok = await feedback.confirm({ title: '重启 Agent？', message: `将软重启「${agent.name}」，清理会话并恢复为在线状态。`, confirmText: '重启' })
    if (!ok) return
    try {
      await api.restartRoomAgent(roomId, agent.id, true)
      feedback.success('Agent 已重启')
    } catch (err: any) {
      feedback.error(err?.message || '重启失败')
    }
  }
  const restartAllErrorAgents = async () => {
    if (!roomId) return
    const ok = await feedback.confirm({ title: '一键恢复异常 Agent？', message: `将软重启 ${errorAgents.length} 个异常 Agent。`, confirmText: '一键恢复' })
    if (!ok) return
    try {
      await Promise.all(errorAgents.map((agent: any) => api.restartRoomAgent(roomId, agent.id, true)))
      feedback.success('异常 Agent 已恢复')
    } catch (err: any) {
      feedback.error(err?.message || '一键恢复失败')
    }
  }
  return { restartAgent, restartAllErrorAgents }
}
