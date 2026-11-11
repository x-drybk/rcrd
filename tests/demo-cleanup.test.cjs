const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const initializers = source.split(/\r?\n/).slice(0, 4).join('\n');

function recordsWith(storage) {
  const context = vm.createContext({ localStorage: { getItem: key => storage[key] ?? null } });
  vm.runInContext(initializers, context);
  return vm.runInContext('[loadRecords("rcrdCollection", defaultCollection), loadRecords("rcrdWantlist", defaultWantlist)]', context);
}

test('a fresh profile has no sample collection or wantlist records', () => {
  const [collection, wantlist] = recordsWith({});
  assert.equal(collection.length, 0);
  assert.equal(wantlist.length, 0);
});

test('removing sample defaults preserves valid records already stored locally', () => {
  const record = { title: 'Saved album', artist: 'Example Artist', tone: '#112233', accent: '#445566', word: 'SAVED', format: 'LP' };
  const [collection, wantlist] = recordsWith({ rcrdCollection: JSON.stringify([record]), rcrdWantlist: JSON.stringify([record]) });
  assert.equal(collection[0].title, record.title);
  assert.equal(wantlist[0].title, record.title);
});

test('the player does not paint a sample song before account status loads', () => {
  assert.match(markup, /id="playerTitle">Connect Spotify</);
  assert.match(markup, /id="playerPosition">0:00</);
  assert.match(markup, /id="playerDuration">0:00</);
});
