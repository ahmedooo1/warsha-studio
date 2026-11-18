/*
 * Warsha Studio: cutting planner engine.
 * Pure functions, no DOM: the same code runs in the page (window.WarshaCut) and in Node tests.
 *
 * Sizes in millimetres. A board has its length L along x and its width W along y; its grain, when it has one,
 * runs along L. A part keeps the length and width the carpenter typed; its grain says which of the two follows the
 * wood: 'L' the length, 'W' the width, '' none (the part may turn).
 *
 * Every layout, made by the planner or arranged by hand, is read by the same guillotine reader: it looks for a
 * straight cut from edge to edge of the piece being cut, the way a panel saw works, and repeats in each half. That
 * gives the cut sequence, the leftovers and their sizes, and tells when a hand made layout cannot be cut that way.
 */
(function (root) {
  'use strict';

  const OPT_DEFAULT = Object.freeze({kerf: 4, trim: 10, minL: 300, minW: 100, first: 'rip'});
  const EPS = 0.01;
  const r1 = v => Math.round(v * 10) / 10;

  function sanitizeJob(raw) {
    const j = raw && typeof raw === 'object' ? raw : {};
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const str = (v, n) => String(v ?? '').slice(0, n);
    const stocks = (Array.isArray(j.stocks) ? j.stocks : []).slice(0, 30).map((s, i) => {
      let L = Math.round(num(s.L, 100, 6000, 2800)), W = Math.round(num(s.W, 50, 3000, 2070));
      if (W > L) [L, W] = [W, L];
      return {id: str(s.id || 'b' + (i + 1), 24), name: str(s.name || 'لوح', 60), L, W, th: num(s.th, 1, 100, 18), grain: !!s.grain, price: num(s.price, 0, 1e6, 0)};
    });
    if (!stocks.length) stocks.push({id: 'b1', name: 'ميلامين أبيض', L: 2800, W: 2070, th: 18, grain: false, price: 0});
    const ids = new Set(stocks.map(s => s.id));
    const parts = (Array.isArray(j.parts) ? j.parts : []).slice(0, 500).map((p, i) => ({
      id: str(p.id || 'p' + (i + 1), 24), name: str(p.name, 60), L: Math.round(num(p.L, 0, 6000, 0)), W: Math.round(num(p.W, 0, 3000, 0)),
      qty: Math.round(num(p.qty, 0, 999, 1)), stock: ids.has(p.stock) ? p.stock : stocks[0].id, grain: ['L', 'W'].includes(p.grain) ? p.grain : '',
      e: [0, 1, 2, 3].map(k => (Array.isArray(p.e) && p.e[k] ? 1 : 0)), note: str(p.note, 80)
    }));
    const offcuts = (Array.isArray(j.offcuts) ? j.offcuts : []).slice(0, 200).map(o => {
      let L = Math.round(num(o.L, 0, 6000, 0)), W = Math.round(num(o.W, 0, 3000, 0)); if (W > L) [L, W] = [W, L];
      return {stock: ids.has(o.stock) ? o.stock : stocks[0].id, L, W, qty: Math.round(num(o.qty, 0, 99, 1))};
    }).filter(o => o.L > 0 && o.W > 0 && o.qty > 0);
    const o = j.opt || {};
    const opt = {kerf: num(o.kerf, 0, 10, OPT_DEFAULT.kerf), trim: num(o.trim, 0, 50, OPT_DEFAULT.trim), minL: num(o.minL, 0, 3000, OPT_DEFAULT.minL), minW: num(o.minW, 0, 3000, OPT_DEFAULT.minW), first: o.first === 'cross' ? 'cross' : 'rip'};
    let manual = null;
    if (j.manual && Array.isArray(j.manual.sheets)) manual = {sheets: j.manual.sheets.slice(0, 200).map(sh => ({
      stock: ids.has(sh.stock) ? sh.stock : stocks[0].id, kind: sh.kind === 'off' ? 'off' : 'new', L: Math.round(num(sh.L, 1, 6000, 2800)), W: Math.round(num(sh.W, 1, 3000, 2070)),
      parts: (Array.isArray(sh.parts) ? sh.parts : []).slice(0, 400).map(q => ({pid: str(q.pid, 24), x: num(q.x, -1e4, 1e4, 0), y: num(q.y, -1e4, 1e4, 0), rot: !!q.rot}))
    }))};
    return {v: 1, id: str(j.id, 40), name: str(j.name || 'مهمة تقطيع', 80), stocks, parts, offcuts, opt, manual, from: str(j.from, 40), updatedAt: Math.round(num(j.updatedAt, 0, 1e15, 0))};
  }

  // the size of a part on the board: w along the board length (and its grain), h across
  function orientations(p, stock) {
    const a = {w: p.L, h: p.W, rot: false}, b = {w: p.W, h: p.L, rot: true};
    if (!stock.grain || !p.grain) return p.L === p.W ? [a] : [a, b];
    return p.grain === 'L' ? [a] : [b];
  }
  const dims = (p, rot) => (rot ? {w: p.W, h: p.L} : {w: p.L, h: p.W});

  /* ---------- the planner: guillotine packing, tried many ways, the best kept ---------- */
  const SORTS = [
    (a, b) => b.L * b.W - a.L * a.W,
    (a, b) => Math.max(b.L, b.W) - Math.max(a.L, a.W) || b.L * b.W - a.L * a.W,
    (a, b) => Math.min(b.L, b.W) - Math.min(a.L, a.W) || Math.max(b.L, b.W) - Math.max(a.L, a.W),
    (a, b) => (b.L + b.W) - (a.L + a.W),
    (a, b) => b.W - a.W || b.L - a.L
  ];
  const SCORES = {
    bssf: (r, w, h) => Math.min(r.w - w, r.h - h),
    blsf: (r, w, h) => Math.max(r.w - w, r.h - h),
    baf: (r, w, h) => r.w * r.h - w * h
  };
  const SPLITS = ['strip', 'sas', 'las', 'minas', 'maxas'];

  function packOnce(items, bins, opt, sortFn, scoreFn, split) {
    const k = opt.kerf, list = [...items].sort(sortFn), open = [], unplaced = [];
    const queue = bins.map(b => ({...b}));
    const openBin = (it) => {
      for (let i = 0; i < queue.length; i++) {
        const b = queue[i], uw = b.L - 2 * opt.trim, uh = b.W - 2 * opt.trim;
        if (it.ors.some(o => o.w <= uw + EPS && o.h <= uh + EPS)) {
          if (b.kind === 'off') queue.splice(i, 1);
          const sh = {kind: b.kind, stock: b.stock, L: b.L, W: b.W, off: b.off, parts: [], free: [{x: opt.trim, y: opt.trim, w: uw, h: uh}]};
          open.push(sh); return sh;
        }
      }
      return null;
    };
    for (const it of list) {
      let best = null;
      for (let si = 0; si < open.length; si++) for (let fi = 0; fi < open[si].free.length; fi++) {
        const r = open[si].free[fi];
        for (const o of it.ors) if (o.w <= r.w + EPS && o.h <= r.h + EPS) {
          const s = scoreFn(r, o.w, o.h);
          if (!best || s < best.s - EPS || (Math.abs(s - best.s) <= EPS && si < best.si)) best = {s, si, fi, o};
        }
      }
      if (!best) {
        const sh = openBin(it);
        if (!sh) { unplaced.push(it); continue; }
        const r = sh.free[0], o = it.ors.find(o => o.w <= r.w + EPS && o.h <= r.h + EPS);
        best = {si: open.length - 1, fi: 0, o, s: 0};
      }
      const sh = open[best.si], r = sh.free[best.fi], {w, h} = best.o;
      sh.parts.push({pid: it.pid, x: r.x, y: r.y, w, h, rot: best.o.rot});
      sh.free.splice(best.fi, 1);
      const rw = r.w - w - k, th = r.h - h - k;
      // horizontal: the cut along the board runs across the whole free piece first (strips, panel saw friendly)
      let horiz;
      if (split === 'strip') horiz = true;
      else if (split === 'sas') horiz = r.w - w < r.h - h;
      else if (split === 'las') horiz = r.w - w >= r.h - h;
      else { const a1 = Math.max(rw, 0) * h, a2 = w * Math.max(th, 0), b1 = Math.max(rw, 0) * r.h, b2 = r.w * Math.max(th, 0);
        horiz = split === 'minas' ? Math.min(a1, b2) >= Math.min(b1, a2) : Math.max(a1, b2) >= Math.max(b1, a2); }
      const right = {x: r.x + w + k, y: r.y, w: rw, h: horiz ? h : r.h}, top = {x: r.x, y: r.y + h + k, w: horiz ? r.w : w, h: th};
      for (const f of [right, top]) if (f.w > EPS && f.h > EPS) sh.free.push(f);
    }
    return {sheets: open, unplaced};
  }

  // fewer parts left out, then fewer new boards, then fewer leftover pieces of offcut used, then the leftovers in few big pieces
  function score(res, opt) {
    const newB = res.sheets.filter(s => s.kind === 'new').length, offB = res.sheets.length - newB;
    let spread = 0;
    for (const s of res.sheets) for (const f of s.free) if (Math.min(f.w, f.h) >= opt.minW && Math.max(f.w, f.h) >= opt.minL) spread += (f.w * f.h) ** 1.5;
    return [res.unplaced.length, newB, offB, -spread];
  }
  const better = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i] - 1e-6) return true; if (a[i] > b[i] + 1e-6) return false; } return false; };

  function packStock(job, stock, withOffcuts = true) {
    const opt = job.opt, items = [];
    for (const p of job.parts) if (p.stock === stock.id && p.L > 0 && p.W > 0) for (let q = 0; q < p.qty; q++) items.push({pid: p.id, L: p.L, W: p.W, ors: orientations(p, stock)});
    if (!items.length) return null;
    const bins = [];
    if (withOffcuts) job.offcuts.forEach((o, oi) => { if (o.stock === stock.id) for (let q = 0; q < o.qty; q++) bins.push({kind: 'off', stock: stock.id, L: o.L, W: o.W, off: oi}); });
    bins.sort((a, b) => a.L * a.W - b.L * b.W);
    bins.push({kind: 'new', stock: stock.id, L: stock.L, W: stock.W});
    // offcuts are used once each; the last entry, a new board, can be opened again and again
    let best = null, bestS = null;
    for (const sf of SORTS) for (const sc of Object.values(SCORES)) for (const sp of SPLITS) {
      const res = packOnce(items, bins, opt, sf, sc, sp), s = score(res, opt);
      if (!best || better(s, bestS)) { best = res; bestS = s; }
    }
    return best;
  }

  /* ---------- the guillotine reader: cut sequence, leftovers, can it be cut with straight cuts ---------- */
  function readSheet(sheet, opt, partsById) {
    const k = opt.kerf, t = opt.trim, cuts = [], left = [], errors = [];
    const boxes = sheet.parts.map((q, i) => { const p = partsById[q.pid], d = p ? dims(p, q.rot) : {w: 0, h: 0}; return {i, x: q.x, y: q.y, w: d.w, h: d.h}; });
    const inner = {x: t, y: t, w: sheet.L - 2 * t, h: sheet.W - 2 * t};
    // parts outside the board or over each other
    for (const b of boxes) if (b.x < inner.x - EPS || b.y < inner.y - EPS || b.x + b.w > inner.x + inner.w + EPS || b.y + b.h > inner.y + inner.h + EPS) errors.push({type: 'outside', i: b.i});
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      if (A.x < B.x + B.w - EPS && B.x < A.x + A.w - EPS && A.y < B.y + B.h - EPS && B.y < A.y + A.h - EPS) errors.push({type: 'overlap', i: A.i, j: B.i});
    }
    let straight = true;
    const rec = (R, bs, dir, depth) => {
      if (R.w <= EPS || R.h <= EPS) return;
      if (!bs.length) { left.push({x: R.x, y: R.y, w: R.w, h: R.h}); return; }
      if (bs.length === 1) { const b = bs[0]; if (Math.abs(b.x - R.x) < EPS && Math.abs(b.y - R.y) < EPS && Math.abs(b.w - R.w) < EPS && Math.abs(b.h - R.h) < EPS) return; }
      if (depth > 400) { straight = false; return; }
      for (const d of [dir, dir === 'h' ? 'v' : 'h']) {
        // h: a line along the board length (constant y); v: across (constant x)
        const p0 = d === 'h' ? R.y : R.x, p1 = d === 'h' ? R.y + R.h : R.x + R.w;
        const lo = b => (d === 'h' ? b.y : b.x), hi = b => (d === 'h' ? b.y + b.h : b.x + b.w);
        const cand = [...new Set(bs.flatMap(b => [hi(b), lo(b) - k]))].filter(c => c > p0 + EPS && c < p1 - EPS).sort((a, b) => a - b);
        for (const c of cand) {
          const e = Math.min(c + k, p1);
          if (bs.some(b => lo(b) < e - EPS && hi(b) > c + EPS)) continue;
          const A = bs.filter(b => hi(b) <= c + EPS), B = bs.filter(b => lo(b) >= e - EPS);
          if (!A.length && !B.length) continue;
          const len = d === 'h' ? R.w : R.h;
          cuts.push({dir: d, at: r1(c), from: r1(d === 'h' ? R.x : R.y), len: r1(len), x: R.x, y: R.y, w: R.w, h: R.h});
          const RA = d === 'h' ? {x: R.x, y: p0, w: R.w, h: c - p0} : {x: p0, y: R.y, w: c - p0, h: R.h};
          const RB = d === 'h' ? {x: R.x, y: e, w: R.w, h: p1 - e} : {x: e, y: R.y, w: p1 - e, h: R.h};
          rec(RA, A, d === 'h' ? 'v' : 'h', depth + 1);
          rec(RB, B, d, depth + 1);
          return;
        }
      }
      straight = false;
      for (const b of bs) errors.push({type: 'notStraight', i: b.i});
    };
    if (!errors.length) rec(inner, boxes, opt.first === 'cross' ? 'v' : 'h', 0); else straight = false;
    const usable = f => Math.min(f.w, f.h) >= opt.minW - EPS && Math.max(f.w, f.h) >= opt.minL - EPS;
    const keep = left.filter(usable).map(f => ({x: r1(f.x), y: r1(f.y), w: r1(f.w), h: r1(f.h)})), scrap = left.filter(f => !usable(f));
    const partsArea = boxes.reduce((s, b) => s + b.w * b.h, 0);
    return {cuts, keep, scrap, errors, straight: straight && !errors.length, partsArea, keepArea: keep.reduce((s, f) => s + f.w * f.h, 0), area: sheet.L * sheet.W,
      cutLen: cuts.reduce((s, c) => s + c.len, 0)};
  }

  /* ---------- the plan of a job ---------- */
  function plan(rawJob) {
    const job = sanitizeJob(rawJob), byId = Object.fromEntries(job.parts.map(p => [p.id, p])), stockById = Object.fromEntries(job.stocks.map(s => [s.id, s]));
    let sheets = [], unplaced = [], saved = {};
    if (job.manual) {
      sheets = job.manual.sheets.map(s => ({...s, parts: s.parts.filter(q => byId[q.pid])}));
      // parts typed after the layout was arranged by hand, or more copies than placed: listed as not placed
      const placed = {};
      for (const s of sheets) for (const q of s.parts) placed[q.pid] = (placed[q.pid] || 0) + 1;
      for (const p of job.parts) for (let q = placed[p.id] || 0; q < p.qty; q++) if (p.L > 0 && p.W > 0) unplaced.push({pid: p.id});
    } else {
      for (const st of job.stocks) {
        const res = packStock(job, st, true); if (!res) continue;
        sheets.push(...res.sheets.map(s => ({kind: s.kind, stock: s.stock, L: s.L, W: s.W, off: s.off, parts: s.parts.map(({pid, x, y, rot}) => ({pid, x, y, rot}))})));
        unplaced.push(...res.unplaced.map(u => ({pid: u.pid})));
        if (job.offcuts.some(o => o.stock === st.id) && res.sheets.some(s => s.kind === 'off')) {
          const bare = packStock(job, st, false), a = bare.sheets.length, b = res.sheets.filter(s => s.kind === 'new').length;
          if (a > b) saved[st.id] = a - b;
        }
      }
    }
    const read = sheets.map(s => readSheet(s, job.opt, byId));
    const per = job.stocks.map(st => {
      const idx = sheets.map((s, i) => i).filter(i => sheets[i].stock === st.id);
      if (!idx.length && !job.parts.some(p => p.stock === st.id && p.qty > 0)) return null;
      const nNew = idx.filter(i => sheets[i].kind === 'new').length, nOff = idx.length - nNew;
      const area = idx.reduce((s, i) => s + read[i].area, 0), partsArea = idx.reduce((s, i) => s + read[i].partsArea, 0), keepArea = idx.reduce((s, i) => s + read[i].keepArea, 0);
      const keep = idx.flatMap(i => read[i].keep.map(f => ({sheet: i, L: Math.max(f.w, f.h), W: Math.min(f.w, f.h)}))).sort((a, b) => b.L * b.W - a.L * a.W);
      const boardArea = st.L * st.W;
      return {stock: st.id, name: st.name, th: st.th, L: st.L, W: st.W, boards: nNew, offcutsUsed: nOff, area, partsArea, keepArea, wasteArea: Math.max(0, area - partsArea - keepArea),
        yield: area ? partsArea / area : 0, cost: nNew * st.price, keepValue: boardArea ? keepArea / boardArea * st.price : 0, keep, saved: saved[st.id] || 0};
    }).filter(Boolean);
    const edge = job.parts.reduce((s, p) => s + p.qty * ((p.e[0] + p.e[1]) * p.L + (p.e[2] + p.e[3]) * p.W) / 1000, 0);
    const cuts = read.reduce((s, r) => s + r.cuts.length, 0), cutLen = read.reduce((s, r) => s + r.cutLen, 0) / 1000;
    const tooBig = [...new Set(unplaced.map(u => u.pid))].filter(pid => { const p = byId[pid], st = stockById[p.stock]; return !orientations(p, st).some(o => o.w <= st.L - 2 * job.opt.trim && o.h <= st.W - 2 * job.opt.trim); });
    // numbers on the drawings follow the part list; each copy gets its own label (3 of 4)
    const count = {};
    const labels = sheets.map(s => s.parts.map(q => { count[q.pid] = (count[q.pid] || 0) + 1; return count[q.pid]; }));
    return {job, sheets, read, per, unplaced, tooBig, edge, cuts, cutLen, labels,
      totals: {boards: per.reduce((s, x) => s + x.boards, 0), cost: per.reduce((s, x) => s + x.cost, 0), keepValue: per.reduce((s, x) => s + x.keepValue, 0), saved: per.reduce((s, x) => s + x.saved, 0)}};
  }

  // a hand layout starts from the planner's layout
  const toManual = pl => ({sheets: pl.sheets.map(s => ({stock: s.stock, kind: s.kind, L: s.L, W: s.W, parts: s.parts.map(q => ({...q}))}))});

  // pastes from a spreadsheet: name, length, width, quantity; separators tab, semicolon or comma; a header row is skipped
  function parseRows(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cells = line.split(/\t|;|,(?=\s*\d)|\s{2,}/).map(c => c.trim()).filter((c, i, a) => c || i < a.length - 1);
      const nums = cells.map(c => Number(c.replace(/\s/g, '').replace(',', '.')));
      const at = nums.findIndex(n => Number.isFinite(n) && n > 0);
      if (at < 0) continue;
      const name = cells.slice(0, at).join(' ').trim(), n = nums.slice(at).filter(Number.isFinite);
      if (n.length < 2) continue;
      out.push({name, L: Math.round(n[0]), W: Math.round(n[1]), qty: Math.max(1, Math.round(n[2] || 1))});
    }
    return out;
  }

  const api = {OPT_DEFAULT, sanitizeJob, orientations, dims, packStock, readSheet, plan, toManual, parseRows};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WarshaCut = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
