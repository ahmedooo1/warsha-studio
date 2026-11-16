import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {start, client, cid, design, fakePdf, sql, SETUP} from './helpers.mjs';

let srv, owner, staff, base;
before(async () => { srv = await start(); base = srv.base; owner = client(base, 'PC atelier'); staff = client(base, 'tablette'); });
after(async () => { await srv?.close(); });

test('first setup, sign in, protections', async () => {
  let r = await owner.get('/api/auth/state'); assert.equal(r.data.setupNeeded, true);
  r = await owner.post('/api/auth/setup', {token: 'wrong-token-wrong-token', email: 'o@atelier.test', name: 'Patron', password: 'motdepasse-long'}); assert.equal(r.status, 403);
  r = await owner.post('/api/auth/setup', {token: SETUP, email: 'O@Atelier.test', name: 'Patron', password: 'court'}); assert.equal(r.status, 400, 'short password refused');
  r = await owner.post('/api/auth/setup', {token: SETUP, email: 'O@Atelier.test', name: 'Patron', password: 'motdepasse-long'}); assert.equal(r.status, 200); assert.equal(r.data.user.role, 'owner');
  assert.ok(owner.cookie, 'session cookie set');
  r = await client(base).post('/api/auth/setup', {token: SETUP, email: 'x@atelier.test', name: 'X', password: 'motdepasse-long'}); assert.equal(r.status, 409, 'setup only once');
  // writes need the header and the right origin
  r = await owner.raw('PUT', '/api/projects/abc', {}, {'x-warsha': ''}); assert.equal(r.status, 403);
  r = await owner.raw('PUT', '/api/projects/abc', {}, {origin: 'https://evil.example'}); assert.equal(r.status, 403);
  r = await client(base).get('/api/sync/changes'); assert.equal(r.status, 401, 'no session no data');
  const rows = await sql('SELECT token_hash FROM sessions');
  assert.ok(rows.length === 1 && !owner.cookie.includes(rows[0].token_hash), 'only the hash is stored');
});

test('users: staff account, roles, lockout, revocation', async () => {
  let r = await owner.post('/api/users', {email: 'staff@atelier.test', name: 'Compagnon', role: 'staff', password: 'motdepasse-staff'}); assert.equal(r.status, 201);
  const staffId = r.data.id;
  r = await staff.post('/api/auth/login', {email: 'staff@atelier.test', password: 'mauvais-mot'}); assert.equal(r.status, 401);
  r = await staff.post('/api/auth/login', {email: 'STAFF@atelier.test', password: 'motdepasse-staff'}); assert.equal(r.status, 200);
  r = await staff.get('/api/users'); assert.equal(r.status, 403, 'staff cannot list users');
  r = await staff.get('/api/admin/export'); assert.equal(r.status, 403, 'staff cannot export');
  r = await staff.put('/api/settings', {baseRev: 0, changeId: cid(), prices: {}, fab: {}}); assert.equal(r.status, 403, 'staff cannot change prices');
  r = await owner.patch(`/api/users/${(await owner.get('/api/users')).data.find(u => u.role === 'owner').id}`, {active: false}); assert.equal(r.status, 409, 'last owner stays');
  // eight wrong passwords lock the account for a while, even with the right one after
  const z = client(base);
  for (let i = 0; i < 8; i++) await z.post('/api/auth/login', {email: 'staff@atelier.test', password: 'mauvais-mot-' + i});
  r = await z.post('/api/auth/login', {email: 'staff@atelier.test', password: 'motdepasse-staff'}); assert.equal(r.status, 401); assert.match(r.data.message, /locked/);
  await sql('UPDATE users SET locked_until = NULL WHERE email = $1', ['staff@atelier.test']);
  // the owner ends the staff sessions at once
  r = await owner.get('/api/users/sessions'); const s = r.data.find(x => x.email === 'staff@atelier.test'); assert.ok(s);
  r = await owner.del(`/api/users/sessions/${s.id}`); assert.equal(r.status, 200);
  r = await staff.get('/api/sync/changes'); assert.equal(r.status, 401);
  r = await staff.post('/api/auth/login', {email: 'staff@atelier.test', password: 'motdepasse-staff'}); assert.equal(r.status, 200);
  assert.ok(staffId);
});

