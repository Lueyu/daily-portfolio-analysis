[English](README.md) | 简体中文

<div align="center">

<img src="client/public/logo.svg" width="88" alt="吵股" />

# 吵股 · Squabble

**让 AI 替你吵，你来定。**

开源投资工作台：多头、空头和批评者审视你的想法——最后由你拍板。

**美股 · 港股 · A 股** · **中英双语** · **自托管** · **零埋点**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Lueyu/squabble/actions/workflows/ci.yml/badge.svg)](https://github.com/Lueyu/squabble/actions/workflows/ci.yml)

</div>

![吵股仪表盘](docs/screenshots/dashboard.png)

## 为什么试试吵股？

大多数持仓工具止步于「展示」数字。吵股会为你的数字吵架。

- 🗣️ **多智能体研究** — 多头和空头围绕你的持仓辩论，批评者推翻站不住脚的论点，你的风控规则作为硬门把关，最后输出一份 14 节研究报告。
- 🤖 **AI 模拟炒股** — 独立的虚拟账户：AI 全天候按你的研究信号盯盘下单，成交即推送通知。通过 MCP 接入 Claude 或 ChatGPT，每个代理有独立花费限额和审批模式。
- 🔒 **数据只属于你** — 自托管、零埋点，账号只要用户名+密码。不收手机号、不收邮箱验证。

## 快速开始

**Docker**（推荐，无需任何 API Key）：

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up -d --build
```

打开 **http://localhost:3000**，用 `demo` / `demo1234` 登录。

**源码运行**（开发者）：

```bash
git clone https://github.com/Lueyu/squabble.git && cd squabble
npm install
npm run dev
```

## 它能干什么

| | |
|---|---|
| 📊 **持仓管理** | 美/港/A 股持仓、现金、盈亏与净值曲线，支持 USD/HKD/CNY 折算。 |
| 🗣️ **AI 研报** | 多空辩论 → 批评者审视 → 风控硬门 → 14 节报告。版本化保留，输掉的论点原文保存。 |
| 🤖 **模拟炒股** | 信号驱动的 AI 盯盘 + 硬性守护（日亏损熔断、单笔上限）。支持手动下单和 MCP 代理下单。 |
| 📸 **持仓导入** | CSV 自动列映射（5 券商预设）+ 截图 OCR 识别（用你自己的多模态 key）。 |
| 🔔 **通知推送** | Webhook / Bark / Server酱 / 邮件 / Telegram——成交、风控拦截、熔断即推。 |

## 接入你的 AI 助手

吵股内置 MCP 服务器，把模拟盘交给 Claude 或 ChatGPT：

1. 打开 **AI 模拟盘 → AI 代理 → 连接新代理**
2. 把 MCP 地址和 Token 填入你 AI 助手的 MCP 设置
3. 对它说"看看我的持仓"或"买入 NVDA 100 股"

每个代理有独立的日花费限额、只读/交易权限和审批模式。订单可以自动成交，也可以等你点一下批准。

## 隐私

自托管、零埋点。出网请求只有你自己用**自己的 API key** 发起的那几类。[完整说明 →](docs/privacy.zh-CN.md)

## 文档

[本地部署与排错](docs/self-hosting.zh-CN.md) · [服务器部署](docs/public-deployment.zh-CN.md) · [持仓导入](docs/zh-CN/import.md) · [架构](docs/architecture.md) · [开发指南](docs/development.md) · [参与贡献](CONTRIBUTING.md)

---

吵股是「炒股」的谐音。牛牛和熊熊可以各执己见，最后拍板的人是你。

[MIT 开源](LICENSE) · 研究输出不构成投资建议；模拟盘结果不代表真实收益。
