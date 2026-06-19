import { config } from '../config.js'
import { agentGrowthService } from './agent-growth.service.js'

class AgentGrowthSchedulerService {
  private timer: NodeJS.Timeout | null = null
  private lastRunKey = ''

  start() {
    if (!config.agentGrowth.enabled || this.timer) return
    this.timer = setInterval(() => this.tick(), 60 * 60 * 1000)
    this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick() {
    const now = new Date()
    const key = now.toISOString().slice(0, 10)
    if (this.lastRunKey === key) return
    if (now.getHours() !== config.agentGrowth.runHour) return
    if (now.getMinutes() < config.agentGrowth.runMinute) return
    this.lastRunKey = key
    try {
      const reviews = agentGrowthService.runGrowthReview()
      console.log(`Agent growth review completed: ${reviews.length} rooms`)
    } catch (err) {
      console.error('Agent growth review failed:', err)
    }
  }
}

export const agentGrowthSchedulerService = new AgentGrowthSchedulerService()