test('sync: save, feed, conflict keeps both, idempotent retry, history, restore, trash', async () => {
  const id = 'd' + Date.now().toString(36) + 'aa';
  let r = await owner.put(`/api/projects/${id}`, {baseRev: 0, changeId: cid(), data: design('Dupont')}); assert.equal(r.status, 200); assert.equal(r.data.rev, 1);
  r = await staff.get('/api/sync/changes?since=0'); assert.equal(r.status, 200);
  const p = r.data.projects.find(x => x.id === id); assert.equal(p.rev, 1); assert.equal(p.name, 'Dupont');
  const cursor = r.data.cursor;
  // both devices edit rev 1; the second to arrive is refused with the server copy, nothing is overwritten
  r = await owner.put(`/api/projects/${id}`, {baseRev: 1, changeId: cid(), data: design('Dupont', {note: 'version PC'})}); assert.equal(r.data.rev, 2);
  r = await staff.put(`/api/projects/${id}`, {baseRev: 1, changeId: cid(), data: design('Dupont', {note: 'version tablette'})}); assert.equal(r.status, 409);
  assert.equal(r.data.server.note, 'version PC'); assert.equal(r.data.server.rev, 2);
  // the device keeps its copy as a separate design: both survive
  const copy = id + 'c';
  r = await staff.put(`/api/projects/${copy}`, {baseRev: 0, changeId: cid(), data: design('Dupont', {note: 'version tablette', variant: 'ب'})}); assert.equal(r.data.rev, 1);
  // a lost answer: the same change sent again is applied once
  const ch = cid();
  r = await owner.put(`/api/projects/${id}`, {baseRev: 2, changeId: ch, data: design('Dupont', {note: 'v3'})}); assert.equal(r.data.rev, 3);
  r = await owner.put(`/api/projects/${id}`, {baseRev: 2, changeId: ch, data: design('Dupont', {note: 'v3'})}); assert.equal(r.status, 200); assert.equal(r.data.rev, 3); assert.equal(r.data.replayed, true);
  r = await staff.get(`/api/sync/changes?since=${cursor}`);
  assert.deepEqual(r.data.projects.map(x => x.id).sort(), [copy, id].sort());
  // history: every rev kept, and going back makes a new rev
  r = await owner.get(`/api/projects/${id}/versions`); assert.deepEqual(r.data.map(v => v.rev), [3, 2, 1]);
  const v1 = r.data.find(v => v.rev === 1);
  r = await owner.post(`/api/projects/${id}/versions/${v1.id}/restore`, {changeId: cid()}); assert.equal(r.data.rev, 4);
  r = await owner.get(`/api/sync/changes?since=0`); assert.equal(r.data.projects.find(x => x.id === id).note, 'test');
  // deleting goes to the trash with a tombstone in the feed
  r = await owner.post(`/api/projects/${copy}/delete`, {baseRev: 5, changeId: cid()}); assert.equal(r.status, 409, 'delete needs the current rev');
  r = await owner.post(`/api/projects/${copy}/delete`, {baseRev: 1, changeId: cid()}); assert.equal(r.status, 200);
  r = await staff.get(`/api/sync/changes?since=0`); assert.equal(r.data.projects.find(x => x.id === copy).deleted, true);
  r = await owner.get('/api/trash'); assert.ok(r.data.some(x => x.id === copy));
  // saving it again brings it back
  r = await staff.put(`/api/projects/${copy}`, {baseRev: 2, changeId: cid(), data: design('Dupont', {variant: 'ب'})}); assert.equal(r.data.rev, 3);
  r = await owner.get('/api/trash'); assert.ok(!r.data.some(x => x.id === copy));
  // bad input
  r = await owner.put('/api/projects/../../x', {baseRev: 0, changeId: cid(), data: design('X')}); assert.ok(r.status >= 400);
  r = await owner.put(`/api/projects/${id}x`, {baseRev: 0, changeId: cid(), data: {...design('X'), thumb: 'javascript:alert(1)'}}); assert.equal(r.status, 400);
  r = await owner.put(`/api/projects/${id}y`, {baseRev: 0, changeId: cid(), data: {...design('X'), admin: true}}); assert.equal(r.status, 400, 'unknown fields refused');
});

