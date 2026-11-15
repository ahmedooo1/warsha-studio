// Every texture set in every size and every HDR environment: loaded by the browser from the http origin,
// decoded, readable by WebGL (not tainted), right pixel size; HDRs decoded from base64 and parsed by RGBELoader.
// node tests/assets.mjs
import {openApp} from './serve.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sets = JSON.parse(fs.readFileSync(path.join(root, 'assets/tex/sets.json'), 'utf8'));
const hdrs = fs.readdirSync(path.join(root, 'assets/hdri')).filter(f => f.endsWith('.hdr.txt')).map(f => f.replace(/\.txt$/, ''));
const browser = await chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await openApp(page, root, path.join(root, 'node_modules/three'));
await page.waitForFunction(() => window.__wr, null, {timeout: 180000});
const res = await page.evaluate(async ([sets, hdrs]) => {
  const px = {'512': 512, '1k': 1024, '2k': 2048}, out = {sets: [], hdr: []};
  const gl = document.createElement('canvas').getContext('webgl');
  const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
  for (const [id, s] of Object.entries(sets)) {
    const parts = s.albedo ? ['albedo', 'normal', 'rough'] : ['normal', 'rough'], bad = [];
    for (const tag of s.sizes) for (const p of parts) {
      const img = await load(`assets/tex/${id}/${p}_${tag}.jpg`);
      if (!img) { bad.push(`${p}_${tag} not loaded`); continue; }
      if (img.naturalWidth !== px[tag] || img.naturalHeight !== px[tag]) bad.push(`${p}_${tag} is ${img.naturalWidth}x${img.naturalHeight}`);
      try { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.deleteTexture(t); }
      catch (e) { bad.push(`${p}_${tag} refused by WebGL`); }
    }
    out.sets.push({id, sizes: s.sizes.join('/'), files: s.sizes.length * parts.length, bad});
  }
  const L = new THREE.RGBELoader().setDataType(THREE.HalfFloatType);
  for (const h of hdrs) {
    try { const b = atob((await (await fetch('assets/hdri/' + h + '.txt')).text()).replace(/\s+/g, '')), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      const d = L.parse(u.buffer); out.hdr.push({h, ok: d.width > 0 && d.height > 0 && d.data.length === d.width * d.height * 4, size: `${d.width}x${d.height}`}); }
    catch (e) { out.hdr.push({h, ok: false, size: String(e)}); }
  }
  return out;
}, [sets, hdrs]);
await browser.close();
let fail = 0;
for (const s of res.sets) { if (s.bad.length) fail++; console.log(`${s.bad.length ? '✗' : '✓'} ${s.id.padEnd(14)} ${s.sizes.padEnd(10)} ${s.files} files${s.bad.length ? '  ' + s.bad.join(', ') : ''}`); }
for (const h of res.hdr) { if (!h.ok) fail++; console.log(`${h.ok ? '✓' : '✗'} ${h.h.padEnd(28)} ${h.size}`); }
console.log(`${res.sets.length} texture sets, ${res.sets.reduce((a, s) => a + s.files, 0)} images, ${res.hdr.length} HDR: ${fail ? fail + ' FAILED' : 'all OK'}`);
process.exit(fail ? 1 : 0);
