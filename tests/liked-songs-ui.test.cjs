const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function definition(name) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line.startsWith(`function ${name}(`) || line.startsWith(`async function ${name}(`));
  assert.ok(start >= 0, `${name} exists`);
  if (lines[start].trimEnd().endsWith('}')) return lines[start];
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `${name} closes`);
  return lines.slice(start, end + 1).join('\n');
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(fetch) {
  const requests = [];
  const toasts = [];
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      disabled: false, textContent: '', title: '', attributes: {},
      classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; }
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [] },
    fetch: (url, options) => {
      requests.push({ url, options });
      return fetch(url, options);
    },
    showToast(message) { toasts.push(message); },
    closeLyricsDialog() {}
  });
  vm.runInContext(`let spotifyConnected=true,spotifyCanModifyLibrary=true,spotifyAccountGeneration=0,
    spotifyTrackUri=null,likedStatus=null,likedRequestRevision=0,likedCheckPending=false,likedMutationPending=false,
    spotifyLibraryLoaded=true,spotifyLibraryPromise=null,spotifyLibraryRevision=0,spotifyLibraryNeedsRefresh=false,
    spotifyPlaybackStateRevision=0,spotifySkipPending=0,spotifyTogglePending=false,spotifyPlaybackStartPending=0,spotifyPlaybackSyncGeneration=null,spotifyPlaybackSyncAgain=false,
    shuffleRequestPending=false,shuffleRevision=0,repeatRequestPending=false,repeatRevision=0;`, context);
  for(const name of ['syncSpotifyAlbumTrackIndicator','syncAlbumTrackLikedStatus','renderAlbumTrackLiked'])vm.runInContext(definition(name), context);
  return {
    node, requests, toasts, context,
    load: (...names) => names.forEach(name => vm.runInContext(definition(name), context)),
    run: code => vm.runInContext(code, context)
  };
}

test('track bar exposes one accessible Liked Songs toggle with an initially unavailable state', () => {
  const tag = markup.match(/<button\b[^>]*\bid="playerLiked"[^>]*>/)?.[0];
  assert.ok(tag, 'Liked Songs track-bar button exists');
  assert.match(tag, /\baria-label="[^"]+"/);
  assert.match(tag, /\baria-pressed="false"/);
  assert.match(tag, /\bdisabled\b/);
});

test('Spotify permission action is outside tab views so it remains available across navigation', () => {
  const reminder = markup.indexOf('id="spotifyReminder"');
  const firstView = markup.indexOf('<section id="home"');
  const headerEnd = markup.indexOf('</header>');
  assert.ok(reminder > headerEnd && reminder < firstView, 'permission notice belongs to the shared main layout, not a hidden tab');
  assert.equal((markup.match(/id="spotifyReminder"/g) || []).length, 1);
  assert.match(source, /data-spotify-authorize>Enable Liked Songs<\/button>/);
  assert.match(source, /closest\('\[data-spotify-authorize\]'\).*location\.href='\/auth\/spotify\/start'/);
});

test('membership is checked once per distinct current track and updates accessible state', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ saved: true }) }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:syntheticA')");
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /^\/api\/spotify\/liked\?uri=spotify%3Atrack%3AsyntheticA$/);
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('#playerLiked').getAttribute('aria-label'), 'Liked Songs');
  assert.match(h.node('#playerLiked').title, /remove/i);
  assert.equal(h.node('#playerLiked').disabled, false);
  await h.run("setCurrentSpotifyTrackUri('spotify:track:syntheticA')");
  assert.equal(h.requests.length, 1, 'the playback poll must not repeat the membership check');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:syntheticB')");
  assert.equal(h.requests.length, 2);
});

test('an older membership response cannot repaint a newer track', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const h = harness(() => (++calls === 1 ? first : second).promise);
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri');
  const oldCheck = h.run("setCurrentSpotifyTrackUri('spotify:track:older')");
  const newCheck = h.run("setCurrentSpotifyTrackUri('spotify:track:newer')");
  second.resolve({ ok: true, json: async () => ({ saved: false }) });
  await newCheck;
  first.resolve({ ok: true, json: async () => ({ saved: true }) });
  await oldCheck;
  assert.equal(h.run('spotifyTrackUri'), 'spotify:track:newer');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'false');
  assert.equal(h.node('#playerLiked').disabled, false);
});

