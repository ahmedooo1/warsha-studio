// Unit tests for the fabrication engine (js/fab.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../js/fab.js');
const fab = F.sanitizeFab({});

test('settings are clamped and the sheet keeps its length as the longer side', () => {
  const f = F.sanitizeFab({t: 99, gap: -4, sheetL: 1800, sheetW: 2500, edgeDeduct: true});
  assert.equal(f.t, 25); assert.equal(f.gap, 0); assert.equal(f.sheetL, 2500); assert.equal(f.sheetW, 1800); assert.equal(f.edgeDeduct, true);
  assert.deepEqual(F.sanitizeFab('nonsense'), {...F.FAB_DEFAULT});
});

test('hinges per door height', () => {
  assert.equal(F.hingesFor(700), 2); assert.equal(F.hingesFor(900), 2); assert.equal(F.hingesFor(1200), 3); assert.equal(F.hingesFor(2100), 4);
});

test('a part keeps L >= W and remembers where the grain runs', () => {
  const door = F.makePart({code: 'A1', kind: 'باب', a: 717, b: 297, th: 18, qty: 1, mat: 'front:oak', ea: 2, eb: 2}, fab, true);
  assert.equal(door.L, 717); assert.equal(door.W, 297); assert.equal(door.grain, 'L');
  const face = F.makePart({code: 'A2', kind: 'واجهة جارور', a: 597, b: 177, th: 18, qty: 1, mat: 'front:oak'}, fab, true);
  assert.equal(face.grain, 'L');
  const flat = F.makePart({code: 'A3', kind: 'رف', a: 300, b: 520, th: 18, qty: 2, mat: 'accent', ea: 1, eb: 0}, fab, true);
  assert.equal(flat.L, 520); assert.equal(flat.W, 300); assert.equal(flat.grain, 'W'); assert.equal(flat.ea, 0); assert.equal(flat.eb, 1);
  const plain = F.makePart({code: 'A4', kind: 'جانب', a: 760, b: 560, th: 18, qty: 2, mat: 'carcass'}, fab, false);
  assert.equal(plain.grain, '');
});

test('impossible parts are dropped, long parts are split evenly', () => {
  assert.equal(F.makePart({a: 0, b: 300, qty: 1}, fab, false), null);
  assert.equal(F.makePart({a: 300, b: 300, qty: 0}, fab, false), null);
  const long = F.makePart({code: 'P', kind: 'وزرة', a: 4200, b: 100, th: 18, qty: 1, mat: 'carcass'}, fab, false);
  assert.equal(long.qty, 2); assert.equal(long.L, 2100); assert.ok(long.L <= F.maxPiece(fab));
  const glass = F.makePart({a: 4200, b: 600, qty: 1, mat: 'stone', nosheet: true}, fab, false);
  assert.equal(glass.qty, 1); assert.equal(glass.L, 4200);
});

test('banding is taken off the cut size only when asked', () => {
  const f2 = F.sanitizeFab({edgeDeduct: true, edge: 2});
  const p = F.makePart({a: 720, b: 400, th: 18, qty: 1, mat: 'carcass', ea: 2, eb: 1}, f2, false);
  assert.equal(p.L, 718); assert.equal(p.W, 396);
  const q = F.makePart({a: 720, b: 400, th: 18, qty: 1, mat: 'carcass', ea: 2, eb: 1}, fab, false);
  assert.equal(q.L, 720); assert.equal(q.W, 400);
});

test('banding metres', () => {
  assert.equal(F.edgeMetres([{qty: 2, ea: 2, eb: 1, L: 1000, W: 500}]), 5);
});

