import { useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { api } from '../../lib/api'

export function VoiceRecorderButton({ roomId, onTranscript, label, recordingLabel, disabled, onRecordingChange, onBusyChange }: { roomId?: string; onTranscript: (text: string) => void; label?: string; recordingLabel?: string; disabled?: boolean; onRecordingChange?: (recording: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (!blob.size) return
        setBusy(true)
        onBusyChange?.(true)
        try {
          const form = new FormData()
          if (roomId) form.append('roomId', roomId)
          form.append('audio', blob, `voice-${Date.now()}.webm`)
          const res = await api.transcribeVoice(form)
          onTranscript(res.text)
        } catch (err: any) { alert(err.message || '语音识别失败，请先在设置里配置语音服务') }
        finally { setBusy(false); onBusyChange?.(false) }
      }
      recorder.start()
      setRecording(true)
      onRecordingChange?.(true)
    } catch (err: any) { alert(err.message || '无法访问麦克风') }
  }
  const stop = () => { recorderRef.current?.stop(); recorderRef.current = null; setRecording(false); onRecordingChange?.(false) }
  if (!navigator.mediaDevices?.getUserMedia) return null
  const text = recording ? recordingLabel : label
  return <button type="button" onClick={recording ? stop : start} disabled={busy || disabled} className={`fc-pressable fc-mobile-touch inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${recording ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600'} disabled:opacity-60`} title={recording ? '停止录音' : '语音输入'}>{recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{text && <span>{text}</span>}</button>
}
