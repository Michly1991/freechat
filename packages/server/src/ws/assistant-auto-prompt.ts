import { renderRoleCapabilitiesForAutoPrompt } from '../services/agent-role-capabilities.js'
export function shouldConsiderAssistantAutoReply(content: string, options: { hasPendingInteraction?: boolean } = {}): boolean {
  const text = content.trim()
  if (!text) return false
  if (options.hasPendingInteraction && /^(确认|可以|同意|开始|继续|取消|不要|不用|否|好|好的|ok|OK|yes|no)[。.!！?？]*$/.test(text)) return true
  if (/^(继续|接着|接着来|继续处理|继续做|继续完善|继续写|继续整理|开始|执行|处理)[。.!！?？]*$/.test(text)) return true
  if (text.length <= 2) return false
  if (/^(好|好的|收到|嗯|哦|哈哈|呵呵|ok|OK|1|测试|谢谢|谢了)[。.!！?？]*$/.test(text)) return false
  // 只过滤明显无意义/确认类短消息。其余消息交给助理结合上下文判断是否 [SILENT]。
  return true
}

export function buildAssistantAutoPrompt(input: { context: string; actorName: string; content: string; pendingInteractions?: Array<{ id: string; type: string; title: string; description?: string }> }): string {
  const pending = input.pendingInteractions?.length
    ? `\n当前有待处理交互卡：\n${input.pendingInteractions.map((item) => `- ${item.id} [${item.type}] ${item.title}${item.description ? `：${item.description}` : ''}`).join('\n')}\n如果最新消息是在回应交互卡，请先用 ./freechat interaction list pending 确认，再按用户意图用 ./freechat interaction respond/consume 等 CLI 继续处理；不要忽略短确认。\n`
    : ''
  const roleRules = renderRoleCapabilitiesForAutoPrompt('assistant')
  return `你是 FreeChat 房间助理，正在旁听项目对话。

最近对话：
${input.context}

最新消息来自 ${input.actorName}: ${input.content}
${pending}
请判断是否需要你介入回复。
- 当前房间助理就是你本人；如果用户说“你继续/你就是作家/不需要安排别人”，是在要求你直接执行。不要说“已通知/转发/提醒 @自己”，不要把当前助理当成另一个 Agent。
${roleRules}
- 只要最新消息是问句，或包含“吗/么/谁/什么/怎么/能不能/能看到/看到房间/其他 agent/其他Agent/成员”等询问意图，必须回复，禁止输出 [SILENT]。
- 如果用户问你能否看到房间成员、其他 Agent、协作者，请用 ./freechat members list 或 .freechat/MEMBERS.md 查看后直接回答成员/Agent 列表；不要说这是系统层面不是你负责。
- 只有在最新消息明确只是确认、寒暄、测试、无意义短消息，且不是问句时，才输出 [SILENT]。
- 典型必须分派：用户同时要求“剧本/编剧/文字”和“分镜/镜头/画面”时，应分派给剧本编剧、分镜专家，助理只做协调和最终汇总。
- 回复要简洁，不要抢话。`
}
