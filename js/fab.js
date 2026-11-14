/*
 * Warsha Studio: fabrication engine.
 * Pure functions with no DOM and no three.js, so they can be tested in Node.
 * Works in the browser (window.WarshaFab) and in Node (module.exports).
 *
 * Conventions
 * - All sizes in millimetres.
 * - A part has L >= W. Its grain field says where the wood grain runs:
 *   'L' along the length, 'W' along the width, '' no grain (plain melamine, HDF, glass).
 * - A sheet's grain runs along its length.
 */
(function (root) {
  'use strict';

  // Workshop defaults. Every value can be changed in the app and is kept on the device.
  const FAB_DEFAULT = Object.freeze({
    t: 18,          // carcass board thickness
    tf: 18,         // front (door, drawer face) thickness
    back: 3,        // back panel thickness (HDF)
    gap: 3,         // total gap taken off each door or drawer face (1.5 mm per side)
    edge: 1,        // edge banding thickness
    edgeDeduct: false, // take the banding off the cut size (true for 2 mm ABS, usually false for 0.4 to 1 mm)
    sheetL: 2800,   // sheet length (grain direction)
    sheetW: 2070,   // sheet width
    kerf: 4,        // saw blade
    trim: 10,       // clean cut on each sheet edge
    plinthH: 100,   // plinth (kick board) height
    backInset: 2    // back panel smaller than the carcass on each side
  });
  const LIMITS = {
    t: [12, 25], tf: [12, 25], back: [2, 10], gap: [0, 6], edge: [0, 3],
    sheetL: [1200, 4200], sheetW: [600, 2100], kerf: [0, 6], trim: [0, 30], plinthH: [50, 200], backInset: [0, 10]
  };

  function sanitizeFab(raw) {
    const out = {...FAB_DEFAULT};
    if (!raw || typeof raw !== 'object') return out;
    raw = {...raw};
    if (Number(raw.sheetW) > Number(raw.sheetL)) [raw.sheetL, raw.sheetW] = [raw.sheetW, raw.sheetL];
    for (const k of Object.keys(LIMITS)) {
      const n = Number(raw[k]);
      if (Number.isFinite(n)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
    }
    if (typeof raw.edgeDeduct === 'boolean') out.edgeDeduct = raw.edgeDeduct;
    if (out.sheetW > out.sheetL) [out.sheetL, out.sheetW] = [out.sheetW, out.sheetL];
    return out;
  }

  // Longest piece cut from one sheet; longer parts are split into equal pieces.
  const maxPiece = fab => fab.sheetL - 2 * fab.trim;

  const hingesFor = h => h <= 900 ? 2 : h <= 1600 ? 3 : 4;

  /*
   * Normalise one part: sizes rounded, L >= W, grain kept with the right side,
   * banding taken off the cut size when asked, over-long parts split.
   * a is the size along the grain when the material has grain.
   * ea = banded edges along a, eb = banded edges along b (0, 1 or 2).
   */
  function makePart(p, fab, grainy) {
    let a = Math.round(p.a), b = Math.round(p.b), ea = p.ea || 0, eb = p.eb || 0, qty = p.qty;
    if (!(a > 0 && b > 0 && qty > 0)) return null;
    if (fab.edgeDeduct && fab.edge > 0) {
      // edges along a sit on the b sides, so they shorten b; and the other way round
      b = Math.round(b - ea * fab.edge);
      a = Math.round(a - eb * fab.edge);
      if (a <= 0 || b <= 0) return null;
    }
    let grain = grainy ? 'L' : '';
    if (b > a) { [a, b] = [b, a]; [ea, eb] = [eb, ea]; if (grainy) grain = 'W'; }
    let split = 1;
    const mp = maxPiece(fab);
    if (a > mp && !p.nosheet) { split = Math.ceil(a / mp); a = Math.ceil(a / split); qty *= split; }
    return {code: p.code, kind: p.kind, L: a, W: b, th: p.th, qty, mat: p.mat, ea, eb, grain, split};
  }

  // Banding in metres for a list of parts.
  const edgeMetres = parts => parts.reduce((s, p) => s + p.qty * (p.ea * p.L + p.eb * p.W) / 1000, 0);

  /*
   * Nest parts on sheets with a guillotine shelf method (first fit decreasing, best fitting row).
   * Every cut runs edge to edge, so the plan can be cut on a panel saw.
   * groups: [{mat, th, L, W, qty, grain, n}]; n is the line number shown on the drawing.
   * Returns [{mat, th, sheets: [{parts:[{x,y,L,W,n,rot,over}], rows}], yield, count}]
   */
  function nest(groups, fab, nosheet = []) {
    const SL = fab.sheetL, SW = fab.sheetW, trim = fab.trim, kerf = fab.kerf;
    const byMat = {};
    groups.forEach((g, gi) => {
      if (nosheet.includes(g.mat)) return;
      const key = g.mat + '|' + g.th;
      const m = byMat[key] || (byMat[key] = {mat: g.mat, th: g.th, list: []});
      for (let q = 0; q < g.qty; q++) m.list.push({L: g.L, W: g.W, grain: g.grain || '', n: g.n ?? gi + 1});
    });
    // one packing pass; 'tall' stands plain boards on end, which often packs long narrow parts better
    const pack = (list, mode) => {
      const items = list.map(p => {
        let pl = p.L, pw = p.W, rot = false;
        if (p.grain === 'W') { pl = p.W; pw = p.L; rot = true; }
        else if (!p.grain && ((pw > SW - 2 * trim && pl <= SW - 2 * trim) || (mode === 'tall' && pl <= SW - 2 * trim))) { pl = p.W; pw = p.L; rot = true; }
        return {...p, pl, pw, rot, free: !p.grain};
      }).sort((a, b) => b.pw - a.pw || b.pl - a.pl);
      const sheets = [];
      const fits = (r, w, h) => h <= r.h && r.x + w <= SL - trim;
      for (const p of items) {
        let best = null;
        for (const sh of sheets) for (const r of sh.rows) {
          if (fits(r, p.pl, p.pw)) { const waste = r.h - p.pw; if (!best || waste < best.waste) best = {sh, r, w: p.pl, h: p.pw, rot: p.rot, waste}; }
          if (p.free && fits(r, p.pw, p.pl)) { const waste = r.h - p.pl; if (!best || waste < best.waste) best = {sh, r, w: p.pw, h: p.pl, rot: !p.rot, waste}; }
        }
        if (best) { best.sh.parts.push({x: best.r.x, y: best.r.y, L: best.w, W: best.h, n: p.n, rot: best.rot}); best.r.x += best.w + kerf; continue; }
        // open a new row on a sheet that still has height, else a new sheet
        let sh = sheets.find(s => s.y + p.pw <= SW - trim && p.pl <= SL - 2 * trim);
        const over = p.pl > SL - 2 * trim || p.pw > SW - 2 * trim;
        if (!sh || over) { sh = {rows: [], parts: [], y: trim}; sheets.push(sh); }
        const r = {x: trim, y: sh.y, h: p.pw};
        sh.rows.push(r); sh.parts.push({x: r.x, y: r.y, L: p.pl, W: p.pw, n: p.n, rot: p.rot, over});
        r.x += p.pl + kerf; sh.y += p.pw + kerf;
      }
      return sheets;
    };
    return Object.values(byMat).map(m => {
      const a = pack(m.list, 'long'), b = pack(m.list, 'tall'), sheets = b.length < a.length ? b : a;
      const used = m.list.reduce((a, p) => a + p.L * p.W, 0);
      return {mat: m.mat, th: m.th, sheets, count: sheets.length, yield: sheets.length ? used / (sheets.length * SL * SW) : 0};
    });
  }

  // Checks a cut list can be trusted for: impossible sizes, parts that do not fit a sheet.
  function checkParts(parts, fab, nosheet = []) {
    const out = [];
    for (const p of parts) {
      if (!(p.L > 0 && p.W > 0)) out.push({code: p.code, msg: `مقاس غير صالح في ${p.kind}`});
      if (!nosheet.includes(p.mat) && p.W > fab.sheetW - 2 * fab.trim && p.L > fab.sheetW - 2 * fab.trim) out.push({code: p.code, msg: `${p.kind} ${p.L}×${p.W} أعرض من اللوح`});
      if (p.W < 30 && p.th >= 12 && !nosheet.includes(p.mat)) out.push({code: p.code, msg: `${p.kind} بعرض ${p.W} مم ضيق جداً للقص الآمن`});
    }
    return out;
  }

  const api = {FAB_DEFAULT, LIMITS, sanitizeFab, maxPiece, hingesFor, makePart, edgeMetres, nest, checkParts};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WarshaFab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
