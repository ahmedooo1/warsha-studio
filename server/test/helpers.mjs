// Starts the real server on a fresh test database (warsha_test by default) and gives a small HTTP client with cookies.
import pg from 'pg';

export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://warsha:warsha@127.0.0.1:5432/warsha_test';
export const SETUP = 'test-setup-token-0123456789abcdef';

export async function resetDb() {
  const c = new pg.Client({connectionString: TEST_DB}); await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await c.end();
}
export async function sql(q, args = []) {
  const c = new pg.Client({connectionString: TEST_DB}); await c.connect();
  try { return (await c.query(q, args)).rows; } finally { await c.end(); }
}

export async function start(env = {}) {
  await resetDb();
  Object.assign(process.env, {DATABASE_URL: TEST_DB, PUBLIC_URL: 'http://127.0.0.1:1', SETUP_TOKEN: SETUP, COOKIE_SECURE: 'false', BACKUP_STATUS_FILE: '/nonexistent/status.json', LOGIN_PER_MIN: '100'}, env);
  const {createApp} = await import('../dist/main.js');
  const {app, cfg} = await createApp();
  await app.listen(0, '127.0.0.1');
  const port = app.getHttpServer().address().port;
  const base = `http://127.0.0.1:${port}`;
  cfg.publicUrl = base; // Origin checks compare with the address the test really uses
  return {app, base, cfg, close: () => app.close()};
}

export function client(base, device = 'test') {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const h = {'x-warsha': '1', origin: base, 'x-warsha-device': device, ...headers};
    if (cookie) h.cookie = cookie;
    let payload;
    if (Buffer.isBuffer(body)) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const r = await fetch(base + path, {method, headers: h, body: payload});
    const sc = r.headers.getSetCookie?.() || [];
    for (const c of sc) { const [kv] = c.split(';'); if (kv.startsWith('ws_session=')) cookie = kv.endsWith('=') ? '' : kv; }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return {status: r.status, data, headers: r.headers};
  };
  return {
    get: (p, h) => req('GET', p, undefined, h), post: (p, b, h) => req('POST', p, b ?? {}, h), put: (p, b, h) => req('PUT', p, b, h),
    patch: (p, b) => req('PATCH', p, b), del: (p) => req('DELETE', p), raw: req,
    get cookie() { return cookie; }, set cookie(v) { cookie = v; }
  };
}

let n = 0;
export const cid = () => 'chg-' + Date.now().toString(36) + '-' + (n++).toString(36) + Math.random().toString(36).slice(2, 6);
export const design = (name, extra = {}) => ({name, phone: '+33 6 00 00 00 00', note: 'test', cfg: {room: 'kitchen', layout: 'L', wallA: 360}, thumb: '', updatedAt: Date.now(), ...extra});
export const fakePdf = (txt = 'x') => Buffer.from('%PDF-1.4\n' + txt.repeat(200) + '\n%%EOF');
