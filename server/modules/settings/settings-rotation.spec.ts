import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostgresJsDatabase } from '../../common/platform';
import { SettingsService } from './settings.service';
import { encryptSecret } from './settings-security';
import type { QuoteService } from '../quote/quote.service';

const quotes = { getQuote: async () => null } as unknown as QuoteService;

test('rotated master key lets a user reopen Settings and re-enter saved keys', async () => {
  const row = {
    owner: 'alice',
    llmBaseUrl: 'https://api.openai.com/v1',
    llmFastModel: 'gpt-test',
    llmSlowModel: 'gpt-test',
    llmApiKeyEnc: encryptSecret('old-llm-key', 'old-master-secret-long-enough'),
    finnhubApiKeyEnc: encryptSecret('old-finnhub-key', 'old-master-secret-long-enough'),
  };
  const db = {
    select: () => ({ from: () => ({ where: async () => [row] }) }),
  };
  const previous = process.env.SETTINGS_ENCRYPTION_KEY;
  const previousFallback = process.env.DOUBAO_API_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = 'new-master-secret-long-enough';
  process.env.DOUBAO_API_KEY = 'host-fallback-key';
  try {
    const service = new SettingsService(db as unknown as PostgresJsDatabase, quotes);
    const settings = await service.getSettings('alice');
    assert.equal(settings.llm.source, 'user');
    assert.equal(settings.llm.needsReentry, true);
    assert.equal(settings.llm.hasApiKey, false);
    assert.equal(settings.financial.source, 'user');
    assert.equal(settings.financial.needsReentry, true);
    assert.equal(await service.getLlmConfig('alice'), null);
    assert.equal(await service.getFinnhubKey('alice'), null);
    await assert.rejects(() => service.saveLlm('alice', {
      baseUrl: 'https://api.openai.com/v1',
      fastModel: 'gpt-test',
      slowModel: 'gpt-test',
      apiKey: '',
    }));
    await assert.rejects(() => service.saveFinancial('alice', {
      provider: 'finnhub', apiKey: '',
    }));
  } finally {
    if (previous === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previous;
    if (previousFallback === undefined) delete process.env.DOUBAO_API_KEY;
    else process.env.DOUBAO_API_KEY = previousFallback;
  }
});

test('known demo JWT secret cannot encrypt a personal API key', async () => {
  const db = { select: () => ({ from: () => ({ where: async () => [] }) }) };
  const previousKey = process.env.SETTINGS_ENCRYPTION_KEY;
  const previousJwt = process.env.JWT_SECRET;
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.JWT_SECRET = 'change-me-in-production-0123456789abcdef';
  try {
    const service = new SettingsService(db as unknown as PostgresJsDatabase, quotes);
    await assert.rejects(
      () => service.saveFinancial('alice', { provider: 'finnhub', apiKey: 'sample-key' }),
      /SETTINGS_ENCRYPTION_KEY/u,
    );
  } finally {
    if (previousKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previousKey;
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
  }
});
