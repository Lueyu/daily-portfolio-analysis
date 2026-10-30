import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { AuthRateLimiter } from './auth-rate-limiter';

test('login and registration limits are independent and scoped by remote address', () => {
  const limiter = new AuthRateLimiter();
  const request = (ip: string) => ({ ip }) as Request;
  for (let index = 0; index < 15; index += 1) limiter.consume(request('192.0.2.1'), 'login');
  assert.throws(() => limiter.consume(request('192.0.2.1'), 'login'), (error: unknown) =>
    Boolean(error && typeof error === 'object' && 'status' in error && error.status === 429));
  limiter.consume(request('192.0.2.2'), 'login');
  for (let index = 0; index < 5; index += 1) limiter.consume(request('192.0.2.1'), 'register');
  assert.throws(() => limiter.consume(request('192.0.2.1'), 'register'));
  for (let index = 0; index < 5; index += 1) limiter.consume(request('192.0.2.1'), 'recover');
  assert.throws(() => limiter.consume(request('192.0.2.1'), 'recover'));
});
