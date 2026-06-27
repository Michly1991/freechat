# FreeChat 协作与工程流程要求

## 先设计，确认后开发

- 所有功能改动、架构调整、权限模型、计费规则、前端行为变化，都必须先讨论系统设计/架构方案。
- 只有用户明确确认后，才开始写代码。
- 不要自作主张直接开发未确认的产品或架构变更。

## 设计文档同步

- 功能改动、架构决策、接口行为、前端行为变化，必须同步到 `docs/design/` 下的系统设计文档。
- 代码和设计不能脱节。
- 如果新增一类长期工程要求，应同步更新本 `docs/requirements/` 目录。

## 验证要求

按改动范围选择验证项，核心改动优先跑全量：

- `pnpm --filter @freechat/server typecheck`
- `pnpm --filter @freechat/web typecheck`
- `pnpm --filter @freechat/shared build`
- `pnpm --filter @freechat/server build`
- `pnpm --filter @freechat/web build`
- `pnpm check:size`
- 高风险权限/计费路径要补或运行 smoke test，例如：
  - `pnpm --filter @freechat/server exec tsx src/__tests__/room-authz-smoke.ts`
  - `pnpm --filter @freechat/server exec tsx src/__tests__/pricing-engine-smoke.ts`

## 部署与服务检查

- 需要重启时优先使用用户级 systemd：
  - `systemctl --user restart freechat-server.service`
  - `systemctl --user restart freechat-web.service`
- 重启后检查：
  - 服务 active
  - 后端 `/api/health` OK
  - 前端 HTTP 200

## 提交与推送

- 不把验证失败的代码提交为稳定版本。
- 提交前检查 `git status --short` 和 `git diff --check`。
- 不提交私有配置文件、密钥、临时文件或本地 workspace 私有内容。
