# AgentMall Dining MVP

三商家统一 OCP Catalog 演示。当前商品、价格和订单均为 **MOCK**，无真实消费。

```bash
bun install                 # 仓库根目录
cd apps/agentmall-dining
bun run selfcheck
bun run demo
bun run start               # http://localhost:4400
```

页面中输入需求或选择商家，执行发现、查询、解析，再确认模拟下单。真实商家状态见 [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)。
