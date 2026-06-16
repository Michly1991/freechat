export interface DreamSignal {
  type: string
  text: string
  reason: string
  count: number
  lastTriggeredAt: number
}

export interface DreamErrorInput {
  errorCode?: string | null
  errorMessage?: string | null
  toolName?: string | null
  status?: string | null
  createdAt?: number | null
}

const RULES: Array<{ type: string; match: (item: DreamErrorInput) => boolean; text: string; reason: string }> = [
  {
    type: 'project_path_rule',
    match: (item) => /PROJECT_PATH_FORBIDDEN|PROJECT_RES_PATH_FORBIDDEN|res\/|正式交付文件不能写到|私有\/系统目录/.test(`${item.errorCode || ''} ${item.errorMessage || ''}`),
    text: '写正式项目文件、页面或交付物前，必须先执行 `./freechat tab files` 或阅读 `.freechat/TAB_FILES.md`；不要把正式交付物写到 `res/`、`scripts/`、`skills/`、`agents/`、`.freechat/`、`meta/` 等私有/系统目录。',
    reason: '曾发生项目文件路径错误或写入私有/系统目录。',
  },
  {
    type: 'html_publish_rule',
    match: (item) => /HTML 文件已写入项目文件区|tab create-file|create-local|页面区域|\.html/i.test(`${item.errorMessage || ''}`),
    text: 'HTML 写入 `ui/*.html` 只是项目文件留档；如果要显示在页面区域，必须继续执行 `./freechat tab create-local/create-file/update-local/update-file`，主页面加 `--default`。',
    reason: '曾出现 HTML 文件已写入但未正确发布为页面的风险。',
  },
  {
    type: 'tool_validation_rule',
    match: (item) => /VALIDATION_ERROR|required|is required|参数|path is required|title is required/i.test(`${item.errorCode || ''} ${item.errorMessage || ''}`),
    text: '调用工具前先确认必填参数；大段内容先写到 `res/` 本地草稿，再用 `./freechat file write-local <项目路径> <本地路径> --show` 或 `tab create-local/update-local` 发布。',
    reason: '曾发生工具参数缺失或格式错误。',
  },
  {
    type: 'task_progress_rule',
    match: (item) => /task|subtask|任务|进展|review|done|blocked/i.test(`${item.toolName || ''} ${item.errorMessage || ''}`) && /failed|error|VALIDATION/i.test(`${item.status || ''} ${item.errorCode || ''} ${item.errorMessage || ''}`),
    text: '处理任务时先把任务/子任务更新为 `doing`，过程中用 `./freechat task progress ...` 写进展；完成后提交 `review` 等待人类确认，不要直接隐藏或跳过状态。',
    reason: '曾发生任务工具失败或任务状态流转风险。',
  },
  {
    type: 'self_identity_rule',
    match: (item) => /已通知|转发|提醒 @自己|自己会处理|同名 Agent|Current Agent/i.test(`${item.errorMessage || ''}`),
    text: '用户 @ 你、提到你的 Agent ID、或说“你”时，就是要求你本人处理；不要把自己当成另一个可通知/转发的 Agent。',
    reason: '曾出现 Agent 自我识别或同名协作者混淆风险。',
  },
]

export function classifyDreamSignals(errors: DreamErrorInput[]): DreamSignal[] {
  const map = new Map<string, DreamSignal>()
  for (const item of errors) {
    for (const rule of RULES) {
      if (!rule.match(item)) continue
      const existing = map.get(rule.type)
      if (existing) {
        existing.count += 1
        existing.lastTriggeredAt = Math.max(existing.lastTriggeredAt, item.createdAt || 0)
      } else {
        map.set(rule.type, { type: rule.type, text: rule.text, reason: rule.reason, count: 1, lastTriggeredAt: item.createdAt || Date.now() })
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}
