const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const sourceLines = source.split(/\r?\n/);

function applicationFunction(name) {
  const start = sourceLines.findIndex(line => line.startsWith(`function ${name}(`) || line.startsWith(`async function ${name}(`));
  assert.notEqual(start, -1, `${name} should exist in app.js`);
  const lines = [];
  for (let index = start; index < sourceLines.length; index++) {
    lines.push(sourceLines[index]);
    if ((index === start && sourceLines[index].trimEnd().endsWith('}')) || (index > start && sourceLines[index] === '}')) return lines.join('\n');
  }
  assert.fail(`${name} should have a closing brace`);
}

function harness(fetch) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', innerHTML: '', textContent: '', hidden: false, classList: { toggle() {} } });
    return nodes.get(selector);
  };
  node('.active-view').id = 'home';
  const listeners = [];
  const context = vm.createContext({
    document: { querySelector: node, addEventListener: (_, callback) => listeners.push(callback) },
    fetch, escapeHtml: value => String(value), safeImageUrl: value => value || '', setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
    sortRecords: items => items, spotifyAlbumCard: record => `<article>${record.title}</article>`,
    renderPagination() {}, updateHomeRecommendations() {}, scheduleSpotifyPlayCounts() {}
  });
  vm.runInContext(`let spotifyConnected=true,spotifyAccountGeneration=0,spotifyLibraryLoaded=false,spotifySavedLibraryLoaded=false,spotifyPlaylistPreviewState=null,spotifyLibraryPromise=null,spotifyLibraryError='',spotifyLibraryRevision=0,spotifyLibraryNeedsRefresh=false,spotifyLibraryAlbums=[],spotifySavedAlbums=[],spotifyLibraryTracks=[],spotifyLibraryPlaybackRecords=[],spotifyLibraryPage=1,spotifyPageSize=24,spotifyLibraryMode='grid',spotifyLibrarySort='recent',spotifySearchMode='library',spotifyLibraryProgressTimer=null,spotifyLibraryLastUpdated=0,spotifyLibraryLastUpdatedGeneration=-1,spotifyLibrarySyncSource='live',spotifyNoticeTimer=null;`, context);
  for (const name of ['libraryUpdatedLabel', 'spotifySourceLabel', 'spotifySyncLabel', 'savedLibraryFreshnessNote', 'cacheTimestampLabel', 'scheduleSpotifyCatalogNoticeDismissal', 'showSpotifyLibraryNotice', 'settleSpotifyLibraryNotice', 'maybeLoadSpotifyLibrary', 'savedTrackDisplayKey', 'renderSpotifyLibrary', 'spotifyPlaylistRecords', 'refreshSpotifyLibrary']) {
    vm.runInContext(applicationFunction(name), context);
  }
  vm.runInContext(source.split('\n').find(line => line.startsWith("document.addEventListener('click',event=>{if(event.target.closest('[data-view=\"spotify\"]'))")), context);
  return { node, listeners, run: code => vm.runInContext(code, context) };
}

test('play-count sorting considers the entire matching library before slicing a page', () => {
  const h=harness();
  h.run(`spotifyLibraryLoaded=true;spotifyLibrarySort='plays';spotifyPageSize=12;spotifyPlayCounts=new Map();spotifyLibraryTracks=Array.from({length:55},(_,index)=>({kind:'track',title:'Song '+index,artist:'Example',album:'Album '+index,uri:'spotify:track:'+index}));spotifyLibraryAlbums=[];spotifyPlayCounts.set('spotify:track:54',{plays:100});scheduleSpotifyPlayCounts=records=>globalThis.requestedCount=records.length`);
  h.run(sourceLines.find(line=>line.startsWith('function sortRecords(')));
  h.node('#spotifySortDirection').value='desc';h.run("renderSpotifyLibrary('')");
  assert.ok(h.node('#spotifyGrid').innerHTML.startsWith('<article>Song 54</article>'));
  assert.equal(h.run('requestedCount'),55,'all tracks, not just twelve visible rows, are requested');
});

test('Saved music page size changes the visible slice and clamps the current page', () => {
  const h = harness();
  h.run(`spotifyLibraryLoaded=true;spotifyLibraryTracks=Array.from({length:55},(_,index)=>({kind:'track',title:'Song '+index,artist:'Example',album:'Album '+index,uri:'spotify:track:'+index}));spotifyLibraryAlbums=[];spotifyPageSize=12;renderSpotifyLibrary('',5)`);
  assert.equal((h.node('#spotifyGrid').innerHTML.match(/<article>/g) || []).length, 7);
  assert.equal(h.run('spotifyLibraryPage'), 5);
  h.run("spotifyPageSize=48;renderSpotifyLibrary('',5)");
  assert.equal((h.node('#spotifyGrid').innerHTML.match(/<article>/g) || []).length, 7);
  assert.equal(h.run('spotifyLibraryPage'), 2);
  h.run("spotifyLibraryPage=1;renderSpotifyLibrary('')");
  assert.equal((h.node('#spotifyGrid').innerHTML.match(/<article>/g) || []).length, 48);
  const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(markup, /id="spotifyPageSize"[^>]*><option value="12">12<\/option><option value="24">24<\/option><option value="48">48<\/option>/);
  assert.match(source, /spotifyPageSize=allowedPreference\(Number\(uiPreferences\.spotifyPageSize\),\[12,24,48\],24\)/);
  assert.match(source, /spotifyPageSize=allowedPreference\(Number\(event\.target\.value\),\[12,24,48\],24\);spotifyLibraryPage=1/);
});

