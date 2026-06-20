# Voice Conversation / 语音对话设计

## 目标

FreeChat 的房间/任务对话支持语音输入和语音播放，同时不把业务绑定到某一家厂商。首个 Provider 对接火山引擎，后续可增加阿里云、腾讯云、OpenAI 或本地模型。

## 付费与身份原则

语音能力采用用户个人 BYOK（Bring Your Own Key）：

- 谁使用语音，谁配置自己的语音 Provider Key。
- 谁录音识别，谁的 ASR Key 付费。
- 谁点击播放，谁的 TTS Key 付费。
- Agent 发布方不承担语音费用。
- Agent Client 不保存使用方语音 Key。
- FreeChat 平台不默认垫付语音费用。

Agent 服务费、模型运行费、语音 ASR/TTS 费相互独立。

## MVP 流程

### 房间语音聊天模式

```text
开启语音对话 → 开始说话 → ASR 转文字 → 用户确认或自动发送 → 大模型/Agent 文字回复 → TTS 自动播放或手动播放
```

Phase 1 不是实时语音通话，也不是多人接听。它只是在房间聊天里提供“语音输入 + AI 回复语音播放”的模式，仍然复用现有房间消息、任务和 Agent 流程。

### 语音输入

```text
浏览器录音 → POST /api/voice/transcribe → 用户个人 Provider ASR → 识别文本填入输入框 → 用户确认发送 → 现有 room/task/Agent 流程
```

默认不自动发送识别文本，避免误识别直接进入任务对话。用户可在房间语音对话条里打开“自动发送”，让识别结果直接进入现有消息发送流程。

### 语音播放

```text
用户点击消息“播放”或开启 AI 回复自动播放 → POST /api/voice/synthesize → 用户个人 Provider TTS → 返回音频 URL → 浏览器播放
```

## 解耦模块

```text
packages/server/src/services/voice/
  types.ts
  voice-config.service.ts
  voice.service.ts
  providers/
    volcengine/
      volcengine.provider.ts
```

业务代码只依赖 `voiceService.transcribe` 和 `voiceService.synthesize`，不直接调用火山 SDK/API。

## 数据表

### user_voice_provider_configs

用户个人语音服务配置。敏感凭证写入 `credential_json_cipher`，使用现有 `secret-crypto` 加密。

关键字段：

- `user_id`
- `provider`
- `asr_enabled`
- `tts_enabled`
- `is_default_asr`
- `is_default_tts`
- `credential_json_cipher`
- `config_json`

### voice_interactions

记录语音输入/输出审计与排障信息：

- `user_id`
- `room_id`
- `task_id`
- `message_id`
- `provider`
- `direction`: `input | output`
- `audio_path`
- `text`
- `status`
- `error`
- `duration_ms`

## API

### 配置

```http
GET    /api/voice/configs
POST   /api/voice/configs
PATCH  /api/voice/configs/:id
DELETE /api/voice/configs/:id
POST   /api/voice/configs/:id/test
```

返回配置时不返回明文 credential，仅返回 `credentialStatus`。

### ASR

```http
POST /api/voice/transcribe
Content-Type: multipart/form-data
```

字段：

- `audio`: 语音文件
- `roomId?`
- `taskId?`
- `providerConfigId?`
- `language?`
- `sampleRate?`
- `format?`

不传 `providerConfigId` 时使用当前用户默认 ASR 配置。

### TTS

```http
POST /api/voice/synthesize
Content-Type: application/json
```

Body：

```json
{
  "text": "需要播放的文本",
  "roomId": "room_xxx",
  "messageId": "msg_xxx",
  "providerConfigId": "voice_cfg_xxx",
  "voice": "zh_female_xxx",
  "format": "mp3"
}
```

不传 `providerConfigId` 时使用当前用户默认 TTS 配置。

## 火山 Provider

TTS 默认使用豆包语音新版 HTTP 单向流式接口：

```text
POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
X-Api-Key: <用户配置的 API Key / Token>
X-Api-Resource-Id: seed-tts-2.0
```

响应按行返回 JSON，`data` 为 base64 音频分片；服务端会合并分片后保存为 `/uploads/voice/...mp3` 供前端播放。

ASR 暂保留 OpenSpeech 兼容 JSON 格式。允许用户在配置里覆盖：

- `asrUrl`
- `ttsUrl`
- `asrCluster`
- `ttsResourceId` / `ttsCluster`
- `defaultVoice`

如需回退旧版 TTS，可在配置里设置 `ttsApiVersion = legacy`。

## 前端入口

- 设置 → 语音：配置个人火山语音 Key。
- 房间聊天区：显示“开启语音对话 / 关闭语音对话”。
- 语音对话条：显示“开始说话 / 停止说话”、“自动发送”、“AI 回复自动播放”。
- 房间聊天输入框：麦克风按钮录音识别，识别结果填入输入框或自动发送。
- 每条文本消息：播放按钮，按当前用户的 TTS 配置合成并播放。
- 语音对话模式开启且“AI 回复自动播放”开启时，新到达的大模型/Agent 文本回复会自动合成并播放。

## 后续增强

- WebSocket 流式 ASR。
- 流式 TTS。
- 更自然的连续语音聊天模式。
- 可选实时语音 Provider（必须继续经过 FreeChat Agent/task/message 流程，除非另行确认）。
- 项目 owner 共享语音配置。
- 语音费用估算和账单展示。
