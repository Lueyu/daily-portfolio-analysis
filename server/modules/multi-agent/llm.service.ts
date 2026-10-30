/**
 * LlmService — per-user OpenAI-compatible chat-completions client.
 *
 * Responsibilities:
 *  - Read each user's encrypted Settings credential, falling back to the
 *    server's legacy Doubao environment variables.
 *  - Expose four entry points: chatFast / chatSlow (free text) and
 *    chatFastJSON / chatSlowJSON (JSON output).
 *  - Apply exponential-backoff retries on network and transient HTTP errors.
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
import axios from 'axios';
import { SettingsService } from '../settings/settings.service';
import { normalizePublicLlmBaseUrl, publicHttpsAgent } from '../settings/settings-security';

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`LLM provider returned HTTP ${status}`);
  }
}

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

interface ProviderChatPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly timeoutMs = 60_000;
  /** Number of retries after the initial attempt (so max total = 1 + 2 = 3). */
  private readonly maxRetries = 2;

  constructor(private readonly settings: SettingsService) {}

  /** @returns true if an API key is configured; false otherwise. */
  async isConfigured(userId: string): Promise<boolean> {
    return (await this.settings.getLlmConfig(userId)) !== null;
  }

  /** Free-text chat on the fast (cheap) model. */
  async chatFast(messages: ChatMessage[], userId: string): Promise<ChatResponse> {
    return this.chat(messages, 'fast', userId);
  }

  /** Free-text chat on the slow (pro) model. */
  async chatSlow(messages: ChatMessage[], userId: string): Promise<ChatResponse> {
    return this.chat(messages, 'slow', userId);
  }

  /** JSON-mode chat on the fast model; returns parsed object + token count. */
  async chatFastJSON(messages: ChatMessage[], userId: string): Promise<{ data: unknown; tokens: number }> {
    return this.chatJSON(messages, 'fast', userId);
  }

  /** JSON-mode chat on the slow model; returns parsed object + token count. */
  async chatSlowJSON(messages: ChatMessage[], userId: string): Promise<{ data: unknown; tokens: number }> {
    return this.chatJSON(messages, 'slow', userId);
  }

  /**
   * Core HTTP call with retry + timeout. Authentication and malformed-request
   * errors return immediately; transient failures retry with backoff.
   * Throws the last error if all attempts fail.
   */
  private async chat(
    messages: ChatMessage[],
    tier: 'fast' | 'slow',
    userId: string,
  ): Promise<ChatResponse> {
    const config = await this.settings.getLlmConfig(userId);
    if (!config) throw new Error('No LLM API key configured');
    const baseUrl = config.source === 'user'
      ? await normalizePublicLlmBaseUrl(config.baseUrl)
      : config.baseUrl.replace(/\/+$/u, '');
    const model = tier === 'fast' ? config.fastModel : config.slowModel;

    const body = {
      model,
      messages,
    };

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await axios.post<ProviderChatPayload>(
          `${baseUrl}/chat/completions`,
          body,
          {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          timeout: this.timeoutMs,
          maxRedirects: 0,
          proxy: false,
          httpsAgent: config.source === 'user' ? publicHttpsAgent() : undefined,
          validateStatus: () => true,
          },
        );
        if (response.status < 200 || response.status >= 300) {
          throw new ProviderHttpError(response.status);
        }

        const result = response.data;

        const content = result?.choices?.[0]?.message?.content ?? '';
        const usage = result?.usage ?? {};

        return {
          content,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        };
      } catch (error) {
        const safeError = error instanceof ProviderHttpError
          ? error
          : new Error('LLM request failed. Check provider URL and server network.');
        if (
          attempt === this.maxRetries
          || (error instanceof ProviderHttpError && error.status < 500 && error.status !== 429)
        ) {
          throw safeError;
        }
        // Exponential backoff: 1s, 2s, 4s… (capped implicitly by retry count).
        const delayMs = 1000 * Math.pow(2, attempt);
        this.logger.warn(`LLM call attempt ${attempt + 1} failed; retrying in ${delayMs}ms`);
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
  private async chatJSON(
    messages: ChatMessage[],
    tier: 'fast' | 'slow',
    userId: string,
  ): Promise<{ data: unknown; tokens: number }> {
    const systemMsg: ChatMessage = {
      role: 'system',
      content: '你必须严格按照用户要求的 JSON 格式输出，不要添加任何解释、说明或 markdown 格式。只输出合法的 JSON 字符串。',
    };

    // Preserve any caller-supplied system messages, then append our strict-JSON
    // instruction, then user/assistant messages.
    const userMsgs = messages.filter((m) => m.role !== 'system');
    const systemMsgs = messages.filter((m) => m.role === 'system');

    const allMessages: ChatMessage[] = [...systemMsgs, systemMsg, ...userMsgs];

    const result = await this.chat(allMessages, tier, userId);

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
