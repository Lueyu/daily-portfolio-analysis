English | [简体中文](README.zh-CN.md)

# Daily Portfolio Analysis

A full-stack **stock portfolio terminal** that runs a daily, multi-agent investment workflow:
holdings health checks, watchlist opportunity scans, strategy review, daily snapshots,
investment journals, and institutional-grade **deep research reports** with version history.

![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

## Features

- **Dashboard** — account value, market value, cost, cumulative & daily P&L, grouped by
  custom portfolio groups (e.g. *Alpha Picks* vs. *Self-managed*).
- **Holdings** — per-position rating, action, target price, detail dialogs; responsive
  table on desktop and card view on mobile.
- **Watchlist** — opportunity tracking with entry/target prices and signals.
- **Daily Analysis** — one analysis card per holding/watchlist item: rating badge,
  deep-report tag, action, target price, catalysts and risks, all visually aligned.
- **Multi-Agent Deep Reports** — a 14-section institutional research report
  (thesis, financials, SOTP valuation, bull/bear debate, critic review, risk gates,
  PM decision, ...). Every run is kept as a separate versioned report with a timestamp.
- **Realized P&L** — Robinhood-style realized profit/loss summary on the transactions
  page, aggregated per ticker and per currency, replacing the old closed-positions list.
- **Strategy Rules** — configurable risk-control rules (exposure caps, stop lines,
  leverage limits, cash buffer) used as gates during analysis.
- **Journal & Snapshots** — auto-generated five-part daily journal and net-value curve.
- **Multi-currency** — USD / HKD / CNY sub-accounts with FX conversion.
- **Dark mode**, mobile-safe layout, and PWA "add to home screen" support.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Radix UI, React Router, TanStack Query |
| Backend | NestJS, Drizzle ORM |
| Database | PostgreSQL (row-level isolation per owner) |
| Charts | ECharts / Recharts |
| LLM | Volcengine Ark (Doubao) for the multi-agent pipeline |
| Market data | Finnhub (token stored locally in the browser) |

## Project Structure

```
.
├── client/            # React frontend
│   └── src/
│       ├── pages/     # Dashboard, Holdings, Watchlist, Analysis, Journal, Transactions...
│       ├── components/# Layout, MultiAgent (deep reports), ui (shadcn-style)
│       └── api/       # Frontend API client
├── server/            # NestJS backend
│   ├── database/      # Drizzle schema (auto-generated)
│   └── modules/       # holdings, watchlist, analysis, multi-agent, closed, fx, ...
├── shared/            # Shared API interfaces
├── scripts/           # Dev/build/lint helper scripts
└── .env.example       # Configuration template
```

## Getting Started

### Prerequisites

- Node.js >= 22 and npm >= 10
- A PostgreSQL instance (or the managed platform database)
- Git Bash on Windows (the dev/build scripts are shell scripts)

### Install & configure

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env
#   -> fill in DOUBAO_API_KEY if you want the LLM multi-agent pipeline
#   -> set DATABASE_URL when running against your own PostgreSQL

# 3. Start the dev servers (client + backend together)
npm run dev
#    or separately:
npm run dev:server   # NestJS API
npm run dev:client   # Vite dev server
```

### Production build

```bash
npm run build
npm start
```

## Configuration Notes

- **Market data (Finnhub)**: the token is **never** committed or stored on the server.
  Open the app in a browser and configure your Finnhub token in the UI; it lives in
  that device's `localStorage`.
- **LLM key**: set `DOUBAO_API_KEY` in `.env`. Without it, the backend multi-agent
  pipeline is disabled, but the rest of the app works.
- **Platform toolkit**: the project depends on the `@lark-apaas/*` fullstack platform
  packages for hosting, auth and database wiring. To run fully standalone, replace those
  integration points with your own auth, database connection and build configuration.

## Multi-Agent Deep Reports

Each deep run executes: data collection → **Bull** thesis → **Bear** thesis →
**Critic** challenge → risk-control gates → PM aggregation, producing a 14-section
report. Every run creates a **new versioned report** (new run id, timestamped); the full
history is retained and listed under the analysis view.

## Disclaimer

This software is for personal tracking and educational purposes only. It does not
constitute investment advice. All investment decisions and their consequences are your
own responsibility.

## License

[MIT](LICENSE)
