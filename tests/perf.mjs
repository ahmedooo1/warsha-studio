// Performance and memory per quality level, and photo render cost.
// node tests/perf.mjs [demo indexes, default 0,5]
// Runs in Chromium with a software GPU (SwiftShader): times are for comparing levels, not for predicting a real device.
import {openApp} from './serve.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = process.env.WR_ROOT ? path.resolve(process.env.WR_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threeDir = process.env.THREE_DIR || path.join(root, 'node_modules/three');
const demos = (process.argv[2] || '0,5').split(',').map(Number);
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info']});
const rows = [];
for (const q of ['performance', 'standard', 'ultra', 'photo']) {
  for (const d of demos) {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const got = new Set(); page.on('request', r => { const u = r.url(); if (u.includes('/assets/')) got.add(new URL(u).pathname); });
    await openApp(page, root, threeDir);
    await page.waitForFunction(() => window.__wr, null, {timeout: 120000}); await page.waitForTimeout(800);
    await page.evaluate(([q, d]) => { const w = window.__wr; w.setQuality(q === 'photo' ? 'ultra' : q); w.openDemo(d); w.select(null); w.setCam('eye', true); if (q === 'photo') w.setPhoto(true); }, [q, d]);
    await page.evaluate(() => window.__wr.texReady()); await page.waitForTimeout(1500); await page.evaluate(() => window.__wr.texReady());
    const r = await page.evaluate(async q => {
      const w = window.__wr, t = [];
      for (let i = 0; i < 3; i++) { const t0 = performance.now(); w.snap(1280, 800); t.push(performance.now() - t0); }
      let photoMs = null;
      if (q === 'photo') { const t0 = performance.now(); await w.photoShot(1280, 800, 4); photoMs = (performance.now() - t0) / 4; }
      const info = w.renderer.info;
      return {frameMs: Math.round(t.reduce((a, b) => a + b) / t.length), photoMsPerFrame: photoMs && Math.round(photoMs), tex: w.texStats(),
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries};
    }, q);
    const bytes = [...got].reduce((a, p) => { const f = path.join(root, decodeURIComponent(p)); return a + (fs.existsSync(f) ? fs.statSync(f).size : 0); }, 0);
    rows.push({level: q, demo: d + 1, ...r, downloadMB: +(bytes / 1048576).toFixed(1)});
    console.log(JSON.stringify(rows[rows.length - 1]));
    await page.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(root, 'docs/perf-photoreal.json'), JSON.stringify(rows, null, 1));
