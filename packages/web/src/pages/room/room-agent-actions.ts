export function createRoomAgentActions({ errorAgents, feedback, sendWs }: any) {
  const restartAgent = async (agent: any) => {
    const ok = await feedback.confirm({ title: '重启 Agent？', message: `将软重启「${agent.name}」，清理会话并恢复为在线状态。`, confirmText: '重启' })
    if (!ok) return
    if (!sendWs('agent.restart', { agentId: agent.id, clearSession: true })) feedback.error('实时连接不可用，重启失败')
  }
  const restartAllErrorAgents = async () => {
    const ok = await feedback.confirm({ title: '一键恢复异常 Agent？', message: `将软重启 ${errorAgents.length} 个异常 Agent。`, confirmText: '一键恢复' })
    if (!ok) return
    errorAgents.forEach((agent: any) => sendWs('agent.restart', { agentId: agent.id, clearSession: true }))
  }
  return { restartAgent, restartAllErrorAgents }
}
