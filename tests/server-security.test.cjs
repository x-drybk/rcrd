const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const sessionId = 'a'.repeat(48);

function syntheticSessions(key, spotifyScope = '', sessionExpiresAt = null) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const sessions = { [sessionId]: { ...(sessionExpiresAt === null ? {} : { expiresAt: sessionExpiresAt }), spotify: { refreshToken: 'synthetic-refresh', userId: 'synthetic-user', scope: spotifyScope }, accessToken: 'synthetic-discogs-token', accessSecret: 'synthetic-discogs-secret' } };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ version: 1, sessions }), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

async function fixture(run, { spotifyCacheUsers = {}, spotifyScope = '', spotifyCacheVersion = 2, spotifyCacheRaw = null, sessionExpiresAt = null, metadataContact = '', geniusAccessToken = '' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rcrd-server-test-'));
  const runtime = path.join(directory, '.data');
  fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(directory, '.env'), 'SYNTHETIC_PRIVATE_VALUE=fixture-only\n');
  fs.writeFileSync(path.join(directory, 'index.html'), '<h1>RCRD synthetic page</h1>');
  fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(directory, 'package.json'));
  fs.writeFileSync(path.join(directory, 'manifest.webmanifest'), JSON.stringify({ name: 'RCRD synthetic', start_url: './', scope: './' }));
  fs.writeFileSync(path.join(directory, 'app.js'), 'window.syntheticPage = true;');
  fs.mkdirSync(path.join(directory, 'walkthrough'));
  fs.writeFileSync(path.join(directory, 'walkthrough', 'RCRD-complete-walkthrough.mp4'), 'SYNTHETIC_VIDEO_BYTES');
  fs.writeFileSync(path.join(directory, 'walkthrough', 'RCRD-complete-walkthrough-transcript.md'), 'Synthetic walkthrough transcript');
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.copyFileSync(path.join(__dirname, '..', 'assets', 'spotify-full-logo-white.svg'), path.join(directory, 'assets', 'spotify-full-logo-white.svg'));
  fs.copyFileSync(path.join(__dirname, '..', 'assets', 'spotify-icon-white.svg'), path.join(directory, 'assets', 'spotify-icon-white.svg'));
  fs.copyFileSync(path.join(__dirname, '..', 'assets', 'rcrd-cover-placeholder.webp'), path.join(directory, 'assets', 'rcrd-cover-placeholder.webp'));
  fs.mkdirSync(path.join(directory, 'scripts'));
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'Parse-Spotify-History.ps1'), path.join(directory, 'scripts', 'Parse-Spotify-History.ps1'));
  fs.writeFileSync(path.join(runtime, 'spotify-cache.json'), spotifyCacheRaw ?? JSON.stringify({ version: spotifyCacheVersion, users: { synthetic: { private: true }, ...spotifyCacheUsers } }));
  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(runtime, 'oauth-session.key'), key);
  fs.writeFileSync(path.join(runtime, 'oauth-sessions.enc'), syntheticSessions(key, spotifyScope, sessionExpiresAt));
  const state = { failPersistence: false, failSpotifyCacheWrite: false, timeoutImmediately: false, externalCalls: 0, checkpointWrites: [], historyParser: null, providerFetch: async () => { throw new Error('External request blocked'); } };
  const testFs = Object.create(fs);
  testFs.writeFileSync = (file, contents, options) => {
    if (file.includes('spotify-checkpoints')) state.checkpointWrites.push(JSON.parse(contents));
    return fs.writeFileSync(file, contents, options);
  };
  testFs.renameSync = (from, to) => {
    if (state.failPersistence && to === path.join(runtime, 'oauth-sessions.enc')) throw Object.assign(new Error('synthetic disk failure'), { code: 'EACCES' });
    if (state.failSpotifyCacheWrite && to === path.join(runtime, 'spotify-cache.json')) throw Object.assign(new Error('synthetic cache failure'), { code: 'EACCES' });
    return fs.renameSync(from, to);
  };
  testFs.unlinkSync = file => {
    if (state.failPersistence && file === path.join(runtime, 'oauth-sessions.enc')) throw Object.assign(new Error('synthetic disk failure'), { code: 'EACCES' });
    return fs.unlinkSync(file);
  };
  const module = { exports: {} };
  const fakeProcess = { platform: process.platform, env: { PORT: '3000', HOST: '0.0.0.0', DISCOGS_CONSUMER_KEY: 'synthetic-key', DISCOGS_CONSUMER_SECRET: 'synthetic-secret', SPOTIFY_CLIENT_ID: 'synthetic-client', SPOTIFY_CLIENT_SECRET: 'synthetic-client-secret' }, pid: 12345, exit() { throw new Error('Unexpected process.exit in test'); } };
  fakeProcess.env.RCRD_METADATA_CONTACT = metadataContact;
  fakeProcess.env.GENIUS_ACCESS_TOKEN = geniusAccessToken;
  const testRequire = name => name === 'node:fs' ? testFs : name === 'node:child_process' ? {
    spawn(command, args, options) {
      if (command !== 'powershell.exe' || !args.some(value => String(value).endsWith('Parse-Spotify-History.ps1')) || !state.historyParser) throw new Error('Unexpected child process in test');
      assert.equal(options.env.SPOTIFY_CLIENT_SECRET, undefined);
      assert.equal(options.env.DISCOGS_CONSUMER_SECRET, undefined);
      const child = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => {
        try {
          const archive = args[args.indexOf('-ArchivePath') + 1];
          const output = args[args.indexOf('-OutputPath') + 1];
          const summary = state.historyParser(fs.readFileSync(archive));
          if (!summary) child.emit('exit', 1);
          else { fs.writeFileSync(output, JSON.stringify(summary)); child.emit('exit', 0); }
        } catch { child.emit('exit', 1); }
      });
      return child;
    }
  } : require(name);
  const testSetTimeout = (callback, delay) => state.timeoutImmediately && delay === 20000 ? Promise.resolve().then(callback) : setTimeout(callback, delay);
  try {
    vm.runInNewContext(`${source}\nmodule.exports.bindHost = bindHost; module.exports.testSessions = sessions; module.exports.testInvalidateLibrary = invalidateSpotifyLibrary; module.exports.testSpotifyAccess = spotifyAccess;`, { require: testRequire, module, __dirname: directory, process: fakeProcess, Buffer, URL, URLSearchParams, AbortController, setTimeout: testSetTimeout, clearTimeout, console: { error() {}, log() {} }, fetch: async (url, options) => { state.externalCalls++; return state.providerFetch(url, options); } }, { filename: 'synthetic/server.js' });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const server = module.exports.server;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  async function request(url, { method = 'GET', headers = {}, body = '' } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, incoming => {
        const chunks = [];
        incoming.on('data', chunk => chunks.push(chunk));
        incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }
  try { await run({ request, state, port, runtime, key, bindHost: module.exports.bindHost, testSessions: module.exports.testSessions, testInvalidateLibrary: module.exports.testInvalidateLibrary, testSpotifyAccess: module.exports.testSpotifyAccess }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    const target = path.resolve(directory);
    const tempRoot = path.resolve(os.tmpdir());
    assert.ok(target.startsWith(tempRoot + path.sep) && path.basename(target).startsWith('rcrd-server-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
}

test('admin restart rejects missing and cross-origin intent without launching a process', () => fixture(async ({ request, port }) => {
  const endpoint = '/api/admin/restart';
  const page = await request('/');
  const anonymousCookie = page.headers['set-cookie']?.[0]?.split(';', 1)[0];
  assert.match(anonymousCookie, /^rcrd_session=[a-f0-9]{48}$/);
  assert.equal((await request(endpoint, { method: 'POST' })).status, 403);
  assert.equal((await request(endpoint, { method: 'POST', headers: { 'X-RCRD-Request': '1' } })).status, 403);
  assert.equal((await request(endpoint, { method: 'POST', headers: { 'X-RCRD-Request': '1', Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await request(endpoint)).status, 404);
  assert.equal((await request(endpoint, { method: 'POST', headers: { 'X-RCRD-Request': '1', Origin: `http://127.0.0.1:${port}` } })).status, 401);
  assert.equal((await request(endpoint, { method: 'POST', headers: { Cookie: `rcrd_session=${'b'.repeat(48)}`, 'X-RCRD-Request': '1', Origin: `http://127.0.0.1:${port}` } })).status, 401);
  assert.equal((await request(endpoint, { method: 'POST', headers: { Cookie: anonymousCookie, 'X-RCRD-Request': '1', Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: { Cookie: anonymousCookie } })).body).connected, false);
  assert.equal(JSON.parse((await request('/api/session', { headers: { Cookie: anonymousCookie } })).body).connected, false);
  const anonymousRestart = await request(endpoint, { method: 'POST', headers: { Cookie: anonymousCookie, 'X-RCRD-Request': '1', Origin: `http://127.0.0.1:${port}` } });
  assert.equal(anonymousRestart.status, 503, 'a local session without provider credentials reaches the synthetic restart helper');
  const response = await request(endpoint, { method: 'POST', headers: { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', Origin: `http://127.0.0.1:${port}` } });
  assert.equal(response.status, 503, 'synthetic process cannot launch the Windows restart');
}));

test('serves only public assets and keeps private fixture files inaccessible', () => fixture(async ({ request, state, bindHost }) => {
  assert.equal(bindHost, '127.0.0.1');
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /RCRD synthetic page/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.match(page.headers['content-security-policy'], /script-src 'self' https:\/\/sdk\.scdn\.co/);
  assert.doesNotMatch(page.headers['content-security-policy'], /script-src[^;]*'unsafe-inline'/);
  assert.match(page.headers['content-security-policy'], /media-src 'self' blob:/);
  const script = await request('/app.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.equal(script.headers['referrer-policy'], 'no-referrer');
  const manifest = await request('/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers['content-type'], /application\/manifest\+json/);
  assert.equal(JSON.parse(manifest.body).name, 'RCRD synthetic');
  const spotifyLogo = await request('/assets/spotify-full-logo-white.svg');
  assert.equal(spotifyLogo.status, 200);
  assert.match(spotifyLogo.headers['content-type'], /image\/svg\+xml/);
  assert.match(spotifyLogo.body, /<svg\b/);
  const spotifyIcon = await request('/assets/spotify-icon-white.svg');
  assert.equal(spotifyIcon.status, 200);
  assert.match(spotifyIcon.headers['content-type'], /image\/svg\+xml/);
  assert.match(spotifyIcon.body, /<svg\b/);
  const placeholderArt = await request('/assets/rcrd-cover-placeholder.webp');
  assert.equal(placeholderArt.status, 200);
  assert.equal(placeholderArt.headers['content-type'], 'image/webp');
  const video = await request('/walkthrough/RCRD-complete-walkthrough.mp4');
  assert.equal(video.status, 200);
  assert.equal(video.body, 'SYNTHETIC_VIDEO_BYTES');
  assert.equal(video.headers['content-type'], 'video/mp4');
  assert.equal(video.headers['accept-ranges'], 'bytes');
  const segment = await request('/walkthrough/RCRD-complete-walkthrough.mp4', { headers: { Range: 'bytes=2-5' } });
  assert.equal(segment.status, 206);
  assert.equal(segment.body, 'NTHE');
  assert.equal(segment.headers['content-range'], 'bytes 2-5/21');
  const suffix = await request('/walkthrough/RCRD-complete-walkthrough.mp4', { headers: { Range: 'bytes=-5' } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.body, 'BYTES');
  assert.equal((await request('/walkthrough/RCRD-complete-walkthrough.mp4', { headers: { Range: 'bytes=99-' } })).status, 416);
  assert.equal((await request('/walkthrough/RCRD-complete-walkthrough.mp4', { headers: { Range: 'bytes=0-1,3-4' } })).status, 416);
  const transcript = await request('/walkthrough/RCRD-complete-walkthrough-transcript.md');
  assert.equal(transcript.status, 200);
  assert.equal(transcript.body, 'Synthetic walkthrough transcript');
  assert.match(transcript.headers['content-type'], /text\/plain/);
  assert.equal((await request('/walkthrough/source/scenes.json')).status, 404);
  for (const file of ['/.env', '/.data/oauth-session.key', '/.data/oauth-sessions.enc', '/.data/spotify-cache.json', '/server.js', '/.data']) {
    const response = await request(file);
    assert.equal(response.status, 404, file);
    assert.doesNotMatch(response.body, /fixture-only|synthetic-refresh|synthetic-discogs-token/);
  }
  assert.equal((await request('/styles.css')).status, 404);
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).version, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version);
  assert.equal(state.externalCalls, 0);
}));

test('valid saved cookie restores only its own account; missing cookie cannot access or mutate it', () => fixture(async ({ request, state }) => {
  assert.equal(JSON.parse((await request('/api/spotify/status')).body).connected, false);
  assert.equal(JSON.parse((await request('/api/session')).body).connected, false);
  assert.equal((await request('/api/spotify/me')).status, 401);
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).connected, true);
  assert.equal(JSON.parse((await request('/api/session', { headers: cookie })).body).connected, true);
  assert.equal((await request('/api/collection', { method: 'POST', headers: { 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: '{"release_id":1}' })).status, 401);
  assert.equal(JSON.parse((await request('/api/session', { headers: cookie })).body).connected, true);
  assert.equal(state.externalCalls, 0);
}));

test('Spotify history import is local, account-bound, repeatable, and removable', () => fixture(async ({ request, state, runtime, port }) => {
  state.providerFetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (pathname === '/v1/me') return providerJson({ id: 'synthetic-user', display_name: 'Synthetic User', followers: { total: 0 }, images: [] });
    throw new Error('Unexpected provider request');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const mutation = { ...cookie, Origin: `http://127.0.0.1:${port}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/zip' };
  state.historyParser = archive => {
    const label = archive.toString('utf8');
    if (!label.startsWith('synthetic-archive:')) return null;
    const username = label.slice('synthetic-archive:'.length);
    return { version: 1, username: username === 'missing-account-id' ? null : username, totalPlays: 2, firstAt: '2025-01-01T12:00:00Z', lastAt: '2025-01-02T12:00:00Z', tracks: [{ uri: 'spotify:track:trackone', title: 'One', artist: 'Artist', album: 'Album', plays: 2, ip_addr_decrypted: 'synthetic-private-ip' }] };
  };
  const archiveFor = username => Buffer.from(`synthetic-archive:${username}`);
  assert.equal((await request('/api/spotify/history')).status, 401);
  assert.equal((await request('/api/spotify/history', { method: 'POST', headers: cookie, body: archiveFor('synthetic-user') })).status, 403);
  assert.equal((await request('/api/spotify/history', { method: 'POST', headers: mutation, body: archiveFor('different-user') })).status, 409);
  const confirmed = { ...mutation, 'X-RCRD-History-Account-Confirmed': '1' };
  assert.equal((await request('/api/spotify/history', { method: 'POST', headers: confirmed, body: archiveFor('different-user') })).status, 409, 'confirmation cannot override a mismatched account ID');
  const missingId = archiveFor('missing-account-id');
  const unconfirmed = await request('/api/spotify/history', { method: 'POST', headers: mutation, body: missingId });
  assert.equal(unconfirmed.status, 409);
  assert.match(JSON.parse(unconfirmed.body).error, /Confirm/);
  assert.equal(JSON.parse((await request('/api/spotify/history', { headers: cookie })).body).imported, false);
  const anonymous = await request('/api/spotify/history', { method: 'POST', headers: confirmed, body: missingId });
  assert.equal(anonymous.status, 200, anonymous.body);
  assert.equal(JSON.parse(anonymous.body).totalPlays, 2);
  const good = archiveFor('synthetic-user');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request('/api/spotify/history', { method: 'POST', headers: mutation, body: good });
    assert.equal(response.status, 200, response.body);
    assert.equal(JSON.parse(response.body).totalPlays, 2);
    assert.equal(JSON.parse(response.body).topTracks[0].plays, 2);
  }
  const stored = fs.readFileSync(path.join(runtime, 'listening-history', `${crypto.createHash('sha256').update('synthetic-user').digest('hex')}.json`), 'utf8');
  assert.doesNotMatch(stored, /synthetic-private-ip|username|ms_played/);
  assert.equal(fs.readdirSync(runtime).some(name => name.startsWith('history-import-')), false);
  assert.equal((await request('/api/spotify/history', { method: 'POST', headers: mutation, body: Buffer.from('not a zip') })).status, 400);
  assert.equal(JSON.parse((await request('/api/spotify/history', { headers: cookie })).body).totalPlays, 2);
  state.historyParser = () => ({ version: 1, username: 'synthetic-user', totalPlays: 465, firstAt: '2025-01-01T12:00:00Z', lastAt: '2025-01-02T12:00:00Z', tracks: Array.from({ length: 30 }, (_, index) => ({ uri: `spotify:track:synthetic${index + 1}`, title: `Song ${index + 1}`, artist: `Artist ${index % 2}`, album: `Album ${index % 3}`, plays: index + 1 })) });
  const bulk = await request('/api/spotify/history', { method: 'POST', headers: mutation, body: good });
  assert.equal(bulk.status, 200, bulk.body);
  const first = JSON.parse(bulk.body);
  assert.equal(first.trackCount, 30);
  assert.equal(first.matches, 30);
  assert.equal(first.tracks.length, 12);
  assert.equal(first.tracks[0].plays, 30);
  assert.equal(first.topTracks[0].plays, 30);
  const second = JSON.parse((await request('/api/spotify/history?page=2&sort=plays&direction=asc', { headers: cookie })).body);
  assert.equal(second.page, 2);
  assert.equal(second.tracks.length, 12);
  assert.equal(second.tracks[0].plays, 13);
  const last = JSON.parse((await request('/api/spotify/history?page=9999', { headers: cookie })).body);
  assert.equal(last.page, 3);
  assert.equal(last.tracks.length, 6);
  assert.equal(last.tracks.at(-1).plays, 1);
  const searched = JSON.parse((await request('/api/spotify/history?q=Song%202&sort=title&direction=asc', { headers: cookie })).body);
  assert.equal(searched.matches, 11);
  assert.equal(searched.tracks[0].title, 'Song 2');
  assert.equal((await request('/api/spotify/history?page=0', { headers: cookie })).status, 400);
  assert.equal((await request('/api/spotify/history?sort=invalid', { headers: cookie })).status, 400);
  assert.equal((await request('/api/spotify/history?direction=sideways', { headers: cookie })).status, 400);
  assert.equal((await request('/api/spotify/history', { method: 'DELETE', headers: { ...mutation, 'Content-Type': 'application/json' } })).status, 200);
  assert.equal(JSON.parse((await request('/api/spotify/history', { headers: cookie })).body).imported, false);
}));

test('legacy saved sessions receive a bounded expiry and expired sessions cannot restore account access', () => fixture(async ({ request, runtime, key, testSessions, state }) => {
  const saved = JSON.parse(fs.readFileSync(path.join(runtime, 'oauth-sessions.enc'), 'utf8'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(saved.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
  const restored = JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  assert.ok(restored.sessions[sessionId].expiresAt > Date.now());
  assert.ok(restored.sessions[sessionId].expiresAt <= Date.now() + 365 * 86400000);
  testSessions.get(sessionId).expiresAt = Date.now() - 1;
  const response = await request('/api/spotify/status', { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(JSON.parse(response.body).connected, false);
  assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await request('/api/spotify/me', { headers: { Cookie: `rcrd_session=${sessionId}` } })).status, 401);
  assert.equal(fs.existsSync(path.join(runtime, 'oauth-sessions.enc')), false);
  assert.equal(state.externalCalls, 0);
}));

test('expired saved sessions are removed when the server starts', () => fixture(async ({ request, runtime, state }) => {
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: { Cookie: `rcrd_session=${sessionId}` } })).body).connected, false);
  assert.equal(fs.existsSync(path.join(runtime, 'oauth-sessions.enc')), false);
  assert.equal(state.externalCalls, 0);
}, { sessionExpiresAt: Date.now() - 1 }));

test('a damaged Spotify cache fails startup without replacing the private file', async () => {
  await assert.rejects(fixture(async () => { throw new Error('Startup unexpectedly succeeded'); }, { spotifyCacheRaw: '{synthetic-corruption' }), /Could not restore the Spotify cache/);
  await assert.rejects(fixture(async () => { throw new Error('Startup unexpectedly succeeded'); }, { spotifyCacheRaw: '{"version":2,"users":[]}' }), /Could not restore the Spotify cache/);
});

test('oversized provider responses are rejected before parsing or exposing their contents', () => fixture(async ({ request, state }) => {
  state.providerFetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5 * 1024 * 1024));
      controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      controller.close();
    }
  }));
  const response = await request('/api/search?q=synthetic');
  assert.equal(response.status, 502);
  assert.doesNotMatch(response.body, /synthetic-corruption|Provider response exceeded/);
  assert.equal(state.externalCalls, 1);
}));

test('a declared oversized provider response is rejected before reading its body', () => fixture(async ({ request, state }) => {
  let read = false;
  state.providerFetch = async () => ({ ok: true, status: 200, headers: { get: name => name === 'content-length' ? String(9 * 1024 * 1024) : null }, text: async () => { read = true; return '{}'; } });
  assert.equal((await request('/api/search?q=synthetic')).status, 502);
  assert.equal(read, false);
  assert.equal(state.externalCalls, 1);
}));

test('Discogs throttling honors Retry-After and suppresses requests during cooldown', () => fixture(async ({ request, state }) => {
  state.providerFetch = async () => ({ ok: false, status: 429, headers: { get: name => name === 'retry-after' ? '4' : null }, text: async () => '{}' });
  const first = await request('/api/search?q=synthetic');
  assert.equal(first.status, 429);
  assert.equal(first.headers['retry-after'], '4');
  const second = await request('/api/search?q=synthetic-again');
  assert.equal(second.status, 429);
  assert.equal(state.externalCalls, 1);
}));

test('Discogs throttling applies bounded fallback when Retry-After is absent', () => fixture(async ({ request, state }) => {
  state.providerFetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => '{}' });
  const response = await request('/api/search?q=synthetic');
  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '30');
  assert.equal(state.externalCalls, 1);
}));

test('rejects untrusted Host, Origin and writes without the same-origin request header', () => fixture(async ({ request, port, state }) => {
  assert.equal((await request('/api/session', { headers: { Host: 'untrusted-audit.invalid' } })).status, 403);
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  assert.equal((await request('/api/discogs/disconnect', { method: 'POST', headers: cookie })).status, 403);
  assert.equal((await request('/api/discogs/disconnect', { method: 'POST', headers: { ...cookie, 'X-RCRD-Request': '1', Origin: 'https://untrusted-audit.invalid' } })).status, 403);
  assert.equal(JSON.parse((await request('/api/session', { headers: cookie })).body).connected, true);
  const allowed = await request('/api/discogs/disconnect', { method: 'POST', headers: { ...cookie, 'X-RCRD-Request': '1', Origin: `http://127.0.0.1:${port}` } });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.parse((await request('/api/session', { headers: cookie })).body).connected, false);
  assert.equal(state.externalCalls, 0);
}));

test('malformed cookie and JSON fail safely; failed session write does not claim disconnect', () => fixture(async ({ request, state, runtime, key }) => {
  assert.equal((await request('/api/health', { headers: { Cookie: 'unrelated=%' } })).status, 200);
  const cookie = { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' };
  assert.equal((await request('/api/collection', { method: 'POST', headers: cookie, body: 'null' })).status, 400);
  state.failPersistence = true;
  assert.equal((await request('/api/discogs/disconnect', { method: 'POST', headers: cookie })).status, 500);
  assert.equal(JSON.parse((await request('/api/session', { headers: cookie })).body).connected, true);
  state.failPersistence = false;
  assert.equal((await request('/api/discogs/disconnect', { method: 'POST', headers: cookie })).status, 200);
  const payload = JSON.parse(fs.readFileSync(path.join(runtime, 'oauth-sessions.enc'), 'utf8'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  assert.equal(saved.sessions[sessionId].accessToken, undefined);
  assert.equal(state.externalCalls, 0);
}));

function providerJson(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(value) };
}

test('Genius lyrics require a connected account and optional server-side token', () => fixture(async ({ request, state }) => {
  const endpoint = '/api/lyrics/genius';
  const payload = JSON.stringify({ title: 'Synthetic song', artist: 'Synthetic artist' });
  assert.equal((await request(endpoint, { method: 'POST', body: payload })).status, 403);
  assert.equal((await request(endpoint, { method: 'POST', headers: { 'X-RCRD-Request': '1' }, body: payload })).status, 401);
  const response = await request(endpoint, { method: 'POST', headers: { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1' }, body: payload });
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.body, /synthetic-refresh|synthetic-private/);
  assert.equal(state.externalCalls, 0);
}));

test('Genius matching uses a bounded provider request and rejects ambiguous or malformed matches', () => fixture(async ({ request, state }) => {
  const endpoint = '/api/lyrics/genius';
  const headers = { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' };
  const body = JSON.stringify({ title: 'Bloom (feat. Guest)', artist: 'The Paper Kites, Guest' });
  const hit = (id, title = 'Bloom', artist = 'The Paper Kites') => ({ result: { id, title, primary_artist: { name: artist }, url: `https://genius.com/The-paper-kites-${title.replaceAll(' ', '-')}-lyrics` } });
  let results = [hit(123), hit(124, 'Other song'), hit(125, 'Bloom', 'Other artist')];
  state.providerFetch = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.genius.com');
    assert.equal(new URL(url).pathname, '/search');
    assert.match(new URL(url).searchParams.get('q'), /Bloom.*The Paper Kites/);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-genius-token');
    assert.equal(options.redirect, 'error');
    return providerJson({ response: { hits: results } });
  };
  assert.equal((await request(endpoint, { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await request(endpoint, { method: 'POST', headers, body: JSON.stringify({ title: 'a'.repeat(181), artist: 'Artist' }) })).status, 400);
  let response = await request(endpoint, { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { id: 123, title: 'Bloom', artist: 'The Paper Kites', url: 'https://genius.com/The-paper-kites-Bloom-lyrics' });
  assert.doesNotMatch(response.body, /synthetic-genius-token|Bearer/);
  results = [hit(123), hit(456)];
  response = await request(endpoint, { method: 'POST', headers, body });
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).searchUrl.startsWith('https://genius.com/search?'), true);
  results = [{ result: { ...hit(123).result, url: 'https://genius.com.evil.example/redirect' } }];
  response = await request(endpoint, { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).url, 'https://genius.com/songs/123');
  results = 'not results';
  response = await request(endpoint, { method: 'POST', headers, body });
  assert.equal(response.status, 502);
  assert.equal(state.externalCalls, 4);
}, { geniusAccessToken: 'synthetic-genius-token' }));

test('Genius embed accepts only numeric IDs and has an isolated frame policy', () => fixture(async ({ request, state }) => {
  for (const id of ['', '-1', '1%22', '123abc']) assert.equal((await request(`/genius-embed?id=${id}`)).status, 400);
  const response = await request('/genius-embed?id=123');
  assert.equal(response.status, 200);
  assert.match(response.body, /https:\/\/genius\.com\/songs\/123\/embed\.js/);
  assert.match(response.body, /<div id="rg_embed_link_123" class="rg_embed_link" data-song-id="123"><\/div>/);
  assert.doesNotMatch(response.body, /Genius could not display lyrics here/);
  assert.match(response.body, /rcrd-genius-embed-error/);
  assert.match(response.body, /id="geniusEmbedScript"/);
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(response.headers['content-security-policy'], /default-src 'none'/);
  assert.match(response.headers['content-security-policy'], /script-src 'nonce-[A-Za-z0-9+/=]+' https:\/\/genius\.com https:\/\/assets\.genius\.com/);
  assert.match(response.headers['content-security-policy'], /script-src-attr 'none'/);
  assert.match(response.headers['content-security-policy'], /style-src 'unsafe-inline';/);
  assert.doesNotMatch(response.headers['content-security-policy'], /style-src[^;]*https?:\/\//);
  assert.match(response.headers['content-security-policy'], /frame-src 'none'/);
  assert.doesNotMatch(response.headers['content-security-policy'], /http:\/\/|script-src[^;]*'unsafe-inline'/);
  assert.match(response.body, /background:#19211c;color:#eef2ed/);
  assert.match(response.body, /iframe\{display:none!important\}/);
  assert.equal(state.externalCalls, 0);
}));

test('recorded play counts are account-bound, deduplicate recent plays, avoid ZIP overlap, and clear locally', () => fixture(async ({ request, state, runtime }) => {
  const uri = 'spotify:track:synthetic1';
  const cutoff = Date.now() - 3600000;
  const before = new Date(cutoff - 60000).toISOString();
  const after = new Date(cutoff + 60000).toISOString();
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const historyRoot = path.join(runtime, 'listening-history');
  fs.mkdirSync(historyRoot);
  fs.writeFileSync(path.join(historyRoot, `${userKey}.json`), JSON.stringify({ version: 1, totalPlays: 5, importedAt: Date.now(), lastAt: new Date(cutoff).toISOString(), tracks: [{ uri, title: 'Synthetic song', artist: 'Synthetic artist', album: 'Synthetic album', plays: 5 }] }));
  state.providerFetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (pathname === '/v1/me/player/recently-played') return providerJson({ items: [{ played_at: before, track: { uri } }, { played_at: after, track: { uri } }] });
    throw new Error('Unexpected provider endpoint');
  };
  const route = `/api/spotify/play-counts?uri=${encodeURIComponent(uri)}`;
  assert.equal((await request(route)).status, 401);
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  assert.equal((await request('/api/spotify/play-counts?uri=invalid', { headers: cookie })).status, 400);
  const first = await request(route, { headers: cookie });
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).counts[uri], 6);
  assert.equal(JSON.parse(first.body).matches[uri], 'exact');
  const postHeaders = { ...cookie, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' };
  const alternateUri = 'spotify:track:syntheticAlternate';
  const alternateBody = JSON.stringify({ tracks: [{ uri: alternateUri, title: 'Synthetic song', artist: 'Synthetic artist' }] });
  assert.equal((await request('/api/spotify/play-counts', { method: 'POST', headers: cookie, body: alternateBody })).status, 403);
  assert.equal((await request('/api/spotify/play-counts', { method: 'POST', headers: postHeaders, body: JSON.stringify({ tracks: [{ uri: alternateUri, title: '<unsafe>', artist: 'Synthetic artist' }] }) })).status, 200);
  const alternate = JSON.parse((await request('/api/spotify/play-counts', { method: 'POST', headers: postHeaders, body: alternateBody })).body);
  assert.equal(alternate.counts[alternateUri], 6);
  assert.equal(alternate.matches[alternateUri], 'song');
  const unrecordedUri = 'spotify:track:unrecorded';
  const unrecorded = JSON.parse((await request('/api/spotify/play-counts', { method: 'POST', headers: postHeaders, body: JSON.stringify({ tracks: [{ uri: unrecordedUri, title: 'Other song', artist: 'Other artist' }] }) })).body);
  assert.equal(unrecorded.counts[unrecordedUri], null);
  assert.equal(unrecorded.matches[unrecordedUri], 'unrecorded');
  assert.equal((await request('/api/spotify/play-counts', { method: 'POST', headers: postHeaders, body: JSON.stringify({ tracks: [{ uri: alternateUri, title: 'a'.repeat(181), artist: 'Artist' }] }) })).status, 400);
  const second = await request(route, { headers: cookie });
  assert.equal(JSON.parse(second.body).counts[uri], 6);
  const ledger = JSON.parse(fs.readFileSync(path.join(historyRoot, `${userKey}.recent.json`), 'utf8'));
  assert.equal(ledger.events.length, 2);
  const deleted = await request('/api/spotify/history', { method: 'DELETE', headers: { ...cookie, 'X-RCRD-Request': '1' } });
  assert.equal(deleted.status, 200);
  assert.equal(JSON.parse((await request(route, { headers: cookie })).body).counts[uri], null);
  const ledgerFile = path.join(historyRoot, `${userKey}.recent.json`);
  fs.writeFileSync(ledgerFile, '{damaged');
  const damaged = await request(route, { headers: cookie });
  assert.equal(damaged.status, 502);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), '{damaged');
}, { spotifyScope: 'user-read-recently-played' }));

test('ambiguous title and artist matches never claim another recording\'s play count', () => fixture(async ({ request, state, runtime }) => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const historyRoot = path.join(runtime, 'listening-history');
  fs.mkdirSync(historyRoot);
  fs.writeFileSync(path.join(historyRoot, `${userKey}.json`), JSON.stringify({ version: 1, totalPlays: 7, importedAt: Date.now(), lastAt: new Date(Date.now() - 3600000).toISOString(), tracks: [
    { uri: 'spotify:track:recordingOne', title: 'Shared title', artist: 'Same artist', album: 'Album one', plays: 3 },
    { uri: 'spotify:track:recordingTwo', title: 'Shared title', artist: 'Same artist', album: 'Album two', plays: 4 }
  ] }));
  state.providerFetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (pathname === '/v1/me/player/recently-played') return providerJson({ items: [] });
    throw new Error('Unexpected provider endpoint');
  };
  const response = await request('/api/spotify/play-counts', { method: 'POST', headers: { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks: [{ uri: 'spotify:track:thirdRecording', title: 'Shared title', artist: 'Same artist' }] }) });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).counts['spotify:track:thirdRecording'], null);
  assert.equal(JSON.parse(response.body).matches['spotify:track:thirdRecording'], 'ambiguous');
}, { spotifyScope: 'user-read-recently-played' }));

test('manual Spotify refresh requires a session and request header, bypasses cache, and retains a good result after failure', () => fixture(async ({ request, state }) => {
  let searches = 0;
  let failSearch = false;
  state.providerFetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/token') return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (pathname === '/v1/search') {
      searches++;
      return failSearch ? providerJson({ error: { message: 'Synthetic failure' } }, 503) : providerJson({ albums: { items: [{ name: `Synthetic result ${searches}` }], total: 1 } });
    }
    throw new Error('Unexpected provider endpoint');
  };
  const endpoint = '/api/spotify/search?q=synthetic';
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const mutation = { ...cookie, 'X-RCRD-Request': '1' };
  assert.equal((await request(endpoint, { method: 'POST', headers: mutation })).status, 200);
  assert.equal((await request(endpoint, { headers: cookie })).status, 200);
  assert.equal(searches, 1);
  assert.equal((await request(endpoint, { method: 'POST', headers: cookie })).status, 403);
  assert.equal((await request(endpoint, { method: 'POST', headers: { 'X-RCRD-Request': '1' } })).status, 401);
  const refreshed = await request(endpoint, { method: 'POST', headers: mutation });
  assert.equal(refreshed.status, 200);
  assert.match(refreshed.body, /Synthetic result 2/);
  failSearch = true;
  assert.equal((await request(endpoint, { method: 'POST', headers: mutation })).status, 502);
  assert.match((await request(endpoint, { headers: cookie })).body, /Synthetic result 2/);
  assert.equal(searches, 3);
}));

test('album tracks require Spotify authorization and a bounded album ID and offset', () => fixture(async ({ request, state }) => {
  const id = 'A'.repeat(22);
  const path = `/api/spotify/albums/${id}/tracks`;
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  for (const invalid of ['/api/spotify/albums/bad/tracks', `/api/spotify/albums/${id}%2Fextra/tracks`, `${path}?offset=-1`, `${path}?offset=51`, `${path}?offset=1000`]) assert.equal((await request(invalid, { headers: cookie })).status, 400);
  assert.equal((await request(path)).status, 401);
  assert.equal(state.externalCalls, 0);
  let albumCalls = 0;
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/token') return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    assert.equal(parsed.pathname, `/v1/albums/${id}/tracks`);
    assert.equal(parsed.searchParams.get('limit'), '50');
    assert.equal(parsed.searchParams.get('offset'), '0');
    albumCalls++;
    return providerJson({ total: 1, items: [{ uri: 'spotify:track:synthetictrack', name: 'Synthetic song', track_number: 1 }] });
  };
  const first = await request(path, { headers: cookie });
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).items[0].name, 'Synthetic song');
  assert.equal((await request(path, { headers: cookie })).status, 200);
  assert.equal(albumCalls, 1, 'on-demand album tracks use the existing short-lived cache');
}));

test('simultaneous Spotify token consumers share one refresh and a failed refresh can retry', () => fixture(async ({ state, testSessions, testSpotifyAccess }) => {
  const session = testSessions.get(sessionId);
  let releaseRefresh;
  let refreshStarted;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  let tokenCalls = 0;
  state.providerFetch = async url => {
    if (new URL(url).pathname !== '/api/token') throw new Error('Unexpected provider endpoint');
    tokenCalls++;
    if (tokenCalls === 1) {
      refreshStarted();
      return new Promise(resolve => { releaseRefresh = resolve; });
    }
    return tokenCalls === 2 ? providerJson({ error: 'temporarily_unavailable' }, 503) : providerJson({ access_token: 'synthetic-recovered-access', expires_in: 3600 });
  };
  const first = testSpotifyAccess(session);
  const second = testSpotifyAccess(session);
  await started;
  assert.equal(tokenCalls, 1);
  releaseRefresh(providerJson({ access_token: 'synthetic-access', expires_in: 3600 }));
  assert.deepEqual(await Promise.all([first, second]), ['synthetic-access', 'synthetic-access']);
  assert.equal(session.spotify.refreshPromise, undefined);
  assert.equal(await testSpotifyAccess(session), 'synthetic-access');
  assert.equal(tokenCalls, 1);

  session.spotify.expiresAt = 0;
  await assert.rejects(testSpotifyAccess(session), /Spotify authorization request failed/);
  assert.equal(session.spotify.refreshPromise, undefined);
  assert.equal(await testSpotifyAccess(session), 'synthetic-recovered-access');
  assert.equal(tokenCalls, 3);
}));

test('player auth recovery refreshes a cached token with session and mutation checks', () => fixture(async ({ request, state }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const mutation = { ...cookie, 'X-RCRD-Request': '1' };
  let calls = 0;
  state.providerFetch = async url => {
    assert.equal(new URL(url).pathname, '/api/token');
    calls++;
    return providerJson({ access_token: `synthetic-access-${calls}`, expires_in: 3600 });
  };
  assert.equal(JSON.parse((await request('/api/spotify/token', { headers: cookie })).body).access_token, 'synthetic-access-1');
  assert.equal((await request('/api/spotify/token/refresh', { method: 'POST', headers: cookie })).status, 403);
  assert.equal((await request('/api/spotify/token/refresh', { method: 'POST', headers: { 'X-RCRD-Request': '1' } })).status, 401);
  assert.equal(calls, 1);
  const refreshed = await request('/api/spotify/token/refresh', { method: 'POST', headers: mutation });
  assert.equal(refreshed.status, 200);
  assert.deepEqual(JSON.parse(refreshed.body), { ok: true });
  assert.equal(JSON.parse((await request('/api/spotify/token', { headers: cookie })).body).access_token, 'synthetic-access-2');
  assert.equal(calls, 2);
}, { spotifyScope: 'streaming' }));

test('failed player auth recovery discards the rejected token for a later retry', () => fixture(async ({ request, state }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  let calls = 0;
  state.providerFetch = async url => {
    assert.equal(new URL(url).pathname, '/api/token');
    calls++;
    return calls === 2 ? providerJson({ error: 'temporarily_unavailable' }, 503) : providerJson({ access_token: `synthetic-access-${calls}`, expires_in: 3600 });
  };
  assert.equal(JSON.parse((await request('/api/spotify/token', { headers: cookie })).body).access_token, 'synthetic-access-1');
  const failed = await request('/api/spotify/token/refresh', { method: 'POST', headers: { ...cookie, 'X-RCRD-Request': '1' } });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(failed.body, /synthetic-access|temporarily_unavailable/);
  assert.equal(JSON.parse((await request('/api/spotify/token', { headers: cookie })).body).access_token, 'synthetic-access-3');
  assert.equal(calls, 3);
}, { spotifyScope: 'streaming' }));

test('an old Spotify refresh cannot overwrite or disconnect a newly connected account', () => fixture(async ({ state, testSessions, testSpotifyAccess }) => {
  const session = testSessions.get(sessionId);
  let releaseRefresh;
  let refreshStarted;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  let tokenCalls = 0;
  state.providerFetch = async url => {
    if (new URL(url).pathname !== '/api/token') throw new Error('Unexpected provider endpoint');
    tokenCalls++;
    if (tokenCalls === 1) {
      refreshStarted();
      return new Promise(resolve => { releaseRefresh = resolve; });
    }
    return providerJson({ access_token: 'synthetic-new-access', expires_in: 3600 });
  };
  const oldAccount = session.spotify;
  const pending = testSpotifyAccess(session);
  await started;
  const newAccount = { refreshToken: 'synthetic-new-refresh', userId: 'synthetic-new-user', scope: '' };
  session.spotify = newAccount;
  releaseRefresh(providerJson({ error: 'invalid_grant' }, 400));
  await assert.rejects(pending, /Spotify authorization request failed/);
  assert.equal(session.spotify, newAccount);
  assert.equal(oldAccount.refreshPromise, undefined);
  assert.equal(await testSpotifyAccess(session), 'synthetic-new-access');
  assert.equal(tokenCalls, 2);
}));

test('a successful old Spotify refresh is discarded after account replacement', () => fixture(async ({ state, testSessions, testSpotifyAccess }) => {
  const session = testSessions.get(sessionId);
  let releaseRefresh;
  let refreshStarted;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  state.providerFetch = async url => {
    if (new URL(url).pathname !== '/api/token') throw new Error('Unexpected provider endpoint');
    refreshStarted();
    return new Promise(resolve => { releaseRefresh = resolve; });
  };
  const oldAccount = session.spotify;
  const pending = testSpotifyAccess(session);
  await started;
  const newAccount = { refreshToken: 'synthetic-new-refresh', userId: 'synthetic-new-user', scope: '' };
  session.spotify = newAccount;
  releaseRefresh(providerJson({ access_token: 'synthetic-old-access', expires_in: 3600 }));
  await assert.rejects(pending, /Spotify account changed/);
  assert.equal(session.spotify, newAccount);
  assert.equal(oldAccount.refreshPromise, undefined);
  assert.equal(newAccount.accessToken, undefined);
}));

test('Spotify playlist preview returns one provider page and preserves full-cache completion', () => fixture(async ({ request, state, runtime }) => {
  const offsets = [];
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/token') return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname === '/v1/playlists/syntheticplaylist/items') {
      const offset = Number(parsed.searchParams.get('offset'));
      offsets.push(offset);
      const count = Math.min(50, 120 - offset);
      const items = Array.from({ length: count }, (_, index) => ({ item: { type: 'track', name: `Synthetic ${offset + index}` } }));
      return providerJson({ items, total: 120, next: offset + count < 120 ? 'synthetic-next' : null });
    }
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const endpoint = '/api/spotify/playlist?id=syntheticplaylist';
  const preview = await request(`${endpoint}&preview=1`, { headers: cookie });
  assert.equal(preview.status, 200);
  assert.equal(JSON.parse(preview.body).tracks.length, 50);
  assert.equal(JSON.parse(preview.body).total, 120);
  assert.deepEqual(offsets, [0]);
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const checkpoint = path.join(runtime, 'spotify-checkpoints', userKey, crypto.createHash('sha256').update('checkpoint:playlist:syntheticplaylist').digest('hex'));
  assert.equal(fs.existsSync(path.join(checkpoint, '0.json')), true);
  assert.equal(state.checkpointWrites.length, 1);

  const full = await request(endpoint, { headers: cookie });
  assert.equal(full.status, 200);
  assert.equal(JSON.parse(full.body).tracks.length, 120);
  assert.deepEqual(offsets, [0, 50, 100]);
  assert.equal(fs.existsSync(checkpoint), false);
  const diskCache = JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8'));
  assert.equal(diskCache.users[userKey]['playlist:syntheticplaylist'].value.length, 120);

  const warm = await request(`${endpoint}&preview=1`, { headers: cookie });
  assert.equal(warm.status, 200);
  assert.equal(JSON.parse(warm.body).tracks.length, 50);
  assert.equal(JSON.parse(warm.body).total, 120);
  assert.deepEqual(offsets, [0, 50, 100]);
}));

test('Spotify playlist preview uses a fresh persisted full cache without provider traffic', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const items = Array.from({ length: 70 }, (_, index) => ({ item: { type: 'track', name: `Cached ${index}` } }));
  const spotifyCacheUsers = { [userKey]: {
    profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user' } },
    'playlist:syntheticplaylist': { expiresAt: Date.now() + 3600000, value: items }
  } };
  return fixture(async ({ request, state }) => {
    const response = await request('/api/spotify/playlist?id=syntheticplaylist&preview=1', { headers: { Cookie: `rcrd_session=${sessionId}` } });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).tracks.length, 50);
    assert.equal(JSON.parse(response.body).total, 70);
    assert.equal(state.externalCalls, 0);
  }, { spotifyCacheUsers });
});

test('Spotify playlist preview reuses an in-flight full request before its first checkpoint', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const spotifyCacheUsers = { [userKey]: { profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user' } } } };
  return fixture(async ({ request, state, testSessions }) => {
    const spotify = testSessions.get(sessionId).spotify;
    const items = Array.from({ length: 70 }, (_, index) => ({ item: { type: 'track', name: `Pending ${index}` } }));
    spotify.cache.set('playlist:syntheticplaylist', { expiresAt: Date.now() + 3600000, promise: Promise.resolve(items) });
    const response = await request('/api/spotify/playlist?id=syntheticplaylist&preview=1', { headers: { Cookie: `rcrd_session=${sessionId}` } });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).tracks.length, 50);
    assert.equal(JSON.parse(response.body).total, 70);
    assert.equal(state.externalCalls, 0);
  }, { spotifyCacheUsers });
});

