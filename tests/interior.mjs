// Interior views (eye level and corner) of some demos, Ultra quality, for the report.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {openApp} from './serve.mjs';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = process.env.WR_ROOT ? path.resolve(process.env.WR_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threeDir = process.env.THREE_DIR || path.join(root, 'node_modules/three');
const out = path.resolve(process.argv[2] || 'interior'); fs.mkdirSync(out, {recursive: true});
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport: {width: 1280, height: 800}});
await openApp(page, root, threeDir);
await page.waitForFunction(() => window.__wr, null, {timeout: 120000}); await page.waitForTimeout(1500);
// WR_Q: quality level (ultra by default); WR_PHOTO=n: photo render with n frames when the app has it; WR_W, WR_H: size
const Q = process.env.WR_Q || 'ultra', PHOTO = +(process.env.WR_PHOTO || 0), SW = +(process.env.WR_W || 1280), SH = +(process.env.WR_H || 800);
await page.evaluate(q => window.__wr.setQuality(q), Q);
const VIEWS = [[0, 'eye', 'day', 0], [0, 'eye', 'evening', 1], [1, 'corner', 'evening', 0], [1, 'eye', 'day', 0], [2, 'eye', 'day', 0], [3, 'eye', 'day', 0], [4, 'eye', 'day', 0], [5, 'eye', 'evening', 0], [6, 'corner', 'day', 0]];
const only = process.env.WR_ONLY ? process.env.WR_ONLY.split(',').map(Number) : null;
for (const [k, [i, view, light, open]] of VIEWS.entries()) {
  if (only && !only.includes(k)) continue;
  await page.evaluate(([i, light]) => { const w = window.__wr; w.openDemo(i); w.select(null); if (w.cfg.light !== light) w.set({...w.cfg, light}); }, [i, light]);
  await page.waitForTimeout(1800);
  await page.evaluate(([view, open]) => { const w = window.__wr; w.setCam(view, true); w.openNow(open); }, [view, open]);
  await page.evaluate(() => window.__wr.texReady?.()); await page.waitForTimeout(600);
  const data = await page.evaluate(async ([view, open, n, w, h]) => { const wr = window.__wr; wr.setCam(view, true); wr.openNow(open);
    const cv = n && wr.photoShot ? await wr.photoShot(w, h, n) : wr.snap(w, h); return cv.toDataURL('image/jpeg', .9); }, [view, open, PHOTO, SW, SH]);
  fs.writeFileSync(path.join(out, `demo${i + 1}-${view}-${light}${open ? '-open' : ''}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close(); console.log('interior shots done');