test('settings: rev, conflict, history, restore', async () => {
  let r = await owner.get('/api/sync/changes?since=0'); const s0 = r.data.settings; assert.equal(s0, null, 'untouched settings are not in the feed');
  r = await owner.put('/api/settings', {baseRev: 0, changeId: cid(), prices: {cur: 'EUR', vat: 20, shop: 'Atelier Test'}, fab: {kerf: 3}}); assert.equal(r.data.rev, 1);
  r = await owner.put('/api/settings', {baseRev: 0, changeId: cid(), prices: {cur: 'USD'}, fab: {}}); assert.equal(r.status, 409); assert.equal(r.data.server.prices.cur, 'EUR');
  r = await owner.put('/api/settings', {baseRev: 1, changeId: cid(), prices: {cur: 'EUR', vat: 10, shop: 'Atelier Test'}, fab: {kerf: 3}}); assert.equal(r.data.rev, 2);
  r = await staff.get('/api/sync/changes?since=0'); assert.equal(r.data.settings.rev, 2); assert.equal(r.data.settings.prices.vat, 10);
  r = await owner.get('/api/settings/versions'); const first = r.data.find(v => v.rev === 1);
  r = await owner.post(`/api/settings/versions/${first.id}/restore`, {baseRev: 2, changeId: cid()}); assert.equal(r.data.rev, 3);
  r = await staff.get('/api/sync/changes?since=0'); assert.equal(r.data.settings.prices.vat, 20);
});

