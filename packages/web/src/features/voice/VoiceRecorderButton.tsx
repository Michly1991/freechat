import { useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
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

export function VoiceRecorderButton({ roomId, onTranscript, label, recordingLabel, disabled, onRecordingChange, onBusyChange }: { roomId?: string; onTranscript: (text: string) => void; label?: string; recordingLabel?: string; disabled?: boolean; onRecordingChange?: (recording: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) throw new Error('当前浏览器不支持网页录音')
      const audioContext = new AudioContextCtor()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      chunksRef.current = []
      processor.onaudioprocess = (event) => {
        if (!recording && !streamRef.current) return
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(audioContext.destination)
      streamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      processorRef.current = processor
      setRecording(true)
      onRecordingChange?.(true)
    } catch (err: any) { alert(err.message || '无法访问麦克风') }
  }
  const stop = async () => {
    const stream = streamRef.current
    const audioContext = audioContextRef.current
    const processor = processorRef.current
    const source = sourceRef.current
    streamRef.current = null
    audioContextRef.current = null
    processorRef.current = null
    sourceRef.current = null
    setRecording(false)
    onRecordingChange?.(false)
    try { processor?.disconnect() } catch {}
    try { source?.disconnect() } catch {}
    stream?.getTracks().forEach((track) => track.stop())
    const sampleRate = audioContext?.sampleRate || 16000
    try { await audioContext?.close() } catch {}
    if (!chunksRef.current.length) return
    setBusy(true)
    onBusyChange?.(true)
    try {
      const blob = encodeWav(chunksRef.current, sampleRate)
      const form = new FormData()
      if (roomId) form.append('roomId', roomId)
      form.append('format', 'wav')
      form.append('sampleRate', String(sampleRate))
      form.append('audio', blob, `voice-${Date.now()}.wav`)
      const res = await api.transcribeVoice(form)
      onTranscript(res.text)
    } catch (err: any) { alert(err.message || '语音识别失败：请检查语音服务配置、浏览器麦克风权限，或稍后重试') }
    finally { setBusy(false); onBusyChange?.(false); chunksRef.current = [] }
  }
  const text = recording ? recordingLabel : label
  const canRecord = !!navigator.mediaDevices?.getUserMedia
  if (!canRecord) return <button type="button" disabled className="fc-pressable fc-mobile-touch inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-gray-100 text-gray-400 disabled:opacity-80" title="当前浏览器无法访问麦克风：请使用 HTTPS 页面或检查微信/浏览器麦克风权限"><Mic className="h-4 w-4" />{text && <span>{text}</span>}</button>
  return <button type="button" onClick={recording ? stop : start} disabled={busy || disabled} className={`fc-pressable fc-mobile-touch inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${recording ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600'} disabled:opacity-60`} title={recording ? '停止录音' : '语音输入'}>{recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{text && <span>{text}</span>}</button>
}