test('Spotify playlist preview handles empty playlists and filters non-track items', () => fixture(async ({ request, state }) => {
  let items = [];
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/token') return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname.startsWith('/v1/playlists/')) return providerJson({ items, total: items.length, next: null });
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const empty = await request('/api/spotify/playlist?id=empty&preview=1', { headers: cookie });
  assert.equal(empty.status, 200);
  assert.equal(JSON.parse(empty.body).total, 0);
  assert.deepEqual(JSON.parse(empty.body).tracks, []);
  const fullEmpty = await request('/api/spotify/playlist?id=empty', { headers: cookie });
  assert.equal(fullEmpty.status, 200);
  assert.deepEqual(JSON.parse(fullEmpty.body).tracks, []);

  items = [{ item: { type: 'track', name: 'Synthetic track' } }, { item: { type: 'episode', name: 'Synthetic episode' } }];
  const mixed = await request('/api/spotify/playlist?id=mixed&preview=1', { headers: cookie });
  assert.equal(mixed.status, 200);
  assert.equal(JSON.parse(mixed.body).total, 2);
  assert.deepEqual(JSON.parse(mixed.body).tracks.map(track => track.name), ['Synthetic track']);
}));

test('a complete cached playlist remains browsable with a stale label during a temporary outage', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  return fixture(async ({ request, state }) => {
    state.providerFetch = async url => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
      if (pathname === '/v1/playlists/playlist1/items') return { ok: false, status: 503, headers: { get: () => null }, text: async () => '{}' };
      throw new Error('Unexpected provider endpoint');
    };
    const cookie = { Cookie: `rcrd_session=${sessionId}` };
    const response = await request('/api/spotify/playlist?id=playlist1', { headers: cookie });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sync.source, 'stale-cache');
    assert.equal(body.tracks[0].name, 'Synthetic cached song');
  }, { spotifyCacheUsers: { [userKey]: {
    profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user' } },
    'playlist:playlist1': { expiresAt: Date.now() - 1000, value: [{ item: { type: 'track', name: 'Synthetic cached song' } }] }
  } } });
});

