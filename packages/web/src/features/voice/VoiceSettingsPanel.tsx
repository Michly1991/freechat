import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

type VoiceConfig = { id: string; provider: string; name: string; asrEnabled: boolean; ttsEnabled: boolean; isDefaultAsr: boolean; isDefaultTts: boolean; credentialStatus: string; credentialMeta?: any; config: any }
const emptyForm = { name: '我的火山语音', token: '', appId: '', asrCluster: 'volcengine_input_common', ttsCluster: 'volcano_tts', defaultVoice: 'zh_female_tianmeisongv2_moon_bigtts', asrUrl: '', ttsUrl: '' }

export function VoiceSettingsPanel() {
  const [configs, setConfigs] = useState<VoiceConfig[]>([])
  const [msg, setMsg] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const load = async () => { const res = await api.getVoiceConfigs(); setConfigs(res.configs || []); if (!(res.configs || []).length) setShowForm(true) }
  useEffect(() => { void load() }, [])
  const beginCreate = () => { setEditingId(null); setForm(emptyForm); setShowForm(true); setMsg('') }
  const beginEdit = (cfg: VoiceConfig) => {
    setEditingId(cfg.id)
    setForm({ ...emptyForm, name: cfg.name || emptyForm.name, asrCluster: cfg.credentialMeta?.asrCluster || emptyForm.asrCluster, ttsCluster: cfg.credentialMeta?.ttsCluster || emptyForm.ttsCluster, defaultVoice: cfg.config?.defaultVoice || emptyForm.defaultVoice, asrUrl: cfg.config?.asrUrl || '', ttsUrl: cfg.config?.ttsUrl || '' })
    setShowForm(true)
    setMsg('修改模式：App ID / Token 留空表示不更改已保存凭证')
  }
  const credentialPayload = () => {
    const credential: any = {}
    if (form.token.trim()) credential.token = form.token.trim()
    if (form.appId.trim()) credential.appId = form.appId.trim()
    if (form.asrCluster.trim()) credential.asrCluster = form.asrCluster.trim()
    if (form.ttsCluster.trim()) credential.ttsCluster = form.ttsCluster.trim()
    return credential
  }
  const save = async () => {
    try {
      setMsg(editingId ? '保存修改中...' : '保存并测试中...')
      const body = { provider: 'volcengine', name: form.name, asrEnabled: true, ttsEnabled: true, isDefaultAsr: true, isDefaultTts: true, credential: credentialPayload(), config: { defaultVoice: form.defaultVoice, asrUrl: form.asrUrl || undefined, ttsUrl: form.ttsUrl || undefined } }
      const res = editingId ? await api.updateVoiceConfig(editingId, body) : await api.createVoiceConfig(body)
      setForm((f) => ({ ...f, token: '', appId: '' }))
      await load()
      await test(res.config.id, editingId ? '保存成功，正在测试语音合成...' : '配置已保存，正在测试语音合成...')
      setShowForm(false)
      setEditingId(null)
    } catch (err: any) { setMsg('保存失败：' + err.message) }
  }
  const remove = async (id: string) => { if (!confirm('删除这个语音配置？')) return; await api.deleteVoiceConfig(id); await load() }
  const test = async (id: string, prefix = '正在测试语音合成...') => {
    try {
      setMsg(prefix)
      const res = await api.synthesizeVoice({ providerConfigId: id, text: '语音服务测试', format: 'mp3' })
      await new Audio(res.audioUrl).play()
      setMsg(`语音合成测试成功：${res.provider}`)
    } catch (err: any) { setMsg('测试失败：' + err.message) }
  }
  return <section className="bg-white rounded-xl p-5 sm:p-6 shadow-sm border border-gray-100 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-800">语音服务</h2><p className="text-sm text-gray-500 mt-1">语音识别和合成采用个人 BYOK：谁使用语音，谁配置自己的火山 Key 并由自己的账号付费。</p></div>{configs.length > 0 && !showForm && <button onClick={beginCreate} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">新增配置</button>}</div>
    {showForm && <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium text-gray-800">{editingId ? '修改语音配置' : '首次配置语音服务'}</h3>{configs.length > 0 && <button onClick={() => { setShowForm(false); setEditingId(null) }} className="text-sm text-gray-500 hover:text-gray-700">取消</button>}</div><p className="text-xs text-gray-500">保存后不会回显 App ID / Token；修改时留空表示不覆盖已保存凭证。</p><div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm"><span className="text-gray-600">配置名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">App ID</span><input value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} placeholder={editingId ? '已保存；不修改请留空' : ''} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm sm:col-span-2"><span className="text-gray-600">Token / Secret</span><input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder={editingId ? '已保存；不修改请留空' : '保存后不回显'} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">ASR Cluster</span><input value={form.asrCluster} onChange={(e) => setForm({ ...form, asrCluster: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">TTS Cluster</span><input value={form.ttsCluster} onChange={(e) => setForm({ ...form, ttsCluster: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">默认音色</span><input value={form.defaultVoice} onChange={(e) => setForm({ ...form, defaultVoice: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <div className="text-xs text-gray-400 flex items-end">如你的火山产品线端点不同，可在下面覆盖 URL。</div>
      <label className="text-sm"><span className="text-gray-600">ASR URL（可选）</span><input value={form.asrUrl} onChange={(e) => setForm({ ...form, asrUrl: e.target.value })} placeholder="默认 OpenSpeech ASR" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label className="text-sm"><span className="text-gray-600">TTS URL（可选）</span><input value={form.ttsUrl} onChange={(e) => setForm({ ...form, ttsUrl: e.target.value })} placeholder="默认 OpenSpeech TTS" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
    </div><button onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">{editingId ? '保存修改并测试' : '保存并测试'}</button></div>}
    {msg && <p className="text-sm text-blue-600">{msg}</p>}
    <div className="space-y-2">{configs.map((cfg) => <div key={cfg.id} className="rounded-xl border border-gray-100 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-gray-800">{cfg.name} <span className="text-xs text-gray-400">{cfg.provider}</span></p><p className="text-xs text-gray-500">Key：{cfg.credentialStatus === 'configured' ? '已配置' : '未配置'}{cfg.credentialMeta?.appIdMasked ? ` · App ${cfg.credentialMeta.appIdMasked}` : ''} · ASR {cfg.asrEnabled ? '开' : '关'} · TTS {cfg.ttsEnabled ? '开' : '关'} · 默认识别 {cfg.isDefaultAsr ? '是' : '否'} · 默认合成 {cfg.isDefaultTts ? '是' : '否'}</p></div><div className="flex gap-2"><button onClick={() => test(cfg.id)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700">测试</button><button onClick={() => beginEdit(cfg)} className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-blue-600">修改</button><button onClick={() => remove(cfg.id)} className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">删除</button></div></div>)}{configs.length === 0 && !showForm && <p className="text-sm text-gray-400">还没有语音服务配置。</p>}</div>
  </section>
}