test('quotes: numbered, frozen, PDF once with its fingerprint, events', async () => {
  const id = 'q' + Date.now().toString(36) + 'zz';
  let r = await owner.put(`/api/projects/${id}`, {baseRev: 0, changeId: cid(), data: design('Martin')});
  const ch = await owner.get('/api/sync/changes?since=0'), srev = ch.data.settings.rev;
  const body = {projectId: id, projectRev: 1, settingsRev: srev, figures: {lines: [['Cuisine', '', 4200]], sub: 4200, vat: 840, total: 5040}, currency: 'EUR', total: '5040'};
  r = await owner.post('/api/quotes/reserve', {...body, projectRev: 2}); assert.equal(r.status, 409); assert.equal(r.data.code, 'project_changed');
  r = await owner.post('/api/quotes/reserve', {...body, settingsRev: srev - 1}); assert.equal(r.status, 409); assert.equal(r.data.code, 'settings_changed');
  r = await owner.post('/api/quotes/reserve', body); assert.equal(r.status, 200);
  const year = new Date().getFullYear(); assert.equal(r.data.number, `D${year}-0001`);
  const q1 = r.data;
  r = await staff.post('/api/quotes/reserve', body); assert.equal(r.data.number, `D${year}-0002`, 'numbers follow');
  const q2 = r.data;
  // the snapshot holds the design, the settings and the figures
  r = await owner.get(`/api/quotes/${q1.id}`);
  assert.equal(r.data.snapshot.project.cfg.wallA, 360); assert.equal(r.data.snapshot.settings.prices.cur, 'EUR'); assert.equal(r.data.snapshot.figures.total, 5040); assert.equal(r.data.status, 'reserved');
  // the version it points to is pinned
  const pinned = await sql('SELECT pinned FROM project_versions WHERE project_id = $1 AND rev = 1', [id]); assert.equal(pinned[0].pinned, true);
  r = await owner.raw('PUT', `/api/quotes/${q1.id}/pdf`, Buffer.from('not a pdf at all, really not'), {'content-type': 'application/pdf'}); assert.equal(r.status, 400);
  const pdf = fakePdf('a');
  r = await owner.raw('PUT', `/api/quotes/${q1.id}/pdf`, pdf, {'content-type': 'application/pdf'}); assert.equal(r.status, 200);
  const sha = r.data.sha256;
  r = await owner.raw('PUT', `/api/quotes/${q1.id}/pdf`, fakePdf('b'), {'content-type': 'application/pdf'}); assert.equal(r.status, 409, 'PDF only once');
  r = await owner.get(`/api/quotes/${q1.id}/pdf`); assert.equal(r.status, 200); assert.ok(Buffer.compare(r.data, pdf) === 0); assert.equal(r.headers.get('x-content-sha256'), sha);
  // the database itself refuses any change or deletion
  await assert.rejects(sql('UPDATE quotes SET total = $1 WHERE id = $2', ['1', q1.id]), /immutable/);
  await assert.rejects(sql('DELETE FROM quotes WHERE id = $1', [q1.id]), /immutable/);
  await assert.rejects(sql('UPDATE quotes SET pdf = $1, pdf_sha256 = $2 WHERE id = $3', [Buffer.from('%PDF-x'), 'x', q1.id]), /immutable/);
  await assert.rejects(sql("UPDATE quote_events SET type = 'cancelled'"), /append only/);
  await assert.rejects(sql('DELETE FROM audit_log'), /append only/);
  // the design keeps changing; the quote does not
  await owner.put(`/api/projects/${id}`, {baseRev: 1, changeId: cid(), data: design('Martin', {cfg: {room: 'kitchen', layout: 'I', wallA: 500}})});
  r = await owner.get(`/api/quotes/${q1.id}`); assert.equal(r.data.snapshot.project.cfg.wallA, 360); assert.equal(r.data.status, 'sent');
  r = await owner.post(`/api/quotes/${q2.id}/events`, {type: 'accepted'}); assert.equal(r.status, 409, 'no PDF, nothing to accept');
  r = await owner.post(`/api/quotes/${q1.id}/events`, {type: 'cancelled', note: 'client a change'}); assert.equal(r.status, 200);
  r = await owner.post(`/api/quotes/${q1.id}/events`, {type: 'accepted'}); assert.equal(r.status, 409);
  r = await owner.get('/api/quotes'); assert.equal(r.data.find(q => q.id === q1.id).status, 'cancelled');
  // a design a quote points to is never purged from the trash
  const pr = await owner.get('/api/sync/changes?since=0'), cur = pr.data.projects.find(x => x.id === id);
  await owner.post(`/api/projects/${id}/delete`, {baseRev: cur.rev, changeId: cid()});
  await sql("UPDATE projects SET deleted_at = now() - interval '400 days' WHERE id = $1", [id]);
  r = await owner.post('/api/admin/trash/purge'); assert.equal((await sql('SELECT id FROM projects WHERE id = $1', [id])).length, 1);
});