test('Spotify playlist preview rejects unauthorized, malformed and excessive data', () => fixture(async ({ request, state }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const endpoint = '/api/spotify/playlist?id=syntheticplaylist';
  assert.equal((await request(`${endpoint}&preview=1`)).status, 401);
  for (const suffix of ['preview=0', 'preview=true', 'preview=1&preview=1']) {
    assert.equal((await request(`${endpoint}&${suffix}`, { headers: cookie })).status, 400);
  }
  assert.equal((await request('/api/spotify/playlist?id=invalid-id&preview=1', { headers: cookie })).status, 400);
  assert.equal(state.externalCalls, 0);
  let invalidPage = { items: [], total: 100001, next: 'synthetic-next' };
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/token') return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname === '/v1/playlists/syntheticplaylist/items') return providerJson(invalidPage);
    throw new Error('Unexpected provider endpoint');
  };
  const invalid = await request(`${endpoint}&preview=1`, { headers: cookie });
  assert.equal(invalid.status, 502);
  assert.equal(state.checkpointWrites.length, 0);
  invalidPage = { items: {}, total: 1, next: null };
  assert.equal((await request(`${endpoint}&preview=1`, { headers: cookie })).status, 502);
  assert.equal(state.checkpointWrites.length, 0);
}));

test('playback 404 exposes only a sanitized recovery code', () => fixture(async ({ request, state }) => {
  state.providerFetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    assert.equal(pathname, '/v1/me/player/play');
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'synthetic-private-provider-text' } }) };
  };
  const response = await request('/api/spotify/playback', {
    method: 'POST',
    headers: { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', uri: 'spotify:track:synthetictrack', device_id: 'synthetic-device' })
  });
  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'Spotify request failed (HTTP 404).', code: 'SPOTIFY_NOT_FOUND' });
  assert.doesNotMatch(response.body, /synthetic-private-provider-text/);
}));

