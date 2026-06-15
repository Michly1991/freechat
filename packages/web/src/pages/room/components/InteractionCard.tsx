import type { Message } from '../../room-page-model'

interface InteractionCardProps {
  msg: Message
  roomId?: string
  interactionSelections: Record<string, string[]>
  setInteractionSelections: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  interactionInputs: Record<string, Record<string, string>>
  setInteractionInputs: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>
  submittingInteractions: Record<string, boolean>
  setSubmittingInteractions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  api: any
  feedback: any
}

export function InteractionCard(props: InteractionCardProps) {
  const { msg, roomId, interactionSelections, setInteractionSelections, interactionInputs, setInteractionInputs, submittingInteractions, setSubmittingInteractions, setMessages, api, feedback } = props
  const interaction = msg.payload?.interaction
  if (!interaction) return null
  const selected = interactionSelections[interaction.id] || []
  const inputValues = interactionInputs[interaction.id] || {}
  const isPending = interaction.status === 'pending'
  const isMulti = interaction.type === 'multi_choice'
  const taskPlan = interaction.type === 'task_plan' ? interaction.payload?.taskPlan : null
  const isSubmitting = !!submittingInteractions[interaction.id]
  const canChange = interaction.status === 'resolved' && interaction.responsePolicy?.allowChange && !interaction.consumedAt
  const tone = interaction.priority === 'danger' ? 'red' : interaction.priority === 'important' ? 'amber' : interaction.type === 'multi_choice' ? 'purple' : 'blue'
  const toneClasses = isPending || canChange ? (tone === 'red' ? 'border-red-200 bg-red-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : tone === 'purple' ? 'border-purple-200 bg-purple-50' : 'border-blue-200 bg-blue-50') : 'border-gray-200 bg-gray-50'
  const iconClasses = (isPending || canChange) ? (tone === 'red' ? 'bg-red-600 text-white' : tone === 'amber' ? 'bg-amber-500 text-white' : tone === 'purple' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white') : 'bg-green-500 text-white'

  const setInputValue = (optionValue: string, text: string) => {
    setInteractionInputs((prev) => ({ ...prev, [interaction.id]: { ...(prev[interaction.id] || {}), [optionValue]: text } }))
  }

  const validateInputs = (values: string[]) => {
    for (const value of values) {
      const opt = interaction.options?.find((item: any) => item.value === value)
      if (!opt?.input?.enabled) continue
      const text = String(inputValues[value] || '').trim()
      if (opt.input.required && !text) { feedback.warning(`请补充：${opt.label}`); return false }
      if (opt.input.maxLength && text.length > opt.input.maxLength) { feedback.warning(`${opt.label} 的补充内容过长`); return false }
    }
    return true
  }

  const respond = async (value: string | string[]) => {
    if (!roomId || (!isPending && !canChange) || isSubmitting) return
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0 || !validateInputs(values)) return
    const inputs = Object.fromEntries(values.filter((v) => String(inputValues[v] || '').trim()).map((v) => [v, String(inputValues[v]).trim()]))
    try {
      setSubmittingInteractions((prev) => ({ ...prev, [interaction.id]: true }))
      const res = await api.respondInteraction(roomId, interaction.id, value, inputs)
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, payload: { ...(m.payload || {}), interaction: res.interaction } } : m)))
      feedback.success('已提交选择')
    } catch (err: any) {
      feedback.error(err?.message || '提交失败')
    } finally {
      setSubmittingInteractions((prev) => ({ ...prev, [interaction.id]: false }))
    }
  }

  const toggle = (value: string) => {
    setInteractionSelections((prev) => {
      const cur = prev[interaction.id] || []
      return { ...prev, [interaction.id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
    })
  }

  const selectSingle = (value: string) => setInteractionSelections((prev) => ({ ...prev, [interaction.id]: [value] }))

  const renderOptionInput = (opt: any) => {
    if (!opt.input?.enabled) return null
    const commonProps = {
      value: inputValues[opt.value] || '',
      onChange: (e: any) => setInputValue(opt.value, e.target.value),
      placeholder: opt.input.placeholder || '请补充说明',
      maxLength: opt.input.maxLength,
      className: 'mt-2 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500',
    }
    return opt.input.multiline ? <textarea {...commonProps} rows={3} /> : <input {...commonProps} />
  }

  return (
    <div id={`interaction-${interaction.id}`} className={`fc-enter fc-card-hover min-w-0 max-w-full sm:max-w-[680px] overflow-hidden rounded-2xl border p-4 shadow-sm ${toneClasses}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold ${iconClasses}`}>{interaction.status === 'resolved' && !canChange ? '✓' : interaction.priority === 'danger' ? '!' : interaction.type === 'task_plan' ? '计' : interaction.type === 'multi_choice' ? '☑' : '?'}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h4 className="font-semibold text-gray-800 break-words [overflow-wrap:anywhere]">{interaction.title}</h4><span className={`text-[10px] px-2 py-0.5 rounded-full ${isPending ? 'bg-white/70 text-gray-700' : canChange ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'}`}>{isSubmitting ? '提交中' : isPending ? '待处理' : canChange ? '可修改' : '已处理'}</span></div>
          {interaction.description && <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{interaction.description}</p>}
          {taskPlan && <TaskPlanPreview taskPlan={taskPlan} />}
          {(isPending || canChange) ? (isMulti ? (
            <div className="mt-3 space-y-2">
              {interaction.options?.map((opt: any) => <div key={opt.value} className="rounded-xl bg-white px-3 py-2 text-sm text-gray-700 border border-blue-100"><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} /><span>{opt.label}</span>{opt.input?.required && <span className="text-red-400">*</span>}</label>{selected.includes(opt.value) && renderOptionInput(opt)}</div>)}
              <button onClick={() => respond(selected)} disabled={selected.length === 0 || isSubmitting} className="fc-pressable w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50">{isSubmitting ? '提交中...' : canChange ? '修改选择' : '提交选择'}</button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {interaction.options?.map((opt: any) => {
                const active = selected[0] === opt.value
                return <div key={opt.value} className={`fc-pressable rounded-xl border px-3 py-2 ${active ? 'border-blue-300 bg-white shadow-sm' : 'border-blue-100 bg-white/80 hover:bg-white'}`}><button disabled={isSubmitting} onClick={() => opt.input?.enabled ? selectSingle(opt.value) : respond(opt.value)} className="flex w-full items-center justify-between text-left text-sm font-medium text-gray-700 disabled:opacity-60"><span>{opt.label} {opt.input?.required && <span className="text-red-400">*</span>}</span><span className={`h-4 w-4 rounded-full border ${active ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}></span></button>{active && renderOptionInput(opt)}</div>
              })}
              {selected[0] && interaction.options?.find((opt: any) => opt.value === selected[0])?.input?.enabled && <button disabled={isSubmitting} onClick={() => respond(selected[0])} className="fc-pressable w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50">{isSubmitting ? '提交中...' : canChange ? '修改选择' : '提交选择'}</button>}
            </div>
          )) : <InteractionResult interaction={interaction} />}
        </div>
      </div>
    </div>
  )
}

function normalizeDependsOn(value: any): number[] {
  if (value === undefined || value === null || value === '') return []
  return (Array.isArray(value) ? value : [value]).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0)
}

function TaskPlanPreview({ taskPlan }: { taskPlan: any }) {
  const items = taskPlan.items || []
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-amber-100 bg-white/90 text-sm text-gray-700 shadow-sm">
      <div className="border-b border-amber-100 bg-amber-50/80 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">待确认任务计划</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-amber-700">确认后创建 {items.length} 个子任务</span>
        </div>
        <div className="mt-2 font-semibold text-gray-900 break-words [overflow-wrap:anywhere]">父任务：{taskPlan.title}</div>
        {taskPlan.description && <div className="mt-1 text-xs leading-relaxed text-gray-600 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{taskPlan.description}</div>}
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500"><span>优先级：{taskPlan.priority || 'medium'}</span><span>状态：等待用户确认</span></div>
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-gray-500"><span>子任务列表</span><span>{items.length} 项</span></div>
        <div className="space-y-2">
          {items.map((item: any, index: number) => {
            const deps = normalizeDependsOn(item.dependsOn)
            return (
              <div key={index} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div className="font-medium leading-5 text-gray-800 break-words">{item.title}</div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {item.assignee && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">处理人：{item.assignee}</span>}
                        <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] text-gray-500">确认后创建</span>
                      </div>
                    </div>
                    {item.description && <div className="mt-1 text-xs leading-relaxed text-gray-500 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.description}</div>}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      {deps.length > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">依赖步骤：{deps.map((dep) => dep + 1).join('、')}</span>}
                      {item.expectedOutput && <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700 break-words [overflow-wrap:anywhere]">产出：{item.expectedOutput}</span>}
                      {item.acceptanceCriteria && <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700 break-words [overflow-wrap:anywhere]">验收：{item.acceptanceCriteria}</span>}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function InteractionResult({ interaction }: { interaction: any }) {
  return <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-gray-600 space-y-1 break-words [overflow-wrap:anywhere]"><div>结果：{Array.isArray(interaction.result?.labels) ? interaction.result.labels.join('、') : interaction.result?.value || interaction.status}</div>{interaction.result?.inputs && Object.keys(interaction.result.inputs).length > 0 && <div className="text-xs text-gray-500">{Object.entries(interaction.result.inputs).map(([key, text]: any) => { const label = interaction.options?.find((opt: any) => opt.value === key)?.label || key; return <div key={key}>{label}：{text}</div> })}</div>}</div>
}
