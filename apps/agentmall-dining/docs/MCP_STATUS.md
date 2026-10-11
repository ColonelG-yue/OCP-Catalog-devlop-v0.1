# MCP 接入状态（2026-10-11）

- 瑞幸官方页面：<https://open01.luckincoffeecdn.com/>，Streamable HTTP 地址 `https://gwmcp.lkcoffee.com/order/user/mcp`。
- 麦当劳官方页面：<https://open.mcd.cn/mcp>，远程 MCP 服务需要 Token。
- 当前本机 `LUCKIN_MCP_TOKEN` 和 `MCD_MCP_TOKEN` 均未设置。未获得 `tools/list`、门店或商品响应；页面及 Catalog 一律显示 `MOCK`，不宣称 `LIVE`。
- `bun run mcp:probe` 仅调用 `initialize` 和 `tools/list`，读取环境变量，绝不调用下单或支付工具。Token 不进入前端、日志或 Git。
- 获取真实商品前须核对工具 schema、门店参数和价格来源；当前没有安全可靠的实时商品映射，故不启用 LIVE 数据。
