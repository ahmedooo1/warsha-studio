// Android phone emulation (Pixel 7 profile: 412 x 915, pixel ratio 2.625, touch, Chrome Android user agent).
// Screens in the three languages, then the in-app device test. node tests/mobile.mjs <outdir> [skipTest]
// It is an emulation in desktop Chromium with a software GPU: it checks layout, loading and that every step
// runs; it says nothing reliable about the speed or memory of a real phone.
import {openApp} from './serve.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium, devices} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threeDir = path.join(root, 'node_modules/three');
const out = path.resolve(process.argv[2] || 'mobile'); fs.mkdirSync(out, {recursive: true});
const skipTest = process.argv[3] === 'skipTest';
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info']});
const report = [];
const shot = (page, name) => page.screenshot({path: path.join(out, name), timeout: 240000, type: 'jpeg', quality: 82});
for (const lang of ['ar', 'fr', 'tr']) {
  const ctx = await browser.newContext({...devices['Pixel 7']});
  await ctx.addInitScript(l => { try { localStorage.setItem('wr_lang', l); } catch (e) {} }, lang);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await openApp(page, root, threeDir);
  await page.waitForFunction(() => window.__wr, null, {timeout: 180000});
  await page.evaluate(() => window.__wr.texReady()); await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({q: window.__wr.quality, tex: window.__wr.texStats(), env: window.__wr.envReady, dir: document.documentElement.dir, scroll: document.documentElement.scrollWidth - innerWidth, chip: document.querySelector('#clientName').textContent}));
  report.push(`[${lang}] default level ${st.q}, textures ${st.tex.textures} (${st.tex.mb} MB, ${st.tex.failed} failed), HDR ${st.env}, dir ${st.dir}, horizontal overflow ${st.scroll}px, client chip "${st.chip}"${lang !== 'ar' && /[\u0600-\u06FF]/.test(st.chip) ? ' NOT TRANSLATED' : ''}`);
  await shot(page, `${lang}-1-editor.jpg`);
  // photo mode on the phone, a few frames accumulated
  await page.evaluate(() => { window.__wr.setCam('eye', true); window.__wr.setPhoto(true); });
  await page.waitForFunction(() => window.__wr.photoN >= 8, null, {timeout: 600000}).catch(() => {});
  report.push(`[${lang}] photo mode: ${await page.evaluate(() => window.__wr.photoN)} frames accumulated`);
  await shot(page, `${lang}-2-photo.jpg`);
  await page.evaluate(() => window.__wr.setPhoto(false));
  // client presentation with the materials and price card
  await page.evaluate(() => { document.querySelector('#presentBtn')?.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('.pres-views [data-pv="info"]')?.click());
  await page.waitForTimeout(800); await shot(page, `${lang}-3-presentation.jpg`);
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('#presExit, [data-pv="exit"]')?.click()); await page.waitForTimeout(600);
  // clients sheet: saved designs, demo projects, backup, device test
  await page.evaluate(() => document.querySelector('#clientBtn').click()); await page.waitForTimeout(800);
  await shot(page, `${lang}-4-clients.jpg`);
  if (lang === 'ar' && !skipTest) {
    const t0 = Date.now();
    const txt = await page.evaluate(() => window.__wr.deviceTest());
    fs.writeFileSync(path.join(out, 'device-test-pixel7-emulated.txt'), txt + `\n(total ${Math.round((Date.now() - t0) / 1000)} s, emulation with a software GPU)\n`);
    report.push(`[${lang}] device test done in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  report.push(`[${lang}] page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'mobile-report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
