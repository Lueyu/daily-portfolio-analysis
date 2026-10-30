# Investment council and research room

[简体中文](investment-council.zh-CN.md) · [Documentation](README.md) · [Privacy](privacy.md)

Build a small research team in **Agent Builder**, discuss a stock in the **Research room**, and keep each conclusion with its evidence. An enabled council also reviews candidates produced by your active paper strategy. It does not connect to a broker or execute real trades.

## Configure the team

Each council has exactly three roles:

| Member | Job | Default model tier |
|---|---|---|
| Researcher | Build a case from the available evidence. | Fast |
| Challenger | Independently look for missing facts, downside and reasons to wait. | Fast |
| Portfolio manager | Combine the two published views into approve, wait or reject. | Slow |

You can change names, research preferences and each member's fast/slow tier. These tiers use the models configured in **API Settings**; they do not select a new provider per member. Members share the saved evidence snapshot. The researcher and challenger work independently before the manager reviews their opinions. Their permissions do not include arbitrary tools, changing trade direction or size, or sending orders.

For a free starting point, turn off the council and leave custom AI review instructions empty. Basic analysis, public quotes and explicit investor-authored price rules can work without a model key. Enabling the council requires a configured model to activate that Builder profile. Opening a discussion without a model produces an honest basic **wait** report, without simulated AI member messages. A provider's “free” model is still subject to its own key requirements, availability, limits and pricing.

## Discuss and keep the report

1. Save a Builder profile, then open **Research room** and create a discussion for that profile and ticker.
2. Creating a discussion starts one research round. The central chat shows member replies; the composer stays at the bottom. The page polls for completed messages rather than streaming individual tokens.
3. Add your own view at any time. Sending a note after a completed round starts another bounded round, with the previous conclusions as context. During research, your note steers the current discussion within its existing budget. Enter sends, Shift+Enter adds a new line, and selecting Chinese input does not send accidentally. Paused or failed rooms require an explicit resume.
4. Pause when needed. A provider request already in flight may finish and incur usage, but a paused or obsolete revision cannot become current approval.
5. Reports are organized in the right sidebar (the Reports button on small screens). Open a version to read its conclusions, dissent, evidence and related report or paper-order links. Each discussion freezes the profile configuration and version; after editing the profile, start a new discussion to use that version.

A note can contain up to 2,000 characters; a discussion accepts up to 30 user notes. Automatic work makes at most three revision attempts. Continuing or pausing does not reset that discussion's task budget. Short evidence excerpts go to the model, while the full collected snapshot and complete user notes remain in the instance database. Long user instructions can reach the input cap and produce a wait result.

For supported US stocks, a saved Finnhub key enables valuation metrics, recent company news and reported financial statements with filing dates and SEC references. Access and completeness depend on the endpoint and subscription; a successful connection test does not guarantee every field. Missing balance-sheet items, stale filings, unsupported markets, provider permissions and network errors are identified separately. Available facts remain in the report. Research-driven approval is withheld when critical evidence is missing. An explicitly configured price-rule candidate can be assessed as **rule-only**, with gaps disclosed; this is not an AI price forecast.

Starting or explicitly resuming a discussion collects fresh data using the current API settings. Each published report retains its original evidence snapshot. An unrelated portfolio or FX failure no longer prevents stock research, although portfolio sizing remains unavailable. Continuing does **not** reset token usage: a task limit, daily limit, provider rate limit and provider account balance are distinct errors with separate remedies.

## How a conclusion can affect paper trading

The discussion's **Start**, **Continue**, **Pause** and message actions only affect research. They never place an order. A discussion created by hand has no executable candidate attached.

An active Builder scan first produces a deterministic candidate from the profile's rules. When council review is enabled, the service reviews that exact ticker, side, quantity and reference price. Only a current approval for that candidate and profile version can proceed to the normal paper-order checks. The transaction rechecks the current session revision, approval age, fresh quote, price movement, account state and risk/cadence limits. A used approval cannot fund another order. The approved report is linked to the resulting paper order when it is filled.

Waiting, rejected or unavailable results are cached for equivalent evidence and price regimes to avoid repeatedly paying to veto the same idea. A cached approval still requires the exact candidate and current revision. New information does not guarantee immediate automatic reruns: the scan cadence also applies. Any real trade remains a separate manual action at your broker.

## Default trading cadence

These settings apply to active Builder scans, including manually triggered scans. They complement the existing order-size, daily-count, daily-loss, cash and position checks.

| Limit | Default |
|---|---|
| Routine review interval | 5 weekdays |
| Orders | At most 2 in a rolling 7-day window |
| Same-ticker cooldown | 3 weekdays |
| Turnover | At most 10% of current paper equity in the rolling 7-day window |

The review interval uses each market's local date. Changed profile/research/position inputs can make a review due earlier, but automatic reviews are coalesced to at most one per profile and ticker per local day, including unsuccessful reviews. Weekly caps are account-wide, and pending approvals reserve capacity. “Trading days” currently means Monday–Friday; exchange holidays are not excluded. This is a low-frequency simulator, not a holiday-aware execution calendar.

## Budget and usage

**Research budget** is available from Agent Builder and Settings. Limits are saved per account and checked before requests through the shared server LLM client, including provider retries and connection tests. All council members and revisions in a discussion share one task identifier.

| Setting | Default |
|---|---:|
| Tokens per UTC day | 60,000 |
| Tokens per UTC month | 600,000 |
| Tokens per task | 24,000 |
| Input tokens per call | 6,000 |
| Output tokens per call | 1,000 |
| Calls per task | 8 |
| Calls per UTC day | 30 |

The server conservatively estimates input from UTF-8 bytes and reserves capacity for the request plus its output cap. This can stop a long prompt earlier than a provider's tokenizer would. Reported provider usage replaces the reservation when available; failures or missing usage retain the conservative reserved amount. In-flight and interrupted work therefore still counts. Daily and monthly periods reset at **UTC** boundaries; the task allowance does not reset with them. Budget caps stop later requests; they cannot undo a request already accepted or enforce a provider's billing system.

Optional input/output prices are your estimates in USD per million tokens. If either is absent, estimated cost stays unknown. The number shown is not a provider invoice and actual charges may differ. Screenshot recognition/OCR uses a separate path and is **not covered by this LLM budget**. This feature does not promise free or unlimited agent chat.

Users can change their own limits. These account budgets are not an operator-wide spending ceiling for a shared server API key. Operators should also set limits at the provider; all users' usage can accrue to that key.

## Storage and operation

Messages, member preferences, frozen profile configuration, full evidence snapshots and report versions persist in the instance database. Model providers receive the selected evidence excerpts, candidate and profile context, full user notes included in the request, and previous member opinion excerpts. Budget records keep model/task identifiers, token counts, status and timestamps; the budget ledger does not itself store prompt bodies. Hosting operators can access their database and server secrets. See [Privacy and data flow](privacy.md).

The supported deployment remains a **single application instance**. Restarting it marks unfinished council sessions paused and invalidates their previous revision; it does not resume model work automatically. Startup recovery currently pauses all running council rows, so multiple live replicas are not supported as a durable job queue. Resume deliberately after a restart, remembering that previously reserved or spent task usage remains counted.
