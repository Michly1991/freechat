import { config } from '../config.js'
import { agentDreamService } from './agent-dream.service.js'

class AgentDreamSchedulerService {
  private timer?: NodeJS.Timeout
  private lastRunKey = ''

  start() {
    if (!config.agentDream.enabled || this.timer) return
    this.timer = setInterval(() => this.tick(), 60 * 60 * 1000)
    setTimeout(() => this.tick(), 10_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private tick() {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const key = now.toISOString().slice(0, 10)
    if (this.lastRunKey === key) return
    if (hour < config.agentDream.runHour || (hour === config.agentDream.runHour && minute < config.agentDream.runMinute)) return
    try {
      const dreams = agentDreamService.runDreams({ dryRun: !config.agentDream.autoApplySafeFixes })
      this.lastRunKey = key
      console.log(`✓ Agent dream review completed: ${dreams.length} dreams`)
    } catch (err) {
      console.error('Agent dream review failed:', err)
    }
  }
}

export const agentDreamSchedulerService = new AgentDreamSchedulerService()
