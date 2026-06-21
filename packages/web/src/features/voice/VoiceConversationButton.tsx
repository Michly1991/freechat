import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { api } from '../../lib/api'

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, length * 2, true)
  let offset = 44
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1, offset += 2) {
      const sample = Math.max(-1, Math.min(1, chunk[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

interface VoiceConversationButtonProps {
  enabled: boolean
  roomId?: string
  busy?: boolean
  status?: string
  onEnable: () => void
  onDisable: () => void
  onTranscript: (text: string) => void | Promise<void>
  onRecordingChange?: (recording: boolean) => void
  onBusyChange?: (busy: boolean) => void
}

export function VoiceConversationButton({ enabled, roomId, busy, status, onEnable, onDisable, onTranscript, onRecordingChange, onBusyChange }: VoiceConversationButtonProps) {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const enabledRef = useRef(enabled)
  const pausedRef = useRef(false)
  const hasSpeechRef = useRef(false)
  const lastVoiceAtRef = useRef(0)

  useEffect(() => { enabledRef.current = enabled }, [enabled])

  const cleanup = async () => {
    const stream = streamRef.current
    const audioContext = audioContextRef.current
    const processor = processorRef.current
    const source = sourceRef.current
    streamRef.current = null
    audioContextRef.current = null
    processorRef.current = null
    sourceRef.current = null
    chunksRef.current = []
    pausedRef.current = false
    hasSpeechRef.current = false
    setListening(false)
    onRecordingChange?.(false)
    try { processor?.disconnect() } catch {}
    try { source?.disconnect() } catch {}
    stream?.getTracks().forEach((track) => track.stop())
    try { await audioContext?.close() } catch {}
  }

  const finalizeUtterance = async () => {
    if (pausedRef.current || transcribing || !chunksRef.current.length) return
    const chunks = chunksRef.current
    const sampleRate = audioContextRef.current?.sampleRate || 16000
    chunksRef.current = []
    pausedRef.current = true
    hasSpeechRef.current = false
    setTranscribing(true)
    setListening(false)
    onRecordingChange?.(false)
    onBusyChange?.(true)
    try {
      const blob = encodeWav(chunks, sampleRate)
      const form = new FormData()
      if (roomId) form.append('roomId', roomId)
      form.append('format', 'wav')
      form.append('sampleRate', String(sampleRate))
      form.append('audio', blob, `voice-${Date.now()}.wav`)
      const res = await api.transcribeVoice(form)
      if (res.text?.trim()) await onTranscript(res.text)
    } catch (err: any) {
      alert(err.message || '语音识别失败：请检查语音服务配置、浏览器麦克风权限，或稍后重试')
    } finally {
      setTranscribing(false)
      onBusyChange?.(false)
      pausedRef.current = false
      if (enabledRef.current && streamRef.current) {
        setListening(true)
        onRecordingChange?.(true)
      }
    }
  }

  const startListening = async () => {
    if (streamRef.current || transcribing) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) throw new Error('当前浏览器不支持网页录音')
      const audioContext = new AudioContextCtor()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (event) => {
        if (!enabledRef.current || pausedRef.current) return
        const input = event.inputBuffer.getChannelData(0)
        let sum = 0
        for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i]
        const volume = Math.sqrt(sum / input.length)
        const now = Date.now()
        if (volume > 0.012) {
          hasSpeechRef.current = true
          lastVoiceAtRef.current = now
        }
        if (hasSpeechRef.current) chunksRef.current.push(new Float32Array(input))
        if (hasSpeechRef.current && now - lastVoiceAtRef.current >= 2000) void finalizeUtterance()
      }
      source.connect(processor)
      processor.connect(audioContext.destination)
      streamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      processorRef.current = processor
      setListening(true)
      onRecordingChange?.(true)
    } catch (err: any) {
      onDisable()
      alert(err.message || '无法访问麦克风')
    }
  }

  useEffect(() => {
    return () => { void cleanup() }
  }, [])

  useEffect(() => {
    const shouldListen = enabled && (status === 'idle' || status === 'listening')
    if (!shouldListen) {
      void cleanup()
      return
    }
    void startListening()
  }, [enabled, status])

  const canRecord = !!navigator.mediaDevices?.getUserMedia
  const active = enabled || listening || transcribing
  const title = !canRecord ? '当前浏览器无法访问麦克风：请使用 HTTPS 页面或检查微信/浏览器麦克风权限' : active ? '结束语音对话' : '开始语音对话'
  const disabled = !canRecord || (!active && (!!busy || status === 'speaking'))
  return (
    <button
      type="button"
      onClick={() => active ? onDisable() : onEnable()}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={`fc-pressable fc-mobile-touch inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-60 ${active ? 'bg-red-500 text-white shadow-sm shadow-red-500/20' : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600'}`}
    >
      <Mic className="h-4 w-4" />
    </button>
  )
}
