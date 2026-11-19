// End-to-end checks in a real browser: realistic projects, 3D build, cut list, prices, PDF, CSV, saving.
// Needs: npm i (three@0.147.0 and playwright). Run: npm run test:e2e
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {openApp} from './serve.mjs';
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
  await openApp(page, root, threeDir);
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
  await page.reload({waitUntil: 'domcontentloaded', timeout: 180000}); await page.waitForFunction(() => window.__wr, null, {timeout: 120000}); await page.waitForTimeout(1500);
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
  console.log('الخامات الحقيقية والتصوير الواقعي');
  // the design is never touched by rendering: same parts, sizes, grain and price at every level and in photo mode
  const ref = await page.evaluate(() => { const w = window.__wr, sig = () => JSON.stringify([w.cutList().grouped.map(g => [g.kind, g.L, g.W, g.th, g.qty, g.grain]), Math.round(w.sale().total)]), out = [];
    for (let d = 0; d < 7; d++) { w.openDemo(d); const s = []; for (const q of ['performance', 'standard', 'ultra']) { w.setQuality(q); s.push(sig()); } w.setPhoto(true); s.push(sig()); w.setPhoto(false); out.push(s.every(x => x === s[0])); }
    w.setQuality('performance'); return out; });
  ok(ref.every(Boolean), `القائمة والمقاسات والسعر متطابقة في المستويات الثلاثة ووضع التصوير (${ref.filter(Boolean).length}/7 مشاريع)`);
  await page.evaluate(() => { const w = window.__wr; w.openDemo(0); w.setQuality('standard'); }); await page.evaluate(() => window.__wr.texReady());
  const tx = await page.evaluate(() => window.__wr.texStats());
  ok(tx.textures > 0 && tx.failed === 0, `الخامات الحقيقية محمّلة (${tx.textures} صورة، نحو ${tx.mb} م.ب في ذاكرة الرسم)`);
  ok(await page.evaluate(() => window.__wr.envReady), 'بيئة الإضاءة HDR محمّلة');
  const gr = await page.evaluate(() => { const w = window.__wr; w.set({...w.cfg, front: 'wenge', worktop: 'nero', floor: 'herring'}); const cl = w.cutList(), mine = cl.grouped.filter(x => x.mat === 'front:wenge'), d = mine.filter(x => x.kind === 'باب'), r = mine.filter(x => x.kind === 'واجهة جارور'); return {ok: mine.every(x => x.grain), n: d.length + r.length}; });
  ok(gr.n > 0 && gr.ok, 'الخشب الداكن الجديد له اتجاه عرق في قائمة التقطيع');
  const ph = await page.evaluate(async () => { const w = window.__wr; w.openDemo(0); const cv = await w.photoShot(480, 300, 3); const px = cv.getContext('2d').getImageData(240, 150, 1, 1).data; return {w: cv.width, lit: px[0] + px[1] + px[2] > 0, deep: w.ssao?.beautyRenderTarget.stencilBuffer === true, hp: w.renderer.capabilities.precision !== 'highp' || [w.ssao?.ssaoMaterial, w.ssao?.blurMaterial, ...w.photoMats].filter(Boolean).every(m => m.fragmentShader.startsWith('precision highp sampler2D'))}; });
  ok(ph.w === 480 && ph.lit, 'التصوير الواقعي ينتج صورة');
  // 16-bit depth in the photo buffers printed stripes where faces sit millimetres apart (fronts, hob, wall cladding)
  ok(ph.deep, 'مخازن التصوير الواقعي بعمق 24 بت، فلا خطوط متعرجة على الواجهات والجدران');
  // phone GPUs read textures at lowp unless asked: the depth read by ambient occlusion then prints bands on ceilings and walls
  ok(ph.hp, 'مرشحات التصوير تقرأ العمق والصور بدقة عالية على الهاتف، فلا أشرطة على السقف والجدران');
  await page.evaluate(() => window.__wr.setQuality('performance'));
  console.log('تداخل القطع');
  const cl = await page.evaluate(() => { const w = window.__wr, out = {demos: []};
    for (let d = 0; d < 7; d++) { w.openDemo(d); out.demos.push(w.clashes.length); }
    w.openDemo(6); const a = 0, b = 1, before = JSON.stringify(w.cfg.items[a]);
    w.noClash = true; w.select({item: a}); w.setItemField('x', w.cfg.items[b].x);
    out.blocked = JSON.stringify(w.cfg.items[a]) === before && w.clashes.length === 0;
    w.noClash = false; w.select({item: a}); w.setItemField('x', w.cfg.items[b].x);
    out.shown = w.clashes.find(c => c.a === a && c.b === b)?.depth || 0;
    out.issue = w.checkIssues().some(x => x.i === a && x.with === b);
    w.noClash = true; const st = w.settle(a); out.settle = st && !st.back ? st.s : -1;
    w.openDemo(6); return out; });
  ok(cl.demos.every(n => n === 0), `لا تداخل كاذب في المشاريع السبعة (${cl.demos.join('، ')})`);
  ok(cl.blocked, 'منع التداخل: نقل خزانة داخل أخرى لا يُطبّق');
  ok(cl.shown > 0 && cl.issue, `حين يُسمح بالتداخل يُكشف بعمقه (${cl.shown} سم) ويظهر في فحص التصميم`);
  ok(cl.settle > 0, `القطعة المتداخلة تجد أقرب مكان فارغ (${cl.settle} سم)`);
  console.log('حدود الغرفة');
  const bd = await page.evaluate(() => { const w = window.__wr, out = {demos: []}, outside = () => w.boxes.filter(b => b.x0 < -.6 || b.x1 > w.cfg.wallA + .6 || b.z0 < -.6).length;
    for (let d = 0; d < 7; d++) { w.openDemo(d); out.demos.push(outside()); }
    w.openDemo(6); w.select({item: 0}); w.setItemField('x', -300); out.left = w.boxes[0].x0;
    w.select({item: 0}); w.setItemField('z', 2000); out.front = w.boxes[0].z1 - w.cfg.wallB;
    w.openDemo(6); w.set({...w.cfg, wallA: 300}); out.shrink = outside(); w.openDemo(6); return out; });
  ok(bd.demos.every(n => n === 0), 'لا قطعة خارج الأرضية في المشاريع السبعة');
  ok(bd.left >= -.6 && bd.front <= .6, `قطعة دُفعت خارج الجدار أو الأرضية رجعت إلى الداخل (${Math.round(bd.left)}، ${Math.round(bd.front)})`);
  ok(bd.shrink === 0, 'تصغير الغرفة يُبقي القطع داخلها');
  console.log('الزوايا المدوّرة');
  const rcx = await page.evaluate(() => { const w = window.__wr, sig = () => JSON.stringify(w.cutList().grouped.map(g => [g.kind, g.L, g.W, g.th, g.qty, g.grain]));
    w.openDemo(6); const s0 = sig(), p0 = w.sale().total; w.select({item: 1});
    w.setRC(() => ({r: 30, c: ['fl', 'fr', 'tl', 'tr']})); const st = {...w.rcStats}, cl = w.cutList(), p1 = w.sale().total;
    const out = {cut: st.cut, same: sig() === s0, notes: cl.shaping.length, jobs: cl.hw.radius, diff: Math.round(p1 - p0), kept: w.cfg.items[1].rc?.c.length};
    w.openDemo(0); w.select({run: 'A', lvl: 'b', i: 0}); w.setRC(() => ({r: 20, c: ['fl']})); out.unit = w.rcStats.cut; out.unitNote = w.cutList().shaping.length;
    w.select({run: 'A', lvl: 'b', i: 0}); w.setRC(() => null); out.cleared = w.cutList().shaping.length; w.openDemo(6); return out; });
  ok(rcx.cut > 0 && rcx.kept === 4, `زوايا مدوّرة على خزانة حرة (${rcx.cut} لوحاً أعيد رسمه)`);
  ok(rcx.same, 'قائمة القطع ومقاساتها لا تتغير، تُضاف ملاحظة القص فقط');
  ok(rcx.notes === 1 && rcx.jobs === 4, `ملاحظة الزوايا في ورقة الورشة و${rcx.jobs} أعمال قص`);
  ok(rcx.diff > 0, `سعر الزوايا يُضاف إلى العرض (+${rcx.diff})`);
  ok(rcx.unit > 0 && rcx.unitNote === 1 && rcx.cleared === 0, 'زاوية مدوّرة على وحدة مطبخ، ثم إلغاؤها');
  console.log('ارتفاع الأعمدة، الجدران الأربعة، الصف فوق العلوية');
  const nw = await page.evaluate(() => { const w = window.__wr, out = {}; w.openDemo(0);
    const parts = code => w.cutList().parts.filter(x => x.code === code), base = JSON.stringify(w.cutList().parts);
    const put = f => { const c = structuredClone(w.cfg); c.auto = false; f(c); w.set(c); };
    put(c => { c.units.A.b[5].o = {h: 250}; }); out.h250 = parts('A6').find(x => x.kind === 'جانب')?.L; out.doors = parts('A6').filter(x => x.kind === 'باب').map(x => x.L + '×' + x.W).join(' ');
    put(c => { c.units.A.b[5].o = {h: 250, tc: 0}; }); out.tc0 = parts('A6').filter(x => x.kind === 'باب').length;
    put(c => { c.units.A.b[5].o = {h: 300}; }); out.cap = w.tallOf(w.cfg.units.A.b[5]).Ht;
    put(c => { c.units.A.b[5].o = {}; c.units.C = {b: [{t: 'door', w: 60}], u: [{t: 'udoor', w: 60}], t: []}; c.units.D = {b: [{t: 'door', w: 80}], u: [{t: 'window', w: 100}], t: []}; c.units.A.t = [{t: 'tdoor', w: 60}]; });
    const codes = new Set(w.cutList().parts.map(x => x.code)); out.codes = ['C1', 'C^1', 'D1', 'AT1'].filter(k => codes.has(k)).length;
    out.at = parts('AT1').find(x => x.kind === 'جانب')?.L; out.sale = w.sale().lines.some(l => l[3] === 'toprow'); out.clashes = w.clashes.length;
    w.openDemo(0); out.back = JSON.stringify(w.cutList().parts) === base;
    w.openDemo(6); w.select({item: 0}, true); out.bar = !document.querySelector('#qbar').hidden; document.querySelector('#qbar [data-it="close"]').click(); out.barGone = document.querySelector('#qbar').hidden && w.sel === null;
    return out; });
  ok(nw.h250 === 2400 && nw.doors === '757×597 1197×597 597×437', `عمود ثلاجة بارتفاع 250 سم: جانب ${nw.h250} مم، أبواب ${nw.doors}`);
  ok(nw.tc0 === 2, 'خزانة علوية بارتفاع 0: بابان فقط في العمود');
  ok(nw.cap === 266, `العمود يبقى 4 سم تحت السقف (${nw.cap} سم)`);
  ok(nw.codes === 4, 'وحدات على الجدار الأيمن والأمامي وفوق العلوية في قائمة القص');
  ok(nw.at === 510 && nw.sale, `الصف فوق العلوية حتى السقف (${nw.at} مم) وسعره في العرض`);
  ok(nw.clashes === 0 && nw.back, 'لا تداخل، والمشروع التجريبي يعود كما كان');
  ok(nw.bar && nw.barGone, 'شريط أدوات القطعة يُغلق بزر الإغلاق');
  console.log('النسخ والتداخل: مكان فارغ وحذف');
  const sp = await page.evaluate(() => { const w = window.__wr, out = {}; w.openDemo(0);
    const cab = x => ({t: 'cab', w: 100, h: 38, d: 35, y: 217, x, z: 18, r: 0, o: {base: 'hang', cols: 2, rows: 1, cells: [{k: 'flap'}, {k: 'flap'}]}});
    w.set({...w.cfg, items: [cab(110)], itemsAuto: false});
    for (let k = 0; k < 4; k++) { w.select({item: w.cfg.items.length - 1}); w.itemAction('dup'); }
    out.n = w.cfg.items.length; out.dupClashes = w.clashes.length; out.walls = [...new Set(w.cfg.items.map(it => it.r))].length;
    w.noClash = false; const c = structuredClone(w.cfg.items); c[1].x = c[0].x + 30; w.set({...w.cfg, items: c}); out.forced = w.clashes.length;
    w.renderFree(); document.querySelector('[data-isspot]')?.click(); out.fixed = w.clashes.length;
    w.select({item: 0}); w.itemAction('spot:C'); out.right = w.cfg.items[0].r === 90 && w.clashes.length === 0;
    const c2 = structuredClone(w.cfg.items); Object.assign(c2[2], {x: c2[1].x, z: c2[1].z, r: c2[1].r}); w.set({...w.cfg, items: c2}); w.renderFree();
    const n0 = w.cfg.items.length; document.querySelector('[data-isdel]')?.click(); out.deleted = n0 - w.cfg.items.length; out.end = w.clashes.length; w.noClash = true;
    w.openDemo(0); w.select({run: 'A', lvl: 'b', i: 1}); document.querySelector('[data-u="dup"]')?.click();
    out.unitTo = w.sel?.run; out.unitA = w.cfg.units.A.b.length; out.unitThere = w.sel ? w.cfg.units[w.sel.run].b.length : 0; w.openDemo(0);
    return out; });
  ok(sp.n === 5 && sp.dupClashes === 0 && sp.walls >= 2, `4 نسخ لخزانة فوق العلوية: كل نسخة في مكان فارغ، على ${sp.walls} جدار، بلا تداخل`);
  ok(sp.forced === 1 && sp.fixed === 0, 'زر «مكان فارغ» في فحص التصميم يفك التداخل');
  ok(sp.right, 'نقل القطعة إلى مكان فارغ على الجدار الأيمن');
  ok(sp.deleted === 1 && sp.end === 0, 'زر «حذف» في فحص التصميم يحذف النسخة المتداخلة');
  ok(sp.unitTo && sp.unitTo !== 'A' && sp.unitA === 6, `نسخة وحدة لا مكان لها على الجدار الرئيسي تذهب إلى ${sp.unitTo}`);
  console.log('وحدة مفصولة عن الصف: سماكات أرقام في ورقة الورشة، والعملة يورو');
  const dt = await page.evaluate(() => { const w = window.__wr; w.openDemo(0); const k = w.detachUnit({run: 'A', lvl: 'b', i: 1}); const cl = w.cutList();
    return {k, bad: cl.parts.filter(x => typeof x.th !== 'number' || !isFinite(x.th)).length + cl.mats.filter(m => typeof m.th !== 'number').length}; });
  ok(dt.k >= 0 && dt.bad === 0, `وحدة سفلية مفصولة: كل السماكات أرقام (${dt.bad} خطأ)`);
  ok(await page.evaluate(() => document.querySelector('#p-cur')?.value) === '€', 'العملة الافتراضية يورو');
  console.log('تخصيص كامل لوحدة: خانات ورفوف داخلها');
  const cz = await page.evaluate(() => { const w = window.__wr, out = {}; w.openDemo(w.DEMOS.findIndex(d => d.cfg.room === 'living'));
    const L = w.cfg.units.A.b, i = L.findIndex(m => m.t === 'bookcase'), m0 = L[i], before = w.cutList().parts.length;
    w.select({run: 'A', lvl: 'b', i}, true); const btn = document.querySelector('[data-u="cab"]'); out.btn = !!btn; btn?.click();
    const k = w.cfg.items.length - 1, it = w.cfg.items[k]; out.cab = it?.t === 'cab'; out.same = it?.w === m0.w && it?.h === w.cfg.height && it?.d === 35;
    out.gap = w.cfg.units.A.b[i]?.t === 'bgap'; out.rows = it?.o?.rows; out.door = it?.o?.cells?.at(-1)?.k;
    out.tab = !document.querySelector('#pane-free').hidden && !!document.querySelector('#itemEditor .cellmap');
    // shelves in a cell: two glass shelves in the top cell, then two wood shelves behind the bottom doors
    document.querySelector('[data-cell="0"]').dispatchEvent(new MouseEvent('click', {bubbles: true}));
    document.querySelector('[data-shelf="1"]').click(); document.querySelector('[data-shelf="1"]').click(); document.querySelector('[data-shelfm] [data-v="glass"]').click();
    const last = w.cfg.items[k].o.cells.length - 1; document.querySelector(`[data-cell="${last}"]`).dispatchEvent(new MouseEvent('click', {bubbles: true}));
    document.querySelector('[data-shelf="1"]').click(); document.querySelector('[data-shelf="1"]').click();
    const c = w.cfg.items[k].o.cells, cl = w.cutList().parts;
    out.cells = [c[0].n, !!c[0].sg, c[last].n, !!c[last].sg];
    out.glass = cl.filter(p => p.kind === 'رف زجاج' && p.mat === 'glass').reduce((a, p) => a + p.qty, 0);
    out.wood = cl.filter(p => p.kind === 'رف داخلي').reduce((a, p) => a + p.qty, 0);
    out.width = cl.find(p => p.kind === 'رف داخلي')?.L ?? cl.find(p => p.kind === 'رف داخلي')?.W;
    return out; });
  ok(cz.btn && cz.cab && cz.same && cz.gap, 'زر «تخصيص كامل» يحوّل المكتبة إلى خزانة مخصصة بالعرض والارتفاع والعمق نفسها وفي مكانها');
  ok(cz.rows === 6 && (cz.door === 'double' || cz.door === 'door'), `المكتبة المخصصة تحفظ شكلها: ${cz.rows} صفوف والصف السفلي أبواب`);
  ok(cz.tab, 'بعد التحويل تفتح لوحة الخانات في التصميم الحر');
  ok(cz.cells.join() === '2,true,2,false', `رفوف داخل الخانة بعددها ومادتها (${cz.cells.join()})`);
  ok(cz.glass >= 2 && cz.wood === 2, `الرفوف الداخلية في قائمة التقطيع: ${cz.wood} خشب و${cz.glass} زجاج`);
  ok(cz.width === 60 * 10 - 2 * 18 - 2, `عرض الرف الداخلي = عرض الخانة من الداخل ناقص 2 مم (${cz.width})`);
  ok(await page.evaluate(() => window.__wr.DEMOS && ['wdoor', 'wdrawer', 'wopen'].every(t => { const w = window.__wr; w.select({run: 'A', lvl: 'b', i: w.cfg.units.A.b.findIndex(m => m.t === 'bookcase')}, true); return !!document.querySelector(`#unitEditor [data-type="${t}"]`); })), 'الصالون فيه خزائن طويلة مغلقة: باب وجوارير ورفوف');
  console.log('ديكور التلفزيون وأشكال الطاولة وواجهاتها');
  const dk = await page.evaluate(() => { const w = window.__wr, out = {}; w.openDemo(w.DEMOS.findIndex(d => d.cfg.room === 'living'));
    const setClad = o => { const u = JSON.parse(JSON.stringify(w.cfg.units)), m = u.A.u.find(x => x.t === 'clad'); m.o = {...(m.o || {}), ...o}; w.set({...w.cfg, units: u}); return w.cfg.units.A.u.find(x => x.t === 'clad'); };
    const part = (k) => w.cutList().parts.find(p => p.kind === k);
    const before = part('لوح خلفي'); out.h0 = before && Math.max(before.L, before.W);
    const m = setClad({sh: 'arch', ceil: false, h: 200, y0: 40, s: 'fluted', pitch: 'fine', tv: '75', ty: 140});
    out.kept = m.o.sh === 'arch' && m.o.h === 200 && m.o.y0 === 40 && m.o.ty === 140;
    const pf = part('لوح ديكور محفور'); out.fl = pf && [pf.L, pf.W].sort((a, b) => a - b)[0]; out.hw = w.cutList().hw; 
    setClad({s: 'slats', pitch: 'wide', sh: 'rect', ceil: true}); const sl = w.cutList().parts.find(p => p.kind === 'شريحة'); out.slat = sl && [Math.min(sl.L, sl.W), sl.qty];
    const k = w.cfg.items.findIndex(it => it.t === 'cab'); w.select({item: k}, true);
    const bt = document.querySelector('[data-shape="tvShaker"]'); out.shapeBtn = !!bt; const x0 = w.cfg.items[k].x, w0 = w.cfg.items[k].w; bt?.click();
    const it = w.cfg.items[k]; out.shape = it.o.fs === 'shaker' && it.x === x0 && it.w === w0 && it.h === 62; out.route = w.cutList().hw.route > 0;
    return out; });
  ok(dk.kept && dk.fl === 2000, `الديكور: قوس، ارتفاع 200 يبدأ من 40، شاشة 75 على 140، والقطعة في قائمة التقطيع بارتفاع ${dk.fl} مم`);
  ok(dk.hw?.archcut === 1 && dk.hw?.route > 0, 'القوس والحفر يظهران في قائمة الإكسسوارات والأعمال');
  ok(dk.slat?.[0] === 60 && dk.slat?.[1] === Math.floor(2600 / 100), `الشرائح العريضة 60 مم كل 10 سم (${dk.slat})`);
  ok(dk.shapeBtn && dk.shape && dk.route, 'تغيير شكل الطاولة من لوحتها يحفظ المكان والعرض، والواجهات بإطار تضيف الحفر');
  console.log('رفوف الجدار بأشكالها');
  const shf = await page.evaluate(() => { const w = window.__wr, out = {}; w.openDemo(w.DEMOS.findIndex(d => d.cfg.room === 'living'));
    const put = o => { const u = JSON.parse(JSON.stringify(w.cfg.units)); u.A.u = [{t: 'ugap', w: 30}, {t: 'shelf', w: 120, o: {y: 120, ...o}}, {t: 'ugap', w: 30}]; w.set({...w.cfg, units: u}); return w.cutList(); };
    let cl = put({}); out.flat = cl.parts.filter(p => p.kind === 'رف عائم').map(p => [p.L, p.W, p.th, p.qty]).join();
    cl = put({s: 'stagger', n: 4}); out.stag = cl.parts.filter(p => p.kind === 'رف عائم').map(p => [p.L, p.qty]).join();
    cl = put({s: 'bracket', mat: 'glass', n: 3, dp: 30}); out.glass = cl.parts.filter(p => p.kind === 'رف زجاج').map(p => [p.L, p.W, p.th, p.qty]).join(); out.br = cl.hw.shelfbr;
    cl = put({s: 'cube', n: 2, sp: 40}); out.cube = cl.parts.filter(p => /مكعب/.test(p.kind)).reduce((a, p) => a + p.qty, 0);
    w.select({run: 'A', lvl: 'u', i: 1}, true); out.ui = !!document.querySelector('#unitEditor [data-v="cube"], #unitEditor [data-k="s"]') || /مكعبات مفتوحة/.test(document.querySelector('#unitEditor')?.textContent || '');
    return out; });
  ok(shf.flat === '1200,250,38,2', `الرف المستقيم كما كان: ${shf.flat}`);
  ok(shf.stag === '780,4', `الرفوف المتدرجة بطول 65% من الوحدة (${shf.stag})`);
  ok(shf.glass === '1200,300,10,3' && shf.br === 6, `رفوف زجاج على حوامل معدنية بعمق 30 (${shf.glass}، ${shf.br} حامل)`);
  ok(shf.cube === 8 && shf.ui, `المكعبات المفتوحة: ${shf.cube} قطع لمكعبين، والأشكال في لوحة الوحدة`);
  console.log('طاولة الوسط: شكل وسطح وأرجل ولون');
  const ctb = await page.evaluate(() => { const w = window.__wr; w.openDemo(w.DEMOS.findIndex(d => d.cfg.room === 'living')); const k = w.cfg.items.findIndex(it => it.t === 'ctable'), code = 'P' + (k + 1);
    const parts = () => w.cutList().parts.filter(p => p.code === code).map(p => [p.kind, p.L, p.W, p.th, p.qty, p.mat].join(':')).join('|');
    const set = o => { const L = JSON.parse(JSON.stringify(w.cfg.items)); L[k].o = o; w.set({...w.cfg, items: L}); return parts(); };
    const def = parts(), round = set({s: 'round', top: 'marble', leg: 'pedestal'}), col = set({s: 'square', top: 'color', leg: 'solid', col: '#6B2E2A'});
    w.select({item: k}, true); const ui = /دائرية/.test(document.querySelector('#itemEditor')?.textContent || '');
    return {def, round, col, ui, depth: w.cfg.items[k] && w.__itemDepth?.(w.cfg.items[k])}; });
  ok(ctb.def === 'سطح:1100:600:30:1:accent|رف سفلي:1040:540:18:1:accent', 'طاولة الوسط الافتراضية كما كانت في قائمة التقطيع');
  ok(ctb.round === 'سطح دائري:1100:1100:20:1:stone' && /front:#6B2E2A/.test(ctb.col) && /جانب مصمت/.test(ctb.col) && ctb.ui, 'طاولة دائرية من رخام على قاعدة، ومربعة باللون المختار بجانبين مصمتين، والخيارات في لوحتها');
  console.log('زوايا من الأمام وموديلات طاولات التلفزيون');
  const tvm = await page.evaluate(() => { const w = window.__wr, out = {}; w.openDemo(5); w.renderFree();
    const tv = w.cfg.items.findIndex(it => it.t === 'cab' && it.o?.endL); w.select({item: tv}, true);
    document.querySelector('[data-rc-ends]')?.click(); const rc = w.cfg.items[tv].rc; out.ends = rc && ['tl', 'tr', 'dl', 'dr'].every(k => rc.c.includes(k)) && rc.r >= 22;
    out.shaped = w.rcStats.cut; out.note = w.cutList().shaping.some(x => x.msg.includes('أسفل يسار'));
    document.querySelector('[data-rck="cut"]')?.click(); out.cut = w.cfg.items[tv].rc?.k === 'cut' && w.cutList().shaping.some(x => x.msg.includes('مائل'));
    // a TV unit with a vase on top: the curve follows the unit itself, the vase stays, the workshop radius is half the height
    { const items = w.cfg.items.filter(it => it.t !== 'cab'); items.push({t: 'tvbase', w: 220, x: 220, z: 22, r: 0, o: {s: 'flaps', f: true}, rc: {r: 56, c: ['tl', 'tr', 'dl', 'dr']}}); w.set({...w.cfg, items, itemsAuto: false});
      out.unitHidden = w.rcStats.hidden; out.unitNote = w.cutList().shaping.some(x => / 22 /.test(x.msg)); }
    w.openDemo(6); const n0 = w.cfg.items.length;
    document.querySelector('[data-tab="free"]').click(); document.querySelector('[data-g="tv"]')?.click();
    const keys = [...document.querySelectorAll('.ugrid.pal [data-pal]')].map(b => b.dataset.pal); out.models = keys.length;
    w.noClash = false; for (const k of keys.filter(k => k.startsWith('tv') && k !== 'tvbase' && k !== 'tvCorner')) w.placePiece(k); w.noClash = true;
    out.placed = w.cfg.items.length - n0; out.round = !!w.cfg.items.find(it => it.rc?.c?.includes('dl'));
    w.openDemo(6); return out; });
  ok(tvm.ends && tvm.shaped > 0 && tvm.note, `طرفان مدوّران من الأمام ( ___ ) بنصف قطر نصف الارتفاع (${tvm.shaped} لوحاً أعيد رسمه)`);
  ok(tvm.cut, 'الزوايا تصير مائلة بدل القوس، مع ملاحظة القص');
  ok(tvm.unitHidden === 0 && tvm.unitNote, 'الزهرية فوق الطاولة تبقى، ونصف القطر في ورقة الورشة لا يزيد عن نصف الارتفاع (22 سم)');
  ok(tvm.models >= 15 && tvm.placed >= 13 && tvm.round, `مكتبة طاولات التلفزيون: ${tvm.models} موديلاً، وُضع منها ${tvm.placed}`);
  console.log('الشفاط: تحت خزانة، مدمج، مدخنة أقصر، بلا مدخنة');
  const hd = await page.evaluate(() => { const w = window.__wr, out = {}; w.openDemo(0);
    const put = o => { const c = structuredClone(w.cfg); c.auto = false; c.units.B.u[1].o = o; w.set(c); return w.cutList(); };
    const base = w.cutList().parts.length, price0 = w.sale().total;
    let cl = put({s: 'under'}); out.under = cl.parts.length > base && cl.shaping.some(x => !x.rc) && w.sale().total > price0;
    cl = put({s: 'tele', cab: 'door'}); out.tele = cl.parts.some(x => x.kind === 'واجهة الشفاط');
    put({s: 'chimney', ch: 'cut', chH: 30}); const c = structuredClone(w.cfg); c.units.B.t = [{t: 'tdoor', w: 400}]; w.set(c);
    out.topOver = w.cutList().parts.filter(x => /^BT/.test(x.code)).length > 0;
    put({s: 'box', ch: 'none'}); out.none = w.cutList().parts.length >= base; out.err = 0; w.openDemo(0); return out; });
  ok(hd.under, 'شفاط تحت خزانة: الخزانة في قائمة القص والسعر، مع ملاحظة فتحة الأنبوب');
  ok(hd.tele, 'شفاط مدمج يُسحب: واجهته في قائمة القص');
  ok(hd.topOver && hd.none, 'مدخنة أقصر تترك مكاناً للصف فوق العلوية، وشفاط بلا مدخنة يعمل');
  console.log('وضع العرض');
  await page.evaluate(() => window.__wr.setPresent(true)); await page.waitForTimeout(300);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#panel')).display === 'none' && getComputedStyle(document.querySelector('.bar')).display === 'none'), 'الأدوات مخفية في وضع العرض');
  await page.evaluate(() => window.__wr.setPresent(false)); await page.waitForTimeout(300);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#panel')).display !== 'none'), 'الخروج من وضع العرض');
  ok(errors.length === 0, 'لا أخطاء في الصفحة' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await page.close();

  console.log('فتح الصفحة كملف (بلا خادم)');
  { const fp = await browser.newPage({viewport: {width: 1000, height: 700}}), ferr = []; fp.on('pageerror', e => ferr.push(String(e)));
    await openApp(fp, root, threeDir, true); await fp.waitForFunction(() => window.__wr, null, {timeout: 120000}); await fp.waitForTimeout(1500);
    const fb = await fp.evaluate(async () => { const w = window.__wr; w.setQuality('performance'); w.openDemo(0); await w.texReady(); const cv = w.snap(400, 250); const px = cv.getContext('2d').getImageData(200, 125, 1, 1).data; return {failed: w.texStats().failed, lit: px[0] + px[1] + px[2] > 0}; });
    ok(fb.lit && ferr.length === 0, `الخامات المرسومة تبقى إن لم تُحمّل الصور، بلا خطأ (${fb.failed} مجموعة لم تُحمّل)` + (ferr.length ? ': ' + ferr[0] : ''));
    await fp.close(); }
  console.log('شريط أدوات القطعة على الهاتف');
  { const ph = await open(browser, {width: 412, height: 915});
    const r = await ph.page.evaluate(async () => { const w = window.__wr; w.openDemo(0);
      w.set({...w.cfg, items: [{t: 'cab', w: 100, h: 38, d: 35, y: 217, x: 110, z: 18, r: 0, o: {base: 'hang', cols: 2, rows: 1, cells: [{k: 'flap'}, {k: 'flap'}]}}], itemsAuto: false}); w.select({item: 0}, true);
      await new Promise(f => setTimeout(f, 600)); const q = document.querySelector('#qbar'), st = document.querySelector('#stage').getBoundingClientRect(), b = q.getBoundingClientRect(), pr = w.pieceRect();
      const lap = Math.max(0, Math.min(b.right - st.left, pr.x1) - Math.max(b.left - st.left, pr.x0)) * Math.max(0, Math.min(b.bottom - st.top, pr.y1) - Math.max(b.top - st.top, pr.y0));
      const allIn = [...q.querySelectorAll('button')].filter(x => !x.hidden).every(x => { const r = x.getBoundingClientRect(); return r.left >= st.left - 1 && r.right <= st.right + 1; });
      return {lap: Math.round(lap), allIn}; });
    ok(r.lap === 0 && r.allIn, `الشريط لا يغطي القطعة المحددة وكل أزراره ظاهرة على عرض 412 (تغطية ${r.lap})`);
    const g = await ph.page.evaluate(() => { const r = document.querySelector('#qbarGrip').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await ph.page.mouse.move(g[0], g[1]); await ph.page.mouse.down(); await ph.page.mouse.move(g[0] - 60, g[1] + 120, {steps: 6}); await ph.page.mouse.up();
    const moved = await ph.page.evaluate(() => !!window.__wr.qbarPos && !!localStorage.getItem('wr_qbar'));
    await ph.page.evaluate(() => document.querySelector('#qbarGrip').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})));
    ok(moved && await ph.page.evaluate(() => window.__wr.qbarPos === null), 'سحب الشريط من مقبضه يُحفظ، والضغط مرتين يعيده');
    await ph.page.close(); }
  console.log('الهاتف');
  const m = await open(browser, {width: 390, height: 844});
  await m.page.evaluate(() => window.__wr.openDemo(6)); await m.page.waitForTimeout(800);
  for (const tab of ['space', 'units', 'free', 'mat', 'cost']) { await m.page.click(`[data-tab="${tab}"]`); await m.page.waitForTimeout(200); }
  ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'لا تمرير أفقي على عرض 390');
  ok(m.errors.length === 0, 'لا أخطاء على الهاتف' + (m.errors.length ? ': ' + m.errors[0] : ''));
} finally { await browser.close(); }
console.log(failures ? `\n${failures} فحص فشل` : '\nكل الفحوص نجحت');
process.exit(failures ? 1 : 0);
