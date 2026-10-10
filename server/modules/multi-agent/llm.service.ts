/**
 * LlmService — thin wrapper around the Doubao (Volcengine Ark) chat-completions
 * HTTP API.
 *
 * Responsibilities:
 *  - Read model/baseURL/API key from environment variables (DOUBAO_API_KEY,
 *    DOUBAO_BASE_URL, DOUBAO_MODEL_FAST, DOUBAO_MODEL_SLOW).
 *  - Expose four entry points: chatFast / chatSlow (free text) and
 *    chatFastJSON / chatSlowJSON (JSON output).
 *  - Apply exponential-backoff retries (max 2 retries, delays 1s, 2s) on any
 *    network/HTTP error.
 *  - Time out each call after 60s via AbortController.
 *  - For JSON calls, strip markdown code fences and attempt a regex brace-scan
 *    fallback when the first JSON.parse fails (LLMs occasionally wrap JSON in
 *    prose or emit trailing commas).
 *
 * Two model tiers:
 *  - fast (doubao-lite-4k by default): cheap, low-latency, good for simple tasks.
 *  - slow (doubao-pro-32k by default): higher quality, larger context; used for
 *    debate, critique, and rating aggregation.
 */
import { Injectable, Logger } from '@nestjs/common';

/** A single chat-completion message in OpenAI-compatible format. */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The raw content + token usage returned by a chat call. */
interface ChatResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelFast: string;
  private readonly modelSlow: string;
  private readonly timeoutMs = 60_000;
  /** Number of retries after the initial attempt (so max total = 1 + 2 = 3). */
  private readonly maxRetries = 2;

  constructor() {
    this.apiKey = process.env.DOUBAO_API_KEY ?? '';
    this.baseUrl = process.env.DOUBAO_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3';
    this.modelFast = process.env.DOUBAO_MODEL_FAST ?? 'doubao-lite-4k';
    this.modelSlow = process.env.DOUBAO_MODEL_SLOW ?? 'doubao-pro-32k';
  }

  /** @returns true if an API key is configured; false otherwise. */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Throw if the API key is missing; called before every outgoing request. */
  private ensureConfigured(): void {
    if (!this.apiKey) {
      throw new Error('DOUBAO_API_KEY not configured');
    }
  }

  /** Free-text chat on the fast (cheap) model. */
  async chatFast(messages: ChatMessage[]): Promise<ChatResponse> {
    return this.chat(messages, this.modelFast);
  }

  /** Free-text chat on the slow (pro) model. */
  async chatSlow(messages: ChatMessage[]): Promise<ChatResponse> {
    return this.chat(messages, this.modelSlow);
  }

  /** JSON-mode chat on the fast model; returns parsed object + token count. */
  async chatFastJSON(messages: ChatMessage[]): Promise<{ data: unknown; tokens: number }> {
    return this.chatJSON(messages, this.modelFast);
  }

  /** JSON-mode chat on the slow model; returns parsed object + token count. */
  async chatSlowJSON(messages: ChatMessage[]): Promise<{ data: unknown; tokens: number }> {
    return this.chatJSON(messages, this.modelSlow);
  }

  /**
   * Core HTTP call with retry + timeout. Retries on any thrown error (network,
   * non-2xx, abort) up to maxRetries, with exponential backoff (1s, 2s, 4s…).
   * Throws the last error if all attempts fail.
   */
  private async chat(messages: ChatMessage[], model: string): Promise<ChatResponse> {
    this.ensureConfigured();

    const body = {
      model,
      messages,
    };

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 500)}`);
        }

        const result = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const content = result?.choices?.[0]?.message?.content ?? '';
        const usage = result?.usage ?? {};

        return {
          content,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        };
      } catch (error) {
        if (attempt === this.maxRetries) {
          throw error;
        }
        // Exponential backoff: 1s, 2s, 4s… (capped implicitly by retry count).
        const delayMs = 1000 * Math.pow(2, attempt);
        this.logger.warn(`LLM call attempt ${attempt + 1} failed, retrying in ${delayMs}ms: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Unreachable: loop always either returns or throws.
    throw new Error('Unreachable');
  }

  /**
   * JSON-mode wrapper: prepend a system message forcing strict JSON output,
   * then clean + parse the response. Cleaning steps:
   *   1. Strip leading/trailing ```json fences if present.
   *   2. Try JSON.parse directly.
   *   3. On failure, regex-scan for the outermost {…} block and retry parse
   *      (handles LLM prose around the JSON).
   *   4. Still failing → throw with the first 200 chars of the response for debugging.
   */
  private async chatJSON(messages: ChatMessage[], model: string): Promise<{ data: unknown; tokens: number }> {
    const systemMsg: ChatMessage = {
      role: 'system',
      content: '你必须严格按照用户要求的 JSON 格式输出，不要添加任何解释、说明或 markdown 格式。只输出合法的 JSON 字符串。',
    };

    // Preserve any caller-supplied system messages, then append our strict-JSON
    // instruction, then user/assistant messages.
    const userMsgs = messages.filter((m) => m.role !== 'system');
    const systemMsgs = messages.filter((m) => m.role === 'system');

    const allMessages: ChatMessage[] = [...systemMsgs, systemMsg, ...userMsgs];

    const result = await this.chat(allMessages, model);

    let cleaned = result.content.trim();
    // Strip markdown code fences (```json … ```) if the LLM wrapped the output.
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);
      return { data: parsed, tokens: result.totalTokens };
    } catch (parseError) {
      // Fallback: extract the first balanced-looking JSON object from the text.
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return { data: parsed, tokens: result.totalTokens };
        } catch {
          // fall through to final throw
        }
      }
      throw new Error(`Failed to parse LLM JSON response: ${cleaned.slice(0, 200)}`);
    }
  }
}
