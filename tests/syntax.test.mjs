// The page is one HTML file: make sure its main script at least compiles. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('index.html main script compiles', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const at = html.lastIndexOf('<script>') + 8, code = html.slice(at, html.indexOf('</script>', at));
  assert.doesNotThrow(() => new vm.Script(code, {filename: 'index.html'}));
});
