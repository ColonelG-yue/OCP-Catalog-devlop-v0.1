# 商家 MCP 实测记录（2026-10-11，Asia/Shanghai）

使用 `@modelcontextprotocol/sdk` 1.32.1 的 Client 与 StreamableHTTPClientTransport 直接由项目后端连接。Bun 自动加载被 Git 忽略的 `.env.local`，程序只从环境变量取 Token；未查看或输出 Token 值，未将凭据写入文档或提交。

| 商家 | tools/list | 已执行的只读工具 | 商品映射 | 尚未验证 |
|---|---|---|---|---|
| 瑞幸 | PASS，8 个工具 | `queryShopList`、`searchProductForMcp`、`queryProductDetailInfo`、`previewOrder` | LIVE 商品与真实预览 | 自定义规格、实际创建、实际付款状态 |
| 麦当劳 | PASS，35 个工具 | `query-nearby-stores`、`query-meals` | LIVE，菜单映射 123 个有明确价格的商品 | 商品详情、最终计价/订单预览 |
| KFC | 不接真实接口 | 无 | MOCK | 所有真实能力 |

输入 Schema 原样记录于 [luckin-tools.json](./luckin-tools.json)、[mcdonalds-tools.json](./mcdonalds-tools.json)。列表中出现的下单、支付相关、取消、抽奖、领券、地址修改等工具没有执行；后端只读适配器按精确工具名设白名单，并用当次 `tools/list` 返回的输入 Schema 验证参数。不能通过页面或 OCP 接口指定任意 MCP 工具。

## 只读查询证据

- 瑞幸：演示经纬度 `(120.1551, 30.2741)`，不是用户定位；门店查询返回营业中的 `603072`「滨绿大厦A座负一楼店」。随后使用该返回 ID 查询「生椰拿铁」。商品 `1262`「生椰拿铁（原创）」的 `estimatePrice=20`，`5328`「冰吸生椰拿铁（原创）」的 `estimatePrice=21`。这是商家预估价格，未执行 `previewOrder`，不代表最终订单报价。
- 麦当劳：按真实 Schema 使用 `beType=1`、`searchType=2`、`city=杭州`、`keyword=武林` 查门店，返回营业中的 `3330489`「麦当劳杭州拱墅区茶叶大厦餐厅」。菜单请求使用该返回 `storeCode`，`orderType=1`、`beType=1`，不传不适用的 `beCode`。`1100`「巨无霸」的 `currentPrice="26.5"`。这是菜单价格，未执行 `calculate-price`。
- 精简公开商品证据：[luckin-read-evidence.json](./luckin-read-evidence.json)、[mcdonalds-read-evidence.json](./mcdonalds-read-evidence.json)。这些文件是带时间的实测记录，不是运行时 LIVE 数据源。
- [http-smoke-evidence.json](./http-smoke-evidence.json) 记录独立 HTTP 流程中两家的 Query/Resolve 返回 LIVE、KFC 返回 MOCK，三家确认结算均返回 MOCK。这证明后端进程能直接使用本地凭据连接 MCP，而非仅由 Codex 工具调用。

## 运行与数据边界

`bun run mcp` 依序验证瑞幸、麦当劳工具列表与只读门店/商品链路；`bun run start` 启动 Catalog。无 Token 或商家查询失败时在普通演示流返回清晰标记的 Mock fixture，商品属性带 `source_reason`。每个 Provider 连续两次读取失败后，本进程停止访问该 Provider，重启后才重试。

普通演示查询缓存 60 秒；用户确认门店的真实流重新查询该店，不使用演示门店缓存。LIVE 候选在 120 秒后不能再 Resolve，必须重新 Query。Resolve 使用已读取的候选快照，不额外声称完成实时库存检查或最终价格验证。商家未返回合法价格的商品不填入模拟价格；`availability=unknown`。成功查询没有匹配商品时可以返回空集合，不能假造 LIVE 商品。

MCP 的文本返回可附带展示指令，适配器只提取 JSON 数据；不会执行其附带指令。所有 OCP 请求仍遵循官方 Schema，MCP 是商品数据适配层。

普通演示流保持 `source=LIVE` / `transaction_source=MOCK` 和 `/mock/checkout`。已授权并确认实际门店的瑞幸流可得到真实预览 Workflow；生产模式人工启用并在网页最终确认后才可提交，见下节。

## 瑞幸真实预览与受控创建修订

本轮复用 SDK，额外实际执行 queryProductDetailInfo 和 previewOrder，没有调用 createOrder、cancelOrder 或任何支付工具。

真实详情给出 productId=1262、skuCode=SP2077-01134，默认属性为大杯/冰/意式拼配/默认浓度/不另外加糖/无奶油。最新完整只读预览见 [luckin-preview-evidence.json](./luckin-preview-evidence.json)。店址、商品列表、金额与优惠券列表均来自接口；公开证据只留优惠券数量，实际代码原样保留优惠券供未来用户提交。

返回金额语义核对了[瑞幸官方 Skill 文档下载](https://unpkg.luckincoffeecdn.com/@luckin/my-coffee-skill@latest/dist/my-coffee-skill.zip)：totalInitialPrice 是总额、privilegeMoney 是减免、discountPrice 是最终应付；支付入口仅使用实际返回的 payOrderQrCodeUrl。这份文档只作为字段参考，任务行为以用户本轮禁止创建/支付/取消的约束为准。

新增默认禁用的真实提交路径：生产模式显式启用、授权浏览器确认实际门店/地址、真实 Query/Resolve Workflow、最终预览与一次性确认、提交前再次预览、持久化幂等防护。createOrder 使用已确认门店返回的坐标，不使用旧杭州演示默认坐标；productList 与 couponCodeList 来自确认快照且在再次预览后逐项核对。

SDK 使用实际 tools/list 输入 Schema 验证所有参数。switchProduct 的 operation 语义尚未验证，当前不提供自定义规格切换。麦当劳仅保留原有只读菜单，真实 calculate-price/create-order/query-order 交易扩展未启动。

真实 createOrder 的输出尚未实测，解析仅使用官方文档的 orderId/payOrderQrCodeUrl；无法识别时 UNKNOWN。创建后与用户点击查询时会使用 queryOrderDetailInfo。真实付款字段/状态码未取得用户订单样本，生产代码不会从任意数字或字段猜测 PAID；自动状态测试仅在 Mock MCP 里验证。

本修订保留基线 a30def3 的 Mock 演示，新增需要人工浏览器确认的真实 Workflow。默认启动和所有自动验收仍禁止真实创建。

## 2026-10-12 首单前核验

Chrome 原生浏览器在 start（创建禁用）模式完成授权、用户本次批准的实际定位、门店确认、OCP 商品查询/解析与 LIVE 预览。门店与地址逐项核对，商品默认规格、数量 1、应付 20 元显示正确。实际定位和取餐店址不写入公开证据。没有真实 createOrder、支付或 cancelOrder 调用。

新增服务端当前已确认门店一致性检查、换店撤销快照、旧响应代次检查及未核实订单换店阻断；Mock MCP 回归通过。支付入口域名尚未得到可审计的官方证据，因此生产白名单为空，所有链接默认拒绝；不能将官方字段名本身当作任意域名可信的依据。
