import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthRateLimiter } from './auth-rate-limiter';

test('registration status is a public GET endpoint', async () => {
  const auth = { getRegistrationStatus: async () => ({ registrationOpen: true }) } as AuthService;
  const controller = new AuthController(auth, new AuthRateLimiter());
  assert.deepEqual(await controller.registrationStatus(), { registrationOpen: true });
  const handler = AuthController.prototype.registrationStatus;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'registration-status');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.GET);
});

const url = process.env.AUTH_TEST_DATABASE_URL;
const password = 'test-first-user-password-123';

/** Every test uses its own schema, so it cannot alter accounts in the supplied database. */
async function createAuthDatabase() {
  const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(url!, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema "${schema}"`);
  const client = postgres(url!, { max: 8, connection: { search_path: schema } });
  try {
    await client.unsafe(`create table users (
      id uuid primary key default gen_random_uuid(),
      username varchar(32) not null unique,
      password_hash text not null,
      recovery_code_hash text,
      session_version integer not null default 0,
      display_name varchar(64),
      email_notify varchar(255),
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    )`);
  } catch (error) {
    await client.end();
    await admin.unsafe(`drop schema "${schema}" cascade`);
    await admin.end();
    throw error;
  }
  return {
    client,
    async close() {
      await client.end();
      await admin.unsafe(`drop schema "${schema}" cascade`);
      await admin.end();
    },
  };
}

test('first-user registration status closes after the first account', { skip: !url }, async () => {
  const { client, close } = await createAuthDatabase();
  const beforeMode = process.env.REGISTER_ENABLED;
  const beforeJwt = process.env.JWT_SECRET;
  process.env.REGISTER_ENABLED = 'first-user';
  process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
  try {
    const auth = new AuthService(drizzle(client));
    assert.deepEqual(await auth.getRegistrationStatus(), { registrationOpen: true });
    await auth.register({ username: 'owner', password });
    assert.deepEqual(await auth.getRegistrationStatus(), { registrationOpen: false });
    await assert.rejects(() => auth.register({ username: 'second', password }),
      /Registration is closed/);
  } finally {
    if (beforeMode === undefined) delete process.env.REGISTER_ENABLED;
    else process.env.REGISTER_ENABLED = beforeMode;
    if (beforeJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = beforeJwt;
    await close();
  }
});

test('concurrent first-user registrations across service instances create one account', { skip: !url }, async () => {
  const { client, close } = await createAuthDatabase();
  const beforeMode = process.env.REGISTER_ENABLED;
  const beforeJwt = process.env.JWT_SECRET;
  process.env.REGISTER_ENABLED = 'first-user';
  process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
  try {
    const first = new AuthService(drizzle(client));
    const second = new AuthService(drizzle(client));
    const results = await Promise.allSettled([
      first.register({ username: 'owner-one', password }),
      second.register({ username: 'owner-two', password }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const [row] = await client`select count(*)::integer as count from users`;
    assert.equal(row.count, 1);
  } finally {
    if (beforeMode === undefined) delete process.env.REGISTER_ENABLED;
    else process.env.REGISTER_ENABLED = beforeMode;
    if (beforeJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = beforeJwt;
    await close();
  }
});

test('registration status follows explicit open and closed modes', { skip: !url }, async () => {
  const { client, close } = await createAuthDatabase();
  const beforeMode = process.env.REGISTER_ENABLED;
  try {
    const auth = new AuthService(drizzle(client));
    process.env.REGISTER_ENABLED = 'false';
    assert.deepEqual(await auth.getRegistrationStatus(), { registrationOpen: false });
    process.env.REGISTER_ENABLED = 'true';
    assert.deepEqual(await auth.getRegistrationStatus(), { registrationOpen: true });
  } finally {
    if (beforeMode === undefined) delete process.env.REGISTER_ENABLED;
    else process.env.REGISTER_ENABLED = beforeMode;
    await close();
  }
});
