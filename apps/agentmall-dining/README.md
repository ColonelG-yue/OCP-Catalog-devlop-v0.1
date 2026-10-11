# AgentMall Dining MVP

OCP Catalog 统一查询瑞幸、麦当劳与 KFC。瑞幸和麦当劳可通过本地 MCP Token 读取 LIVE 商品，失败时明确回退 MOCK；KFC 始终 MOCK。所有 checkout 均为模拟，不产生真实消费。

```bash
bun install                       # 仓库根目录
cd apps/agentmall-dining
bun run selfcheck
bun run demo                      # 稳定 Mock 演示
bun run mcp                       # 工具列表 + 只读商品验证
bun run smoke                     # HTTP 验收
bun run typecheck
bun run start                     # http://localhost:4400
```

Bun 自动加载被 Git 忽略的 `.env.local`。需要的变量名为 `LUCKIN_MCP_TOKEN`、`MCD_MCP_TOKEN`；凭据仅留在本地，不进入前端或版本控制。缺少凭据也能运行 Mock Demo 和 Catalog。

页面输入「瑞幸，30 元以内来一杯生椰拿铁」或手选商家，执行 Discovery → Query → Resolve → 确认模拟结算。商品标示 LIVE/MOCK；实时商品的 checkout 仍标示 MOCK。价格来自只读接口，最终订单报价未验证。

默认使用杭州演示地点：瑞幸 `(120.1551,30.2741)`，麦当劳 `杭州/武林`。可通过本地环境变量 `LUCKIN_LONGITUDE`、`LUCKIN_LATITUDE`、`MCD_CITY`、`MCD_STORE_KEYWORD` 调整，不代表自动定位。

实测能力与限制见 [INTEGRATIONS.md](docs/INTEGRATIONS.md)，审核交接见 [HANDOFF.md](docs/HANDOFF.md)。
