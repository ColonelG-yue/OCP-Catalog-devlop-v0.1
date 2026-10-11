# 瑞幸真实交易修订交接（2026-10-11）

分支 `feat/agentmall-dining-mvp`，基线 `a30def3`。本轮停止在瑞幸预览与安全提交功能，等待 Reviewer 审核及用户实际操作。没有创建、支付或取消真实订单。

## 交付内容

- 复用 SDK 与 OCP 商品映射，读取真实商品详情，确认完整默认 SKU；调用真实 previewOrder。自定义 switchProduct 未做：实际默认 SKU 已完整可购买，不猜测未验证的切换语义。
- 本轮真实预览见 [luckin-preview-evidence.json](./luckin-preview-evidence.json)：数量 1，生椰拿铁，最终应付 2000 分，优惠券数量 0。该记录是只读演示证据，`user_pickup_store_approved=false`，不是用户认可的取餐门店。
- 新增 RealCheckoutAdapter/LuckinRealCheckout 与完整状态机、不可变确认快照、提交前重新预览、单次确认凭据、持久化并发/重复防护与 UNKNOWN 恢复。
- 用户必须在授权浏览器提供位置、选择并确认实际门店地址。真实 OCP Query 使用该已确认门店；Resolve(checkout) 返回受控 Workflow。
- 默认 start 禁用真实创建；测试/Demo/Smoke 在 SDK 边界禁用真实创建，取消无执行路径。start:real 仅供 Reviewer 通过后由用户启动，实际提交只能由网页明确确认按钮触发。
- 会话授权通过 bun run open 的本地一次性链接；签名 HttpOnly/SameSite Cookie、精确 Origin/CSRF、127.0.0.1 绑定；私有状态目录与 `.env.local` 都被 Git 忽略。

## 实际验收

| 命令/检查 | 结果 |
|---|---|
| `bun run selfcheck` | PASS，21 tests / 0 fail / 130 assertions；真实交易部分仅 Mock MCP |
| `bun run demo` | PASS，三商家独立 Mock 模拟结算 |
| `bun run typecheck` | PASS |
| `bun run smoke` | PASS，六端点及只读 LIVE 商品 + Mock 结算；创建禁用 |
| `bun run preview` | PASS，真实详情/默认 SKU/真实报价；无 createOrder |
| 默认 `bun run start` | 成功，日志明确 orders DISABLED；监听 127.0.0.1:4400 |
| 未授权 `/api/session` | HTTP 401 |
| 同一日志目录第二进程 | 拒绝启动，避免跨端口并发提交 |
| 页面 JS 语法 | PASS；本轮未进行完整浏览器交互验收 |

测试覆盖字段/凭据篡改、Owner 隔离、Origin/CSRF、门店必须确认、预览/价格/优惠变化、过期、并发、重复、超时未知、重启恢复、跨浏览器未知结果防重复及假订单状态核对。未调用实际创建或取消工具。

本机使用 Bun 1.3.13，运行时 PATH 加入 `/private/tmp/agentmall-bun/bun-darwin-aarch64`。

## 使用与下一步

按 [README.md](../README.md) 运行 start/open，先在授权浏览器完成真实预览。Reviewer 通过后再由用户运行 start:real、确认实际取餐门店，并亲自点击创建按钮。

待验证：真实 createOrder 的返回结构、真实订单查询字段/付款状态映射、官方支付入口的实际展示。代码只使用文档中的 orderId/payOrderQrCodeUrl；返回不完整时 UNKNOWN，不重试、不猜支付 URL、不宣称 PAID。取得用户订单返回之前，没有端到端实际下单/付款成功证据。

MVP 仅商家完整默认规格，未支持自定义规格、外送、主动取消、麦当劳真实交易。商家不接受本地幂等键/价格上限，不能保证商家原子价格锁定或跨独立安装的幂等；本机日志不可删除来绕过未知提交。
