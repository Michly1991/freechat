import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

export interface AgentStreamActivity {
  kind?: string
  text: string
  tool?: string
  timestamp: number
}

export interface AgentStreamMessage {
  id: string
  agentId: string
  actorId: string
  actorName: string
  actorRole: 'ai'
  content: string
  kind: 'agent_stream'
  status: string
  createdAt: number
  activities: AgentStreamActivity[]
  error?: string
  finalMessageId?: string
}

function eventRowToActivity(row: any): AgentStreamActivity {
  return {
    kind: row.kind || undefined,
    text: row.text,
    tool: row.tool || undefined,
    timestamp: row.created_at,
  }
}

function compactActivities(activities: AgentStreamActivity[]): AgentStreamActivity[] {
  const result: AgentStreamActivity[] = []
  for (const activity of activities) {
    const index = activity.kind ? result.findIndex((item) => item.kind === activity.kind) : -1
    if (index >= 0) result[index] = { ...result[index], ...activity }
    else result.push(activity)
  }
  return result
}

export class AgentStreamService {
  createStream(roomId: string, agentId: string, actorName: string, streamId?: string): AgentStreamMessage {
    const id = streamId || `astream_${uuidv4()}`
    const now = Date.now()
    db.prepare(`
      INSERT OR REPLACE INTO agent_streams (id, room_id, agent_id, actor_name, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'streaming', ?, ?)
    `).run(id, roomId, agentId, actorName, now, now)
    this.addActivity(id, { text: '收到请求，开始处理', timestamp: now })
    return this.getStreamMessage(id)!
  }

  addActivity(streamId: string, activity: Omit<AgentStreamActivity, 'timestamp'> & { timestamp?: number }): AgentStreamActivity {
    const now = activity.timestamp || Date.now()
    if (activity.kind) {
      const existing = db.prepare('SELECT id FROM agent_stream_events WHERE stream_id = ? AND kind = ? LIMIT 1').get(streamId, activity.kind) as any
      if (existing) {
        db.prepare('UPDATE agent_stream_events SET text = ?, tool = ?, created_at = ? WHERE id = ?').run(activity.text, activity.tool || null, now, existing.id)
      } else {
        db.prepare('INSERT INTO agent_stream_events (id, stream_id, kind, text, tool, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(`asevt_${uuidv4()}`, streamId, activity.kind, activity.text, activity.tool || null, now)
      }
    } else {
      db.prepare('INSERT INTO agent_stream_events (id, stream_id, kind, text, tool, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(`asevt_${uuidv4()}`, streamId, null, activity.text, activity.tool || null, now)
    }
    db.prepare('UPDATE agent_streams SET updated_at = ? WHERE id = ?').run(now, streamId)
    return { kind: activity.kind, text: activity.text, tool: activity.tool, timestamp: now }
  }

  completeStream(streamId: string, finalMessageId?: string, silent = false) {
    const now = Date.now()
    db.prepare(`
      UPDATE agent_streams
      SET status = ?, final_message_id = ?, updated_at = ?, finished_at = ?
      WHERE id = ?
    `).run(silent ? 'silent' : 'completed', finalMessageId || null, now, now, streamId)
  }

  failStream(streamId: string, error: string) {
    const now = Date.now()
    db.prepare(`
      UPDATE agent_streams
      SET status = 'failed', error = ?, updated_at = ?, finished_at = ?
      WHERE id = ?
    `).run(error, now, now, streamId)
    this.addActivity(streamId, { text: `处理失败：${error}`, timestamp: now })
  }

  getActivities(streamId: string): AgentStreamActivity[] {
    const rows: any[] = db.prepare('SELECT * FROM agent_stream_events WHERE stream_id = ? ORDER BY created_at ASC').all(streamId)
    return compactActivities(rows.map(eventRowToActivity))
  }

  getStreamMessage(streamId: string): AgentStreamMessage | undefined {
    const row = db.prepare('SELECT * FROM agent_streams WHERE id = ?').get(streamId) as any
    if (!row) return undefined
    return {
      id: row.id,
      agentId: row.agent_id,
      actorId: row.agent_id,
      actorName: row.actor_name,
      actorRole: 'ai',
      content: '',
      kind: 'agent_stream',
      status: row.status,
      createdAt: row.started_at,
      activities: this.getActivities(row.id),
      error: row.error || undefined,
      finalMessageId: row.final_message_id || undefined,
    }
  }

  getActiveStreamMessages(roomId: string): AgentStreamMessage[] {
    const rows: any[] = db.prepare(`
      SELECT id FROM agent_streams
      WHERE room_id = ? AND status = 'streaming'
      ORDER BY started_at ASC
    `).all(roomId)
    return rows.map((row) => this.getStreamMessage(row.id)).filter(Boolean) as AgentStreamMessage[]
  }
}

export const agentStreamService = new AgentStreamService()
