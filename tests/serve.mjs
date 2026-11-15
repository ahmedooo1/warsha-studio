// Serves the app to Playwright from an http origin (http://warsha.test), like GitHub Pages would,
// so photo textures and HDR environments load. WR_FILE=1 opens it as a file instead, to test the fallback.
import path from 'node:path';
import fs from 'node:fs';
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.hdr': 'application/octet-stream', '.json': 'application/json', '.css': 'text/css'};
export async function openApp(page, root, threeDir, asFile = process.env.WR_FILE === '1'){
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('three@0.147.0/')) return r.fulfill({path: path.join(threeDir, u.split('three@0.147.0/')[1].split('?')[0])});
    if (u.startsWith('file://')) return r.continue();
    if (u.startsWith('http://warsha.test/')) {
      const f = path.join(root, decodeURIComponent(new URL(u).pathname));
      if (!f.startsWith(root) || !fs.existsSync(f)) return r.fulfill({status: 404, body: ''});
      return r.fulfill({path: f, headers: {'content-type': TYPES[path.extname(f)] || 'application/octet-stream'}});
    }
    return r.abort();
  });
  // the page builds the whole scene before 'load'; on a slow software GPU that can pass 30 s
  await page.goto(asFile ? 'file://' + path.join(root, 'index.html') : 'http://warsha.test/index.html', {waitUntil: 'domcontentloaded', timeout: 180000});
}
