# 首笔真实交易前 P0 修订（2026-10-12）

分支 `feat/agentmall-dining-mvp`，PR #1，基线 `7d33d56`。当前仍等待 Reviewer 批准首笔真实交易。本轮没有实际创建、支付或取消订单。

## 修复

- 前端重新查询、选择、确认门店时，清空旧交易预览、确认凭据、复选框、商品及提交按钮；请求代次防止旧 Query/Resolve/Preview 响应重新填回确认凭据。
- 店铺查询意图（包括参数无效）、重选和确认均撤销服务端旧店铺上下文，将未提交交易置为 EXPIRED 并清空确认摘要、报价与快照摘要。异步预览被取消后不能重新签发凭据。
- 提交前强制比对当前已确认门店与快照的 ID、地址、名称及坐标；缺少确认门店或不一致时拒绝。SUBMITTING / UNKNOWN / ORDER_CREATED / PAYMENT_PENDING 会阻止店铺查询、重选或重新确认，保留订单核对保护。
- 支付 URL 使用经过验证的精确 HTTPS 主机白名单，拒绝任意域名、子域伪装、凭据和非标准端口。尚无官方支付域名证据，当前生产白名单为空，因此不展示任何支付链接；旧日志中的链接与状态返回里的支付 URL 也不能绕过过滤。

## 实际验收

本机 Bun 未加入默认 PATH；本轮实际使用 `PATH=/private/tmp/agentmall-bun/bun-darwin-aarch64:$PATH` 执行以下命令（Bun 1.3.13）。直接执行 `bun` 会报 command not found，需安装 Bun 或使用该本地运行时。

| 检查 | 结果 |
|---|---|
| `bun run selfcheck` | PASS：27 tests / 0 fail / 184 assertions；真实交易部分只使用 Mock MCP |
| `bun run demo` | PASS：独立 Mock Demo |
| `bun run typecheck` | PASS |
| `bun run smoke` | PASS：真实只读商品与模拟结算，创建禁用 |
| Chrome 浏览器授权/实际定位/门店确认/商品查询/真实预览 | PASS，定位获用户本次授权；未使用演示坐标 |
| 浏览器未授权、门店未确认 | PASS：流程不可继续，创建按钮禁用 |
| 浏览器重选门店 | PASS：旧预览立即清空，确认复选框撤销，预览/创建按钮禁用 |
| 浏览器报价自然过期 | PASS：实际等待有效期结束，显示 EXPIRED，预览/创建按钮禁用 |
| 过期、重复、并发提交、店铺 ID/地址不一致 | PASS：Mock MCP API 回归，无实际创建 |

Chrome 扩展通道不可用，改用真实 Chrome 原生可访问性操作完成浏览器验收。默认服务器真实创建始终禁用；没有点击真实创建按钮，也没有对 LIVE 提交接口做试下单。实际订单重放仅使用 Mock MCP 测试，不能将其表述为已执行真实交易。

浏览器核对结果见 [browser-validation.json](./browser-validation.json)：生椰拿铁默认规格，1 杯，预览最终应付 20 元。为保护隐私，不记录用户坐标、实际门店身份/地址、Cookie 或确认凭据；这些字段仅在本地网页核对。

## 使用与剩余限制

`bun run start` → `bun run open` 可进行只读浏览器预览。首笔真实创建仍须 Reviewer 通过后由用户在本地网页亲自确认；本轮不启用 start:real，不 Merge。

官方支付域名尚待独立证据核验，不能猜测加入名单；当前使用官方 App 完成支付核对，不提供可点击支付入口。真实创建返回与付款状态映射仍未进行实际订单验证，保持原有 UNKNOWN 策略。麦当劳真实交易未推进。
