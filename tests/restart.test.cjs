const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function definition(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function backend({ platform = 'win32', runtime = { pid: 100, port: 3000, root: path.resolve('/synthetic') }, fail = false, failureCode, invalidReady = false, helperExitCode } = {}) {
  const calls = [];
  const markers = new Map();
  let killed = 0;
  const runtimeDirectory = path.resolve('/synthetic/.data');
  const context = vm.createContext({ process: { platform, pid: 100, execPath: '/synthetic/node' }, setInterval, clearInterval, root: path.resolve('/synthetic'), port: 3000, pidFile: '/synthetic/runtime', runtimeDirectory, path, Date, random: () => 'a'.repeat(48), console,
    fs: {
      readFileSync: file => { if (file === '/synthetic/runtime') return JSON.stringify(runtime); if (markers.has(file)) return markers.get(file); throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      unlinkSync: file => { if (!markers.delete(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }
    },
    spawn: (...args) => { calls.push(args); const child = new EventEmitter(); child.pid = 101; child.unref = () => {}; child.kill = () => { killed++; }; queueMicrotask(() => { if (fail) child.emit('error', Object.assign(new Error('synthetic'), { code: failureCode })); else if (helperExitCode !== undefined) child.emit('exit', helperExitCode); else markers.set(path.join(runtimeDirectory, `restart-ready-${args[1][3]}`), invalidReady ? 'invalid' : args[1][3]); }); return child; }
  });
  vm.runInContext(`let restartPending=false;${definition(serverSource, 'requestServerRestart')}`, context);
  return { calls, markers, killed: () => killed, run: () => vm.runInContext('requestServerRestart()', context) };
}
test('restart uses a ready hidden Node helper for the current PID, rejecting duplicate requests', async () => {
  const h = backend(); await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], '/synthetic/node');
  assert.match(h.calls[0][1][0], /Restart-RCRD\.cjs$/);
  assert.deepEqual(Array.from(h.calls[0][1]).slice(-3), ['100', '3000', 'a'.repeat(48)]);
  assert.equal(h.calls[0][2].windowsHide, true);
  assert.equal(h.calls[0][2].stdio, 'ignore');
  assert.equal(h.markers.size, 0, 'readiness marker is removed');
  await assert.rejects(h.run(), /already restarting/);
});
test('restart refuses unsupported systems and mismatched ownership without spawning', async () => {
  for (const options of [{ platform: 'linux' }, { runtime: { pid: 101, port: 3000, root: '/synthetic' } }, { runtime: null }]) {
    const h = backend(options); await assert.rejects(h.run()); assert.equal(h.calls.length, 0);
  }
});
test('launcher failure is actionable and allows retry', async () => {
  const h = backend({ fail: true });
  await assert.rejects(h.run(), /Could not launch/);
  await assert.rejects(h.run(), /Could not launch/);
  assert.equal(h.calls.length, 2);
});
test('permission-denied helper launch reports Windows blocking instead of claiming a restart', async () => {
  const h = backend({ fail: true, failureCode: 'EPERM' });
  await assert.rejects(h.run(), /Windows blocked the restart helper/);
  assert.equal(h.killed(), 1);
  assert.equal(h.markers.size, 0);
});
test('invalid helper readiness fails closed and allows another attempt', async () => {
  const h = backend({ invalidReady: true });
  await assert.rejects(h.run(), /code invalid-ready/);
  await assert.rejects(h.run(), /code invalid-ready/);
  assert.equal(h.killed(), 2);
  assert.equal(h.markers.size, 0);
});
test('early helper exits identify safe handoff failure categories', async () => {
  for (const [code, expected] of [[2, /rejected the handoff/], [3, /readiness marker/], [4, /verify when the current server exits/]]) {
    const h = backend({ helperExitCode: code });
    await assert.rejects(h.run(), expected);
    assert.equal(h.markers.size, 0);
  }
  await assert.rejects(backend({ helperExitCode: 1 }).run(), /code helper-1/);
  await assert.rejects(backend({ fail: true, failureCode: 'ENOENT' }).run(), /code os-ENOENT/);
});
function frontend(confirm = true, fetch, storageFails = false) {
  const button = { disabled: false }; const status = { textContent: '' }; const menuStatus = { textContent: '', hidden: true }; let reloads = 0;
  const dialog = { open: false, returnValue: '', showModal() { this.open = true; if(confirm !== 'pending')queueMicrotask(() => this.close(confirm === true ? 'restart' : confirm === false ? 'cancel' : confirm)); }, addEventListener(type, listener) { if(type === 'close')this.onClose = listener; }, close(value = '') { this.returnValue = value; this.open = false; this.onClose(); } };
  const stored = new Map();
  const feedbackTimers = new Map();
  const testSetTimeout = (callback, delay) => {
    if(delay !== 8000)return setTimeout(callback,delay);
    const token={feedback:true};feedbackTimers.set(token,callback);return token;
  };
  const testClearTimeout = token => { if(!feedbackTimers.delete(token))clearTimeout(token); };
  const sessionStorage = { setItem(key, value) { if(storageFails)throw new Error('synthetic storage failure');stored.set(key,value); }, getItem: key => stored.get(key), removeItem: key => stored.delete(key) };
  const context = vm.createContext({ document: { querySelector: id => id === '#restartRcrd' ? button : id === '#restartMenuStatus' ? menuStatus : id === '#restartConfirmDialog' ? dialog : status },
    fetch, sessionStorage, AbortController, setTimeout:testSetTimeout, clearTimeout:testClearTimeout, Date, location: { reload: () => reloads++ } });
  vm.runInContext('let restartFeedbackTimer=null;',context);
  vm.runInContext(definition(appSource, 'confirmRcrdRestart'), context);
  vm.runInContext(definition(appSource, 'restartRcrd'), context);
  vm.runInContext(definition(appSource, 'restoreRestartFeedback'), context);
  return { button, status, menuStatus, dialog, stored, feedbackTimers, expire: () => { const callbacks=[...feedbackTimers.values()];feedbackTimers.clear();callbacks.forEach(callback=>callback()); }, restore: () => vm.runInContext('restoreRestartFeedback()', context), reloads: () => reloads, run: () => vm.runInContext('restartRcrd()', context), runMenu: () => vm.runInContext("restartRcrd(message=>{const notice=document.querySelector('#restartMenuStatus');notice.textContent=message;notice.hidden=false})", context) };
}
test('restart confirmation uses a themed in-app dialog with explicit choices', () => {
  const markup=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const styles=fs.readFileSync(path.join(root,'distinction.css'),'utf8');
  assert.match(markup, /<dialog id="restartConfirmDialog" aria-labelledby="restartConfirmTitle" aria-describedby="restartConfirmDescription">/);
  assert.match(markup, /<form method="dialog" class="restart-confirm-actions">/);
  assert.match(markup, /value="cancel"[^>]*>Cancel<\/button>/);
  assert.match(markup, /value="restart"[^>]*>Restart RCRD<\/button>/);
  assert.match(styles, /#restartConfirmDialog::backdrop/);
  assert.doesNotMatch(definition(appSource,'restartRcrd'), /\bconfirm\(/);
});
test('cancelled restart sends no requests', async () => {
  const h = frontend(false, () => { throw new Error('Unexpected fetch'); }); await h.run(); assert.equal(h.button.disabled, false);
});
test('Escape closes restart confirmation without a request', async () => {
  const h = frontend('', () => { throw new Error('Unexpected fetch'); }); await h.run(); assert.equal(h.dialog.open, false); assert.equal(h.button.disabled, false);
});
test('a second restart click cannot open another confirmation', async () => {
  let requests=0;
  const h=frontend('pending',async url=>{requests++;return {ok:true,json:async()=>url.includes('restart')?{ok:true,previousPid:100}:{ok:true,app:'rcrd',pid:101}}});
  const first=h.run();const second=h.run();await second;
  assert.equal(h.dialog.open,true);assert.equal(requests,0);
  h.dialog.close('restart');await first;
  assert.equal(requests,2);
});
test('cancelled profile-menu restart stays on the current view and shows no progress', async () => {
  const h = frontend(false, () => { throw new Error('Unexpected fetch'); }); await h.runMenu();
  assert.equal(h.button.disabled, false);assert.equal(h.menuStatus.hidden, true);assert.equal(h.status.textContent, '');
});
test('profile-menu restart reports progress and completion without opening Settings', async () => {
  const h = frontend(true, async url => ({ok:true,json:async()=>url.includes('restart')?{ok:true,previousPid:100}:{ok:true,app:'rcrd',pid:101}}));
  await h.runMenu();assert.equal(h.reloads(),1);assert.match(h.menuStatus.textContent,/restarted successfully/);
  assert.equal(h.stored.get('rcrd-restart-from-menu'),'1');
  h.menuStatus.textContent='';h.menuStatus.hidden=true;h.restore();
  assert.equal(h.menuStatus.textContent,'RCRD restarted successfully.');assert.equal(h.menuStatus.hidden,false);
  h.expire();assert.equal(h.menuStatus.hidden,true);assert.equal(h.menuStatus.textContent,'');
});
test('profile-menu restart keeps a launcher error visible without changing views', async () => {
  const h = frontend(true, async () => ({status:404}));await h.runMenu();
  assert.match(h.menuStatus.textContent,/Restart once using the RCRD launcher/);
  assert.equal(h.menuStatus.hidden,false);assert.equal(h.button.disabled,false);assert.equal(h.reloads(),0);
});
test('restart waits for a different healthy process then reloads', async () => {
  const calls = [];
  const h = frontend(true, async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => url.includes('restart') ? { ok: true, previousPid: 100 } : { ok: true, app: 'rcrd', pid: 101 } }; });
  await h.run(); assert.equal(h.reloads(), 1); assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['X-RCRD-Request'], '1');
  assert.equal(calls[1].options.cache, 'no-store');
  assert.match(h.status.textContent, /restarted successfully/);
  h.status.textContent='';h.restore();
  assert.equal(h.status.textContent,'RCRD restarted successfully.');
  assert.equal(h.stored.size,0,'completion marker is consumed once');
  assert.equal(h.feedbackTimers.size,1);
  h.expire();assert.equal(h.status.textContent,'','success clears after eight seconds');
});
test('success expiry cannot erase newer restart errors', () => {
  const h=frontend();h.stored.set('rcrd-restart-completed',String(Date.now()));h.restore();
  h.status.textContent='Restart failed.';h.expire();assert.equal(h.status.textContent,'Restart failed.');
});
test('a new restart cancels the previous success expiry and keeps its failure visible', async () => {
  const h=frontend(true,async()=>({status:404}));
  h.stored.set('rcrd-restart-completed',String(Date.now()));h.restore();
  await h.run();assert.equal(h.feedbackTimers.size,0);h.expire();assert.match(h.status.textContent,/Restart once/);
});
test('stale, malformed and future restart markers do not report success', () => {
  const h = frontend();
  for(const value of ['invalid',String(Date.now()-120000),String(Date.now()+120000)]){
    h.stored.set('rcrd-restart-completed',value);h.restore();
    assert.equal(h.status.textContent,'');assert.equal(h.stored.size,0);
  }
});
test('unavailable tab storage leaves visible confirmed success and a manual reload instruction', async () => {
  const h = frontend(true, async url => ({ok:true,json:async()=>url.includes('restart')?{ok:true,previousPid:100}:{ok:true,app:'rcrd',pid:101}}),true);
  await h.run();assert.equal(h.reloads(),0);assert.equal(h.button.disabled,false);
  assert.match(h.status.textContent,/restarted successfully.*Reload this page/);
});
test('older server explains the one-time manual restart without reloading', async () => {
  const h = frontend(true, async () => ({ status: 404 })); await h.run();
  assert.match(h.status.textContent, /Restart once/); assert.equal(h.button.disabled, false); assert.equal(h.reloads(), 0);
});

test('replacement helper waits for confirmed parent exit and never kills a process', async () => {
  const { waitForParentExit } = require('../scripts/Restart-RCRD.cjs');
  let calls = 0, clock = 0;
  await waitForParentExit(100, { now: () => clock, pause: async ms => { clock += ms; }, probe: (pid, signal) => {
    assert.equal(pid, 100); assert.equal(signal, 0);
    if (++calls === 3) throw Object.assign(new Error('synthetic exited'), { code: 'ESRCH' });
  } });
  assert.equal(calls, 3);
  await assert.rejects(waitForParentExit(100, { now: () => clock, pause: async ms => { clock += ms; }, probe() {} }), /did not exit/);
  let denied = 0;
  await waitForParentExit(100, { now: () => clock, pause: async ms => { clock += ms; }, probe() {
    if (++denied < 3) throw Object.assign(new Error('synthetic denied'), { code: 'EPERM' });
    throw Object.assign(new Error('synthetic exited'), { code: 'ESRCH' });
  } });
  assert.equal(denied, 3, 'access denied never counts as a stopped parent');
  await assert.rejects(waitForParentExit(100, { probe() { throw Object.assign(new Error('synthetic failure'), { code: 'EINVAL' }); } }), /Cannot confirm/);
});
