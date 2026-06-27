export type UsageTokenSnapshot = {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  totalTokens: number
}

export type MeteredUsageEvent = UsageTokenSnapshot & {
  id: string
  runId: string
  roomId: string
  agentId: string
  agentTemplateId?: string | null
  payerUserId: string
  agentProviderUserId?: string | null
  modelProviderUserId?: string | null
  modelProfileId?: string | null
  isSelfProvidedModel?: boolean
  runtime?: string | null
  model?: string | null
  modelSource?: string | null
  baseUrlHost?: string | null
  usageSource?: string | null
  usageTrustLevel?: string | null
  reportedByConnectorId?: string | null
  reportedAt?: number | null
  rawUsageJson?: string | null
  status: 'pending' | 'charged' | 'ignored' | 'failed'
  snapshotJson?: string | null
  createdAt: number
}
