# Privacy — 吵股 Squabble 不碰你的个人数据

This page documents, in plain language, exactly what data the app collects and
what leaves your machine. It is written so you can verify every claim against
the source code — the project is open source precisely so you don't have to
take our word for it.

## TL;DR

- **不收手机号、不收邮箱验证、不收真实姓名** — 注册只需要一个用户名和密码。
- **零埋点、零统计上报、零错误上报** — 没有任何 analytics SDK。
- **数据全部落在你自己的数据库里** — 自托管部署，备份与删除完全自主。
- 出网请求只有三类，且全部使用**你自己的** API key：LLM 推理、行情数据、你主动配置的通知渠道。

## What we collect

| Item | Collected? | Notes |
|---|---|---|
| Phone number | ❌ Never | — |
| Email | Optional | 仅用于接收通知推送，非必需，不验证 |
| Real name / identity | ❌ Never | — |
| Telemetry / analytics | ❌ None | 无埋点、无统计、无错误上报 |
| Holdings & transactions | ✅ In your own DB | 只存在你部署的 PostgreSQL 里 |
| Password | ✅ bcrypt 哈希 | 明文密码不落库、不记日志 |

> 账号体系已落地：自建「用户名 + 密码」登录（`server/modules/auth`），JWT 会话，
> 无 cookie、无 CSRF 面。注册可通过 `REGISTER_ENABLED=false` 关闭。

## What leaves your machine

Exactly three categories of outbound requests exist in the codebase:

1. **LLM 推理请求** — 当你运行多智能体分析时，后端/Agent 会把行情、财务等分析所需数据发送给你配置的大模型厂商（火山方舟 / DeepSeek / 任意 OpenAI 兼容端点）。使用你自己的 API key，直连厂商，不经过任何中间服务器。不填 key 时此功能停用，其余功能不受影响。
2. **行情数据请求** — 浏览器直连 Finnhub 拉取实时报价（你自己的 token，仅存于本设备浏览器）。
3. **通知推送** — 仅当你主动配置了通知渠道（Webhook / Bark / Server酱 / SMTP / Telegram）时，才会在成交等事件发生时向该渠道发送消息。

除以上三类外，代码中不存在任何其他出网路径。

## Where your data lives

- 自托管部署（Docker 或源码）：所有数据在你自己的 PostgreSQL / Docker 卷里。
- 模拟盘数据使用独立的数据表，与真实持仓记录完全隔离。
- 删除数据 = 删库/删卷，无任何云端副本。

## How we count users

不做用户统计。桌面版下载量直接使用 GitHub Releases 的下载计数（GitHub 官方统计，与用户身份无关）。

## Verification

You don't have to trust this page:

- 搜索代码库中的 `fetch(`/`axios` 调用即可枚举全部出网请求。
- 数据库结构见 [`server/database/schema.ts`](../server/database/schema.ts)，不存在任何遥测表。
- 本文档若有与代码不符之处，欢迎提 issue —— 这被视为 bug。
