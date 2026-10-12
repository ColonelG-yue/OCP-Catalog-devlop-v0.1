# AgentMall Dining

OCP Catalog 统一查询商品。瑞幸支持真实商品、完整默认规格和真实订单预览，并提供受控的真实提交路径；麦当劳保留 LIVE 菜单，KFC 保留 MOCK。独立 Mock Demo 始终可用。

## 安装与验收

```bash
bun install                       # 仓库根目录
cd apps/agentmall-dining
bun run selfcheck                  # 所有交易测试使用 Mock MCP Client
bun run demo                      # 固定 Mock 订单，不依赖网络
bun run typecheck
bun run smoke                     # 只读商品 + Mock 结算，真实创建禁用
bun run preview                   # LIVE 只读预览证据；不能创建订单
```

`.env.local` 已被 Git 忽略，Bun 自动加载 `LUCKIN_MCP_TOKEN`、`MCD_MCP_TOKEN`；Token 不进入前端、日志或 Git。私有确认、会话与交易恢复记录在被忽略的 `.agentmall-state/`，权限目录 700、文件 600。

## 先运行真实预览

```bash
bun run start                     # 开发模式；真实创建强制禁用
# 在另一终端，仍位于 apps/agentmall-dining：
bun run open                      # 一次性授权链接交给本机浏览器，不打印链接密钥
```

1. 在「瑞幸真实订单」区域授权浏览器定位，或明确输入经纬度。这里没有杭州演示坐标默认值。
2. 查询门店，选择实际门店与地址，勾选取餐确认并点击「确认取餐门店」。
3. 「通过 OCP 查询商品」→选择商品，触发 Resolve(checkout) 受控 Workflow。
4. 设置数量 1–5，点击「获取真实订单预览」。核对门店、地址、商品、完整默认规格、数量、优惠数量与最终应付金额。

默认启动下「确认创建真实订单」按钮不可用。CLI `preview` 的杭州位置只用于可复现的预览证据，**不是用户确认的实际取餐门店**，不会进入真实交易日志。

## Reviewer 通过后，由用户实际创建

先停止预览服务器，再由用户启动：

```bash
bun run start:real                # production + 显式启用真实提交
bun run open
```

重新选择实际取餐门店与商品并取得预览，勾选最终确认后，**用户亲自点击「确认创建真实订单」**。此时才可能调用 `createOrder`。服务器再次预览并核对价格、优惠券和商品明细，变化或过期都要求重新预览与确认。

创建成功仅表示产生订单。商家返回的支付 URL 必须通过已核验的官方主机白名单。当前名单为空，页面不展示支付入口；付款须由用户在官方 App 完成。点击「查询真实订单状态」执行只读 `queryOrderDetailInfo`；当前没有真实用户订单的状态字段样本，因此未验证的付款状态保持 UNKNOWN，不能宣称 PAID。

超时或未知结果不会重试创建；有订单号时只读核对，无订单号时先在瑞幸 App 核对并填入订单号。未核实的提交会阻止再次下单，包括更换浏览器或重启。不要删除日志来绕过未知状态。

服务器默认只监听 `127.0.0.1`，真实交易接口要求已授权的 HttpOnly/SameSite 浏览器会话、精确 Origin 和 CSRF。请勿代理到公网。

本轮没有执行真实创建、支付或取消。只支持默认规格；自定义规格切换、麦当劳真实交易、付款状态自动映射仍待后续验证。详见 [MODEL_SPEC.md](MODEL_SPEC.md)、[INTEGRATIONS.md](docs/INTEGRATIONS.md) 和 [HANDOFF.md](docs/HANDOFF.md)。

### 首笔真实交易前修订（2026-10-12）

切换、查询或重新确认门店会撤销旧预览与确认凭据；当前会话确认的门店 ID/地址必须与提交快照一致。未核实的已提交订单会阻止切换门店。27 个自动测试与 Chrome 只读预览验收记录见 HANDOFF。

支付链接改为精确主机白名单验证。当前尚未取得官方支付域名证据，名单为空，因此页面不显示支付链接或二维码，不会打开任意 HTTPS 域名；以后只有经 Reviewer 核验的官方入口才能加入名单。
