# 商家 MCP 核验（2026-10-11）

本任务可调用工具清单与 `codex mcp list` 均未显示瑞幸或麦当劳 MCP；本机进程也无 `LUCKIN_MCP_TOKEN`、`MCD_MCP_TOKEN`。因此当前无法列出两家的实际 `tools/list`、输入 Schema，也无法执行已鉴权的只读门店或商品查询。用户在其他上下文配置 MCP，不等于本任务或项目后端自动获得连接。

| 商家 | 官方入口 | 实测工具/Schema | 只读调用 | 后端运行时 |
|---|---|---|---|---|
| 瑞幸 | `https://gwmcp.lkcoffee.com/order/user/mcp` | 未取得 | 未执行，当前无连接 | 未接入 |
| 麦当劳 | `https://mcp.mcd.cn` | 未取得 | 未执行，当前无连接 | 未接入 |
| KFC | Mock | 不适用 | 不适用 | Mock |

官方入口：[瑞幸 AI 开放平台](https://open01.luckincoffeecdn.com/)、[麦当劳 MCP 平台](https://open.mcd.cn/mcp)。公开文档只能证明服务入口，不能证明本会话已获授权或已取得商品。

`bun run mcp:probe` 是只读探针。若后端进程有本地环境变量，则只执行 `initialize` 和 `tools/list`；不会执行商品、门店、预览、下单或支付工具。现有 Catalog 的 `MOCK` 商品和价格全是演示数据。下一步需先取得真实工具列表及输入 Schema，再按实测只读返回数据做映射；不能臆造参数。真实消费需用户单独批准。