test('Saved Music navigation starts loading after the view switches, and shares the pending request', async () => {
  let resolve, calls = 0;
  const h = harness(() => { calls++; return new Promise(done => { resolve = done; }); });
  h.node('.active-view').id = 'spotify';
  h.listeners[0]({ target: { closest: () => ({}) } });
  assert.equal(calls, 1);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, 'Loading library');
  assert.match(h.node('#spotifyGrid').innerHTML, /Loading your complete Spotify library/);
  h.listeners[0]({ target: { closest: () => ({}) } });
  assert.equal(calls, 1);
  resolve({ ok: true, json: async () => ({ savedAlbums: [{ album: { id: 'a', name: 'Real saved album', artists: [{ name: 'Artist' }] } }] }) });
  await h.run('spotifyLibraryPromise');
  assert.match(h.node('#spotifyGrid').innerHTML, /Real saved album/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 saved album');
});

test('API failure replaces loading with the actual library error', async () => {
  const h = harness(async () => ({ ok: false, json: async () => ({ error: 'Spotify request limit reached.' }) }));
  await h.run('refreshSpotifyLibrary()');
  assert.equal(h.node('#spotifyLibraryStatus').textContent, 'Library unavailable');
  assert.match(h.node('#spotifyGrid').innerHTML, /Spotify request limit reached/);
  assert.equal(h.node('#spotifyPlayCountInfo').hidden, true);
});

test('empty connected library resolves without demo albums', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ saved: [], savedAlbums: [] }) }));
  await h.run('refreshSpotifyLibrary()');
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '0 saved items');
  assert.match(h.node('#spotifyGrid').innerHTML, /No Spotify library items/);
});

test('saved library omits unavailable sync source and timestamp without repeating result counts', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({
    savedAlbums: [{ album: { id: 'album-1', name: 'Synthetic album', artists: [{ name: 'Artist' }] } }],
    saved: [{ track: { id: 'track-1', name: 'Synthetic track', album: { id: 'album-1', name: 'Synthetic album' } } }]
  }) }));
  await h.run('refreshSpotifyLibrary()');
  assert.equal(h.node('#spotifyLibraryNote').textContent, 'Saved library ready.');
  assert.doesNotMatch(h.node('#spotifyLibraryNote').textContent, /unknown|updated/i);
});

test('saved library shows song titles and album-only saves without duplicate album rows', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({
    savedAlbums: [
      { album: { id: 'album-1', name: 'Blue Album', artists: [{ name: 'Example Artist' }] } },
      { album: { id: 'album-2', name: 'Other Album', artists: [{ name: 'Example Artist' }] } }
    ],
    saved: [{ added_at: '2026-01-02T00:00:00Z', track: { name: 'Blue Song', uri: 'spotify:track:synthetic', artists: [{ name: 'Example Artist' }], album: { id: 'album-1', name: 'Blue Album' } } }]
  }) }));
  await h.run('refreshSpotifyLibrary()');
  assert.match(h.node('#spotifyGrid').innerHTML, /<article>Blue Song<\/article>/);
  assert.match(h.node('#spotifyGrid').innerHTML, /<article>Other Album<\/article>/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /<article>Blue Album<\/article>/);
  assert.equal(h.node('#spotifyPlayCountInfo').hidden, false, 'song counts expose the info control');
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 saved song');

  h.run("renderSpotifyLibrary('Blue Song')");
  assert.match(h.node('#spotifyGrid').innerHTML, /Blue Song/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /<article>Blue Album<\/article>/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 matching song');
  assert.equal(h.run('spotifyLibraryTracks[0].uri'), 'spotify:track:synthetic');
  assert.equal(h.run('spotifyLibraryTracks[0].format'), 'Spotify saved track');
  assert.equal(h.run('spotifyLibraryTracks[0].kind'), 'track');
  assert.equal(h.run('spotifyLibraryTracks[0].album'), 'Blue Album');

  h.run("renderSpotifyLibrary('Blue')");
  assert.match(h.node('#spotifyGrid').innerHTML, /Blue Song/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /<article>Blue Album<\/article>/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 matching song');

  h.run("renderSpotifyLibrary('Other')");
  assert.match(h.node('#spotifyGrid').innerHTML, /<article>Other Album<\/article>/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 matching album');
  assert.equal(h.node('#spotifyPlayCountInfo').hidden, true, 'album-only results hide song-count help');

  h.run("renderSpotifyLibrary('')");
  assert.match(h.node('#spotifyGrid').innerHTML, /<article>Blue Song<\/article>/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /<article>Blue Album<\/article>/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 saved song');

  h.node('#spotifyPlaylistSelect').value = 'synthetic-playlist';
  h.run("spotifyLibraryAlbums=spotifyPlaylistRecords([{name:'Playlist Song',album:{name:'Playlist Album'}}]);renderSpotifyLibrary('Blue')");
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Blue Song/);
  assert.match(h.node('#spotifyGrid').innerHTML, /No Spotify library items matched/);
});

test('albums with identical titles but different Spotify IDs remain separate', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({
    savedAlbums: [
      { album: { id: 'edition-one', name: 'Same Title', artists: [{ name: 'Example Artist' }] } },
      { album: { id: 'edition-two', name: 'Same Title', artists: [{ name: 'Example Artist' }] } }
    ],
    saved: [{ track: { name: 'A Song', artists: [{ name: 'Example Artist' }], album: { id: 'edition-one', name: 'Same Title' } } }]
  }) }));
  await h.run('refreshSpotifyLibrary()');
  assert.match(h.node('#spotifyGrid').innerHTML, /<article>A Song<\/article>/);
  assert.equal((h.node('#spotifyGrid').innerHTML.match(/<article>Same Title<\/article>/g)||[]).length, 1);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 saved song');
});

