[English](README.md) | 简体中文

<div align="center">

<img src="client/public/logo.svg" width="96" alt="吵股 Squabble logo" />

# 吵股 Squabble

**让 AI 替你吵，你来定。**

开源的自托管投资组合终端：多头、空头、批评者、风控闸与基金经理**为你的持仓辩论并形成研究报告**。新手友好的 Agent Builder 将你的偏好变成有风控的模拟盘策略，并给出由你自行执行的真实交易提案。

自托管、不收手机号、不收邮箱验证、零埋点——[我们的隐私立场](docs/privacy.md)。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

![仪表盘](docs/screenshots/dashboard.png)

<details>
<summary><b>更多截图</b>（AI 模拟盘 · 每日分析 · 深度研报）</summary>

![AI 模拟盘](docs/screenshots/paper-trading.png)
![每日分析](docs/screenshots/daily-analysis.png)
![深度研报](docs/screenshots/deep-report.png)

</details>

## 它能帮你干什么

| | |
|---|---|
| 🗣️ **AI 吵架出研报** | 随便挑一只股票。多头和空头为它吵一架——每条论点必须引用证据——批评者负责推翻站不住脚的结论，你的风控规则作为硬门把关，最后由 PM 汇总成一份 **14 节研究报告**。重跑一次就能看到观点怎么变的、以及**为什么**变。每日体检、关注扫描、日志与已实现盈亏全都在。 |
| 🤖 **新手 Agent Builder** | 从持仓守护、关注探索、均衡策略三个模板开始，设置股票范围、每只股票可选的买入／卖出价格触发线、最低研报评级、单笔上限、日亏损与日订单上限；预览规则后启用一个版本化配置。用户设定的价格规则在研报数据缺失时也能产生模拟盘想法，并明确标注为用户规则而非 AI 结论。自定义 prompt 仅在配置大模型后用于否决候选信号，不能改订单或突破上限。 |
| 🧪 **模拟盘先行，实盘由你操作** | 模拟成交可生成提案收件箱，并通过你配置的渠道推送。真实交易由你在券商自行操作，之后可跳过提案，或回录真实成交时间、数量、价格、费用。回录是独立的对比台账，**不会自动更新真实持仓或交易流水**；系统没有真实券商下单路径。 |
| 🗣️ **证据与风控更可信** | 缺失的财报、新闻、估值信息标为不可用，不再当成有效辩论证据；关键证据不足时降低结论信心。组合风控先按汇率换算再计算敞口，无法核验的规则会明示。 |
| 🔒 **数据由你托管** | 账号、持仓、prompt 和提案保存在你自己的 PostgreSQL；无埋点，注册只需用户名与密码。研报和可选的 AI 审核会把相关上下文发给你选择的大模型，行情及通知也会请求对应服务。 |
| 🔑 **自带 API 配置** | 登录后在「设置」中为自己的账号填写兼容 OpenAI 的大模型地址、模型 ID 和密钥；可选填 Finnhub 密钥，为美股研报补充公司财务指标与新闻。页面内有申请与配置教程和连接测试；密钥加密保存在数据库中，设置接口不会回传明文。 |

## 5 分钟试一下

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up --build
```

打开 **http://localhost:3000**，用内置演示账号登录（**demo / demo1234**，登录页可一键填充）。你会得到一份虚构组合：横跨美/港/A 三个市场的 6 只持仓、3 次已完成的 Agent 运行（含一份两版本的 NVDA 研报——评级从 Hold 上调到 Buy，输掉的空头论点原文保留），以及一条被触发的风控规则。演示账号由数据库初始化时创建——公开部署时请修改或删除它。

**浏览预置演示不需要 API key**。对新股票运行研报需要大模型 key：登录后到「API 设置」填写自己的兼容 OpenAI 接口，或由部署者设置 `DOUBAO_API_KEY`。Agent Builder 的显式规则可不填 key，自定义 prompt 审核则需要 key。可选的 [Finnhub](https://finnhub.io/docs/api) key 为美股研报补充公司指标与新闻；行情仍来自公开服务，可能延迟或暂不可用。详见[自托管指南](docs/self-hosting.md)。

> 🧡 项目免费开源。大模型和金融数据服务商可能按你自己的账号套餐收费。

## Roadmap

- ✅ 多智能体研报（多空辩论、批评者、风控硬门、版本化保留）
- ✅ 一条命令跑起来的 Docker 演示（虚构数据）
- ✅ **自建账号体系** —— 用户名 + 密码（bcrypt 哈希）、JWT 会话；不收手机号、不收邮箱验证，注册开关走环境变量
- ✅ **AI 模拟炒股** —— 信号驱动的盯盘代理 + 硬性守护（日亏损熔断、单笔/日频次上限）、三市场盘钟感知，成交即推送（Webhook / Bark / Server酱 / 邮件 / Telegram）
- ✅ **新手 Agent Builder** —— 模板与显式风控、行为预览、单个启用配置、模拟盘提案与可选推送、真实成交手动回录
- ✅ **个人 API 设置** —— 引导式配置兼容 OpenAI 的大模型与 Finnhub、加密保存密钥、测试连接
- ✅ **持仓导入** —— 通用 CSV（自动列映射 + GBK 编码）、Robinhood 导出预设、券商截图 OCR 识别（用你自己的多模态 key，同花顺 / 东方财富 / 雪球 / 富途 / Robinhood …）
- 🔜 **桌面版** —— 一键安装包；下载量用 GitHub Releases 官方统计，零埋点

## 常见问题

<details>
<summary><b>收费吗？</b></summary>

不收——MIT 开源。你选用的大模型或金融数据服务商可能按套餐收取 API 使用费，连接测试也可能产生用量。

</details>

<details>
<summary><b>我的数据去哪了？</b></summary>

账号数据保存在你自己机器的 PostgreSQL 里。运行研报会向你配置的大模型发送所需上下文；配置 Finnhub 后，美股公司数据请求会发送给 Finnhub。公开行情服务与主动配置的通知渠道也会收到请求。完整拆解见 [docs/privacy.md](docs/privacy.md)——开源代码，每一条都可以自己验证。

</details>

<details>
<summary><b>会用我的真钱炒股吗？</b></summary>

不会。吵股只在独立表中执行**模拟订单**。它可以向你推送实盘提案；是否去自己的券商下单由你决定，成交后可以手动回录。提案回录不会替你下真实订单，也不会自动改写持仓或交易流水。

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
- [持仓导入指南](docs/zh-CN/import.md) —— 通用 CSV、Robinhood 导出、券商截图 OCR
- [架构文档](docs/architecture.md) —— 组件、请求链路、多智能体流水线、数据模型
- [开发指南](docs/development.md) —— 源码运行、lint/测试、Python Agent、设计令牌
- [参与贡献](CONTRIBUTING.md) · [安全策略](SECURITY.md)

## 免责声明

本项目仅用于个人记录与学习交流，不构成任何投资建议；模拟盘收益不代表真实交易结果。据此操作产生的盈亏由使用者自行承担。

## 许可证

[MIT](LICENSE)
