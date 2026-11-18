// Unit tests for the cutting planner engine (js/cut.js). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../js/cut.js');

const stock = {id: 'mel', name: 'ميلامين', L: 2800, W: 2070, th: 18, grain: false, price: 40};
const oak = {id: 'oak', name: 'سنديان', L: 2800, W: 2070, th: 18, grain: true, price: 90};
const part = (id, L, W, qty, extra = {}) => ({id, name: id, L, W, qty, stock: 'mel', ...extra});
const noOverlap = (pl) => pl.read.every(r => !r.errors.length);
const inside = (pl) => pl.sheets.every((s, i) => s.parts.every(q => { const p = pl.job.parts.find(x => x.id === q.pid), d = C.dims(p, q.rot); return q.x >= pl.job.opt.trim - .01 && q.y >= pl.job.opt.trim - .01 && q.x + d.w <= s.L - pl.job.opt.trim + .01 && q.y + d.h <= s.W - pl.job.opt.trim + .01; }));

test('a kitchen list fits on the boards, nothing overlaps, every copy placed', () => {
  const job = {stocks: [stock], parts: [part('side', 720, 560, 12), part('shelf', 564, 540, 10), part('top', 564, 100, 12), part('door', 717, 397, 8)]};
  const pl = C.plan(job);
  const n = pl.sheets.reduce((s, sh) => s + sh.parts.length, 0);
  assert.equal(n, 42); assert.equal(pl.unplaced.length, 0); assert.ok(noOverlap(pl)); assert.ok(inside(pl));
  const area = (12 * 720 * 560 + 10 * 564 * 540 + 12 * 564 * 100 + 8 * 717 * 397) / (2800 * 2070);
  assert.ok(pl.per[0].boards >= Math.ceil(area) && pl.per[0].boards <= Math.ceil(area) + 1, `boards ${pl.per[0].boards} for ${area.toFixed(2)} boards of parts`);
  assert.ok(pl.read.every(r => r.straight), 'every board cut with straight cuts');
  assert.equal(pl.per[0].cost, pl.per[0].boards * 40);
});

test('areas add up: parts + reusable leftovers + waste = boards', () => {
  const pl = C.plan({stocks: [stock], parts: [part('a', 1200, 600, 3), part('b', 800, 300, 5)]});
  const p = pl.per[0];
  assert.ok(Math.abs(p.partsArea + p.keepArea + p.wasteArea - p.area) < 1);
  assert.ok(p.keep.length > 0 && p.keep.every(k => k.L >= 300 && k.W >= 100));
});

test('grain: a grained part never turns, a plain one may', () => {
  const pl = C.plan({stocks: [oak], parts: [{id: 'd', name: 'door', L: 2000, W: 500, qty: 4, stock: 'oak', grain: 'L'}, {id: 'w', name: 'flap', L: 400, W: 1900, qty: 2, stock: 'oak', grain: 'W'}]});
  for (const s of pl.sheets) for (const q of s.parts) { if (q.pid === 'd') assert.equal(q.rot, false); if (q.pid === 'w') assert.equal(q.rot, true); }
  assert.equal(pl.unplaced.length, 0);
});

test('a part bigger than the board is reported, not lost', () => {
  const pl = C.plan({stocks: [stock], parts: [part('huge', 3000, 900, 1), part('ok', 500, 500, 1)]});
  assert.deepEqual(pl.tooBig, ['huge']); assert.equal(pl.unplaced.length, 1);
});

test('offcuts in the workshop are used first and save a board', () => {
  const parts = [part('a', 1300, 1000, 4), part('b', 900, 450, 2)];
  const without = C.plan({stocks: [stock], parts});
  const withOff = C.plan({stocks: [stock], parts, offcuts: [{stock: 'mel', L: 1400, W: 1100, qty: 1}, {stock: 'mel', L: 1000, W: 500, qty: 2}]});
  assert.ok(withOff.per[0].boards < without.per[0].boards, `${withOff.per[0].boards} < ${without.per[0].boards}`);
  assert.ok(withOff.per[0].offcutsUsed >= 1); assert.equal(withOff.per[0].saved, without.per[0].boards - withOff.per[0].boards);
});

test('cut sequence: first cuts run along the board (strips), kerf counted', () => {
  const pl = C.plan({stocks: [oak], parts: [{id: 's', name: 's', L: 2000, W: 600, qty: 3, stock: 'oak', grain: 'L'}], opt: {kerf: 4, trim: 10}});
  const r = pl.read[0];
  assert.equal(r.cuts[0].dir, 'h'); assert.ok(r.straight);
  const ys = pl.sheets[0].parts.map(q => q.y).sort((a, b) => a - b);
  assert.deepEqual(ys, [10, 614, 1218]);
});

test('hand layout: overlap and parts that cannot be cut straight are caught', () => {
  const job = {stocks: [stock], parts: [part('a', 1000, 500, 4)], manual: {sheets: [{stock: 'mel', kind: 'new', L: 2800, W: 2070, parts: [
    {pid: 'a', x: 10, y: 10}, {pid: 'a', x: 500, y: 100}]}]}};
  const pl = C.plan(job);
  assert.ok(pl.read[0].errors.some(e => e.type === 'overlap'));
  assert.equal(pl.unplaced.length, 2, 'copies not on a board are listed');
  // a pinwheel of four parts has no edge to edge cut
  const pin = C.plan({stocks: [stock], opt: {kerf: 0, trim: 0}, parts: [part('h', 600, 200, 2), part('v', 200, 600, 2)], manual: {sheets: [{stock: 'mel', kind: 'new', L: 800, W: 800, parts: [
    {pid: 'h', x: 0, y: 0}, {pid: 'v', x: 600, y: 0}, {pid: 'h', x: 200, y: 600}, {pid: 'v', x: 0, y: 200}]}]}});
  assert.equal(pin.read[0].straight, false); assert.ok(pin.read[0].errors.some(e => e.type === 'notStraight'));
});

test('edge banding metres from the four sides', () => {
  const pl = C.plan({stocks: [stock], parts: [part('d', 700, 400, 2, {e: [1, 1, 1, 0]})]});
  assert.equal(Math.round(pl.edge * 1000), 2 * (700 + 700 + 400));
});

test('pasting rows from a spreadsheet', () => {
  const rows = C.parseRows('القطعة\tالطول\tالعرض\tالعدد\nجانب\t720\t560\t4\nرف;564;540;2\nباب  717  397\n');
  assert.deepEqual(rows, [{name: 'جانب', L: 720, W: 560, qty: 4}, {name: 'رف', L: 564, W: 540, qty: 2}, {name: 'باب', L: 717, W: 397, qty: 1}]);
});

test('a big list is planned fast enough for a phone', () => {
  const parts = Array.from({length: 40}, (_, i) => part('p' + i, 300 + (i * 37) % 900, 150 + (i * 53) % 500, 1 + i % 4));
  const t0 = Date.now(); const pl = C.plan({stocks: [stock], parts}); const ms = Date.now() - t0;
  assert.ok(noOverlap(pl) && inside(pl)); assert.ok(ms < 3000, ms + ' ms');
});
