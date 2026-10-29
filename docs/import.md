# Portfolio Import Guide

Three flows share one rule: **nothing is written until you confirm the
preview**. Every import is recorded in history with per-row reasons for
anything skipped.

## Generic CSV

1. Open **持仓导入** in the sidebar, choose **CSV 文件**.
2. Pick your file. CSVs exported by any broker or spreadsheet app work —
   common column names (`symbol/ticker/股票代码`, `quantity/股数`,
   `cost/均价` …) are auto-detected; fix the mapping in the dropdowns if a
   column is misidentified.
3. If Chinese text renders as garbage, switch the encoding selector to
   **GBK** (common for domestic broker exports) and re-select the file.
4. Confirm the preview and import. Existing tickers are **skipped, never
   merged** — edit those positions on the holdings page instead.

## Robinhood CSV

Same flow with the **Robinhood 导出** preset selected — known headers
(`Symbol`, `Quantity`, `Cost Basis` …) are mapped automatically.

## Screenshot OCR

The killer flow for brokers that can't export at all:

1. Take a screenshot of your broker app's holdings page
   (同花顺 / 东方财富 / 雪球 / 富途 / 老虎 / Robinhood …).
2. Choose **截图识别**, configure your own multimodal model — any
   OpenAI-compatible vision endpoint works (Ark `doubao-1.5-vision-pro`,
   OpenAI `gpt-4o-mini`, …).
3. Hit **开始识别**, review the editable extraction, then import.

**Privacy** (see [privacy.md](privacy.md)): your API key and model config
are stored only in your browser (same pattern as the market-data token) and
sent per-request; the server never persists them. The screenshot goes from
your deployment straight to the LLM provider **you** chose — nowhere else.
