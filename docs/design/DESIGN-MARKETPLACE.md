# FreeChat Marketplace Design

## Home Navigation

Top-level home navigation is:

```text
消息 / 通讯录 / 市场 / 设置
```

`账单` is no longer a standalone top-level tab. Billing is part of the marketplace because buying, selling, income, and wallet balance are market concerns.

## Market Sub-tabs

The `市场` page contains a mobile-friendly horizontal sub-tab bar:

```text
AI市场 / 模型市场 / 场景市场 / 我的账单
```

### AI Market

AI/Agent templates are sold as service capabilities.

- Owner/admin/editor sees full details and edit controls.
- Non-owner sees public summary, publisher, specialties/usage scenarios, and price only.
- System default assistant remains free for Agent service fee; model fees still apply.

### Model Market

Model services sell access to a provider-owned `apiKey + baseUrl` profile.

- Owner/admin sees baseUrl, key last4/replacement input, model list, and price editor.
- Non-owner sees summary, publisher, baseUrl host, supported models, and price.
- Raw API keys are never exposed.

### Scene Market

Scenes are one-time purchase templates.

- Built-in/free scenes show a special free marker, e.g. `🎁 免费`.
- Custom scenes default to a fixed one-time purchase price.
- After purchase/project creation, runtime cost comes from the included AI/Agent and selected model provider rules.

### My Billing

`我的账单` contains wallet balance, ledger rows, income/expense summaries, and unbilled usage warnings.

## Contacts

`通讯录` returns to people relationship management only: user search, friend requests, friends, and direct messages.
