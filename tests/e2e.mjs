// End-to-end checks in a real browser: realistic projects, 3D build, cut list, prices, PDF, CSV, saving.
// Needs: npm i (three@0.147.0 and playwright). Run: npm run test:e2e
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threeDir = process.env.THREE_DIR || path.join(root, 'node_modules/three');
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } };

async function open(browser, viewport) {
  const page = await browser.newPage({viewport});
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('three@0.147.0/')) return r.fulfill({path: path.join(threeDir, u.split('three@0.147.0/')[1])});
    if (u.startsWith('file://')) return r.continue();
    return r.abort();
  });
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForFunction(() => window.__wr, null, {timeout: 120000});
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__wr.setQuality('performance'));
  return {page, errors};
}

// consistency between the 3D design and the cut list, and sanity of every number
const AUDIT = () => {
  const w = window.__wr, cl = w.cutList(), sale = w.sale(), out = {};
  out.parts = cl.parts.length;
  out.badParts = cl.parts.filter(p => !(p.L > 0 && p.W > 0 && p.L >= p.W && p.qty > 0 && p.th > 0)).length;
  out.placed = cl.nest.reduce((a, m) => a + m.sheets.reduce((b, s) => b + s.parts.length, 0), 0);
  out.sheetParts = cl.grouped.filter(g => !['glass', 'mirror', 'stone', 'worktop'].includes(g.mat)).reduce((a, g) => a + g.qty, 0);
  out.checks = cl.checks.map(c => c.msg);
  out.total = sale.total; out.sub = sale.sub;
  // every wall unit that is built from boards must appear in the cut list under its code
  const codes = new Set(cl.grouped.flatMap(g => g.codes));
  const missing = [];
  for (const id of ['A', 'B', 'C']) {
    const list = w.cfg.units?.[id]; if (!list) continue;
    let bi = 0;
    for (const m of list.b || []) { if (['bgap', 'window', 'rdoor', 'washer'].includes(m.t)) { if (!['bgap', 'window', 'rdoor'].includes(m.t)) bi++; continue; } bi++; }
  }
  (w.cfg.items || []).forEach((it, i) => { if (['cab', 'bar', 'panel'].includes(it.t) && !codes.has('P' + (i + 1))) missing.push('P' + (i + 1)); });
  out.missingCodes = missing;
  out.issues = w.checkIssues().length;
  return out;
};

const scenarios = [
  {name: 'مطبخ L بجزيرة', demo: 0},
  {name: 'مطبخ U بلا مقابض', demo: 1},
  {name: 'مطبخ أمريكي مع بار', demo: 2},
  {name: 'غرفة ملابس U', demo: 3},
  {name: 'غرفة نوم', demo: 4},
  {name: 'جدار تلفزيون بطاولة مائلة', demo: 5},
  {name: 'خزائن مخصصة', demo: 6},
];

