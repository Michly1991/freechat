import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BarChart3, LogOut, Shield, UserRound } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import PersonalAnalyticsPanel from '../features/analytics/PersonalAnalyticsPanel'
import { disableBrowserNotifications, enableBrowserNotifications, isBrowserNotificationEnabled } from '../features/notifications/browser-notifications'
import { getNotificationSoundPrefs, playNotificationSound, setNotificationSoundPrefs, unlockNotificationSound } from '../features/notifications/notification-sound'

type SettingsTab = 'account' | 'analytics' | 'notifications' | 'system'

const tabs: Array<{ id: SettingsTab; label: string; icon: any }> = [
  { id: 'account', label: '账号安全', icon: UserRound },
  { id: 'analytics', label: '数据统计', icon: BarChart3 },
  { id: 'notifications', label: '通知', icon: Bell },
  { id: 'system', label: '系统', icon: Shield },
]

function TabButton({ active, icon: Icon, label, onClick }: any) {
  return (
    <button onClick={onClick} className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>
      <Icon className="w-4 h-4" />{label}
    </button>
  )
}

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SettingsTab>('account')
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [msg, setMsg] = useState('')
  const [pwdMsg, setPwdMsg] = useState('')
  const [browserNotify, setBrowserNotify] = useState(isBrowserNotificationEnabled())
  const [soundPrefs, setSoundPrefs] = useState(getNotificationSoundPrefs())

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setMsg('请选择图片文件'); return }
    try {
      setUploadingAvatar(true)
      const result = await api.uploadAvatar(file)
      setAvatar(result.avatar); updateUser(result.user); setMsg('头像上传成功'); setTimeout(() => setMsg(''), 2000)
    } catch (err: any) { setMsg('头像上传失败: ' + err.message) }
    finally { setUploadingAvatar(false); e.target.value = '' }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    try { const result = await api.updateUserProfile({ nickname, avatar }); updateUser(result as any); setMsg('保存成功'); setTimeout(() => setMsg(''), 2000) }
    catch (err: any) { setMsg('保存失败: ' + err.message) }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.changePassword({ old_password: oldPwd, new_password: newPwd }); setPwdMsg('密码修改成功'); setOldPwd(''); setNewPwd(''); setTimeout(() => setPwdMsg(''), 2000) }
    catch (err: any) { setPwdMsg('修改失败: ' + err.message) }
  }

  const toggleBrowserNotify = async () => {
    if (browserNotify) { disableBrowserNotifications(); setBrowserNotify(false); return }
    setBrowserNotify(await enableBrowserNotifications())
  }

  const updateSoundPref = async (next: Partial<typeof soundPrefs>) => {
    await unlockNotificationSound()
    setSoundPrefs(setNotificationSoundPrefs(next))
  }
  const testSound = async () => {
    await unlockNotificationSound()
    await playNotificationSound('mention', 'settings-test', true)
  }

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">← 返回</button>
          <h1 className="text-xl font-bold text-gray-800">个人设置</h1>
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {tabs.map((tab) => <TabButton key={tab.id} active={activeTab === tab.id} icon={tab.icon} label={tab.label} onClick={() => setActiveTab(tab.id)} />)}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6">
        {activeTab === 'account' && (
          <div className="space-y-6">
            <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">基本信息</h2>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="flex items-center gap-4">
                  {avatar ? <img src={avatar} alt="头像" className="w-16 h-16 rounded-full object-cover border border-gray-200" onError={() => setAvatar('')} /> : <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xl font-semibold">{(nickname || user?.username || '?')[0].toUpperCase()}</div>}
                  <div>
                    <label className="inline-flex items-center px-4 py-2 bg-blue-50 text-blue-600 rounded-lg cursor-pointer hover:bg-blue-100 text-sm">
                      {uploadingAvatar ? '上传中...' : '上传头像'}
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
                    </label>
                    <p className="text-xs text-gray-400 mt-1">支持 png / jpg / webp / gif，最大 2MB</p>
                  </div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">用户名</label><input type="text" value={user?.username || ''} disabled className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">昵称</label><input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
                {msg && <p className="text-sm text-blue-600">{msg}</p>}
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">保存修改</button>
              </form>
            </section>
            <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">修改密码</h2>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">当前密码</label><input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">新密码</label><input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required /></div>
                {pwdMsg && <p className="text-sm text-blue-600">{pwdMsg}</p>}
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">更新密码</button>
              </form>
            </section>
          </div>
        )}

        {activeTab === 'analytics' && <PersonalAnalyticsPanel />}

        {activeTab === 'notifications' && (
          <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">通知设置</h2>
            <p className="text-sm text-gray-500 mb-4">强提醒包含 @我、任务分派和 Agent 完成。普通消息默认只计未读，可自行开启轻音效。</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 p-4">
                <div><p className="font-medium text-gray-800">浏览器通知</p><p className="text-xs text-gray-400 mt-1">页面不在前台时，对强提醒弹出系统通知。</p></div>
                <button onClick={toggleBrowserNotify} className={`px-4 py-2 rounded-lg text-sm shrink-0 ${browserNotify ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{browserNotify ? '已开启' : '开启'}</button>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 p-4">
                <div><p className="font-medium text-gray-800">通知音效</p><p className="text-xs text-gray-400 mt-1">总开关。关闭后所有 FreeChat 提醒音静音。</p></div>
                <button onClick={() => updateSoundPref({ soundEnabled: !soundPrefs.soundEnabled })} className={`px-4 py-2 rounded-lg text-sm shrink-0 ${soundPrefs.soundEnabled ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{soundPrefs.soundEnabled ? '已开启' : '开启'}</button>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 p-4">
                <div><p className="font-medium text-gray-800">强提醒音</p><p className="text-xs text-gray-400 mt-1">@我、任务分派、Agent 完成时播放更明显的提示音。</p></div>
                <button onClick={() => updateSoundPref({ strongSoundEnabled: !soundPrefs.strongSoundEnabled })} className={`px-4 py-2 rounded-lg text-sm shrink-0 ${soundPrefs.strongSoundEnabled ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{soundPrefs.strongSoundEnabled ? '已开启' : '关闭'}</button>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 p-4">
                <div><p className="font-medium text-gray-800">普通消息音</p><p className="text-xs text-gray-400 mt-1">当前房间外的新聊天消息播放轻提示音；默认关闭，避免刷屏。</p></div>
                <button onClick={() => updateSoundPref({ messageSoundEnabled: !soundPrefs.messageSoundEnabled })} className={`px-4 py-2 rounded-lg text-sm shrink-0 ${soundPrefs.messageSoundEnabled ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{soundPrefs.messageSoundEnabled ? '已开启' : '关闭'}</button>
              </div>
              <button onClick={testSound} className="text-sm bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200">测试音效</button>
            </div>
          </section>
        )}

        {activeTab === 'system' && (
          <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">系统</h2>
            <p className="text-sm text-gray-500">账号退出、诊断信息和缓存清理后续都放在这里。</p>
            <button onClick={handleLogout} className="inline-flex items-center gap-2 text-red-600 hover:text-red-700 font-medium"><LogOut className="w-4 h-4" />退出登录</button>
          </section>
        )}
      </main>
    </div>
  )
}
