import { useNavigate } from 'react-router-dom'
import { PersonalSettingsTabs } from '../features/settings/PersonalSettingsTabs'

export default function SettingsPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">← 返回</button>
          <h1 className="text-xl font-bold text-gray-800">个人设置</h1>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <PersonalSettingsTabs onLogout={() => navigate('/login')} />
      </main>
    </div>
  )
}
