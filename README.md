English | [简体中文](README.zh-CN.md)

<div align="center">

<img src="client/public/logo.svg" width="88" alt="Squabble bull and bear mascot" />

# Squabble · 吵股

**Let your AI argue. You decide.**

Build your own investing agent without writing code.
Bring your portfolio, set your rules, and try ideas in paper trading.

**US · Hong Kong · China A-shares** · **English / 中文** · **Self-hosted**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Lueyu/squabble/actions/workflows/ci.yml/badge.svg)](https://github.com/Lueyu/squabble/actions/workflows/ci.yml)

[Start locally](#start-locally) · [What to try](#your-first-session) · [Deploy to a server](docs/public-deployment.md) · [Data & privacy](docs/privacy.md)

</div>

![Squabble portfolio dashboard with fictional demo data](docs/screenshots/dashboard-en.png)

*A fictional demo portfolio, shown in the English interface.*

Squabble gives individual investors one workspace to **understand their holdings, test their rules, and review their decisions**. Start with free basic analysis and public quotes. Connect a model when you want a bull, a bear and a critic to challenge an investment idea.

## Why Squabble?

| You want to… | Squabble helps you… |
|---|---|
| Understand your whole portfolio | Track US/HK/CN holdings, cash and P&L together, with USD/HKD/CNY conversion and a market overview. |
| Build an agent without coding | Choose a template, set symbols, price triggers and risk limits, then preview and activate your paper strategy. |
| See the case on both sides | With a model configured, read bullish and bearish arguments, evidence, critique and risk checks in one report. Missing inputs stay visible. |
| Discuss a decision with your team | Configure a researcher, challenger and portfolio manager; add your own notes in the Research room and keep versioned conclusions with evidence. |
| Keep the final decision | Test in an isolated paper account. Receive optional trade proposals, execute real trades yourself, and record what actually happened. |

## Start locally

**You need [Git](https://git-scm.com/downloads/) and [Docker with Compose](https://docs.docker.com/get-started/get-docker/).** On Windows or macOS, install and open Docker Desktop first. You do not need Node.js, Python, a brokerage connection or an API key for this demo.

Open PowerShell on Windows, or Terminal on macOS/Linux, and run:

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up -d --build
```

The first build downloads dependencies and can take several minutes. When it finishes:

1. Open **[http://localhost:3000](http://localhost:3000)**.
2. Sign in with **`demo` / `demo1234`** — the login page can fill these for you.
3. Explore the sample portfolio, then open **Daily Analysis** to run a new basic report.

The demo includes **fictional holdings and saved example reports**. New quote requests use public providers and may be delayed or unavailable. This Compose file is for local exploration; use the [separate server guide](docs/public-deployment.md) for a clean deployment with private credentials and HTTPS.

Page not loading? Run `docker compose ps` and `docker compose logs --tail=80 app`. The [setup guide](docs/self-hosting.md) covers Docker startup, occupied ports, slow downloads and safe restarts.

## Your first session

1. **Meet your portfolio.** Explore the demo or create your own account. Save the one-time recovery code. Add holdings manually or [import a CSV](docs/import.md).
2. **Run an analysis.** In **Daily Analysis**, choose a stock or portfolio. If neither you nor the server operator has configured a model, you get a clearly labelled basic report with available prices, exposure checks and data gaps.
3. **Build your agent.** In **Agent Builder**, choose a guard, scout or balanced template. Set price triggers and position limits, preview the rules, then activate a profile. Run a scan when its market is open and a usable quote is available.
4. **Bring your view to the team.** Open the **Research room**, choose 2–6 AI members from seven role templates, and assign each to a local A2A agent or a saved model connection. Customize their personality and research focus. They research, challenge and respond; you can join at any time. Reports stay in the sidebar. Discussion messages never place orders.
5. **Review the outcome.** Follow paper orders in **AI Paper Trading** and your investing notes in **Trade Review**. An active Builder scan can use a current council approval for its exact candidate, subject to paper risk checks. Real trades remain your decision and your action at your broker.

Builder preview explains rules; it is not a historical backtest. Manually recording a real fill creates a comparison record and does not automatically update holdings or transaction history.

## Start free; add AI when you want it

These options describe the default local setup. On a hosted instance, a shared model configured by its operator may be used even if you have not entered your own key.

| Setup | What becomes available |
|---|---|
| **No API keys** | Public quotes, portfolio tracking, basic rule-based analysis and explicit price/risk rules for paper trading. Basic reports use a Watch/low-confidence conclusion, without an AI debate or a predicted target price. |
| **Your model API key** | Bull/bear research and a customizable 2–6 member team with sequential discussion, cited sources and saved reports. Optional web research uses a saved DeepSeek connection and has a separate request cap. |
| **Your local A2A agent** | Delegate room tasks to a mature agent runtime with its own research tools. A Codex CLI bridge is bundled; other A2A 1.0 JSON-RPC agents can be registered. Requires separate setup and the agent's own credentials. |
| **Optional Finnhub key** | Available US-company metrics and news for research. Coverage depends on the provider and your plan. |

Open **Settings** for provider instructions and a connection test. The personal model connection supports public HTTPS endpoints compatible with OpenAI Chat Completions. OpenRouter's free-model preset still requires your own key; providers may impose limits or charge for usage. An operator can also configure a shared model — see [how defaults work](docs/self-hosting.md).

**Local agent teams:** Squabble assigns research tasks and collects progress and reports over A2A; the local agent does the research. Follow the [local agent setup guide](docs/local-agents.md). The bundled bridge currently supports Codex, not a native Claude CLI adapter. Local execution usually still uses a cloud model. External agents require the Squabble research budget to be off because standard A2A cannot enforce their internal Token spending; missing usage is shown as unknown.

**Research has a budget; trading has a cadence.** Budget limits are on by default and can be switched off in **Settings**; usage is still recorded and provider charges still apply. Defaults allow 60,000 tokens/day, 600,000/month and 24,000/task, with 6,000 input and 1,000 output tokens/call, 8 calls/task and 30/day. Day/month periods use UTC. Builder defaults review every 5 weekdays, allow 2 orders per rolling 7 days, require a 3-weekday same-stock cooldown and cap 7-day turnover at 10%. Exchange holidays are not excluded. [Council, budget and execution guide](docs/investment-council.md) explains conservative accounting, pause/restart behavior and the separate OCR path.

**Current research boundary:** the built-in collector does not yet supply verified financial statements. Missing fundamental or news evidence keeps live AI reports at Watch/low confidence without a target price. The demo's saved Buy ratings and targets are fictional examples. Explicit price rules let you experiment in paper trading while research coverage grows.

New reports follow the language selected when you start them. Reports show evidence, written arguments and execution steps; they do not expose a model's hidden reasoning. Market mood is an estimate from index changes, not an official sentiment index.

## Make it your workspace

Four mascot-inspired themes, each with light and dark modes: **Classic Studio, Pixel Arcade, Comic Club and Orbital Deck**. Switch from the palette button or Settings. The responsive web layout also works on phones.

<details>
<summary><b>See all four themes</b></summary>

![Four Squabble themes](docs/screenshots/themes.png)

Screenshots show example portfolios and reports; they are not performance claims. [Appearance guide](docs/appearance.md).

</details>

## Choose where your data lives

**Self-hosting comes first.** If you run Squabble yourself, its database is under your control. If you register on someone else's hosted instance, that operator stores and processes your data. Open source does not make a hosted server unable to read it.

AI analysis sends relevant context to the configured model provider; public quotes and optional notifications also make outbound requests. LLM/Finnhub keys are encrypted at rest and decrypted by the server when used. See the [data and privacy guide](docs/privacy.md) for the full boundary and current controls.

| Your goal | Start here |
|---|---|
| Explore on your computer | [Local setup and troubleshooting](docs/self-hosting.md) |
| Run a clean personal instance or invite users on your server | [Single-server deployment with HTTPS](docs/public-deployment.md) |
| Change the app or contribute | [Development guide](docs/development.md) |

The server configuration supports a **single-instance public beta**. It is not a turnkey managed service or a multi-replica production platform; the deployment guide lists what still needs work before wider operation.

## Explore further

[All documentation →](docs/README.md)

- [Portfolio import](docs/import.md) — CSV and optional screenshot extraction.
- [Investment council](docs/investment-council.md) — team configuration, research discussions, budgets and low-frequency paper trading.
- [Architecture](docs/architecture.md) — the web app, analysis pipeline and optional Python agent.
- [Contributing](CONTRIBUTING.md) — help improve onboarding, data coverage, agent rules or translations.
- [Security](SECURITY.md) — report a vulnerability privately.

**Next priorities:** verified research feeds, user data export/deletion, clearer hosted privacy controls, durable analysis jobs and easier installation. These are roadmap items, not current features. Feedback from your first run is especially useful: [tell us where you got stuck](https://github.com/Lueyu/squabble/issues/new/choose). If Squabble is useful to you, a star helps others find it.

吵股 (*chǎo gǔ*) sounds like the Chinese phrase for trading stocks, but 吵 means “argue.” The bull and bear have opinions. You make the call.

[MIT](LICENSE). Built for personal research, record-keeping and experimentation. Research outputs are not investment advice; paper results do not predict real returns.