test('Saved Music groups matching track versions without discarding their counts or playback IDs', () => {
  const h = harness(async () => { throw new Error('No provider request expected'); });
  h.run("spotifyAlbumCard=record=>'<article data-uri=\"'+record.uri+'\" data-index=\"'+String(record.playbackIndex)+'\">'+record.title+'</article>'");
  h.run(`spotifyLibraryLoaded=true;spotifyLibraryTracks=[
    {kind:'track',title:'Same song',artist:'Example Artist',album:'Same album',year:'2020',image:'same-art',uri:'spotify:track:first'},
    {kind:'track',title:'Same song',artist:'Example Artist',album:'Same album',year:'2020',image:'same-art',uri:'spotify:track:second'},
    {kind:'track',title:'Same song',artist:'Example Artist',album:'Different album',year:'2020',image:'same-art',uri:'spotify:track:other'},
    {kind:'track',title:'Same song',artist:'Example Artist',album:'Same album',year:'2020',image:'different-art',uri:'spotify:track:remaster'}
  ];spotifyLibraryAlbums=[];renderSpotifyLibrary('')`);
  const html = h.node('#spotifyGrid').innerHTML;
  assert.equal((html.match(/class="saved-track-group"/g) || []).length, 1);
  assert.match(html, /<details class="saved-track-versions"><summary>2 saved versions · show others<\/summary>/);
  assert.match(html, /data-uri="spotify:track:first" data-index="0"/);
  assert.match(html, /data-uri="spotify:track:second" data-index="1"/);
  assert.match(html, /data-uri="spotify:track:other" data-index="2"/);
  assert.match(html, /data-uri="spotify:track:remaster" data-index="3"/);
  assert.equal(h.run('spotifyLibraryPlaybackRecords.length'), 4, 'grouping does not remove playback choices');
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '4 saved songs');
  h.node('#spotifyPlaylistSelect').value = 'syntheticplaylist';
  h.run("spotifyLibraryAlbums=spotifyLibraryTracks;renderSpotifyLibrary('')");
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /saved-track-group/, 'playlist entries keep their existing order and rows');
});

test('Saved Music playback positions follow the current sorted result list', () => {
  const h = harness(async () => { throw new Error('No provider request expected'); });
  h.run("spotifyAlbumCard=record=>'<article data-index=\"'+String(record.playbackIndex)+'\">'+record.title+'</article>'");
  h.run("spotifyLibraryLoaded=true;spotifyLibraryTracks=[{kind:'track',title:'First',artist:'Artist',album:'One',uri:'spotify:track:first'},{kind:'track',title:'Second',artist:'Artist',album:'Two',uri:'spotify:track:second'}];spotifyLibraryAlbums=[];renderSpotifyLibrary('')");
  assert.match(h.node('#spotifyGrid').innerHTML, /data-index="0">First/);
  assert.match(h.node('#spotifyGrid').innerHTML, /data-index="1">Second/);
  assert.equal(h.run('spotifyLibraryPlaybackRecords.length'), 2);
  h.node('#spotifyPlaylistSelect').value = 'syntheticplaylist';
  h.run("spotifyLibraryAlbums=spotifyPlaylistRecords([{name:'Playlist song',uri:'spotify:track:playlist',album:{name:'Album'}}],'syntheticplaylist');renderSpotifyLibrary('')");
  assert.equal(h.run('spotifyLibraryPlaybackRecords.length'), 0, 'playlist context replaces the saved-track sequence');
});
