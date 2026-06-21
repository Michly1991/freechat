import { useCallback, useEffect, useRef } from 'react'
import { api } from '../../lib/api'

interface StreamingVoicePlaybackOptions {
  roomId?: string
  enabled: boolean
  feedback: { error: (message: string) => void }
  setVoicePlaybackBusy: (busy: boolean) => void
  setVoiceStatus: (status: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error') => void
}

interface StreamBuffer {
  queuedUntil: number
  content: string
}

interface SpeechSegment {
  key: string
  text: string
  messageId?: string
}

function getSpeakableCutoff(text: string, force = false) {
  let cutoff = 0
  const sentenceEnd = /[。！？!?；;]\s*/g
  let match: RegExpExecArray | null
  while ((match = sentenceEnd.exec(text))) cutoff = match.index + match[0].length
  if (cutoff > 0) return cutoff
  if (text.length >= 80) {
    const commaCut = Math.max(text.lastIndexOf('，', 70), text.lastIndexOf(',', 70), text.lastIndexOf('、', 70))
    return commaCut > 20 ? commaCut + 1 : 70
  }
  return force && text.trim() ? text.length : 0
}

function normalizeSpeechText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export function useStreamingVoicePlayback({ roomId, enabled, feedback, setVoicePlaybackBusy, setVoiceStatus }: StreamingVoicePlaybackOptions) {
  const enabledRef = useRef(enabled)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playedMessageIdsRef = useRef<Set<string>>(new Set())
  const streamBuffersRef = useRef<Map<string, StreamBuffer>>(new Map())
  const queueRef = useRef<SpeechSegment[]>([])
  const playingRef = useRef(false)

  useEffect(() => { enabledRef.current = enabled }, [enabled])

  const playAudioUrl = useCallback((audioUrl: string) => new Promise<void>((resolve, reject) => {
    const audio = audioRef.current || new Audio()
    audio.setAttribute('playsinline', 'true')
    audio.pause()
    audio.currentTime = 0
    audio.src = audioUrl
    audio.volume = 1
    audioRef.current = audio
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error('AI 回复语音播放失败，请检查语音配置'))
    audio.play().catch(reject)
  }), [])

  const drainQueue = useCallback(async () => {
    if (playingRef.current) return
    playingRef.current = true
    setVoicePlaybackBusy(true)
    setVoiceStatus('speaking')
    try {
      while (enabledRef.current && queueRef.current.length > 0) {
        const item = queueRef.current.shift()!
        const res = await api.synthesizeVoice({ text: item.text, roomId, messageId: item.messageId })
        await playAudioUrl(res.audioUrl)
      }
      if (enabledRef.current) setVoiceStatus('idle')
    } catch (err: any) {
      setVoiceStatus('error')
      feedback.error(err?.message || '浏览器阻止了自动播报，请重新点击麦克风进入语音模式')
    } finally {
      playingRef.current = false
      setVoicePlaybackBusy(false)
    }
  }, [feedback, playAudioUrl, roomId, setVoicePlaybackBusy, setVoiceStatus])

  const enqueue = useCallback((segment: SpeechSegment) => {
    const text = normalizeSpeechText(segment.text)
    if (!enabledRef.current || !text) return
    queueRef.current.push({ ...segment, text })
    void drainQueue()
  }, [drainQueue])

  const enqueueStreamText = useCallback((streamId: string, content: string, force = false, finalMessageId?: string) => {
    if (!enabledRef.current || !streamId || !content) return
    const buffer = streamBuffersRef.current.get(streamId) || { queuedUntil: 0, content: '' }
    buffer.content = content
    const pending = content.slice(buffer.queuedUntil)
    const cutoff = getSpeakableCutoff(pending, force)
    if (cutoff <= 0) {
      streamBuffersRef.current.set(streamId, buffer)
      return
    }
    const text = pending.slice(0, cutoff)
    const start = buffer.queuedUntil
    buffer.queuedUntil += cutoff
    streamBuffersRef.current.set(streamId, buffer)
    enqueue({ key: `${streamId}:${start}:${buffer.queuedUntil}`, text, messageId: finalMessageId || streamId })
  }, [enqueue])

  const handleAgentStreamDelta = useCallback((payload: any) => {
    enqueueStreamText(payload?.id, payload?.content || '')
  }, [enqueueStreamText])

  const handleAgentStreamCompleted = useCallback((payload: any) => {
    if (!payload?.id || payload?.silent) return
    const finalMessageId = payload.finalMessageId || payload.id
    if (finalMessageId) {
      playedMessageIdsRef.current.add(finalMessageId)
      window.setTimeout(() => playedMessageIdsRef.current.delete(finalMessageId), 30000)
    }
    enqueueStreamText(payload.id, payload.content || '', true, finalMessageId)
    window.setTimeout(() => streamBuffersRef.current.delete(payload.id), 30000)
  }, [enqueueStreamText])

  const handleIncomingMessage = useCallback((msg: any) => {
    const content = msg?.content?.trim()
    const messageId = msg?.finalMessageId || msg?.id
    if (!enabledRef.current || msg?.actorRole !== 'ai' || !content || msg?.kind === 'agent_stream' || msg?.kind === 'agent_receipt') return
    if (messageId && playedMessageIdsRef.current.has(messageId)) return
    if (messageId) {
      playedMessageIdsRef.current.add(messageId)
      window.setTimeout(() => playedMessageIdsRef.current.delete(messageId), 30000)
    }
    enqueue({ key: `message:${messageId || Date.now()}`, text: content, messageId })
  }, [enqueue])

  const interruptVoicePlayback = useCallback(() => {
    queueRef.current = []
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    playingRef.current = false
    setVoicePlaybackBusy(false)
    setVoiceStatus('idle')
  }, [setVoicePlaybackBusy, setVoiceStatus])

  const primeVoicePlayback = useCallback(() => {
    const audio = audioRef.current || new Audio()
    audio.setAttribute('playsinline', 'true')
    audioRef.current = audio
    const previousVolume = audio.volume
    audio.volume = 0
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
    void audio.play().then(() => {
      audio.pause()
      audio.currentTime = 0
      audio.volume = previousVolume || 1
    }).catch(() => {
      audio.volume = previousVolume || 1
    })
  }, [])

  return { primeVoicePlayback, interruptVoicePlayback, handleIncomingMessage, handleAgentStreamDelta, handleAgentStreamCompleted }
}
