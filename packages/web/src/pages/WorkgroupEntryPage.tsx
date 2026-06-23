import { useEffect, useState } from 'react'
import { ArrowLeft, Bot, CreditCard, LogIn } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'

export default function WorkgroupEntryPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [entry, setEntry] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { void load() }, [token])
  async function load() {
    if (!token) return
    setLoading(true)
    try { const data = await api.getWorkgroupEntry(token); setEntry(data.entry) }
    catch (err: any) { setMessage(err.message || '分享入口不可用') }
    finally { setLoading(false) }
  }
  async function join() {
    if (!token) return
    setJoining(true)
    try { const data = await api.joinWorkgroupEntry(token); navigate(`/room/${data.room.id}`, { replace: true }) }
    catch (err: any) { setMessage(err.message || '进入失败') }
    finally { setJoining(false) }
  }

  return <div className="min-h-screen bg-gray-50 px-4 py-6">
    <main className="mx-auto max-w-xl space-y-4">
      <button onClick={() => navigate('/')} className="flex items-center gap-2 text-sm text-gray-500"><ArrowLeft className="h-4 w-4" />返回首页</button>
      <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        {loading ? <p className="text-sm text-gray-400">加载中...</p> : entry ? <div className="space-y-4">
          <div className="flex items-start gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Bot className="h-6 w-6" /></span><div><h1 className="text-xl font-semibold text-gray-900">{entry.title}</h1><p className="mt-1 text-sm text-gray-500">{entry.description || '通过工作组分享入口开始对话'}</p></div></div>
          <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600"><p>工作组：{entry.workgroupName || '-'}</p><p className="mt-1">接待 Agent：{entry.agentName || '-'}</p>{entry.agentDescription && <p className="mt-2 text-gray-500">{entry.agentDescription}</p>}</div>
          {entry.welcomeMessage && <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-700">{entry.welcomeMessage}</div>}
          <div className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800"><CreditCard className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">费用由你自己承担</p><p className="mt-1 text-xs leading-5 text-amber-700">通过该链接进入后，会为你创建独立对话；你使用此 Agent 产生的模型费和 Agent 服务费将从你的 FreeChat 余额扣除，分享者不会替你付费。</p></div></div>
          {message && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{message}</div>}
          <button onClick={join} disabled={joining} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-60"><LogIn className="h-4 w-4" />{joining ? '正在进入...' : '开始对话'}</button>
          <p className="text-center text-xs text-gray-400">当前版本需要登录后使用分享入口。</p>
        </div> : <p className="text-sm text-red-500">{message || '分享入口不可用'}</p>}
      </section>
    </main>
  </div>
}
