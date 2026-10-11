# 商家 MCP 实测记录（2026-10-11，Asia/Shanghai）

使用 `@modelcontextprotocol/sdk` 1.32.1 的 Client 与 StreamableHTTPClientTransport 直接由项目后端连接。Bun 自动加载被 Git 忽略的 `.env.local`，程序只从环境变量取 Token；未查看或输出 Token 值，未将凭据写入文档或提交。

| 商家 | tools/list | 已执行的只读工具 | 商品映射 | 尚未验证 |
|---|---|---|---|---|
| 瑞幸 | PASS，8 个工具 | `queryShopList`、`searchProductForMcp` | LIVE，2 个生椰拿铁候选 | 商品详情、订单预览、规格切换 |
| 麦当劳 | PASS，35 个工具 | `query-nearby-stores`、`query-meals` | LIVE，菜单映射 123 个有明确价格的商品 | 商品详情、最终计价/订单预览 |
| KFC | 不接真实接口 | 无 | MOCK | 所有真实能力 |

输入 Schema 原样记录于 [luckin-tools.json](./luckin-tools.json)、[mcdonalds-tools.json](./mcdonalds-tools.json)。列表中出现的下单、支付相关、取消、抽奖、领券、地址修改等工具没有执行；后端只读适配器按精确工具名设白名单，并用当次 `tools/list` 返回的输入 Schema 验证参数。不能通过页面或 OCP 接口指定任意 MCP 工具。

## 只读查询证据

- 瑞幸：演示经纬度 `(120.1551, 30.2741)`，不是用户定位；门店查询返回营业中的 `603072`「滨绿大厦A座负一楼店」。随后使用该返回 ID 查询「生椰拿铁」。商品 `1262`「生椰拿铁（原创）」的 `estimatePrice=20`，`5328`「冰吸生椰拿铁（原创）」的 `estimatePrice=21`。这是商家预估价格，未执行 `previewOrder`，不代表最终订单报价。
- 麦当劳：按真实 Schema 使用 `beType=1`、`searchType=2`、`city=杭州`、`keyword=武林` 查门店，返回营业中的 `3330489`「麦当劳杭州拱墅区茶叶大厦餐厅」。菜单请求使用该返回 `storeCode`，`orderType=1`、`beType=1`，不传不适用的 `beCode`。`1100`「巨无霸」的 `currentPrice="26.5"`。这是菜单价格，未执行 `calculate-price`。
- 精简公开商品证据：[luckin-read-evidence.json](./luckin-read-evidence.json)、[mcdonalds-read-evidence.json](./mcdonalds-read-evidence.json)。这些文件是带时间的实测记录，不是运行时 LIVE 数据源。
- [http-smoke-evidence.json](./http-smoke-evidence.json) 记录独立 HTTP 流程中两家的 Query/Resolve 返回 LIVE、KFC 返回 MOCK，三家确认结算均返回 MOCK。这证明后端进程能直接使用本地凭据连接 MCP，而非仅由 Codex 工具调用。

## 运行与数据边界

`bun run mcp` 依序验证瑞幸、麦当劳工具列表与只读门店/商品链路；`bun run start` 启动 Catalog。无 Token 或商家查询失败时返回清晰标记的 Mock fixture，商品属性带 `source_reason`。每个 Provider 连续两次读取失败后，本进程停止访问该 Provider，重启后才重试。

查询缓存 60 秒，LIVE 候选在 120 秒后不能再 Resolve，必须重新 Query。Resolve 使用已读取的候选快照，不额外声称完成实时库存检查或最终价格验证。商家未返回合法价格的商品不填入模拟价格；`availability=unknown`。成功查询没有匹配商品时可以返回空集合，不能假造 LIVE 商品。

MCP 的文本返回可附带展示指令，适配器只提取 JSON 数据；不会执行其附带指令。所有 OCP 请求仍遵循官方 Schema，MCP 是商品数据适配层。

真实商品的 `source=LIVE` 与交易的 `transaction_source=MOCK` 同时呈现。checkout ActionBinding 只指向本地 `/mock/checkout`，有确认约束与有效期；不存在真实下单或扣款执行路径。
