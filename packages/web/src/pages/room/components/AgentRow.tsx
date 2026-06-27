import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { getAgentStatusLabel, renderAgentAvatar } from '../room-ui-utils'
import { memberStyles } from './member-styles'

function modelSourceLabel(source?: string) {
  if (source === 'user_owned') return '我的模型'
  if (source === 'marketplace') return '共享模型'
  if (source === 'platform') return '平台模型'
  return ''
}

function modelScopeLabel(cfg?: any) {
  if (!cfg?.model && !cfg?.modelProfileId) return ''
  if (cfg.scope === 'room_override') return '当前房间覆盖'
  if (cfg.scope === 'agent_default' || cfg.inheritedFromAgent) return '继承通讯录默认'
  return ''
}

export function AgentRow({ agent, room, openMemberProfile, restartAgent, openModelConfig, removeAgent, handoffAgent, mobile = false }: any) {
  const isError = agent.status === 'error' || agent.onlineStatus === 'error'
  const isWorking = agent.status === 'working' || agent.onlineStatus === 'working'
  const isCurrentAssistant = room?.currentAssistantAgentId ? room.currentAssistantAgentId === agent.id : agent.autoEnabled
  const rowClass = `${memberStyles.agentRow} ${mobile ? memberStyles.agentRowMobile : memberStyles.agentRowDesktop} ${isCurrentAssistant ? 'ring-1 ring-blue-100 bg-blue-50/40' : ''}`
  const nameClass = mobile ? 'font-medium text-gray-800 truncate' : 'text-sm font-medium text-gray-800 truncate'
  const metaClass = `${mobile ? 'text-sm' : 'text-xs'} text-gray-400 flex items-center gap-1`
  const modelSource = modelSourceLabel(agent.roomModelConfig?.modelSource)
  const modelScope = modelScopeLabel(agent.roomModelConfig)
  return <div className={rowClass}><button type="button" onClick={() => openMemberProfile(agent, 'agent')} className={memberStyles.agentMainButton}>{renderAgentAvatar(agent, mobile ? 'w-11 h-11' : 'w-9 h-9', 'w-5 h-5')}<div className="min-w-0 flex-1"><p className={nameClass}>{agent.name}</p><p className={metaClass}>{isCurrentAssistant && <ShieldCheck className="w-3 h-3" />}<span>{isCurrentAssistant ? '当前协调者' : '可响应'}</span><span>· {getAgentStatusLabel(agent)}</span>{agent.roomModelConfig?.model && <span>· {agent.roomModelConfig.model}</span>}{modelSource && <span>· {modelSource}</span>}{modelScope && <span>· {modelScope}</span>}</p>{mobile && agent.specialties?.length > 0 && <div className="flex gap-1 mt-1 flex-wrap">{agent.specialties.map((s: string) => <span key={s} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{s}</span>)}</div>}</div></button><div className="flex shrink-0 gap-1">{!isCurrentAssistant && <button type="button" onClick={() => handoffAgent?.(agent)} className={memberStyles.recoverButton}>协调</button>}<button type="button" onClick={() => openModelConfig?.(agent)} className={memberStyles.recoverButton} title="仅覆盖当前房间模型"><KeyRound className="w-3 h-3" /></button>{isWorking && <button type="button" onClick={() => restartAgent?.(agent, 'force')} className={memberStyles.recoverButton}>强启</button>}{isError && <button type="button" onClick={() => restartAgent?.(agent)} className={memberStyles.recoverButton}>恢复</button>}<button type="button" onClick={() => removeAgent?.(agent)} className="rounded-md px-1.5 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-600" title="从群聊移除"><Trash2 className="w-3 h-3" /></button></div></div>
}
