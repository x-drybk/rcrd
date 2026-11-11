const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function waitForParentExit(pid, { probe = process.kill, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + 10000;
  while (now() < deadline) {
    try { probe(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; if (error.code !== 'EPERM') throw new Error('Cannot confirm previous server exit'); }
    await pause(200);
  }
  throw new Error('Previous server did not exit');
}

async function restart() {
  const pid = Number(process.argv[2]);
  const port = Number(process.argv[3]);
  const handoffId = process.argv[4];
  if (!Number.isInteger(pid) || pid <= 0 || pid !== process.ppid || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{48}$/.test(handoffId || '')) throw Object.assign(new Error('Invalid restart handoff'), { exitCode: 2 });
  const root = path.resolve(__dirname, '..');
  const runtime = path.join(root, '.data');
  const readyFile = path.join(runtime, `restart-ready-${handoffId}`);
  const temporary = `${readyFile}.tmp`;
  try {
    fs.writeFileSync(temporary, handoffId, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, readyFile);
  } catch {
    try { fs.unlinkSync(temporary); } catch {}
    throw Object.assign(new Error('Restart handoff unavailable'), { exitCode: 3 });
  }
  try { await waitForParentExit(pid); }
  catch { throw Object.assign(new Error('Cannot confirm previous server exit'), { exitCode: 4 }); }
  const out = fs.openSync(path.join(runtime, 'server.log'), 'a');
  let err;
  try {
    err = fs.openSync(path.join(runtime, 'server-error.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, PORT: String(port) }, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
}

if (require.main === module) restart().catch(error => { process.exitCode = error.exitCode || 1; });
module.exports = { waitForParentExit };