test('a playback poll started before newer SDK state cannot restore the old track', async () => {
  const poll = deferred();
  const h = harness(url => url === '/api/spotify/currently-playing'
    ? poll.promise
    : Promise.resolve({ ok: true, json: async () => ({ saved: false }) }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri', 'syncCurrentSpotifyTrack');
  h.run('function updatePlaybackModes(){} function setSong(){} function updateProgress(){} function renderPlayer(){}');
  const request = h.run('syncCurrentSpotifyTrack()');
  h.run('++spotifyPlaybackStateRevision');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:newer')");
  poll.resolve({ ok: true, json: async () => ({ item: { uri: 'spotify:track:older', name: 'Old', artists: [], album: {} }, is_playing: true }) });
  await request;
  assert.equal(h.run('spotifyTrackUri'), 'spotify:track:newer');
  assert.equal(h.requests.filter(entry => entry.url.startsWith('/api/spotify/liked')).length, 1);
});

test('disconnect or missing write permission never presents the track as actionable', async () => {
  const check = deferred();
  const h = harness(() => check.promise);
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri');
  const request = h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  h.run('spotifyConnected=false;++spotifyAccountGeneration;renderPlayerLiked()');
  check.resolve({ ok: true, json: async () => ({ saved: true }) });
  await request;
  assert.equal(h.node('#playerLiked').disabled, true);
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'false');
  h.run('spotifyConnected=true;spotifyCanModifyLibrary=false;renderPlayerLiked()');
  assert.equal(h.node('#playerLiked').disabled, true);
});

test('unscoped sessions and non-track playback never check or mutate Liked Songs', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ saved: false }) }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri', 'toggleCurrentTrackLiked');
  await h.run("spotifyCanModifyLibrary=false;setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  assert.equal(h.requests.length, 0);
  assert.equal(h.node('#playerLiked').disabled, true);
  assert.match(h.node('#playerLiked').getAttribute('aria-label'), /permission/i);
  await h.run("spotifyCanModifyLibrary=true;setCurrentSpotifyTrackUri('spotify:episode:synthetic')");
  await h.run('toggleCurrentTrackLiked()');
  assert.equal(h.requests.length, 0);
  assert.equal(h.node('#playerLiked').disabled, true);
});

