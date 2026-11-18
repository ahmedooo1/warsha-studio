// Two devices of the workshop and a client, in real browsers, against the real server and a fresh database.
// Run: npm run build && node test/browser.e2e.mjs   (needs Postgres with the warsha_test database, and three@0.147.0
// installed in the repository's node_modules for the editor)
import {createRequire} from 'node:module';
import {spawn, execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {resetDb, sql, TEST_DB, SETUP} from './helpers.mjs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const threeDir = process.env.THREE_DIR || path.join(repo, 'node_modules/three');
const PORT = 8787, BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// the editor is served from a fresh standalone build: three.js copied in, as in the Docker image (no CDN at all)
execFileSync(process.execPath, [path.join(repo, 'scripts/build-standalone.mjs')], {stdio: 'ignore', env: {...process.env, THREE_DIR: threeDir}});
const editorDir = path.join(repo, 'dist-standalone/warsha-studio');
await resetDb();
const srv = spawn(process.execPath, [path.join(here, '../dist/main.js')], {env: {...process.env, PORT: String(PORT), DATABASE_URL: TEST_DB, PUBLIC_URL: BASE, SETUP_TOKEN: SETUP, COOKIE_SECURE: 'false', LOGIN_PER_MIN: '100', BACKUP_STATUS_FILE: '/nonexistent', EDITOR_DIR: editorDir}, stdio: ['ignore', 'pipe', 'pipe']});
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
for (let i = 0; i < 60 && !log.includes('listening'); i++) await new Promise(r => setTimeout(r, 250));
if (!log.includes('listening')) { console.log(log); process.exit(1); }

const browser = await chromium.launch({args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});
async function device(name, url = BASE + '/'){
  const ctx = await browser.newContext({viewport: {width: 1366, height: 860}, acceptDownloads: true});
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.continue();
    return r.abort();
  });
  await ctx.addInitScript(n => { localStorage.setItem('wr_cloud_device', n); localStorage.setItem('wr_quality', '"performance"'); }, name);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 180000});
  return {ctx, page, errors};
}
const ready = p => p.waitForFunction(() => window.__wr && window.WarshaCloud, null, {timeout: 180000});
const idle = p => p.waitForFunction(() => { const s = window.WarshaCloud.state; return s.pending === 0 && s.status === 'synced'; }, null, {timeout: 60000});
const names = p => p.evaluate(() => [...window.WarshaCloud._S.designs.values()].filter(r => !r.deleted && !['cut', 'cutstock'].includes(r.data.cfg?.kind)).map(r => r.data.name + (r.data.variant ? '/' + r.data.variant : '')).sort());
async function save(p, name, note){
  await p.click('#saveBtn'); await p.fill('#fName', name); await p.fill('#fNote', note);
  await p.click('#saveGo'); await p.waitForSelector('#saveSheet', {state: 'hidden'});
}
async function login(p){
  await p.waitForSelector('#wcLoginF', {timeout: 60000});
  await p.fill('#wcLoginF [name=email]', 'patron@atelier.test'); await p.fill('#wcLoginF [name=password]', 'motdepasse-long');
  await p.click('#wcLoginF button'); await p.waitForSelector('#wcLogin', {state: 'detached'});
}

