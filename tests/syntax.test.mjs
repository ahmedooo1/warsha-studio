// The page is one HTML file: make sure its main script at least compiles. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('index.html main script compiles', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const code = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new vm.Script(code, {filename: 'index.html'}));
});
