// Synthetic provider responses for filming the real interface in an isolated browser.
// This module neither starts the RCRD server nor reads its account/configuration files.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ORIGIN = 'https://rcrd-example.local';
const id = n => String(n).padStart(22, '0');
const names = ['Northern Lights', 'In Color', 'Blue Hour', 'Open Roads', 'Slow Morning', 'Wildflowers', 'After the Rain', 'First Light', 'Paper Cities', 'Golden Days', 'The Long Way', 'Home Again', 'Still Water', 'Out of Town', 'Daybreak', 'Quiet Corners'];
const artists = ['The Paper Lanterns', 'The Weekenders', 'Mira Vale', 'The Longway Band'];
const colors = ['#3c6d68', '#b86c4e', '#325f8b', '#7b6351'];
const albumList = names.map((name, n) => ({ id: id(n + 1), uri: `spotify:album:${id(n + 1)}`, type: 'album', name, artists: [{ id: id(200 + n % 4), name: artists[n % 4] }], release_date: `${2020 + n % 6}-04-12`, images: [{ url: `${ORIGIN}/art/${n}.svg` }] }));
const trackNames = ['Northbound', 'The Quiet City', 'Open Sky', 'Home Again', 'Last Train', 'Far From Here', 'One More Morning', 'Small Hours', 'A Place to Begin', 'Stay a While'];
const tracks = albumList.flatMap((album, n) => trackNames.map((name, t) => ({ id: id(1000 + n * 10 + t), uri: `spotify:track:${id(1000 + n * 10 + t)}`, type: 'track', name: n ? `${name}${t > 6 ? ' (Acoustic)' : ''}` : name, artists: album.artists, album, duration_ms: 183000 + t * 11000, track_number: t + 1, disc_number: 1 })));
const mixArtists = Array.from({ length: 30 }, (_, index) => ({ id: id(3000 + index), name: `Example related artist ${index + 1}`, source: index % 2 ? 'listenbrainz' : 'discogs-style', style: 'Indie Rock' }));
const mixTracks = Array.from({ length: 120 }, (_, index) => ({ id: id(4000 + index), uri: `spotify:track:${id(4000 + index)}`, type: 'track', name: `Example related song ${index + 1}`, artists: [{ id: mixArtists[index % mixArtists.length].id, name: mixArtists[index % mixArtists.length].name }], album: { id: id(5000 + index), name: `Example album ${index + 1}` }, duration_ms: 190000 }));
function art(index) {
  const n = Number(index) % albumList.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="${colors[n % 4]}"/><circle cx="760" cy="260" r="310" fill="#e5dba6" opacity=".85"/><path d="M-100 900 460 170 1060 1010Z" fill="#0d2b28" opacity=".75"/><path d="M-100 990 510 420 1120 1020Z" fill="#15231c"/><circle cx="350" cy="820" r="200" fill="#d9ff48" opacity=".2"/><text x="65" y="110" font-family="Arial" font-weight="bold" font-size="48" fill="#f5f4de">${artists[n % 4].toUpperCase()}</text><text x="65" y="920" font-family="Georgia" font-size="65" fill="#f5f4de">${names[n]}</text></svg>`;
}
function discogsRelease(index, releaseId = 5000 + index) {
  const album = albumList[index % albumList.length];
  return { id: releaseId, title: album.name, artists: album.artists, year: Number(album.release_date.slice(0, 4)), cover_image: album.images[0].url, formats: [{ name: 'Vinyl', descriptions: ['LP', 'Album', index % 2 ? 'Reissue' : 'Stereo'] }], date_added: `2026-10-${String(24 - index % 20).padStart(2, '0')}T12:00:00Z` };
}
function sdkInstaller(initial) {
  const listeners = new Map();
  let state = initial;
  let player;
  const asSdk = data => ({ paused: !data.is_playing, position: data.progress_ms, duration: data.item.duration_ms, shuffle: data.shuffle_state, repeat_mode: { off: 0, context: 1, track: 2 }[data.repeat_state], context: data.context, track_window: { current_track: data.item, next_tracks: [], previous_tracks: [] } });
  window.__demoUpdatePlayback = data => { state = data; listeners.get('player_state_changed')?.(asSdk(data)); };
  async function action(action, details = {}) {
    const response = await fetch('/api/spotify/playback', { method: 'POST', body: JSON.stringify({ action, ...details }) });
    const result = await response.json();
    window.__demoUpdatePlayback(result.playback);
  }
  window.Spotify = { Player: class {
    constructor() { player = this; }
    addListener(name, callback) { listeners.set(name, callback); }
    async connect() { queueMicrotask(() => { listeners.get('ready')?.({ device_id: 'rcrd_demo_player' }); }); return true; }
    disconnect() { listeners.clear(); }
    async getCurrentState() { const r = await fetch('/api/spotify/currently-playing'); state = await r.json(); return asSdk(state); }
    async activateElement() {}
    async resume() { await action('play'); }
    async pause() { await action('pause'); }
    async nextTrack() { await action('next'); }
    async previousTrack() { await action('previous'); }
    async seek(position_ms) { await action('seek', { position_ms }); }
    async setVolume(volume) { await action('volume', { volume_percent: Math.round(volume * 100) }); }
    async getVolume() { return .5; }
  } };
  window.__demoPlayer = () => player;
  try { localStorage.setItem('rcrdUiPreferences', JSON.stringify({ spotifyLibraryMode: 'list', spotifyPageSize: 12, collectionPageSize: 12, wantlistPageSize: 12, spotifySearchScope: 'library' })); }
  catch (error) { if (error.name !== 'SecurityError') throw error; } // A lyrics iframe has an opaque sandbox origin.
}

function createFixture(root, { connected = true, fontManifest: suppliedFontManifest } = {}) {
  const fontDirectory = path.join(root, 'walkthrough/work/fonts');
  const fontManifest = suppliedFontManifest ?? JSON.parse(fs.readFileSync(path.join(fontDirectory, 'manifest.json'), 'utf8'));
  let current = tracks[0], paused = true, position = 42000, changedAt = Date.now(), shuffle = false, repeat = 'off';
  let device = 'rcrd_demo_player';
  const liked = new Set([tracks[0].uri, tracks[3].uri]);
  const collections = Array.from({ length: 14 }, (_, i) => discogsRelease(i));
  const wants = Array.from({ length: 8 }, (_, i) => discogsRelease(i + 4));
  const requests = [], blocked = [], unexpected = [];
  const playback = () => ({ item: current, is_playing: !paused, progress_ms: Math.min(current.duration_ms, position + (paused ? 0 : Date.now() - changedAt)), device: { id: device, name: device === 'rcrd_demo_player' ? 'RCRD · Spotify' : 'Living room speaker', is_active: true, supports_volume: true }, context: { uri: current.album.uri }, shuffle_state: shuffle, repeat_state: repeat, actions: {} });
  const sync = () => ({ source: 'live', updatedAt: Date.now() });
  function history(url) {
    const query = url.searchParams.get('q')?.toLowerCase() || '';
    const list = tracks.filter(t => `${t.name} ${t.artists[0].name}`.toLowerCase().includes(query)).map((t, i) => ({ title: t.name, artist: t.artists[0].name, album: t.album.name, plays: 360 - i }));
    const page = Number(url.searchParams.get('page') || 1);
    if (url.searchParams.get('sort') === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    return { imported: true, totalPlays: 12345, trackCount: tracks.length, lastAt: Date.UTC(2026, 9, 20), importedAt: Date.UTC(2026, 9, 22), page, perPage: 12, matches: list.length, tracks: list.slice((page - 1) * 12, page * 12) };
  }
  async function route(handler) {
    const request = handler.request();
    const url = new URL(request.url());
    if (Object.hasOwn(fontManifest, url.href)) return handler.fulfill({ contentType: url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(fontDirectory, fontManifest[url.href])) });
    if (url.origin !== ORIGIN) { blocked.push(url.origin); return handler.abort(); }
    const p = url.pathname;
    const json = (body, status = 200) => handler.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.startsWith('/api/')) {
      requests.push({ path: p, method: request.method() });
      const body = request.postData() && request.headers()['content-type'] !== 'application/zip' ? JSON.parse(request.postData()) : {};
      if (p === '/api/health') return json({ ok: true, app: 'rcrd', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, pid: 1 });
      if (p === '/api/spotify/status') return json({ connected, canModifyLibrary: true, canReadTop: true, daysRemaining: 170 });
      if (p === '/api/session') return json({ connected });
      if (p === '/api/spotify/me') return json({ id: 'example-listener', display_name: 'Example listener', followers: { total: 12 }, images: [] });
      if (p === '/api/spotify/token') return json({ access_token: 'synthetic-demo-no-access' });
      if (p === '/api/spotify/recent') return json({ recentlyPlayed: albumList.map(a => tracks.find(t => t.album.id === a.id)) });
      if (p === '/api/spotify/top-albums') return json({ tracks: [...albumList].reverse().map(a => tracks.find(t => t.album.id === a.id)) });
      if (p === '/api/spotify/library') return json({ savedAlbums: albumList.map(album => ({ album, added_at: '2026-10-22T12:00:00Z' })), saved: tracks.slice(0, 36).map(track => ({ track, added_at: '2026-10-22T12:00:00Z' })), sync: sync() });
      if (p === '/api/spotify/library-progress') return json({ active: false });
      if (p === '/api/spotify/playlists') return json({ playlists: [{ id: id(800), name: 'Morning records', tracksTotal: 20 }, { id: id(801), name: 'Road trip', tracksTotal: 16 }] });
      if (p === '/api/spotify/playlist') return json({ tracks: tracks.slice(0, 20), total: 20, sync: sync() });
      if (p === '/api/spotify/search') {
        const q = (url.searchParams.get('q') || '').toLowerCase().replace(/album:|artist:/g, '');
        const albums = albumList.filter(a => q.includes(a.name.toLowerCase()) || q.includes(a.artists[0].name.toLowerCase()) || `${a.name} ${a.artists[0].name}`.toLowerCase().includes(q));
        const songs = tracks.filter(t => `${t.name} ${t.album.name} ${t.artists[0].name}`.toLowerCase().includes(q)).slice(0, 5);
        return json({ albums: { items: albums, total: albums.length }, tracks: { items: url.searchParams.get('type') === 'album' ? [] : songs, total: songs.length } });
      }
      const album = /^\/api\/spotify\/albums\/(\d{22})\/tracks$/.exec(p);
      if (album) { const items = tracks.filter(t => t.album.id === album[1]); return json({ items, total: items.length }); }
      if (p === '/api/spotify/history') return json(history(url));
      if (p === '/api/spotify/mix-sources') return json({ seed: current, playlists: [], savedTracks: [], discoveryArtists: mixArtists, discoveryTracks: mixTracks, discoveryWarnings: [], playCounts: {}, partial: false });
      if (p === '/api/lyrics/genius') return json({ id: 123, title: current.name, url: 'https://genius.com/songs/123' });
      if (p === '/api/spotify/play-counts') return json({ counts: Object.fromEntries((body.tracks || []).map((t, i) => [t.uri, 18 + i * 7])), matches: Object.fromEntries((body.tracks || []).map(t => [t.uri, 'exact'])), lastSynced: Date.now() });
      if (p === '/api/spotify/liked') {
        if (request.method() === 'GET') return json({ saved: (url.searchParams.get('uris') || '').split(',').map(uri => liked.has(uri)) });
        const uris = body.uris || (body.uri ? [body.uri] : []);
        for (const uri of uris) request.method() === 'DELETE' ? liked.delete(uri) : liked.add(uri);
        return json({ ok: true, saved: request.method() !== 'DELETE' });
      }
      if (p === '/api/spotify/currently-playing') return json(playback());
      if (p === '/api/spotify/devices') return json({ devices: [{ id: 'rcrd_demo_player', name: 'RCRD · Spotify', is_active: device === 'rcrd_demo_player', is_restricted: false }, { id: 'demo_speaker', name: 'Living room speaker', is_active: device === 'demo_speaker', is_restricted: false }] });
      if (p === '/api/spotify/transfer') { device = body.device_id; return json({ ok: true }); }
      if (p === '/api/spotify/playback') {
        position = playback().progress_ms; changedAt = Date.now();
        if (body.action === 'start') { current = tracks.find(t => t.uri === body.uri || t.uri === body.uris?.[0]) || tracks.find(t => t.album.uri === body.uri || t.album.uri === body.context_uri) || current; paused = false; position = 0; }
        if (body.action === 'play') paused = false;
        if (body.action === 'pause') paused = true;
        if (['next', 'previous'].includes(body.action)) { const n = tracks.indexOf(current); current = tracks[(n + (body.action === 'next' ? 1 : tracks.length - 1)) % tracks.length]; position = 0; }
        if (body.action === 'seek') position = body.position_ms || 0;
        if (body.action === 'shuffle') shuffle = body.state;
        if (body.action === 'repeat') repeat = body.state;
        const result = playback();
        await json({ ok: true, playback: result });
        await request.frame().evaluate(data => window.__demoUpdatePlayback?.(data), result);
        return;
      }
      if (p === '/api/collection' || p === '/api/wantlist') {
        const list = p.endsWith('collection') ? collections : wants;
        if (request.method() === 'POST') { if (!list.some(r => r.id === body.release_id)) list.push(discogsRelease(0, body.release_id)); return json({ ok: true }); }
        return json({ username: 'Example listener', releases: list.map(basic_information => ({ basic_information })) });
      }
      const results = [0, 1, 2].map(n => ({ id: 9000 + n, master_id: 7000, title: `${artists[0]} - ${names[0]}`, year: 2020 + n, format: ['Vinyl', 'LP', n ? 'Reissue' : 'Album'], cover_image: `${ORIGIN}/art/0.svg`, resource_url: `https://api.discogs.com/releases/${9000 + n}`, uri: `/release/${9000 + n}` }));
      if (p === '/api/search' || /\/masters\/\d+\/versions$/.test(p)) return json({ results, pagination: { page: 1, per_page: 24, items: 3, pages: 1 } });
      const release = /^\/api\/discogs\/releases\/(\d+)$/.exec(p);
      if (release) { const n = Number(release[1]) - 9000; return json({ id: Number(release[1]), title: names[0], artists: [artists[0]], year: 2020 + n, country: n ? 'UK' : 'US', formats: [{ quantity: '1', name: 'Vinyl', descriptions: ['LP', n ? 'Reissue, Green' : 'Album, Black'] }], labels: [{ name: 'Example Records', catalogNumber: `EX-${101 + n}` }], identifiers: [{ type: 'Barcode', value: `EXAMPLE-${n}` }], trackCount: 10 }); }
      unexpected.push(p); return json({ error: 'Unimplemented demonstration request' }, 501);
    }
    if (p === '/genius-embed' && url.searchParams.get('id') === '123') return handler.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><style>body{margin:0;padding:28px;background:#f8f7f3;color:#253028;font:22px/1.7 Arial,sans-serif}small{display:block;margin-bottom:24px;color:#59675d;font-size:14px}strong{color:#243c2c}</style><body><small>Example lyrics · synthetic walkthrough music</small><strong>[Verse]</strong><br>Follow the lights beyond the avenue<br>Find a place to start again<br>Every song can lead somewhere new<br>Keep the records that stay with you</body></html>' });
    if (/^\/art\/\d+\.svg$/.test(p)) return handler.fulfill({ contentType: 'image/svg+xml', body: art(Number(p.match(/\d+/)[0])) });
    const relative = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const permitted = /^(index\.html|app\.js|styles\.css|distinction\.css|manifest\.webmanifest|assets\/[A-Za-z0-9._/-]+)$/.test(relative) && !relative.includes('..');
    const target = path.resolve(root, relative);
    if (!permitted || !target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { blocked.push(p); return handler.abort(); }
    return handler.fulfill({ body: fs.readFileSync(target), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' })[path.extname(target)] || 'application/octet-stream' });
  }
  return { route, initial: playback(), sdkInstaller, requests, blocked, unexpected, setConnected(value) { connected = value; }, assertClean() { assert.deepEqual(unexpected, [], 'Every demonstration API request must have a fixture'); } };
}
module.exports = { createFixture, ORIGIN, albumList, tracks };
