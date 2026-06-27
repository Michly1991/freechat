import { messageService } from '../services/message.service.js'
import { roomService } from '../services/room.service.js'
import { membersService } from '../services/members.service.js'
import { agentService } from '../services/agent.service.js'
import { agentRestartService } from '../services/agent-restart.service.js'
import { agentCapabilityService } from '../services/agent-capability.service.js'
import { sceneTemplateService } from '../services/scene-template.service.js'
import { interactionService } from '../services/interaction.service.js'
import { workgroupService } from '../services/workgroup.service.js'
import { assertActorCanUseAgentInRoom, createRoomInvite, invokeAssignedAgent } from './agent-tools.helpers.js'
import { handleRoomHandoffTool } from './agent-tools-handoff.js'
import { assertCanAddRoomMember } from '../utils/room-authz.js'

interface AgentAdminToolContext {
  action: string
  args: any
  roomId: string
  actorUserId: string
  agent: any
  assertActorCanEditRoom: () => void
  broadcast: (roomId: string, action: string, payload: any) => void
}

export async function handleAgentAdminTool(ctx: AgentAdminToolContext): Promise<{ handled: boolean; response?: any }> {
  const { action, args, roomId, actorUserId, agent, assertActorCanEditRoom, broadcast } = ctx
  switch (action) {
        case 'agent.list_available':
        case 'agent.list-available': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const agents = await agentService.getAvailableAgentsForRoom(roomId, agent.id)
          return { handled: true, response: { success: true, data: { agents } } }
        }
        case 'agent.create_request':
        case 'agent.create-request':
        case 'agent.create': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const name = String(args.name || '').trim()
          if (!name) throw { code: 'VALIDATION_ERROR', message: 'agent name is required' }
          const roleType = args.roleType === 'assistant' ? 'assistant' : 'specialist'
          const specialties = Array.isArray(args.specialties) ? args.specialties.map((s: any) => String(s).trim()).filter(Boolean) : []
          const result = await interactionService.create(roomId, { id: agent.id, name: agent.name, role: 'ai' }, {
            type: 'confirm',
            title: `确认创建 Agent：${name}`,
            description: [
              args.description ? `职责：${args.description}` : '',
              specialties.length ? `专长：${specialties.join('、')}` : '',
              '确认后会创建该 Agent 并加入当前项目。',
            ].filter(Boolean).join('\n'),
            priority: 'important',
            payload: {
              agentCreate: {
                name,
                roleType,
                deployment: 'client',
                description: args.description,
                specialties,
                config: args.config || undefined,
                roomRole: args.roomRole === 'assistant' ? 'assistant' : 'specialist',
                autoEnabled: args.autoEnabled === true,
                priority: Number(args.priority || 0),
              }
            },
            options: [
              { value: 'confirm', label: '确认创建', style: 'primary' },
              { value: 'cancel', label: '取消', style: 'secondary' },
            ],
            responsePolicy: { allowChange: false, allowCancel: true },
          } as any)
          broadcast(roomId, 'interaction.created', { interaction: result.interaction })
          broadcast(roomId, 'chat.message', result.message)
          return { handled: true, response: { success: true, data: result } }
        }
        case 'agent.restart': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const target = args.agent || args.agentId || args.id || args.name
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          const result = await agentRestartService.restart(roomId, target, agent.id, { mode: args.force === true || args.mode === 'force' ? 'force' : 'soft', clearSession: args.clearSession !== false })
          broadcast(roomId, 'agent.status_update', { agentId: result.agent.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now(), lastError: null })
          if (result.pendingSubtasks.length > 0) {
            const lines = result.pendingSubtasks.map((item: any, i: number) => `${i + 1}. 父任务 ${item.task_id}「${item.task_title}」 / 子任务 ${item.id}「${item.title}」`).join('\n')
            await invokeAssignedAgent(roomId, result.agent.id, agent.id, `你刚刚被人工${result.mode === 'force' ? '强制重启' : '软恢复'}，请继续处理已分派但未完成的子任务：\n${lines}\n\n请先用 ./freechat task subtask update 标记状态/进展。项目交付文件必须通过 ./freechat file write-local <项目文件路径> <本地文件路径> --show 或 ./freechat file write <项目文件路径> <内容> --show 写入；直接写 res/ 只是私有工作区，用户文件目录不可见。完成后在聊天中简短汇报。`, actorUserId)
          }
          return { handled: true, response: { success: true, data: result } }
        }
        case 'room.handoff': return { handled: true, response: await handleRoomHandoffTool(roomId, agent, actorUserId, args) }
        case 'agent.add': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          assertActorCanEditRoom()
          const target = await agentService.resolveAvailableAgentForRoom(roomId, agent.id, args.agent || args.agentId || args.name)
          const roomRole = args.roomRole === 'assistant' ? 'assistant' : (target.roleType === 'assistant' ? 'assistant' : 'specialist')
          await agentService.addAgentToRoom(roomId, target.id, actorUserId, {
            roomRole,
            autoEnabled: args.autoEnabled === true,
            priority: Number(args.priority || 0),
          })
          await agentService.refreshRoomAgentContext(roomId)
          const members = await roomService.getRoomMembers(roomId)
          const agents = await agentService.getRoomAgents(roomId)
          broadcast(roomId, 'room.members_update', { members, agents })
          return { handled: true, response: { success: true, data: { agent: target, agents } } }
        }
        case 'agent.remove': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          assertActorCanEditRoom()
          const target = args.agent || args.agentId || args.id || args.name
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          const roomAgents = await agentService.getRoomAgents(roomId)
          const targetAgent = roomAgents.find((item: any) => item.id === target || item.name === target)
          if (!targetAgent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found in room' }
          await agentService.removeAgentFromRoom(roomId, targetAgent.id)
          await agentService.refreshRoomAgentContext(roomId)
          const nextAgents = await agentService.getRoomAgents(roomId)
          broadcast(roomId, 'room.members_update', { members: await roomService.getRoomMembers(roomId), agents: nextAgents })
          return { handled: true, response: { success: true, data: { agents: nextAgents } } }
        }
        case 'agent.detail': {
          const target = args.agent || args.agentId || args.id || agent.id
          await assertActorCanUseAgentInRoom(roomId, target, actorUserId)
          const targetAgent = await agentService.getAgent(target)
          const skills = agentCapabilityService.listSkills(targetAgent.id)
          const scripts = agentCapabilityService.listScripts(targetAgent.id)
          return { handled: true, response: { success: true, data: { agent: targetAgent, skills, scripts } } }
        }
        case 'agent.update': {
          const target = args.agent || args.agentId || args.id
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const updated = await agentService.updateAgent(target, args.updates || args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true, data: { agent: updated } } }
        }
        case 'agent.skill.list': {
          const target = args.agent || args.agentId || args.id || agent.id
          await assertActorCanUseAgentInRoom(roomId, target, actorUserId)
          return { handled: true, response: { success: true, data: { skills: agentCapabilityService.listSkills(target) } } }
        }
        case 'agent.skill.create': {
          const target = args.agent || args.agentId || args.id
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const skill = agentCapabilityService.createSkill(target, args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true, data: { skill } } }
        }
        case 'agent.skill.update': {
          const target = args.agent || args.agentId || args.id
          const skillId = args.skillId || args.skill_id
          if (!target || !skillId) throw { code: 'VALIDATION_ERROR', message: 'agent and skillId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const skill = agentCapabilityService.updateSkill(target, skillId, args.updates || args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true, data: { skill } } }
        }
        case 'agent.skill.delete': {
          const target = args.agent || args.agentId || args.id
          const skillId = args.skillId || args.skill_id
          if (!target || !skillId) throw { code: 'VALIDATION_ERROR', message: 'agent and skillId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          agentCapabilityService.deleteSkill(target, skillId)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true } }
        }
        case 'agent.script.list': {
          const target = args.agent || args.agentId || args.id || agent.id
          await assertActorCanUseAgentInRoom(roomId, target, actorUserId)
          return { handled: true, response: { success: true, data: { scripts: agentCapabilityService.listScripts(target) } } }
        }
        case 'agent.script.create': {
          const target = args.agent || args.agentId || args.id
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const script = agentCapabilityService.createScript(target, args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true, data: { script } } }
        }
        case 'agent.script.update': {
          const target = args.agent || args.agentId || args.id
          const scriptId = args.scriptId || args.script_id
          if (!target || !scriptId) throw { code: 'VALIDATION_ERROR', message: 'agent and scriptId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const script = agentCapabilityService.updateScript(target, scriptId, args.updates || args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true, data: { script } } }
        }
        case 'agent.script.delete': {
          const target = args.agent || args.agentId || args.id
          const scriptId = args.scriptId || args.script_id
          if (!target || !scriptId) throw { code: 'VALIDATION_ERROR', message: 'agent and scriptId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          agentCapabilityService.deleteScript(target, scriptId)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true } }
        }
        case 'scene.list': {
          return { handled: true, response: { success: true, data: { scenes: sceneTemplateService.listScenes({ id: actorUserId, role: undefined }) } } }
        }
        case 'scene.create': {
          const scene = sceneTemplateService.createScene(actorUserId, args)
          return { handled: true, response: { success: true, data: { scene } } }
        }
        case 'scene.update': {
          const sceneId = args.sceneId || args.id
          if (!sceneId) throw { code: 'VALIDATION_ERROR', message: 'sceneId is required' }
          const scene = sceneTemplateService.updateScene({ id: actorUserId, role: undefined }, sceneId, args.updates || args)
          return { handled: true, response: { success: true, data: { scene } } }
        }
        case 'members.list': {
          const members = await roomService.getRoomMembers(roomId)
          const agents = await agentService.getRoomAgents(roomId)
          return { handled: true, response: { success: true, data: { members, agents } } }
        }
        case 'workgroup.info': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { handled: true, response: { success: true, data: { workgroup } } }
        }
        case 'workgroup.members': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { handled: true, response: { success: true, data: { workgroup, members: workgroupService.listMembers(workgroup.id) } } }
        }
        case 'workgroup.agents': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { handled: true, response: { success: true, data: { workgroup, agents: workgroupService.listAgents(workgroup.id) } } }
        }
        case 'workgroup.rooms': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { handled: true, response: { success: true, data: { workgroup, rooms: workgroupService.listRooms(workgroup.id, actorUserId) } } }
        }
        case 'room.create': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const result = await workgroupService.createRoomFromWorkgroup(roomId, actorUserId, agent.id, args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          broadcast(result.room.id, 'room.members_update', { members: result.members, agents: result.agents })
          const msg = await messageService.createMessage(roomId, agent.id, '新建协作会话', 'ai', `已创建协作会话「${result.room.name}」，并加入指定成员和 Agent。`)
          broadcast(roomId, 'chat.message', msg)
          return { handled: true, response: { success: true, data: result } }
        }
        case 'members.add': {
          assertActorCanEditRoom()
          const userId = args.userId || args.id
          if (!userId) throw { code: 'VALIDATION_ERROR', message: 'userId is required' }
          const role = ['owner', 'editor', 'viewer'].includes(args.role) ? args.role : 'viewer'
          assertCanAddRoomMember(roomId, actorUserId, role)
          await roomService.addMember(roomId, userId, role)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          const members = await roomService.getRoomMembers(roomId)
          broadcast(roomId, 'room.members_update', { members, agents: await agentService.getRoomAgents(roomId) })
          return { handled: true, response: { success: true, data: { members } } }
        }
        case 'profiles.update': {
          assertActorCanEditRoom()
          const memberId = args.memberId || args.userId || args.id
          if (!memberId) throw { code: 'VALIDATION_ERROR', message: 'memberId is required' }
          const profile = await membersService.setProfile(roomId, memberId, {
            displayName: args.displayName || args.roleTitle || args.role_title,
            roleDescription: args.roleDescription || args.persona,
            avatar: args.avatar,
            customData: args.customData || {
              specialties: args.specialties,
              roleTitle: args.roleTitle || args.role_title,
              persona: args.persona,
            },
          })
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { handled: true, response: { success: true, data: { profile } } }
        }
        case 'room.info': {
          const room = await roomService.getRoom(roomId)
          return { handled: true, response: { success: true, data: { room } } }
        }
        case 'room.update': {
          assertActorCanEditRoom()
          const room = await roomService.updateRoom(roomId, args.name, args.description)
          broadcast(roomId, 'room.updated', { room })
          return { handled: true, response: { success: true, data: { room } } }
        }
        case 'room.create-invite': {
          assertActorCanEditRoom()
          return { handled: true, response: { success: true, data: createRoomInvite(roomId, actorUserId, args) } }
        }
    default:
      return { handled: false }
  }
}
