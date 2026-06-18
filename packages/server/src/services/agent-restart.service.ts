import db from '../storage/db.js'
import { agentService } from './agent.service.js'

export type AgentRestartMode = 'soft' | 'force'

export interface AgentRestartOptions {
  mode?: AgentRestartMode
  clearSession?: boolean
}

export class AgentRestartService {
  async restart(roomId: string, agentIdOrName: string, userId: string, options: AgentRestartOptions = {}) {
    const mode: AgentRestartMode = options.mode === 'force' ? 'force' : 'soft'
    return this.restartInternal(roomId, agentIdOrName, userId, mode, options.clearSession !== false)
  }

  async softRestart(roomId: string, agentIdOrName: string, userId: string, clearSession = true) {
    return this.restartInternal(roomId, agentIdOrName, userId, 'soft', clearSession)
  }

  async forceRestart(roomId: string, agentIdOrName: string, userId: string, clearSession = true) {
    return this.restartInternal(roomId, agentIdOrName, userId, 'force', clearSession)
  }

  private async restartInternal(roomId: string, agentIdOrName: string, userId: string, mode: AgentRestartMode, clearSession: boolean) {
    const row = db.prepare(`
      SELECT a.id, a.name, a.status FROM agents a
      INNER JOIN room_agents ra ON ra.agent_id = a.id
      WHERE ra.room_id = ? AND (a.id = ? OR a.name = ?)
      LIMIT 1
    `).get(roomId, agentIdOrName, agentIdOrName) as any
    if (!row) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found in room' }

    const activeRun = db.prepare('SELECT id FROM agent_runs WHERE room_id = ? AND agent_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1').get(roomId, row.id, 'running') as any
    const stoppedRuntime = mode === 'force'
      ? agentService.forceStopAgentRuntime(roomId, row.id, `Force restarted by ${userId}`)
      : undefined
    if (activeRun && mode !== 'force') throw { code: 'AGENT_RUNNING', message: 'Agent is still running; use force restart if it is stuck' }

    const now = Date.now()
    const tx = db.transaction(() => {
      if (mode === 'force') {
        db.prepare(`
          UPDATE agent_runs
          SET status = 'cancelled', error = COALESCE(error, 'Force restarted by user'), finished_at = COALESCE(finished_at, ?)
          WHERE room_id = ? AND agent_id = ? AND status = 'running'
        `).run(now, roomId, row.id)
      }
      db.prepare("UPDATE agents SET status = 'active', updated_at = ? WHERE id = ?").run(now, row.id)
      db.prepare("UPDATE agent_runs SET status = 'failed', error = COALESCE(error, 'Soft restarted by user'), finished_at = COALESCE(finished_at, ?) WHERE room_id = ? AND agent_id = ? AND status IN ('failed')").run(now, roomId, row.id)
      if (clearSession) {
        const sessions = db.prepare('SELECT session_id FROM agent_sessions WHERE room_id = ? AND agent_id = ?').all(roomId, row.id) as any[]
        for (const session of sessions) db.prepare('DELETE FROM agent_messages WHERE session_id = ?').run(session.session_id)
        db.prepare('DELETE FROM agent_sessions WHERE room_id = ? AND agent_id = ?').run(roomId, row.id)
      }
    })
    tx()

    const pendingSubtasks = db.prepare(`
      SELECT ti.id, ti.title, ti.description, ti.status, t.id as task_id, t.title as task_title
      FROM task_items ti
      INNER JOIN tasks t ON t.id = ti.task_id
      WHERE t.room_id = ? AND ti.assignee_id = ? AND ti.status IN ('assigned', 'doing')
      ORDER BY ti.updated_at DESC
      LIMIT 5
    `).all(roomId, row.id) as any[]
    const agent = await agentService.getAgent(row.id)
    return { agent, previousStatus: row.status, restartedBy: userId, clearSession, mode, stoppedRuntime, cancelledRunId: activeRun?.id, pendingSubtasks }
  }
}

export const agentRestartService = new AgentRestartService()
