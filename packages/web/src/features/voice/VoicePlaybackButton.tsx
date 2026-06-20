import { useState } from 'react'
import { Volume2 } from 'lucide-react'
import { api } from '../../lib/api'

export function VoicePlaybackButton({ text, roomId, messageId, own }: { text: string; roomId?: string; messageId?: string; own?: boolean }) {
  const [busy, setBusy] = useState(false)
  const play = async () => {
    if (!text.trim()) return
    try {
      setBusy(true)
      const res = await api.synthesizeVoice({ text, roomId, messageId, format: 'mp3' })
      await new Audio(res.audioUrl).play()
    } catch (err: any) { alert(err.message || '语音合成失败，请先在设置里配置语音服务') }
    finally { setBusy(false) }
  }
  return <button type="button" onClick={play} disabled={busy} className={`fc-pressable shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${own ? 'text-blue-100 hover:bg-blue-500/30' : 'text-gray-400 hover:bg-gray-100 hover:text-blue-500'}`} title="语音播放"><Volume2 className="h-3 w-3" /><span className="hidden sm:inline">{busy ? '合成中' : '播放'}</span></button>
}
