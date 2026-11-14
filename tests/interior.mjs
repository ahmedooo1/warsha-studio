// Interior views (eye level and corner) of some demos, Ultra quality, for the report.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threeDir = process.env.THREE_DIR || path.join(root, 'node_modules/three');
const out = path.resolve(process.argv[2] || 'interior'); fs.mkdirSync(out, {recursive: true});
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport: {width: 1280, height: 800}});
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('three@0.147.0/')) return r.fulfill({path: path.join(threeDir, u.split('three@0.147.0/')[1])}); if (u.startsWith('file://')) return r.continue(); return r.abort(); });
await page.goto('file://' + path.join(root, 'index.html'));
await page.waitForFunction(() => window.__wr, null, {timeout: 120000}); await page.waitForTimeout(1500);
await page.evaluate(() => window.__wr.setQuality('ultra'));
for (const [i, view, light, open] of [[0, 'eye', 'day', 0], [0, 'eye', 'evening', 1], [1, 'corner', 'evening', 0], [1, 'eye', 'day', 0], [5, 'eye', 'evening', 0], [3, 'eye', 'day', 0], [6, 'corner', 'day', 0]]) {
  await page.evaluate(([i, light]) => { const w = window.__wr; w.openDemo(i); w.select(null); if (w.cfg.light !== light) w.set({...w.cfg, light}); }, [i, light]);
  await page.waitForTimeout(1800);
  const data = await page.evaluate(([view, open]) => { const w = window.__wr; w.setCam(view, true); w.openNow(open); return w.snap(1280, 800).toDataURL('image/jpeg', .88); }, [view, open]);
  fs.writeFileSync(path.join(out, `demo${i + 1}-${view}-${light}${open ? '-open' : ''}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close(); console.log('interior shots done');
