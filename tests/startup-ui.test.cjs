const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('disconnected startup renders Collection and Wantlist before later UI setup', () => {
  const end = source.indexOf('renderCollection();renderWantlist();');
  assert.ok(end > 0);
  const elements = new Map();
  const node = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: 'desc', innerHTML: '' });
    return elements.get(selector);
  };
  const context = vm.createContext({
    localStorage: { getItem: () => null },
    document: { querySelector: node }
  });
  vm.runInContext(source.slice(0, end + 'renderCollection();renderWantlist();'.length), context);
  assert.match(node('#collectionGrid').innerHTML, /Connect Discogs to see your collection/);
  assert.match(node('#wantlistGrid').innerHTML, /Connect Discogs to see your wantlist/);
});
