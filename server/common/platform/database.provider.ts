/**
 * First-party database provider: direct postgres.js + Drizzle connection.
 *
 * Replaces the platform datapaas layer. Services keep injecting the same
 * `DRIZZLE_DATABASE` token; the connection now goes straight to PostgreSQL
 * with per-row ownership enforced by the `owner` text column (see
 * server/database/schema.ts) instead of composite types and role switching.
 *
 * `DATABASE_URL` accepts both plain connection strings and legacy strings
 * carrying a `?schema=...` parameter (the parameter is ignored).
 */
import { Global, Module } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../database/schema';

/** DI token used by every business service to receive the Drizzle handle. */
export const DRIZZLE_DATABASE = Symbol('DRIZZLE_DATABASE');

/** Drizzle database handle bound to the table schema. */
export type SquabbleDatabase = PostgresJsDatabase<typeof schema>;

/** Re-exported so services can type their injected handle. */
export type { PostgresJsDatabase };

/** Strip legacy `?schema=` parameters from platform-era connection strings. */
function normalizeConnectionString(raw: string): string {
  if (!raw.includes('schema=')) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete('schema');
    return url.toString().replace(/\?$/, '');
  } catch {
    return raw;
  }
}

/** Open the postgres.js pool and wrap it in Drizzle. Exposed for tests. */
export function createDatabase(connectionString?: string): SquabbleDatabase {
  const raw = connectionString ?? process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'DATABASE_URL is not set. Point it at your PostgreSQL, e.g. postgres://postgres:postgres@db:5432/portfolio',
    );
  }
  const client = postgres(normalizeConnectionString(raw), {
    max: Number(process.env.DB_POOL_MAX ?? 10),
  });
  return drizzle(client, { schema });
}

/**
 * Global Nest module providing the Drizzle handle under DRIZZLE_DATABASE.
 * Import once from AppModule; every feature module injects the token.
 */
@Global()
@Module({
  providers: [{ provide: DRIZZLE_DATABASE, useFactory: createDatabase }],
  exports: [DRIZZLE_DATABASE],
})
export class DatabaseModule {}
