const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function updateUiFixture(responses) {
  const start = client.indexOf('async function installRcrdUpdate(){');
  const end = client.indexOf("\ndocument.querySelector('#updateInstallButton')", start);
  assert.ok(start >= 0 && end > start);
  const elements = new Map(['#updateInstallButton', '#updateDialogTitle', '#updateDialogMessage'].map(selector => [selector, { disabled: false, textContent: '' }]));
  const requests = [];
  let reloads = 0;
  const context = vm.createContext({
    document: { querySelector: selector => elements.get(selector) },
    fetch: async url => { requests.push(url); const response = responses.shift(); assert.ok(response, `Unexpected ${url}`); return { ok: response.ok !== false, json: async () => response.body }; },
    AbortSignal, Date, setTimeout,
    sessionStorage: { setItem() {} },
    location: { reload: () => { reloads += 1; } }
  });
  vm.runInContext(`let updateInstallBusy=false;${client.slice(start, end)};globalThis.run=installRcrdUpdate`, context);
  return { run: () => context.run(), elements, requests, reloads: () => reloads };
}

test('About exposes the GitHub update check without adding a separate menu or Settings card', () => {
  assert.equal((markup.match(/data-profile-action="update"/g) || []).length, 0);
  assert.match(markup, /id="settingsAbout"[\s\S]*data-check-updates>Check for updates/);
  assert.doesNotMatch(markup, /<h2>Updates<\/h2>/);
  assert.match(markup, /id="updateDialog"[\s\S]*id="updateInstallButton"[\s\S]*id="updateReleaseLink"[\s\S]*id="updateInstallHelp"/);
  assert.match(client, /fetch\('\/api\/update-check',\{cache:'no-store'\}\)/);
  assert.match(client, /data\.updateAvailable/);
  assert.match(client, /link\.textContent='View release notes ↗'/);
  assert.match(client, /fetch\('\/api\/update-install',\{method:'POST',headers:\{'X-RCRD-Request':'1'\}\}\)/);
  assert.match(client, /closest\('\[data-check-updates\]'\)/);
  const css = fs.readFileSync(path.join(root, 'distinction.css'), 'utf8');
  assert.match(css, /\.update-dialog-actions \[hidden\]\{display:none\}/);
});

test('update dialog installs locally while preserving credentials and account data', () => {
  assert.match(markup, /preserve your <code>\.env<\/code> and <code>\.data<\/code>/);
  assert.match(markup, /target="_blank" rel="noopener noreferrer" hidden>View release notes/);
});

test('update UI accepts a restarted server at the requested version without a persisted anonymous session', async () => {
  const ui = updateUiFixture([
    { body: { ok: true, version: '1.3.42', previousPid: 101 } },
    { body: { app: 'rcrd', version: '1.3.42', pid: 202 } }
  ]);
  await ui.run();
  assert.deepEqual(ui.requests, ['/api/update-install', '/api/health']);
  assert.equal(ui.reloads(), 1);
});

test('update UI reports rollback when anonymous update status is unavailable', async () => {
  const ui = updateUiFixture([
    { body: { ok: true, version: '1.3.42', previousPid: 101 } },
    { body: { app: 'rcrd', version: '1.3.41', pid: 202 } },
    { ok: false, body: { error: 'Open RCRD before checking update status.' } }
  ]);
  await ui.run();
  assert.equal(ui.reloads(), 0);
  assert.match(ui.elements.get('#updateDialogMessage').textContent, /restarted without the requested version/);
  assert.equal(ui.elements.get('#updateInstallButton').disabled, false);
});

test('profile renewal notifications are actionable, dismissible, and periodically refreshed', () => {
  assert.equal((markup.match(/profile-alert-indicator/g) || []).length, 2);
  assert.equal((markup.match(/profile-renewal-alert/g) || []).length, 2);
  assert.match(markup, /data-spotify-authorize>Renew Spotify/);
  assert.match(client, /dataset\.dismissSpotifyRenewal/);
  assert.match(client, /rcrd-spotify-renewal-dismissed/);
  assert.match(client, /setInterval\(refreshSpotifyRenewalNotice,21600000\)/);
  assert.match(client, /\/api\/notifications\/spotify-renewal\/dismiss/);
});
