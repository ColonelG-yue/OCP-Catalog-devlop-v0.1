# Reviewer FIX 修订交接（2026-10-11）

分支 `feat/agentmall-dining-mvp`，修订基线 `a2b63c0`。本轮提交等待 Reviewer 再审，不自行宣布整体协议合规。

## 本轮修复

1. `.env.local` 已被 `.gitignore` 忽略且未被 Git 跟踪；Token 只由 Bun/SDK 运行进程使用，未查看、打印或提交值。
2. 用官方 MCP SDK 替换手写 HTTP/SSE 探针，新增 `bun run mcp`。两家 `tools/list` 和只读门店/商品查询均成功；真实工具名与输入 Schema 见 [INTEGRATIONS.md](./INTEGRATIONS.md)。
3. Manifest 的 `input_fields` 声明 `filters.provider_id`、`filters.max_amount`，Query 支持 `keyword/filter/hybrid`。服务端与测试使用官方 `validateCatalogQueryRequest`；未声明字段、pack、mode 被拒绝，非法 JSON 不再当作空查询。
4. 实测商品通过适配器进入 OCP Query，Resolve 读取候选并返回动作绑定。LIVE 来源、门店、时间与价格字段依据可见；结算始终 MOCK。缺少凭据/商家失败时保留明确的 Mock 回退。
5. 保持确定性的 Mock Demo，新增 HTTP Smoke Test，实际覆盖两家 LIVE Query/Resolve、KFC MOCK、拒绝未确认交易与结算重复执行。未修改核心协议 Schema。

## 实际验收

在 `apps/agentmall-dining/`，使用 Bun 1.3.13：

| 命令 | 实际结果 |
|---|---|
| `bun run mcp` | PASS：瑞幸 8 个工具、麦当劳 35 个工具；两家只读商品链路均有 LIVE 数据 |
| `bun run selfcheck` | PASS：6 tests、0 fail、52 assertions；含官方 client 筛选验证 |
| `bun run demo` | PASS：三商家确定性 Mock 模拟订单 |
| `bun run typecheck` | PASS：先顺序构建官方依赖包类型，再执行 TypeScript 检查 |
| `bun run smoke` | PASS：通过真正 HTTP 请求完成六端点与两家 LIVE/KFC MOCK 流程 |

本机 Bun 位于 `/private/tmp/agentmall-bun/bun-darwin-aarch64/bun`，本轮执行时将该目录加入 PATH。SDK、官方 OCP client 与依赖已安装，lockfile 已更新。

## 使用方式

```bash
bun install                       # 仓库根目录
cd apps/agentmall-dining
bun run selfcheck
bun run demo                      # 固定 Mock，不依赖网络
bun run mcp                       # 仅只读验证，需要本地 Token
bun run smoke                     # HTTP + LIVE 验证，需要本地 Token
bun run start                     # http://localhost:4400
```

页面可输入「瑞幸，30 元以内来一杯生椰拿铁」，查看来源、菜单价格与 OCP 步骤，再确认模拟下单。演示地点为杭州配置，不是用户当前定位。

## 已知限制与审核重点

- 未做最终订单预览/规格选择/库存验证。瑞幸 `estimatePrice`、麦当劳 `currentPrice` 都不保证最终成交价。
- Resolve 基于最多 120 秒的只读快照，所有交易动作均为模拟，ActionBinding 的有效期不超过快照有效期。
- Query 页最多 50 个候选；`has_more` 标明截断，MVP 尚未实现 cursor 翻页，非空 cursor 返回 400。
- 官方 schema 包未提供 Discovery/Contracts 响应 Schema；这两个端点做结构/HTTP 检查，其余四类响应通过官方 Schema。
- 页面未做本轮浏览器端交互验收；HTTP Smoke 与 CLI Demo 已通过。

下一步等待 Reviewer 复审本提交；通过后再决定订单预览或 UI 验收，真实消费仍需单独批准。
