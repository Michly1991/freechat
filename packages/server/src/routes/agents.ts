import { FastifyInstance } from 'fastify'
import { agentService } from '../services/agent.service.js'
import { roomService } from '../services/room.service.js'
import { messageService } from '../services/message.service.js'
import { membersService } from '../services/members.service.js'

export async function registerAgentRoutes(app: FastifyInstance) {
  // ===== User's own agents =====

  // GET /api/agents - list user's agents
  app.get('/api/agents', async (request, reply) => {
    const user = (request as any).user
    try {
      const agents = await agentService.getUserAgents(user.id)
      return reply.send({ success: true, data: { agents } })
    } catch (err: any) {
      throw err
    }
  })

  // POST /api/agents - create agent (returns api_key once)
  app.post('/api/agents', async (request, reply) => {
    const user = (request as any).user
    const { name, roleType, deployment, description, specialties, config } = request.body as any

    if (!name || !roleType || !deployment) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'name, roleType, and deployment are required' }
      })
    }
    if (!['assistant', 'specialist'].includes(roleType) || !['server', 'client'].includes(deployment)) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'invalid roleType or deployment' }
      })
    }

    try {
      const result = await agentService.createAgent(user.id, {
        name,
        roleType,
        deployment,
        description,
        specialties,
        config,
      })
      return reply.code(201).send({ success: true, data: result })
    } catch (err: any) {
      throw err
    }
  })

  // PATCH /api/agents/:id - update agent
  app.patch('/api/agents/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any

    try {
      await agentService.assertAgentOwner(id, user.id)

      const updated = await agentService.updateAgent(id, {
        name: body.name,
        roleType: body.roleType,
        deployment: body.deployment,
        description: body.description,
        specialties: body.specialties,
        config: body.config,
        status: body.status,
      })
      return reply.send({ success: true, data: { agent: updated } })
    } catch (err: any) {
      if (err.code === 'AGENT_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      throw err
    }
  })

  // DELETE /api/agents/:id - delete agent
  app.delete('/api/agents/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any

    try {
      await agentService.assertAgentOwner(id, user.id)
      await agentService.deleteAgent(id)
      return reply.send({ success: true })
    } catch (err: any) {
      throw err
    }
  })

  // POST /api/agents/:id/regenerate-key - regenerate api_key
  app.post('/api/agents/:id/regenerate-key', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any

    try {
      await agentService.assertAgentOwner(id, user.id)
      const apiKey = await agentService.regenerateApiKey(id)
      return reply.send({ success: true, data: { apiKey } })
    } catch (err: any) {
      if (err.code === 'AGENT_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      throw err
    }
  })

  // ===== Room agents =====

  // GET /api/rooms/:roomId/agents - list room agents
  app.get('/api/rooms/:roomId/agents', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any

    try {
      const isMember = await roomService.isMember(roomId, user.id)
      if (!isMember) {
        return reply.code(403).send({
          success: false,
          error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
        })
      }

      const agents = await agentService.getRoomAgents(roomId)
      return reply.send({ success: true, data: { agents } })
    } catch (err: any) {
      throw err
    }
  })

  // POST /api/rooms/:roomId/agents - add agent to room
  app.post('/api/rooms/:roomId/agents', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const { agentId, roomRole, autoEnabled, priority } = request.body as any

    if (!agentId) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'agentId is required' }
      })
    }

    try {
      const canEdit = await agentService.canEditRoomAgents(roomId, user.id)
      if (!canEdit) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only project owner/editor can add agents' }
        })
      }

      if (!await agentService.canUseAgent(agentId, user.id)) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only add your own agents in this version' }
        })
      }

      await agentService.addAgentToRoom(roomId, agentId, user.id, {
        roomRole: roomRole === 'assistant' ? 'assistant' : 'specialist',
        autoEnabled: autoEnabled === true,
        priority: Number(priority || 0),
      })

      // Update MEMBERS.md
      await membersService.updateMembersFile(roomId)

      const agent = await agentService.getAgent(agentId)
      return reply.send({ success: true, data: { agent } })
    } catch (err: any) {
      if (err.code === 'AGENT_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      throw err
    }
  })

  // DELETE /api/rooms/:roomId/agents/:agentId - remove agent from room
  app.delete('/api/rooms/:roomId/agents/:agentId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, agentId } = request.params as any

    try {
      const canEdit = await agentService.canEditRoomAgents(roomId, user.id)
      if (!canEdit) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only project owner/editor can remove agents' }
        })
      }

      await agentService.removeAgentFromRoom(roomId, agentId)

      // Update MEMBERS.md
      await membersService.updateMembersFile(roomId)

      return reply.send({ success: true })
    } catch (err: any) {
      throw err
    }
  })

  // POST /api/rooms/:roomId/agents/:agentId/invoke - invoke agent with a message
  app.post('/api/rooms/:roomId/agents/:agentId/invoke', async (request, reply) => {
    const user = (request as any).user
    const { roomId, agentId } = request.params as any
    const { message } = request.body as any

    if (!message) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'message is required' }
      })
    }

    try {
      const isMember = await roomService.isMember(roomId, user.id)
      if (!isMember) {
        return reply.code(403).send({
          success: false,
          error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
        })
      }

      // Mark agent as working
      await agentService.updateAgent(agentId, { status: 'working' } as any)

      try {
        const result = await agentService.spawnClaudeCode(roomId, agentId, message)

        // Mark agent as active again
        await agentService.updateAgent(agentId, { status: 'active' } as any)

        if (result.silent) {
          return reply.send({ success: true, data: { response: '', silent: true } })
        }

        // Post agent response as a message in the room
        if (result.response) {
          const agent = await agentService.getAgent(agentId)
          const msg = await messageService.createMessage(
            roomId,
            agentId,
            agent.name,
            'ai',
            result.response
          )
          return reply.send({ success: true, data: { response: result.response, message: msg } })
        }

        return reply.send({ success: true, data: { response: result.response } })
      } catch (execErr: any) {
        await agentService.updateAgent(agentId, { status: 'error' } as any)
        throw execErr
      }
    } catch (err: any) {
      if (err.code === 'AGENT_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      throw err
    }
  })

  // ===== Marketplace =====

  // GET /api/agent-market/search - search marketplace
  app.get('/api/agent-market/search', async (request, reply) => {
    const { q } = request.query as any

    try {
      const agents = await agentService.searchMarketplace(q)
      return reply.send({ success: true, data: { agents } })
    } catch (err: any) {
      throw err
    }
  })

  // GET /api/agent-market/featured - featured agents
  app.get('/api/agent-market/featured', async (request, reply) => {
    try {
      const agents = await agentService.getFeaturedAgents()
      return reply.send({ success: true, data: { agents } })
    } catch (err: any) {
      throw err
    }
  })
}
