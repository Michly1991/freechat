import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [msg, setMsg] = useState('')
  const [pwdMsg, setPwdMsg] = useState('')

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await api.updateProfile({ nickname })
      updateUser(result)
      setMsg('保存成功')
      setTimeout(() => setMsg(''), 2000)
    } catch (err: any) {
      setMsg('保存失败: ' + err.message)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.changePassword({ old_password: oldPwd, new_password: newPwd })
      setPwdMsg('密码修改成功')
      setOldPwd('')
      setNewPwd('')
      setTimeout(() => setPwdMsg(''), 2000)
    } catch (err: any) {
      setPwdMsg('修改失败: ' + err.message)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">
            ← 返回
          </button>
          <h1 className="text-xl font-bold text-gray-800">个人设置</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <section className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">基本信息</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={user?.username || ''}
                disabled
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">昵称</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {msg && <p className="text-sm text-blue-600">{msg}</p>}
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              保存修改
            </button>
          </form>
        </section>

        <section className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">修改密码</h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">当前密码</label>
              <input
                type="password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
            </div>
            {pwdMsg && <p className="text-sm text-blue-600">{pwdMsg}</p>}
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              更新密码
            </button>
          </form>
        </section>

        <section className="bg-white rounded-xl p-6 shadow-sm">
          <button
            onClick={handleLogout}
            className="text-red-600 hover:text-red-700 font-medium"
          >
            退出登录
          </button>
        </section>
      </main>
    </div>
  )
}
