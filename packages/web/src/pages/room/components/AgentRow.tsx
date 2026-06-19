import { KeyRound, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { getAgentStatusLabel, renderAgentAvatar } from '../room-ui-utils'
import { memberStyles } from './member-styles'

export function AgentRow({ agent, openMemberProfile, restartAgent, openModelConfig, removeAgent, mobile = false }: any) {
  const isError = agent.status === 'error' || agent.onlineStatus === 'error'
  const isWorking = agent.status === 'working' || agent.onlineStatus === 'working'
  const rowClass = `${memberStyles.agentRow} ${mobile ? memberStyles.agentRowMobile : memberStyles.agentRowDesktop}`
  const nameClass = mobile ? 'font-medium text-gray-800 truncate' : 'text-sm font-medium text-gray-800 truncate'
  const metaClass = `${mobile ? 'text-sm' : 'text-xs'} text-gray-400 flex items-center gap-1`
  return <div className={rowClass}><button type="button" onClick={() => openMemberProfile(agent, 'agent')} className={memberStyles.agentMainButton}>{renderAgentAvatar(agent, mobile ? 'w-11 h-11' : 'w-9 h-9', 'w-5 h-5')}<div className="min-w-0 flex-1"><p className={nameClass}>{agent.name}</p><p className={metaClass}>{agent.roleType === 'assistant' ? <ShieldCheck className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}<span>{agent.roleType === 'assistant' ? '助理' : '专家'}</span><span>· {getAgentStatusLabel(agent)}</span>{agent.roomModelConfig?.model && <span>· {agent.roomModelConfig.model}</span>}</p>{mobile && agent.specialties?.length > 0 && <div className="flex gap-1 mt-1 flex-wrap">{agent.specialties.map((s: string) => <span key={s} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{s}</span>)}</div>}</div></button><div className="flex shrink-0 gap-1"><button type="button" onClick={() => openModelConfig?.(agent)} className={memberStyles.recoverButton} title="模型"><KeyRound className="w-3 h-3" /></button>{isWorking && <button type="button" onClick={() => restartAgent?.(agent, 'force')} className={memberStyles.recoverButton}>强启</button>}{isError && <button type="button" onClick={() => restartAgent?.(agent)} className={memberStyles.recoverButton}>恢复</button>}<button type="button" onClick={() => removeAgent?.(agent)} className="rounded-md px-1.5 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-600" title="从项目移除"><Trash2 className="w-3 h-3" /></button></div></div>
}
