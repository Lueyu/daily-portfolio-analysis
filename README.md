English | [简体中文](README.zh-CN.md)

<div align="center">

<img src="client/public/logo.svg" width="88" alt="Squabble" />

# Squabble · 吵股

**Let your AI argue. You decide.**

An open-source investing workspace where a bull, a bear and a critic
challenge your ideas — then you make the call.

**US · HK · China A-shares** · **English / 中文** · **Self-hosted** · **Zero telemetry**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Lueyu/squabble/actions/workflows/ci.yml/badge.svg)](https://github.com/Lueyu/squabble/actions/workflows/ci.yml)

</div>

![Squabble dashboard](docs/screenshots/dashboard-en.png)

## Why Squabble?

Most portfolio trackers stop at *showing* numbers. Squabble argues about them.

- 🗣️ **Multi-agent research** — A bull and a bear debate over your holdings, a critic overturns the weak arguments, your risk rules run as hard gates, and a PM writes the final call into a 14-section report.
- 🤖 **AI paper trading** — An isolated virtual account where your AI watches markets around the clock, trades on your research signals, and pushes a notification every time it fills. Connect Claude or ChatGPT via MCP with per-agent spending limits.
- 🔒 **Your data stays yours** — Self-hosted, zero telemetry, username+password only. No phone number, no email verification.

## Quick Start

**Docker** (recommended, no API keys needed):

```bash
git clone https://github.com/Lueyu/squabble.git
cd squabble
docker compose up -d --build
```

Open **http://localhost:3000** → sign in with `demo` / `demo1234`.

**From source** (for development):

```bash
git clone https://github.com/Lueyu/squabble.git && cd squabble
npm install
npm run dev
```

## What it does

| | |
|---|---|
| 📊 **Portfolio tracking** | US/HK/CN holdings, cash, P&L and net-value curves with USD/HKD/CNY conversion. |
| 🗣️ **AI research reports** | Bull/bear debate → critic review → risk gates → 14-section report. Versioned, with the losing argument preserved. |
| 🤖 **Paper trading** | Signal-driven bot with hard guardrails (daily-loss circuit breaker, per-order caps). Manual and MCP agent orders supported. |
| 📸 **Portfolio import** | CSV with auto column mapping (5 broker presets) and screenshot OCR via your own multimodal key. |
| 🔔 **Notifications** | Webhook / Bark / Server酱 / SMTP / Telegram — every fill, risk rejection and circuit breaker, pushed to you. |

## Connect your AI assistant

Squabble ships with an MCP server. Give Claude or ChatGPT your paper account:

1. Open **AI Paper Trading → AI Agents → Connect Agent**
2. Copy the MCP URL and token into your assistant's MCP settings
3. Ask it to *"check my portfolio"* or *"buy 100 shares of NVDA"*

Each agent gets its own spending limit, read/trade permission and approval mode. Orders can auto-fill or wait for your tap.

## Privacy

Self-hosted, zero telemetry. The only outbound requests are ones you make with your own API keys. [Full breakdown →](docs/privacy.md)

## Docs

[Setup & troubleshooting](docs/self-hosting.md) · [Server deployment](docs/public-deployment.md) · [Import guide](docs/import.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md) · [Contributing](CONTRIBUTING.md)

---

吵股 (*chǎo gǔ*) sounds like "trading stocks" in Chinese, but 吵 means "argue." The bull and bear have opinions. You make the call.

[MIT](LICENSE) · Research outputs are not investment advice; paper results do not predict real returns.
