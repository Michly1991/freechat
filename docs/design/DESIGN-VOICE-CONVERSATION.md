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

### 房间语音会话

```text
开启语音对话 → 房间成员收到邀请 → 接听/拒绝 → 语音对话中 → 静音/挂断
```

Phase 1 的“语音会话”先管理房间会话状态和接听按钮，不做实时音频流。会话中的语音输入仍复用下方 ASR：录音识别为文本，再进入现有房间消息、任务和 Agent 流程。

### 语音输入

```text
浏览器录音 → POST /api/voice/transcribe → 用户个人 Provider ASR → 识别文本填入输入框 → 用户确认发送 → 现有 room/task/Agent 流程
```

MVP 不自动发送识别文本，避免误识别直接进入任务对话。

### 语音播放

```text
用户点击消息“播放” → POST /api/voice/synthesize → 用户个人 Provider TTS → 返回音频 URL → 浏览器播放
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

### room_voice_sessions

房间级语音会话：

- `room_id`
- `created_by`
- `status`: `ringing | active | ended`
- `provider_mode`: `byok`
- `created_at`
- `answered_at`
- `ended_at`

### room_voice_session_participants

语音会话参与人状态：

- `session_id`
- `user_id`
- `status`: `invited | joined | declined | left`
- `muted`
- `joined_at`
- `left_at`

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

### 房间语音会话

```http
GET   /api/rooms/:roomId/voice-sessions/active
POST  /api/rooms/:roomId/voice-sessions
POST  /api/rooms/:roomId/voice-sessions/:sessionId/answer
POST  /api/rooms/:roomId/voice-sessions/:sessionId/decline
POST  /api/rooms/:roomId/voice-sessions/:sessionId/leave
PATCH /api/rooms/:roomId/voice-sessions/:sessionId/me
```

WebSocket 广播：

```text
voice.session_updated
```

Payload 包含 `action` 和最新 `session`。前端据此刷新开启、接听、拒绝、静音、挂断按钮。

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

当前 `volcengine.provider.ts` 采用 OpenSpeech 兼容 JSON 格式，并允许用户在配置里覆盖：

- `asrUrl`
- `ttsUrl`
- `asrCluster`
- `ttsCluster`
- `defaultVoice`

这样即使火山不同产品线端点不同，也不影响 FreeChat 的 voice 抽象层。

## 前端入口

- 设置 → 语音：配置个人火山语音 Key。
- 房间聊天区：显示“开启语音对话 / 接听 / 拒绝 / 静音 / 挂断”。
- 房间聊天输入框：麦克风按钮录音识别，识别结果填入输入框，用户确认发送。
- 每条文本消息：播放按钮，按当前用户的 TTS 配置合成并播放。

## 后续增强

- WebSocket 流式 ASR。
- 流式 TTS。
- 实时语音对话 Provider。
- 项目 owner 共享语音配置。
- 语音费用估算和账单展示。
