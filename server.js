const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

loadEnv();
const root = __dirname;
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const bindHost = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
const publicFiles = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['distinction.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['walkthrough/RCRD-complete-walkthrough.mp4', 'video/mp4'],
  ['walkthrough/RCRD-complete-walkthrough-transcript.md', 'text/plain; charset=utf-8'],
  ['assets/rcrd-app-icon.png', 'image/png'],
  ['assets/rcrd-app-icon.ico', 'image/x-icon'],
  ['assets/rcrd-cover-placeholder.webp', 'image/webp'],
  ['assets/spotify-full-logo-white.svg', 'image/svg+xml'],
  ['assets/spotify-icon-white.svg', 'image/svg+xml']
]);
const providerTimeoutMs = 20000;
const maxProviderResponseBytes = 8 * 1024 * 1024;
const maxPaginatedItems = 100000;
const maxPaginationPages = 2000;
const sessionMaxAgeDays = Number(process.env.SESSION_COOKIE_MAX_AGE_DAYS || 365);
if (!Number.isInteger(sessionMaxAgeDays) || sessionMaxAgeDays < 1 || sessionMaxAgeDays > 365) throw new Error('SESSION_COOKIE_MAX_AGE_DAYS must be between 1 and 365.');
const config = {
  key: required('DISCOGS_CONSUMER_KEY'),
  secret: required('DISCOGS_CONSUMER_SECRET'),
  requestUrl: process.env.DISCOGS_REQUEST_TOKEN_URL || 'https://api.discogs.com/oauth/request_token',
  authorizeUrl: process.env.DISCOGS_AUTHORIZE_URL || 'https://www.discogs.com/oauth/authorize',
  accessUrl: process.env.DISCOGS_ACCESS_TOKEN_URL || 'https://api.discogs.com/oauth/access_token',
  callbackUrl: process.env.DISCOGS_CALLBACK_URL || `http://127.0.0.1:${port}/auth/discogs/callback`,
  userAgent: process.env.DISCOGS_USER_AGENT || `RCRD/${appVersion}`,
  geniusAccessToken: process.env.GENIUS_ACCESS_TOKEN || '',
  sessionMaxAgeSeconds: sessionMaxAgeDays * 24 * 60 * 60,
  spotify: process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET ? {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${port}/auth/spotify/callback`,
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    refreshMaxAgeMs: Number(process.env.SPOTIFY_REFRESH_TOKEN_MAX_AGE_DAYS || 180) * 24 * 60 * 60 * 1000
  } : null
};
const sessions = new Map();
const runtimeDirectory = path.join(root, '.data');
const pidFile = path.join(runtimeDirectory, 'rcrd-server.json');
const spotifyCacheFile = path.join(root, '.data', 'spotify-cache.json');
const spotifyCheckpointRoot = path.join(runtimeDirectory, 'spotify-checkpoints');
const sessionStoreFile = path.join(runtimeDirectory, 'oauth-sessions.enc');
const sessionKeyFile = path.join(runtimeDirectory, 'oauth-session.key');
const listeningHistoryRoot = path.join(runtimeDirectory, 'listening-history');
const historyImports = new Set();
const maxHistoryArchiveBytes = 256 * 1024 * 1024;
const historyPageSize = 12;
let spotifyDiskCache = loadSpotifyDiskCache();
migrateSpotifyProfileCache();
loadPersistentSessions();

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
function loadSpotifyDiskCache() {
  let raw;
  try { raw = fs.readFileSync(spotifyCacheFile, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { version: 2, users: {} }; throw new Error('Could not read the Spotify cache. Back up and inspect the .data directory before restarting.'); }
  try {
    const value = JSON.parse(raw);
    if (![1, 2].includes(value?.version) || !value.users || typeof value.users !== 'object' || Array.isArray(value.users)) throw new Error('Invalid Spotify cache');
    return value;
  } catch { throw new Error('Could not restore the Spotify cache. Back up and inspect the .data directory before restarting.'); }
}
function migrateSpotifyProfileCache() {
  if (!spotifyDiskCache.users || typeof spotifyDiskCache.users !== 'object') return;
  let changed = spotifyDiskCache.version === 1;
  for (const entries of Object.values(spotifyDiskCache.users)) {
    if (!entries || typeof entries !== 'object' || !entries.profile) continue;
    if (spotifyDiskCache.version === 1 || typeof entries.profile.value?.id !== 'string' || !entries.profile.value.id) { delete entries.profile; changed = true; continue; }
    const minimal = spotifyUiProfile(entries.profile.value);
    if (JSON.stringify(entries.profile.value) !== JSON.stringify(minimal)) { entries.profile.value = minimal; changed = true; }
  }
  if (changed) {
    spotifyDiskCache.version = 2;
    try { saveSpotifyDiskCache(); }
    catch { throw new Error('Could not remove outdated Spotify profile cache.'); }
  }
}
function sessionEncryptionKey() {
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  try {
    const key = fs.readFileSync(sessionKeyFile);
    if (key.length !== 32) throw new Error('OAuth session key is invalid.');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (fs.existsSync(sessionStoreFile)) throw new Error('OAuth session key is missing.');
  const key = crypto.randomBytes(32);
  fs.writeFileSync(sessionKeyFile, key, { mode: 0o600 });
  return key;
}
function serializableSession(session) {
  const saved = {};
  if (session.spotify?.refreshToken) saved.spotify = {
    refreshToken: session.spotify.refreshToken,
    authorizedAt: Number(session.spotify.authorizedAt || Date.now()),
    refreshDueAt: Number(session.spotify.refreshDueAt || 0),
    userId: session.spotify.userId || null,
    scope: typeof session.spotify.scope === 'string' ? session.spotify.scope : '',
    libraryCacheDirty: Boolean(session.spotify.libraryCacheDirty),
    rateLimitedUntil: Number(session.spotify.rateLimitedUntil || 0),
    rateLimitBackoffMs: Number(session.spotify.rateLimitBackoffMs || 0)
  };
  if (session.accessToken && session.accessSecret) { saved.accessToken = session.accessToken; saved.accessSecret = session.accessSecret; }
  if (session.spotifyState) saved.spotifyState = session.spotifyState;
  if (session.requestToken && session.requestSecret) { saved.requestToken = session.requestToken; saved.requestSecret = session.requestSecret; }
  if (Object.keys(saved).length && Number.isSafeInteger(session.expiresAt)) saved.expiresAt = session.expiresAt;
  return saved;
}
function savePersistentSessions() {
  try {
    const stored = {};
    for (const [id, session] of sessions) { const value = serializableSession(session); if (Object.keys(value).length) stored[id] = value; }
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    if (!Object.keys(stored).length) { try { fs.unlinkSync(sessionStoreFile); } catch (error) { if (error.code !== 'ENOENT') throw error; } return; }
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', sessionEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ version: 1, sessions: stored }), 'utf8'), cipher.final()]);
    const payload = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
    const temporary = `${sessionStoreFile}.tmp`;
    fs.writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, sessionStoreFile);
  } catch (error) { const failure = new Error('Could not save local account state.'); failure.status = 500; failure.code = 'SESSION_PERSISTENCE_FAILED'; throw failure; }
}
function loadPersistentSessions() {
  try {
    if (!fs.existsSync(sessionStoreFile)) return;
    const payload = JSON.parse(fs.readFileSync(sessionStoreFile, 'utf8'));
    if (payload?.version !== 1) throw new Error('Unsupported account state version.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionEncryptionKey(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    if (decoded?.version !== 1 || !decoded.sessions || typeof decoded.sessions !== 'object' || Array.isArray(decoded.sessions)) throw new Error('Invalid account state.');
    let changed = false;
    for (const [id, saved] of Object.entries(decoded.sessions)) {
      if (!/^[a-f0-9]{48}$/.test(id) || !saved || typeof saved !== 'object') continue;
      if (saved.expiresAt !== undefined && (!Number.isSafeInteger(saved.expiresAt) || saved.expiresAt <= Date.now())) { changed = true; continue; }
      const session = { ...saved, expiresAt: saved.expiresAt ?? Date.now() + config.sessionMaxAgeSeconds * 1000 };
      if (saved.expiresAt === undefined) changed = true;
      if (saved.spotify?.refreshToken) session.spotify = { ...saved.spotify, accessToken: null, expiresAt: 0, cache: new Map() };
      sessions.set(id, session);
    }
    if (changed) savePersistentSessions();
  } catch { throw new Error('Could not restore local account state. Back up and inspect the .data directory before restarting.'); }
}
function pruneExpiredSessions() {
  const expired = [...sessions].filter(([, session]) => !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now());
  if (!expired.length) return;
  for (const [id] of expired) sessions.delete(id);
  try { savePersistentSessions(); }
  catch (error) { for (const [id, session] of expired) sessions.set(id, session); throw error; }
}
function spotifyCacheUserKey(session) {
  const userId = String(session?.spotify?.userId || '');
  return userId ? crypto.createHash('sha256').update(userId).digest('hex') : '';
}
function readSpotifyDiskEntry(session, key) {
  const userKey = spotifyCacheUserKey(session); if (!userKey) return null;
  const entry = spotifyDiskCache.users[userKey]?.[key];
  return entry && entry.expiresAt > Date.now() ? entry : null;
}
function spotifyLibrarySnapshot(session, allowExpired = false) {
  const userKey = spotifyCacheUserKey(session);
  const entry = userKey ? spotifyDiskCache.users[userKey]?.library : null;
  if (!entry || !Number.isSafeInteger(entry.expiresAt) || !Array.isArray(entry.value?.saved) || !Array.isArray(entry.value?.savedAlbums) || !Array.isArray(entry.value?.recentlyPlayed)) return null;
  if (!allowExpired && entry.expiresAt <= Date.now()) return null;
  if (allowExpired && entry.expiresAt <= Date.now() - 604800000) return null;
  return entry;
}
function spotifyLibrarySync(value, source, expiresAt = 0) {
  const updatedAt = Number.isSafeInteger(value?.syncedAt) ? value.syncedAt : expiresAt - 43200000;
  return { source, updatedAt: updatedAt > 0 && updatedAt <= Date.now() ? updatedAt : null };
}
function spotifyPlaylistSnapshot(session, key, allowExpired = false) {
  const userKey = spotifyCacheUserKey(session);
  const entry = userKey ? spotifyDiskCache.users[userKey]?.[key] : null;
  if (!entry || !Number.isSafeInteger(entry.expiresAt) || !Array.isArray(entry.value)) return null;
  if (!allowExpired && entry.expiresAt <= Date.now()) return null;
  if (allowExpired && entry.expiresAt <= Date.now() - 604800000) return null;
  return entry;
}
function writeSpotifyDiskEntry(session, key, expiresAt, value) {
  const userKey = spotifyCacheUserKey(session); if (!userKey) return;
  spotifyDiskCache.users[userKey] ||= {}; spotifyDiskCache.users[userKey][key] = { expiresAt, value };
  saveSpotifyDiskCache();
}
function saveSpotifyDiskCache() {
  fs.mkdirSync(path.dirname(spotifyCacheFile), { recursive: true });
  const temporary = `${spotifyCacheFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(spotifyDiskCache), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, spotifyCacheFile);
}
function clearSpotifyDiskEntry(session, key) {
  const userKey = spotifyCacheUserKey(session); const entries = userKey ? spotifyDiskCache.users[userKey] : null;
  if (!entries?.[key]) return;
  const previous = entries[key];
  delete entries[key];
  try { saveSpotifyDiskCache(); } catch (error) { entries[key] = previous; throw error; }
}
function clearSpotifyDiskEntries(session) {
  const userKey = spotifyCacheUserKey(session); if (!userKey) return;
  if (spotifyDiskCache.users[userKey]) {
    const previous = spotifyDiskCache.users[userKey];
    delete spotifyDiskCache.users[userKey];
    try { saveSpotifyDiskCache(); } catch (error) { spotifyDiskCache.users[userKey] = previous; throw error; }
  }
  clearSpotifyCheckpoints(session);
}
function spotifyCheckpointDirectory(session, key) {
  const userKey = spotifyCacheUserKey(session);
  return userKey ? path.join(spotifyCheckpointRoot, userKey, crypto.createHash('sha256').update(key).digest('hex')) : null;
}
function readSpotifyCheckpoint(session, key) {
  const directory = spotifyCheckpointDirectory(session, key);
  if (!directory || !fs.existsSync(directory)) return null;
  const files = fs.readdirSync(directory).filter(name => /^(0|[1-9]\d*)\.json$/.test(name)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
  if (files.length > maxPaginationPages) throw new Error('Saved Spotify progress exceeds the page limit.');
  const items = []; let offset = 0; let total = Infinity; let complete = false;
  for (const name of files) {
    const page = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (!Number.isSafeInteger(page.expiresAt) || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > maxPaginatedItems || page.expiresAt <= Date.now()) { clearSpotifyCheckpoint(session, key); return null; }
    if (page.offset !== offset || !Array.isArray(page.items) || page.items.length > 100) throw new Error('Saved Spotify progress is invalid.');
    items.push(...page.items); offset += page.items.length; total = page.total; complete = Boolean(page.complete);
    if (offset > maxPaginatedItems) throw new Error('Saved Spotify progress exceeds the item limit.');
    if (complete) break;
  }
  return files.length ? { items, offset, total, complete } : null;
}
function writeSpotifyCheckpoint(session, key, offset, items, total, complete) {
  const directory = spotifyCheckpointDirectory(session, key);
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${offset}.json`);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ expiresAt: Date.now() + 604800000, offset, items, total, complete }), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}
function clearSpotifyCheckpoint(session, key) {
  const directory = spotifyCheckpointDirectory(session, key);
  if (!directory || !fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) { if (/^(0|[1-9]\d*)\.json(\.tmp)?$/.test(name)) fs.unlinkSync(path.join(directory, name)); }
  fs.rmdirSync(directory);
}
function clearSpotifyCheckpoints(session) {
  const userKey = spotifyCacheUserKey(session);
  if (!userKey) return;
  const directory = path.join(spotifyCheckpointRoot, userKey);
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    if (!/^[a-f0-9]{64}$/.test(name)) throw new Error('Saved Spotify progress is invalid.');
    const folder = path.join(directory, name);
    for (const file of fs.readdirSync(folder)) { if (/^(0|[1-9]\d*)\.json(\.tmp)?$/.test(file)) fs.unlinkSync(path.join(folder, file)); }
    fs.rmdirSync(folder);
  }
  fs.rmdirSync(directory);
}
function required(name) { if (!process.env[name]) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it locally.`); return process.env[name]; }
function random() { return crypto.randomBytes(24).toString('hex'); }
function enc(value) { return encodeURIComponent(String(value)); }
function oauthHeader({ token, tokenSecret, callback, verifier } = {}) {
  const values = {
    oauth_consumer_key: config.key,
    oauth_nonce: random(),
    oauth_signature_method: 'PLAINTEXT',
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_version: '1.0',
    oauth_signature: `${config.secret}&${tokenSecret || ''}`
  };
  if (token) values.oauth_token = token;
  if (callback) values.oauth_callback = callback;
  if (verifier) values.oauth_verifier = verifier;
  return `OAuth ${Object.entries(values).map(([key, value]) => `${key}="${enc(value)}"`).join(', ')}`;
}
async function providerResponse(url, options = {}) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const cancel = () => controller.abort();
  if (externalSignal?.aborted) cancel(); else externalSignal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const tooLarge = () => { controller.abort(); const error = new Error('Provider response exceeded the supported size.'); error.status = 502; throw error; };
    if (Number(response.headers?.get?.('content-length')) > maxProviderResponseBytes) tooLarge();
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxProviderResponseBytes) { void reader.cancel().catch(() => {}); tooLarge(); }
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks, size).toString('utf8');
    } else {
      text = await response.text();
      if (Buffer.byteLength(text) > maxProviderResponseBytes) tooLarge();
    }
    return { response, text };
  } finally { clearTimeout(timeout); externalSignal?.removeEventListener('abort', cancel); }
}
let discogsRateLimitedUntil = 0;
let discogsRateLimitBackoffSeconds = 0;
function discogsRetryAfter(value) {
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) && numeric > 0 ? numeric : (typeof value === 'string' ? (Date.parse(value) - Date.now()) / 1000 : 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(900, Math.max(1, Math.ceil(seconds))) : 0;
}
async function discogsRequest(url, options = {}) {
  const remaining = Math.ceil((discogsRateLimitedUntil - Date.now()) / 1000);
  if (remaining > 0) { const error = new Error(`Discogs request limit reached. Try again in ${remaining} seconds.`); error.status = 429; error.retryAfter = remaining; throw error; }
  const { response, text } = await providerResponse(url, { ...options, headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...(options.headers || {}) } });
  if (response.status === 429) {
    discogsRateLimitBackoffSeconds = Math.min(discogsRateLimitBackoffSeconds ? discogsRateLimitBackoffSeconds * 2 : 30, 900);
    const retryAfter = discogsRetryAfter(response.headers?.get?.('retry-after')) || discogsRateLimitBackoffSeconds;
    discogsRateLimitedUntil = Date.now() + retryAfter * 1000;
    const error = new Error(`Discogs request limit reached. Try again in ${retryAfter} seconds.`); error.status = 429; error.retryAfter = retryAfter; throw error;
  }
  if (!response.ok) { const error = new Error(`Discogs request failed (HTTP ${response.status}).`); error.status = response.status; throw error; }
  discogsRateLimitedUntil = 0; discogsRateLimitBackoffSeconds = 0;
  return text;
}
function providerObject(text, service) {
  let value;
  try { value = JSON.parse(text); } catch {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) { const error = new Error(`${service} returned an invalid JSON response.`); error.status = 502; throw error; }
  return value;
}
function geniusMatchKey(value) {
  return typeof value === 'string' ? value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
}
function geniusSongMatch(hits, title, artist) {
  if (!Array.isArray(hits) || hits.length > 100) throw Object.assign(new Error('Genius returned invalid results.'), { status: 502 });
  const titleKey = geniusMatchKey(title.replace(/\s*[\[(]\s*(?:feat\.?|ft\.?)\s+[^\])]+[\])]\s*$/i, ''));
  const artistKey = geniusMatchKey(artist);
  const matches = new Map();
  for (const hit of hits) {
    const song = hit?.result;
    if (!Number.isSafeInteger(song?.id) || song.id < 1 || typeof song.title !== 'string' || typeof song.primary_artist?.name !== 'string') continue;
    const matchedArtist = geniusMatchKey(song.primary_artist.name);
    if (geniusMatchKey(song.title) !== titleKey || !matchedArtist || !(artistKey === matchedArtist || artistKey.startsWith(`${matchedArtist} `))) continue;
    let sourceUrl = `https://genius.com/songs/${song.id}`;
    if (typeof song.url === 'string' && song.url.length <= 500) {
      try { const page = new URL(song.url); if (page.protocol === 'https:' && page.hostname === 'genius.com' && !page.port && !page.username && !page.password && page.pathname.length > 1) sourceUrl = `https://genius.com${page.pathname}`; } catch {}
    }
    matches.set(song.id, { id: song.id, title: song.title.slice(0, 200), artist: song.primary_artist.name.slice(0, 200), url: sourceUrl });
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}
let geniusRateLimitedUntil = 0;
async function geniusLyricsMatch(title, artist) {
  const remaining = Math.ceil((geniusRateLimitedUntil - Date.now()) / 1000);
  if (remaining > 0) throw Object.assign(new Error(`Genius is temporarily limiting requests. Try again in ${remaining} seconds.`), { status: 429, retryAfter: remaining });
  const query = new URL('https://api.genius.com/search');
  query.searchParams.set('q', `${title} ${artist}`);
  const { response, text } = await providerResponse(query.href, { redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${config.geniusAccessToken}`, 'User-Agent': `RCRD/${appVersion}` } });
  if (response.status === 429) {
    const retryAfter = discogsRetryAfter(response.headers?.get?.('retry-after')) || 30;
    geniusRateLimitedUntil = Date.now() + retryAfter * 1000;
    throw Object.assign(new Error(`Genius is temporarily limiting requests. Try again in ${retryAfter} seconds.`), { status: 429, retryAfter });
  }
  if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? 'Genius access needs attention. Check the client token in .env.' : 'Genius is unavailable right now.'), { status: response.status === 401 || response.status === 403 ? 503 : 502 });
  geniusRateLimitedUntil = 0;
  const data = providerObject(text, 'Genius');
  if (!Array.isArray(data.response?.hits)) throw Object.assign(new Error('Genius returned invalid results.'), { status: 502 });
  return geniusSongMatch(data.response.hits, title, artist);
}
async function discogsJson(url, options = {}) { return providerObject(await discogsRequest(url, options), 'Discogs'); }
function parseForm(text) { return Object.fromEntries(new URLSearchParams(text)); }
function validOauthPair(value) { return typeof value?.oauth_token === 'string' && value.oauth_token.length > 0 && typeof value.oauth_token_secret === 'string' && value.oauth_token_secret.length > 0; }
function readBody(request, maxBytes = 10000) { return new Promise((resolve, reject) => { let body = ''; let size = 0; let settled = false; request.on('data', chunk => { if (settled) return; size += Buffer.byteLength(chunk); if (size > maxBytes) { settled = true; request.pause(); const error = new Error('Request body too large.'); error.status = 413; reject(error); return; } body += chunk; }); request.on('end', () => { if (!settled) resolve(body); }); request.on('error', error => { if (!settled) reject(error); }); }); }
async function readJsonBody(request, maxBytes) { const raw = await readBody(request, maxBytes); let value; try { value = JSON.parse(raw || '{}'); } catch { const error = new Error('Invalid JSON request body.'); error.status = 400; throw error; } if (!value || typeof value !== 'object' || Array.isArray(value)) { const error = new Error('A JSON object is required.'); error.status = 400; throw error; } return value; }
function historyFile(session) { const key = spotifyCacheUserKey(session); return key ? path.join(listeningHistoryRoot, `${key}.json`) : ''; }
function recentPlayFile(session) { const key = spotifyCacheUserKey(session); return key ? path.join(listeningHistoryRoot, `${key}.recent.json`) : ''; }
function readRecentPlays(session) {
  const file = recentPlayFile(session); if (!file) throw new Error('Spotify account identity is unavailable.');
  let raw;
  try { if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('Invalid recent plays'); raw = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, lastSynced: 0, ignoreBefore: 0, events: [] }; throw new Error('Could not read local recent plays. Back up the .data folder before retrying.'); }
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Number.isSafeInteger(value.lastSynced) || !Number.isSafeInteger(value.ignoreBefore || 0) || !Array.isArray(value.events) || value.events.length > 100000 || value.events.some(event => !spotifyTrackUri(event?.uri) || !Number.isSafeInteger(event.playedAt) || event.playedAt < 0)) throw new Error('Invalid recent plays');
    return value;
  } catch { throw new Error('Could not read local recent plays. Back up the .data folder before retrying.'); }
}
function saveRecentPlays(session, ledger) {
  const file = recentPlayFile(session); if (!file) throw new Error('Spotify account identity is unavailable.');
  fs.mkdirSync(listeningHistoryRoot, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${random()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(ledger), { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, file); }
  catch { throw new Error('Could not save local recent plays. Previous counts were kept.'); }
  finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function mergeRecentPlays(session, recent) {
  if (!Array.isArray(recent?.items) || recent.items.length > 50) throw new Error('Spotify returned an invalid recent-play response.');
  const ledger = readRecentPlays(session);
  const known = new Set(ledger.events.map(event => `${event.uri}:${event.playedAt}`));
  let changed = false;
  for (const item of recent.items) {
    const uri = item?.track?.uri;
    const playedAt = Date.parse(item?.played_at);
    if (!spotifyTrackUri(uri) || !Number.isSafeInteger(playedAt) || playedAt <= (ledger.ignoreBefore || 0) || playedAt > Date.now() + 60000) continue;
    const key = `${uri}:${playedAt}`;
    if (known.has(key)) continue;
    known.add(key); ledger.events.push({ uri, playedAt }); changed = true;
  }
  if (ledger.events.length > 100000) throw new Error('Local recent-play storage is full. Import a newer Spotify ZIP before collecting more plays.');
  if (changed || Date.now() - ledger.lastSynced >= 300000) { ledger.lastSynced = Date.now(); saveRecentPlays(session, ledger); }
  return ledger;
}
function playCountMatchKey(title, artist) {
  const clean = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const name = clean(title); const performer = clean(artist);
  return name && performer ? `${name}\u0000${performer}` : '';
}
function playCountResponse(history, ledger, records, recentUnavailable = false) {
  const cutoff = history ? Date.parse(history.lastAt) : -1;
  const requested = new Map(records.map(record => [record.uri, record]));
  const exact = new Map(); const candidates = new Map();
  const requestedNames = new Set(records.map(record => playCountMatchKey(record.title, record.artist)).filter(Boolean));
  if (history) for (const track of history.tracks) {
    if (requested.has(track.uri)) exact.set(track.uri, (exact.get(track.uri) || 0) + track.plays);
    const key = playCountMatchKey(track.title, track.artist);
    if (!requestedNames.has(key)) continue;
    const prior = candidates.get(key);
    candidates.set(key, prior && prior.uri !== track.uri ? { ambiguous: true } : prior?.ambiguous ? prior : { uri: track.uri, plays: (prior?.plays || 0) + track.plays });
  }
  const recent = new Map();
  const relevant = new Set(requested.keys());
  for (const candidate of candidates.values()) if (candidate.uri) relevant.add(candidate.uri);
  for (const event of ledger.events) if (event.playedAt > cutoff && relevant.has(event.uri)) recent.set(event.uri, (recent.get(event.uri) || 0) + 1);
  const counts = {}; const matches = {};
  for (const record of records) {
    const candidate = candidates.get(playCountMatchKey(record.title, record.artist));
    const imported = exact.get(record.uri) || 0; const ownRecent = recent.get(record.uri) || 0;
    if (imported) { counts[record.uri] = imported + ownRecent; matches[record.uri] = 'exact'; }
    else if (candidate?.uri && candidate.uri !== record.uri) { counts[record.uri] = candidate.plays + (recent.get(candidate.uri) || 0) + ownRecent; matches[record.uri] = 'song'; }
    else if (ownRecent) { counts[record.uri] = ownRecent; matches[record.uri] = 'exact'; }
    else { counts[record.uri] = null; matches[record.uri] = candidate?.ambiguous ? 'ambiguous' : 'unrecorded'; }
  }
  return { counts, matches, importedThrough: history?.lastAt || null, lastSynced: ledger.lastSynced || null, recentUnavailable };
}
function readListeningHistory(session) {
  const file = historyFile(session); if (!file) return null;
  let raw;
  try { if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error('Invalid history'); raw = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Could not read local listening history. Back up the .data folder before retrying.'); }
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Number.isSafeInteger(value.totalPlays) || value.totalPlays < 1 || !Array.isArray(value.tracks) || value.tracks.length > 100000 || !Number.isSafeInteger(value.importedAt)) throw new Error('Invalid history');
    return value;
  } catch { throw new Error('Could not read local listening history. Back up the .data folder before retrying.'); }
}
function historyQueryOptions(url) {
  const rawPage = url.searchParams.get('page') || '1';
  const sort = url.searchParams.get('sort') || 'plays';
  const direction = url.searchParams.get('direction') || 'desc';
  const q = (url.searchParams.get('q') || '').trim();
  if (!/^[1-9][0-9]{0,3}$/.test(rawPage) || !['plays', 'title', 'artist', 'album'].includes(sort) || !['asc', 'desc'].includes(direction) || q.length > 100) throw Object.assign(new Error('Invalid listening history filters.'), { status: 400 });
  return { page: Number(rawPage), sort, direction, q };
}
function historyBrowseResponse(history, { page = 1, sort = 'plays', direction = 'desc', q = '' } = {}) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const tieBreak = (a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist) || collator.compare(a.uri, b.uri);
  const ranked = [...history.tracks].sort((a, b) => b.plays - a.plays || tieBreak(a, b));
  const topTracks = ranked.slice(0, 5);
  const query = q.toLocaleLowerCase();
  const matching = query ? ranked.filter(track => [track.title, track.artist, track.album].some(value => value.toLocaleLowerCase().includes(query))) : ranked;
  if (sort !== 'plays' || direction !== 'desc') matching.sort((a, b) => {
    const order = sort === 'plays' ? a.plays - b.plays : collator.compare(a[sort], b[sort]);
    return (direction === 'desc' ? -order : order) || tieBreak(a, b);
  });
  const total = matching.length;
  const pages = Math.max(1, Math.ceil(total / historyPageSize));
  const currentPage = Math.min(page, pages);
  const tracks = matching.slice((currentPage - 1) * historyPageSize, currentPage * historyPageSize);
  return { imported: true, totalPlays: history.totalPlays, firstAt: history.firstAt, lastAt: history.lastAt, importedAt: history.importedAt, trackCount: history.tracks.length, topTracks, tracks, page: currentPage, perPage: historyPageSize, matches: total };
}
function saveListeningHistory(session, history) {
  const file = historyFile(session); if (!file) throw new Error('Spotify account identity is unavailable.');
  fs.mkdirSync(listeningHistoryRoot, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${random()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(history), { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, file); }
  catch { throw new Error('Could not save local listening history. The previous import was kept.'); }
  finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
async function receiveHistoryArchive(request, target) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > maxHistoryArchiveBytes) { const error = new Error('Spotify history ZIP is too large to import safely.'); error.status = 413; throw error; }
  const file = await fs.promises.open(target, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxHistoryArchiveBytes) { const error = new Error('Spotify history ZIP is too large to import safely.'); error.status = 413; throw error; }
      let offset = 0;
      while (offset < chunk.length) { const written = await file.write(chunk, offset, chunk.length - offset); offset += written.bytesWritten; }
    }
  } finally { await file.close(); }
  if (size < 4) { const error = new Error('Select the ZIP file from Spotify, not an individual document.'); error.status = 400; throw error; }
}
function parseHistoryArchive(archivePath, outputPath) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { const error = new Error('Spotify history import currently requires Windows.'); error.status = 503; reject(error); return; }
    const parser = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'Parse-Spotify-History.ps1'), '-ArchivePath', archivePath, '-OutputPath', outputPath], { windowsHide: true, stdio: 'ignore', env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: process.env.PATH } });
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; parser.kill(); }, 300000);
    function finish(error) { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(); }
    parser.on('error', () => finish(Object.assign(new Error('Could not start the local history importer.'), { status: 503 })));
    parser.on('exit', code => finish(timedOut ? Object.assign(new Error('Spotify history import timed out.'), { status: 504 }) : code === 0 ? null : Object.assign(new Error('Could not read that Spotify history ZIP. Confirm it is the Extended Streaming History download.'), { status: 400 })));
  });
}
function validateHistorySummary(summary, accountId, confirmedAccount) {
  if (summary?.version !== 1 || (summary.username !== null && summary.username !== accountId)) { const error = new Error('This history ZIP does not belong to the connected Spotify account.'); error.status = 409; throw error; }
  if (summary.username === null && !confirmedAccount) { const error = new Error('Spotify did not include an account ID. Confirm that this ZIP belongs to the connected account before importing.'); error.status = 409; throw error; }
  if (!Number.isSafeInteger(summary.totalPlays) || summary.totalPlays < 1 || !Array.isArray(summary.tracks) || summary.tracks.length < 1 || summary.tracks.length > 100000 || !Number.isFinite(Date.parse(summary.firstAt)) || !Number.isFinite(Date.parse(summary.lastAt))) throw Object.assign(new Error('Spotify history contains invalid play data.'), { status: 400 });
  let counted = 0;
  const tracks = [];
  for (const track of summary.tracks) {
    if (!spotifyTrackUri(track?.uri) || typeof track.title !== 'string' || !track.title || track.title.length > 180 || typeof track.artist !== 'string' || !track.artist || track.artist.length > 120 || typeof track.album !== 'string' || track.album.length > 180 || !Number.isSafeInteger(track.plays) || track.plays < 1) throw Object.assign(new Error('Spotify history contains invalid track data.'), { status: 400 });
    counted += track.plays;
    tracks.push({ uri: track.uri, title: track.title, artist: track.artist, album: track.album, plays: track.plays });
  }
  if (counted !== summary.totalPlays) throw Object.assign(new Error('Spotify history play counts did not match.'), { status: 400 });
  return { version: 1, totalPlays: summary.totalPlays, firstAt: summary.firstAt, lastAt: summary.lastAt, importedAt: Date.now(), tracks };
}
function cookies(request) { const header = request.headers.cookie; if (typeof header !== 'string' || header.length > 4096) return {}; return Object.fromEntries(header.split(';').map(pair => { const i = pair.indexOf('='); return i > 0 ? [pair.slice(0, i).trim(), pair.slice(i + 1).trim()] : null; }).filter(Boolean)); }
function sessionCookie(id) { return `rcrd_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(config.sessionMaxAgeSeconds)}`; }
function ensureSession(request, response, create = false) {
  let id = cookies(request).rcrd_session;
  const existing = sessions.get(id);
  if (existing && (!Number.isSafeInteger(existing.expiresAt) || existing.expiresAt <= Date.now())) {
    sessions.delete(id);
    savePersistentSessions();
    response.setHeader('Set-Cookie', 'rcrd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  }
  if ((!/^[a-f0-9]{48}$/.test(id || '') || !sessions.has(id)) && !create) return null;
  if (!sessions.has(id)) { id = random(); sessions.set(id, { expiresAt: Date.now() + config.sessionMaxAgeSeconds * 1000 }); }
  else if (create) sessions.get(id).expiresAt = Date.now() + config.sessionMaxAgeSeconds * 1000;
  request.rcrdSessionId = id;
  if (create) response.setHeader('Set-Cookie', sessionCookie(id));
  return sessions.get(id);
}
function sessionFor(request) { const id = request.rcrdSessionId || cookies(request).rcrd_session; return id ? sessions.get(id) : null; }
function securityHeaders(headers = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://sdk.scdn.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.spotify.com wss://*.spotify.com https://*.scdn.co; frame-src 'self' https://sdk.scdn.co https://*.spotify.com; media-src 'self' blob: https://*.scdn.co",
    ...headers
  };
}
function send(response, status, body, headers = {}) { response.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })); response.end(JSON.stringify(body)); }
function redirect(response, location, headers = {}) { response.writeHead(302, securityHeaders({ Location: location, ...headers })); response.end(); }
function spotifyScopes(includeTop = false) { return ['user-read-currently-playing', 'user-read-playback-state', 'user-modify-playback-state', 'user-library-read', 'user-library-modify', 'user-read-recently-played', 'playlist-read-private', 'playlist-read-collaborative', 'streaming', 'user-read-private', ...(includeTop ? ['user-top-read'] : [])].join(' '); }
function spotifyHasScope(session, scope) { return typeof session?.spotify?.scope === 'string' && session.spotify.scope.split(/\s+/).includes(scope); }
function spotifyTrackUri(uri) { return typeof uri === 'string' && uri.length <= 100 && /^spotify:track:[A-Za-z0-9]+$/.test(uri); }
function spotifyLibraryVersion(session) { return session.spotify.libraryVersion || 0; }
function spotifyLibraryChanged(session, expectedVersion) {
  if (spotifyLibraryVersion(session) === expectedVersion) return;
  const error = new Error('Spotify saved library changed while loading. Try again.'); error.status = 409; throw error;
}
async function spotifyToken(body) { const auth = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64'); const { response, text } = await providerResponse(config.spotify.tokenUrl, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }); const data = providerObject(text, 'Spotify authorization'); if (!response.ok) { const error = new Error('Spotify authorization request failed.'); error.code = data.error; error.status = response.status; throw error; } if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || (body.grant_type === 'authorization_code' && (typeof data.refresh_token !== 'string' || !data.refresh_token))) { const error = new Error('Spotify authorization returned incomplete credentials.'); error.status = 502; throw error; } return data; }
async function spotifyAccess(session) {
  const spotify = session?.spotify;
  if (!config.spotify || !spotify?.refreshToken) return null;
  if (spotify.accessToken && spotify.expiresAt > Date.now() + 60000) return spotify.accessToken;
  if (spotify.refreshPromise) return spotify.refreshPromise;
  const refresh = (async () => {
    try {
      const data = await spotifyToken({ grant_type: 'refresh_token', refresh_token: spotify.refreshToken });
      if (session.spotify !== spotify) { const error = new Error('Spotify account changed while refreshing. Try again.'); error.status = 401; throw error; }
      spotify.accessToken = data.access_token; spotify.expiresAt = Date.now() + (data.expires_in * 1000);
      if (data.refresh_token) spotify.refreshToken = data.refresh_token;
      if (data.scope !== undefined) spotify.scope = typeof data.scope === 'string' ? data.scope : '';
      savePersistentSessions();
      return spotify.accessToken;
    } catch (error) { if (error.code === 'invalid_grant' && session.spotify === spotify) { session.spotify = null; savePersistentSessions(); } throw error; }
  })();
  spotify.refreshPromise = refresh;
  try { return await refresh; } finally { if (spotify.refreshPromise === refresh) delete spotify.refreshPromise; }
}
async function spotifyApi(session, endpoint, options = {}) {
  const accessToken = await spotifyAccess(session); if (!accessToken) throw new Error('Connect Spotify first.');
  const run = async () => {
    const blockedFor = Math.ceil(((session.spotify.rateLimitedUntil || 0) - Date.now()) / 1000);
    if (blockedFor > 0) { const error = new Error(`Spotify request limit reached. Try again in ${blockedFor} seconds.`); error.status = 429; error.retryAfter = blockedFor; throw error; }
    const { response, text } = await providerResponse(`https://api.spotify.com/v1${endpoint}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) } });
    if (!response.ok) {
      let payload = null; try { payload = JSON.parse(text); } catch {}
      const reason = payload?.error?.reason || '';
      const retryAfterHeader = Number(response.headers.get('retry-after') || 0);
      let retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 0;
      if (response.status === 429) {
        if (!retryAfter) { session.spotify.rateLimitBackoffMs = Math.min(Math.max((session.spotify.rateLimitBackoffMs || 15000) * 2, 30000), 900000); retryAfter = Math.ceil(session.spotify.rateLimitBackoffMs / 1000); }
        session.spotify.rateLimitedUntil = Date.now() + (retryAfter * 1000);
        savePersistentSessions();
      }
      const message = response.status === 429
        ? (reason === 'QUOTA_EXCEEDED' ? 'Spotify development quota is currently exhausted. Wait for Spotify to reset the quota before retrying.' : `Spotify request limit reached.${retryAfter > 0 ? ` Try again in ${retryAfter} seconds.` : ' Try again later.'}`)
        : `Spotify request failed (HTTP ${response.status}).`;
      const error = new Error(message); error.status = response.status; error.retryAfter = retryAfter || null; error.reason = reason; throw error;
    }
    if (session.spotify.rateLimitedUntil || session.spotify.rateLimitBackoffMs) { session.spotify.rateLimitedUntil = 0; session.spotify.rateLimitBackoffMs = 0; savePersistentSessions(); }
    if (response.status === 204 || String(options.method || 'GET').toUpperCase() !== 'GET') return null;
    if (!text) return null;
    try { return JSON.parse(text); } catch { const error = new Error('Spotify returned an invalid JSON response.'); error.status = 502; throw error; }
  };
  const previous = session.spotify.requestQueue || Promise.resolve();
  const current = previous.catch(() => {}).then(run);
  session.spotify.requestQueue = current.catch(() => {});
  return current;
}
async function spotifyCached(session, key, ttlMs, load, persistent = false, allowDiskWrite = true, forceRefresh = false) {
  const spotifyAccount = session.spotify;
  const cache = spotifyAccount.cache || (spotifyAccount.cache = new Map());
  const cached = cache.get(key);
  if (cached?.promise) return cached.promise;
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  if (!forceRefresh && persistent && !(key === 'library' && session.spotify.libraryCacheDirty)) { const diskEntry = readSpotifyDiskEntry(session, key); if (diskEntry) { cache.set(key, diskEntry); return diskEntry.value; } }
  const libraryVersion = key === 'library' ? spotifyLibraryVersion(session) : null;
  const promise = Promise.resolve().then(() => load(libraryVersion));
  const entry = { expiresAt: Date.now() + ttlMs, promise };
  cache.set(key, entry);
  try {
    const value = await promise;
    if (session.spotify !== spotifyAccount) { const error = new Error('Spotify account changed while loading. Try again.'); error.status = 409; throw error; }
    if (libraryVersion !== null) spotifyLibraryChanged(session, libraryVersion);
    if (cache.get(key) !== entry) return value;
    const expiresAt = Date.now() + ttlMs; cache.set(key, { expiresAt, value }); if (persistent && allowDiskWrite && !(key === 'library' && session.spotify.libraryCacheDirty)) writeSpotifyDiskEntry(session, key, expiresAt, value); return value;
  }
  catch (error) { if (cache.get(key) === entry) { if (forceRefresh && cached?.value !== undefined) cache.set(key, cached); else cache.delete(key); } throw error; }
}
function musicName(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
function musicMbid(value) { return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value); }
function metadataContact() {
  const value = String(process.env.RCRD_METADATA_CONTACT || '').trim();
  if (!value || value.length > 200 || /[\r\n()]/.test(value)) return '';
  if (/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) return value;
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.hostname.includes('.') && !net.isIP(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/.test(url.hostname)) return url.href; } catch {}
  return '';
}
const publicMusicState = new Map();
async function publicMusicJson(url, ensure) {
  const parsed = new URL(url); const contact = metadataContact();
  if (!contact) throw Object.assign(new Error('metadata-contact-required'), { code: 'metadata-contact-required' });
  const allowed = parsed.origin === 'https://musicbrainz.org' && (parsed.pathname === '/ws/2/url' || /^\/ws\/2\/isrc\/[A-Za-z0-9]{12}$/.test(parsed.pathname)) || parsed.origin === 'https://api.listenbrainz.org' && parsed.pathname.startsWith('/1/lb-radio/artist/') && musicMbid(parsed.pathname.slice('/1/lb-radio/artist/'.length));
  if (!allowed || parsed.username || parsed.password || parsed.hash || parsed.href.length > 8000) throw new Error('Unsupported public music lookup.');
  let state = publicMusicState.get(parsed.origin);
  if (!state) { state = { queue: Promise.resolve(), nextAt: 0, blockedUntil: 0, cache: new Map() }; publicMusicState.set(parsed.origin, state); }
  const cached = state.cache.get(parsed.href); if (cached?.expiresAt > Date.now()) { ensure(); return cached.value; }
  const work = state.queue.catch(() => {}).then(async () => {
    ensure();
    const repeated = state.cache.get(parsed.href); if (repeated?.expiresAt > Date.now()) return repeated.value;
    if (state.blockedUntil > Date.now()) throw Object.assign(new Error('Public music service is temporarily throttled.'), { status: 429 });
    const delay = state.nextAt - Date.now(); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay)); ensure();
    state.nextAt = Date.now() + 1000;
    const { response, text } = await providerResponse(parsed.href, { signal: ensure.signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': `RCRD/${appVersion} (${contact})` } }); ensure();
    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    if (remaining === '0') state.blockedUntil = Date.now() + (discogsRetryAfter(response.headers.get('x-ratelimit-reset-in')) || 1) * 1000;
    if (!response.ok) { if ([429, 503].includes(response.status)) state.blockedUntil = Date.now() + (discogsRetryAfter(response.headers?.get?.('retry-after')) || 60) * 1000; throw Object.assign(new Error('Public music lookup failed.'), { status: response.status }); }
    const value = providerObject(text, 'Public music service');
    if (state.cache.size >= 64) state.cache.delete(state.cache.keys().next().value);
    state.cache.set(parsed.href, { expiresAt: Date.now() + 86400000, value }); return value;
  });
  state.queue = work.catch(() => {}); return work;
}
function musicArtistLinks(data) {
  const rows = Array.isArray(data?.urls) ? data.urls : [data]; const links = new Map(); const rejected = new Set();
  for (const row of rows.slice(0, 40)) {
    const match = /^https:\/\/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})$/.exec(row?.resource || ''); if (!match) continue;
    const ids = [...new Set((Array.isArray(row.relations) ? row.relations : []).filter(relation => !relation.ended && (relation['target-type'] === 'artist' || relation.artist)).map(relation => relation.artist?.id).filter(musicMbid))];
    const id = match[1];
    if (ids.length > 1 || links.has(id) && ids.length === 1 && links.get(id) !== ids[0]) { links.delete(id); rejected.add(id); }
    if (ids.length === 1 && !rejected.has(id)) links.set(id, ids[0]);
  }
  return links;
}
async function spotifyMixDiscovery(session, seed, ensure) {
  const account = session.spotify; const key = `mix-discovery:${seed.uri}`;
  const cached = account.cache?.get(key); if (cached?.expiresAt > Date.now()) return cached.value;
  const warnings = new Set(); const tracks = []; const artists = new Map();
  const lead = seed.artists[0];
  const search = async (name, album = '') => {
    const clean = value => value.replace(/["\\]/g, ' ').trim();
    const query = `artist:"${clean(name)}"${album ? ` album:"${clean(album)}"` : ''}`;
    ensure(); let data; try { data = await spotifyApi(session, `/search?q=${enc(query)}&type=track&limit=10&offset=0`); } catch (error) { error.spotifyDiscovery = true; throw error; } ensure();
    if (!Array.isArray(data?.tracks?.items)) throw new Error('Invalid Spotify discovery search.');
    return data.tracks.items.slice(0, 10).filter(track => typeof track?.artists?.[0]?.id === 'string' && /^[A-Za-z0-9]{22}$/.test(track.artists[0].id) && musicName(track.artists[0].name) === musicName(name) && (!album || musicName(track.album?.name) === musicName(album)));
  };
  let metadataStage = 'musicbrainz';
  if (!metadataContact()) warnings.add('metadata-contact-required');
  else try {
    const seedUrl = `https://open.spotify.com/artist/${lead.id}`;
    let lookup; try { lookup = await publicMusicJson(`https://musicbrainz.org/ws/2/url?${new URLSearchParams({ resource: seedUrl, inc: 'artist-rels', fmt: 'json' })}`, ensure); } catch (error) { if (error.status !== 404) throw error; lookup = {}; }
    let mbid = musicArtistLinks(lookup).get(lead.id);
    if (!mbid && /^[A-Za-z0-9]{12}$/.test(seed.external_ids?.isrc || '')) {
      const data = await publicMusicJson(`https://musicbrainz.org/ws/2/isrc/${seed.external_ids.isrc}?inc=artist-credits&fmt=json`, ensure);
      const ids = [...new Set((Array.isArray(data.recordings) ? data.recordings : []).slice(0, 50).flatMap(recording => Array.isArray(recording['artist-credit']) ? recording['artist-credit'] : []).filter(credit => musicName(credit.artist?.name) === musicName(lead.name)).map(credit => credit.artist?.id).filter(musicMbid))]; if (ids.length === 1) mbid = ids[0];
    }
    if (!mbid) warnings.add('musicbrainz-unresolved');
    else {
      metadataStage = 'listenbrainz';
      const radio = await publicMusicJson(`https://api.listenbrainz.org/1/lb-radio/artist/${mbid}?mode=easy&max_similar_artists=32&max_recordings_per_artist=10&pop_begin=0&pop_end=100`, ensure);
      const related = new Map();
      for (const [id, rows] of Object.entries(radio).slice(0, 40)) if (musicMbid(id) && Array.isArray(rows)) for (const row of rows.slice(0, 10)) if (row?.similar_artist_mbid === id && typeof row.similar_artist_name === 'string' && row.similar_artist_name.length <= 180) { related.set(id, row.similar_artist_name); break; }
      if (!related.size) warnings.add('listenbrainz-empty');
      const candidates = []; const expected = new Map();
      for (const [id, name] of [...related].slice(0, 32)) {
        if (Date.now() > ensure.deadline - 15000) { warnings.add('discovery-time-limit'); break; }
        try { const found = await search(name); for (const track of found) { candidates.push(track); const spotifyId = track.artists[0].id; if (!expected.has(spotifyId)) expected.set(spotifyId, new Set()); expected.get(spotifyId).add(id); } }
        catch (error) { ensure(); if ([401, 429, 409].includes(error.status)) throw error; warnings.add('spotify-discovery-partial'); }
      }
      if (expected.size) {
        metadataStage = 'musicbrainz';
        const params = new URLSearchParams({ inc: 'artist-rels', fmt: 'json' });
        for (const id of [...expected.keys()].slice(0, 40)) params.append('resource', `https://open.spotify.com/artist/${id}`);
        const verified = musicArtistLinks(await publicMusicJson(`https://musicbrainz.org/ws/2/url?${params}`, ensure));
        for (const track of candidates) { const id = track.artists[0].id; if (expected.get(id)?.size === 1 && expected.get(id).has(verified.get(id))) { artists.set(id, { id, source: 'listenbrainz' }); tracks.push(track); } }
      }
      if (related.size && !tracks.length) warnings.add('spotify-discovery-empty');
    }
  } catch (error) { ensure(); if ([401, 409].includes(error.status) || error.status === 429 && error.spotifyDiscovery) throw error; warnings.add(error.code === 'metadata-contact-required' ? error.code : `${metadataStage}-unavailable`); }
  // Style matches require both artist and album identity, never a broad genre alone.
  if (tracks.length < 240 || artists.size < 25 || new Set(tracks.map(track => track.album?.id).filter(Boolean)).size < 35) try {
    const headers = { Authorization: `Discogs key=${enc(config.key)}, secret=${enc(config.secret)}` };
    const discogsName = value => musicName(value).replace(/\s*\(\d+\)$/, '');
    const album = seed.album?.name;
    if (typeof album === 'string' && album.length <= 180) {
      const result = await discogsJson(`https://api.discogs.com/database/search?${new URLSearchParams({ artist: lead.name, release_title: album, type: 'master', per_page: '5', page: '1' })}`, { headers, signal: ensure.signal, redirect: 'error' }); ensure();
      if (!Array.isArray(result.results)) throw new Error('Invalid Discogs discovery results.');
      const split = value => { const index = String(value || '').indexOf(' - '); return index > 0 ? [String(value).slice(0, index), String(value).slice(index + 3)] : []; };
      const exact = result.results.slice(0, 5).filter(row => { const [artist, title] = split(row.title); return discogsName(artist) === musicName(lead.name) && musicName(title) === musicName(album); });
      const genres = new Set(exact.flatMap(row => Array.isArray(row.genre) ? row.genre : []).filter(value => typeof value === 'string').map(musicName));
      const broad = new Set(['rock', 'pop', 'electronic', 'hip hop', 'hip-hop', 'indie rock', 'alternative rock', 'pop rock', 'folk', 'jazz', 'classical']);
      const styles = [...new Set(exact.flatMap(row => Array.isArray(row.style) ? row.style : []).filter(style => typeof style === 'string' && style.length <= 80 && !broad.has(musicName(style))))].slice(0, 2);
      if (!styles.length) warnings.add('discogs-empty');
      const seen = new Set(); let searches = 0;
      for (const style of styles) {
        if (Date.now() > ensure.deadline - 10000) { warnings.add('discovery-time-limit'); break; }
        const data = await discogsJson(`https://api.discogs.com/database/search?${new URLSearchParams({ style, type: 'master', per_page: '50', page: '1' })}`, { headers, signal: ensure.signal, redirect: 'error' }); ensure();
        if (!Array.isArray(data.results)) throw new Error('Invalid Discogs style results.');
        for (const row of data.results.slice(0, 50)) {
          if (searches >= 36 || tracks.length >= 360) break;
          if (Date.now() > ensure.deadline - 10000) { warnings.add('discovery-time-limit'); break; }
          if (!genres.size || !Array.isArray(row.genre) || !row.genre.some(value => genres.has(musicName(value))) || !Array.isArray(row.style) || !row.style.some(value => musicName(value) === musicName(style))) continue;
          const [artist, title] = split(row.title); if (!artist || !title || artist.length > 180 || title.length > 180 || musicName(artist) === 'various' || /greatest hits|best of|anthology/i.test(title)) continue;
          const name = artist.replace(/\s*\(\d+\)$/, ''); const identity = `${musicName(name)}|${musicName(title)}`; if (seen.has(identity)) continue; seen.add(identity); searches++;
          const found = await search(name, title); const ids = [...new Set(found.map(track => track.artists[0].id))]; if (ids.length !== 1) continue;
          if (!artists.has(ids[0])) artists.set(ids[0], { id: ids[0], source: 'discogs-style', style }); tracks.push(...found);
        }
      }
    }
  } catch (error) { ensure(); if ([401, 409].includes(error.status) || error.status === 429 && error.spotifyDiscovery) throw error; warnings.add('discogs-unavailable'); }
  ensure();
  const value = { discoveryArtists: [...artists.values()].slice(0, 40), discoveryTracks: tracks.slice(0, 1000), discoveryWarnings: [...warnings] };
  const cache = account.cache || (account.cache = new Map()); const keys = [...cache.keys()].filter(value => value.startsWith('mix-discovery:')); if (keys.length >= 12) cache.delete(keys[0]);
  cache.set(key, { expiresAt: Date.now() + (tracks.length >= 100 ? 300000 : 15000), value }); return value;
}
async function spotifyMixSources(session, uri, alive = () => true, signal = undefined) {
  const account = session.spotify;
  const check = () => { if (session.spotify !== account || !alive() || signal?.aborted) throw Object.assign(new Error('Mix lookup was cancelled or the Spotify account changed.'), { status: 409 }); };
  if (account.mixSourceBusy) throw Object.assign(new Error('A Mix lookup is already running. Try again after it finishes.'), { status: 409 });
  account.mixSourceBusy = true;
  try {
    const deadline = Date.now() + 55000;
    const ensure = () => { check(); if (Date.now() > deadline) throw Object.assign(new Error('Mix lookup timed out. Try again after the cached sources finish loading.'), { status: 504 }); };
    ensure.deadline = deadline; ensure.signal = signal;
    const profile = await spotifyProfile(session); ensure();
    const seed = await spotifyApi(session, `/tracks/${enc(uri.split(':')[2])}`); ensure();
    const lead = seed?.artists?.[0]?.id;
    if (seed?.uri !== uri || !/^[A-Za-z0-9]{22}$/.test(lead || '')) throw Object.assign(new Error('Spotify did not return valid artist credits for this song.'), { status: 502 });
    const discovery = await spotifyMixDiscovery(session, seed, ensure); ensure();
    let partial = false;
    const pages = async endpoint => {
      const result = [];
      for (let offset = 0; offset < 200; offset += 50) {
        ensure(); const page = await spotifyApi(session, `${endpoint}?limit=50&offset=${offset}`); ensure();
        if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.total) || page.total < 0) throw Object.assign(new Error('Spotify returned invalid Mix source data.'), { status: 502 });
        result.push(...page.items.slice(0, 50));
        if (!page.next || offset + 50 >= page.total) return { items: result, limited: false };
        if (page.items.length !== 50) throw Object.assign(new Error('Spotify returned an incomplete Mix source page.'), { status: 502 });
      }
      return { items: result, limited: true };
    };
    const playlists = [];
    if (discovery.discoveryTracks.length < 100 && Date.now() < deadline - 10000) {
    const lists = await spotifyCached(session, 'mix-playlists', 900000, () => pages('/me/playlists')); ensure(); partial ||= lists.limited;
    const readable = lists.items.filter(item => /^[A-Za-z0-9]{22}$/.test(item?.id || '') && (item.owner?.id === profile.id || item.collaborative));
    const snapshots = new Map();
    const full = list => { if (!snapshots.has(list.id)) { const entry = account.cache?.get(`playlist:${list.id}`); snapshots.set(list.id, entry?.expiresAt > Date.now() && Array.isArray(entry.value) ? entry.value : spotifyPlaylistSnapshot(session, `playlist:${list.id}`)?.value); } return snapshots.get(list.id); };
    const mapped = new Map();
    const entries = list => { if (!mapped.has(list.id)) mapped.set(list.id, full(list)?.map(entry => entry?.item || entry?.track).filter(Boolean)); return mapped.get(list.id); };
    const containsSeed = tracks => Boolean(tracks?.some(track => track?.artists?.some(artist => artist.id === lead)));
    readable.sort((a, b) => Number(containsSeed(entries(b))) - Number(containsSeed(entries(a))));
    if (readable.length > 8) partial = true;
    for (const list of readable.slice(0, 8)) {
      if (Date.now() > deadline - 5000) { partial = true; break; }
      ensure();
      try {
        let tracks = entries(list);
        if (!tracks) {
          const items = await spotifyCached(session, `mix-playlist:${list.id}`, 900000, () => pages(`/playlists/${enc(list.id)}/items`));
          partial ||= items.limited; tracks = items.items.map(entry => entry.item || entry.track).filter(Boolean);
        }
        ensure(); if (tracks.length > 2000) partial = true;
        playlists.push({ id: list.id, tracks: tracks.slice(0, 2000) });
      } catch (error) { ensure(); if ([401, 429, 409, 504].includes(error.status)) throw error; partial = true; }
    }
    }
    let savedTracks = [];
    try {
      const memory = account.cache?.get('library');
      const library = !account.libraryCacheDirty && (memory?.expiresAt > Date.now() ? memory.value : spotifyLibrarySnapshot(session)?.value);
      if (library?.saved) savedTracks = library.saved;
      else if (discovery.discoveryTracks.length < 100 && Date.now() < deadline - 5000) { const saved = await spotifyCached(session, 'mix-saved', 300000, () => pages('/me/tracks')); partial ||= saved.limited; savedTracks = saved.items; }
      if (savedTracks.length > 10000) partial = true;
      ensure(); savedTracks = savedTracks.slice(0, 10000).map(entry => entry.track).filter(Boolean);
    } catch (error) { ensure(); if ([401, 429, 409, 504].includes(error.status)) throw error; partial = true; }
    const candidateUris = new Set([...savedTracks, ...playlists.flatMap(list => list.tracks), ...discovery.discoveryTracks].map(track => track.uri));
    const playCounts = {};
    try { const history = readListeningHistory(session); for (const track of history?.tracks || []) if (candidateUris.has(track.uri) && Number.isSafeInteger(track.plays) && track.plays > 0) playCounts[track.uri] = track.plays; }
    catch { partial = true; }
    const compact = track => ({ uri: track.uri, type: track.type, name: typeof track.name === 'string' ? track.name.slice(0, 300) : '', artists: Array.isArray(track.artists) ? track.artists.slice(0, 10).map(artist => ({ id: artist?.id, name: typeof artist?.name === 'string' ? artist.name.slice(0, 180) : '' })) : [], album: { id: track.album?.id, name: typeof track.album?.name === 'string' ? track.album.name.slice(0, 300) : '' }, is_local: track.is_local === true, is_playable: track.is_playable, restrictions: Object.keys(track.restrictions || {}).length ? { reason: 'restricted' } : {}, external_ids: { isrc: track.external_ids?.isrc } });
    ensure(); return { seed: compact(seed), playlists: playlists.map(list => ({ id: list.id, tracks: list.tracks.map(compact) })), savedTracks: savedTracks.map(compact), playCounts, partial, ...discovery, discoveryTracks: discovery.discoveryTracks.map(compact) };
  } finally { account.mixSourceBusy = false; }
}
function clearSpotifyLibraryDisk(session) {
  for (const key of ['library', 'checkpoint:library-tracks', 'checkpoint:library-albums']) clearSpotifyDiskEntry(session, key);
  for (const key of ['checkpoint:library-tracks', 'checkpoint:library-albums']) clearSpotifyCheckpoint(session, key);
}
function invalidateSpotifyLibrary(session) {
  session.spotify.libraryVersion = spotifyLibraryVersion(session) + 1;
  session.spotify.cache?.delete('library');
  clearSpotifyLibraryDisk(session);
}
function beginSpotifyLibraryMutation(session) {
  const spotify = session.spotify;
  const previousDirty = Boolean(spotify.libraryCacheDirty);
  const previousCleanupRequired = Boolean(spotify.libraryCleanupRequired);
  if (previousDirty && !spotify.libraryMutationsInFlight) spotify.libraryCleanupRequired = true;
  if (!previousDirty) spotify.libraryCleanupRequired = false;
  spotify.libraryCacheDirty = true;
  try { savePersistentSessions(); }
  catch (error) { spotify.libraryCacheDirty = previousDirty; spotify.libraryCleanupRequired = previousCleanupRequired; throw error; }
  spotify.libraryMutationsInFlight = (spotify.libraryMutationsInFlight || 0) + 1;
  return spotify;
}
function finishSpotifyLibraryMutation(session, spotify, providerSucceeded) {
  const current = session.spotify === spotify;
  let cleanupFailed = false;
  if (providerSucceeded) {
    spotify.libraryCleanupRequired = true;
    try { invalidateSpotifyLibrary(current ? session : { spotify }); spotify.libraryCleanupRequired = false; }
    catch { cleanupFailed = true; spotify.libraryCleanupRetryAt = 0; }
  }
  spotify.libraryMutationsInFlight = Math.max(0, (spotify.libraryMutationsInFlight || 1) - 1);
  if (current && !spotify.libraryMutationsInFlight && !spotify.libraryCleanupRequired) {
    spotify.libraryCacheDirty = false;
    try { savePersistentSessions(); }
    catch { spotify.libraryCacheDirty = true; spotify.libraryCleanupRetryAt = 0; cleanupFailed = true; }
  }
  return providerSucceeded && cleanupFailed ? 'Spotify updated the track, but the local saved-library cache could not be cleared. Saved music will refresh from Spotify.' : null;
}
function retrySpotifyLibraryCleanup(session) {
  if (!session.spotify.libraryCacheDirty || session.spotify.libraryMutationsInFlight || (session.spotify.libraryCleanupRetryAt || 0) > Date.now()) return;
  if (session.spotify.libraryCleanupRequired === false) {
    session.spotify.libraryCacheDirty = false;
    try { savePersistentSessions(); }
    catch { session.spotify.libraryCacheDirty = true; session.spotify.libraryCleanupRetryAt = Date.now() + 30000; }
    return;
  }
  try {
    clearSpotifyLibraryDisk(session);
    session.spotify.libraryCacheDirty = false;
    try { savePersistentSessions(); session.spotify.libraryCleanupRequired = false; }
    catch { session.spotify.libraryCacheDirty = true; session.spotify.libraryCleanupRetryAt = Date.now() + 30000; }
  } catch { session.spotify.libraryCleanupRetryAt = Date.now() + 30000; /* Serve fresh data without using stale disk entries. */ }
}
function spotifyUiProfile(profile) {
  const image = profile?.images?.[0]?.url;
  let safeImage = '';
  try { if (new URL(image).protocol === 'https:') safeImage = image; } catch {}
  return {
    id: profile?.id,
    display_name: typeof profile?.display_name === 'string' ? profile.display_name : null,
    images: safeImage ? [{ url: safeImage }] : [],
    followers: { total: Number.isSafeInteger(profile?.followers?.total) && profile.followers.total >= 0 ? profile.followers.total : 0 }
  };
}
async function spotifyProfile(session) {
  const profile = spotifyUiProfile(await spotifyCached(session, 'profile', 86400000, async () => spotifyUiProfile(await spotifyApi(session, '/me')), Boolean(session.spotify.userId), !session.spotify.libraryCacheDirty));
  if (typeof profile?.id !== 'string' || !profile.id || (session.spotify.userId && profile.id !== session.spotify.userId)) { session.spotify.cache?.delete('profile'); clearSpotifyDiskEntry(session, 'profile'); const error = new Error('Spotify returned an invalid account profile.'); error.status = 502; throw error; }
  if (!session.spotify.userId) { session.spotify.userId = profile.id; if (!session.spotify.libraryCacheDirty) writeSpotifyDiskEntry(session, 'profile', Date.now() + 86400000, profile); savePersistentSessions(); }
  return profile;
}
function sendSpotifyError(response, error, fallbackStatus = 502, allowedStatuses = []) {
  const status = error.status === 429 ? 429 : allowedStatuses.includes(error.status) ? error.status : fallbackStatus;
  const body = { error: error.message };
  const headers = {};
  if (status === 429) { body.retryAfter = error.retryAfter || null; body.reason = error.reason || null; if (error.retryAfter) headers['Retry-After'] = String(error.retryAfter); }
  return send(response, status, body, headers);
}
async function spotifyPages(session, endpoint, pageSize = 50, checkpointKey = '', expectedLibraryVersion = null, preview = false) {
  const pageAccount = session.spotify;
  const verifyLibrary = () => { if (session.spotify !== pageAccount) { const error = new Error('Spotify account changed while loading. Try again.'); error.status = 409; throw error; } if (expectedLibraryVersion !== null) spotifyLibraryChanged(session, expectedLibraryVersion); };
  verifyLibrary();
  if (expectedLibraryVersion !== null && session.spotify.libraryCacheDirty) checkpointKey = '';
  let checkpoint = checkpointKey ? readSpotifyCheckpoint(session, checkpointKey) : null;
  if (!checkpoint && checkpointKey) {
    const legacy = readSpotifyDiskEntry(session, checkpointKey)?.value;
    if (legacy && Array.isArray(legacy.items) && Number.isSafeInteger(legacy.offset) && legacy.offset === legacy.items.length && legacy.offset <= maxPaginatedItems && Number.isSafeInteger(legacy.total) && legacy.total >= legacy.offset && legacy.total <= maxPaginatedItems && (!legacy.complete || legacy.total === legacy.offset)) {
      for (let offset = 0; offset < legacy.items.length; offset += pageSize) {
        const items = legacy.items.slice(offset, offset + pageSize);
        writeSpotifyCheckpoint(session, checkpointKey, offset, items, legacy.total, Boolean(legacy.complete) && offset + items.length === legacy.items.length);
      }
      if (!legacy.items.length && legacy.complete) writeSpotifyCheckpoint(session, checkpointKey, 0, [], legacy.total, true);
      clearSpotifyDiskEntry(session, checkpointKey);
      checkpoint = readSpotifyCheckpoint(session, checkpointKey);
    }
  }
  if (checkpoint?.complete && Array.isArray(checkpoint.items)) {
    const part = checkpointKey === 'checkpoint:library-tracks' ? 'tracks' : checkpointKey === 'checkpoint:library-albums' ? 'albums' : '';
    if (session.spotify.libraryProgress?.active && part) { session.spotify.libraryProgress.phase = part; session.spotify.libraryProgress[part] = { loaded: checkpoint.items.length, total: checkpoint.total }; }
    return preview ? { items: checkpoint.items.slice(0, pageSize), total: checkpoint.total } : checkpoint.items;
  }
  const items = checkpoint?.items || [];
  let offset = checkpoint ? Number(checkpoint.offset || items.length) : 0;
  let total = checkpoint ? Number(checkpoint.total || Infinity) : Infinity;
  const progress = session.spotify.libraryProgress;
  const progressPart = checkpointKey === 'checkpoint:library-tracks' ? 'tracks' : checkpointKey === 'checkpoint:library-albums' ? 'albums' : '';
  if (progress?.active && progressPart) { progress.phase = progressPart; progress[progressPart] = { loaded: offset, total: Number.isFinite(total) ? total : null }; }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maxPaginatedItems || (Number.isFinite(total) && (!Number.isSafeInteger(total) || total < 0 || total > maxPaginatedItems))) throw new Error('Saved Spotify progress is invalid.');
  if (preview && items.length) return { items: items.slice(0, pageSize), total };
  while (offset < total) {
    verifyLibrary();
    if (Math.floor(offset / pageSize) >= maxPaginationPages) throw new Error('Spotify library exceeds the supported page limit.');
    const separator = endpoint.includes('?') ? '&' : '?';
    const page = await spotifyApi(session, `${endpoint}${separator}limit=${pageSize}&offset=${offset}`);
    verifyLibrary();
    if (!Array.isArray(page?.items) || page.items.length > pageSize || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > maxPaginatedItems) throw new Error('Spotify returned invalid pagination data.');
    const pageItems = page.items;
    if (items.length + pageItems.length > maxPaginatedItems) throw new Error('Spotify library exceeds the supported item limit.');
    const pageOffset = offset; items.push(...pageItems); total = page.total; offset += pageItems.length;
    if (progress?.active && progressPart) progress[progressPart] = { loaded: offset, total };
    if (offset < total && (!page.next || !pageItems.length)) throw new Error('Spotify returned an incomplete page.');
    const complete = !page.next || offset >= total;
    if (checkpointKey) writeSpotifyCheckpoint(session, checkpointKey, pageOffset, pageItems, total, complete);
    if (preview) return { items: items.slice(0, pageSize), total };
    if (complete) break;
  }
  verifyLibrary();
  return items;
}
async function discogsIdentity(session) { const identity = await discogsJson('https://api.discogs.com/oauth/identity', { headers: { Authorization: oauthHeader({ token: session.accessToken, tokenSecret: session.accessSecret }) } }); if (typeof identity.username !== 'string' || !identity.username) { const error = new Error('Discogs returned an invalid account profile.'); error.status = 502; throw error; } return identity; }
function discogsReleaseSummary(release) {
  const short = value => String(value == null ? '' : value).slice(0, 180);
  const labels = Array.isArray(release.labels) ? release.labels.slice(0, 5).map(item => ({ name: short(item?.name), catalogNumber: short(item?.catno) })) : [];
  const formats = Array.isArray(release.formats) ? release.formats.slice(0, 5).map(item => ({ name: short(item?.name), quantity: short(item?.qty), descriptions: Array.isArray(item?.descriptions) ? item.descriptions.slice(0, 8).map(short) : [] })) : [];
  const identifiers = Array.isArray(release.identifiers) ? release.identifiers.filter(item => ['Barcode', 'Matrix / Runout'].includes(item?.type)).slice(0, 8).map(item => ({ type: short(item.type), value: short(item.value) })) : [];
  return { id: release.id, title: short(release.title), artists: Array.isArray(release.artists) ? release.artists.slice(0, 5).map(item => short(item?.name)) : [], year: Number.isSafeInteger(release.year) ? release.year : null, country: short(release.country), labels, formats, identifiers, trackCount: Array.isArray(release.tracklist) ? release.tracklist.length : null };
}
async function discogsPages(session, endpoint) {
  const items = []; let page = 1; let pages = 1;
  do {
    if (page > maxPaginationPages) throw new Error('Discogs collection exceeds the supported page limit.');
    const separator = endpoint.includes('?') ? '&' : '?';
    const data = await discogsJson(`${endpoint}${separator}per_page=100&page=${page}`, { headers: { Authorization: oauthHeader({ token: session.accessToken, tokenSecret: session.accessSecret }) } });
    const records = data.releases || data.wants;
    pages = Number(data.pagination?.pages || 1);
    if (!Array.isArray(records) || records.length > 100 || !Number.isSafeInteger(pages) || pages < 1 || pages > maxPaginationPages || items.length + records.length > maxPaginatedItems) throw new Error('Discogs returned invalid or excessive pagination data.');
    if (!records.length && page < pages) throw new Error('Discogs returned an incomplete page.');
    items.push(...records); page += 1;
  } while (page <= pages);
  return items;
}
function html(response, file, request) {
  if (file === 'walkthrough/RCRD-complete-walkthrough.mp4') return walkthroughVideo(response, request);
  const stream = fs.createReadStream(path.join(root, file));
  stream.on('error', () => { if (!response.headersSent) send(response, 404, { error: 'Not found' }); else response.destroy(); });
  stream.on('open', () => { if (response.destroyed) return stream.destroy(); response.writeHead(200, securityHeaders({ 'Content-Type': publicFiles.get(file), 'Cache-Control': 'no-cache' })); stream.pipe(response); });
}
function walkthroughVideo(response, request) {
  const file = path.join(root, 'walkthrough', 'RCRD-complete-walkthrough.mp4');
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return send(response, 404, { error: 'Not found' });
    const size = stat.size;
    const range = request.headers.range;
    let start = 0;
    let end = size - 1;
    if (range !== undefined) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        response.writeHead(416, securityHeaders({ 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }));
        return response.end();
      }
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix < 1) {
          response.writeHead(416, securityHeaders({ 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }));
          return response.end();
        }
        start = Math.max(0, size - suffix);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
        response.writeHead(416, securityHeaders({ 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }));
        return response.end();
      }
      end = Math.min(end, size - 1);
    }
    const headers = securityHeaders({ 'Content-Type': 'video/mp4', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(range === undefined ? {} : { 'Content-Range': `bytes ${start}-${end}/${size}` }) });
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => response.destroy());
    response.writeHead(range === undefined ? 200 : 206, headers);
    stream.pipe(response);
  });
}

