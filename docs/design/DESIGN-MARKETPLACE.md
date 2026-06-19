# FreeChat Marketplace Design

## Navigation

Top-level home navigation:

```text
消息 / 通讯录 / 市场 / 账单 / 设置
```

- `市场`负责发现、发布、关注、购买资源。
- `通讯录`负责管理已经建立关系的资源：好友、已关注/自有 Agent、已关注/自有/平台模型、已购买/自有/内置场景。
- `账单`作为独立页承载钱包、支出、收入和明细。

## Resource Lifecycle

### Agent

Agent 模板是可关注的服务能力。

- 市场展示所有可见 Agent 模板。
- 非拥有者需要先关注 Agent，才能在创建项目/添加项目 Agent 时选择它。
- 使用时会克隆模板为项目内 Agent 副本。
- 自己创建的 Agent 和内置默认助手无需关注即可使用。
- Agent 服务费仍按计费设计执行：低价一次性购买/激活；后续运行主要收模型费用。

### Model Service

模型服务是可关注的提供方配置（`apiKey + baseUrl + models`）。

- 市场展示所有可见模型服务。
- 非拥有者需要先关注，才会出现在 Agent 模型配置选择里。
- 平台模型服务默认可用，无需关注。
- API Key 永远不暴露给非拥有者。

### Scene

场景是一次性购买的模板资源。

- 市场展示所有可见场景。
- 非拥有者需要购买后，才会在创建项目时可选。
- 自有场景、内置免费场景无需购买。
- 已购买场景会出现在通讯录的场景分组。
- 创建项目后，运行成本仍来自包含的 Agent 和选择的模型规则。

## Data Model

### `market_follows`

用于 Agent/模型服务的关注关系。

```text
id TEXT PRIMARY KEY
user_id TEXT NOT NULL
target_type TEXT NOT NULL -- agent | model
target_id TEXT NOT NULL
created_at INTEGER NOT NULL
UNIQUE(user_id, target_type, target_id)
```

### `scene_purchases`

用于场景购买关系。

```text
id TEXT PRIMARY KEY
user_id TEXT NOT NULL
scene_template_id TEXT NOT NULL
price_microcredits INTEGER NOT NULL DEFAULT 0
status TEXT NOT NULL DEFAULT 'completed'
purchased_at INTEGER NOT NULL
UNIQUE(user_id, scene_template_id)
```

金额继续使用账单系统的内部精度：`1 credit = 10000 microcredits`。

## API

- `POST /api/market/follows`
  - Body: `{ targetType: 'agent' | 'model', targetId: string }`
  - 创建关注关系。
- `DELETE /api/market/follows/:targetType/:targetId`
  - 取消关注关系。
- `POST /api/scenes/:id/purchase`
  - 购买场景；重复购买幂等返回已购买状态。

列表接口会返回关系状态：

- Agent：`isOwner`、`isFollowing`、`canUse`。
- Model：`isOwner`、`isFollowing`、`canUse`。
- Scene：`isPurchased`、`canUse`。

## Frontend Behavior

### 市场

- AI 市场：非自有 Agent 显示关注/已关注按钮。
- 模型市场：非自有、非平台模型显示关注/已关注按钮。
- 场景市场：未拥有场景显示购买按钮；已拥有/自有/内置场景显示可用状态。

### 通讯录

通讯录有四个分组：

```text
人员 / Agent / 模型 / 场景
```

- 人员：好友、好友申请、私聊入口。
- Agent：自有或已关注的可用 Agent。
- 模型：自有、已关注或平台可用模型服务。
- 场景：自有、已购买或内置可用场景。

### 创建/使用选择

创建项目和 Agent 模型配置只显示可用资源：

- 场景：`canUse = true`。
- Agent：`canUse = true`。
- 模型：`canUse = true`。

后端也会校验：未购买场景不能创建项目，未关注/未拥有 Agent 不能添加到项目。
