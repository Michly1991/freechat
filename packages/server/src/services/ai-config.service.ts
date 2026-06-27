import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '../../ai-config.json')

export interface AIProvider {
  name: string
  baseUrl: string
  apiKeyHeader: string
  models: string[]
  defaultModel: string
  authType: 'header' | 'bearer'
  enabled: boolean
}

export interface AIConfig {
  providers: Record<string, AIProvider>
  currentProvider: string
  apiKeys: Record<string, string>
}

export interface AIUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
}

export interface AICallResult {
  text: string
  model: string
  usage: AIUsage
}

function toNumber(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function parseUsage(data: any): AIUsage {
  const usage = data?.usage || {}
  const inputTokens = toNumber(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens)
  const outputTokens = toNumber(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens)
  const cacheCreationInputTokens = toNumber(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens)
  const cacheReadInputTokens = toNumber(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens)
  const explicitTotal = toNumber(usage.total_tokens ?? usage.totalTokens)
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: explicitTotal || inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  }
}

class AIConfigService {
  private config: AIConfig

  constructor() {
    this.config = this.loadConfig()
  }

  private loadConfig(): AIConfig {
    if (existsSync(CONFIG_PATH)) {
      try {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      } catch (err) {
        console.error('Failed to load AI config:', err)
      }
    }
    return {
      providers: {},
      currentProvider: '',
      apiKeys: {}
    }
  }

  save() {
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2))
  }

  getConfig(): AIConfig {
    return this.config
  }

  getCurrentProvider(): AIProvider | null {
    return this.config.providers[this.config.currentProvider] || null
  }

  getApiKey(provider: string): string | null {
    return this.config.apiKeys[provider] || null
  }

  updateApiKey(provider: string, apiKey: string) {
    this.config.apiKeys[provider] = apiKey
    this.save()
  }

  setCurrentProvider(provider: string) {
    if (this.config.providers[provider]) {
      this.config.currentProvider = provider
      this.save()
    }
  }

  enableProvider(provider: string, enabled: boolean) {
    if (this.config.providers[provider]) {
      this.config.providers[provider].enabled = enabled
      this.save()
    }
  }

  async testConnection(provider: string, model?: string): Promise<{ success: boolean; message: string; latency?: number }> {
    const providerConfig = this.config.providers[provider]
    const apiKey = this.config.apiKeys[provider]

    if (!providerConfig || !apiKey) {
      return { success: false, message: 'Provider or API key not configured' }
    }

    const testModel = model || providerConfig.defaultModel
    const start = Date.now()

    try {
      const response = await fetch(`${providerConfig.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [providerConfig.apiKeyHeader]: apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'say OK' }]
        })
      })

      const latency = Date.now() - start
      const data = await response.json() as any

      if (response.ok) {
        return { success: true, message: `连接成功！模型: ${testModel}`, latency }
      } else {
        return { 
          success: false, 
          message: `${response.status}: ${data.message || data.code || 'Unknown error'}`,
          latency 
        }
      }
    } catch (err: any) {
      return { success: false, message: `网络错误: ${err.message}` }
    }
  }

  async callAnthropicCompatibleWithUsage(input: {
    baseUrl: string
    apiKey: string
    apiKeyHeader?: string
    authType?: 'header' | 'bearer'
    model?: string
    prompt: string
    maxTokens?: number
    system?: string
  }): Promise<AICallResult> {
    const model = input.model
    if (!model) throw new Error('AI model not configured')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    if (input.authType === 'bearer') headers.authorization = input.apiKey.startsWith('Bearer ') ? input.apiKey : `Bearer ${input.apiKey}`
    else headers[input.apiKeyHeader || 'x-api-key'] = input.apiKey

    const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens || 1024,
        messages: [{ role: 'user', content: input.prompt }],
        ...(input.system && { system: input.system })
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as any
      throw new Error(`AI API error: ${err.message || err.code || response.statusText}`)
    }

    const data = await response.json() as any
    return { text: data.content?.[0]?.text || '', model: data.model || model, usage: parseUsage(data) }
  }

  async callAIWithUsage(prompt: string, options?: { model?: string; maxTokens?: number; system?: string }): Promise<AICallResult> {
    const provider = this.getCurrentProvider()
    const apiKey = this.getApiKey(this.config.currentProvider)

    if (!provider || !apiKey) {
      throw new Error('AI provider not configured')
    }

    return this.callAnthropicCompatibleWithUsage({
      baseUrl: provider.baseUrl,
      apiKey,
      apiKeyHeader: provider.apiKeyHeader,
      authType: provider.authType,
      model: options?.model || provider.defaultModel,
      prompt,
      maxTokens: options?.maxTokens,
      system: options?.system,
    })
  }

  async callAI(prompt: string, options?: { model?: string; maxTokens?: number; system?: string }): Promise<string> {
    return (await this.callAIWithUsage(prompt, options)).text
  }
}

export const aiConfigService = new AIConfigService()
