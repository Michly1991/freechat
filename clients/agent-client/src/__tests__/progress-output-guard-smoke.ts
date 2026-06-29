import assert from 'node:assert/strict'
import { finalOutputForCompletion, isLikelyIntermediateProgress, shouldAutoSendFinal } from '../executor/claude.js'
import type { RemoteEvent } from '../config/types.js'

const event = {
  id: 'evt',
  runId: 'run',
  roomId: 'room',
  agentId: 'agent',
  type: 'agent.mentioned',
  createdAt: Date.now(),
  payload: { runSource: 'agent.mentioned', responseMode: 'final_to_chat' },
} as RemoteEvent

const progress = '我找到志愿表文件了！现在就读取内容，然后按「院校-专业」的结构重新整理脑图~'
assert.equal(isLikelyIntermediateProgress(progress), true)
assert.equal(shouldAutoSendFinal('final_to_chat', event, progress), false)
assert.equal(finalOutputForCompletion('final_to_chat', event, progress), '')

const progress2 = '好的，我再仔细读取一下志愿表文件~'
assert.equal(isLikelyIntermediateProgress(progress2), true)
assert.equal(finalOutputForCompletion('final_to_chat', event, progress2), '')

const finalAnswer = '我已读完志愿表，整理结果如下：\n1. A大学：计算机、软件工程。\n2. B大学：法学、会计。'
assert.equal(isLikelyIntermediateProgress(finalAnswer), false)
assert.equal(shouldAutoSendFinal('final_to_chat', event, finalAnswer), true)
assert.equal(finalOutputForCompletion('final_to_chat', event, finalAnswer), finalAnswer)

const toolLeak = '我来帮你分析。<toolcall>{"name":"excel.read","args":{"fileId":"file_123"}}</toolcall>'
assert.equal(finalOutputForCompletion('final_to_chat', event, toolLeak), '我来帮你分析。')

console.log('agent-client progress output guard smoke passed')
