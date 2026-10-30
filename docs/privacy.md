# Privacy — 吵股 Squabble 自托管数据说明

This page documents, in plain language, exactly what data the app collects and
what leaves your machine. It is written so you can verify every claim against
the source code — the project is open source precisely so you don't have to
take our word for it.

## TL;DR

- **不收手机号、不收邮箱验证、不收真实姓名** — 注册只需要一个用户名和密码。
- **零埋点、零统计上报、零错误上报** — 没有任何 analytics SDK。
- **数据全部落在你自己的数据库里** — 自托管部署，备份与删除完全自主。
- 出网请求包括大模型、公开行情源、可选的 Finnhub 美股研究数据和你主动配置的通知渠道；截图识别属于可选的大模型请求。公开行情源不一定需要 API key。

## What we collect

| Item | Collected? | Notes |
|---|---|---|
| Phone number | ❌ Never | — |
| Email | Optional | 仅用于接收通知推送，非必需，不验证 |
| Real name / identity | ❌ Never | — |
| Telemetry / analytics | ❌ None | 无埋点、无统计、无错误上报 |
| Holdings & transactions | ✅ In your own DB | 只存在你部署的 PostgreSQL 里 |
| Agent preferences & prompts | ✅ In your own DB | 版本化配置；自定义 prompt 在候选信号审核时发给你配置的 LLM |
| User-supplied LLM / Finnhub API keys | ✅ Encrypted in your own DB | 各账号独立保存；设置接口只返回配置状态及遮盖提示，不返回明文。Docker 在独立持久卷自动生成加密密钥；源码部署可用私有 `SETTINGS_ENCRYPTION_KEY` 或私有 `JWT_SECRET`，已知演示密钥不可用于保存 API key。更换加密密钥后须重新填写 |
| Paper orders & real-execution notes | ✅ In your own DB | 模拟交易与自报的真实成交记录分表存储；不会自动改写真实交易流水 |
| Password | ✅ bcrypt 哈希 | 明文密码不落库、不记日志 |

> 账号体系已落地：自建「用户名 + 密码」登录（`server/modules/auth`），JWT 会话，
> 无 cookie、无 CSRF 面。注册可通过 `REGISTER_ENABLED=false` 关闭。

## What leaves your machine

The main outbound request categories are:

1. **LLM 推理请求** — 运行多智能体分析时，相关行情、组合上下文与研究提示词会发送给你配置的大模型厂商（火山方舟 / DeepSeek / 任意 OpenAI 兼容端点）；若你没有个人配置而部署者设置了 `DOUBAO_API_KEY`，则使用部署者的豆包接口。个人配置优先于部署环境，删除个人配置后恢复环境回退。Agent Builder 的自定义 prompt 仅在你填写并启用 AI 审核后随候选信号发送；显式规则不需要 LLM。连接测试也会发送一条小请求，可能产生服务商用量。厂商如何处理请求由其隐私条款决定。
2. **行情与金融数据请求** — 服务端向 Tencent、Sina、Yahoo 等公开源查询报价；公开源可能延迟、不可用，也不使用你的个人 API key。若你在「设置」中保存 Finnhub key，运行美股研究时服务端会向 Finnhub 查询可用的公司基础指标与新闻。Finnhub 公司新闻接口只覆盖北美公司；服务商套餐、标的与字段覆盖可能各不相同。连接测试使用已保存的 key 查询示例美股，可能计入 API 用量。删除 Finnhub 配置后停止这类请求；缺失数据会明确标记，不能当作事实引用。
3. **通知推送** — 仅当你主动配置了通知渠道（Webhook / Bark / Server酱 / SMTP / Telegram）时，才会向相应服务发送事件消息。Agent Builder 的提案通知可包含标的、方向、模拟数量和理由；关闭提案通知或停用渠道即可停止这类消息。
4. **截图识别（可选功能）** — 仅当你主动上传券商截图并配置了自己的多模态模型时，截图才会发给所选模型服务。详见 [import.md](import.md)。

以上为主要业务出网路径；请在部署前检查自己的反向代理、插件和新增集成。

## Where your data lives

- 自托管部署（Docker 或源码）：所有数据在你自己的 PostgreSQL / Docker 卷里。
- 模拟盘数据使用独立的数据表，与真实持仓记录完全隔离。
- Agent Builder 的配置、模拟提案及手动成交回录也保存在本地数据库。回录不会自动写入真实持仓或交易流水。
- 个人 LLM 和 Finnhub 密钥加密存储在本地数据库。浏览器保存后不再收到原始密钥；仅显示已配置状态和遮盖提示。服务端使用时解密并发往你配置的供应商。Docker 首次启动会在 `settings-secrets` 持久卷生成独立密钥，需与数据库一起备份；也可显式设置稳定的 `SETTINGS_ENCRYPTION_KEY`（至少 16 字符）。源码部署没有专用密钥时使用私有 `JWT_SECRET` 派生，公开的演示默认值不能用于保存 API key。轮换密钥后用户需重新填写；旧个人 LLM 密钥无法解密时，分析会停止并提示重新录入，不会自动改用部署者的模型。
- 删除本地数据库/卷会删除本地副本；已经发给大模型或通知服务的数据须按相应服务政策处理。

## How we count users

不做用户统计。桌面版下载量直接使用 GitHub Releases 的下载计数（GitHub 官方统计，与用户身份无关）。

## Verification

You don't have to trust this page:

- 搜索代码库中的 `fetch(`/`axios` 调用即可枚举全部出网请求。
- 数据库结构见 [`server/database/schema.ts`](../server/database/schema.ts)，不存在任何遥测表。
- 本文档若有与代码不符之处，欢迎提 issue —— 这被视为 bug。