function allowedHost(request) {
  const hostHeader = String(request.headers.host || '').trim().toLowerCase();
  if (!hostHeader) return false;
  const boundPort = server.address()?.port || port;
  let hostname = hostHeader;
  let portValue = '';
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    if (end === -1) return false;
    hostname = hostHeader.slice(0, end + 1);
    portValue = hostHeader.slice(end + 2);
  } else {
    const index = hostHeader.lastIndexOf(':');
    if (index > -1) {
      hostname = hostHeader.slice(0, index);
      portValue = hostHeader.slice(index + 1);
    }
  }
  const normalizedHost = hostname.replace(/\[|\]/g, '');
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!allowedHosts.has(normalizedHost)) return false;
  return !portValue || Number(portValue) === boundPort;
}
function allowedMutation(request, pathname) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || !pathname.startsWith('/api/')) return true;
  const origin = request.headers.origin;
  const host = request.headers.host || '';
  if (!host || request.headers['x-rcrd-request'] !== '1') return false;
  const expected = `http://${host}`;
  if (!origin) return true;
  return origin === expected;
}

let restartPending = false;
async function requestServerRestart() {
  if (process.platform !== 'win32') throw Object.assign(new Error('Settings restart is available on Windows only.'), { status: 503 });
  if (restartPending) throw Object.assign(new Error('RCRD is already restarting.'), { status: 409 });
  let runtime;
  try { runtime = JSON.parse(fs.readFileSync(pidFile, 'utf8')); } catch {}
  if (!runtime || runtime.pid !== process.pid || runtime.port !== port || path.resolve(runtime.root || '') !== root) {
    throw Object.assign(new Error('Restart unavailable: launch RCRD with its launcher first.'), { status: 503 });
  }
  restartPending = true;
  const handoffId = random();
  const readyFile = path.join(runtimeDirectory, `restart-ready-${handoffId}`);
  let child;
  try {
    child = spawn(process.execPath, [path.join(root, 'scripts', 'Restart-RCRD.cjs'), String(process.pid), String(port), handoffId], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) reject(error); else resolve();
      };
      const onError = error => finish(error);
      const onExit = code => finish(Object.assign(new Error('Restart helper exited'), { helperExitCode: code }));
      const poll = setInterval(() => {
        try {
          if (fs.readFileSync(readyFile, 'utf8') === handoffId) return finish();
          return finish(new Error('Invalid restart helper'));
        } catch (error) { if (error.code !== 'ENOENT') return finish(error); }
        if (Date.now() >= deadline) finish(new Error('Restart helper unavailable'));
      }, 50);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    child.once('exit', () => { restartPending = false; });
    child.unref();
  } catch (error) {
    restartPending = false;
    if (child?.pid) { try { child.kill(); } catch {} }
    const diagnostic = Number.isInteger(error.helperExitCode) ? `helper-${error.helperExitCode}`
      : error.message === 'Invalid restart helper' ? 'invalid-ready'
      : typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,15}$/.test(error.code) ? `os-${error.code}`
      : 'unknown';
    const message = error.code === 'EPERM' || error.code === 'EACCES'
      ? 'Windows blocked the restart helper. Close RCRD and launch it directly from your Windows shortcut, then try again.'
      : error.helperExitCode === 2 ? 'Restart helper rejected the handoff. Restart RCRD with its launcher before trying again.'
      : error.helperExitCode === 3 ? 'Restart helper could not create its readiness marker. Check write access to the RCRD .data folder.'
      : error.helperExitCode === 4 ? 'Restart helper could not verify when the current server exits. Use the RCRD launcher to restart manually.'
      : error.message === 'Restart helper unavailable' ? 'Restart helper did not become ready within five seconds. Use the RCRD launcher to restart manually.'
      : `Could not launch the restart (code ${diagnostic}). Use the RCRD launcher to restart manually.`;
    throw Object.assign(new Error(message), { status: 503 });
  } finally {
    try { fs.unlinkSync(readyFile); } catch (error) { if (error.code !== 'ENOENT') console.error('RCRD restart handoff cleanup failed:', error.code || error.name); }
    try { fs.unlinkSync(`${readyFile}.tmp`); } catch (error) { if (error.code !== 'ENOENT') console.error('RCRD restart handoff cleanup failed:', error.code || error.name); }
  }
}

