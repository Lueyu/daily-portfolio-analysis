import { Injectable, Logger } from '@nestjs/common';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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
  private readonly maxRetries = 2;

  constructor() {
    this.apiKey = process.env.DOUBAO_API_KEY ?? '';
    this.baseUrl = process.env.DOUBAO_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3';
    this.modelFast = process.env.DOUBAO_MODEL_FAST ?? 'doubao-lite-4k';
    this.modelSlow = process.env.DOUBAO_MODEL_SLOW ?? 'doubao-pro-32k';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private ensureConfigured(): void {
    if (!this.apiKey) {
      throw new Error('DOUBAO_API_KEY not configured');
    }
  }

  async chatFast(messages: ChatMessage[]): Promise<ChatResponse> {
    return this.chat(messages, this.modelFast);
  }

  async chatSlow(messages: ChatMessage[]): Promise<ChatResponse> {
    return this.chat(messages, this.modelSlow);
  }

  async chatFastJSON(messages: ChatMessage[]): Promise<{ data: unknown; tokens: number }> {
    return this.chatJSON(messages, this.modelFast);
  }

  async chatSlowJSON(messages: ChatMessage[]): Promise<{ data: unknown; tokens: number }> {
    return this.chatJSON(messages, this.modelSlow);
  }

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
        const delayMs = 1000 * Math.pow(2, attempt);
        this.logger.warn(`LLM call attempt ${attempt + 1} failed, retrying in ${delayMs}ms: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Unreachable');
  }

  private async chatJSON(messages: ChatMessage[], model: string): Promise<{ data: unknown; tokens: number }> {
    const systemMsg: ChatMessage = {
      role: 'system',
      content: '你必须严格按照用户要求的 JSON 格式输出，不要添加任何解释、说明或 markdown 格式。只输出合法的 JSON 字符串。',
    };

    const userMsgs = messages.filter((m) => m.role !== 'system');
    const systemMsgs = messages.filter((m) => m.role === 'system');

    const allMessages: ChatMessage[] = [...systemMsgs, systemMsg, ...userMsgs];

    const result = await this.chat(allMessages, model);

    let cleaned = result.content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);
      return { data: parsed, tokens: result.totalTokens };
    } catch (parseError) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return { data: parsed, tokens: result.totalTokens };
        } catch {
          // fall through
        }
      }
      throw new Error(`Failed to parse LLM JSON response: ${cleaned.slice(0, 200)}`);
    }
  }
}