test('starting a selected track keeps its validated album or playlist context for Next', () => fixture(async ({ request, state }) => {
  const calls = [];
  state.providerFetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname !== '/v1/me/player/play') throw new Error('Unexpected provider endpoint');
    calls.push(JSON.parse(options.body));
    return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
  };
  const start = (uri, contextUri, uris) => request('/api/spotify/playback', {
    method: 'POST',
    headers: { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', uri, ...(contextUri ? { context_uri: contextUri } : {}), ...(uris === undefined ? {} : { uris }) })
  });
  assert.equal((await start('spotify:track:synthetictrack', 'spotify:playlist:syntheticplaylist')).status, 200);
  assert.equal((await start('spotify:track:synthetictrack', 'spotify:album:syntheticalbum')).status, 200);
  assert.equal((await start('spotify:track:synthetictrack')).status, 200);
  assert.equal((await start('spotify:track:synthetictrack', '', ['spotify:track:synthetictrack', 'spotify:track:nexttrack'])).status, 200);
  assert.deepEqual(calls, [
    { context_uri: 'spotify:playlist:syntheticplaylist', offset: { uri: 'spotify:track:synthetictrack' } },
    { context_uri: 'spotify:album:syntheticalbum', offset: { uri: 'spotify:track:synthetictrack' } },
    { uris: ['spotify:track:synthetictrack'] },
    { uris: ['spotify:track:synthetictrack', 'spotify:track:nexttrack'] }
  ]);
  assert.equal((await start('spotify:track:synthetictrack', 'spotify:artist:invalid')).status, 400);
  assert.equal((await start('spotify:album:syntheticalbum', 'spotify:playlist:syntheticplaylist')).status, 400);
  assert.equal((await start('spotify:track:synthetictrack', '', ['spotify:track:wrongfirst'])).status, 400);
  assert.equal((await start('spotify:track:synthetictrack', '', Array(101).fill('spotify:track:synthetictrack'))).status, 400);
  assert.equal((await start('spotify:track:synthetictrack', 'spotify:album:syntheticalbum', ['spotify:track:synthetictrack'])).status, 400);
  assert.equal(calls.length, 4, 'invalid contexts and sequences never reach Spotify');
}));