test('client links: read only, PIN, expiry, revocation, acceptance', async () => {
  const id = 'l' + Date.now().toString(36) + 'zz';
  await owner.put(`/api/projects/${id}`, {baseRev: 0, changeId: cid(), data: design('Bernard', {note: 'remise 10% possible'})});
  const srev = (await owner.get('/api/sync/changes?since=0')).data.settings.rev;
  const q = (await owner.post('/api/quotes/reserve', {projectId: id, projectRev: 1, settingsRev: srev, figures: {total: 900}, currency: 'EUR', total: '900'})).data;
  let r = await owner.post('/api/share', {projectId: id, quoteId: q.id, days: 7}); assert.equal(r.status, 409, 'no link before the PDF');
  await owner.raw('PUT', `/api/quotes/${q.id}/pdf`, fakePdf('l'), {'content-type': 'application/pdf'});
  r = await owner.post('/api/share', {projectId: id, quoteId: q.id, days: 7, pin: '4821'}); assert.equal(r.status, 200);
  const token = r.data.url.split('/v/')[1], linkId = r.data.id;
  assert.equal((await sql('SELECT count(*)::int AS n FROM share_links WHERE token_hash = $1', [token]))[0].n, 0, 'token not stored');
  const anon = client(base, 'phone');
  r = await anon.post(`/api/public/share/${token}`, {}); assert.equal(r.data.pinRequired, true); assert.equal(r.data.design, undefined);
  r = await anon.post(`/api/public/share/${token}`, {pin: '0000'}); assert.equal(r.status, 403);
  r = await anon.post(`/api/public/share/${token}`, {pin: '4821'}); assert.equal(r.status, 200);
  assert.equal(r.data.design.name, 'Bernard'); assert.equal(r.data.quote.total, '900');
  assert.equal(JSON.stringify(r.data).includes('remise'), false, 'workshop notes never shown'); assert.equal(JSON.stringify(r.data).includes('+33'), false, 'phone never shown');
  r = await anon.post(`/api/public/share/${token}/pdf`, {pin: '4821'}); assert.equal(r.status, 200); assert.equal(r.data.subarray(0, 5).toString(), '%PDF-');
  // the link reads; it cannot write anything
  r = await anon.get('/api/sync/changes?since=0'); assert.equal(r.status, 401);
  r = await anon.post(`/api/public/share/${token}/accept`, {pin: '4821', name: 'M. Bernard'}); assert.equal(r.status, 200);
  r = await anon.post(`/api/public/share/${token}/accept`, {pin: '4821', name: 'M. Bernard'}); assert.equal(r.status, 409);
  r = await owner.get(`/api/quotes/${q.id}`); assert.equal(r.data.status, 'accepted'); assert.equal(r.data.events.at(-1).data.via, 'link');
  r = await anon.post('/api/public/share/' + 'A'.repeat(43), {}); assert.equal(r.status, 404);
  // revoked: gone at once
  r = await owner.post(`/api/share/${linkId}/revoke`); assert.equal(r.status, 200);
  r = await anon.post(`/api/public/share/${token}`, {pin: '4821'}); assert.equal(r.status, 410);
  // expired
  r = await owner.post('/api/share', {projectId: id, days: 1}); const t2 = r.data.url.split('/v/')[1];
  r = await anon.post(`/api/public/share/${t2}`, {}); assert.equal(r.status, 200); assert.equal(r.data.quote, null);
  await sql("UPDATE share_links SET expires_at = now() - interval '1 minute' WHERE id = $1", [r.data && (await owner.get(`/api/share?projectId=${id}`)).data[0].id]);
  r = await anon.post(`/api/public/share/${t2}`, {}); assert.equal(r.status, 410);
  // five wrong codes lock the link
  r = await owner.post('/api/share', {projectId: id, days: 3, pin: '1111'}); const t3 = r.data.url.split('/v/')[1];
  for (let i = 0; i < 5; i++) await anon.post(`/api/public/share/${t3}`, {pin: '9999'});
  r = await anon.post(`/api/public/share/${t3}`, {pin: '1111'}); assert.equal(r.status, 410);
  r = await owner.get(`/api/share?projectId=${id}`); assert.deepEqual(r.data.map(l => l.state).sort(), ['expired', 'locked', 'revoked']);
  // the viewer page is served read only with no referrer
  r = await fetch(`${base}/v/${t2}`); const html = await r.text();
  assert.equal(r.status, 200); assert.match(html, /WARSHA_MODE="view"/); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});

