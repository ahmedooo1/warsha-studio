// Every setting comes from the environment (deploy/.env on the server, never in Git). Missing required values stop
// the server at start rather than running half configured.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const need = (k: string): string => { const v = process.env[k]; if (!v) throw new Error(`missing environment variable ${k}`); return v; };
const num = (k: string, d: number): number => { const v = process.env[k]; if (v === undefined || v === '') return d; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${k} must be a number`); return n; };
const bool = (k: string, d: boolean): boolean => { const v = process.env[k]; return v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v); };

export interface Config {
  port: number; host: string; databaseUrl: string; publicUrl: string; cookieSecure: boolean;
  setupToken: string; sessionDays: number; editorDir: string; publicDir: string; backupStatusFile: string;
  shareDefaultDays: number; shareMaxDays: number; trashDays: number; keepVersions: number;
  ai: {enabled: boolean; apiKey: string; model: string; dailyLimit: number; monthlyBudgetCalls: number};
}

export function loadConfig(): Config {
  const publicUrl = need('PUBLIC_URL').replace(/\/+$/, '');
  return {
    port: num('PORT', 8080),
    host: process.env.HOST || '127.0.0.1',
    databaseUrl: need('DATABASE_URL'),
    publicUrl,
    cookieSecure: bool('COOKIE_SECURE', publicUrl.startsWith('https://')),
    setupToken: process.env.SETUP_TOKEN || '',
    sessionDays: num('SESSION_DAYS', 30),
    editorDir: process.env.EDITOR_DIR || path.resolve(here, '../..'),
    publicDir: process.env.PUBLIC_DIR || path.resolve(here, '../public'),
    backupStatusFile: process.env.BACKUP_STATUS_FILE || '/backup-status/status.json',
    shareDefaultDays: num('SHARE_DEFAULT_DAYS', 30),
    shareMaxDays: num('SHARE_MAX_DAYS', 180),
    trashDays: num('TRASH_DAYS', 30),
    keepVersions: num('KEEP_VERSIONS', 50),
    ai: {enabled: bool('AI_ENABLED', false), apiKey: process.env.ANTHROPIC_API_KEY || '', model: process.env.AI_MODEL || 'claude-sonnet-5-5',
      dailyLimit: num('AI_DAILY_LIMIT', 30), monthlyBudgetCalls: num('AI_MONTHLY_LIMIT', 400)}
  };
}
