# Gate 1 交接（2026-10-11）

分支 `feat/agentmall-dining-mvp`；等待 Reviewer 审核，不进入 Gate 2。

- 六端点已实现：Discovery、Manifest、Health、Contracts、Query、Resolve。
- Query 使用 manifest 声明的 `ocp.query.keyword.v1`、`keyword`；支持 `provider_id`、`max_amount`，数据标记 `MOCK`。
- Resolve(view) 是查看动作，Resolve(checkout) 是模拟结算动作，有 `requires_user_confirmation=true` 和过期时间。
- `/mock/checkout` 位于 OCP 外，校验一次性 resolution 与 `confirmed=true`，不产生真实订单。
- 官方 `@ocp-catalog/ocp-schema` 校验 Manifest、Health、QueryResult、ResolvableReference 响应和 Query/Resolve 请求。当前仓库 schema 包没有 Discovery/Contracts 响应 schema，这两项只检查结构与可访问性。
- 未知 entry_id 返回 404；非法查询字段、未声明 query pack 或 mode 返回 400。

从仓库根目录执行：

```bash
bun install
cd apps/agentmall-dining
bun run selfcheck
bun run demo
bun run typecheck
bun run start
```

本机原无 Bun；使用临时下载的 Bun 1.3.13，`bun install --registry https://registry.npmmirror.com` 成功。`selfcheck` 2 pass / 0 fail / 34 assertions；`demo` 三商家模拟订单通过；`typecheck` 通过。真实 MCP 状态见 [INTEGRATIONS.md](./INTEGRATIONS.md)。

下阶段先让当前任务与项目后端获得 MCP 连接，实测 `tools/list`、输入 Schema、只读门店/商品响应，再启用 LIVE 数据。Codex 侧连接不能默认视为后端运行时连接。
