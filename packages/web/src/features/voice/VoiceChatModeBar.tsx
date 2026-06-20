import { Bot, Volume2, VolumeX, X } from 'lucide-react'
import { VoiceRecorderButton } from './VoiceRecorderButton'

export function VoiceChatModeBar({ enabled, autoSend, autoPlay, busy, roomId, onEnable, onDisable, onAutoSendChange, onAutoPlayChange, onTranscript }: any) {
  if (!enabled) {
    return <div className="mx-3 mb-2 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-3 py-2 text-sm text-blue-800 flex flex-wrap items-center justify-between gap-2">
      <div><p className="font-medium">语音对话</p><p className="text-xs text-blue-600/80">你的语音转文字发给大模型，大模型文字回复再转语音播放。</p></div>
      <button type="button" onClick={onEnable} className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"><Bot className="w-3.5 h-3.5" />开启语音对话</button>
    </div>
  }

  return <div className="mx-3 mb-2 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-cyan-50 px-3 py-2 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-2">
    <div className="min-w-0"><p className="font-medium">语音对话已开启</p><p className="text-xs text-emerald-700/80">点击“开始说话”，识别后{autoSend ? '自动发送给大模型' : '填入输入框由你确认'}；AI 回复{autoPlay ? '自动播放' : '可手动播放'}。</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <VoiceRecorderButton roomId={roomId} onTranscript={onTranscript} label="开始说话" recordingLabel="停止说话" disabled={busy} />
      <label className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200"><input type="checkbox" checked={autoSend} onChange={(e) => onAutoSendChange(e.target.checked)} />自动发送</label>
      <button type="button" onClick={() => onAutoPlayChange(!autoPlay)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 hover:bg-gray-50">{autoPlay ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}{autoPlay ? '自动播放' : '不自动播放'}</button>
      <button type="button" onClick={onDisable} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 hover:bg-gray-50"><X className="w-3.5 h-3.5" />关闭</button>
    </div>
  </div>
}
