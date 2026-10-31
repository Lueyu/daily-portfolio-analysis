[English](README.md) | 简体中文

<div align="center">

<img src="client/public/logo.svg" width="88" alt="吵股牛熊吉祥物" />

# 吵股 · Squabble

**让 AI 替你吵，你来定。**

不用写代码，搭建自己的投资 Agent。
带上你的持仓，设定你的规则，先在模拟盘里试一试。

**美股 · 港股 · A 股** · **中英双语** · **支持自托管**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Lueyu/squabble/actions/workflows/ci.yml/badge.svg)](https://github.com/Lueyu/squabble/actions/workflows/ci.yml)

[立即本地体验](#立即本地体验) · [第一次怎么玩](#第一次怎么玩) · [安装指南](docs/self-hosting.zh-CN.md) · [数据与隐私](docs/privacy.zh-CN.md)

</div>

![吵股投资仪表盘，使用虚构演示数据](docs/screenshots/dashboard.png)

*中文界面与虚构演示组合。*

吵股为个人投资者提供一个**看懂持仓、试验规则、复盘决策**的工作台。不填 API Key，也能使用公共行情和基础分析；接入大模型后，让多头、空头与批评者一起审视你的投资想法。

## 为什么试试吵股？

| 你想做的事 | 吵股能帮你做什么 |
|---|---|
| 看清整个投资组合 | 在同一处查看美股、港股、A 股持仓、现金与盈亏，支持美元／港币／人民币折算和市场概览。 |
| 不写代码也能搭 Agent | 选择模板，设置股票范围、价格触发条件和风控限额，预览规则后启用自己的模拟盘策略。 |
| 同时看到看多与看空的理由 | 配置模型后，在同一份报告里查看多空论点、证据、批评与风控检查；缺失的数据会明确显示。 |
| 与自己的团队讨论决策 | 配置研究员、质疑者和组合经理，在研究室补充个人观点，保留附带证据的各版结论。 |
| 自己掌握最后的决定 | 先用独立模拟盘试验，可选接收交易提案通知。真实交易由你在券商操作，再记录实际结果。 |

## 立即本地体验

吵股提供两种本地安装方式。基础分析均不要求连接券商或填写 AI API Key。

| 方式 | 需要准备 | 数据位置 |
|---|---|---|
| **桌面应用** | 从 [Releases](https://github.com/Lueyu/squabble/releases) 获取与你系统匹配的 Windows x64 或 macOS Intel／Apple 芯片安装包（发布后） | 本机吵股应用数据目录 |
| **Docker Compose** | [Git](https://git-scm.com/downloads/) 和 [Docker（含 Compose）](https://docs.docker.com/get-started/get-docker/) | 本地 Docker 卷 |

桌面应用在本机运行，不要求 Docker、Node.js 或 Python。发布构建目标为 Windows `.exe` 安装包，以及分别适配两种 macOS 芯片的 `.dmg`。没有签名证书的 macOS 构建未经签名，请只打开你信任的安装包。首次打开后创建账号，保存一次性恢复码。详见[桌面安装与备份](docs/self-hosting.zh-CN.md#桌面应用)。

使用 Docker Compose 时，Windows 打开 PowerShell，macOS/Linux 打开终端。Windows 或 macOS 用户先安装并启动 Docker Desktop，然后执行：

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up -d --build
```

首次构建需要下载依赖，可能花几分钟。完成后：

1. 打开 **[http://localhost:3000](http://localhost:3000)**。
2. 创建首个账号并保存一次性恢复码；之后注册入口会自动关闭。
3. 添加持仓或自选标的，再去「**每日分析**」生成基础报告。

默认 Compose 使用空白数据库和自动生成的私有密钥，没有演示账号。如需查看虚构持仓，可另行运行 `docker compose -f docker-compose.demo.yml up -d --build` 启动可选演示；打开 [http://localhost:3001](http://localhost:3001)，使用 `demo` / `demo1234` 登录。请将演示数据与真实记录分开。新行情请求使用公共数据源，可能延迟或暂时不可用。

旧版默认演示用户切换前请阅读[迁移说明](docs/self-hosting.zh-CN.md#可选的虚构演示)；新的干净安装不会自动导入旧演示卷。

打不开页面？先运行 `docker compose ps` 和 `docker compose logs --tail=80 app`。[本地部署指南](docs/self-hosting.zh-CN.md)覆盖 Docker 未启动、端口占用、下载慢和安全重启等常见问题。

## 第一次怎么玩

1. **认识你的组合。** 保存账号的一次性恢复码。可以手动添加持仓，也可以[导入 CSV](docs/import.md)。如需先探索界面，可使用独立的虚构演示数据。
2. **跑一份分析。** 在「每日分析」选择股票或组合。未配置模型时，基础报告会展示可用行情、敞口检查和数据缺口，并明确标记分析模式。
3. **搭建你的 Agent。** 在「智能体搭建」选择持仓守护、关注探索或均衡模板，设置价格条件与仓位限额，预览后启用。相关市场开市且行情可用时，即可运行扫描。
4. **把你的观点带进团队。** 在「投研讨论室」从七种角色模板选择 2–6 位 AI，为每位成员选择本地 A2A Agent 或已保存的模型连接，定制性格和研究方向。他们依次研究、质疑和回应，你随时插话；报告整齐保存在侧栏。讨论留言不会直接下单。
5. **查看结果、留下复盘。** 在「AI 模拟盘」查看订单，在「交易复盘」记录投资笔记。已激活的 Builder 扫描可使用与候选精确匹配的当前审批，但仍须经过模拟盘风控。真实交易始终由你决定并在券商操作。

规则预览用于解释触发条件，不是历史回测。真实成交的手动回录用于对比记录，不会自动修改持仓或交易流水。

## 先免费上手，再按需接入 AI

下表适用于两种本地安装。若安装者显式配置全局模型 Key，它可以成为该安装中账号的默认模型。

| 配置方式 | 可以使用什么 |
|---|---|
| **不填任何 API Key** | 公共行情、持仓管理、基于规则的基础分析，以及按明确价格条件和风控规则运行的模拟盘。基础报告采用「观察／低置信度」结论，不生成 AI 辩论或预测目标价。 |
| **填写自己的模型 Key** | 多空研究与可定制的 2–6 人团队，逐轮讨论、引用出处并保存报告。可选联网检索使用已保存的 DeepSeek 连接，另设请求次数上限。 |
| **接入本地 A2A Agent** | 把讨论室任务交给已有 Agent 运行环境，由它使用自己的研究工具。仓库提供可选的 Codex CLI 桥接器，但桌面安装包不捆绑该运行环境；也能注册其他 A2A 1.0 JSON-RPC Agent。需要单独配置并使用 Agent 自己的凭证。 |
| **可选填写 Finnhub Key** | 为研究补充可用的美股公司指标与新闻，实际覆盖取决于供应商和套餐。 |

「**设置**」内有配置教程和连接测试。个人模型连接支持兼容 OpenAI Chat Completions 的公共 HTTPS 接口。OpenRouter 的免费模型预填仍需要你自己的 Key；服务商可能限额或收费。也可以显式配置全局模型，详见[默认配置的工作方式](docs/privacy.zh-CN.md#基础模式与运营者提供的模型)。

**本地 Agent 团队：**Squabble 通过 A2A 下发任务、接收进度并整理报告，本地 Agent 自己完成研究，按[接入教程](docs/local-agents.md)配置即可。仓库中的可选桥接器支持 Codex，尚未提供原生 Claude CLI 适配器。本地运行通常仍使用云端模型；标准 A2A 无法强制限制外部 Agent 的内部 Token 开销，因此委派前需要关闭 Squabble 研究预算，未返回的用量会标为未知。

**研究有预算，交易有节奏。** 研究限额默认开启，可在「**设置**」一键关闭；用量仍会记录，供应商也可能收费。默认 Token 限额为每日 60,000、每月 600,000、每任务 24,000；单次输入 6,000、输出 1,000，每任务最多 8 次调用、每日 30 次。日／月周期按 UTC 重置。Builder 默认每 5 个工作日复核、滚动 7 天最多 2 笔订单、同股冷静期 3 个工作日、7 日换手上限 10%；目前不排除交易所节假日。[投委会、预算与执行指南](docs/investment-council.zh-CN.md)说明保守计费、暂停／重启和独立的 OCR 调用边界。

**当前研究能力的边界：**内置采集器尚未提供经过核验的财务报表。基本面或新闻证据缺失时，新生成的 AI 报告也会保留「观察／低置信度」，不给出目标价。演示中的买入评级与目标价是虚构示例。你可以先用明确的价格规则试验模拟盘，随着数据覆盖完善再扩展研究。

新报告使用启动分析时选定的语言。报告展示证据、书面论点与执行步骤，不读取模型隐藏推理。市场情绪分数根据股指涨跌估算，不是官方情绪指数。

## 选一个属于你的工作台

**经典工作室、像素街机、漫画俱乐部、轨道空间站**，四套牛熊吉祥物主题，每套都有深浅两种模式。从顶部调色盘或设置页即可切换。网页布局适配手机宽度；默认本地 Compose 只允许本机访问。

<details>
<summary><b>看看四套主题</b></summary>

![四套吵股主题](docs/screenshots/themes.png)

截图展示示例组合与报告，不代表实际投资表现。[外观说明](docs/appearance.md)。

</details>

## 数据放在哪里，由你选择

两种受支持的安装方式均将数据库保存在你的电脑上。桌面应用使用吵股应用数据目录，Docker Compose 使用命名卷。吵股不运营托管账号或同步服务。升级或换电脑前请备份数据。

AI 分析会向所配置的模型供应商发送相关上下文，公共行情与可选通知也会出网。LLM/Finnhub Key 加密存储，服务端使用时会解密。完整的数据边界与现有控制见[数据与隐私说明](docs/privacy.zh-CN.md)。

| 你的目标 | 从这里开始 |
|---|---|
| 安装 Windows 或 macOS 桌面应用 | [桌面安装与备份](docs/self-hosting.zh-CN.md#桌面应用) |
| 运行干净的本地 Docker 应用 | [Docker Compose 安装与排错](docs/self-hosting.zh-CN.md#docker-compose) |
| 修改应用、参与开发 | [开发指南](docs/development.md) |

公网服务器部署[不是受支持的安装方式](docs/public-deployment.zh-CN.md)。

## 继续探索

[全部文档 →](docs/README.md)

- [持仓导入](docs/import.md)：CSV 与可选的截图提取。
- [投委会](docs/investment-council.zh-CN.md)：团队配置、研究讨论、预算和低频模拟交易。
- [系统架构](docs/architecture.md)：Web 应用、分析流水线与可选 Python Agent 如何配合。
- [参与贡献](CONTRIBUTING.md)：一起改善首次使用、数据覆盖、Agent 规则与翻译。
- [安全报告](SECURITY.md)：私下报告漏洞。

**接下来的重点：**核验研究数据、用户数据导出／删除及持久化分析任务。这些是规划中的能力。欢迎[告诉我们你第一次使用时卡在哪里](https://github.com/Lueyu/squabble/issues/new/choose)。如果吵股对你有用，点一颗 Star，帮助更多人发现它。

吵股是「炒股」的谐音。牛牛和熊熊可以各执己见，最后拍板的人是你。

[MIT 开源](LICENSE)。用于个人研究、记录与试验；研究输出不构成投资建议，模拟盘结果不代表真实收益。
