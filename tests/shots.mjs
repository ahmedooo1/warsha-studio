// Screenshots of the seven demo projects, day and evening, for before/after comparison.
// Usage: node tests/shots.mjs <out dir> [quality]
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {openApp} from './serve.mjs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = process.env.WR_ROOT ? path.resolve(process.env.WR_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threeDir = process.env.THREE_DIR || path.join(root, 'node_modules/three');
const out = path.resolve(process.argv[2] || 'shots'), quality = process.argv[3];
require('node:fs').mkdirSync(out, {recursive: true});
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport: {width: 1280, height: 800}});
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await openApp(page, root, threeDir);
await page.waitForFunction(() => window.__wr, null, {timeout: 120000}); await page.waitForTimeout(1500);
if (quality) await page.evaluate(q => window.__wr.setQuality?.(q), quality);
const times = [];
for (let i = 0; i < 7; i++) {
  await page.evaluate(i => { window.__wr.openDemo(i); window.__wr.select(null); }, i);
  await page.waitForTimeout(1200);
  for (const light of ['day', 'evening']) {
        await page.evaluate(light => { const w = window.__wr; if (w.cfg.light !== light) w.set({...w.cfg, light}); }, light);
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.__wr.texReady?.());
    const t0 = Date.now(); const data = await page.evaluate(() => window.__wr.snap(1280, 800).toDataURL('image/jpeg', .86)); times.push(Date.now() - t0);
    require('node:fs').writeFileSync(path.join(out, `demo${i + 1}-${light}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
}
const fps = await page.evaluate(async () => { let n = 0; const t0 = performance.now(); await new Promise(r => { const f = () => { window.__wr.dirty?.(); n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(); }; f(); }); return n / ((performance.now() - t0) / 1000); });
console.log('shots done; snapshot ms avg', Math.round(times.reduce((a, b) => a + b, 0) / times.length), 'frames per second (software GPU):', fps.toFixed(1), errors.length ? 'errors: ' + errors.slice(0, 3).join(' | ') : 'no errors');
await browser.close();