test('RGPD: search, export, erase with legal hold, retention report', async () => {
  const free = 'g' + Date.now().toString(36) + 'zz';
  await owner.put(`/api/projects/${free}`, {baseRev: 0, changeId: cid(), data: design('Garnier', {phone: '06 12 34 56 78'})});
  await owner.post('/api/share', {projectId: free, days: 3});
  let r = await owner.get('/api/admin/people?q=0612345678'); assert.ok(r.data.designs.some(d => d.id === free), 'found by phone digits');
  r = await owner.get('/api/admin/people?q=Martin'); const held = r.data.designs[0]; assert.equal(held.legalHold, true);
  r = await staff.get('/api/admin/people?q=Martin'); assert.equal(r.status, 403);
  r = await owner.post('/api/admin/people/export', {ids: [free]}); assert.equal(r.status, 200); assert.equal(r.data.designs[0].phone, '06 12 34 56 78');
  r = await owner.post('/api/admin/people/erase', {ids: [free, held.id], confirm: 'oui'}); assert.equal(r.status, 400);
  r = await owner.post('/api/admin/people/erase', {ids: [free, held.id], confirm: 'ERASE'}); assert.deepEqual(r.data.erased, [free]); assert.deepEqual(r.data.legalHold, [held.id]);
  assert.equal((await sql('SELECT count(*)::int AS n FROM project_versions WHERE project_id = $1', [free]))[0].n, 0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM share_links WHERE project_id = $1', [free]))[0].n, 0);
  const audit = await sql("SELECT meta::text FROM audit_log WHERE action = 'person_erased'"); assert.equal(audit[0].meta.includes('Garnier'), false, 'no name in the audit');
  await sql("UPDATE projects SET updated_at = now() - interval '4 years' WHERE name = 'Dupont'");
  r = await owner.get('/api/admin/retention'); assert.ok(r.data.prospects.some(p => p.name === 'Dupont')); assert.equal(r.data.rules.quotesYears, 10);
  assert.ok((await sql("SELECT id FROM projects WHERE name = 'Dupont'")).length > 0, 'the report deletes nothing');
});

test('full export: editor backup format, PDFs with fingerprints, CSV', async () => {
  const r = await owner.get('/api/admin/export'); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/zip');
  const {execFileSync} = await import('node:child_process');
  const {mkdtempSync, writeFileSync, readFileSync} = await import('node:fs');
  const os = await import('node:os'), path = await import('node:path'), crypto = await import('node:crypto');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wexp-')); writeFileSync(path.join(dir, 'e.zip'), r.data);
  execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])', path.join(dir, 'e.zip'), path.join(dir, 'x')]);
  const b = JSON.parse(readFileSync(path.join(dir, 'x', 'warsha-backup.json'), 'utf8'));
  assert.equal(b.app, 'warsha-studio'); assert.equal(b.kind, 'backup'); assert.ok(b.projects.length >= 2); assert.equal(b.prices.cur, 'EUR');
  const csv = readFileSync(path.join(dir, 'x', 'devis.csv'), 'utf8'), year = new Date().getFullYear();
  const pdf = readFileSync(path.join(dir, 'x', 'devis', `D${year}-0001.pdf`));
  assert.ok(csv.includes(crypto.createHash('sha256').update(pdf).digest('hex')), 'PDF matches its fingerprint');
});

test('assistant is off by default', async () => {
  let r = await owner.get('/api/ai/limits'); assert.equal(r.data.enabled, false);
  r = await owner.post('/api/ai/sample', {prompt: 'x'}); assert.equal(r.status, 404);
});

test('editor page is served with cloud.js and a strict policy', async () => {
  const r = await fetch(base + '/'); const html = await r.text();
  assert.match(html, /<script src="\/cloud\/cloud.js"><\/script>/); assert.match(html, /WARSHA_MODE="app"/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/js/fab.js')).status, 200);
  assert.equal((await fetch(base + '/js/../server/package.json')).status, 404);
  const h = await fetch(base + '/api/health'); assert.equal((await h.json()).ok, true);
});
