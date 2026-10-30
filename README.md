English | [简体中文](README.zh-CN.md)

<div align="center">

<img src="client/public/logo.svg" width="96" alt="吵股 Squabble logo" />

# 吵股 Squabble

**Let your AI analysts argue. You decide.**

An open-source portfolio terminal where a team of AI analysts — a bull, a bear,
a critic, a risk gate and a PM — **debates your holdings into research
reports**. A guided Agent Builder turns your preferences into an isolated paper
trading strategy and sends ideas for real trades you execute yourself.

Self-hosted. No phone number, no email verification, zero telemetry — see
[our privacy stance](docs/privacy.md).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

![Dashboard](docs/screenshots/dashboard.png)

<details>
<summary><b>More screenshots</b> (paper trading · daily analysis · deep research report)</summary>

![AI paper trading](docs/screenshots/paper-trading.png)
![Daily analysis](docs/screenshots/daily-analysis.png)
![Deep research report](docs/screenshots/deep-report.png)

</details>

## What it does

| | |
|---|---|
| 🗣️ **AI-Debated Research Reports** | Pick any stock. A bull and a bear argue over it — every point must cite evidence — a critic overturns the weak claims, your risk rules run as hard gates, and a PM rolls it into a **14-section research report**. Re-run it and you can see how the view changed, and *why*. Daily health checks, watchlist scans, journals and realized P&L included. |
| 🤖 **Guided Agent Builder** | Pick a guard, scout or balanced template; select symbols, optional per-symbol buy/sell price triggers, a minimum research rating and explicit paper risk limits. Preview the rules, activate one versioned profile, then run a scan or let the scheduled bot scan. Investor-set price triggers can produce paper ideas even when research data is unavailable; they are labeled as your rules, not AI findings. A free-text preference can veto a candidate when you configure an LLM; it cannot change an order or override a limit. |
| 🧪 **Paper first, real trades by hand** | Filled paper orders can produce proposals in an inbox and optional Webhook / Bark / Server酱 / SMTP / Telegram notifications. You place any real trade in your own broker, then skip the proposal or record the actual time, size, price and fees. This manual record is a comparison ledger and does not update holdings or transactions. No real-broker execution path exists. |
| 🗣️ **Evidence-aware research** | Missing financials, news or valuation inputs are labelled unavailable, excluded from debate citations and lower the final recommendation's confidence. Portfolio risk checks convert currencies before computing exposure; unverified rules are reported as such. |
| 🔒 **Self-hosted data** | Accounts, holdings, prompts and proposal history live in your PostgreSQL database. No telemetry; username and password suffice. Research and optional AI review send selected context to your configured LLM, while quotes and notifications contact their respective providers. |
| 🔑 **Your API settings** | In **Settings**, save an OpenAI-compatible LLM endpoint, model IDs and API key for your own account. Optionally add a Finnhub key for US-company financial metrics and news in research. The page includes provider setup guides and connection tests. Keys are encrypted in your database and are never returned by the settings API. |

## Try it in 5 minutes

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up --build
```

Open **http://localhost:3000** and log in with the built-in demo account
(**demo / demo1234** — one click fills it on the login page). You get a
fictional portfolio to explore: 6 holdings across US/HK/CN markets, 3
completed agent runs (including a two-version NVDA report where the rating
upgraded Hold → Buy, with the losing bear argument preserved), and one
triggered risk gate. The demo account is seeded by the database initializer —
change or drop it for a public deployment.

**No API keys needed** to explore the seeded demo. Fresh research requires your
own OpenAI-compatible LLM key, entered under **API Settings**
after login or supplied through `DOUBAO_API_KEY` by the host. The optional
Agent Builder prompt also requires that key; its explicit trading rules work
without it. An optional [Finnhub](https://finnhub.io/docs/api) key adds
US-company metrics and news to research. Market quotes still come from public
providers and may be delayed or unavailable. Details:
[self-hosting guide](docs/self-hosting.md).

> 🧡 The app is free and open source. External LLM and market-data providers
> may charge for usage under your own account and plan.

## Roadmap

- ✅ Multi-agent research reports (bull/bear debate, critic, risk gates, versioned)
- ✅ One-command Docker demo with fictional data
- ✅ **First-party accounts** — username + password (bcrypt), JWT sessions, no phone number, no email verification, registration toggle via env
- ✅ **AI paper trading** — signal-driven watchbot with hard guardrails (daily-loss circuit breaker, per-order/per-day caps), market-clock aware, and push notifications on fills (Webhook / Bark / Server酱 / SMTP / Telegram); **MCP server** for connecting external AI agents (Claude / ChatGPT) with per-agent spending limits, read/trade permissions and approval modes
- ✅ **Beginner Agent Builder** — versioned templates and explicit limits, behavior preview, one active profile, paper proposals, optional push, and manual real-execution recording
- ✅ **Per-user API settings** — guided OpenAI-compatible LLM and Finnhub setup, encrypted keys, and connection tests
- ✅ **Portfolio import** — generic CSV with auto column mapping + GBK support, broker presets (Robinhood / Futu / Tiger / Xueqiu), and broker-screenshot OCR powered by your own multimodal key
- 🔜 **Desktop app** — one-click installer; download counts via GitHub Releases, no telemetry

## FAQ

<details>
<summary><b>Is it free?</b></summary>

Yes — MIT-licensed open source. Your chosen LLM or financial-data provider may
charge for API usage, including connection tests, according to its plan.

</details>

<details>
<summary><b>Where does my data go?</b></summary>

Your account data lives in the PostgreSQL on your own machine. Running research
sends selected context to your LLM provider and, if you configure Finnhub,
requests US-company data from Finnhub. Quote providers and any notification
channel you configure also receive requests. The full breakdown is in
[docs/privacy.md](docs/privacy.md) — every claim is verifiable against the
open source code.

</details>

<details>
<summary><b>Does it place real trades?</b></summary>

No. Squabble executes **paper orders only** in dedicated tables. It can notify
you of a proposal for a real trade; you decide whether to place it in your own
broker and may record the fill yourself. The proposal record does not place a
broker order or alter your portfolio transactions.

</details>

<details>
<summary><b>Can I use it on my phone?</b></summary>

Yes — the web app is a PWA with mobile layouts and "add to home screen"
support.

</details>

<details>
<summary><b>Which markets does it support?</b></summary>

US, HK and CN, with multi-currency sub-accounts (USD / HKD / CNY) consolidated
via FX conversion.

</details>

<details>
<summary><b>Why the name?</b></summary>

吵股 (chǎo gǔ) is a homophone of 炒股 ("trading stocks") where 吵 means "to
argue" — because that's literally what the product does: AI analysts arguing
over your stocks until a rating survives. The logo is a bull bubble calmly
typing its case while the bear bubble shouts back.

</details>

## Documentation

- [Self-hosting guide](docs/self-hosting.md) — Docker, environment variables, backup & restore, reverse proxy
- [Privacy](docs/privacy.md) — exactly what data exists and what leaves your machine
- [Portfolio import guide](docs/import.md) — CSV, Robinhood CSV and broker-screenshot OCR
- [Architecture](docs/architecture.md) — components, request flow, multi-agent pipeline, data model
- [Development guide](docs/development.md) — running from source, lint/tests, the Python agent, design tokens
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)

## Disclaimer

This project is for personal record-keeping and learning only. It does not
constitute investment advice; paper trading outcomes do not predict real
results. Gains and losses resulting from its use are the sole responsibility
of the user.

## License

[MIT](LICENSE)
