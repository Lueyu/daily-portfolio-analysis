import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { LlmService } from '../multi-agent/llm.service';
import type { SettingsService } from './settings.service';

test('LLM calls use each authenticated user configuration', async () => {
  const settings = {
    getLlmConfig: async (userId: string) => ({
      source: 'user',
      baseUrl: 'https://api.openai.com/v1',
      fastModel: `fast-${userId}`,
      slowModel: `slow-${userId}`,
      apiKey: `secret-${userId}`,
    }),
  };
  const service = new LlmService(settings as SettingsService);
  const originalAdapter = axios.defaults.adapter;
  const calls: Array<{ url: string; authorization: string; model: string }> = [];
  axios.defaults.adapter = async (config) => {
    calls.push({
      url: String(config.url),
      authorization: String(config.headers?.Authorization),
      model: String(JSON.parse(String(config.data)).model),
    });
    return {
      data: { choices: [{ message: { content: 'OK' } }] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  try {
    await service.chatFast([{ role: 'user', content: 'hi' }], 'alice');
    await service.chatFast([{ role: 'user', content: 'hi' }], 'bob');
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
  assert.deepEqual(calls, [
    {
      url: 'https://api.openai.com/v1/chat/completions',
      authorization: 'Bearer secret-alice',
      model: 'fast-alice',
    },
    {
      url: 'https://api.openai.com/v1/chat/completions',
      authorization: 'Bearer secret-bob',
      model: 'fast-bob',
    },
  ]);
});

test('LLM provider errors do not return an echoed API key', async () => {
  const settings = {
    getLlmConfig: async () => ({
      source: 'user',
      baseUrl: 'https://api.openai.com/v1',
      fastModel: 'test-model',
      slowModel: 'test-model',
      apiKey: 'sensitive-token',
    }),
  };
  const service = new LlmService(settings as SettingsService);
  const originalAdapter = axios.defaults.adapter;
  let calls = 0;
  axios.defaults.adapter = async (config) => {
    calls += 1;
    return {
      data: 'sensitive-token is invalid',
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
    };
  };
  try {
    await assert.rejects(
      () => service.chatFast([{ role: 'user', content: 'hi' }], 'alice'),
      (error: Error) => !error.message.includes('sensitive-token')
        && error.message.includes('401'),
    );
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
  assert.equal(calls, 1);
});