async function handle(request, response) {
  try {
    if (!allowedHost(request)) return send(response, 403, { error: 'Request not allowed' });
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (!allowedMutation(request, url.pathname)) return send(response, 403, { error: 'Request not allowed' });
    ensureSession(request, response);
    const callbackOrigin = new URL(config.spotify?.redirectUri || config.callbackUrl).origin;
    if (url.hostname === 'localhost' && callbackOrigin !== url.origin) return redirect(response, `${callbackOrigin}${url.pathname}${url.search}`);
    if (request.method === 'GET' && url.pathname === '/api/health') return send(response, 200, { ok: true, app: 'rcrd', version: appVersion, pid: process.pid });
    if (request.method === 'GET' && url.pathname === '/genius-embed') {
      const id = url.searchParams.get('id');
      if (!id || !/^[1-9][0-9]{0,11}$/.test(id)) return send(response, 400, { error: 'Invalid Genius song.' });
      const nonce = crypto.randomBytes(16).toString('base64');
      response.writeHead(200, securityHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': `default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'nonce-${nonce}' https://genius.com https://assets.genius.com; script-src-attr 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src https://genius.com; frame-src 'none'`
      }));
      return response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:16px;background:#19211c;color:#eef2ed;font:14px/1.5 sans-serif}a{color:#d9ff48}iframe{display:none!important}</style><script nonce="${nonce}">addEventListener('error',event=>{if(event.target?.id==='geniusEmbedScript')parent.postMessage({type:'rcrd-genius-embed-error',id:${id}},'*')},true)</script></head><body><div id="rg_embed_link_${id}" class="rg_embed_link" data-song-id="${id}"></div><script id="geniusEmbedScript" src="https://genius.com/songs/${id}/embed.js"></script></body></html>`);
    }
    if (request.method === 'POST' && url.pathname === '/api/lyrics/genius') {
      const session = sessionFor(request);
      if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify to view lyrics for a playing song.' });
      if (!config.geniusAccessToken) return send(response, 503, { error: 'Lyrics are not configured yet. Add a Genius client access token in .env.' });
      const body = await readJsonBody(request, 1000);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
      if (!title || title.length > 180 || !artist || artist.length > 500) return send(response, 400, { error: 'A valid song title and artist are required.' });
      try {
        const match = await geniusLyricsMatch(title, artist);
        if (!match) return send(response, 404, { error: 'No unambiguous Genius match was found for this song.', searchUrl: `https://genius.com/search?q=${encodeURIComponent(`${title} ${artist}`)}` });
        return send(response, 200, match);
      } catch (error) { return send(response, error.status === 429 ? 429 : error.status === 503 ? 503 : 502, { error: error.message, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/restart') {
      if (request.headers.origin !== url.origin) return send(response, 403, { error: 'Request not allowed' });
      const session = sessionFor(request);
      if (!session) return send(response, 401, { error: 'Open RCRD before restarting it.' });
      try { await requestServerRestart(); }
      catch (error) { return send(response, error.status === 409 ? 409 : 503, { error: error.message }); }
      response.once('finish', shutdown);
      return send(response, 202, { ok: true, previousPid: process.pid });
    }
    if (request.method === 'GET' && url.pathname === '/auth/spotify/start') {
      if (!config.spotify) return send(response, 503, { error: 'Spotify credentials are not configured on the server.' });
      ensureSession(request, response, true);
      const existing = sessionFor(request); const sessionId = request.rcrdSessionId; const state = random(); const includeTop = url.searchParams.get('top') === '1' || spotifyHasScope(existing, 'user-top-read'); sessions.set(sessionId, { ...(existing || {}), spotifyState: state }); savePersistentSessions();
      const authorize = new URL(config.spotify.authorizeUrl); authorize.search = new URLSearchParams({ response_type: 'code', client_id: config.spotify.clientId, scope: spotifyScopes(includeTop), redirect_uri: config.spotify.redirectUri, state, show_dialog: 'true' }).toString();
      return redirect(response, authorize.toString(), { 'Set-Cookie': sessionCookie(sessionId) });
    }
    if (request.method === 'GET' && url.pathname === '/auth/spotify/callback') {
      const session = sessionFor(request); if (!config.spotify || !session || url.searchParams.get('state') !== session.spotifyState) return send(response, 400, { error: 'Spotify authorization state is invalid or expired.' });
      if (url.searchParams.get('error')) return redirect(response, `/?spotify=denied`);
      const data = await spotifyToken({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: config.spotify.redirectUri });
      const authorizedAt = Date.now(); session.spotify = { accessToken: data.access_token, refreshToken: data.refresh_token, scope: typeof data.scope === 'string' ? data.scope : '', expiresAt: authorizedAt + (data.expires_in * 1000), authorizedAt, refreshDueAt: authorizedAt + config.spotify.refreshMaxAgeMs }; delete session.spotifyState; savePersistentSessions();
      return redirect(response, '/?spotify=connected');
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/status') {
      const session = sessionFor(request); const spotify = session?.spotify; const now = Date.now(); return send(response, 200, { configured: Boolean(config.spotify), connected: Boolean(spotify?.refreshToken), canStream: Boolean(spotify?.refreshToken && spotifyHasScope(session, 'streaming')), canModifyLibrary: Boolean(spotify?.refreshToken && spotifyHasScope(session, 'user-library-modify')), canReadTop: Boolean(spotify?.refreshToken && spotifyHasScope(session, 'user-top-read')), accessExpiresAt: spotify?.expiresAt || null, refreshDueAt: spotify?.refreshDueAt || null, daysRemaining: spotify?.refreshDueAt ? Math.max(0, Math.ceil((spotify.refreshDueAt - now) / 86400000)) : null, needsReauthorization: Boolean(spotify?.refreshDueAt && spotify.refreshDueAt <= now) });
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/token') {
      const session = sessionFor(request); if (!config.spotify || !session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      if (!spotifyHasScope(session, 'streaming')) return send(response, 403, { error: 'Spotify playback permission is missing. Reconnect Spotify.' });
      try { const accessToken = await spotifyAccess(session); if (!spotifyHasScope(session, 'streaming')) return send(response, 403, { error: 'Spotify playback permission is missing. Reconnect Spotify.' }); return send(response, 200, { access_token: accessToken, expires_at: session.spotify.expiresAt }); } catch (error) { return send(response, 401, { error: error.code === 'invalid_grant' ? 'Spotify authorization expired. Reconnect Spotify.' : error.message, needsReauthorization: error.code === 'invalid_grant' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/currently-playing') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try { return send(response, 200, await spotifyApi(session, '/me/player')); } catch (error) { return sendSpotifyError(response, error, 502, [401]); }
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/devices') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try {
        const data = await spotifyApi(session, '/me/player/devices');
        if (!Array.isArray(data?.devices) || data.devices.length > 100) return send(response, 502, { error: 'Spotify returned an invalid device list.' });
        return send(response, 200, { devices: data.devices.map(device => ({ id: typeof device?.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(device.id) ? device.id : null, name: typeof device?.name === 'string' ? device.name.slice(0, 80) : 'Unknown device', type: typeof device?.type === 'string' ? device.type.slice(0, 40) : '', is_active: device?.is_active === true, is_restricted: device?.is_restricted === true, supports_volume: device?.supports_volume === true })) });
      } catch (error) { return sendSpotifyError(response, error, 502, [401, 403]); }
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/me') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try { return send(response, 200, await spotifyProfile(session)); } catch (error) { return sendSpotifyError(response, error, 502, [401]); }
    }
    if (url.pathname === '/api/spotify/history' && ['GET', 'POST', 'DELETE'].includes(request.method)) {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const profile = await spotifyProfile(session);
      const accountKey = spotifyCacheUserKey(session);
      if (request.method === 'GET') {
        const options = historyQueryOptions(url);
        const history = readListeningHistory(session);
        const recentPlaysStored = readRecentPlays(session).events.length > 0;
        return send(response, 200, history ? { ...historyBrowseResponse(history, options), recentPlaysStored } : { imported: false, recentPlaysStored });
      }
      if (historyImports.has(accountKey)) return send(response, 409, { error: 'A history import is already running for this account.' });
      if (request.method === 'DELETE') {
        try { fs.unlinkSync(historyFile(session)); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not delete local listening history.'); }
        const now = Date.now(); saveRecentPlays(session, { version: 1, lastSynced: now, ignoreBefore: now, events: [] });
        return send(response, 200, { ok: true });
      }
      if (!/^application\/(zip|octet-stream)(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) return send(response, 415, { error: 'Select a Spotify ZIP file.' });
      if (historyImports.size) return send(response, 409, { error: 'Another history import is already running. Try again when it finishes.' });
      fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
      const temporary = fs.mkdtempSync(path.join(runtimeDirectory, 'history-import-'));
      historyImports.add(accountKey);
      try {
        const archive = path.join(temporary, 'spotify.zip');
        const output = path.join(temporary, 'summary.json');
        await receiveHistoryArchive(request, archive);
        await parseHistoryArchive(archive, output);
        if (fs.statSync(output).size > 32 * 1024 * 1024) throw Object.assign(new Error('Spotify history contains too many tracks.'), { status: 413 });
        let summary;
        try { summary = JSON.parse(fs.readFileSync(output, 'utf8')); } catch { throw Object.assign(new Error('Spotify history produced an invalid summary.'), { status: 400 }); }
        if (sessionFor(request) !== session || session.spotify?.userId !== profile.id || spotifyCacheUserKey(session) !== accountKey) return send(response, 409, { error: 'Spotify account changed during import. Reconnect and try again.' });
        const history = validateHistorySummary(summary, profile.id, request.headers['x-rcrd-history-account-confirmed'] === '1');
        saveListeningHistory(session, history);
        return send(response, 200, historyBrowseResponse(history));
      } finally {
        historyImports.delete(accountKey);
        const resolved = path.resolve(temporary);
        if (resolved.startsWith(path.resolve(runtimeDirectory) + path.sep) && path.basename(resolved).startsWith('history-import-')) fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/mix-sources') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const uri = url.searchParams.get('uri') || '';
      if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) return send(response, 400, { error: 'A valid starting Spotify song is required.' });
      const account = session.spotify;
      const lookupController = new AbortController();
      const cancelLookup = () => lookupController.abort(); response.once('close', cancelLookup);
      try {
        const data = await spotifyMixSources(session, uri, () => !response.destroyed, lookupController.signal);
        if (response.destroyed) return;
        if (session.spotify !== account) return send(response, 409, { error: 'Spotify account changed during Mix lookup.' });
        return send(response, 200, data);
      } catch (error) { if (!response.destroyed) { if (session.spotify !== account) return send(response, 409, { error: 'Spotify account changed during Mix lookup.' }); return sendSpotifyError(response, error, 502, [401, 409, 504]); } }
      finally { response.removeListener('close', cancelLookup); }
    }
    if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/spotify/recent') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try { await spotifyProfile(session); const account = session.spotify; const recent = await spotifyCached(session, 'recent', 300000, () => spotifyApi(session, '/me/player/recently-played?limit=50'), true, true, request.method === 'POST'); if (session.spotify !== account) return send(response, 409, { error: 'Spotify account changed during recent-play sync.' }); mergeRecentPlays(session, recent); return send(response, 200, { recentlyPlayed: (recent?.items || []).map(item => item.track).filter(Boolean) }); } catch (error) { return sendSpotifyError(response, error, 502, [401]); }
    }
    if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/spotify/play-counts') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const input = request.method === 'POST' ? await readJsonBody(request, 32768) : null;
      const records = input ? input.tracks : url.searchParams.getAll('uri').map(uri => ({ uri }));
      if (!Array.isArray(records) || records.length > 48 || records.some(record => !record || typeof record !== 'object' || !spotifyTrackUri(record.uri) || (record.title !== undefined && (typeof record.title !== 'string' || record.title.length > 180)) || (record.artist !== undefined && (typeof record.artist !== 'string' || record.artist.length > 500)))) return send(response, 400, { error: 'Request up to 48 valid Spotify tracks.' });
      const uniqueRecords = [...new Map(records.map(record => [record.uri, record])).values()];
      try {
        await spotifyProfile(session); const account = session.spotify;
        let recentUnavailable = false;
        try { const recent = await spotifyCached(session, 'recent', 300000, () => spotifyApi(session, '/me/player/recently-played?limit=50'), true); if (session.spotify !== account) return send(response, 409, { error: 'Spotify account changed during play-count sync.' }); mergeRecentPlays(session, recent); }
        catch (error) { if (session.spotify !== account) return send(response, 409, { error: 'Spotify account changed during play-count sync.' }); if (error.status === 401 || /local recent plays|save local recent plays|recent-play storage is full/i.test(error.message)) throw error; recentUnavailable = true; }
        return send(response, 200, playCountResponse(uniqueRecords.length ? readListeningHistory(session) : null, readRecentPlays(session), uniqueRecords, recentUnavailable));
      } catch (error) { return sendSpotifyError(response, error, 502, [401, 409]); }
    }
    if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/spotify/top-albums') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      if (!spotifyHasScope(session, 'user-top-read')) return send(response, 403, { error: 'Enable long-term favorites in RCRD to allow this view.' });
      try {
        const data = await spotifyCached(session, 'top-tracks:long-term', 3600000, () => spotifyApi(session, '/me/top/tracks?time_range=long_term&limit=30'), false, true, request.method === 'POST');
        if (!Array.isArray(data?.items)) return send(response, 502, { error: 'Spotify returned invalid top tracks.' });
        return send(response, 200, { tracks: data.items.slice(0, 30).filter(item => typeof item?.album?.id === 'string' && typeof item.album.name === 'string').map(item => ({ album: { id: item.album.id.slice(0, 80), name: item.album.name.slice(0, 180), uri: /^spotify:album:[A-Za-z0-9]+$/.test(item.album.uri || '') ? item.album.uri : '', release_date: String(item.album.release_date || '').slice(0, 10), artists: Array.isArray(item.album.artists) ? item.album.artists.slice(0, 5).map(artist => ({ name: String(artist?.name || '').slice(0, 120) })) : [], images: Array.isArray(item.album.images) ? item.album.images.slice(0, 1).map(image => ({ url: typeof image?.url === 'string' ? image.url.slice(0, 500) : '' })) : [] } })) });
      } catch (error) { return sendSpotifyError(response, error, 502, [401, 403]); }
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/library-progress') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      return send(response, 200, session.spotify.libraryProgress || { active: false });
    }
    if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/spotify/library') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const spotifyAccount = session.spotify;
      const sameAccount = () => { if (session.spotify !== spotifyAccount) { const error = new Error('Spotify account changed while loading. Try again.'); error.status = 409; throw error; } };
      try {
        retrySpotifyLibraryCleanup(session);
        await spotifyProfile(session);
        sameAccount();
        const memoryEntry = session.spotify.cache?.get('library');
        const forceRefresh = request.method === 'POST';
        const cachedEntry = !forceRefresh && !session.spotify.libraryCacheDirty ? (memoryEntry?.value && memoryEntry.expiresAt > Date.now() ? memoryEntry : spotifyLibrarySnapshot(session)) : null;
        if (forceRefresh && !memoryEntry?.promise) for (const key of ['checkpoint:library-tracks', 'checkpoint:library-albums']) { clearSpotifyCheckpoint(session, key); clearSpotifyDiskEntry(session, key); }
        const library = await spotifyCached(session, 'library', 43200000, async libraryVersion => {
          session.spotify.libraryProgress = { active: true, phase: 'tracks', tracks: { loaded: 0, total: null }, albums: { loaded: 0, total: null } };
          try {
            const savedTracks = await spotifyPages(session, '/me/tracks', 50, 'checkpoint:library-tracks', libraryVersion);
            sameAccount();
            const savedAlbums = await spotifyPages(session, '/me/albums', 50, 'checkpoint:library-albums', libraryVersion);
            sameAccount();
            session.spotify.libraryProgress.phase = 'recent';
            const recent = await spotifyCached(session, 'recent', 300000, () => spotifyApi(session, '/me/player/recently-played?limit=50'), true, !session.spotify.libraryCacheDirty);
            sameAccount();
            return { saved: savedTracks.filter(item => item?.track), savedAlbums: savedAlbums.filter(item => item?.album), recentlyPlayed: (recent?.items || []).map(item => item.track).filter(Boolean), syncedAt: Date.now() };
          } finally { spotifyAccount.libraryProgress = { active: false }; }
        }, true, true, forceRefresh);
        sameAccount();
        if (!session.spotify.libraryCacheDirty) { clearSpotifyCheckpoint(session, 'checkpoint:library-tracks'); clearSpotifyCheckpoint(session, 'checkpoint:library-albums'); }
        return send(response, 200, { ...library, sync: spotifyLibrarySync(library, cachedEntry ? 'cached' : 'live', cachedEntry?.expiresAt) });
      } catch (error) {
        const temporaryFailure = error.status === undefined || [429, 500, 502, 503, 504].includes(error.status);
        const snapshot = session.spotify === spotifyAccount && !spotifyAccount.libraryCacheDirty && temporaryFailure ? spotifyLibrarySnapshot(session, true) : null;
        if (snapshot) return send(response, 200, { ...snapshot.value, sync: spotifyLibrarySync(snapshot.value, 'stale-cache', snapshot.expiresAt) });
        return sendSpotifyError(response, error, 502, [401, 409]);
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/liked') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const batch = url.searchParams.has('uris'); const uri = url.searchParams.get('uri');
      const uris = batch ? (url.searchParams.get('uris') || '').split(',') : [uri];
      if ((batch && uri !== null) || uris.length > 40 || uris.some(value => !spotifyTrackUri(value))) return send(response, 400, { error: 'Provide up to 40 valid Spotify track URIs.' });
      try {
        const result = await spotifyApi(session, `/me/library/contains?uris=${enc(uris.join(','))}`);
        if (!Array.isArray(result) || result.length !== uris.length || result.some(value => typeof value !== 'boolean')) { const error = new Error('Spotify returned an invalid saved-track status.'); error.status = 502; throw error; }
        return send(response, 200, { saved: batch ? result : result[0] });
      } catch (error) { return sendSpotifyError(response, error, 502, [401, 403]); }
    }
    if (request.method === 'PUT' && url.pathname === '/api/spotify/liked') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try {
        const body = await readJsonBody(request);
        if (!spotifyTrackUri(body.uri) || typeof body.saved !== 'boolean') return send(response, 400, { error: 'A valid Spotify track URI and saved state are required.' });
        if (!spotifyHasScope(session, 'user-library-modify')) return send(response, 403, { error: 'Reconnect Spotify to allow saving tracks to Liked Songs.' });
        const spotify = beginSpotifyLibraryMutation(session);
        let providerError = null;
        try { await spotifyApi(session, `/me/library?uris=${enc(body.uri)}`, { method: body.saved ? 'PUT' : 'DELETE' }); }
        catch (error) { providerError = error; }
        const cacheWarning = finishSpotifyLibraryMutation(session, spotify, !providerError);
        if (providerError) throw providerError;
        return send(response, 200, { ok: true, saved: body.saved, ...(cacheWarning ? { cacheWarning } : {}) });
      } catch (error) { return sendSpotifyError(response, error, 502, [400, 401, 403, 500]); }
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/playlists') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try {
        const profile = await spotifyProfile(session);
        const playlists = await spotifyCached(session, 'playlists', 900000, async () => {
          const items = await spotifyPages(session, '/me/playlists', 50, 'checkpoint:playlists');
          const readable = items.filter(item => item?.owner?.id === profile.id || item?.collaborative);
          return { playlists: readable.map(item => ({ id: item.id, name: item.name, tracksTotal: item.items?.total ?? item.tracks?.total ?? 0 })), restrictedCount: items.length - readable.length };
        }, true);
        clearSpotifyCheckpoint(session, 'checkpoint:playlists');
        return send(response, 200, playlists);
      } catch (error) { return sendSpotifyError(response, error, 502, [401]); }
    }
    if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/spotify/playlist') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const playlistId = url.searchParams.get('id') || ''; if (!/^[A-Za-z0-9]+$/.test(playlistId)) return send(response, 400, { error: 'A valid Spotify playlist is required.' });
      const previewValues = url.searchParams.getAll('preview');
      if (previewValues.length && (request.method === 'POST' || previewValues.length !== 1 || previewValues[0] !== '1')) return send(response, 400, { error: 'Invalid Spotify playlist preview.' });
      const playlistAccount = session.spotify;
      const cacheKey = `playlist:${playlistId}`;
      const checkpointKey = `checkpoint:playlist:${playlistId}`;
      try {
        await spotifyProfile(session);
        if (session.spotify !== playlistAccount) { const error = new Error('Spotify account changed while loading. Try again.'); error.status = 409; throw error; }
        const memoryEntry = session.spotify.cache?.get(cacheKey);
        const forceRefresh = request.method === 'POST';
        const cachedEntry = !forceRefresh ? memoryEntry?.expiresAt > Date.now() && Array.isArray(memoryEntry.value) ? memoryEntry : spotifyPlaylistSnapshot(session, cacheKey) : null;
        if (forceRefresh && !memoryEntry?.promise) { clearSpotifyCheckpoint(session, checkpointKey); clearSpotifyDiskEntry(session, checkpointKey); }
        if (previewValues.length) {
          let fullItems = memoryEntry?.expiresAt > Date.now() ? memoryEntry.value : null;
          if (!Array.isArray(fullItems)) fullItems = readSpotifyDiskEntry(session, cacheKey)?.value;
          if (!Array.isArray(fullItems) && memoryEntry?.expiresAt > Date.now() && memoryEntry.promise && !readSpotifyCheckpoint(session, checkpointKey)?.items?.length) fullItems = await memoryEntry.promise;
          const preview = Array.isArray(fullItems)
            ? { items: fullItems.slice(0, 50), total: fullItems.length }
            : await spotifyPages(session, `/playlists/${enc(playlistId)}/items`, 50, checkpointKey, null, true);
          if (session.spotify !== playlistAccount) { const error = new Error('Spotify account changed while loading. Try again.'); error.status = 409; throw error; }
          return send(response, 200, { tracks: preview.items.map(entry => entry.item || entry.track).filter(item => item?.type === 'track'), total: preview.total, sync: { source: cachedEntry ? 'cached' : 'live', updatedAt: cachedEntry ? cachedEntry.expiresAt - 900000 : Date.now() } });
        }
        const items = await spotifyCached(session, cacheKey, 900000, () => spotifyPages(session, `/playlists/${enc(playlistId)}/items`, 50, checkpointKey), true, true, forceRefresh);
        if (session.spotify !== playlistAccount) { const error = new Error('Spotify account changed while loading. Try again.'); error.status = 409; throw error; }
        clearSpotifyCheckpoint(session, checkpointKey);
        return send(response, 200, { tracks: items.map(entry => entry.item || entry.track).filter(item => item?.type === 'track'), sync: { source: cachedEntry ? 'cached' : 'live', updatedAt: cachedEntry ? cachedEntry.expiresAt - 900000 : Date.now() } });
      } catch (error) {
        const temporaryFailure = error.status === undefined || [429, 500, 502, 503, 504].includes(error.status);
        const snapshot = session.spotify === playlistAccount && temporaryFailure ? spotifyPlaylistSnapshot(session, cacheKey, true) : null;
        if (snapshot) return send(response, 200, { tracks: snapshot.value.map(entry => entry.item || entry.track).filter(item => item?.type === 'track'), ...(previewValues.length ? { total: snapshot.value.length } : {}), sync: { source: 'stale-cache', updatedAt: snapshot.expiresAt - 900000 } });
        if (error.status === 403) error.message = 'Spotify only permits this app to read playlists you own or collaborate on.'; return sendSpotifyError(response, error, 502, [401, 403, 409]);
      }
    }
    if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/spotify/search') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const query = url.searchParams.get('q')?.trim(); if (!query || query.length > 200) return send(response, 400, { error: 'A Spotify search query is required.' });
      const type = url.searchParams.get('type') || 'album,track,artist,playlist'; if (!/^(album|track|artist|playlist)(,(album|track|artist|playlist)){0,3}$/.test(type)) return send(response, 400, { error: 'Invalid Spotify search type.' });
      const offset = Number(url.searchParams.get('offset') || 0); if (!Number.isInteger(offset) || offset < 0 || offset > 1000) return send(response, 400, { error: 'Invalid Spotify search offset.' });
      try { return send(response, 200, await spotifyCached(session, `search:${query}:${type}:${offset}`, 30000, () => spotifyApi(session, `/search?q=${enc(query)}&type=${enc(type)}&limit=10&offset=${offset}`), false, true, request.method === 'POST')); } catch (error) { return sendSpotifyError(response, error, 502, [400, 401]); }
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/spotify/albums/')) {
      const match = url.pathname.match(/^\/api\/spotify\/albums\/([A-Za-z0-9]{22})\/tracks$/);
      if (!match) return send(response, 400, { error: 'A valid Spotify album is required.' });
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 950 || offset % 50) return send(response, 400, { error: 'Invalid album track offset.' });
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      const account = session.spotify;
      try {
        const tracks = await spotifyCached(session, `album-tracks:${match[1]}:${offset}`, 300000, () => spotifyApi(session, `/albums/${match[1]}/tracks?limit=50&offset=${offset}`));
        if (session.spotify !== account) return send(response, 409, { error: 'Spotify account changed during album lookup.' });
        return send(response, 200, tracks);
      } catch (error) { return sendSpotifyError(response, error, 502, [400, 401, 403, 404]); }
    }
    if (request.method === 'PUT' && url.pathname === '/api/spotify/transfer') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try {
        const body = await readJsonBody(request); const deviceId = String(body.device_id || '');
        if (!deviceId || deviceId.length > 200 || /[\u0000-\u001f\u007f]/.test(deviceId)) return send(response, 400, { error: 'A valid Spotify device is required.' });
        await spotifyApi(session, '/me/player', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_ids: [deviceId], play: false }) });
        return send(response, 200, { ok: true });
      } catch (error) { if (error.status === 404) return send(response, 404, { error: 'That Spotify device is no longer available.' }); return sendSpotifyError(response, error, 502, [401]); }
    }
    if (request.method === 'POST' && url.pathname === '/api/spotify/playback') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try {
        const body = await readJsonBody(request); const action = String(body.action || ''); const deviceId = String(body.device_id || '');
        if (!['start', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat', 'seek', 'volume'].includes(action)) return send(response, 400, { error: 'A valid Spotify playback action is required.' });
        if (deviceId && (deviceId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(deviceId))) return send(response, 400, { error: 'Invalid Spotify device.' });
        const device = deviceId ? `device_id=${enc(deviceId)}` : '';
        if (action === 'start') {
          const uri = String(body.uri || ''); const match = uri.match(/^spotify:(track|album|artist|playlist):[A-Za-z0-9]+$/);
          if (!match) return send(response, 400, { error: 'A playable Spotify track, album, artist, or playlist URI is required.' });
          const contextUri = body.context_uri == null ? '' : String(body.context_uri);
          if (contextUri && (match[1] !== 'track' || !/^spotify:(album|playlist):[A-Za-z0-9]+$/.test(contextUri))) return send(response, 400, { error: 'A valid album or playlist context is required for a track.' });
          const uris = body.uris;
          if (uris !== undefined && (match[1] !== 'track' || contextUri || !Array.isArray(uris) || uris.length < 1 || uris.length > 100 || uris[0] !== uri || uris.some(item => typeof item !== 'string' || !/^spotify:track:[A-Za-z0-9]+$/.test(item)))) return send(response, 400, { error: 'A valid track sequence of up to 100 songs is required.' });
          const playbackBody = match[1] === 'track' ? uris ? { uris } : contextUri ? { context_uri: contextUri, offset: { uri } } : { uris: [uri] } : { context_uri: uri };
          await spotifyApi(session, `/me/player/play${device ? `?${device}` : ''}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(playbackBody) });
        }
        if (action === 'play') await spotifyApi(session, `/me/player/play${device ? `?${device}` : ''}`, { method: 'PUT' });
        if (action === 'pause') await spotifyApi(session, `/me/player/pause${device ? `?${device}` : ''}`, { method: 'PUT' });
        if (action === 'next') await spotifyApi(session, `/me/player/next${device ? `?${device}` : ''}`, { method: 'POST' });
        if (action === 'previous') await spotifyApi(session, `/me/player/previous${device ? `?${device}` : ''}`, { method: 'POST' });
        if (action === 'seek') { const position = body.position_ms; if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0 || position > 86400000) return send(response, 400, { error: 'Invalid playback position.' }); await spotifyApi(session, `/me/player/seek?position_ms=${position}${device ? `&${device}` : ''}`, { method: 'PUT' }); }
        if (action === 'volume') { const level = body.volume_percent; if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 100) return send(response, 400, { error: 'Invalid playback volume.' }); await spotifyApi(session, `/me/player/volume?volume_percent=${level}${device ? `&${device}` : ''}`, { method: 'PUT' }); }
        if (action === 'shuffle') {
          if (typeof body.state !== 'boolean') return send(response, 400, { error: 'Shuffle state must be true or false.' });
          await spotifyApi(session, `/me/player/shuffle?state=${body.state}${device ? `&${device}` : ''}`, { method: 'PUT' });
        }
        if (action === 'repeat') {
          const state = String(body.state || ''); if (!['off', 'context', 'track'].includes(state)) return send(response, 400, { error: 'Repeat state must be off, context, or track.' });
          await spotifyApi(session, `/me/player/repeat?state=${enc(state)}${device ? `&${device}` : ''}`, { method: 'PUT' });
        }
        return send(response, 200, { ok: true });
      } catch (error) { return sendSpotifyError(response, error, 502, [400, 401, 403]); }
    }
    if (request.method === 'POST' && url.pathname === '/api/spotify/queue') {
      const session = sessionFor(request); if (!session?.spotify?.refreshToken) return send(response, 401, { error: 'Connect Spotify first.' });
      try {
        const body = await readJsonBody(request); const uri = String(body.uri || '');
        if (!/^spotify:track:[A-Za-z0-9]+$/.test(uri)) return send(response, 400, { error: 'A valid Spotify track is required.' });
        await spotifyApi(session, `/me/player/queue?uri=${enc(uri)}`, { method: 'POST' });
        return send(response, 200, { ok: true });
      } catch (error) { return sendSpotifyError(response, error, 502, [401]); }
    }
    if (request.method === 'POST' && url.pathname === '/api/spotify/disconnect') {
      const session = sessionFor(request);
      if (session?.spotify || session?.spotifyState) {
        if (session.spotify) clearSpotifyDiskEntries(session);
        const previous = { spotify: session.spotify, spotifyState: session.spotifyState };
        session.spotify = null; delete session.spotifyState;
        try { savePersistentSessions(); }
        catch (error) { session.spotify = previous.spotify; if (previous.spotifyState) session.spotifyState = previous.spotifyState; throw error; }
      }
      return send(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/auth/discogs/start') {
      ensureSession(request, response, true);
      const existing = sessionFor(request); const sessionId = request.rcrdSessionId;
      const body = await discogsRequest(config.requestUrl, { headers: { Authorization: oauthHeader({ callback: config.callbackUrl }), 'Content-Type': 'application/x-www-form-urlencoded' } });
      const token = parseForm(body);
      if (!validOauthPair(token)) { const error = new Error('Discogs authorization returned incomplete credentials.'); error.status = 502; throw error; }
      sessions.set(sessionId, { ...(existing || {}), requestToken: token.oauth_token, requestSecret: token.oauth_token_secret }); savePersistentSessions();
      const location = `${config.authorizeUrl}?oauth_token=${enc(token.oauth_token)}`;
      return redirect(response, location, { 'Set-Cookie': sessionCookie(sessionId) });
    }
    if (request.method === 'GET' && url.pathname === '/auth/discogs/callback') {
      const session = sessionFor(request);
      if (!session || url.searchParams.get('oauth_token') !== session.requestToken || !url.searchParams.get('oauth_verifier')) return send(response, 400, { error: 'OAuth session expired or invalid. Please reconnect.' });
      const body = await discogsRequest(config.accessUrl, { method: 'POST', headers: { Authorization: oauthHeader({ token: session.requestToken, tokenSecret: session.requestSecret, verifier: url.searchParams.get('oauth_verifier') }), 'Content-Type': 'application/x-www-form-urlencoded' } });
      const access = parseForm(body);
      if (!validOauthPair(access)) { const error = new Error('Discogs authorization returned incomplete credentials.'); error.status = 502; throw error; }
      session.accessToken = access.oauth_token; session.accessSecret = access.oauth_token_secret; delete session.requestToken; delete session.requestSecret; savePersistentSessions();
      return redirect(response, '/?discogs=connected');
    }
    if (request.method === 'GET' && url.pathname === '/api/session') return send(response, 200, { connected: Boolean(sessionFor(request)?.accessToken) });
    if (request.method === 'GET' && url.pathname === '/api/me') {
      const session = sessionFor(request); if (!session?.accessToken) return send(response, 401, { error: 'Connect Discogs first.' });
      return send(response, 200, await discogsIdentity(session));
    }
    if (request.method === 'GET' && (url.pathname === '/api/collection' || url.pathname === '/api/wantlist')) {
      const session = sessionFor(request); if (!session?.accessToken) return send(response, 401, { error: 'Connect Discogs first.' });
      try {
        const identity = await discogsIdentity(session);
        const endpoint = url.pathname === '/api/collection' ? `https://api.discogs.com/users/${enc(identity.username)}/collection/folders/0/releases` : `https://api.discogs.com/users/${enc(identity.username)}/wants`;
        const releases = await discogsPages(session, endpoint);
        return send(response, 200, { username: identity.username, releases });
      } catch (error) { if (error.status === 429) throw error; return send(response, 502, { error: error.message }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/search') {
      const query = url.searchParams.get('q')?.trim() || ''; if (query.length > 200) return send(response, 400, { error: 'Discogs search query is too long.' });
      const session = sessionFor(request); const headers = session?.accessToken ? { Authorization: oauthHeader({ token: session.accessToken, tokenSecret: session.accessSecret }) } : { Authorization: `Discogs key=${enc(config.key)}, secret=${enc(config.secret)}` };
      const page = Number(url.searchParams.get('page') || 1); if (!Number.isInteger(page) || page < 1 || page > 100) return send(response, 400, { error: 'Invalid Discogs search page.' });
      const params = new URLSearchParams({ type: 'release', per_page: '24', page: String(page) });
      if (query) params.set('q', query);
      for (const name of ['format', 'condition', 'country', 'genre', 'style', 'year']) { const value = url.searchParams.get(name)?.trim(); if (value && value.length <= 80) params.set(name, value); }
      for (const name of ['artist', 'release_title', 'catno', 'barcode']) { const value = url.searchParams.get(name)?.trim(); if (value && value.length > 120) return send(response, 400, { error: 'Discogs edition search field is too long.' }); if (value) params.set(name, value); }
      if (![...params.keys()].some(name => !['type', 'per_page', 'page', 'format', 'condition', 'country', 'genre', 'style', 'year'].includes(name))) return send(response, 400, { error: 'A search query or edition identifier is required.' });
      return send(response, 200, await discogsJson(`https://api.discogs.com/database/search?${params}`, { headers }));
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/discogs/masters/') && url.pathname.endsWith('/versions')) {
      const idText = url.pathname.slice('/api/discogs/masters/'.length, -'/versions'.length);
      if (!/^[1-9]\d{0,14}$/.test(idText) || !Number.isSafeInteger(Number(idText))) return send(response, 400, { error: 'A valid Discogs master ID is required.' });
      const page = Number(url.searchParams.get('page') || 1); if (!Number.isInteger(page) || page < 1 || page > 100) return send(response, 400, { error: 'Invalid Discogs versions page.' });
      const session = sessionFor(request); const headers = session?.accessToken ? { Authorization: oauthHeader({ token: session.accessToken, tokenSecret: session.accessSecret }) } : { Authorization: `Discogs key=${enc(config.key)}, secret=${enc(config.secret)}` };
      const data = await discogsJson(`https://api.discogs.com/masters/${idText}/versions?per_page=24&page=${page}`, { headers });
      if (!Array.isArray(data?.versions) || data.versions.length > 24 || !Number.isSafeInteger(data.pagination?.items) || data.pagination.items < 0 || data.pagination.items > 1000000) return send(response, 502, { error: 'Discogs returned invalid master versions.' });
      return send(response, 200, { results: data.versions.filter(version => Number.isSafeInteger(version?.id) && version.id > 0).map(version => ({ id: version.id, title: String(version.title || 'Untitled edition').slice(0, 180), year: String(version.released || version.year || '').slice(0, 20), format: Array.isArray(version.major_formats) ? version.major_formats.slice(0, 5).map(value => String(value).slice(0, 50)) : typeof version.format === 'string' ? [version.format.slice(0, 50)] : [], cover_image: typeof version.thumb === 'string' ? version.thumb.slice(0, 500) : '', country: String(version.country || '').slice(0, 80), catno: String(version.catno || '').slice(0, 80), master_id: Number(idText) })), pagination: { page, per_page: 24, items: data.pagination.items } });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/discogs/releases/')) {
      const idText = url.pathname.slice('/api/discogs/releases/'.length);
      if (!/^[1-9]\d{0,14}$/.test(idText) || !Number.isSafeInteger(Number(idText))) return send(response, 400, { error: 'A valid Discogs release ID is required.' });
      const session = sessionFor(request); const headers = session?.accessToken ? { Authorization: oauthHeader({ token: session.accessToken, tokenSecret: session.accessSecret }) } : { Authorization: `Discogs key=${enc(config.key)}, secret=${enc(config.secret)}` };
      const release = await discogsJson(`https://api.discogs.com/releases/${idText}`, { headers });
      if (Number(release.id) !== Number(idText)) return send(response, 502, { error: 'Discogs returned a different release.' });
      return send(response, 200, discogsReleaseSummary(release));
    }
    if (request.method === 'POST' && (url.pathname === '/api/wantlist' || url.pathname === '/api/collection')) {
      const session = sessionFor(request); if (!session?.accessToken) return send(response, 401, { error: 'Connect Discogs first.' });
      const input = await readJsonBody(request); const releaseId = Number(input.release_id); if (!Number.isInteger(releaseId) || releaseId < 1) return send(response, 400, { error: 'A valid release_id is required.' });
      const identity = await discogsIdentity(session);
      const endpoint = url.pathname === '/api/wantlist' ? `https://api.discogs.com/users/${enc(identity.username)}/wants/${releaseId}` : `https://api.discogs.com/users/${enc(identity.username)}/collection/folders/1/releases/${releaseId}`;
      const method = url.pathname === '/api/wantlist' ? 'PUT' : 'POST';
      await discogsRequest(endpoint, { method, headers: { Authorization: oauthHeader({ token: session.accessToken, tokenSecret: session.accessSecret }), 'Content-Type': 'application/json' }, body: '{}' });
      return send(response, 200, { ok: true, username: identity.username, release_id: releaseId });
    }
    if (request.method === 'POST' && url.pathname === '/api/discogs/disconnect') {
      const session = sessionFor(request);
      if (session?.accessToken || session?.requestToken) {
        const previous = { accessToken: session.accessToken, accessSecret: session.accessSecret, requestToken: session.requestToken, requestSecret: session.requestSecret };
        delete session.accessToken; delete session.accessSecret; delete session.requestToken; delete session.requestSecret;
        try { savePersistentSessions(); }
        catch (error) { Object.assign(session, previous); throw error; }
      }
      return send(response, 200, { ok: true });
    }
    if (request.method === 'GET') { const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); if (publicFiles.has(file)) { if (url.pathname === '/' && !sessionFor(request)) ensureSession(request, response, true); return html(response, file, request); } }
    return send(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error('RCRD request failed:', error.code || error.name || 'unknown');
    if (response.headersSent) return response.destroy();
    const status = [400, 409, 413, 415, 429, 500, 503, 504].includes(error.status) ? error.status : 502;
    if (status === 413) { response.setHeader('Connection', 'close'); response.once('finish', () => request.destroy()); }
    return send(response, status, { error: [400, 409, 415, 429, 500, 503, 504].includes(status) ? error.message : status === 413 ? 'Request body too large.' : 'Request failed' }, status === 429 && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
  }
}
const server = http.createServer((request, response) => { handle(request, response).catch(() => { if (response.headersSent) response.destroy(); else send(response, 500, { error: 'Request failed' }); }); });

function removePidFile() {
  try {
    const runtime = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
    if (runtime.pid === process.pid) fs.unlinkSync(pidFile);
  } catch {}
}

function shutdown() {
  server.close(() => {
    removePidFile();
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(() => {
    removePidFile();
    process.exit(1);
  }, 5000).unref();
}

if (require.main === module) {
  const startServer = () => {
    server.listen(port, bindHost, () => {
      fs.mkdirSync(runtimeDirectory, { recursive: true });
      fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port, root, startedAt: new Date().toISOString() }));
      console.log(`RCRD running at http://${bindHost}:${port}`);
    });
  };
  if (process.platform === 'win32') {
    const identity = crypto.createHash('sha256').update(fs.realpathSync.native(root).toLowerCase()).digest('hex');
    const guard = net.createServer(socket => socket.destroy());
    guard.once('error', error => {
      console.error(error.code === 'EADDRINUSE' ? 'RCRD is already running from this folder.' : 'RCRD could not reserve its single-instance guard.');
      process.exitCode = 1;
    });
    guard.listen(`\\\\.\\pipe\\rcrd-${identity}`, () => {
      server.once('error', error => {
        console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'RCRD could not start its local server.');
        guard.close();
        process.exitCode = 1;
      });
      startServer();
    });
    server.once('close', () => guard.close());
  } else {
    startServer();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  setInterval(() => { try { pruneExpiredSessions(); } catch (error) { console.error('RCRD session cleanup failed:', error.code || error.name); } }, 3600000).unref();
}
server.on('close', removePidFile);
module.exports = { server };