// geometry checks for any nesting result
function checkNest(groups, f) {
  const res = F.nest(groups, f, ['glass']);
  const placed = res.flatMap(m => m.sheets.flatMap(s => s.parts.map(p => ({...p, mat: m.mat}))));
  const want = groups.filter(g => g.mat !== 'glass').reduce((a, g) => a + g.qty, 0);
  assert.equal(placed.length, want, 'every part is placed once');
  for (const m of res) for (const s of m.sheets) {
    for (const p of s.parts) {
      if (p.over) continue;
      assert.ok(p.x >= f.trim - 1e-6 && p.y >= f.trim - 1e-6, 'inside the trim');
      assert.ok(p.x + p.L <= f.sheetL - f.trim + 1e-6 && p.y + p.W <= f.sheetW - f.trim + 1e-6, 'inside the sheet');
    }
    for (let i = 0; i < s.parts.length; i++) for (let j = i + 1; j < s.parts.length; j++) {
      const a = s.parts[i], b = s.parts[j];
      const apart = a.x + a.L + f.kerf <= b.x + 1e-6 || b.x + b.L + f.kerf <= a.x + 1e-6 || a.y + a.W + f.kerf <= b.y + 1e-6 || b.y + b.W + f.kerf <= a.y + 1e-6;
      assert.ok(apart, `parts ${a.n} and ${b.n} overlap or touch without a saw cut`);
    }
    assert.ok(m.yield > 0 && m.yield <= 1);
  }
  return res;
}

test('nesting: no overlap, saw cut kept, everything inside the sheet', () => {
  const groups = [
    {mat: 'carcass', th: 18, L: 760, W: 560, qty: 14, grain: '', n: 1},
    {mat: 'carcass', th: 18, L: 564, W: 560, qty: 7, grain: '', n: 2},
    {mat: 'carcass', th: 18, L: 2300, W: 580, qty: 4, grain: '', n: 3},
    {mat: 'carcass', th: 18, L: 564, W: 100, qty: 14, grain: '', n: 4},
    {mat: 'front:oak', th: 18, L: 717, W: 297, qty: 12, grain: 'L', n: 5},
    {mat: 'front:oak', th: 18, L: 597, W: 177, qty: 9, grain: 'L', n: 6},
    {mat: 'accent', th: 25, L: 1800, W: 600, qty: 1, grain: 'L', n: 7},
    {mat: 'glass', th: 4, L: 600, W: 400, qty: 2, grain: '', n: 8},
  ];
  checkNest(groups, fab);
  checkNest(groups, F.sanitizeFab({sheetL: 2440, sheetW: 1220, kerf: 5, trim: 15}));
});

test('nesting keeps the grain along the sheet length', () => {
  const res = F.nest([{mat: 'front:walnut', th: 18, L: 1200, W: 400, qty: 6, grain: 'L', n: 1}, {mat: 'front:walnut', th: 18, L: 800, W: 500, qty: 4, grain: 'W', n: 2}], fab);
  for (const s of res[0].sheets) for (const p of s.parts) {
    if (p.n === 1) { assert.equal(p.L, 1200); assert.equal(p.rot, false); }
    if (p.n === 2) { assert.equal(p.L, 500); assert.equal(p.rot, true); }
  }
});

test('nesting may turn plain boards to save material', () => {
  const res = F.nest([{mat: 'carcass', th: 18, L: 2000, W: 300, qty: 1, grain: '', n: 1}, {mat: 'carcass', th: 18, L: 1700, W: 300, qty: 6, grain: '', n: 2}], fab);
  assert.equal(res[0].count, 1);
});

test('a part bigger than the sheet is flagged, not hidden', () => {
  const res = F.nest([{mat: 'carcass', th: 18, L: 2700, W: 2300, qty: 1, grain: '', n: 1}], fab);
  assert.equal(res[0].sheets[0].parts[0].over, true);
  const chk = F.checkParts([{code: 'X', kind: 'لوح', L: 2700, W: 2300, th: 18, mat: 'carcass'}], fab);
  assert.equal(chk.length, 1);
});

test('random cut lists always nest cleanly', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 40; k++) {
    const groups = Array.from({length: 1 + Math.floor(rnd() * 12)}, (_, i) => { const L = 80 + Math.floor(rnd() * 2600), W = 40 + Math.floor(rnd() * Math.min(L, 1900)); return {mat: rnd() < .5 ? 'carcass' : 'front:oak', th: 18, L, W, qty: 1 + Math.floor(rnd() * 6), grain: rnd() < .5 ? '' : 'L', n: i + 1}; });
    checkNest(groups, fab);
  }
});
