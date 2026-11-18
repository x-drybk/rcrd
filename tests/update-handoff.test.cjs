const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('async function requestServerUpdate()');
assert.ok(start >= 0);
const update = source.slice(start, source.indexOf('\n}', start) + 2);

test('update install hands off through the Node helper before stopping the server', async () => {
  const root = path.resolve('/synthetic');
  const runtimeDirectory = path.join(root, '.data');
  const pidFile = path.join(runtimeDirectory, 'rcrd-server.json');
  const handoffId = 'a'.repeat(48);
  const markers = new Map();
  const launches = [];
  const statuses = [];
  let closedLog = false;
  let unrefed = false;
  const context = vm.createContext({
    process: { platform: 'win32', pid: 100, execPath: path.join(root, 'node.exe') },
    root, runtimeDirectory, pidFile, port: 3000, appVersion: '1.3.40', path, Date,
    setInterval, clearInterval, random: () => handoffId,
    latestRcrdRelease: async () => ({ version: '9.4.1', asset: { sha256: 'b'.repeat(64) } }),
    newerVersion: () => true,
    downloadRcrdUpdate: async () => {},
    writeUpdateStatus: (...args) => statuses.push(args),
    fs: {
      readFileSync(file) {
        if (file === pidFile) return JSON.stringify({ pid: 100, port: 3000, root });
        if (markers.has(file)) return markers.get(file);
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      mkdirSync() {},
      openSync: () => 10,
      closeSync: fd => { assert.equal(fd, 10); closedLog = true; },
      unlinkSync: file => { if (!markers.delete(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
    },
    spawn(command, args, options) {
      launches.push({ command, args, options });
      const child = new EventEmitter();
      child.pid = 101;
      child.unref = () => { unrefed = true; };
      queueMicrotask(() => markers.set(path.join(runtimeDirectory, `update-ready-${args[3]}`), args[3]));
      return child;
    }
  });
  vm.runInContext(`let restartPending=false,updatePending=false;${update}`, context);
  assert.equal(await vm.runInContext('requestServerUpdate()', context), '9.4.1');
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, path.join(root, 'node.exe'));
  assert.equal(path.basename(launches[0].args[0]), 'Launch-RCRD-Update.cjs');
  assert.deepEqual(Array.from(launches[0].args).slice(1, 4), ['100', '3000', handoffId]);
  assert.equal(launches[0].options.detached, true);
  assert.equal(launches[0].options.windowsHide, true);
  assert.equal(closedLog, true);
  assert.equal(unrefed, true);
  assert.equal(markers.size, 0);
  assert.deepEqual(statuses.map(([status]) => status), ['downloading', 'installing']);
});