test('100-song playback forwards the complete sequence, bounds size, and preserves intentional playlist repeats', () => fixture(async ({ request, state }) => {
  const calls = [];
  state.providerFetch = async (url, options) => {
    if (new URL(url).pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    assert.equal(new URL(url).pathname, '/v1/me/player/play'); calls.push(JSON.parse(options.body));
    return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
  };
  const uris = Array.from({ length: 100 }, (_, i) => `spotify:track:${String(i + 1).padStart(22, '0')}`);
  const start = sequence => request('/api/spotify/playback', { method: 'POST', headers: { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', uri: uris[0], uris: sequence }) });
  assert.equal((await start(uris)).status, 200); assert.deepEqual(calls, [{ uris }]);
  assert.equal((await start([...uris, 'spotify:track:oversized'])).status, 400);
  assert.equal((await start([uris[0], uris[0]])).status, 200); assert.deepEqual(calls[1], { uris: [uris[0], uris[0]] }); assert.equal(calls.length, 2);
}));

const mixSeedId = '1'.padStart(22, '0');
const mixSeed = { uri: `spotify:track:${mixSeedId}`, name: 'Synthetic seed', type: 'track', artists: [{ id: '2'.padStart(22, '0'), name: 'Synthetic artist' }] };
function installMixProvider(state, override = () => undefined) {
  state.providerFetch = async (url, options) => {
    const parsed = new URL(url); const custom = await override(parsed, options); if (custom !== undefined) return custom;
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname === `/v1/tracks/${mixSeedId}`) return providerJson(mixSeed);
    if (parsed.pathname === '/v1/me/playlists') return providerJson({ items: [{ id: 'P'.repeat(22), owner: { id: 'synthetic-user' } }, { id: 'X'.repeat(22), owner: { id: 'other-user' } }], total: 2, next: null });
    if (parsed.pathname === `/v1/playlists/${'P'.repeat(22)}/items`) return providerJson({ items: [{ item: mixSeed }], total: 1, next: null });
    if (parsed.pathname === '/v1/me/tracks') return providerJson({ items: [{ track: mixSeed }], total: 1, next: null });
    throw new Error('Unexpected Mix provider endpoint');
  };
}
function installPublicMixProvider(state, conflict = false) {
  const id = n => String(n).padStart(22, '0'); const mbid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const calls = []; const related = Array.from({ length: 15 }, (_, i) => ({ id: id(i + 10), mbid: mbid(i + 10), name: `Related Artist ${i}` }));
  installMixProvider(state, (parsed, options) => {
    calls.push({ url: parsed, headers: options.headers });
    if (parsed.hostname === 'musicbrainz.org' || parsed.hostname === 'api.listenbrainz.org') {
      assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined); assert.equal(options.redirect, 'error'); assert.match(options.headers['User-Agent'], /support\.example\.org/);
      assert.doesNotMatch(parsed.href, /synthetic-user|synthetic-refresh|history|playlist/);
    }
    if (parsed.hostname === 'musicbrainz.org') {
      const resources = parsed.searchParams.getAll('resource');
      const row = resource => { const artist = related.find(value => resource.endsWith(value.id)); return { resource, relations: [{ 'target-type': 'artist', artist: { id: artist?.mbid || mbid(1) } }, ...(conflict && artist === related[0] ? [{ 'target-type': 'artist', artist: { id: mbid(999) } }] : [])] }; };
      return providerJson(resources.length === 1 ? row(resources[0]) : { urls: resources.map(row).reverse() });
    }
    if (parsed.hostname === 'api.listenbrainz.org') return providerJson(Object.fromEntries(related.map(artist => [artist.mbid, [{ recording_mbid: mbid(artist.id), similar_artist_mbid: artist.mbid, similar_artist_name: artist.name, total_listen_count: 100 }]])));
    if (parsed.hostname === 'api.discogs.com') return providerJson({ results: [] });
    if (parsed.pathname === '/v1/search') {
      const name = /^artist:"([^"]+)"$/.exec(parsed.searchParams.get('q'))?.[1]; const artist = related.find(value => value.name === name); assert.ok(artist);
      return providerJson({ tracks: { items: Array.from({ length: 10 }, (_, i) => ({ type: 'track', uri: `spotify:track:${id(10000 + Number(artist.id) * 10 + i)}`, name: `Song ${i}`, artists: [{ id: artist.id, name }], album: { id: id(20000 + Number(artist.id) * 10 + i), name: `Album ${i}` }, is_playable: true })) } });
    }
  });
  return { calls, related };
}
test('account-free discovery verifies public artist identities, retrieves beyond playlists, and caches completed sources', () => fixture(async ({ request, state }) => {
  const { calls } = installPublicMixProvider(state); const headers = { Cookie: `rcrd_session=${sessionId}` }; const endpoint = `/api/spotify/mix-sources?uri=${mixSeed.uri}`;
  const response = await request(endpoint, { headers }); assert.equal(response.status, 200); const data = JSON.parse(response.body);
  assert.equal(data.discoveryArtists.length, 15); assert.equal(data.discoveryTracks.length, 150); assert.equal(data.playlists.length, 0); assert.ok(!calls.some(call => ['/v1/me/playlists', '/v1/me/tracks'].includes(call.url.pathname)));
  assert.ok(data.discoveryArtists.every(artist => artist.source === 'listenbrainz')); assert.doesNotMatch(response.body, /synthetic-access|synthetic-refresh/);
  const before = calls.length; assert.equal((await request(endpoint, { headers })).status, 200); assert.equal(calls.length - before, 1, 'warm discovery refreshes only seed metadata');
}, { metadataContact: 'https://support.example.org/rcrd' }));
test('public discovery refuses conflicting artist identities instead of trusting an identical name', () => fixture(async ({ request, state }) => {
  const { related } = installPublicMixProvider(state, true);
  const response = await request(`/api/spotify/mix-sources?uri=${mixSeed.uri}`, { headers: { Cookie: `rcrd_session=${sessionId}` } }); assert.equal(response.status, 200);
  const data = JSON.parse(response.body); assert.equal(data.discoveryArtists.length, 14); assert.equal(data.discoveryTracks.length, 140); assert.ok(!data.discoveryArtists.some(artist => artist.id === related[0].id));
}, { metadataContact: 'https://support.example.org/rcrd' }));
test('Discogs discovery needs no new account and matches artist, album, specific style and genre', () => fixture(async ({ request, state }) => {
  const id = n => String(n).padStart(22, '0'); let publicCalls = 0;
  installMixProvider(state, (parsed, options) => {
    if (['musicbrainz.org', 'api.listenbrainz.org'].includes(parsed.hostname)) { publicCalls++; throw new Error('No contact configured; public metadata request forbidden'); }
    if (parsed.pathname === `/v1/tracks/${mixSeedId}`) return providerJson({ ...mixSeed, album: { id: id(9), name: 'Seed record' } });
    if (parsed.hostname === 'api.discogs.com') {
      assert.match(options.headers.Authorization, /^Discogs key=/); assert.doesNotMatch(options.headers.Authorization, /synthetic-access|synthetic-refresh/);
      if (parsed.searchParams.has('artist')) return providerJson({ results: [{ title: 'Synthetic artist - Seed record', genre: ['Rock'], style: ['Hardcore'] }] });
      return providerJson({ results: [{ title: 'Wrong Genre - Wrong album', genre: ['Electronic'], style: ['Hardcore'] }, ...Array.from({ length: 30 }, (_, i) => ({ title: `Band ${i} - Record ${i}`, genre: ['Rock'], style: ['Hardcore'] }))] });
    }
    if (parsed.pathname === '/v1/search') {
      const match = /^artist:"Band (\d+)" album:"Record (\d+)"$/.exec(parsed.searchParams.get('q')); assert.ok(match); const n = Number(match[1]);
      return providerJson({ tracks: { items: Array.from({ length: 10 }, (_, i) => ({ type: 'track', uri: `spotify:track:${id(1000 + n * 10 + i)}`, name: `Track ${n}-${i}`, artists: [{ id: id(100 + n), name: `Band ${n}` }], album: { id: id(500 + n), name: `Record ${n}` }, is_playable: true })) } });
    }
  });
  const response = await request(`/api/spotify/mix-sources?uri=${mixSeed.uri}`, { headers: { Cookie: `rcrd_session=${sessionId}` } }); assert.equal(response.status, 200);
  const data = JSON.parse(response.body); assert.equal(publicCalls, 0); assert.equal(data.discoveryArtists.length, 30); assert.equal(data.discoveryTracks.length, 300); assert.ok(data.discoveryArtists.every(artist => artist.source === 'discogs-style' && artist.style === 'Hardcore'));
  assert.ok(data.discoveryWarnings.includes('metadata-contact-required'));
}));
test('Mix sources require authentication and a valid seed; scope and private-source responses stay local', () => fixture(async ({ request, state }) => {
  installMixProvider(state); const endpoint = `/api/spotify/mix-sources?uri=${mixSeed.uri}`;
  assert.equal((await request(endpoint)).status, 401);
  const headers = { Cookie: `rcrd_session=${sessionId}` };
  assert.equal((await request('/api/spotify/mix-sources?uri=bad', { headers })).status, 400); assert.equal(state.externalCalls, 0);
  const response = await request(endpoint, { headers }); assert.equal(response.status, 200);
  const data = JSON.parse(response.body); assert.equal(data.seed.uri, mixSeed.uri); assert.equal(data.playlists.length, 1); assert.equal(data.savedTracks[0].uri, mixSeed.uri);
  assert.doesNotMatch(response.body, /synthetic-access|synthetic-refresh|other-user/);
}));
test('Mix sources bound pagination, disclose truncation on cached retries, and only read owned/collaborative playlists', () => fixture(async ({ request, state }) => {
  const calls = [];
  installMixProvider(state, parsed => {
    calls.push(parsed.pathname + parsed.search);
    if (parsed.pathname === `/v1/playlists/${'P'.repeat(22)}/items`) return providerJson({ items: Array.from({ length: 50 }, () => ({ track: mixSeed })), total: 10000, next: 'not-followed-as-a-url' });
  });
  const headers = { Cookie: `rcrd_session=${sessionId}` }; const endpoint = `/api/spotify/mix-sources?uri=${mixSeed.uri}`;
  const first = JSON.parse((await request(endpoint, { headers })).body); assert.equal(first.partial, true); assert.equal(first.playlists[0].tracks.length, 200);
  assert.equal(calls.filter(call => call.startsWith(`/v1/playlists/${'P'.repeat(22)}/items`)).length, 4);
  assert.ok(!calls.some(call => call.includes('X'.repeat(22))));
  const previous = calls.length; const second = JSON.parse((await request(endpoint, { headers })).body); assert.equal(second.partial, true);
  assert.equal(calls.length - previous, 1, 'only seed metadata is refreshed; source pages use caches');
}));
test('Mix source scans stop at eight playlists and omit unnecessary provider metadata', () => fixture(async ({ request, state }) => {
  let pages = 0;
  installMixProvider(state, parsed => {
    if (parsed.pathname === '/v1/me/playlists') return providerJson({ items: Array.from({ length: 12 }, (_, i) => ({ id: String(i + 10).padStart(22, '0'), owner: { id: 'synthetic-user' } })), total: 12, next: null });
    if (/^\/v1\/playlists\//.test(parsed.pathname)) { pages++; return providerJson({ items: [{ item: { ...mixSeed, unnecessaryField: 'must-not-be-forwarded' } }], total: 1, next: null }); }
  });
  const response = await request(`/api/spotify/mix-sources?uri=${mixSeed.uri}`, { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 200); const data = JSON.parse(response.body); assert.equal(data.playlists.length, 8); assert.equal(pages, 8); assert.equal(data.partial, true); assert.doesNotMatch(response.body, /must-not-be-forwarded/);
}));
test('known cached seed playlists are prioritized ahead of cold unrelated playlists', () => fixture(async ({ request, state, testSessions }) => {
  const wanted = String(21).padStart(22, '0');
  testSessions.get(sessionId).spotify.cache = new Map([[`playlist:${wanted}`, { expiresAt: Date.now() + 60000, value: [{ item: mixSeed }] }]]);
  installMixProvider(state, parsed => {
    if (parsed.pathname === '/v1/me/playlists') return providerJson({ items: Array.from({ length: 12 }, (_, i) => ({ id: String(i + 10).padStart(22, '0'), owner: { id: 'synthetic-user' } })), total: 12, next: null });
    if (/^\/v1\/playlists\//.test(parsed.pathname)) return providerJson({ items: [], total: 0, next: null });
  });
  const response = await request(`/api/spotify/mix-sources?uri=${mixSeed.uri}`, { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 200); const data = JSON.parse(response.body); assert.equal(data.playlists[0].id, wanted); assert.equal(data.playlists[0].tracks[0].uri, mixSeed.uri);
}));
test('overlapping Mix scans fail visibly instead of duplicating provider work', () => fixture(async ({ request, state }) => {
  let release; let reached; const started = new Promise(resolve => reached = resolve);
  installMixProvider(state, parsed => { if (parsed.pathname === '/v1/me/playlists') { reached(); return new Promise(resolve => release = () => resolve(providerJson({ items: [], total: 0, next: null }))); } });
  const endpoint = `/api/spotify/mix-sources?uri=${mixSeed.uri}`; const headers = { Cookie: `rcrd_session=${sessionId}` };
  const first = request(endpoint, { headers }); await started;
  try { const second = await request(endpoint, { headers }); assert.equal(second.status, 409); assert.match(second.body, /already running/); }
  finally { release(); }
  assert.equal((await first).status, 200);
}));
test('Mix sources stop on account changes and cannot return previous account data', () => fixture(async ({ request, state, testSessions }) => {
  installMixProvider(state, parsed => { if (parsed.pathname === '/v1/me/playlists') { testSessions.get(sessionId).spotify = null; return providerJson({ items: [], total: 0, next: null }); } });
  const response = await request(`/api/spotify/mix-sources?uri=${mixSeed.uri}`, { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 409); assert.doesNotMatch(response.body, /Synthetic seed/);
}));
test('Mix sources reject malformed pages and preserve provider throttling', () => fixture(async ({ request, state }) => {
  installMixProvider(state, parsed => parsed.pathname === '/v1/me/playlists' ? providerJson({ items: {}, total: 1 }) : undefined);
  const endpoint = `/api/spotify/mix-sources?uri=${mixSeed.uri}`; const headers = { Cookie: `rcrd_session=${sessionId}` };
  assert.equal((await request(endpoint, { headers })).status, 502);
  installMixProvider(state, parsed => parsed.pathname === '/v1/me/playlists' ? { ok: false, status: 429, headers: { get: name => name.toLowerCase() === 'retry-after' ? '3' : null }, text: async () => '{}' } : undefined);
  const response = await request(endpoint, { headers }); assert.equal(response.status, 429); assert.equal(response.headers['retry-after'], '3');
}));

test('Spotify repeat forwards valid modes, accepts 204, and reports provider failure', () => fixture(async ({ request, state }) => {
  const calls = [];
  let providerStatus = 204;
  state.providerFetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname !== '/v1/me/player/repeat') throw new Error('Unexpected provider endpoint');
    calls.push({ method: options.method, pathname: parsed.pathname, mode: parsed.searchParams.get('state'), deviceId: parsed.searchParams.get('device_id') });
    return {
      ok: providerStatus === 204,
      status: providerStatus,
      headers: { get: () => null },
      text: async () => providerStatus === 204 ? '' : JSON.stringify({ error: { status: providerStatus, message: 'Synthetic denial' } })
    };
  };
  const headers = { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' };
  const repeat = (mode, deviceId) => request('/api/spotify/playback', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'repeat', state: mode, ...(deviceId ? { device_id: deviceId } : {}) })
  });

  for (const [mode, deviceId] of [['off', null], ['context', 'synthetic-device'], ['track', null]]) {
    const response = await repeat(mode, deviceId);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
  }
  assert.deepEqual(calls, [
    { method: 'PUT', pathname: '/v1/me/player/repeat', mode: 'off', deviceId: null },
    { method: 'PUT', pathname: '/v1/me/player/repeat', mode: 'context', deviceId: 'synthetic-device' },
    { method: 'PUT', pathname: '/v1/me/player/repeat', mode: 'track', deviceId: null }
  ]);

  const callsBeforeInvalid = state.externalCalls;
  const invalid = await repeat('invalid');
  assert.equal(invalid.status, 400);
  assert.equal(state.externalCalls, callsBeforeInvalid);
  assert.equal(calls.length, 3);

  providerStatus = 403;
  const denied = await repeat('track');
  assert.equal(denied.status, 403);
  assert.equal(JSON.parse(denied.body).ok, undefined);
  assert.match(JSON.parse(denied.body).error, /Spotify request failed/);
  assert.equal(calls.length, 4);
}));

test('Spotify authorization requests and persists library-modify scope; old sessions require reconnect', () => fixture(async ({ request, state, runtime, key }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const statusBefore = JSON.parse((await request('/api/spotify/status', { headers: cookie })).body);
  assert.equal(statusBefore.connected, true);
  assert.equal(statusBefore.canStream, false);
  assert.equal(statusBefore.canModifyLibrary, false);
  const playbackToken = await request('/api/spotify/token', { headers: cookie });
  assert.equal(playbackToken.status, 403);
  assert.match(JSON.parse(playbackToken.body).error, /playback permission is missing/);
  const denied = await request('/api/spotify/liked', { method: 'PUT', headers: { ...cookie, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ uri: 'spotify:track:synthetic1', saved: true }) });
  assert.equal(denied.status, 403);
  assert.match(JSON.parse(denied.body).error, /Reconnect Spotify/);
  assert.equal(state.externalCalls, 0);

  const start = await request('/auth/spotify/start', { headers: cookie });
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.location);
  assert.ok(authorize.searchParams.get('scope').split(' ').includes('user-library-modify'));
  assert.ok(authorize.searchParams.get('scope').split(' ').includes('streaming'));
  assert.ok(!authorize.searchParams.get('scope').split(' ').includes('user-read-email'));
  assert.equal(authorize.searchParams.get('show_dialog'), 'true');
  state.providerFetch = async url => {
    if (!new URL(url).pathname.endsWith('/api/token')) throw new Error('Unexpected provider endpoint');
    return providerJson({ access_token: 'synthetic-access', refresh_token: 'synthetic-new-refresh', expires_in: 3600, scope: 'user-library-read user-library-modify' });
  };
  const callback = await request(`/auth/spotify/callback?state=${encodeURIComponent(authorize.searchParams.get('state'))}&code=synthetic-code`, { headers: cookie });
  assert.equal(callback.status, 302);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).canModifyLibrary, true);
  const payload = JSON.parse(fs.readFileSync(path.join(runtime, 'oauth-sessions.enc'), 'utf8'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const saved = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  assert.equal(saved.sessions[sessionId].spotify.scope, 'user-library-read user-library-modify');
}));

