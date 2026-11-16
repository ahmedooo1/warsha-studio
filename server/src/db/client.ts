import pg from 'pg';
import {drizzle, type NodePgDatabase} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export const DB = Symbol('DB');
export const POOL = Symbol('POOL');

export function createPool(url: string): pg.Pool {
  return new pg.Pool({connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000});
}
export function createDb(pool: pg.Pool): Db { return drizzle(pool, {schema}); }

// migrations are plain SQL files in server/drizzle, applied in order at start, each once
export async function runMigrations(db: Db): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, {migrationsFolder: path.resolve(here, '../../drizzle')});
}
