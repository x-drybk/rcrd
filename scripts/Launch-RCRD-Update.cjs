const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { waitForParentExit } = require('./Restart-RCRD.cjs');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.data');
const statusFile = path.join(runtime, 'update-status.json');

function writeFailure(version, message, handoffId) {
  try {
    const current = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    if (current.status === 'complete' || current.status === 'failed') return;
  } catch {}
  const temporary = `${statusFile}.${handoffId}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ status: 'failed', version, message, updatedAt: Date.now() }), { mode: 0o600 });
    fs.renameSync(temporary, statusFile);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}

async function launch() {
  const [parentText, portText, handoffId, archiveText, version, digest] = process.argv.slice(2);
  const parentPid = Number(parentText);
  const port = Number(portText);
  const stageRoot = path.join(runtime, 'update-staging') + path.sep;
  const archive = path.resolve(archiveText || '');
  if (!Number.isInteger(parentPid) || parentPid <= 0 || parentPid !== process.ppid ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[a-f0-9]{48}$/.test(handoffId || '') ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '') ||
      !/^[a-f0-9]{64}$/.test(digest || '') ||
      !archive.startsWith(stageRoot) || path.basename(archive) !== 'release.zip') {
    throw new Error('Invalid update handoff.');
  }

  const readyFile = path.join(runtime, `update-ready-${handoffId}`);
  const temporary = `${readyFile}.tmp`;
  try {
    fs.writeFileSync(temporary, handoffId, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, readyFile);
    await waitForParentExit(parentPid);
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'Update-RCRD.ps1'),
      '-ProjectRoot', root, '-ArchivePath', archive, '-Version', version,
      '-ExpectedSha256', digest, '-ParentPid', parentText, '-Port', portText,
      '-NodeExe', process.execPath, '-HandoffId', handoffId
    ], { cwd: root, windowsHide: true, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0) throw new Error(`Update installer exited with code ${code}.`);
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    if (status.status !== 'complete' || status.version !== version) throw new Error('Update installer did not report completion.');
  } catch (error) {
    try { writeFailure(version, error.message, handoffId); } catch {}
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
    try { fs.unlinkSync(readyFile); } catch {}
  }
}

if (require.main === module) launch().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { launch };