test('Spotify profile response and persistent cache contain only UI fields', () => fixture(async ({ request, state, runtime }) => {
  state.providerFetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/token') return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (pathname === '/v1/me') return providerJson({ id: 'synthetic-user', display_name: 'Synthetic Listener', email: 'synthetic@example.invalid', product: 'premium', country: 'US', images: [{ url: 'https://image.example.invalid/profile' }], followers: { total: 12, href: 'https://private.example.invalid' } });
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const response = await request('/api/spotify/me', { headers: cookie });
  assert.equal(response.status, 200);
  const expected = { id: 'synthetic-user', display_name: 'Synthetic Listener', images: [{ url: 'https://image.example.invalid/profile' }], followers: { total: 12 } };
  assert.deepEqual(JSON.parse(response.body), expected);
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const disk = JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8'));
  assert.deepEqual(disk.users[userKey].profile.value, expected);
  assert.doesNotMatch(response.body, /synthetic@example|premium|country/);
  assert.doesNotMatch(JSON.stringify(disk), /synthetic@example|premium|country/);
  assert.equal((await request('/api/spotify/me', { headers: cookie })).status, 200);
  assert.equal(state.externalCalls, 2);
}));

test('legacy full-profile cache is removed without clearing saved library data', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const spotifyCacheUsers = { [userKey]: {
    profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user', email: 'synthetic@example.invalid' } },
    library: { expiresAt: Date.now() + 3600000, value: { saved: [], savedAlbums: [], recentlyPlayed: [] } }
  } };
  return fixture(async ({ runtime }) => {
    const disk = JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8'));
    assert.equal(disk.version, 2);
    assert.equal(disk.users[userKey].profile, undefined);
    assert.ok(disk.users[userKey].library);
    assert.doesNotMatch(JSON.stringify(disk), /synthetic@example/);
  }, { spotifyCacheUsers, spotifyCacheVersion: 1 });
});

test('a newer cached profile with extra provider fields is minimized before use', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const spotifyCacheUsers = { [userKey]: {
    profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user', display_name: 'Synthetic Listener', email: 'synthetic@example.invalid' } }
  } };
  return fixture(async ({ request, runtime, state }) => {
    const response = await request('/api/spotify/me', { headers: { Cookie: `rcrd_session=${sessionId}` } });
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body, /synthetic@example/);
    const disk = JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8'));
    assert.doesNotMatch(JSON.stringify(disk), /synthetic@example/);
    assert.equal(state.externalCalls, 0);
  }, { spotifyCacheUsers });
});

test('signing out either service invalidates pending authorization without affecting another session', () => fixture(async ({ request, state, runtime, testSessions }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const mutation = { ...cookie, 'X-RCRD-Request': '1' };
  assert.equal((await request('/api/spotify/disconnect', { method: 'POST', headers: { 'X-RCRD-Request': '1' } })).status, 200);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).connected, true);

  const spotifyStart = await request('/auth/spotify/start', { headers: cookie });
  const spotifyState = new URL(spotifyStart.headers.location).searchParams.get('state');
  state.failPersistence = true;
  assert.equal((await request('/api/spotify/disconnect', { method: 'POST', headers: mutation })).status, 500);
  assert.equal(testSessions.get(sessionId).spotifyState, spotifyState);
  state.failPersistence = false;
  assert.equal((await request('/api/spotify/disconnect', { method: 'POST', headers: mutation })).status, 200);
  assert.equal(testSessions.get(sessionId).spotifyState, undefined);
  assert.equal((await request(`/auth/spotify/callback?state=${encodeURIComponent(spotifyState)}&code=synthetic-code`, { headers: cookie })).status, 400);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).connected, false);
  assert.equal(state.externalCalls, 0);

  state.providerFetch = async url => {
    if (!new URL(url).pathname.endsWith('/oauth/request_token')) throw new Error('Unexpected provider endpoint');
    return { ok: true, status: 200, text: async () => 'oauth_token=synthetic-pending-token&oauth_token_secret=synthetic-pending-secret' };
  };
  const discogsStart = await request('/auth/discogs/start', { headers: cookie });
  assert.equal(discogsStart.status, 302);
  assert.equal((await request('/api/discogs/disconnect', { method: 'POST', headers: { 'X-RCRD-Request': '1' } })).status, 200);
  assert.equal(JSON.parse((await request('/api/session', { headers: cookie })).body).connected, true);
  state.failPersistence = true;
  assert.equal((await request('/api/discogs/disconnect', { method: 'POST', headers: mutation })).status, 500);
  assert.equal(testSessions.get(sessionId).requestToken, 'synthetic-pending-token');
  state.failPersistence = false;
  assert.equal((await request('/api/discogs/disconnect', { method: 'POST', headers: mutation })).status, 200);
  assert.equal(testSessions.get(sessionId).requestToken, undefined);
  assert.equal((await request('/auth/discogs/callback?oauth_token=synthetic-pending-token&oauth_verifier=synthetic-verifier', { headers: cookie })).status, 400);
  assert.equal(JSON.parse((await request('/api/session', { headers: cookie })).body).connected, false);
  assert.equal(state.externalCalls, 1);
  assert.equal(fs.existsSync(path.join(runtime, 'oauth-sessions.enc')), false);
}));

test('Spotify refresh updates reported permissions only when a new scope is returned', () => fixture(async ({ request, state, testSessions }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  let tokenScope;
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600, ...(tokenScope ? { scope: tokenScope } : {}) });
    throw new Error('Unexpected provider endpoint');
  };
  assert.equal((await request('/api/spotify/token', { headers: cookie })).status, 200);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).canModifyLibrary, false);
  tokenScope = 'streaming user-library-read user-library-modify';
  testSessions.get(sessionId).spotify.expiresAt = 0;
  assert.equal((await request('/api/spotify/token', { headers: cookie })).status, 200);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).canModifyLibrary, true);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).canStream, true);
  assert.equal(state.externalCalls, 2);
}, { spotifyScope: 'streaming' }));

test('Spotify player token is withheld when a refresh removes playback permission', () => fixture(async ({ request, state, testSessions }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  state.providerFetch = async url => {
    if (new URL(url).pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600, scope: 'user-library-read' });
    throw new Error('Unexpected provider endpoint');
  };
  testSessions.get(sessionId).spotify.expiresAt = 0;
  const token = await request('/api/spotify/token', { headers: cookie });
  assert.equal(token.status, 403);
  assert.match(JSON.parse(token.body).error, /playback permission is missing/);
  assert.doesNotMatch(token.body, /synthetic-access/);
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).canStream, false);
  assert.equal(state.externalCalls, 1);
}, { spotifyScope: 'streaming' }));

test('Spotify liked-track status and save/unsave use current library endpoints', () => fixture(async ({ request, state }) => {
  const calls = [];
  state.providerFetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    calls.push({ method: options.method || 'GET', path: parsed.pathname, uris: parsed.searchParams.get('uris') });
    if (parsed.pathname === '/v1/me/library/contains') return providerJson([true]);
    if (parsed.pathname === '/v1/me/library') return providerJson({}, 200);
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const headers = { ...cookie, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' };
  const uri = 'spotify:track:synthetic1';
  const status = await request(`/api/spotify/liked?uri=${encodeURIComponent(uri)}`, { headers: cookie });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { saved: true });
  for (const saved of [true, false]) {
    const result = await request('/api/spotify/liked', { method: 'PUT', headers, body: JSON.stringify({ uri, saved }) });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true, saved });
  }
  assert.deepEqual(calls, [
    { method: 'GET', path: '/v1/me/library/contains', uris: uri },
    { method: 'PUT', path: '/v1/me/library', uris: uri },
    { method: 'DELETE', path: '/v1/me/library', uris: uri }
  ]);
}, { spotifyScope: 'user-library-read user-library-modify' }));

test('Spotify liked-track batch status is bounded, account-scoped and validates provider results', () => fixture(async ({ request, state }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const uris = Array.from({ length: 40 }, (_, index) => `spotify:track:synthetic${index}`);
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    assert.equal(parsed.pathname, '/v1/me/library/contains');
    assert.deepEqual(parsed.searchParams.get('uris').split(','), uris);
    return providerJson(uris.map((_, index) => index === 0));
  };
  const endpoint = `/api/spotify/liked?uris=${encodeURIComponent(uris.join(','))}`;
  assert.equal((await request(endpoint)).status, 401);
  const result = await request(endpoint, { headers: cookie });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body).saved, uris.map((_, index) => index === 0));
  const calls = state.externalCalls;
  for (const invalid of [[], [...uris, 'spotify:track:extra'], ['spotify:album:wrong'], ['spotify:track:valid', 'bad']]) {
    const response = await request(`/api/spotify/liked?uris=${encodeURIComponent(invalid.join(','))}`, { headers: cookie });
    assert.equal(response.status, 400);
  }
  assert.equal((await request(`${endpoint}&uri=spotify%3Atrack%3Aextra`, { headers: cookie })).status, 400);
  assert.equal(state.externalCalls, calls);
  state.providerFetch = async () => providerJson([true]);
  assert.equal((await request(endpoint, { headers: cookie })).status, 502);
}, { spotifyScope: 'user-library-read user-library-modify' }));

test('Spotify liked-track writes reject missing auth, unsafe requests and invalid state before provider calls', () => fixture(async ({ request, state, port }) => {
  const uri = 'spotify:track:synthetic1';
  const body = JSON.stringify({ uri, saved: true });
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const safe = { ...cookie, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' };
  assert.equal((await request('/api/spotify/liked', { method: 'PUT', headers: { 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body })).status, 401);
  assert.equal((await request(`/api/spotify/liked?uri=${encodeURIComponent(uri)}`)).status, 401);
  assert.equal((await request('/api/spotify/liked', { method: 'PUT', headers: cookie, body })).status, 403);
  assert.equal((await request('/api/spotify/liked', { method: 'PUT', headers: { ...safe, Origin: 'https://untrusted.invalid' }, body })).status, 403);
  assert.equal((await request('/api/spotify/liked', { method: 'PUT', headers: { ...safe, Origin: `http://127.0.0.1:${port}` }, body: '{' })).status, 400);
  for (const invalid of [
    { uri: 'spotify:album:synthetic1', saved: true },
    { uri: 'spotify:track:synthetic1?other=1', saved: true },
    { uri, saved: 'true' },
    { uri, saved: null }
  ]) assert.equal((await request('/api/spotify/liked', { method: 'PUT', headers: safe, body: JSON.stringify(invalid) })).status, 400);
  assert.equal((await request('/api/spotify/liked?uri=spotify%3Aalbum%3Asynthetic1', { headers: cookie })).status, 400);
  assert.equal(state.externalCalls, 0);
}, { spotifyScope: 'user-library-read user-library-modify' }));

test('Spotify liked-track status rejects malformed provider data and preserves provider failures and cooldown', () => fixture(async ({ request, state }) => {
  let mode = 'invalid';
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (mode === 'invalid') return providerJson({ private: 'synthetic-provider-data' });
    if (mode === 'forbidden') return providerJson({ error: { status: 403, message: 'Synthetic denial' } }, 403);
    return { ok: false, status: 429, headers: { get: name => name === 'retry-after' ? '4' : null }, text: async () => JSON.stringify({ error: { status: 429, reason: 'RATE_LIMITED' } }) };
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const endpoint = '/api/spotify/liked?uri=spotify%3Atrack%3Asynthetic1';
  const malformed = await request(endpoint, { headers: cookie });
  assert.equal(malformed.status, 502);
  assert.doesNotMatch(malformed.body, /synthetic-provider-data/);
  mode = 'forbidden';
  assert.equal((await request(endpoint, { headers: cookie })).status, 403);
  mode = 'limited';
  const limited = await request(endpoint, { headers: cookie });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '4');
  const calls = state.externalCalls;
  assert.equal((await request(endpoint, { headers: cookie })).status, 429);
  assert.equal(state.externalCalls, calls);
}, { spotifyScope: 'user-library-read user-library-modify' }));

test('Spotify liked-track mutation reports provider refusal and rate-limit without claiming a save', () => fixture(async ({ request, state }) => {
  let status = 403;
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname !== '/v1/me/library') throw new Error('Unexpected provider endpoint');
    return { ok: false, status, headers: { get: name => name === 'retry-after' && status === 429 ? '3' : null }, text: async () => JSON.stringify({ error: { status, message: 'Synthetic denial' } }) };
  };
  const headers = { Cookie: `rcrd_session=${sessionId}`, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' };
  const put = () => request('/api/spotify/liked', { method: 'PUT', headers, body: JSON.stringify({ uri: 'spotify:track:synthetic1', saved: true }) });
  const forbidden = await put();
  assert.equal(forbidden.status, 403);
  assert.equal(JSON.parse(forbidden.body).ok, undefined);
  status = 429;
  const limited = await put();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '3');
  const calls = state.externalCalls;
  assert.equal((await put()).status, 429);
  assert.equal(state.externalCalls, calls);
}, { spotifyScope: 'user-library-read user-library-modify' }));

