import { FastifyInstance } from 'fastify'
import { agentService } from '../../services/agent.service.js'
import { agentCapabilityService } from '../../services/agent-capability.service.js'
import { agentPackageService } from '../../services/agent-package.service.js'

export async function registerAgentCapabilityRoutes(app: FastifyInstance) {
app.get('/api/agents/:id/skills', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  await agentService.getAgent(id)
  return reply.send({ success: true, data: { skills: agentCapabilityService.listSkills(id) } })
})

app.post('/api/agents/:id/skills', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const body = request.body as any
  if (!String(body?.name || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } })
  await agentService.assertAgentOwner(id, user.id, user.role)
  const skill = agentCapabilityService.createSkill(id, { ...body, name: String(body.name).trim() })
  await agentPackageService.writeSkillPackage(id, skill).catch((err) => console.error('[agent-package] write skill failed', err))
  return reply.code(201).send({ success: true, data: { skill } })
})

app.patch('/api/agents/:id/skills/:skillId', async (request, reply) => {
  const user = (request as any).user
  const { id, skillId } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  const skill = agentCapabilityService.updateSkill(id, skillId, request.body as any)
  await agentPackageService.writeSkillPackage(id, skill).catch((err) => console.error('[agent-package] update skill package failed', err))
  return reply.send({ success: true, data: { skill } })
})

app.delete('/api/agents/:id/skills/:skillId', async (request, reply) => {
  const user = (request as any).user
  const { id, skillId } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  const skill = agentCapabilityService.listSkills(id).find((item) => item.id === skillId)
  agentCapabilityService.deleteSkill(id, skillId)
  await agentPackageService.deleteSkillPackage(id, skill).catch(() => {})
  return reply.send({ success: true })
})

app.get('/api/agents/:id/scripts', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  await agentService.getAgent(id)
  return reply.send({ success: true, data: { scripts: agentCapabilityService.listScripts(id) } })
})

app.post('/api/agents/:id/scripts', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const body = request.body as any
  if (!String(body?.name || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } })
  await agentService.assertAgentOwner(id, user.id, user.role)
  const script = agentCapabilityService.createScript(id, { ...body, name: String(body.name).trim() })
  await agentPackageService.ensureAgentPackage(await agentService.getAgent(id)).catch((err) => console.error('[agent-package] write script failed', err))
  return reply.code(201).send({ success: true, data: { script } })
})

app.patch('/api/agents/:id/scripts/:scriptId', async (request, reply) => {
  const user = (request as any).user
  const { id, scriptId } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  const script = agentCapabilityService.updateScript(id, scriptId, request.body as any)
  await agentPackageService.ensureAgentPackage(await agentService.getAgent(id)).catch((err) => console.error('[agent-package] update script package failed', err))
  return reply.send({ success: true, data: { script } })
})

app.delete('/api/agents/:id/scripts/:scriptId', async (request, reply) => {
  const user = (request as any).user
  const { id, scriptId } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  agentCapabilityService.deleteScript(id, scriptId)
  await agentPackageService.ensureAgentPackage(await agentService.getAgent(id)).catch(() => {})
  return reply.send({ success: true })
})

}
