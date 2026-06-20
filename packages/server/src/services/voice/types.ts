export type VoiceProviderConfig = {
  id: string
  userId: string
  provider: string
  name: string
  asrEnabled: boolean
  ttsEnabled: boolean
  isDefaultAsr: boolean
  isDefaultTts: boolean
  credential: Record<string, any>
  config: Record<string, any>
  status: string
  createdAt: number
  updatedAt: number
}
export type VoiceProviderConfigPublic = Omit<VoiceProviderConfig, 'credential'> & { credentialStatus: 'configured' | 'missing' }
export type SpeechRecognitionProvider = { provider: string; transcribeOnce(input: { audio: Buffer; mimeType: string; sampleRate?: number; language?: string; format?: string; config: VoiceProviderConfig }): Promise<{ text: string; confidence?: number; durationMs?: number; raw?: unknown }> }
export type SpeechSynthesisProvider = { provider: string; synthesize(input: { text: string; voice?: string; speed?: number; format?: string; sampleRate?: number; config: VoiceProviderConfig }): Promise<{ audio: Buffer; mimeType: string; durationMs?: number; raw?: unknown }> }