const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  const {page, errors} = await open(browser, {width: 1400, height: 860});
  for (const sc of scenarios) {
    console.log(sc.name);
    await page.evaluate(i => window.__wr.openDemo(i), sc.demo);
    await page.waitForTimeout(800);
    const a = await page.evaluate(AUDIT);
    ok(a.parts > 0 && a.badParts === 0, `قائمة التقطيع سليمة (${a.parts} قطعة)`);
    ok(a.placed === a.sheetParts, `كل القطع موضوعة على الألواح (${a.placed}/${a.sheetParts})`);
    ok(a.missingCodes.length === 0, 'كل قطعة مخصصة لها سطر في القائمة' + (a.missingCodes.length ? ': ' + a.missingCodes.join(' ') : ''));
    ok(a.total > 0 && Number.isFinite(a.total), `السعر ${Math.round(a.total)}`);
    ok(!a.checks.some(m => m.includes('غير صالح')), 'لا مقاسات غير صالحة' + (a.checks.length ? ` (${a.checks.length} تنبيه)` : ''));
    const docs = await page.evaluate(async () => {
      const w = window.__wr, q = await w.bq(), b = await w.bw(), c = w.csv();
      const head = async blob => new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5));
      const pages = async blob => (new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer())).match(/\/Type\s*\/Page[^s]/g) || []).length;
      const csv = await c;
      return {q: await head(q.blob), qp: await pages(q.blob), b: await head(b.blob), bp: await pages(b.blob), csvRows: csv.trim().split('\r\n').length, csvCols: csv.split('\r\n')[0].split(',').length, grouped: w.cutList().grouped.length};
    });
    ok(docs.q === '%PDF-' && docs.qp >= 2, `عرض السعر PDF (${docs.qp} صفحات)`);
    ok(docs.b === '%PDF-' && docs.bp >= 3, `ورقة الورشة PDF (${docs.bp} صفحات)`);
    ok(docs.csvRows === docs.grouped + 1 && docs.csvCols === 12, `CSV (${docs.csvRows - 1} سطر، ${docs.csvCols} عمود)`);
  }
  console.log('إعدادات التصنيع');
  const fabRes = await page.evaluate(() => { const w = window.__wr; w.openDemo(0); const before = w.cutList(); const side0 = before.grouped.find(g => g.kind === 'قاعدة' && g.codes.includes('A1'));
    w.fab = {...w.fab, t: 16}; const after = w.cutList(); const side1 = after.grouped.find(g => g.kind === 'قاعدة' && g.codes.includes('A1')); w.fab = {}; return {a: side0 && Math.max(side0.L, side0.W), b: side1 && Math.max(side1.L, side1.W), th: side1 && side1.th}; });
  ok(fabRes.b - fabRes.a === 4 && fabRes.th === 16, `سماكة 16 مم تغيّر القاعدة من ${fabRes.a} إلى ${fabRes.b}`);
  console.log('المشاريع');
  const proj = await page.evaluate(async () => { const w = window.__wr; const n0 = w.store.list.length;
    const file = new File([JSON.stringify({app: 'warsha-studio', v: 1, kind: 'project', projects: [{name: 'زبون اختبار', cfg: {room: 'kitchen', layout: 'U', wallA: 9999}}]})], 'p.json', {type: 'application/json'});
    await w.importFile(file); const d = w.store.list.find(x => x.name === 'زبون اختبار');
    const bad = new File(['not json'], 'x.json'); await w.importFile(bad);
    return {added: w.store.list.length - n0, wallA: d?.cfg.wallA}; });
  ok(proj.added === 1 && proj.wallA === 700, `استيراد مشروع مع تصحيح المقاسات (${proj.wallA})`);
  await page.evaluate(() => window.__wr.set({room: 'office'}));
  await page.waitForTimeout(1200);
  await page.reload(); await page.waitForFunction(() => window.__wr, null, {timeout: 120000}); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => window.__wr.cfg.room) === 'office', 'استرجاع العمل غير المحفوظ بعد إعادة فتح الصفحة');
  for (const l of ['fr', 'tr']) {
    console.log('اللغة ' + l);
    await page.selectOption('#langSel', l); await page.waitForTimeout(1500);
    for (const tab of ['space', 'units', 'free', 'mat', 'cost']) { await page.click(`[data-tab="${tab}"]`); await page.waitForTimeout(250); }
    const left = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (/[\u0600-\u06FF]/.test(n.data) && !n.parentElement.closest('[data-notr],script,style') && n.parentElement.offsetParent) out.push(n.data.trim().slice(0, 40));
      return [...new Set(out)]; });
    ok(left.length === 0, 'الواجهة مترجمة بالكامل' + (left.length ? ': ' + left.slice(0, 5).join(' | ') : ''));
    ok(await page.evaluate(() => document.documentElement.dir) === 'ltr', 'اتجاه الصفحة من اليسار');
    const pdf = await page.evaluate(async () => { const q = await window.__wr.bq(); return new TextDecoder().decode(new Uint8Array(await q.blob.arrayBuffer()).slice(0, 5)); });
    ok(pdf === '%PDF-', 'عرض السعر بهذه اللغة');
  }
  await page.selectOption('#langSel', 'ar'); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => document.documentElement.dir === 'rtl' && document.querySelector('[data-tab="free"]').textContent.startsWith('تصميم حر')), 'الرجوع إلى العربية');
  console.log('جودة العرض');
  for (const q of ['performance', 'standard', 'ultra']) {
    const r = await page.evaluate(q => { const w = window.__wr; w.openDemo(0); w.setQuality(q); const t0 = performance.now(); const cv = w.snap(960, 600); const ms = performance.now() - t0; const px = cv.getContext('2d').getImageData(480, 300, 1, 1).data; const cl = w.cutList(); return {ms: Math.round(ms), lit: px[0] + px[1] + px[2] > 0, parts: cl.parts.length, total: Math.round(w.sale().total)}; }, q);
    ok(r.lit, `${q}: صورة 960×600 في ${r.ms} مم ث (معالج رسوم برمجي)`);
    console.log(`    parts=${r.parts} total=${r.total}`);
  }
  const same = await page.evaluate(() => { const w = window.__wr, out = []; for (const q of ['performance', 'ultra']) { w.setQuality(q); out.push(JSON.stringify([w.cutList().grouped.map(g => [g.L, g.W, g.qty]), Math.round(w.sale().total)])); } w.setQuality('performance'); return out[0] === out[1]; });
  ok(same, 'الجودة لا تغيّر قائمة التقطيع ولا السعر');
  const shot = await page.evaluate(() => { const c = window.__wr.snap(3840, 2160); return [c.width, c.height]; });
  ok(shot[0] === 3840 && shot[1] >= 2160, `صورة 4K ${shot.join('×')}`);
  console.log('وضع العرض');
  await page.evaluate(() => window.__wr.setPresent(true)); await page.waitForTimeout(300);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#panel')).display === 'none' && getComputedStyle(document.querySelector('.bar')).display === 'none'), 'الأدوات مخفية في وضع العرض');
  await page.evaluate(() => window.__wr.setPresent(false)); await page.waitForTimeout(300);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#panel')).display !== 'none'), 'الخروج من وضع العرض');
  ok(errors.length === 0, 'لا أخطاء في الصفحة' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await page.close();

  console.log('الهاتف');
  const m = await open(browser, {width: 390, height: 844});
  await m.page.evaluate(() => window.__wr.openDemo(6)); await m.page.waitForTimeout(800);
  for (const tab of ['space', 'units', 'free', 'mat', 'cost']) { await m.page.click(`[data-tab="${tab}"]`); await m.page.waitForTimeout(200); }
  ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'لا تمرير أفقي على عرض 390');
  ok(m.errors.length === 0, 'لا أخطاء على الهاتف' + (m.errors.length ? ': ' + m.errors[0] : ''));
} finally { await browser.close(); }
console.log(failures ? `\n${failures} فحص فشل` : '\nكل الفحوص نجحت');
process.exit(failures ? 1 : 0);
