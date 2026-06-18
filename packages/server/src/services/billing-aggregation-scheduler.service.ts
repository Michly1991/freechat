import { billingAggregationService } from './billing-aggregation.service.js'

export class BillingAggregationSchedulerService {
  private timer?: NodeJS.Timeout
  start() {
    if (this.timer) return
    const run = () => {
      try { billingAggregationService.refresh(Date.now() - 2 * 24 * 60 * 60 * 1000, Date.now()) }
      catch (err) { console.error('Billing aggregation failed:', err) }
    }
    this.timer = setInterval(run, 5 * 60 * 1000)
    setTimeout(run, 30_000)
  }
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}

export const billingAggregationSchedulerService = new BillingAggregationSchedulerService()