test('a rejected liked-track write preserves a valid cached library and checkpoint', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const oldLibrary = { saved: [{ track: { id: 'synthetic1', name: 'Still saved' } }], savedAlbums: [], recentlyPlayed: [] };
  const spotifyCacheUsers = { [userKey]: {
    profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user' } },
    library: { expiresAt: Date.now() + 3600000, value: oldLibrary }
  } };
  return fixture(async ({ request, state, runtime }) => {
    state.providerFetch = async url => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
      if (parsed.pathname === '/v1/me/library') return { ok: false, status: 429, headers: { get: name => name === 'retry-after' ? '5' : null }, text: async () => JSON.stringify({ error: { status: 429 } }) };
      throw new Error('Unexpected provider endpoint');
    };
    const checkpoint = path.join(runtime, 'spotify-checkpoints', userKey, crypto.createHash('sha256').update('checkpoint:library-tracks').digest('hex'));
    fs.mkdirSync(checkpoint, { recursive: true });
    fs.writeFileSync(path.join(checkpoint, '0.json'), JSON.stringify({ expiresAt: Date.now() + 3600000, offset: 0, items: [], total: 0, complete: true }));
    const cookie = { Cookie: `rcrd_session=${sessionId}` };
    const limited = await request('/api/spotify/liked', { method: 'PUT', headers: { ...cookie, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ uri: 'spotify:track:synthetic1', saved: false }) });
    assert.equal(limited.status, 429);
    assert.equal(fs.existsSync(checkpoint), true);
    assert.ok(JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8')).users[userKey].library);
    const cached = await request('/api/spotify/library', { headers: cookie });
    assert.equal(cached.status, 200);
    assert.equal(JSON.parse(cached.body).saved[0].track.name, 'Still saved');
    assert.equal(state.externalCalls, 2);
  }, { spotifyCacheUsers, spotifyScope: 'user-library-read user-library-modify' });
});

test('confirmed save remains acknowledged when cache cleanup fails and dirty reads bypass stale disk data', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const spotifyCacheUsers = { [userKey]: {
    profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user' } },
    recent: { expiresAt: Date.now() + 3600000, value: { items: [] } },
    library: { expiresAt: Date.now() + 3600000, value: { saved: [{ track: { id: 'synthetic1', name: 'Stale saved track' } }], savedAlbums: [], recentlyPlayed: [] } }
  } };
  return fixture(async ({ request, state, runtime, key, testSessions }) => {
    const providerPaths = [];
    state.providerFetch = async url => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
      providerPaths.push(parsed.pathname);
      if (parsed.pathname === '/v1/me/library') return providerJson({});
      if (parsed.pathname === '/v1/me/tracks' || parsed.pathname === '/v1/me/albums') return providerJson({ items: [], total: 0, next: null });
      throw new Error('Unexpected provider endpoint');
    };
    const checkpoint = path.join(runtime, 'spotify-checkpoints', userKey, crypto.createHash('sha256').update('checkpoint:library-tracks').digest('hex'));
    fs.mkdirSync(checkpoint, { recursive: true });
    fs.writeFileSync(path.join(checkpoint, '0.json'), JSON.stringify({ expiresAt: Date.now() + 3600000, offset: 0, items: [{ track: { id: 'synthetic1' } }], total: 1, complete: true }));
    state.failSpotifyCacheWrite = true;
    const cookie = { Cookie: `rcrd_session=${sessionId}` };
    const saved = await request('/api/spotify/liked', { method: 'PUT', headers: { ...cookie, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ uri: 'spotify:track:synthetic1', saved: false }) });
    assert.equal(saved.status, 200);
    assert.equal(JSON.parse(saved.body).saved, false);
    assert.match(JSON.parse(saved.body).cacheWarning, /cache could not be cleared/);
    assert.equal(fs.existsSync(checkpoint), true);
    const payload = JSON.parse(fs.readFileSync(path.join(runtime, 'oauth-sessions.enc'), 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const persisted = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    assert.equal(persisted.sessions[sessionId].spotify.libraryCacheDirty, true);

    const fresh = await request('/api/spotify/library', { headers: cookie });
    assert.equal(fresh.status, 200);
    assert.equal(JSON.parse(fresh.body).saved.length, 0);
    assert.deepEqual(providerPaths, ['/v1/me/library', '/v1/me/tracks', '/v1/me/albums']);
    assert.equal(state.checkpointWrites.length, 0);
    const calls = state.externalCalls;
    const again = await request('/api/spotify/library', { headers: cookie });
    assert.equal(again.status, 200);
    assert.equal(JSON.parse(again.body).saved.length, 0);
    assert.equal(state.externalCalls, calls);

    state.failSpotifyCacheWrite = false;
    testSessions.get(sessionId).spotify.libraryCleanupRetryAt = 0;
    const recovered = await request('/api/spotify/library', { headers: cookie });
    assert.equal(recovered.status, 200);
    assert.equal(state.externalCalls, calls);
    assert.equal(fs.existsSync(checkpoint), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8')).users[userKey].library, undefined);
    assert.equal(testSessions.get(sessionId).spotify.libraryCacheDirty, false);
  }, { spotifyCacheUsers, spotifyScope: 'user-library-read user-library-modify' });
});

test('saving a track invalidates persisted library and page checkpoints without an eager library reload', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const spotifyCacheUsers = { [userKey]: { library: { expiresAt: Date.now() + 3600000, value: { saved: [{ track: { id: 'synthetic1', name: 'Old track' } }], savedAlbums: [], recentlyPlayed: [] } } } };
  return fixture(async ({ request, state, runtime }) => {
    state.providerFetch = async url => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
      if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
      if (parsed.pathname === '/v1/me/library') return providerJson({});
      if (parsed.pathname === '/v1/me/tracks' || parsed.pathname === '/v1/me/albums') return providerJson({ items: [], total: 0, next: null });
      if (parsed.pathname === '/v1/me/player/recently-played') return providerJson({ items: [] });
      throw new Error('Unexpected provider endpoint');
    };
    const cookie = { Cookie: `rcrd_session=${sessionId}` };
    const initial = await request('/api/spotify/library', { headers: cookie });
    assert.equal(initial.status, 200);
    assert.equal(JSON.parse(initial.body).saved.length, 1);
    const checkpointRoot = path.join(runtime, 'spotify-checkpoints', userKey);
    for (const key of ['checkpoint:library-tracks', 'checkpoint:library-albums']) {
      const directory = path.join(checkpointRoot, crypto.createHash('sha256').update(key).digest('hex'));
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, '0.json'), JSON.stringify({ expiresAt: Date.now() + 3600000, offset: 0, items: [], total: 0, complete: true }));
    }
    const callsBeforeMutation = state.externalCalls;
    const result = await request('/api/spotify/liked', { method: 'PUT', headers: { ...cookie, 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ uri: 'spotify:track:synthetic1', saved: false }) });
    assert.equal(result.status, 200);
    assert.equal(state.externalCalls, callsBeforeMutation + 1);
    const cache = JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8'));
    assert.equal(cache.users[userKey].library, undefined);
    for (const key of ['checkpoint:library-tracks', 'checkpoint:library-albums']) {
      assert.equal(fs.existsSync(path.join(checkpointRoot, crypto.createHash('sha256').update(key).digest('hex'))), false);
    }
    const fresh = await request('/api/spotify/library', { headers: cookie });
    assert.equal(fresh.status, 200);
    assert.equal(JSON.parse(fresh.body).saved.length, 0);
  }, { spotifyCacheUsers, spotifyScope: 'user-library-read user-library-modify' });
});

test('an in-flight saved-library page cannot restore stale cache or checkpoint after a save', () => fixture(async ({ request, state, runtime, testSessions, testInvalidateLibrary }) => {
  let enteredResolve;
  let releasePage;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const pageReady = new Promise(resolve => { releasePage = resolve; });
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname === '/v1/me/tracks') { enteredResolve(); await pageReady; return providerJson({ items: [], total: 0, next: null }); }
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const pending = request('/api/spotify/library', { headers: cookie });
  try {
    await entered;
    testInvalidateLibrary(testSessions.get(sessionId));
    releasePage();
    const stale = await pending;
    assert.equal(stale.status, 409);
    const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
    const cache = JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8'));
    assert.equal(cache.users[userKey]?.library, undefined);
    const tracksDirectory = path.join(runtime, 'spotify-checkpoints', userKey, crypto.createHash('sha256').update('checkpoint:library-tracks').digest('hex'));
    assert.equal(fs.existsSync(tracksDirectory), false);
  } finally { releasePage(); }
}, { spotifyScope: 'user-library-read user-library-modify' }));

test('saved-library progress is session-bound and complete cached snapshots report their age', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const updatedAt = Date.now() - 120000;
  return fixture(async ({ request, state }) => {
    const cookie = { Cookie: `rcrd_session=${sessionId}` };
    assert.equal((await request('/api/spotify/library-progress')).status, 401);
    assert.deepEqual(JSON.parse((await request('/api/spotify/library-progress', { headers: cookie })).body), { active: false });
    const response = await request('/api/spotify/library', { headers: cookie });
    const body = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.equal(body.sync.source, 'cached');
    assert.equal(body.sync.updatedAt, updatedAt);
    assert.equal(body.saved[0].track.name, 'Synthetic cached track');
    assert.equal(state.externalCalls, 0, 'a cached profile and library require no provider calls');
  }, { spotifyCacheUsers: { [userKey]: {
    profile: { expiresAt: Date.now() + 3600000, value: { id: 'synthetic-user' } },
    library: { expiresAt: Date.now() + 3600000, value: { saved: [{ track: { id: 'synthetic1', name: 'Synthetic cached track' } }], savedAlbums: [], recentlyPlayed: [], syncedAt: updatedAt } }
  } } });
});

test('temporarily unavailable Spotify returns only an account-scoped complete stale snapshot', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const library = { saved: [{ track: { id: 'synthetic1', name: 'Synthetic stale track' } }], savedAlbums: [], recentlyPlayed: [] };
  return fixture(async ({ request, state, testSessions }) => {
    state.providerFetch = async url => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
      if (pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
      if (pathname === '/v1/me/tracks') return { ok: false, status: 503, headers: { get: () => null }, text: async () => '{}' };
      throw new Error('Unexpected provider endpoint');
    };
    const cookie = { Cookie: `rcrd_session=${sessionId}` };
    const stale = await request('/api/spotify/library', { headers: cookie });
    assert.equal(stale.status, 200);
    assert.equal(JSON.parse(stale.body).sync.source, 'stale-cache');
    assert.equal(JSON.parse(stale.body).saved[0].track.name, 'Synthetic stale track');
    const session = testSessions.get(sessionId);
    session.spotify.libraryCacheDirty = true;
    const denied = await request('/api/spotify/library', { headers: cookie });
    assert.equal(denied.status, 502, 'a changed library must not reuse its old snapshot');
  }, { spotifyCacheUsers: { [userKey]: {
    library: { expiresAt: Date.now() - 1000, value: library }
  } } });
});

test('saved-library progress reports page counts without exposing account records', () => fixture(async ({ request, state }) => {
  let entered;
  let resume;
  const secondPageEntered = new Promise(resolve => { entered = resolve; });
  const secondPageRelease = new Promise(resolve => { resume = resolve; });
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname === '/v1/me/tracks') {
      if (parsed.searchParams.get('offset') === '0') return providerJson({ items: Array.from({ length: 50 }, (_, index) => ({ track: { id: `synthetic-${index}` } })), total: 51, next: 'synthetic-next-page' });
      entered(); await secondPageRelease;
      return providerJson({ items: [{ track: { id: 'synthetic-last' } }], total: 51, next: null });
    }
    if (parsed.pathname === '/v1/me/albums') return providerJson({ items: [], total: 0, next: null });
    if (parsed.pathname === '/v1/me/player/recently-played') return providerJson({ items: [] });
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const pending = request('/api/spotify/library', { headers: cookie });
  try {
    await secondPageEntered;
    const progress = JSON.parse((await request('/api/spotify/library-progress', { headers: cookie })).body);
    assert.equal(progress.active, true);
    assert.equal(progress.phase, 'tracks');
    assert.equal(progress.tracks.loaded, 50);
    assert.equal(progress.tracks.total, 51);
    assert.doesNotMatch(JSON.stringify(progress), /synthetic-0/);
  } finally { resume(); }
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).sync.source, 'live');
  assert.equal(JSON.parse((await request('/api/spotify/library-progress', { headers: cookie })).body).active, false);
}));

test('a completed old-account page cannot write library data under a newly connected Spotify account', () => fixture(async ({ request, state, testSessions, runtime }) => {
  let entered;
  let resume;
  const pageEntered = new Promise(resolve => { entered = resolve; });
  const pageRelease = new Promise(resolve => { resume = resolve; });
  state.providerFetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (pathname === '/v1/me/tracks') { entered(); await pageRelease; return providerJson({ items: [{ track: { id: 'old-track' } }], total: 1, next: null }); }
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const pending = request('/api/spotify/library', { headers: cookie });
  try {
    await pageEntered;
    testSessions.get(sessionId).spotify = { refreshToken: 'new-account-refresh', userId: 'different-user', cache: new Map() };
  } finally { resume(); }
  assert.equal((await pending).status, 409);
  const newUserKey = crypto.createHash('sha256').update('different-user').digest('hex');
  const disk = JSON.parse(fs.readFileSync(path.join(runtime, 'spotify-cache.json'), 'utf8'));
  assert.equal(disk.users[newUserKey]?.library, undefined);
  assert.equal(fs.existsSync(path.join(runtime, 'spotify-checkpoints', newUserKey)), false);
}));

