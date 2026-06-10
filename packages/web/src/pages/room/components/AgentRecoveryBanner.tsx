import { memberStyles } from './member-styles'

export function AgentRecoveryBanner({ errorAgents, restartAllAgents }: any) {
  if (!errorAgents?.length) return null
  const names = errorAgents.map((agent: any) => agent.name).join('、')
  return <div className={memberStyles.banner}><div className="min-w-0"><span className="font-medium">{errorAgents.length} 个 Agent 状态异常：</span><span className="break-words">{names}</span></div><div className="mt-2 flex flex-wrap gap-2 sm:mt-0 shrink-0"><button onClick={restartAllAgents} className={memberStyles.bannerPrimary}>一键软恢复</button></div></div>
}