test('failed membership check offers a retry without assuming the track is unliked', async () => {
  const h = harness(async () => ({ ok: false, json: async () => ({ error: 'Synthetic status failure' }) }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri', 'toggleCurrentTrackLiked');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'mixed');
  assert.match(h.node('#playerLiked').getAttribute('aria-label'), /retry/i);
  await h.run('toggleCurrentTrackLiked()');
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(request => !request.options?.method), 'unknown status must never send a save');
  assert.equal(h.node('#playerLiked').disabled, false);
  assert.match(h.toasts.at(-1), /Synthetic status failure/);
});

test('rapid clicks send one mutation; a failed save does not falsely mark the track liked', async () => {
  const first = deferred();
  const h = harness((url, options) => options?.method === 'PUT' ? first.promise : Promise.resolve({ ok: true, json: async () => ({ saved: false }) }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri', 'toggleCurrentTrackLiked');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  const click = h.run('toggleCurrentTrackLiked()');
  await h.run('toggleCurrentTrackLiked()');
  assert.equal(h.requests.filter(request => request.options?.method === 'PUT').length, 1);
  assert.equal(h.node('#playerLiked').disabled, true);
  const mutation = h.requests.find(request => request.options?.method === 'PUT');
  assert.equal(mutation.options.headers['X-RCRD-Request'], '1');
  assert.deepEqual(JSON.parse(mutation.options.body), { uri: 'spotify:track:synthetic', saved: true });
  first.resolve({ ok: false, json: async () => ({ error: 'Synthetic rejection' }) });
  await click;
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'false');
  assert.equal(h.node('#playerLiked').disabled, false);
  assert.match(h.toasts.at(-1), /Synthetic rejection/);
});

test('successful save and remove follow provider acknowledgement without reloading the full library', async () => {
  const h = harness(async (url, options) => ({
    ok: true,
    json: async () => options?.method === 'PUT'
      ? { ok: true, saved: JSON.parse(options.body).saved }
      : { saved: false }
  }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri', 'toggleCurrentTrackLiked');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  await h.run('toggleCurrentTrackLiked()');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('#playerLiked').disabled, false);
  await h.run('toggleCurrentTrackLiked()');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'false');
  const mutations = h.requests.filter(request => request.options?.method === 'PUT');
  assert.deepEqual(mutations.map(request => JSON.parse(request.options.body).saved), [true, false]);
  assert.equal(h.requests.length, 3, 'one membership check and two mutations, not a full-library request');
});

test('confirmed Spotify save remains liked when local cache cleanup needs attention', async () => {
  const warning = 'Spotify saved the track, but local library cache cleanup needs attention.';
  const h = harness(async (url, options) => ({
    ok: true,
    json: async () => options?.method === 'PUT'
      ? { ok: true, saved: true, cacheWarning: warning }
      : { saved: false }
  }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri', 'toggleCurrentTrackLiked');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  await h.run('toggleCurrentTrackLiked()');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('#playerLiked').disabled, false);
  assert.equal(h.toasts.at(-1), warning);
});

test('a completed mutation for a previous track cannot change the new track heart', async () => {
  const mutation = deferred();
  const h = harness((url, options) => options?.method === 'PUT'
    ? mutation.promise
    : Promise.resolve({ ok: true, json: async () => ({ saved: url.includes('newer') }) }));
  h.load('renderPlayerLiked', 'refreshCurrentTrackLikedStatus', 'setCurrentSpotifyTrackUri', 'toggleCurrentTrackLiked');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:older')");
  const saveOld = h.run('toggleCurrentTrackLiked()');
  await h.run("setCurrentSpotifyTrackUri('spotify:track:newer')");
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'true');
  mutation.resolve({ ok: true, json: async () => ({ ok: true, saved: true }) });
  await saveOld;
  assert.equal(h.run('spotifyTrackUri'), 'spotify:track:newer');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'), 'true');
  assert.equal(h.node('#playerLiked').disabled, false);
});

function albumPanel(h, uris) {
  const id = 'A'.repeat(22);
  const panel = h.node(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);
  panel.dataset = {albumId:id};
  const buttons = uris.map(uri => ({dataset:{uri,likedState:'checking'},setAttribute(name,value){this[name]=value;}}));
  panel.querySelectorAll = () => buttons;
  h.context.document.querySelectorAll = selector => selector.includes('spotify-track-liked') ? buttons : [];
  h.context.syntheticPanel = panel;
  h.run('let spotifySearchSequence=1');
  h.load('renderPlayerLiked','refreshCurrentTrackLikedStatus','setCurrentSpotifyTrackUri','loadSpotifyAlbumLikedStatus','toggleCurrentTrackLiked');
  return buttons;
}

test('a fresh album membership check corrects the playing heart and rejects its older pending check', async () => {
  const pending = deferred();
  const h = harness(url => url.includes('?uris=')
    ? Promise.resolve({ok:true,json:async()=>({saved:[true,false]})}) : pending.promise);
  const buttons = albumPanel(h,['spotify:track:synthetic','spotify:track:other']);
  const old = h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  await h.run('loadSpotifyAlbumLikedStatus(syntheticPanel,spotifySearchSequence,spotifyAccountGeneration)');
  assert.equal(buttons[0].textContent,'♥');
  assert.equal(buttons[1].textContent,'♡');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'),'true');
  assert.equal(h.node('#playerLiked').disabled,false);
  pending.resolve({ok:true,json:async()=>({saved:false})});
  await old;
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'),'true');
  assert.equal(h.requests.length,2,'reuse the album response, without another status request');
});

test('track-bar remove updates album peers and an older album batch cannot undo it', async () => {
  const batch = deferred();
  const h = harness((url,options) => url.includes('?uris=') ? batch.promise
    : Promise.resolve({ok:true,json:async()=>options?.method==='PUT'?{ok:true,saved:false}:{saved:true}}));
  const buttons = albumPanel(h,['spotify:track:synthetic']);
  await h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  const old = h.run('loadSpotifyAlbumLikedStatus(syntheticPanel,spotifySearchSequence,spotifyAccountGeneration)');
  await h.run('toggleCurrentTrackLiked()');
  assert.equal(buttons[0].textContent,'♡');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'),'false');
  batch.resolve({ok:true,json:async()=>({saved:[true]})});
  await old;
  assert.equal(buttons[0].textContent,'♡');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'),'false');
});

test('track-bar save updates matching album hearts only after confirmation and preserves other IDs', async () => {
  const mutation = deferred();
  const h = harness((url,options) => options?.method==='PUT' ? mutation.promise
    : Promise.resolve({ok:true,json:async()=>({saved:false})}));
  const buttons = albumPanel(h,['spotify:track:synthetic','spotify:track:other']);
  await h.run("setCurrentSpotifyTrackUri('spotify:track:synthetic')");
  buttons.forEach(button=>h.context.renderAlbumTrackLiked(button,'unsaved'));
  const save = h.run('toggleCurrentTrackLiked()');
  assert.equal(buttons[0].textContent,'♡');
  mutation.resolve({ok:true,json:async()=>({ok:true,saved:true})});
  await save;
  assert.equal(buttons[0].textContent,'♥');
  assert.equal(buttons[1].textContent,'♡');
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'),'true');
});

test('album membership cannot override a pending player mutation or a disconnected account', async () => {
  const batch = deferred();
  const h = harness(()=>batch.promise);
  albumPanel(h,['spotify:track:synthetic']);
  h.run("spotifyTrackUri='spotify:track:synthetic';likedStatus=false;likedMutationPending=true");
  const check = h.run('loadSpotifyAlbumLikedStatus(syntheticPanel,spotifySearchSequence,spotifyAccountGeneration)');
  batch.resolve({ok:true,json:async()=>({saved:[true]})});
  await check;
  assert.equal(h.run('likedStatus'),false);
  assert.equal(h.run('likedMutationPending'),true);
  h.run("spotifyConnected=false;++spotifyAccountGeneration;likedMutationPending=false;renderPlayerLiked()");
  assert.equal(h.node('#playerLiked').getAttribute('aria-pressed'),'false');
});