test('Spotify resumes a large synthetic library from page checkpoints without refetching completed pages', () => fixture(async ({ request, state, runtime }) => {
  const offsets = [];
  let failSecondPage = true;
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname === '/v1/me/tracks') {
      const offset = Number(parsed.searchParams.get('offset'));
      offsets.push(offset);
      if (offset === 50 && failSecondPage) { failSecondPage = false; throw new Error('Synthetic temporary interruption'); }
      const count = Math.min(50, 120 - offset);
      const items = Array.from({ length: count }, (_, index) => ({ track: { id: `synthetic-${offset + index}`, name: `Track ${offset + index}`, album: { id: 'synthetic-album', name: 'Synthetic album' } } }));
      return providerJson({ items, total: 120, next: offset + count < 120 ? 'synthetic-next' : null });
    }
    if (parsed.pathname === '/v1/me/albums') return providerJson({ items: [], total: 0, next: null });
    if (parsed.pathname === '/v1/me/player/recently-played') return providerJson({ items: [] });
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  assert.equal((await request('/api/spotify/library', { headers: cookie })).status, 502);
  const checkpointRoot = path.join(runtime, 'spotify-checkpoints');
  assert.equal(fs.readdirSync(path.join(checkpointRoot, fs.readdirSync(checkpointRoot)[0])).length, 1);
  const recovered = await request('/api/spotify/library', { headers: cookie });
  assert.equal(recovered.status, 200);
  assert.equal(JSON.parse(recovered.body).saved.length, 120);
  assert.deepEqual(offsets, [0, 50, 50, 100]);
  assert.equal(state.checkpointWrites.length, 4);
  assert.ok(state.checkpointWrites.every(page => page.items.length <= 50));
  assert.equal(fs.readdirSync(path.join(checkpointRoot, fs.readdirSync(checkpointRoot)[0])).length, 0);
}));

test('an older cumulative Spotify checkpoint is split into bounded pages and survives a retry', () => {
  const userKey = crypto.createHash('sha256').update('synthetic-user').digest('hex');
  const saved = Array.from({ length: 120 }, (_, index) => ({ track: { id: `legacy-${index}`, name: `Legacy ${index}`, album: { id: 'legacy-album' } } }));
  const spotifyCacheUsers = { [userKey]: { 'checkpoint:library-tracks': { expiresAt: Date.now() + 3600000, value: { items: saved, offset: 120, total: 150, complete: false } } } };
  return fixture(async ({ request, state }) => {
    const offsets = [];
    let interrupted = true;
    state.providerFetch = async url => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
      if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
      if (parsed.pathname === '/v1/me/tracks') {
        const offset = Number(parsed.searchParams.get('offset'));
        offsets.push(offset);
        if (interrupted) { interrupted = false; throw new Error('Synthetic interruption after migration'); }
        return providerJson({ items: Array.from({ length: 30 }, (_, index) => ({ track: { id: `new-${offset + index}`, name: `New ${index}`, album: { id: 'new-album' } } })), total: 150, next: null });
      }
      if (parsed.pathname === '/v1/me/albums') return providerJson({ items: [], total: 0, next: null });
      if (parsed.pathname === '/v1/me/player/recently-played') return providerJson({ items: [] });
      throw new Error('Unexpected provider endpoint');
    };
    const cookie = { Cookie: `rcrd_session=${sessionId}` };
    assert.equal((await request('/api/spotify/library', { headers: cookie })).status, 502);
    const recovered = await request('/api/spotify/library', { headers: cookie });
    assert.equal(recovered.status, 200);
    assert.equal(JSON.parse(recovered.body).saved.length, 150);
    assert.deepEqual(offsets, [120, 120]);
    assert.ok(state.checkpointWrites.every(page => page.items.length <= 50));
    assert.equal(state.checkpointWrites.length, 5);
  }, { spotifyCacheUsers });
});

test('provider pagination rejects excessive totals before fetching more pages', () => fixture(async ({ request, state }) => {
  const paths = [];
  state.providerFetch = async url => {
    const parsed = new URL(url);
    paths.push(parsed.pathname);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson({ id: 'synthetic-user' });
    if (parsed.pathname === '/v1/me/tracks') return providerJson({ items: [], total: 100001, next: 'synthetic-next' });
    throw new Error('Unexpected provider endpoint');
  };
  const response = await request('/api/spotify/library', { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 502);
  assert.equal(paths.filter(value => value === '/v1/me/tracks').length, 1);
}));

test('Discogs loads bounded pages and rejects an excessive page count', () => fixture(async ({ request, state }) => {
  const pages = [];
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/oauth/identity') return providerJson({ username: 'synthetic-user' });
    if (parsed.pathname.endsWith('/releases')) {
      const page = Number(parsed.searchParams.get('page'));
      pages.push(page);
      const count = page === 1 ? 100 : 1;
      return providerJson({ releases: Array.from({ length: count }, (_, index) => ({ id: `synthetic-${page}-${index}` })), pagination: { pages: 2 } });
    }
    if (parsed.pathname.endsWith('/wants')) return providerJson({ wants: [], pagination: { pages: 2001 } });
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const collection = await request('/api/collection', { headers: cookie });
  assert.equal(collection.status, 200);
  assert.equal(JSON.parse(collection.body).releases.length, 101);
  assert.deepEqual(pages, [1, 2]);
  assert.equal((await request('/api/wantlist', { headers: cookie })).status, 502);
  assert.equal(state.externalCalls, 5);
}));

test('pressing details are fetched on demand through a validated fixed Discogs route', () => fixture(async ({ request, state }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  for (const id of ['0', '-1', '1%2Foauth', '9999999999999999']) assert.equal((await request(`/api/discogs/releases/${id}`, { headers: cookie })).status, 400);
  assert.equal(state.externalCalls, 0);
  state.providerFetch = async url => {
    assert.equal(new URL(url).pathname, '/releases/42');
    return providerJson({ id: 42, title: 'Synthetic edition', artists: [{ name: 'Example Artist' }], year: 2020, country: 'US', formats: [{ name: 'Vinyl', qty: '1', descriptions: ['LP'] }], labels: [{ name: 'Example Label', catno: 'ABC-1' }], identifiers: [{ type: 'Barcode', value: '123' }, { type: 'Other', value: 'private extra' }], tracklist: [{ title: 'Side A' }] });
  };
  const response = await request('/api/discogs/releases/42', { headers: cookie });
  assert.equal(response.status, 200);
  const release = JSON.parse(response.body);
  assert.equal(release.title, 'Synthetic edition');
  assert.equal(release.labels[0].catalogNumber, 'ABC-1');
  assert.equal(release.identifiers.length, 1);
  assert.equal(release.trackCount, 1);
  assert.equal(state.externalCalls, 1);
}));

test('edition search validates structured fields and master versions stay on a fixed bounded route', () => fixture(async ({ request, state }) => {
  assert.equal((await request('/api/search')).status, 400);
  assert.equal((await request(`/api/search?barcode=${'a'.repeat(121)}`)).status, 400);
  for (const path of ['/api/discogs/masters/0/versions', '/api/discogs/masters/12%2Foauth/versions', '/api/discogs/masters/42/versions?page=101']) assert.equal((await request(path)).status, 400);
  assert.equal(state.externalCalls, 0);
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/database/search') {
      assert.equal(parsed.searchParams.get('artist'), 'Example Artist');
      assert.equal(parsed.searchParams.get('catno'), 'ABC-1');
      assert.equal(parsed.searchParams.get('type'), 'release');
      return providerJson({ results: [], pagination: { page: 1, per_page: 24, items: 0 } });
    }
    assert.equal(parsed.pathname, '/masters/42/versions');
    assert.equal(parsed.searchParams.get('page'), '2');
    return providerJson({ versions: [{ id: 7, title: 'Synthetic edition', released: '1997', major_formats: ['Vinyl'], thumb: 'https://example.test/art' }], pagination: { page: 2, per_page: 24, items: 25 } });
  };
  assert.equal((await request('/api/search?artist=Example+Artist&catno=ABC-1')).status, 200);
  const versions = await request('/api/discogs/masters/42/versions?page=2');
  assert.equal(versions.status, 200);
  assert.equal(JSON.parse(versions.body).results[0].id, 7);
  assert.equal(JSON.parse(versions.body).pagination.items, 25);
  assert.equal(state.externalCalls, 2);
}));

test('available devices require a session and sanitize provider device fields', () => fixture(async ({ request, state }) => {
  assert.equal((await request('/api/spotify/devices')).status, 401);
  assert.equal(state.externalCalls, 0);
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    assert.equal(parsed.pathname, '/v1/me/player/devices');
    return providerJson({ devices: [{ id: 'local-1', name: 'Desk speaker', type: 'Computer', is_active: true, is_restricted: false, supports_volume: true }, { id: 'bad/id', name: '<unsafe>', is_restricted: true }] });
  };
  const response = await request('/api/spotify/devices', { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 200);
  const devices = JSON.parse(response.body).devices;
  assert.equal(devices[0].id, 'local-1');
  assert.equal(devices[0].supports_volume, true);
  assert.equal(devices[1].id, null);
}));

test('transfer reports a vanished device without exposing provider details', () => fixture(async ({ request, state }) => {
  const input = { method: 'PUT', headers: { 'X-RCRD-Request': '1', 'Content-Type': 'application/json' }, body: '{"device_id":"closed-device"}' };
  assert.equal((await request('/api/spotify/transfer', input)).status, 401);
  assert.equal(state.externalCalls, 0);
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    assert.equal(parsed.pathname, '/v1/me/player');
    return providerJson({ error: { message: 'synthetic-private-provider-details' } }, 404);
  };
  const response = await request('/api/spotify/transfer', { ...input, headers: { ...input.headers, Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 404);
  assert.match(JSON.parse(response.body).error, /device is no longer available/);
  assert.doesNotMatch(response.body, /synthetic-private-provider-details/);
}));

test('long-term favorites require a separately requested Spotify scope', () => fixture(async ({ request, state }) => {
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  assert.equal(JSON.parse((await request('/api/spotify/status', { headers: cookie })).body).canReadTop, false);
  assert.equal((await request('/api/spotify/top-albums', { headers: cookie })).status, 403);
  assert.equal(state.externalCalls, 0);
  const ordinary = new URL((await request('/auth/spotify/start', { headers: cookie })).headers.location);
  assert.ok(!ordinary.searchParams.get('scope').split(' ').includes('user-top-read'));
  const optedIn = new URL((await request('/auth/spotify/start?top=1', { headers: cookie })).headers.location);
  assert.ok(optedIn.searchParams.get('scope').split(' ').includes('user-top-read'));
}, { spotifyScope: '' }));

test('authorized top tracks return only bounded album fields', () => fixture(async ({ request, state }) => {
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/token')) return providerJson({ access_token: 'synthetic-access', expires_in: 3600 });
    assert.equal(parsed.pathname, '/v1/me/top/tracks');
    assert.equal(parsed.searchParams.get('time_range'), 'long_term');
    return providerJson({ items: [{ album: { id: 'album1', name: 'Synthetic album', uri: 'spotify:album:album1', images: [{ url: 'https://example.test/art' }], artists: [{ name: 'Example Artist' }] }, artists: [{ name: 'Extra track metadata' }] }] });
  };
  const response = await request('/api/spotify/top-albums', { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 200);
  const album = JSON.parse(response.body).tracks[0].album;
  assert.equal(album.name, 'Synthetic album');
  assert.equal(album.artists[0].name, 'Example Artist');
  assert.equal(JSON.parse(response.body).tracks[0].artists, undefined);
}, { spotifyScope: 'user-top-read' }));

test('a provider request that stalls is aborted at the configured timeout', () => fixture(async ({ request, state }) => {
  state.timeoutImmediately = true;
  let aborted = false;
  state.providerFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('Synthetic abort'), { name: 'AbortError' })); });
  });
  const response = await request('/api/spotify/me', { headers: { Cookie: `rcrd_session=${sessionId}` } });
  assert.equal(response.status, 502);
  assert.equal(aborted, true);
  assert.equal(state.externalCalls, 1);
}));

test('malformed provider data is rejected without exposing its body or poisoning profile cache', () => fixture(async ({ request, state }) => {
  let invalidToken = true;
  let invalidProfile = true;
  state.providerFetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/oauth/identity') return { ok: true, status: 200, text: async () => 'synthetic-private-provider-body' };
    if (parsed.pathname.endsWith('/api/token')) return providerJson(invalidToken ? { access_token: 'synthetic-access', expires_in: 0 } : { access_token: 'synthetic-access', expires_in: 3600 });
    if (parsed.pathname === '/v1/me') return providerJson(invalidProfile ? { id: '' } : { id: 'synthetic-user' });
    throw new Error('Unexpected provider endpoint');
  };
  const cookie = { Cookie: `rcrd_session=${sessionId}` };
  const discogs = await request('/api/me', { headers: cookie });
  assert.equal(discogs.status, 502);
  assert.doesNotMatch(discogs.body, /synthetic-private-provider-body/);
  assert.equal((await request('/api/spotify/me', { headers: cookie })).status, 502);
  invalidToken = false;
  assert.equal((await request('/api/spotify/me', { headers: cookie })).status, 502);
  invalidProfile = false;
  const profile = await request('/api/spotify/me', { headers: cookie });
  assert.equal(profile.status, 200);
  assert.equal(JSON.parse(profile.body).id, 'synthetic-user');
}));
