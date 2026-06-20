import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

type VoiceConfig = { id: string; provider: string; name: string; asrEnabled: boolean; ttsEnabled: boolean; isDefaultAsr: boolean; isDefaultTts: boolean; credentialStatus: string; config: any }

export function VoiceSettingsPanel() {
  const [configs, setConfigs] = useState<VoiceConfig[]>([])
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({ name: '我的火山语音', token: '', appId: '', asrCluster: 'volcengine_input_common', ttsCluster: 'volcano_tts', defaultVoice: 'zh_female_tianmeisongv2_moon_bigtts', asrUrl: '', ttsUrl: '' })
  const load = async () => { const res = await api.getVoiceConfigs(); setConfigs(res.configs || []) }
  useEffect(() => { void load() }, [])
  const save = async () => {
    try {
      setMsg('保存中...')
      await api.createVoiceConfig({ provider: 'volcengine', name: form.name, asrEnabled: true, ttsEnabled: true, isDefaultAsr: true, isDefaultTts: true, credential: { token: form.token, appId: form.appId, asrCluster: form.asrCluster, ttsCluster: form.ttsCluster }, config: { defaultVoice: form.defaultVoice, asrUrl: form.asrUrl || undefined, ttsUrl: form.ttsUrl || undefined } })
      setForm((f) => ({ ...f, token: '' }))
      setMsg('语音服务配置已保存')
      await load()
    } catch (err: any) { setMsg('保存失败：' + err.message) }
  }
  const remove = async (id: string) => { if (!confirm('删除这个语音配置？')) return; await api.deleteVoiceConfig(id); await load() }
  const test = async (id: string) => { try { const res = await api.testVoiceConfig(id); setMsg(`配置可用：${res.provider} / ${res.credentialStatus}`) } catch (err: any) { setMsg('测试失败：' + err.message) } }
  return <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm border border-gray-100 space-y-5">
    <div><h2 className="text-lg font-semibold text-gray-800">语音服务</h2><p className="text-sm text-gray-500 mt-1">语音识别和合成采用个人 BYOK：谁使用语音，谁配置自己的火山 Key 并由自己的账号付费。</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm"><span className="text-gray-600">配置名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">App ID</span><input value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm sm:col-span-2"><span className="text-gray-600">Token / Secret</span><input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="保存后不回显" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">ASR Cluster</span><input value={form.asrCluster} onChange={(e) => setForm({ ...form, asrCluster: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">TTS Cluster</span><input value={form.ttsCluster} onChange={(e) => setForm({ ...form, ttsCluster: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">默认音色</span><input value={form.defaultVoice} onChange={(e) => setForm({ ...form, defaultVoice: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <div className="text-xs text-gray-400 flex items-end">如你的火山产品线端点不同，可在下面覆盖 URL。</div>
      <label className="text-sm"><span className="text-gray-600">ASR URL（可选）</span><input value={form.asrUrl} onChange={(e) => setForm({ ...form, asrUrl: e.target.value })} placeholder="默认 OpenSpeech ASR" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">TTS URL（可选）</span><input value={form.ttsUrl} onChange={(e) => setForm({ ...form, ttsUrl: e.target.value })} placeholder="默认 OpenSpeech TTS" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
    </div>
    <button onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">保存为默认语音服务</button>{msg && <p className="text-sm text-blue-600">{msg}</p>}
    <div className="space-y-2">{configs.map((cfg) => <div key={cfg.id} className="rounded-xl border border-gray-100 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-gray-800">{cfg.name} <span className="text-xs text-gray-400">{cfg.provider}</span></p><p className="text-xs text-gray-500">Key：{cfg.credentialStatus === 'configured' ? '已配置' : '未配置'} · ASR {cfg.asrEnabled ? '开' : '关'} · TTS {cfg.ttsEnabled ? '开' : '关'} · 默认识别 {cfg.isDefaultAsr ? '是' : '否'} · 默认合成 {cfg.isDefaultTts ? '是' : '否'}</p></div><div className="flex gap-2"><button onClick={() => test(cfg.id)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700">测试</button><button onClick={() => remove(cfg.id)} className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">删除</button></div></div>)}{configs.length === 0 && <p className="text-sm text-gray-400">还没有语音服务配置。</p>}</div>
  </section>
}