try {
  console.log('setup and sign in');
  const A = await device('PC atelier');
  await A.page.waitForSelector('#wcLogin form [name=token]', {timeout: 60000});
  await A.page.fill('[name=token]', SETUP); await A.page.fill('[name=name]', 'Patron'); await A.page.fill('#wcLogin [name=email]', 'patron@atelier.test');
  await A.page.fill('#wcLogin [name=password]', 'motdepasse-long'); await A.page.fill('[name=password2]', 'motdepasse-long');
  await A.page.click('#wcLogin button'); await A.page.waitForSelector('#wcLogin', {state: 'detached'});
  await ready(A.page);
  ok(await A.page.isVisible('#wcStatus'), 'status button in the bar');
  await save(A.page, 'Dupont', 'version PC'); await idle(A.page);
  ok((await sql("SELECT name, note FROM projects")).some(r => r.name === 'Dupont' && r.note === 'version PC'), 'design saved on the server');
  await A.page.waitForFunction(() => window.WarshaCloud._S.meta.settingsRev > 0, null, {timeout: 20000});
  ok((await sql('SELECT rev FROM settings'))[0].rev > 0, "the owner's first device gives the server its prices");

  console.log('second device');
  const B = await device('Tablette');
  await login(B.page); await ready(B.page); await idle(B.page);
  ok((await names(B.page)).includes('Dupont'), 'design arrives on the other device');
  await B.page.click('#clientBtn'); ok(await B.page.isVisible('#clientList [data-open]'), 'shown in the client list'); await B.page.keyboard.press('Escape');

  console.log('cutting job travels');
  await A.page.evaluate(() => WarshaCutUI.open({name: 'Débit cuisine Dupont', parts: [{id: 'p1', name: 'côté', L: 720, W: 560, qty: 4}, {id: 'p2', name: 'étagère', L: 564, W: 540, qty: 3}]}));
  await A.page.waitForTimeout(1500); await A.page.evaluate(() => { document.querySelector('#cutSheet').hidden = true; }); await idle(A.page);
  ok((await sql("SELECT count(*)::int AS n FROM projects WHERE cfg->>'kind' = 'cut'"))[0].n === 1, 'cutting job saved on the server');
  await B.page.evaluate(() => window.WarshaCloud._sync()); await B.page.waitForTimeout(800);
  ok(await B.page.evaluate(() => window.WarshaEd.store.list.some(d => d.cfg?.kind === 'cut' && d.cfg.job.parts.length === 2)), 'and arrives on the other device');
  ok(await B.page.evaluate(() => { document.querySelector('#clientBtn').click(); const t = document.querySelector('#clientList').textContent; document.querySelector('#clientsSheet').hidden = true; return !t.includes('Débit cuisine'); }), 'not listed among the clients');

  console.log('price change travels');
  await A.page.click('[data-tab=cost]'); await A.page.locator('details[data-det=sale] summary').click();
  await A.page.fill('#p-install', '777'); await A.page.dispatchEvent('#p-install', 'input'); await A.page.waitForTimeout(1500); await idle(A.page);
  await B.page.evaluate(() => window.WarshaCloud._sync()); await B.page.waitForTimeout(800);
  ok(await B.page.evaluate(() => window.WarshaHost.settings().prices.install) === 777, 'settings applied on the other device');

  console.log('conflict: both edit the same design, one offline');
  await B.page.click('#clientBtn'); await B.page.click('#clientList [data-open]');
  await B.ctx.setOffline(true);
  await save(B.page, 'Dupont', 'version tablette');
  ok(await B.page.evaluate(() => window.WarshaCloud.state.pending) >= 1, 'offline change waits in the outbox');
  await A.page.click('#clientBtn'); await A.page.click('#clientList [data-open]');
  await save(A.page, 'Dupont', 'version PC 2'); await idle(A.page);
  await B.ctx.setOffline(false); await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await B.page.waitForSelector('#wcSheet [data-r]', {timeout: 30000});
  ok((await names(B.page)).join() === ['Dupont', 'Dupont/تعارض'].join(), 'both versions kept, mine marked');
  await B.page.waitForFunction(() => window.WarshaCloud.state.pending === 0, null, {timeout: 30000});
  const rows = await sql("SELECT note FROM projects WHERE name = 'Dupont' AND deleted_at IS NULL ORDER BY note");
  ok(rows.map(r => r.note).join('|') === 'version PC 2|version tablette', 'the server has both, nothing overwritten');
  await B.page.click('#wcSheet [data-r$=":mine"]'); await idle(B.page);
  const after = await sql("SELECT note FROM projects WHERE name = 'Dupont' AND deleted_at IS NULL");
  ok(after.length === 1 && after[0].note === 'version tablette', 'choosing mine keeps one design with my version');
  ok((await sql("SELECT count(*)::int AS n FROM project_versions v JOIN projects p ON p.id = v.project_id WHERE p.name = 'Dupont' AND v.data->>'note' = 'version PC 2'"))[0].n === 1, 'the other version stays in the history');
  await A.page.evaluate(() => window.WarshaCloud._sync()); await idle(A.page);
  ok((await names(A.page)).join() === 'Dupont', 'first device follows');
  await B.page.click('#wcSheet [data-x]').catch(() => {});

  console.log('offline change survives closing the page');
  await B.ctx.setOffline(true);
  await B.page.click('#newClient').catch(async () => { await B.page.click('#clientBtn'); await B.page.click('#newClient'); });
  await save(B.page, 'Hors ligne', 'cree sans reseau');
  await B.page.waitForTimeout(500);
  await B.page.close(); await B.ctx.setOffline(false);
  const B2page = await B.ctx.newPage(); B2page.on('pageerror', e => B.errors.push(String(e)));
  await B2page.goto(BASE + '/', {waitUntil: 'domcontentloaded'}); await ready(B2page); await idle(B2page);
  ok((await sql("SELECT count(*)::int AS n FROM projects WHERE name = 'Hors ligne'"))[0].n === 1, 'sent after reopening');

  console.log('numbered quote and client link');
  await A.page.click('#clientBtn'); await A.page.locator('#clientList .cl', {hasText: 'Dupont'}).locator('[data-open]').click();
  await A.page.click('[data-tab=cost]'); await A.page.click('[data-doc=quote]');
  await A.page.waitForSelector('#wcIssue', {timeout: 120000}); await A.page.click('#wcIssue');
  await A.page.waitForSelector('#wcQOut .wc-ok', {timeout: 120000});
  const year = new Date().getFullYear(), qtext = await A.page.textContent('#wcQOut');
  ok(qtext.includes(`D${year}-0001`), 'quote number from the server: ' + qtext.slice(0, 60));
  const q = (await sql('SELECT number, pdf_sha256, length(pdf) AS n, snapshot FROM quotes'))[0];
  ok(q && q.n > 1000 && /^[0-9a-f]{64}$/.test(q.pdf_sha256), 'PDF kept with its fingerprint');
  ok(q.snapshot.settings.prices.install === 777 && q.snapshot.project.note === 'version tablette', 'snapshot has the prices and the design');
  ok(await A.page.evaluate(() => document.querySelector('#docTitle').textContent.includes('D')), 'the document shows the official number');
  await A.page.fill('#wcLPin', '4821'); await A.page.click('#wcLGo'); await A.page.waitForSelector('#wcLUrl');
  const url = await A.page.inputValue('#wcLUrl');
  ok(url.startsWith(BASE + '/v/'), 'client link made');

  console.log('client view');
  const C = await device('client', url);
  await C.page.waitForSelector('#wcLogin [name=pin]', {timeout: 60000});
  await C.page.fill('[name=pin]', '0000'); await C.page.click('#wcLogin button');
  await C.page.waitForSelector('#wcLogin .wc-err:not(:empty)'); ok(true, 'wrong code refused');
  await C.page.fill('[name=pin]', '4821'); await C.page.click('#wcLogin button');
  await C.page.waitForSelector('.wc-client', {timeout: 120000});
  ok(await C.page.evaluate(() => document.body.classList.contains('present') && document.body.classList.contains('wc-view')), 'opened in presentation, read only');
  ok(!(await C.page.isVisible('.panel')) && !(await C.page.isVisible('#saveBtn')), 'no editing tools');
  await C.page.keyboard.press('Escape'); await C.page.waitForTimeout(300);
  ok(await C.page.evaluate(() => document.body.classList.contains('present')), 'Escape does not leave the view');
  ok((await C.page.textContent('.wc-client')).includes(`D${year}-0001`), 'quote number shown');
  const dl = C.page.waitForEvent('download'); await C.page.click('[data-v=pdf]'); const file = await dl;
  ok(/\.pdf$/.test(file.suggestedFilename()), 'client downloads the PDF');
  await C.page.click('[data-v=acc]'); await C.page.fill('#wcAcc [name=name]', 'M. Dupont'); await C.page.click('#wcAcc button');
  await C.page.waitForSelector('#wcAcc .wc-ok');
  ok((await sql("SELECT type FROM quote_events ORDER BY at")).map(r => r.type).join() === 'sent,accepted', 'acceptance recorded');
  ok(!(await C.page.evaluate(() => JSON.stringify(localStorage))).includes('777'), "the workshop's prices never reach the client");

  console.log('owner pages');
  const ad = await A.ctx.newPage(); ad.on('pageerror', e => A.errors.push('admin: ' + e));
  await ad.goto(BASE + '/admin#quotes'); await ad.waitForSelector('main table');
  ok((await ad.textContent('main')).includes(`D${year}-0001`), 'quote in the register');
  ok((await ad.textContent('main')).includes('مقبول'), 'its acceptance shown');
  await ad.selectOption('#lang', 'fr'); await ad.waitForTimeout(500);
  ok((await ad.textContent('nav')).includes('Registre') || (await ad.textContent('nav')).includes('Devis'), 'owner pages in French');
  ok(await ad.evaluate(() => document.documentElement.dir) === 'ltr', 'French reads left to right');
  await ad.click('[data-p=settings]'); await ad.fill('#qf [name=p]', 'WS'); await ad.click('#qf button'); await ad.waitForSelector('#m.ok');
  ok((await sql('SELECT prices FROM settings'))[0].prices.quotePrefix === 'WS', 'quote prefix saved');
  await A.page.evaluate(() => window.WarshaCloud._sync()); await A.page.waitForTimeout(1000);
  ok(await A.page.evaluate(() => window.WarshaHost.settings().prices.quotePrefix) === 'WS', 'and reaches the editor');
  for (const v of ['projects', 'links', 'trash', 'users', 'backup', 'people', 'audit', 'account']) { await ad.click(`[data-p=${v}]`); await ad.waitForTimeout(300); }
  ok(!(await ad.textContent('main')).includes('Error'), 'every owner page opens');
  await ad.selectOption('#lang', 'ar'); await ad.close();

  console.log('reopening without network');
  await A.page.waitForFunction(() => navigator.serviceWorker?.controller, null, {timeout: 30000}).catch(() => {});
  await A.page.reload({waitUntil: 'domcontentloaded'}); await ready(A.page);
  await A.page.waitForFunction(() => navigator.serviceWorker?.controller, null, {timeout: 30000});
  await A.ctx.setOffline(true);
  await A.page.reload({waitUntil: 'domcontentloaded', timeout: 60000}); await ready(A.page);
  await A.page.waitForFunction(() => window.WarshaCloud._S.designs.size > 0, null, {timeout: 30000});
  ok((await names(A.page)).includes('Dupont'), 'the editor opens offline with the designs of this device');
  await save(A.page, 'Dupont', 'modifie hors ligne apres reouverture');
  await A.ctx.setOffline(false); await A.page.evaluate(() => window.dispatchEvent(new Event('online'))); await idle(A.page);
  ok((await sql("SELECT note FROM projects WHERE name = 'Dupont' AND deleted_at IS NULL"))[0].note === 'modifie hors ligne apres reouverture', 'and the change reaches the server');

  console.log('page errors');
  ok(!A.errors.length, 'device A: ' + (A.errors.join(' | ') || 'none'));
  ok(!B.errors.length, 'device B: ' + (B.errors.join(' | ') || 'none'));
  ok(!C.errors.length, 'client: ' + (C.errors.join(' | ') || 'none'));
} catch (e) { fail++; console.log('  FAIL', e); }
finally { await browser.close(); srv.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
