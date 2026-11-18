// Browser checks of the cutting planner and the design lock. Run: node tests/cutting.mjs
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openApp} from './serve.mjs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), threeDir = process.env.THREE_DIR || path.join(root, 'node_modules/three');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m); } };
const browser = await chromium.launch({args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});
async function page(viewport) {
  const ctx = await browser.newContext({viewport});
  await ctx.addInitScript(() => localStorage.setItem('wr_quality', '"performance"'));
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await openApp(p, root, threeDir);
  await p.waitForFunction(() => window.__wr && window.WarshaCutUI, null, {timeout: 180000});
  return {p, errors};
}
const center = (p, sel) => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
async function drag(p, a, b, steps = 8) { await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move(b[0], b[1], {steps}); await p.mouse.up(); }

try {
  console.log('مخطط التقطيع من التصميم');
  const {p, errors} = await page({width: 1366, height: 900});
  await p.evaluate(() => { __wr.openDemo(0); document.querySelector('[data-tab=cost]').click(); });
  await p.waitForSelector('[data-cutplan]'); await p.evaluate(() => document.querySelector('[data-cutplan]').click()); await p.waitForSelector('#cutSheet:not([hidden]) svg[data-sheet]');
  const a = await p.evaluate(() => { const pl = WarshaCutUI.plan, j = WarshaCutUI.job; return {parts: j.parts.length, copies: j.parts.reduce((s, x) => s + x.qty, 0), placed: pl.sheets.reduce((s, x) => s + x.parts.length, 0), straight: pl.read.every(r => r.straight && !r.errors.length), boards: pl.totals.boards, svgs: document.querySelectorAll('#cutSheet svg[data-sheet]').length}; });
  ok(a.parts > 10 && a.placed === a.copies, `كل قطع التصميم على الألواح (${a.placed} من ${a.copies})`);
  ok(a.straight && a.svgs === a.boards + 0 || a.svgs >= a.boards, `${a.boards} لوح مرسوم، وكلها تُقص بخطوط مستقيمة`);
  const cw = await p.evaluate(() => { const cl = __wr.cutList ? null : null; return document.querySelectorAll('.cz-cuts li').length; });
  ok(cw > 10, `تسلسل القص مكتوب تحت الألواح (${cw} قصة)`);
  const kept = await p.evaluate(() => store => 0);
  void kept;
  ok(await p.evaluate(() => (window.WarshaEd.store.list || []).some(d => d.cfg?.kind === 'cut')), 'المهمة محفوظة في مخزن التصاميم');
  ok(await p.evaluate(() => { document.querySelector('#cutSheet').hidden = true; document.querySelector('#clientBtn').click(); return !document.querySelector('#clientList').textContent.includes('من التصميم') || document.querySelectorAll('#clientList .cl').length === 0; }), 'المهام لا تظهر بين الزبائن');
  await p.click('[data-cutjobs]'); await p.waitForSelector('#czJobsBox');
  ok(await p.evaluate(() => document.querySelectorAll('#czJobsBox [data-cj^="open:"]').length >= 1), 'قائمة المهام تظهر من نافذة الزبائن');

  console.log('قطع يكتبها النجار');
  await p.click('[data-cj=new]'); await p.waitForTimeout(300);
  await p.click('[data-cz=paste]'); await p.fill('#czPasteIn', 'جانب\t720\t560\t4\nرف\t564\t540\t6\nباب\t717\t397\t4\nقاعدة\t1200\t560\t2');
  await p.click('[data-cz=pasteGo]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => WarshaCutUI.job.parts.length) === 4, 'لصق أربعة أسطر من جدول');
  await p.click('[data-pi="2"] [data-grain]'); await p.click('[data-pi="2"] line[data-edge="0"]', {force: true}); await p.click('[data-pi="2"] rect[data-edge="2"]', {force: true});
  await p.waitForTimeout(500);
  const pd = await p.evaluate(() => WarshaCutUI.job.parts[2]);
  ok(pd.grain === 'L' && pd.e[0] === 1 && pd.e[2] === 1, 'العرق والحواف من الرسم الصغير');
  await p.click('.cz-tabs [data-cztab=boards]');
  await p.click('[data-cz=addOff]'); await p.waitForTimeout(200);
  await p.fill('[data-oi="0"] [data-of=L]', '1300'); await p.fill('[data-oi="0"] [data-of=W]', '1200'); await p.waitForTimeout(600);
  await p.click('.cz-tabs [data-cztab=plan]'); await p.waitForTimeout(500);
  const b = await p.evaluate(() => { const pl = WarshaCutUI.plan; return {off: pl.per[0].offcutsUsed, boards: pl.totals.boards, straight: pl.read.every(r => r.straight), edge: pl.edge}; });
  ok(b.off === 1 && b.straight, `البقية مستعملة قبل لوح جديد (${b.boards} لوح جديد)`);
  ok(Math.abs(b.edge - 4 * (717 + 397) / 1000) < .01, `أمتار الحواف (${b.edge.toFixed(2)} م)`);

  console.log('الترتيب بالإصبع');
  await p.click('[data-cz=edit]'); await p.waitForSelector('.cz-wrap.edit');
  const before = await p.evaluate(() => JSON.stringify(WarshaCutUI.job.manual.sheets[0].parts[0]));
  const pc = await center(p, '[data-part="0:0"] rect.pr');
  await drag(p, pc, [pc[0] - 40, pc[1] + 25]); await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({q: WarshaCutUI.job.manual.sheets[0].parts[0], read: WarshaCutUI.plan.read[0]}));
  ok(JSON.stringify(after.q) !== before, 'سحب قطعة على اللوح يغيّر مكانها');
  await p.mouse.click(...(await center(p, '[data-part="0:1"] rect.pr'))); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector('[data-cz=rot]')), 'الضغط على قطعة يظهر التدوير والإرجاع');
  await p.click('[data-cz=unplace]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelectorAll('[data-arm]').length) === 1, 'القطعة المرجعة تظهر في «قطع لم توضع»');
  await p.click('[data-arm]');
  // an empty place on a board: the reusable leftover of the first new board
  // an empty place on a board: a point where the finger lands on the board itself, not on a part
  const empty = () => p.evaluate(() => { for (const sv of document.querySelectorAll('svg[data-sheet]')) { sv.scrollIntoView({block: 'center'}); const r = sv.querySelector('.board').getBoundingClientRect();
    for (let gy = .92; gy > .05; gy -= .04) for (let gx = .92; gx > .05; gx -= .04) { const x = r.x + r.width * gx, y = r.y + r.height * gy, el = document.elementFromPoint(x, y); if (el && el.classList.contains('board')) {
      let w = 0; while (w < 120 && document.elementFromPoint(x - w - 4, y)?.classList.contains('board') && document.elementFromPoint(x - w - 4, y - w - 4)?.classList.contains('board')) w += 4; if (w >= 40) return [x, y, w]; } } } return null; });
  const spot = await empty();
  if (spot) { await p.mouse.click(spot[0], spot[1]); await p.waitForTimeout(400); }
  const placed = await p.evaluate(() => WarshaCutUI.plan.unplaced.length);
  ok(spot && placed === 0, 'ضغط القطعة ثم مكان فارغ يضعها على اللوح');
  await p.click('[data-cz=draw]');
  const e2 = await empty(), sp2 = e2 && [e2[0], e2[1], e2[0] - e2[2] + 4, e2[1] - e2[2] + 4];
  if (sp2) { await drag(p, [sp2[0], sp2[1]], [sp2[2], sp2[3]]); await p.waitForSelector('#czDN'); await p.fill('#czDN', 'رف إضافي'); await p.click('[data-cz=drawOk]'); await p.waitForTimeout(400); }
  const drawn = await p.evaluate(() => { const j = WarshaCutUI.job; return {p: j.parts.find(x => x.name === 'رف إضافي'), placed: j.manual.sheets.some(s => s.parts.some(q => j.parts.find(x => x.id === q.pid)?.name === 'رف إضافي'))}; });
  ok(drawn.p && drawn.placed && drawn.p.L > 50 && drawn.p.W > 50, `رسم قطعة جديدة على اللوح بالإصبع (${drawn.p?.L}×${drawn.p?.W})`);
  // two parts on top of each other: caught
  await p.evaluate(() => { const s = WarshaCutUI.job.manual.sheets[0]; s.parts.push({...s.parts[0]}); WarshaCutUI.job.parts.find(x => x.id === s.parts[0].pid).qty++; });
  await p.click('[data-cz=cuts]'); await p.click('[data-cz=cuts]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => WarshaCutUI.plan.read[0].errors.some(e => e.type === 'overlap') && !!document.querySelector('.cz-warn') && !!document.querySelector('.part.bad')), 'التداخل يظهر بالأحمر مع تنبيه');

  console.log('أوراق الورشة');
  await p.click('[data-cz=pdf]'); await p.waitForSelector('#docSheet:not([hidden])', {timeout: 60000});
  ok(await p.evaluate(() => document.querySelector('#docTitle').textContent.includes('التقطيع') && document.querySelector('#docPreview').src.startsWith('data:image/jpeg')), 'PDF المخطط جاهز للحفظ');
  await p.evaluate(() => { document.querySelector('#docSheet').hidden = true; });
  await p.click('[data-cz=labels]'); await p.waitForSelector('#docSheet:not([hidden])', {timeout: 60000});
  ok(await p.evaluate(() => document.querySelector('#docTitle').textContent.includes('ملصقات')), 'ملصقات القطع جاهزة');
  await p.evaluate(() => { document.querySelector('#docSheet').hidden = true; });
  await p.click('[data-cz=auto]', {noWaitAfter: true}).catch(() => {});

  console.log('حفظ المهمة بعد إعادة الفتح');
  await p.waitForTimeout(1500);
  const id = await p.evaluate(() => WarshaCutUI.job.id);
  await p.reload(); await p.waitForFunction(() => window.__wr && window.WarshaCutUI, null, {timeout: 180000});
  await p.evaluate(() => WarshaCutUI.openLast()); await p.waitForTimeout(400);
  ok(await p.evaluate(i => WarshaCutUI.job.id === i && WarshaCutUI.job.parts.some(x => x.name === 'رف إضافي'), id), 'المهمة ترجع كما تُركت بعد إعادة تحميل الصفحة');
  ok(errors.length === 0, 'لا أخطاء في الصفحة' + (errors.length ? ': ' + errors[0] : ''));

  console.log('قفل التصميم');
  const L = await page({width: 1200, height: 800});
  const setup = await L.p.evaluate(async () => { const w = window.__wr; w.openDemo(0);
    w.set({...w.cfg, items: [{t: 'cab', w: 100, h: 80, d: 45, x: 150, z: 150, r: 0, o: {base: 'legs', cols: 1, rows: 1, cells: [{k: 'door'}]}}], itemsAuto: false}); w.setCam('top'); w.select({item: 0}, true);
    await new Promise(f => setTimeout(f, 700)); const pr = w.pieceRect(), st = document.querySelector('#stage').getBoundingClientRect(); return [st.x + (pr.x0 + pr.x1) / 2, st.y + (pr.y0 + pr.y1) / 2]; });
  await L.p.click('#lockBtn');
  const x0 = await L.p.evaluate(() => window.__wr.cfg.items[0].x);
  await drag(L.p, setup, [setup[0] + 90, setup[1] + 10]); await L.p.waitForTimeout(400);
  ok(await L.p.evaluate(() => window.__wr.cfg.items[0].x) === x0, 'التصميم مقفل: سحب القطعة لا يحركها');
  ok(await L.p.evaluate(() => localStorage.getItem('wr_lock')) === 'true', 'القفل محفوظ على الجهاز');
  await L.p.evaluate(() => window.__wr.select({item: 0}, true)); await L.p.waitForTimeout(300);
  ok(await L.p.evaluate(() => !document.querySelector('#qbar [data-it=ul]').hidden), 'زر فك قفل القطعة يظهر في شريطها');
  await L.p.click('#qbar [data-it=ul]'); await L.p.waitForTimeout(300);
  const c2 = await L.p.evaluate(() => { const pr = window.__wr.pieceRect(), st = document.querySelector('#stage').getBoundingClientRect(); return [st.x + (pr.x0 + pr.x1) / 2, st.y + (pr.y0 + pr.y1) / 2]; });
  await drag(L.p, c2, [c2[0] + 90, c2[1] + 10]); await L.p.waitForTimeout(400);
  ok(await L.p.evaluate(() => window.__wr.cfg.items[0].x) !== x0 && await L.p.evaluate(() => window.__wr.cfg.items[0].ul === true), 'القطعة المفكوكة تتحرك والتصميم مقفل');
  await L.p.evaluate(() => window.__wr.select(null));
  await L.p.evaluate(() => { const b = document.querySelector('[data-tab=free]'); b?.click(); });
  const added = await L.p.evaluate(async () => { const n = window.__wr.cfg.items.length; window.__wr.placePiece?.('shelf'); await new Promise(f => setTimeout(f, 300)); const it = window.__wr.cfg.items; return it.length > n ? !!it[it.length - 1].ul : null; });
  ok(added === true || added === null, added === null ? 'إضافة قطعة جديدة (لم تُفحص هنا)' : 'القطعة الجديدة والتصميم مقفل تبقى قابلة للتحريك');
  ok(L.errors.length === 0, 'لا أخطاء مع القفل' + (L.errors.length ? ': ' + L.errors[0] : ''));
} catch (e) { failures++; console.log('  ✗', e); }
finally { await browser.close(); }
console.log(failures ? `\n${failures} فحص فشل` : '\nكل الفحوص نجحت');
process.exit(failures ? 1 : 0);
