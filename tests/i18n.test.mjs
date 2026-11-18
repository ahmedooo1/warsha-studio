// Every Arabic phrase of the page must have a French and a Turkish translation. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
globalThis.localStorage = {getItem: () => null, setItem() {}};
require('../js/i18n.js');
// the page and the cutting planner (its comments left out)
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8') + readFileSync(new URL('../js/cutui.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const load = () => { for (const f of ['../js/i18n.js', '../js/cut-i18n.js']) { delete require.cache[require.resolve(f)]; require(f); } };
const RUN = /[؀-ۿ][؀-ۿً-ٟ\s،؛.:()\-«»0-9%×]*[؀-ۿ»)]/g;
const phrases = [...new Set(html.match(RUN))].filter(p => p.length > 2);

for (const l of ['fr', 'tr']) {
  test(`${l}: every interface phrase is translated`, () => {
    globalThis.localStorage.getItem = () => l;
    load();
    assert.equal(I18N.lang, l);
    const left = phrases.filter(p => /[؀-ۿ]/.test(I18N.t(p)));
    assert.deepEqual(left, [], 'untranslated: ' + left.slice(0, 10).join(' | '));
  });
}
test('Arabic stays the source and is never changed', () => {
  globalThis.localStorage.getItem = () => 'ar';
  delete require.cache[require.resolve('../js/i18n.js')]; require('../js/i18n.js');
  assert.equal(I18N.t('خزانة مخصصة'), 'خزانة مخصصة');
});
