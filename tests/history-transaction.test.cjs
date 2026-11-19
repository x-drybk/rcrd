const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { commit, recover, paths } = require('../scripts/History-Transaction.cjs');

const key = 'a'.repeat(64);
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rcrd-history-transaction-test-'));
  try { run(root, paths(root, key).files); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('history, index, and recent ledger commit as one account-scoped generation', () => fixture((root, files) => {
  commit(root, key, { history: 'old-history', events: Buffer.from('old-events'), recent: 'old-recent' });
  commit(root, key, { history: 'new-history', events: Buffer.from('new-events'), recent: 'new-recent' });
  assert.equal(fs.readFileSync(files.history, 'utf8'), 'new-history');
  assert.equal(fs.readFileSync(files.events, 'utf8'), 'new-events');
  assert.equal(fs.readFileSync(files.recent, 'utf8'), 'new-recent');
  assert.equal(fs.existsSync(paths(root, key).journal), false);
}));

test('faults after every preparation and file replacement restore the prior generation', () => {
  for (const stage of ['prepared', 'history', 'recent', 'events']) fixture((root, files) => {
    commit(root, key, { history: 'old-history', events: Buffer.from('old-events'), recent: 'old-recent' });
    assert.throws(() => commit(root, key, { history: 'new-history', events: Buffer.from('new-events'), recent: 'new-recent' }, reached => { if (reached === stage) throw new Error('synthetic fault'); }), /synthetic fault/);
    recover(root, key);
    assert.equal(fs.readFileSync(files.history, 'utf8'), 'old-history');
    assert.equal(fs.readFileSync(files.events, 'utf8'), 'old-events');
    assert.equal(fs.readFileSync(files.recent, 'utf8'), 'old-recent');
  });
});

test('delete faults restore the old state and a committed delete keeps only the reset ledger', () => fixture((root, files) => {
  commit(root, key, { history: 'old-history', events: Buffer.from('old-events'), recent: 'old-recent' });
  assert.throws(() => commit(root, key, { history: null, events: null, recent: 'cleared' }, reached => { if (reached === 'history') throw new Error('synthetic fault'); }), /synthetic fault/);
  assert.equal(fs.readFileSync(files.history, 'utf8'), 'old-history');
  assert.equal(fs.readFileSync(files.events, 'utf8'), 'old-events');
  assert.equal(fs.readFileSync(files.recent, 'utf8'), 'old-recent');
  commit(root, key, { history: null, events: null, recent: 'cleared' });
  assert.equal(fs.existsSync(files.history), false);
  assert.equal(fs.existsSync(files.events), false);
  assert.equal(fs.readFileSync(files.recent, 'utf8'), 'cleared');
}));

test('a prepared journal from an interrupted process rolls back on the next read', () => fixture((root, files) => {
  commit(root, key, { history: 'old-history', events: Buffer.from('old-events'), recent: 'old-recent' });
  const id = 'b'.repeat(32);
  for (const file of Object.values(files)) fs.copyFileSync(file, `${file}.${id}.backup`);
  fs.writeFileSync(paths(root, key).journal, JSON.stringify({ id, state: 'prepared', existed: { history: true, recent: true, events: true } }));
  fs.writeFileSync(files.history, 'partial-history');
  fs.writeFileSync(files.recent, 'partial-recent');
  recover(root, key);
  assert.equal(fs.readFileSync(files.history, 'utf8'), 'old-history');
  assert.equal(fs.readFileSync(files.recent, 'utf8'), 'old-recent');
  assert.equal(fs.readFileSync(files.events, 'utf8'), 'old-events');
}));

test('interruption during rollback cleanup is safe to resume', () => fixture((root, files) => {
  commit(root, key, { history: 'old-history', events: Buffer.from('old-events'), recent: 'old-recent' });
  const id = 'c'.repeat(32);
  fs.writeFileSync(paths(root, key).journal, JSON.stringify({ id, state: 'rolledback', existed: { history: true, recent: true, events: true } }));
  fs.writeFileSync(`${files.history}.${id}.backup`, 'old-history');
  recover(root, key);
  assert.equal(fs.readFileSync(files.history, 'utf8'), 'old-history');
  assert.equal(fs.readFileSync(files.recent, 'utf8'), 'old-recent');
  assert.equal(fs.existsSync(paths(root, key).journal), false);
}));
