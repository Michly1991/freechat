import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'

export default function WorkgroupEntryPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const joiningRef = useRef(false)
  const [message, setMessage] = useState('')

  const ref = new URLSearchParams(window.location.search).get('ref') || undefined

  useEffect(() => { void join() }, [token])
  async function join() {
    if (!token || joiningRef.current) return
    joiningRef.current = true
    setLoading(true)
    try { const data = await api.joinWorkgroupEntry(token, ref); navigate(`/room/${data.room.id}`, { replace: true }) }
    catch (err: any) { setMessage(err.message || '进入失败') }
    finally { setLoading(false); joiningRef.current = false }
  }

  return <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-emerald-50 px-4">
    <div className="w-full max-w-sm rounded-3xl border border-white bg-white/90 p-6 text-center shadow-xl shadow-blue-100/60 backdrop-blur">
      {!message ? <><Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" /><h1 className="mt-4 text-lg font-semibold text-gray-900">正在进入对话...</h1><p className="mt-2 text-sm text-gray-500">已登录用户会直接进入聊天界面。</p></> : <><h1 className="text-lg font-semibold text-gray-900">分享入口不可用</h1><p className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">{message}</p><button onClick={() => navigate('/')} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">返回首页</button></>}
    </div>
  </div>
}
