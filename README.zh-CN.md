[English](README.md) | 简体中文

<div align="center">

<img src="client/public/logo.svg" width="96" alt="吵股 Squabble logo" />

# 吵股 Squabble

**让 AI 替你吵，你来定。**

开源的自托管炒股终端：一支 AI 分析师团队——多头、空头、批评者、风控闸、基金经理——**为你的持仓吵架吵出研究报告**，全天候盯盘，并在硬性风控约束下跑模拟盘。

自托管、不收手机号、不收邮箱验证、零埋点——[我们的隐私立场](docs/privacy.md)。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

![仪表盘](docs/screenshots/dashboard.png)

<details>
<summary><b>更多截图</b>（每日分析 · 深度研报）</summary>

![每日分析](docs/screenshots/daily-analysis.png)
![深度研报](docs/screenshots/deep-report.png)

</details>

## 它能帮你干什么

| | |
|---|---|
| 🗣️ **AI 吵架出研报** | 随便挑一只股票。多头和空头为它吵一架——每条论点必须引用证据——批评者负责推翻站不住脚的结论，你的风控规则作为硬门把关，最后由 PM 汇总成一份 **14 节研究报告**。重跑一次就能看到观点怎么变的、以及**为什么**变。 |
| 🧭 **每天给持仓做体检** | 每只持仓和关注股一张卡：评级、操作、目标价、催化剂、风险。净值快照、投资日志、已实现盈亏——枯燥的记账它全包了。 |
| 🔒 **不碰你的个人数据** | 自托管、零埋点，账号只要用户名+密码（不收手机号、不收邮箱验证）。出网请求只有你自己用**自己的 API key** 发起的那几类。 |

## 5 分钟试一下

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up --build
```

打开 **http://localhost:3000**，用内置演示账号登录（**demo / demo1234**，登录页可一键填充）。你会得到一份虚构组合：横跨美/港/A 三个市场的 6 只持仓、3 次已完成的 Agent 运行（含一份两版本的 NVDA 研报——评级从 Hold 上调到 Buy，输掉的空头论点原文保留），以及一条被触发的风控规则。演示账号由数据库初始化时创建——公开部署时请修改或删除它。

**不需要任何 API key**，演示完全离线可用。想对自己关注的股票跑分析时，再填你自己的大模型 key——任意 OpenAI 兼容接口都行（火山方舟 / DeepSeek 等），实时行情用 Finnhub token。详见[自托管指南](docs/self-hosting.md)。

> 🧡 免费开源。你唯一的花销是自己 key 的 token 费——跑一份深度研报通常不到一杯咖啡钱。

## Roadmap

- ✅ 多智能体研报（多空辩论、批评者、风控硬门、版本化保留）
- ✅ 一条命令跑起来的 Docker 演示（虚构数据）
- ✅ **自建账号体系** —— 用户名 + 密码（bcrypt 哈希）、JWT 会话；不收手机号、不收邮箱验证，注册开关走环境变量
- 🚧 **AI 模拟炒股** —— 执行 Agent + 券商适配器接口（先接模拟盘，真券商哪天开放哪天接）、硬性守护（日亏损熔断、单笔上限），成交即推送（Webhook / Bark / Server酱 / 邮件 / Telegram）
- 🚧 **持仓导入** —— 通用 CSV、Robinhood CSV、券商截图 OCR 识别（用你自己的多模态 key）
- 🔜 **桌面版** —— 一键安装包；下载量用 GitHub Releases 官方统计，零埋点

## 常见问题

<details>
<summary><b>收费吗？</b></summary>

不收——MIT 开源。你只需要为自己 key 的 token 花钱，而且只在跑分析时才花。

</details>

<details>
<summary><b>我的数据去哪了？</b></summary>

哪儿也不去，除非你主动让它去。所有数据都在你自己机器的 PostgreSQL 里。出网请求仅限三类：你配置的大模型厂商（你自己的 key）、行情数据、你主动配置的通知渠道。完整拆解见 [docs/privacy.md](docs/privacy.md)——开源代码，每一条都可以自己验证。

</details>

<details>
<summary><b>会用我的真钱炒股吗？</b></summary>

不会。吵股的交易是**纯模拟盘**：独立的模拟表，和你的真实记录完全隔离。预留的券商适配器接口是为了将来真券商开放时能接——国内券商没有对个人开放的交易 API，我们也不碰灰色地带。

</details>

<details>
<summary><b>手机能用吗？</b></summary>

能——Web 应用本身就是 PWA，有手机端布局和「添加到主屏幕」支持。

</details>

<details>
<summary><b>支持哪些市场？</b></summary>

美股、港股、A股；多币种分账（USD / HKD / CNY），按汇率折算汇总。

</details>

<details>
<summary><b>为什么叫吵股？</b></summary>

吵股 = 炒股的谐音，但「吵」才是本意：一群 AI 分析师围着你的股票吵到吵出一个经得起推敲的评级。Logo 是牛牛的气泡在安静地打字，熊熊的气泡在喊。

</details>

## 文档

- [自托管指南](docs/self-hosting.md) —— Docker、环境变量、备份恢复、反向代理
- [隐私说明](docs/privacy.md) —— 什么数据存在、什么出网，逐条可验证
- [架构文档](docs/architecture.md) —— 组件、请求链路、多智能体流水线、数据模型
- [开发指南](docs/development.md) —— 源码运行、lint/测试、Python Agent、设计令牌
- [参与贡献](CONTRIBUTING.md) · [安全策略](SECURITY.md)

## 免责声明

本项目仅用于个人记录与学习交流，不构成任何投资建议；模拟盘收益不代表真实交易结果。据此操作产生的盈亏由使用者自行承担。

## 许可证

[MIT](LICENSE)
