const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

async function waitUntil(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Synthetic restart did not reach the expected state');
}

test('isolated Windows server restart returns an accepted response and a replacement healthy process', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rcrd-restart-test-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(root, 'server.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(root, 'package.json'));
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'Restart-RCRD.cjs'), path.join(root, 'scripts', 'Restart-RCRD.cjs'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Synthetic RCRD</h1>');
  const dataDirectory = path.join(root, '.data');
  fs.mkdirSync(dataDirectory);
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const env = { PORT: String(port), DISCOGS_CONSUMER_KEY: 'synthetic-key', DISCOGS_CONSUMER_SECRET: 'synthetic-secret' };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  let initial;
  async function health() {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      const data = await response.json();
      return response.ok && data.app === 'rcrd' && data.ok ? data : null;
    } catch { return null; }
  }
  try {
    initial = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { initial.once('spawn', resolve); initial.once('error', reject); });
    const before = await waitUntil(health);
    assert.equal(before.pid, initial.pid);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const anonymousCookie = page.headers.get('set-cookie')?.split(';', 1)[0];
    assert.match(anonymousCookie, /^rcrd_session=[a-f0-9]{48}$/);
    const guardName = `\\\\.\\pipe\\rcrd-${crypto.createHash('sha256').update(fs.realpathSync.native(root).toLowerCase()).digest('hex')}`;
    const duplicateGuard = net.createServer();
    const guardError = await new Promise((resolve, reject) => {
      duplicateGuard.once('error', resolve);
      duplicateGuard.once('listening', () => { duplicateGuard.close(); reject(new Error('The running server did not reserve its single-instance guard.')); });
      duplicateGuard.listen(guardName);
    });
    assert.equal(guardError.code, 'EADDRINUSE');
    assert.equal((await health()).pid, initial.pid, 'the first server remains active');
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/restart`, {
      method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'X-RCRD-Request': '1', Cookie: anonymousCookie }, signal: AbortSignal.timeout(10000)
    });
    const restartResponse = await response.json();
    assert.equal(response.status, 202, JSON.stringify(restartResponse));
    assert.equal(restartResponse.previousPid, before.pid);
    const after = await waitUntil(async () => { const result = await health(); return result && result.pid !== before.pid ? result : null; });
    assert.notEqual(after.pid, before.pid);
    const reloadedPage = await fetch(`http://127.0.0.1:${port}/`, { headers: { Cookie: anonymousCookie } });
    assert.equal(reloadedPage.status, 200);
    assert.match(reloadedPage.headers.get('set-cookie'), /^rcrd_session=[a-f0-9]{48};/);
    assert.notEqual(reloadedPage.headers.get('set-cookie')?.split(';', 1)[0], anonymousCookie);
    const runtime = JSON.parse(fs.readFileSync(path.join(root, '.data', 'rcrd-server.json'), 'utf8'));
    assert.equal(runtime.pid, after.pid);
    assert.equal(runtime.root, root);
    assert.equal(runtime.port, port);
    assert.deepEqual(fs.readdirSync(dataDirectory).filter(name => name.startsWith('restart-ready-')), [], 'one-use readiness marker is removed');
  } finally {
    const runtimePath = path.join(root, '.data', 'rcrd-server.json');
    if (fs.existsSync(runtimePath)) {
      const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
      assert.equal(runtime.root, root);
      assert.equal(runtime.port, port);
      assert.ok(Number.isInteger(runtime.pid) && runtime.pid > 0);
      try { process.kill(runtime.pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (initial && initial.exitCode === null) initial.kill();
    if (initial && initial.exitCode === null) await new Promise(resolve => initial.once('exit', resolve));
    await waitUntil(async () => !(await health()), 5000);
    const target = path.resolve(root);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('rcrd-restart-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
});
