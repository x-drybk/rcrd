const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('About exposes the GitHub update check without adding a separate menu or Settings card', () => {
  assert.equal((markup.match(/data-profile-action="update"/g) || []).length, 0);
  assert.match(markup, /id="settingsAbout"[\s\S]*data-check-updates>Check for updates/);
  assert.doesNotMatch(markup, /<h2>Updates<\/h2>/);
  assert.match(markup, /id="updateDialog"[\s\S]*id="updateReleaseLink"[\s\S]*id="updateInstallHelp"/);
  assert.match(client, /fetch\('\/api\/update-check',\{cache:'no-store'\}\)/);
  assert.match(client, /data\.updateAvailable/);
  assert.match(client, /closest\('\[data-check-updates\]'\)/);
});

test('update instructions preserve credentials and local account data', () => {
  assert.match(markup, /keep your existing <code>\.env<\/code> and <code>\.data<\/code>/);
  assert.match(markup, /target="_blank" rel="noopener noreferrer" hidden>View release and download/);
});
