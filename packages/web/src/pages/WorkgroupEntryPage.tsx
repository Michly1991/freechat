import { useEffect, useState } from 'react'
import { ArrowLeft, Bot, CreditCard, LogIn, ShieldCheck, Sparkles } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'

export default function WorkgroupEntryPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [entry, setEntry] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [message, setMessage] = useState('')

  const ref = new URLSearchParams(window.location.search).get('ref') || undefined

  useEffect(() => { void load() }, [token])
  async function load() {
    if (!token) return
    setLoading(true)
    try { const data = await api.getWorkgroupEntry(token, ref); setEntry(data.entry); setMessage('') }
    catch (err: any) { setMessage(err.message || '分享入口不可用') }
    finally { setLoading(false) }
  }
  async function join() {
    if (!token) return
    setJoining(true)
    try { const data = await api.joinWorkgroupEntry(token, ref); navigate(`/room/${data.room.id}`, { replace: true }) }
    catch (err: any) { setMessage(err.message || '进入失败') }
    finally { setJoining(false) }
  }

  return <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 px-4 py-6">
    <main className="mx-auto max-w-2xl space-y-4">
      <button onClick={() => navigate('/')} className="flex items-center gap-2 text-sm text-gray-500"><ArrowLeft className="h-4 w-4" />返回首页</button>
      <section className="overflow-hidden rounded-[2rem] border border-white bg-white/90 shadow-xl shadow-blue-100/60 backdrop-blur">
        {loading ? <div className="p-8 text-sm text-gray-400">加载中...</div> : entry ? <div>
          <div className="bg-gradient-to-r from-blue-600 to-emerald-500 px-6 py-8 text-white"><div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs"><Sparkles className="h-3.5 w-3.5" />工作组分享入口</div><h1 className="mt-4 text-2xl font-semibold">{entry.title}</h1><p className="mt-2 text-sm leading-6 text-blue-50">{entry.description || '通过该入口创建你的独立对话，并使用绑定的 Agent 处理你的需求。'}</p></div>
          <div className="space-y-4 p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2"><InfoCard label="工作组" value={entry.workgroupName || '-'} /><InfoCard label="接待 Agent" value={entry.agentName || '-'} /></div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Bot className="h-5 w-5" /></span><div><p className="font-medium text-gray-800">{entry.agentName || 'Agent'} 会处理你的对话</p><p className="mt-1 text-sm leading-6 text-gray-500">{entry.agentDescription || '进入后会为你单独创建一个房间，你发出的消息会直接交给该 Agent 处理，不需要额外 @。'}</p></div></div></div>
            {entry.welcomeMessage && <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-700"><p className="mb-1 font-medium text-blue-800">欢迎语</p>{entry.welcomeMessage}</div>}
            <div className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800"><CreditCard className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">费用由你自己承担</p><p className="mt-1 text-xs leading-5 text-amber-700">通过该链接进入后，会为你创建独立对话；你使用此 Agent 产生的模型费和 Agent 服务费将从你的 FreeChat 余额扣除，分享者不会替你付费。</p></div></div>
            <div className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>链接公开可访问，但需要登录。每个用户进入后都是自己的会话，聊天记录和账单相互独立。</p></div>
            {message && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{message}</div>}
            <button onClick={join} disabled={joining} className="fc-pressable flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-medium text-white shadow-lg shadow-blue-100 disabled:opacity-60"><LogIn className="h-4 w-4" />{joining ? '正在创建你的对话...' : '开始我的对话'}</button>
            <p className="text-center text-xs text-gray-400">如果余额不足，系统会提示你先充值 credit。</p>
          </div>
        </div> : <div className="p-8"><p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">{message || '分享入口不可用：链接不存在、已停用、已过期或使用次数已满。'}</p></div>}
      </section>
    </main>
  </div>
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-gray-100 bg-white p-4"><p className="text-xs text-gray-400">{label}</p><p className="mt-1 truncate text-sm font-medium text-gray-800">{value}</p></div>
}
