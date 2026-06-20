import { Mic, MicOff, PhoneCall, PhoneOff, X } from 'lucide-react'

function myParticipant(session: any, userId?: string) {
  return session?.participants?.find((p: any) => p.userId === userId)
}

export function RoomVoiceSessionBar({ session, user, busy, onStart, onAnswer, onDecline, onLeave, onToggleMute }: any) {
  const me = myParticipant(session, user?.id)
  const joined = me?.status === 'joined'
  const invited = !!session && !joined && me?.status !== 'declined' && session.status !== 'ended'
  const joinedCount = session?.participants?.filter((p: any) => p.status === 'joined').length || 0
  const muted = !!me?.muted

  if (!session) {
    return <div className="mx-3 mb-2 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-3 py-2 text-sm text-blue-800 flex flex-wrap items-center justify-between gap-2">
      <div><p className="font-medium">房间语音对话</p><p className="text-xs text-blue-600/80">开启后成员可接听；语音识别和播放仍使用各自的 BYOK 配置。</p></div>
      <button disabled={busy} onClick={onStart} className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"><PhoneCall className="w-3.5 h-3.5" />开启语音对话</button>
    </div>
  }

  return <div className="mx-3 mb-2 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-cyan-50 px-3 py-2 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-2">
    <div className="min-w-0"><p className="font-medium truncate">{session.createdByName || '有人'} 发起了语音对话 · {session.status === 'ringing' ? '等待接听' : '进行中'} · {joinedCount} 人在线</p><p className="text-xs text-emerald-700/80 truncate">{(session.participants || []).filter((p: any) => p.status === 'joined').map((p: any) => `${p.name}${p.muted ? '（静音）' : ''}`).join('、') || '暂无成员接听'}</p></div>
    <div className="flex flex-wrap items-center gap-2">
      {invited && <><button disabled={busy} onClick={onAnswer} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"><PhoneCall className="w-3.5 h-3.5" />接听</button><button disabled={busy} onClick={onDecline} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-60"><X className="w-3.5 h-3.5" />拒绝</button></>}
      {joined && <><button disabled={busy} onClick={() => onToggleMute(!muted)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-60">{muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}{muted ? '取消静音' : '静音'}</button><button disabled={busy} onClick={onLeave} className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"><PhoneOff className="w-3.5 h-3.5" />挂断</button></>}
      {!joined && !invited && <span className="text-xs text-gray-500">你已拒绝，可等待下次发起</span>}
    </div>
  </div>
}
