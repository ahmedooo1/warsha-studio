// Serves the editor itself, unchanged on disk, with one script added: cloud.js connects it to this server.
//  /            the editor for the workshop (sign in first)
//  /v/<token>   the same editor in read only mode for a client link
//  /admin       the owner pages
// The editor's files are read from EDITOR_DIR (the repository root), so the GitHub Pages copy and this one are the same.
import express, {type Express, type Request, type Response, type NextFunction} from 'express';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import type {Config} from '../config.js';

const CSP = [
  "default-src 'self'",
  // the editor is one page with its script inline; three.js comes from jsDelivr unless the vendored copy is present
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');

export function editorHtml(cfg: Config, mode: 'app' | 'view'): () => string {
  const file = path.join(cfg.editorDir, 'index.html');
  let cache = '', at = 0;
  return () => {
    // read again at most every 10 s, so an update of the editor needs no restart
    if (!cache || Date.now() - at > 10_000) {
      let html = readFileSync(file, 'utf8');
      const vendored = existsSync(path.join(cfg.editorDir, 'vendor/three/three.min.js'));
      if (vendored) html = html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.147\.0\//g, 'vendor/three/');
      const inject = `<base href="/"><script>window.WARSHA_MODE=${JSON.stringify(mode)}</script><script src="/cloud/cloud.js"></script>`;
      html = html.replace(/<head>/i, m => m + inject);
      cache = html; at = Date.now();
    }
    return cache;
  };
}

export function mountWeb(app: Express, cfg: Config) {
  const appHtml = editorHtml(cfg, 'app'), viewHtml = editorHtml(cfg, 'view');
  const page = (get: () => string) => (_req: Request, res: Response) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(get());
  };
  // scripts are checked again on every load (an update arrives at once); textures and three.js are kept a day
  const stat = (dir: string, maxAge: string | number = 0) => express.static(dir, {index: false, fallthrough: false, maxAge, dotfiles: 'deny'});
  app.get('/', page(appHtml));
  app.get('/index.html', page(appHtml));
  app.get(/^\/v\/[A-Za-z0-9_-]{40,60}$/, (req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex'); page(viewHtml)(req, res); });
  app.get('/admin', (_req, res) => { res.setHeader('Content-Security-Policy', CSP); res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(cfg.publicDir, 'admin.html')); });
  app.get('/sw.js', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); res.sendFile(path.join(cfg.publicDir, 'sw.js')); });
  app.use('/cloud', stat(cfg.publicDir));
  app.use('/js', stat(path.join(cfg.editorDir, 'js')));
  app.use('/assets', stat(path.join(cfg.editorDir, 'assets'), '1d'));
  if (existsSync(path.join(cfg.editorDir, 'vendor'))) app.use('/vendor', stat(path.join(cfg.editorDir, 'vendor'), '1d'));
  app.get('/og.jpg', (_req, res) => res.sendFile(path.join(cfg.editorDir, 'og.jpg')));
  app.use((err: {status?: number}, req: Request, res: Response, next: NextFunction) => {
    const st = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (req.path.startsWith('/api/')) { res.status(st).json({statusCode: st, message: st === 413 ? 'request too large' : st < 500 ? 'bad request' : 'server error'}); return; }
    res.status(err.status === 404 || err.status === 403 ? err.status : 500).type('text').send(err.status === 404 ? 'not found' : 'error');
  });
}
