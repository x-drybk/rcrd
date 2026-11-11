const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styles = ['styles.css', 'distinction.css'].map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
const definition = name => {
  const lines = source.split('\n');
  const start = lines.findIndex(value => value.startsWith(`function ${name}(`) || value.startsWith(`async function ${name}(`));
  assert.ok(start >= 0, `${name} exists`);
  if (lines[start].trimEnd().endsWith('}')) return lines[start];
  const end = lines.findIndex((value, index) => index > start && value === '}');
  assert.ok(end > start, `${name} closes`);
  return lines.slice(start, end + 1).join('\n');
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(fetch = async () => ({ ok: true, json: async () => ({}) }), extra = {}) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', innerHTML: '', textContent: '', disabled: false, hidden: false, children: [], dataset: {}, style: {},
      attributes: {}, classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      replaceChildren() { this.innerHTML = ''; this.children = []; },
      append(...children) { this.children.push(...children); }
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: selector => selector === '#previousButton,#nextButton' || selector === '#previousButton,#nextButton,#playButton' ? selector.split(',').map(node) : [], createElement: tag => ({ tag, textContent: '', children: [], append(...children) { this.children.push(...children); } }) },
    fetch, URL, URLSearchParams, AbortController, performance: { now: () => Date.now() }, clearInterval() {}, setInterval() { return 1; }, setTimeout() { return 1; }, clearTimeout() {},
    escapeHtml: value => String(value), safeImageUrl: () => '',
    setSidebarPlaylistOptions() {},
    renderListeningDiscogsSuggestions() {}, setSong() {}, closeLyricsDialog() {}, updatePlaybackModes() {}, loadSpotifyDevices() {}, syncCurrentSpotifyTrack() {},
    updateProgress() {}, renderPlayer() {}, updateHomeRecommendations() {},
    purgeStoredDiscogsRecords() {},
    sortRecords: records => records, spotifyAlbumCard: record => `<article>${record.title}</article>`, discogsDataCredit: () => '',
    renderPagination() {}, syncThemedSelect() {}, syncSpotifySortControls() {}, showToast() {}, scheduleSpotifyPlayCounts() {}, resetSpotifyPlayCounts() {}, spotifyPlayCounts: new Map(), ...extra
  });
  vm.runInContext(`let spotifyConnected=true,spotifyAccountGeneration=0,spotifyHomeRequest=null,spotifyHomeNextRefresh=0,spotifyHomeRateLimitedUntil=0,
    spotifyLibraryAlbums=[],spotifySavedAlbums=[],spotifyLibraryTracks=[],spotifyLibraryPlaybackRecords=[],spotifyHomeRecommendations=[],spotifyTopAlbums=[],spotifyTopRequest=null,spotifyCanReadTop=false,homeDiscoveryMode='recent',
    spotifyLibraryLoaded=false,spotifySavedLibraryLoaded=false,spotifyPlaylistPreviewState=null,spotifyLibraryPromise=null,spotifyLibraryError='',spotifyTrackUri=null,
    spotifyLibraryProgressTimer=null,spotifyLibraryProgressBusy=false,spotifyLibraryLastUpdated=0,spotifyLibraryLastUpdatedGeneration=-1,spotifyLibrarySyncSource='live',spotifyNoticeTimer=null,
    spotifyCanModifyLibrary=false,likedStatus=null,likedCheckPending=false,likedRequestRevision=0,
    likedMutationPending=false,spotifyLibraryRevision=0,spotifyLibraryNeedsRefresh=false,
    spotifyDeviceId=null,spotifyTargetDeviceId=null,spotifyTargetSupportsVolume=true,spotifyDeviceRequestRevision=0,spotifyDeviceRefreshTimer=null,spotifyDeviceRefreshBusy=0,spotifyDeviceRefreshEnabled=false,availableSpotifyDevices=new Map(),spotifySyncTimer=null,spotifyProgressTimer=null,spotifyPlayerReadyTimer=null,spotifyPlayer=null,spotifyPlayerConnectFailed=false,spotifyDurationMs=0,spotifyPositionMs=0,spotifyProgressUpdatedAt=0,spotifyPlaybackStateRevision=0,spotifySdkStateRevision=0,
    spotifyHealthConnection=null,spotifyCanStream=null,spotifyPlayerState='waiting',spotifyPlayerIssue='',spotifyActiveDevice='Not checked',spotifyPlaybackSyncGeneration=null,spotifyPlaybackSyncAgain=false,ambientLastActivity=Date.now(),
    spotifySkipQueue=Promise.resolve(),spotifySkipPending=0,spotifySkipBusy={next:0,previous:0},spotifyToggleQueue=Promise.resolve(),spotifyTogglePending=0,spotifyModeQueue=Promise.resolve(),spotifyPlaybackStartPending=0,recentTracksData=[],playing=false,
    spotifyLibraryPage=1,spotifyPageSize=24,spotifyLibraryMode='grid',spotifyLibrarySort='recent',spotifyPlaylistSequence=0,
    spotifySearchMode='library',spotifySearchSequence=0,spotifySearchTimer=null,spotifySearchCompletion=null,collectionSpotifyLookup=null,spotifyCatalogResults=[],spotifyCatalogAlbumView=null,volume=0.65,
    shuffleEnabled=false,repeatMode='off',spotifyHasContext=false,shuffleRequestPending=false,shuffleRevision=0,repeatRequestPending=false,repeatRevision=0,
    listeningHistoryRevision=0,listeningHistoryBusy=false,listeningHistoryPage=1,listeningHistorySearchTimer=null;
    let apiConnected=true,discogsAccountGeneration=0,discogsSearchSequence=0,discogsSearchTimer=null,discogsMasterId=null,discogsMasterTitle='',collection=[],wantlist=[],
    collectionPage=1,wantlistPage=1,collectionPageSize=24,wantlistPageSize=24,discogsSearchResults=[],discogsSearchPagination={};
    const discogsRefreshSequence={collection:0,wantlist:0},discogsLoadedAt={collection:0,wantlist:0},discogsLastFailureAt={collection:0,wantlist:0},discogsRefreshRequest={collection:null,wantlist:null},DISCOGS_LIST_FRESH_MS=60000;
    const pressingCompareSelected=new Map();let pressingCompareRevision=0;`, context);
  vm.runInContext('let spotifyMixRevision=0,spotifyMixController=null,spotifyMixPreview=null;',context);
  vm.runInContext(definition('resetSpotifyMix'),context);
  vm.runInContext(source.split('\n').find(line => line.startsWith('const HOME_RECOMMENDATION_LIMIT=')), context);
  vm.runInContext(source.split('\n').find(line => line.startsWith('const HOME_RECOMMENDATION_PAGE_SIZE=')), context);
  vm.runInContext(source.split('\n').find(line => line.startsWith('let homeRecommendationPage=')), context);
  for (const name of ['artistSearchButton', 'renderPlayerLiked', 'syncAlbumTrackLikedStatus', 'renderAlbumTrackLiked', 'refreshCurrentTrackLikedStatus', 'syncSpotifyAlbumTrackIndicator', 'setCurrentSpotifyTrackUri', 'updateSettingsAccountAction', 'renderPlaybackHealth', 'renderVolumeControl', 'renderSpotifyConnectionStatus', 'applySpotifyActionAvailability', 'advanceSpotifyProgress', 'syncSpotifyPlaybackPolling', 'syncSpotifyDeviceRefresh', 'resetListeningHistoryUi']) {
    vm.runInContext(definition(name), context);
  }
  for (const name of ['libraryUpdatedLabel', 'spotifySourceLabel', 'spotifySyncLabel', 'savedLibraryFreshnessNote', 'cacheTimestampLabel', 'scheduleSpotifyCatalogNoticeDismissal', 'showSpotifyLibraryNotice', 'settleSpotifyLibraryNotice', 'savedTrackDisplayKey']) vm.runInContext(definition(name), context);
  return {
    node,
    load: (...names) => names.forEach(name => vm.runInContext(definition(name), context)),
    run: code => vm.runInContext(code, context),
    context
  };
}

test('provider credits point to the exact source and reject untrusted links', () => {
  const h=harness(undefined,{cover:()=>'<div class="cover"></div>',shelfBadges:()=>'',setPlayerAlbum(){}});
  h.load('discogsWebUrl','discogsDataCredit','spotifyAlbumCard','setSong');
  assert.match(h.run('discogsDataCredit({releaseId:42})'), /href="https:\/\/www\.discogs\.com\/release\/42"[^>]*>Data provided by Discogs\.<\/a>/);
  assert.equal(h.run("discogsDataCredit({uri:'https://evil.example/release/42'})"),'');
  const spotifyId='A'.repeat(22);
  const card=h.run(`spotifyAlbumCard({title:'Synthetic song',artist:'Example Artist',kind:'track',uri:'spotify:track:${spotifyId}'})`);
  assert.match(card,new RegExp(`href="https://open\\.spotify\\.com/track/${spotifyId}"`));
  assert.match(card,/aria-label="Open Synthetic song on Spotify" title="Open Spotify"><img src="assets\/spotify-icon-white\.svg" alt="" \/>/);
  assert.doesNotMatch(card,/>Open Spotify/);
  assert.doesNotMatch(card,/full-logo-framed/);
  assert.doesNotMatch(h.run("spotifyAlbumCard({title:'Synthetic song',artist:'Example Artist',kind:'track',uri:'spotify:track:bad'})"),/class="spotify-source-link"/);
  assert.match(markup, /class="player-title-line"><strong id="playerTitle"[^>]*>[^<]*<\/strong><a id="playerSpotifyLink"[^>]*><img src="assets\/spotify-icon-white\.svg" alt="" \/><\/a>/);
  h.run(`spotifyTrackUri='spotify:track:${spotifyId}';setSong('Synthetic song','Example Artist')`);
  assert.equal(h.node('#playerSpotifyLink').href,`https://open.spotify.com/track/${spotifyId}`);
  assert.equal(h.node('#playerSpotifyLink').hidden,false);
  h.run("spotifyTrackUri=null;setSong('Nothing playing','Playback unavailable')");
  assert.equal(h.node('#playerSpotifyLink').hidden,true);
});

test('Settings and guide hide search while returning to Listening restores it', () => {
  const h=harness(undefined,{syncSpotifySortControls(){}});h.load('updateSearchContext');
  for(const view of ['settings','guide','home','spotify']){
    h.node('.active-view').id=view;h.run('updateSearchContext()');
    assert.equal(h.node('.search').hidden,['settings','guide'].includes(view));
  }
});

test('home search result title and artwork open the identified album without a second search', () => {
  const id='Z'.repeat(22), loaded=[];
  const h=harness(undefined,{cover:()=>'<div class="cover"></div>',shelfMatch:()=>({}),shelfBadges:()=>''});
  h.node('.active-view').id='home';h.node('#homeDiscoveryTitle').scrollIntoView=()=>{};
  h.context.filterCards=query=>{loaded.push({query,album:h.run('collectionSpotifyLookup.item.id')});};
  h.load('spotifyAlbumCard','spotifySearchCard','openHomeSpotifyAlbum');
  h.run(`spotifyCatalogResults=[{type:'track',name:'Song',album:{id:'${id}',name:'Exact Album',artists:[{name:'Example Artist'}]}}]`);
  const html=h.run("spotifySearchCard(spotifyCatalogResults[0],'track',false,'home')");
  assert.match(html,/class="home-album-open spotify-album-title"/);
  assert.match(html,/class="home-album-open home-album-cover"/);
  h.run(`openHomeSpotifyAlbum('${id}')`);
  assert.deepEqual(loaded,[{query:'Exact Album Example Artist',album:id}]);
  h.run(`openHomeSpotifyAlbum('${'Y'.repeat(22)}')`);
  assert.equal(loaded.length,1,'unrelated IDs cannot open albums');
});

test('saved-song search opens its known album and Back restores the original result list', () => {
  const id='X'.repeat(22),loaded=[];
  const h=harness(undefined,{cover:()=>'<div></div>',shelfMatch:()=>({}),shelfBadges:()=>''});
  h.node('.active-view').id='spotify';h.context.loadSpotifyAlbumTracks=id=>loaded.push(id);
  h.load('spotifyAlbumCard','spotifySearchCard','spotifyCollectionResultCard','openSpotifyCatalogAlbum','returnToSpotifyCatalogResults');
  h.run(`spotifyCatalogPage=1;spotifyLibraryTracks=[{kind:'track',albumId:'${id}',album:'Known Album',artist:'Example Artist'}]`);
  h.node('#spotifyGrid').innerHTML='<article>Original saved-song results</article>';
  h.node('#searchInput').value='song query';h.run(`openSpotifyCatalogAlbum('${id}')`);
  assert.match(h.node('#spotifyGrid').innerHTML,/Known Album[\s\S]*<h4>Tracks<\/h4>/);
  assert.deepEqual(loaded,[id]);h.run('returnToSpotifyCatalogResults()');
  assert.equal(h.node('#spotifyGrid').innerHTML,'<article>Original saved-song results</article>');
  assert.equal(h.node('#searchInput').value,'song query');
});

test('restored Spotify scope synchronizes native and themed play-count sort availability', () => {
  const h=harness(),option={hidden:false,disabled:false},choice={hidden:false,disabled:false};
  const saved={id:'spotifySort',value:'plays',querySelector:()=>option,closest:()=>({querySelector:()=>choice})};
  const home={id:'homeSpotifySort',value:'recent',querySelector:()=>null,closest:()=>null};
  h.context.document.querySelectorAll=()=>[saved,home];h.load('syncSpotifySortControls');
  h.run("spotifyLibrarySort='plays';spotifySearchMode='catalog';syncSpotifySortControls()");
  assert.equal(saved.value,'recent');assert.equal(home.value,'recent');assert.equal(choice.hidden,true);assert.equal(choice.disabled,true);
  h.run("spotifySearchMode='library';syncSpotifySortControls()");
  assert.equal(saved.value,'plays');assert.equal(home.value,'recent');assert.equal(choice.hidden,false);assert.equal(choice.disabled,false);
  assert.match(definition('setSpotifySearchScope'),/syncSpotifySortControls\(\)/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','distinction.css'),'utf8'),/\.themed-select-list \[role="option"\]\[hidden\]\{display:none\}/);
});

test('track-bar artwork is an accessible album button and accepts SDK album URIs', () => {
  const id='P'.repeat(22),h=harness();h.load('setPlayerAlbum','setSong','resetSpotifyAccountUi');
  h.run(`spotifyTrackUri='spotify:track:synthetic';playing=false;setSong('Song','Example Artist','',{uri:'spotify:album:${id}',name:'Exact Album'})`);
  const button=h.node('#playerAlbumOpen');
  assert.equal(button.disabled,false,'paused tracks can still open their album');assert.equal(button.dataset.albumId,id);
  assert.equal(button.attributes['aria-label'],'View album: Exact Album');
  assert.match(markup,/<button type="button" class="player-art mini-cover" id="playerAlbumOpen"[^>]*disabled><\/button>/);
  h.run("setSong('Unavailable','Spotify','',{id:'invalid',name:'Wrong Album'})");
  assert.equal(button.disabled,true);assert.equal(button.dataset.albumId,'');
  h.run(`spotifyConnected=false;setSong('Connect Spotify','Playback unavailable','',{id:'${id}',name:'Old Album'})`);
  assert.equal(button.disabled,true);assert.equal(button.dataset.albumTitle,'');assert.equal(button.dataset.albumArtist,'');
  h.run(`spotifyConnected=true;setSong('Song','Artist','',{id:'${id}',name:'Old Album'});resetSpotifyAccountUi()`);
  assert.equal(button.disabled,true);assert.equal(button.dataset.albumId,'');assert.equal(button.dataset.albumTitle,'');
});

test('track-bar album click navigates in-app using playback metadata, not a search or saved-library match', () => {
  const id='Q'.repeat(22),h=harness(),opened=[];let navigations=0;
  h.node('.active-view').id='settings';h.node('.sidebar nav a[data-view="home"]').click=()=>{navigations++;h.node('.active-view').id='home';};
  h.node('#homeDiscoveryTitle').scrollIntoView=()=>{};
  h.context.filterCards=query=>opened.push({query,id:h.run('collectionSpotifyLookup.item.id')});
  h.load('setPlayerAlbum','setSong','openPlayerAlbum','openHomeSpotifyAlbum');
  h.run(`spotifyTrackUri='spotify:track:synthetic';setSong('Current Song','Example Artist','',{id:'${id}',name:'Not In Library'});openPlayerAlbum()`);
  assert.equal(navigations,1);assert.deepEqual(opened,[{query:'Not In Library Example Artist',id}]);
  h.run('setPlayerAlbum(null);openPlayerAlbum()');assert.equal(navigations,1,'missing metadata cannot navigate');
  h.run(`openHomeSpotifyAlbum('invalid',{id:'invalid',name:'Bad'})`);assert.equal(opened.length,1);
});

test('a playback track change immediately disables the previous album action', () => {
  const h=harness();h.load('setPlayerAlbum');
  h.run(`spotifyTrackUri='spotify:track:old';setPlayerAlbum({id:'${'R'.repeat(22)}',name:'Previous Album'});setCurrentSpotifyTrackUri(null)`);
  assert.equal(h.node('#playerAlbumOpen').disabled,true);
  assert.equal(h.node('#playerAlbumOpen').attributes['data-album-id'],'');
  assert.equal(h.node('#playerAlbumOpen').attributes['aria-label'],'Album unavailable');
});

test('player keeps Discogs and volume actions without a Queue control', () => {
  assert.match(markup, /id="playerDiscogs"/);
  assert.match(markup, /id="volumeButton"/);
  assert.doesNotMatch(markup, /id="queueButton"/);
  assert.doesNotMatch(source, /queueCurrentTrack|#queueButton/);
});

test('Wantlist separates edition search from an exact-release Discogs shopping handoff', () => {
  const h = harness();
  h.context.cover = () => '<div class="cover"></div>';
  h.load('renderWantlist');
  h.run("let wantlistSort='recent';wantlist=[{title:'Synthetic album',artist:'Example Artist',year:2000,source:'discogs',releaseId:42},{title:'Local album',artist:'Example Artist',year:2001}];renderWantlist()");
  const html = h.node('#wantlistGrid').innerHTML;
  assert.match(html, /Find editions/);
  assert.doesNotMatch(html, /Find listings/);
  assert.doesNotMatch(html, /class="eyebrow">WANTLIST/);
  assert.match(html, /https:\/\/www\.discogs\.com\/release\/42/);
  assert.equal((html.match(/class="wantlist-shop"/g) || []).length, 1);
});

test('Discogs collection and wantlist honor independent bounded page sizes', () => {
  const pages = [];
  const h = harness(undefined, { renderPagination: (id, page, total, size) => pages.push({ id, page, total, size }), cover: () => '<div class="cover"></div>' });
  h.load('formatTagsFor', 'renderCollection', 'renderWantlist');
  h.run(`let collectionFilter='all',collectionSort='recent',wantlistSort='recent';
    collection=Array.from({length:55},(_,index)=>({title:'Release '+index,artist:'Synthetic',year:2020,source:'discogs'}));
    wantlist=Array.from({length:55},(_,index)=>({title:'Wish '+index,artist:'Synthetic',year:2020,source:'discogs'}));
    collectionPageSize=12;wantlistPageSize=48;renderCollection();renderWantlist()`);
  assert.equal((h.node('#collectionGrid').innerHTML.match(/class="collection-card"/g) || []).length, 12);
  assert.equal((h.node('#wantlistGrid').innerHTML.match(/class="want-card"/g) || []).length, 48);
  assert.deepEqual(pages.map(item => item.size), [12, 48]);
  h.run('collectionPage=5;collectionPageSize=48;renderCollection()');
  assert.equal(pages.at(-1).page, 2);
  assert.equal((h.node('#collectionGrid').innerHTML.match(/class="collection-card"/g) || []).length, 7);
  assert.match(markup, /id="collectionPageSize"[^>]*><option value="12">12<\/option><option value="24">24<\/option><option value="48">48<\/option>/);
  assert.match(markup, /id="wantlistPageSize"[^>]*><option value="12">12<\/option><option value="24">24<\/option><option value="48">48<\/option>/);
});

test('collection offers an in-app Spotify search without an external window', () => {
  const h = harness();
  h.load('escapeHtml', 'formatTagsFor', 'renderCollection');
  h.context.cover = () => '<div class="cover"></div>';
  h.run(`let collectionFilter='all',collectionSort='recent';collection=[
    {title:'Blue & Gold "Special"',artist:'Example Artist',year:2020,source:'discogs'},
    {title:'Untitled release',artist:'Unknown artist',year:2021,source:'discogs'}
  ];renderCollection()`);
  const html = h.node('#collectionGrid').innerHTML;
  assert.equal((html.match(/class="collection-spotify"/g) || []).length, 1);
  assert.match(html, /data-title="Blue &amp; Gold &quot;Special&quot;" data-artist="Example Artist"/);
  assert.match(html, /Find in Spotify →/);
  assert.doesNotMatch(html, /DISCOGS COLLECTION/);
  assert.doesNotMatch(html, /open\.spotify\.com|target="_blank"/);
  h.run(`collection=[{title:'"><img src=x onerror=1>',artist:'Example Artist',year:2020,source:'discogs'}];renderCollection()`);
  assert.doesNotMatch(h.node('#collectionGrid').innerHTML, /<img src=x onerror=1>/);
  h.run(`collection=[{title:'${'A'.repeat(220)}',artist:'Example Artist',year:2020,source:'discogs'}];renderCollection()`);
  assert.match(h.node('#collectionGrid').innerHTML, /data-title="A{220}"/);
});

test('successful Spotify sync settles to a timestamp while stale and error notices remain visible', () => {
  let finish;
  const h = harness(undefined, { setTimeout(callback) { finish = callback; return 1; } });
  h.node('#spotifyPlaylistSelect').value = '';
  h.run("settleSpotifyLibraryNotice('cached',1700000000000,'Updated recently')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  assert.equal(h.node('#spotifyCacheMeta').hidden, true);
  finish();
  assert.equal(h.node('#spotifyScopeNotice').hidden, true);
  assert.equal(h.node('#spotifyCacheMeta').hidden, false);
  assert.match(h.node('#spotifyCacheMeta').textContent, /^Updated /);
  assert.doesNotMatch(h.node('#spotifyCacheMeta').textContent, /Live sync|Cached copy/);
  h.run("settleSpotifyLibraryNotice('live',1700000000000,'Updated recently')");
  h.run('spotifyAccountGeneration++');
  finish();
  assert.equal(h.node('#spotifyScopeNotice').hidden, false, 'an old account cannot collapse a new notice');
  h.run("showSpotifyLibraryNotice('Spotify unavailable')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  assert.equal(h.node('#spotifyCacheMeta').hidden, true);
  h.run("settleSpotifyLibraryNotice('stale-cache',1700000000000,'Previously loaded data · Spotify unavailable')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  assert.equal(h.node('#spotifyCacheMeta').hidden, true);
});

test('artist buttons escape provider text and keep missing or unknown artists noninteractive', () => {
  const h=harness();h.load('escapeHtml','artistSearchButton');
  const html=h.run(`artistSearchButton('A & B "<script>','spotify')`);
  assert.match(html,/data-provider="spotify"/);
  assert.match(html,/A &amp; B &quot;&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.equal(h.run("artistSearchButton('','spotify')"),'');
  assert.equal(h.run("artistSearchButton('Unknown artist','discogs')"),'Unknown artist');
  assert.doesNotMatch(h.run("artistSearchButton('Example','untrusted')"),/<button/);
});

test('Spotify artist action selects catalog scope, clears album lookup and searches once', () => {
  const calls=[];const h=harness(undefined,{searchSpotifyCatalog:query=>calls.push(query),updateSearchContext(){},setSpotifySearchScope:value=>{calls.push(value);h.run(`spotifySearchMode='${value}'`);}});
  let navigations=0;h.node('.sidebar nav a[data-view="spotify"]').click=()=>{navigations++;h.run("spotifySearchMode='library'");};
  h.load('searchForArtist');h.run("collectionSpotifyLookup={title:'Old album'};spotifyCatalogAlbumView={};searchForArtist('  Example Artist (2)  ','spotify')");
  assert.equal(navigations,1);assert.deepEqual(calls,['catalog','Example Artist']);
  assert.equal(h.node('#searchInput').value,'Example Artist');
  assert.equal(h.run('spotifySearchMode'),'catalog','artist action wins over navigation scope restoration');
  assert.equal(h.run('collectionSpotifyLookup'),null);assert.equal(h.run('spotifyCatalogAlbumView'),null);
  h.run("spotifyConnected=false;searchForArtist('Other','spotify');searchForArtist('','spotify');searchForArtist('Other','invalid')");
  assert.deepEqual(calls,['catalog','Example Artist']);
});

test('Discogs artist action clears unrelated filters and uses artist-only catalog search', () => {
  const calls=[];let syncs=0;
  const h=harness(undefined,{searchInDiscogs:(query,artist)=>calls.push([query,artist]),syncDiscogsThemedSelects(){syncs++;}});
  h.load('searchForArtist');
  for(const name of ['Format','Condition','Country','Genre','Year'])h.node('#discogs'+name).value='Old filter';
  h.run("searchForArtist('Artist & Friends (3)','discogs')");
  assert.deepEqual(calls,[['','Artist & Friends']]);assert.equal(syncs,1);
  for(const name of ['Format','Condition','Country','Genre','Year'])assert.equal(h.node('#discogs'+name).value,'');
});

test('collection Spotify search navigates to Listening and uses the existing catalog search', () => {
  const h = harness();
  const searches = [];
  let homeClicks = 0;
  let selectedScope = '';
  h.run("let activeSearchView='discogs'");
  h.node('.sidebar nav a[data-view="home"]').click = () => {
    homeClicks++;
    h.node('.active-view').id = 'home';
    h.run("activeSearchView='spotify'");
  };
  h.context.setSpotifySearchScope = value => {
    selectedScope = value;
    h.run(`spotifySearchMode='${value}'`);
  };
  h.context.searchSpotifyCatalog = query => searches.push(query);
  h.load('filterCards', 'searchInSpotify');
  h.run("searchInSpotify('Blue & Gold','Example Artist')");
  assert.equal(homeClicks, 1);
  assert.equal(h.node('#searchInput').value, 'Blue & Gold Example Artist');
  assert.equal(selectedScope, 'catalog');
  assert.deepEqual(searches, ['blue & gold example artist']);
  assert.equal(h.run('collectionSpotifyLookup.title'), 'Blue & Gold');
});

test('recommendation artwork opens the exact album without a duplicate View tracks action', () => {
  const id = 'A'.repeat(22);
  const h = harness(undefined, { cover: () => '<div class="cover"></div>', shelfMatch: () => ({}), shelfBadges: () => '' });
  h.load('spotifyAlbumCard');
  h.context.recommendation = { title: 'Example Album', artist: 'Example Artist', uri: `spotify:album:${id}`, viewAlbum: true };
  const card = h.run('spotifyAlbumCard(recommendation)');
  assert.match(card, /class="home-album-open home-album-cover"/);
  assert.doesNotMatch(card, /home-album-link|>View tracks/);
  assert.match(card, /aria-label="Play Example Album"/);
  assert.doesNotMatch(h.run("spotifyAlbumCard({...recommendation,viewAlbum:false})"), /home-album-open/);
  assert.doesNotMatch(h.run("spotifyAlbumCard({...recommendation,uri:'spotify:album:bad'})"), /home-album-open/);
});

test('opening a recommended album reuses its Spotify ID and returns to recommendations', () => {
  const id = 'B'.repeat(22);
  const requests = [];
  const loaded = [];
  const h = harness(async url => { requests.push(url); return { ok: true, json: async () => ({}) }; });
  h.node('.active-view').id = 'home';
  h.node('#homeDiscoveryTitle').scrollIntoView = () => {};
  h.context.setSpotifySearchScope = value => { h.run(`spotifySearchMode='${value}'`); };
  h.context.loadSpotifyAlbumTracks = albumId => { loaded.push(albumId); return Promise.resolve(); };
  h.load('renderHomeRecommendations', 'spotifySearchCard', 'spotifyCollectionResultCard', 'searchSpotifyCatalog', 'filterCards', 'openHomeSpotifyAlbum', 'returnToHomeRecommendations');
  h.run("activeSearchView='spotify'");
  h.context.recommendation = { title: 'Example Album', artist: 'Example Artist', uri: `spotify:album:${id}`, image: '' };
  h.run('spotifyHomeRecommendations=[recommendation]');
  h.node('#homeSpotifySortField').hidden = false;
  h.run(`openHomeSpotifyAlbum('${id}')`);
  assert.equal(h.run('collectionSpotifyLookup.item.id'), id);
  assert.equal(h.node('#homeSpotifySortField').hidden, true, 'album tracks have no result sorting control');
  assert.match(h.node('#recommendations').innerHTML, /Back to recommendations[\s\S]*spotify-lookup-row/);
  assert.deepEqual(loaded, [id]);
  assert.deepEqual(requests, [], 'opening a known album does not make a catalog search request');
  h.run('returnToHomeRecommendations()');
  assert.equal(h.node('#searchInput').value, '');
  assert.equal(h.run('collectionSpotifyLookup'), null);
  assert.match(h.node('#recommendations').innerHTML, /Example Album/);
  assert.equal(h.node('#homeTopToggle').hidden, false);
  h.run("openHomeSpotifyAlbum('invalid')");
  assert.deepEqual(loaded, [id], 'invalid album IDs cannot load tracks');
});

test('Saved Music catalog results use clickable titles rather than separate Go to album actions', async () => {
  let runSearch;
  const albumId = 'C'.repeat(22);
  const trackAlbumId = 'D'.repeat(22);
  const h = harness(async () => ({ ok: true, json: async () => ({
    albums: { total: 1, items: [{ type: 'album', id: albumId, name: 'Synthetic Album', artists: [{ name: 'Example Artist' }] }] },
    tracks: { total: 2, items: [
      { type: 'track', name: 'Synthetic Song', album: { id: trackAlbumId, name: 'Track Album', artists: [{ name: 'Example Artist' }] } },
      { type: 'track', name: 'Unavailable Album', album: { id: 'invalid', name: 'Unknown Album' } }
    ] },
    artists: { total: 1, items: [{ type: 'artist', name: 'Example Artist' }] },
    playlists: { total: 1, items: [{ type: 'playlist', name: 'Example Playlist' }] }
  }) }), { setTimeout(callback) { runSearch = callback; return 1; }, cover: () => '<div class="cover"></div>', shelfMatch: () => ({}), shelfBadges: () => '' });
  h.node('.active-view').id = 'spotify';
  h.load('spotifyAlbumCard', 'spotifySearchCard', 'searchSpotifyCatalog');
  h.run("spotifySearchMode='catalog'");
  const pending = h.run("searchSpotifyCatalog('synthetic')");
  await runSearch(); await pending;
  const html = h.node('#spotifyGrid').innerHTML;
  assert.doesNotMatch(html,/home-album-link|>Go to album/);
  assert.match(html,new RegExp(`<strong title="Track Album"><button type="button" class="spotify-catalog-album-open spotify-album-title" data-album-id="${trackAlbumId}">Track Album</button></strong>`));
  assert.match(html,new RegExp(`<h3><button type="button" class="spotify-catalog-album-open spotify-album-title" data-album-id="${albumId}">Synthetic Album</button></h3>`));
  assert.match(html, new RegExp(`data-album-id="${albumId}"`));
  assert.match(html, new RegExp(`data-album-id="${trackAlbumId}"`));
  assert.doesNotMatch(html, /data-album-id="invalid"/);
  assert.equal(h.run('spotifyCatalogResults.length'), 5);
});

test('catalog Go to album opens the exact track list and Back restores results without another search', () => {
  const albumId = 'E'.repeat(22);
  const loaded = [];
  const h = harness(undefined, { cover: () => '<div class="cover"></div>', shelfMatch: () => ({}), shelfBadges: () => '' });
  h.node('.active-view').id = 'spotify';
  h.context.loadSpotifyAlbumTracks = (id, offset, sequence) => { loaded.push([id, offset, sequence]); return Promise.resolve(); };
  h.load('spotifyAlbumCard', 'spotifySearchCard', 'spotifyCollectionResultCard', 'openSpotifyCatalogAlbum', 'returnToSpotifyCatalogResults');
  h.run(`spotifySearchMode='catalog';spotifyCatalogPage=3;spotifyCatalogResults=[{type:'track',name:'Song',album:{id:'${albumId}',name:'Exact Album',artists:[{name:'Artist'}]}}]`);
  h.node('#spotifyGrid').innerHTML = '<article>Existing results</article>';
  h.node('#spotifyPagination').innerHTML = '<button>Page 3</button>';
  h.node('#spotifyLibraryStatus').textContent = '20 Spotify results';
  h.node('#spotifyCatalogNote').textContent = 'Results are from the full Spotify catalog.';
  h.node('#searchInput').value = 'original query';
  h.run(`openSpotifyCatalogAlbum('${albumId}')`);
  assert.match(h.node('#spotifyGrid').innerHTML, /Back to results[\s\S]*Exact Album[\s\S]*<h4>Tracks<\/h4>/);
  assert.equal(h.node('#spotify .library-controls').hidden, true);
  assert.equal(h.node('#spotifyPagination').innerHTML, '');
  assert.deepEqual(loaded, [[albumId, 0, 1]]);
  h.run('returnToSpotifyCatalogResults()');
  assert.equal(h.node('#spotifyGrid').innerHTML, '<article>Existing results</article>');
  assert.equal(h.node('#spotifyPagination').innerHTML, '<button>Page 3</button>');
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '20 Spotify results');
  assert.equal(h.node('#spotifyCatalogNote').textContent, 'Results are from the full Spotify catalog.');
  assert.equal(h.node('#searchInput').value, 'original query');
  assert.equal(h.node('#spotify .library-controls').hidden, false);
  assert.equal(h.run('spotifyCatalogPage'), 3);
  assert.equal(h.run('spotifySearchSequence'), 2, 'Back invalidates the in-flight album track request');
  h.run("openSpotifyCatalogAlbum('invalid')");
  assert.equal(loaded.length, 1, 'invalid album IDs never load tracks');
});

test('switching from a catalog album to Saved library clears the album layout', () => {
  const h = harness();
  const options = ['library', 'catalog'].map((value, index) => ({ dataset: { value }, textContent: index ? 'Entire Spotify catalog' : 'Saved library', setAttribute() {} }));
  h.context.document.querySelectorAll = selector => selector === '#spotifySearchScopeList [role="option"]' ? options : [];
  const classes = new Set(['collection-lookup-results']);
  h.node('#spotifyGrid').classList = { remove(name) { classes.delete(name); } };
  h.node('#spotify .library-controls').hidden = true;
  h.load('setSpotifySearchScope');
  h.run("spotifySearchMode='catalog';spotifyCatalogAlbumView={markup:'Old album'};spotifyCatalogResults=[{name:'Old result'}];setSpotifySearchScope('library')");
  assert.equal(classes.has('collection-lookup-results'), false);
  assert.equal(h.node('#spotify .library-controls').hidden, false);
  assert.equal(h.run('spotifyCatalogAlbumView'), null);
  assert.equal(h.run('spotifyCatalogResults.length'), 0);
});

test('returning to Listening removes album lookup layout and stale search controls', () => {
  const h = harness();
  const classes = new Set(['collection-lookup-results', 'list-view']);
  h.node('#recommendations').classList = { remove(...names) { names.forEach(name => classes.delete(name)); } };
  h.node('.active-view').id = 'home';
  h.node('#homeSpotifySearchStatus').textContent = '1 possible album match on this page';
  h.node('#homeSpotifySortField').hidden = false;
  h.node('#homeTopToggle').hidden = true;
  h.load('renderHomeRecommendations');
  h.run("spotifyHomeRecommendations=[{title:'Recent album',artist:'Example Artist'}];renderHomeRecommendations()");
  assert.match(h.node('#recommendations').innerHTML, /Recent album/);
  assert.equal(classes.has('collection-lookup-results'), false);
  assert.equal(classes.has('list-view'), false);
  assert.equal(h.node('#homeSpotifySearchStatus').hidden, true);
  assert.equal(h.node('#homeSpotifySearchStatus').textContent, '');
  assert.equal(h.node('#homeSpotifySortField').hidden, true);
  assert.equal(h.node('#homeTopToggle').hidden, false);
});

test('leaving an in-app album lookup resets the home grid before returning', () => {
  const h = harness();
  const classes = new Set(['collection-lookup-results']);
  h.node('#recommendations').classList = { remove(...names) { names.forEach(name => classes.delete(name)); } };
  h.node('#searchInput').value = 'Lookup album Example Artist';
  h.node('#homeSpotifySearchStatus').textContent = '1 possible album match on this page';
  h.node('.active-view').id = 'spotify';
  h.load('renderHomeRecommendations');
  const link = { dataset: { view: 'spotify' }, addEventListener(_type, handler) { h.context.leaveLookup = handler; } };
  h.context.document.querySelectorAll = selector => selector === '[data-view]' ? [link] : [];
  h.node('#searchInput').addEventListener = () => {};
  vm.runInContext("let lastSearchContext='spotify';" + source.split('\n').find(line => line.startsWith("document.querySelectorAll('[data-view]').forEach")), h.context);
  h.run("collectionSpotifyLookup={title:'Lookup album',artist:'Example Artist',query:'Lookup album Example Artist'};spotifyHomeRecommendations=[{title:'Recent album',artist:'Example Artist'}];spotifySearchSequence=7;leaveLookup()");
  assert.equal(h.node('#searchInput').value, '');
  assert.equal(h.run('collectionSpotifyLookup'), null);
  assert.equal(h.run('spotifySearchSequence'), 8);
  assert.equal(classes.has('collection-lookup-results'), false);
  assert.match(h.node('#recommendations').innerHTML, /Recent album/);
  assert.equal(h.node('#homeSpotifySearchStatus').hidden, true);
});

test('brand returns to a fresh first page of listening without repeating a catalog request', () => {
  const h = harness(() => { throw new Error('Unexpected provider request'); });
  const listeners = [];
  h.context.document.addEventListener = (type, listener) => { if (type === 'click') listeners.push(listener); };
  h.node('.active-view').id = 'home'; // The earlier navigation listener has switched views.
  h.node('#searchInput').value = 'Old search';
  h.node('#recommendations').innerHTML = '<article>Old search result</article>';
  h.run("spotifyCanReadTop=true;homeDiscoveryMode='top';homeRecommendationPage=3;spotifySearchSequence=4;collectionSpotifyLookup={title:'Old search',artist:'Example Artist',query:'Old search'};spotifyHomeRecommendations=[{title:'Fresh recommendation',artist:'Example Artist'}]");
  h.load('renderHomeRecommendations', 'searchSpotifyCatalog');
  const navigation = source.split('\n').find(line => line.startsWith("document.addEventListener('click',e=>{if(e.target.closest('.brand'))"));
  assert.ok(navigation);
  assert.ok(source.indexOf("document.addEventListener('click',e=>{const nav=e.target.closest('[data-view]')") < source.indexOf(navigation));
  vm.runInContext(navigation, h.context);
  listeners[0]({ target: { closest: () => null } });
  assert.equal(h.node('#searchInput').value, 'Old search', 'ordinary navigation does not use the logo reset');
  listeners[0]({ target: { closest: selector => selector === '.brand' ? {} : null } });
  assert.equal(h.node('#searchInput').value, '');
  assert.equal(h.run('collectionSpotifyLookup'), null);
  assert.equal(h.run('homeDiscoveryMode'), 'recent');
  assert.equal(h.run('homeRecommendationPage'), 1);
  assert.equal(h.run('spotifySearchSequence'), 5, 'old catalog responses are invalidated');
  assert.equal(h.node('#homeDiscoveryTitle').textContent, 'For your ears');
  assert.equal(h.node('#homeTopToggle').textContent, 'Long-term favorites');
  assert.match(h.node('#recommendations').innerHTML, /Fresh recommendation/);
  assert.doesNotMatch(h.node('#recommendations').innerHTML, /Old search result/);
});

test('collection lookup shows only close Spotify album matches and leaves ordinary search broad', async () => {
  let runSearch;
  const requests = [];
  const trackLoads = [];
  const albumId = 'A'.repeat(22);
  const h = harness(async url => {
    requests.push(url);
    const terms = new URL(url, 'http://127.0.0.1').searchParams.get('q');
    if (terms === 'album:The Used artist:The Used') return { ok: true, json: async () => ({ albums: { total: 0, items: [] } }) };
    if (terms === 'album:The Used') return { ok: true, json: async () => ({ albums: { total: 1, items: [{ id: albumId, type: 'album', name: 'The Used', artists: [{ name: 'The Used' }] }] } }) };
    return { ok: true, json: async () => ({
      albums: { total: 20, items: [
        { id: albumId, type: 'album', name: 'Blue & Gold', artists: [{ name: 'Example Artist' }] },
        { type: 'album', name: 'Blue & Gold', artists: [{ name: 'Example Artist' }] },
        { type: 'album', name: 'Blue & Gold', artists: [{ name: 'Different Artist' }] },
        { type: 'album', name: 'Blue Horizon', artists: [{ name: 'Example Artist' }] }
      ] }, tracks: { total: 1, items: [{ type: 'track', name: 'Blue & Gold' }] }
    }) };
  }, { setTimeout(callback) { runSearch = callback; return 1; } });
  h.node('.active-view').id = 'home';
  h.context.loadSpotifyAlbumTracks = id => { trackLoads.push(id); return Promise.resolve(); };
  h.load('spotifyAlbumLookupKey', 'matchesCollectionSpotifyAlbum', 'uniqueCollectionSpotifyAlbums', 'spotifySearchCard', 'spotifyCollectionResultCard', 'searchSpotifyCatalog');
  h.node('#recommendations').innerHTML = '<article>Previous recommendation cover</article>';
  h.run("collectionSpotifyLookup={title:'Blue & Gold',artist:'Example Artist',query:'Blue & Gold Example Artist'}");
  const pending = h.run("searchSpotifyCatalog('blue & gold example artist')");
  assert.match(h.node('#recommendations').innerHTML, /Finding Spotify album/);
  assert.doesNotMatch(h.node('#recommendations').innerHTML, /Previous recommendation cover/);
  assert.equal(requests.length, 0, 'clearing the stale cover does not start an extra request');
  await runSearch(); await pending;
  assert.match(requests[0], /type=album/);
  assert.match(decodeURIComponent(requests[0]), /album:Blue & Gold artist:Example Artist/);
  assert.match(h.node('#recommendations').innerHTML, /class="spotify-lookup-row"/);
  assert.match(h.node('#recommendations').innerHTML, /<article>Blue & Gold<\/article>[\s\S]*<h4>Tracks<\/h4>/);
  assert.deepEqual(trackLoads, [albumId], 'only the deduplicated visible album loads tracks');
  assert.match(h.node('#homeSpotifySearchStatus').textContent, /1 possible album match/);
  assert.equal(h.node('#homeSpotifySortField').hidden, true, 'album lookup results do not offer an ineffective sort');
  h.run("collectionSpotifyLookup={title:'Missing Album',artist:'Example Artist',query:'Missing Album Example Artist'}");
  const unmatched = h.run("searchSpotifyCatalog('missing album example artist')");
  await runSearch(); await unmatched;
  assert.match(h.node('#recommendations').innerHTML, /No close album matches on this page/);
  assert.match(h.node('#homeSpotifySearchStatus').textContent, /0 possible album matches/);
  h.run("collectionSpotifyLookup={title:'The Used',artist:'The Used',query:'The Used The Used'}");
  const selfTitled = h.run("searchSpotifyCatalog('the used the used')");
  await runSearch(); await selfTitled;
  assert.match(h.node('#recommendations').innerHTML, /<article>The Used<\/article>[\s\S]*<h4>Tracks<\/h4>/);
  assert.equal(requests.filter(url => new URL(url, 'http://127.0.0.1').searchParams.get('q') === 'album:The Used').length, 1);
  h.run("collectionSpotifyLookup=null");
  const ordinary = h.run("searchSpotifyCatalog('blue & gold example artist')");
  await runSearch(); await ordinary;
  assert.doesNotMatch(requests.at(-1), /type=album/);
  assert.match(h.node('#recommendations').innerHTML, /Blue Horizon/);
  assert.equal(h.node('#homeSpotifySortField').hidden, false, 'ordinary catalog results retain sorting');
});

test('a matched album shows selectable tracks beside it without an extra click', async () => {
  const id = 'A'.repeat(22);
  const requests = [];
  const h = harness(async url => {
    requests.push(url);
    const offset = Number(new URL(url, 'http://127.0.0.1').searchParams.get('offset'));
    return { ok: true, json: async () => ({ total: 51, items: [{ uri: `spotify:track:synthetic${offset}`, name: offset ? 'Last track' : '<First track>', track_number: offset + 1, duration_ms: 125000 }] }) };
  }, { cover: () => '<div></div>', shelfMatch: () => ({}), shelfBadges: () => '' });
  h.context.loadSpotifyAlbumLikedStatus = () => {};
  h.load('escapeHtml', 'formatTime', 'spotifyAlbumCard', 'spotifySearchCard', 'spotifyCollectionResultCard', 'loadSpotifyAlbumTracks');
  const album = { id, type: 'album', name: 'Synthetic album', artists: [{ name: 'Example Artist' }], uri: `spotify:album:${id}` };
  h.context.albumFixture = album;
  assert.match(h.run('spotifyCollectionResultCard(albumFixture)'), /<h4>Tracks<\/h4>/);
  assert.match(h.run('spotifyCollectionResultCard(albumFixture)'), /Loading tracks…/);
  assert.doesNotMatch(h.run('spotifyCollectionResultCard(albumFixture)'), /Spotify catalog|Spotify album/);
  assert.doesNotMatch(h.run("spotifyCollectionResultCard({...albumFixture,id:'bad'})"), /Loading tracks…/);
  assert.doesNotMatch(h.run("spotifySearchCard(albumFixture,'album')"), /spotify-lookup-tracks/);
  assert.equal(requests.length, 0, 'rendering the album does not fetch tracks');
  const panel = h.node(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);
  const list = h.node('#syntheticTrackList');
  const more = h.node('#syntheticTrackMore');
  const error = h.node('#syntheticTrackError');
  panel.querySelector = selector => ({ '.spotify-lookup-track-list': list, '.spotify-lookup-more': more, '.spotify-lookup-track-error': error })[selector];
  list.insertAdjacentHTML = (_position, html) => { list.innerHTML += html; };
  h.run('spotifySearchSequence=1');
  await h.run(`loadSpotifyAlbumTracks('${id}',0,spotifySearchSequence)`);
  assert.equal(requests[0], `/api/spotify/albums/${id}/tracks?offset=0`);
  assert.match(list.innerHTML, /&lt;First track&gt;/);
  assert.match(list.innerHTML, /class="spotify-album-track-state"/);
  assert.match(list.innerHTML, new RegExp(`data-context-uri="spotify:album:${id}"`));
  assert.match(list.innerHTML, /data-uri="spotify:track:synthetic0"/);
  assert.match(list.innerHTML, /class="spotify-track-liked"[^>]*aria-label="Checking Liked Songs"[^>]*>…<\/button>/);
  assert.equal(more.hidden, false);
  await h.run(`loadSpotifyAlbumTracks('${id}',50,spotifySearchSequence)`);
  assert.match(list.innerHTML, /Last track/);
  assert.equal(more.hidden, true);
  assert.equal(requests.length, 2);
  await h.run("loadSpotifyAlbumTracks('invalid',0,spotifySearchSequence)");
  assert.equal(requests.length, 2);
  assert.doesNotMatch(markup, /id="spotifyAlbumTracksDialog"/);
});

test('album rows follow the current Spotify track and pause state', () => {
  const h = harness();
  const row = uri => {
    const classes = new Set();
    const attributes = {};
    const state = { textContent: '' };
    return { classes, attributes, state,
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
      setAttribute(name, value) { attributes[name] = value; }, removeAttribute(name) { delete attributes[name]; },
      querySelector(selector) { return selector === '.spotify-play-result' ? { dataset: { uri } } : state; }
    };
  };
  const first = row('spotify:track:syntheticfirst');
  const second = row('spotify:track:syntheticsecond');
  h.context.document.querySelectorAll = selector => selector === '.collection-lookup-results .spotify-album-track' ? [first, second] : [];
  h.load('renderPlayer');
  h.run("spotifyTrackUri='spotify:track:syntheticfirst';playing=true;renderPlayer()");
  assert.equal(first.state.textContent, 'Now playing');
  assert.equal(first.attributes['aria-current'], 'true');
  assert.equal(first.classes.has('is-current'), true);
  assert.equal(second.state.textContent, '');
  h.run('playing=false;renderPlayer()');
  assert.equal(first.state.textContent, 'Paused');
  h.run("setCurrentSpotifyTrackUri('spotify:track:syntheticsecond')");
  assert.equal(first.state.textContent, '');
  assert.equal(first.attributes['aria-current'], undefined);
  assert.equal(second.state.textContent, 'Paused');
  h.run('setCurrentSpotifyTrackUri(null)');
  assert.equal(second.state.textContent, '');
});

test('collection match artwork stays large while its track list scrolls within the row', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'distinction.css'), 'utf8');
  assert.match(css, /\.spotify-lookup-row \.album-card\{[^}]*max-width:400px/);
  assert.match(css, /\.spotify-lookup-row \.cover\{width:100%;aspect-ratio:1\}/);
  assert.match(css, /\.spotify-lookup-row \.album-meta\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /\.spotify-lookup-row \.album-meta \.spotify-play-result\{[^}]*grid-column:2;grid-row:1/);
  assert.match(css, /\.spotify-lookup-row \.album-meta \.spotify-discogs\{[^}]*grid-column:2;grid-row:2/);
  assert.match(css, /\.spotify-lookup-track-list\{[^}]*max-height:420px;overflow-y:auto/);
  assert.match(css, /\.spotify-lookup-tracks\{min-width:0;padding-top:20px\}/);
  assert.match(css, /@media\(max-width:1100px\)\{\.spotify-lookup-row\{[^}]*\}\.spotify-lookup-tracks\{padding-top:0\}/);
  assert.match(css, /\.spotify-lookup-row\{[^}]*grid-template-columns:minmax\(280px,400px\) minmax\(0,1fr\)/);
  assert.match(css, /\.spotify-album-track \.spotify-track-liked\{[^}]*border:0;background:transparent/);
  assert.match(css, /\.spotify-album-track \.spotify-track-liked\[data-liked-state="saved"\]\{color:var\(--lime\)\}/);
  assert.match(css, /\.spotify-album-track\{[^}]*grid-template-columns:30px minmax\(0,1fr\) 42px 32px 50px/);
  assert.match(css, /\.spotify-album-track\.is-current\{[^}]*border-left:2px solid var\(--lime\)/);
});

function homeRefreshHarness(fetch) {
  const toasts=[];
  const h=harness(fetch,{showToast:message=>toasts.push(message),renderHomeRecommendations(){}});
  h.load('refreshSpotifyTopAlbums','runManualRefresh');
  h.run("spotifyCanReadTop=true;homeDiscoveryMode='top'");
  h.node('#searchInput').value='';
  const button=h.node('#homeRefresh');
  let click;
  button.addEventListener=(event,handler)=>{assert.equal(event,'click');click=()=>handler({currentTarget:button});};
  const start=source.indexOf("document.querySelector('#homeRefresh').addEventListener");
  const end=source.indexOf("document.querySelector('#spotifyLibraryRefresh').addEventListener",start);
  assert.ok(start>=0&&end>start);
  h.run(source.slice(start,end));
  return {...h,toasts,button,click:()=>click()};
}

test('explicit long-term data refresh forces fresh data, shows progress, and confirms unchanged albums', async () => {
  const pending=deferred();const requests=[];
  let next=Promise.resolve({ok:true,json:async()=>({tracks:[{album:{id:'A'.repeat(22),name:'Synthetic favorite',artists:[{name:'Example Artist'}],uri:`spotify:album:${'A'.repeat(22)}`,release_date:'2020'}}]})});
  const h=homeRefreshHarness((url,options)=>{requests.push({url,options});return next;});
  await h.run("runManualRefresh(document.querySelector('#homeRefresh'),()=>refreshSpotifyTopAlbums(true))");
  assert.equal(requests[0].url,'/api/spotify/top-albums');
  assert.equal(requests[0].options.method,'POST');
  assert.equal(requests[0].options.headers['X-RCRD-Request'],'1');
  assert.equal(h.toasts.at(-1),'Long-term favorites refreshed.');
  const original=h.run('JSON.stringify(spotifyTopAlbums)');
  const same=JSON.parse(JSON.stringify({tracks:[{album:{id:'A'.repeat(22),name:'Synthetic favorite',artists:[{name:'Example Artist'}],uri:`spotify:album:${'A'.repeat(22)}`,release_date:'2020'}}]}));
  next=pending.promise;
  const refresh=h.run("runManualRefresh(document.querySelector('#homeRefresh'),()=>refreshSpotifyTopAlbums(true))");
  assert.equal(h.button.disabled,true);
  assert.equal(h.button.attributes['aria-busy'],'true');
  await h.run("runManualRefresh(document.querySelector('#homeRefresh'),()=>refreshSpotifyTopAlbums(true))");
  assert.equal(requests.length,2,'busy clicks do not create extra requests');
  pending.resolve({ok:true,json:async()=>same});
  await refresh;
  assert.equal(h.button.disabled,false);
  assert.equal(h.button.attributes['aria-busy'],'false');
  assert.equal(h.run('JSON.stringify(spotifyTopAlbums)'),original);
  assert.equal(h.toasts.at(-1),'Long-term favorites refreshed. Spotify returned the same albums.');
});

test('failed long-term refresh retains existing albums and reports failure rather than success', async () => {
  const h=homeRefreshHarness(async()=>({ok:false,json:async()=>({error:'Synthetic refresh unavailable'})}));
  h.run("spotifyTopAlbums=[{title:'Keep existing favorite'}]");
  await h.run("runManualRefresh(document.querySelector('#homeRefresh'),()=>refreshSpotifyTopAlbums(true))");
  assert.equal(h.run('spotifyTopAlbums[0].title'),'Keep existing favorite');
  assert.deepEqual(h.toasts,['Synthetic refresh unavailable']);
  assert.equal(h.button.disabled,false);
  assert.equal(h.button.attributes['aria-busy'],'false');
});

test('long-term refresh ignores a stale account response and explains missing permission', async () => {
  const pending=deferred();let calls=0;
  const h=homeRefreshHarness(()=>{calls++;return pending.promise;});
  const refresh=h.run("runManualRefresh(document.querySelector('#homeRefresh'),()=>refreshSpotifyTopAlbums(true))");
  h.run('++spotifyAccountGeneration;spotifyConnected=false');
  pending.resolve({ok:true,json:async()=>({tracks:[]})});
  await refresh;
  assert.deepEqual(h.toasts,[]);
  h.run('spotifyConnected=true;spotifyCanReadTop=false');
  await h.run("runManualRefresh(document.querySelector('#homeRefresh'),()=>refreshSpotifyTopAlbums(true))");
  assert.deepEqual(h.toasts,['Enable long-term favorites before refreshing.']);
  assert.equal(calls,1);
});

test('long-term favorites has no refresh action while pagination and recent refresh remain available', async () => {
  let calls=0;
  const h=homeRefreshHarness(()=>{calls++;throw new Error('No favorites refresh expected');});
  h.context.shelfMatchKey=(title,artist)=>`${title}|${artist}`;
  h.context.shelfMatch=()=>({collection:''});
  h.load('renderHomeRecommendations','renderPagination');
  for(const count of [0,4,18]){
    h.context.favoriteCount=count;
    h.run("spotifyTopAlbums=Array.from({length:favoriteCount},(_,index)=>({title:'Favorite '+index,artist:'Example Artist'}));homeRecommendationPage=1;renderHomeRecommendations()");
    assert.equal(h.button.hidden,true);
    await h.click();
    assert.equal(h.run('homeRecommendationPage'),1);
  }
  assert.equal(calls,0);
  assert.match(h.node('#homeSpotifyPagination').innerHTML,/home-recommendations/);
  h.run('homeRecommendationPage=2;renderHomeRecommendations()');
  assert.match(h.node('#recommendations').innerHTML,/Favorite 8/);
  assert.equal(h.button.hidden,true);
  h.run("homeDiscoveryMode='recent';renderHomeRecommendations()");
  assert.equal(h.button.hidden,false);
  assert.equal(h.button.attributes['aria-label'],'Refresh listening recommendations');
});

test('album tracks check Liked Songs in one batch and save only after provider confirmation', async () => {
  const id = 'L'.repeat(22);
  const uris = ['spotify:track:syntheticA', 'spotify:track:syntheticB'];
  const requests = [];
  const pending = deferred();
  const h = harness((url, options) => {
    requests.push({ url, options });
    return options?.method === 'PUT' ? pending.promise : Promise.resolve({ ok: true, json: async () => ({ saved: [true, false] }) });
  });
  h.load('renderAlbumTrackLiked', 'loadSpotifyAlbumLikedStatus', 'saveSpotifyAlbumTrack');
  h.run('spotifyCanModifyLibrary=true;spotifySearchSequence=1');
  const panel = h.node(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);
  panel.dataset.albumId = id;
  const buttons = uris.map(uri => ({ dataset: { uri, likedState: 'checking' }, disabled: true, setAttribute(name, value) { this[name] = value; } }));
  panel.querySelectorAll = () => buttons;
  h.context.syntheticPanel = panel;
  await h.run('loadSpotifyAlbumLikedStatus(syntheticPanel,spotifySearchSequence,spotifyAccountGeneration)');
  assert.equal(requests.length, 1);
  assert.deepEqual(new URL(requests[0].url, 'http://127.0.0.1').searchParams.get('uris').split(','), uris);
  assert.equal(buttons[0].textContent, '♥');
  assert.equal(buttons[0]['aria-label'], 'In Liked Songs');
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].textContent, '♡');
  assert.equal(buttons[1]['aria-label'], 'Save to Liked Songs');
  assert.equal(buttons[1].disabled, false);
  const save = h.run('saveSpotifyAlbumTrack(syntheticPanel.querySelectorAll()[1])');
  assert.equal(buttons[1].textContent, '…');
  assert.deepEqual(JSON.parse(requests[1].options.body), { uri: uris[1], saved: true });
  pending.resolve({ ok: true, json: async () => ({ ok: true, saved: true }) });
  await save;
  assert.equal(buttons[1].textContent, '♥');
  assert.equal(buttons[1].disabled, true);
  assert.equal(h.run('spotifyLibraryNeedsRefresh'), true);
});

test('album Liked Songs failures stay retryable and stale account checks cannot update rows', async () => {
  const id = 'M'.repeat(22);
  const pending = deferred();
  const h = harness(() => pending.promise);
  h.load('renderAlbumTrackLiked', 'loadSpotifyAlbumLikedStatus');
  h.run('spotifySearchSequence=1');
  const panel = h.node(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);
  panel.dataset.albumId = id;
  const button = { dataset: { uri: 'spotify:track:synthetic', likedState: 'checking' }, disabled: true, setAttribute(name, value) { this[name] = value; } };
  panel.querySelectorAll = () => [button];
  h.context.syntheticPanel = panel;
  const check = h.run('loadSpotifyAlbumLikedStatus(syntheticPanel,spotifySearchSequence,spotifyAccountGeneration)');
  h.run('++spotifyAccountGeneration');
  pending.resolve({ ok: true, json: async () => ({ saved: [true] }) });
  await check;
  assert.equal(button.dataset.likedState, 'checking');
  h.run('renderAlbumTrackLiked(syntheticPanel.querySelectorAll()[0],"error")');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '↻');
  assert.equal(button['aria-label'], 'Retry Liked Songs status');
});

test('a full album track page uses at most two bounded Liked Songs checks', async () => {
  const id = 'N'.repeat(22);
  const requests = [];
  const h = harness(async url => {
    const uris = new URL(url, 'http://127.0.0.1').searchParams.get('uris').split(',');
    requests.push(uris);
    return { ok: true, json: async () => ({ saved: uris.map(() => false) }) };
  });
  h.load('renderAlbumTrackLiked', 'loadSpotifyAlbumLikedStatus');
  h.run('spotifySearchSequence=1;spotifyCanModifyLibrary=true');
  const panel = h.node(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);
  panel.dataset.albumId = id;
  const buttons = Array.from({ length: 50 }, (_, index) => ({ dataset: { uri: `spotify:track:synthetic${index}`, likedState: 'checking' }, disabled: true, setAttribute() {} }));
  panel.querySelectorAll = () => buttons;
  h.context.syntheticPanel = panel;
  await h.run('loadSpotifyAlbumLikedStatus(syntheticPanel,spotifySearchSequence,spotifyAccountGeneration)');
  assert.deepEqual(requests.map(chunk => chunk.length), [40, 10]);
  assert.ok(buttons.every(button => button.dataset.likedState === 'unsaved'));
});

test('a rejected album-track save does not claim the song is in Liked Songs', async () => {
  const h = harness(async () => ({ ok: false, json: async () => ({ error: 'Synthetic save refusal' }) }));
  h.load('renderAlbumTrackLiked', 'saveSpotifyAlbumTrack');
  h.run('spotifyCanModifyLibrary=true;spotifySearchSequence=1');
  const button = { dataset: { uri: 'spotify:track:synthetic', likedState: 'unsaved' }, disabled: false, setAttribute() {} };
  h.context.syntheticButton = button;
  await h.run('saveSpotifyAlbumTrack(syntheticButton)');
  assert.equal(button.dataset.likedState, 'unsaved');
  assert.equal(button.disabled, false);
  assert.equal(h.run('spotifyLibraryNeedsRefresh'), false);
});

test('a new search discards a late album track response', async () => {
  let resolveFetch;
  const h = harness(() => new Promise(resolve => { resolveFetch = resolve; }));
  h.load('escapeHtml', 'formatTime', 'loadSpotifyAlbumTracks');
  const id = 'B'.repeat(22);
  const panel = h.node(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);
  const list = h.node('#syntheticTrackList');
  panel.querySelector = selector => ({ '.spotify-lookup-track-list': list, '.spotify-lookup-more': h.node('#syntheticTrackMore'), '.spotify-lookup-track-error': h.node('#syntheticTrackError') })[selector];
  h.run('spotifySearchSequence=1');
  const pending = h.run(`loadSpotifyAlbumTracks('${id}',0,spotifySearchSequence)`);
  h.run('++spotifySearchSequence');
  resolveFetch({ ok: true, json: async () => ({ total: 1, items: [{ uri: 'spotify:track:synthetic', name: 'Late track' }] }) });
  await pending;
  assert.doesNotMatch(list.innerHTML, /Late track/);
});

test('inline album tracks show a retry after a provider failure', async () => {
  const id = 'C'.repeat(22);
  const h = harness(async () => ({ ok: false, json: async () => ({ error: '<Temporary failure>' }) }));
  h.load('escapeHtml', 'formatTime', 'loadSpotifyAlbumTracks');
  const panel = h.node(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);
  const list = h.node('#syntheticTrackList');
  const more = h.node('#syntheticTrackMore');
  const error = h.node('#syntheticTrackError');
  panel.querySelector = selector => ({ '.spotify-lookup-track-list': list, '.spotify-lookup-more': more, '.spotify-lookup-track-error': error })[selector];
  h.run('spotifySearchSequence=1');
  await h.run(`loadSpotifyAlbumTracks('${id}',0,spotifySearchSequence)`);
  assert.equal(list.innerHTML, '');
  assert.equal(error.textContent, '<Temporary failure>');
  assert.equal(more.textContent, 'Retry tracks');
  assert.equal(more.hidden, false);
  assert.equal(more.dataset.offset, '0');
});

test('Discogs edition fields are sent once with a settled search and master browsing uses a separate route', async () => {
  const paths = [];
  const h = harness(async url => { paths.push(url); return { ok: true, json: async () => ({ results: [], pagination: { page: 1, per_page: 24, items: 0 } }) }; }, { collectDiscogsFilters: () => ({}), renderApiResults() {} });
  h.load('searchDiscogsApi', 'searchDiscogsMaster');
  h.node('#discogsArtist').value = 'Example Artist';
  h.node('#discogsCatno').value = 'ABC-1';
  await h.run("searchDiscogsApi('Synthetic album')");
  const search = new URL(paths[0], 'http://127.0.0.1');
  assert.equal(search.searchParams.get('artist'), 'Example Artist');
  assert.equal(search.searchParams.get('catno'), 'ABC-1');
  await h.run("searchDiscogsMaster(42,'Synthetic album',2)");
  assert.equal(paths[1], '/api/discogs/masters/42/versions?page=2');
  assert.equal(h.node('#discogsVersionsBack').hidden, false);
});

test('playback requests target an explicitly chosen device and do not fall back after disconnect', async () => {
  const requests = [];
  const h = harness(async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; });
  h.load('spotifyPlaybackRequest');
  h.run("spotifyDeviceId='local-device';spotifyTargetDeviceId='chosen-device'");
  await h.run("spotifyPlaybackRequest('next')");
  assert.equal(requests[0].device_id, 'chosen-device');
  h.run('spotifyConnected=false;spotifyTargetDeviceId=null;spotifyDeviceId=null');
  await assert.rejects(h.run("spotifyPlaybackRequest('play')"), /Connect Spotify/);
  assert.equal(requests.length, 1);
});

test('manually selected tracks retain their playlist or album playback context', async () => {
  const requests = [];
  const h = harness(async url => {
    assert.equal(url, '/api/spotify/currently-playing');
    return { ok: true, json: async () => ({ device: { id: 'synthetic-device' }, shuffle_state: requests.filter(request => request.action === 'shuffle').at(-1)?.state, item: { uri: requests.filter(request => request.action === 'start').at(-1)?.uri } }) };
  }, {
    cover: () => '<div class="cover"></div>', shelfMatch: () => ({}), shelfBadges: () => '',
    spotifyPlaybackRequest: async (action, details) => requests.push({ action, ...details })
  });
  h.load('spotifyPlaylistRecords', 'spotifyAlbumCard', 'spotifySearchCard', 'followingSavedTrackUris', 'waitForSpotifyPlaybackState', 'playSpotifyUri');
  const track = { name: 'Synthetic song', uri: 'spotify:track:synthetictrack', album: { name: 'Synthetic album', uri: 'spotify:album:syntheticalbum' } };
  h.context.syntheticTrack = track;
  assert.equal(h.run('spotifyPlaylistRecords([syntheticTrack])[0].contextUri'), 'spotify:album:syntheticalbum');
  assert.equal(h.run("spotifyPlaylistRecords([syntheticTrack],'syntheticplaylist')[0].contextUri"), 'spotify:playlist:syntheticplaylist');
  const card = h.run("spotifyAlbumCard(spotifyPlaylistRecords([syntheticTrack],'syntheticplaylist')[0])");
  assert.match(card, /data-context-uri="spotify:playlist:syntheticplaylist"/);
  const savedCard = h.run("spotifyAlbumCard({...spotifyPlaylistRecords([syntheticTrack])[0],playbackIndex:2})");
  assert.match(savedCard, /data-playback-index="2"/);
  const search = h.run("spotifySearchCard({...syntheticTrack,type:'track'},'track')");
  assert.match(search, /data-context-uri="spotify:album:syntheticalbum"/);
  h.context.savedRows = [
    { kind: 'track', uri: 'spotify:track:synthetictrack' },
    { kind: 'album', uri: 'spotify:album:syntheticalbum' },
    { kind: 'track', uri: 'spotify:track:nexttrack' }
  ];
  assert.equal(h.run("followingSavedTrackUris(savedRows,0,'spotify:track:synthetictrack').join(',')"), 'spotify:track:synthetictrack,spotify:track:nexttrack');
  assert.equal(h.run("followingSavedTrackUris(savedRows,2,'spotify:track:nexttrack').join(',')"), 'spotify:track:nexttrack,spotify:track:synthetictrack', 'the saved sequence wraps at the end');
  assert.equal(h.run("followingSavedTrackUris(savedRows,0,'spotify:track:other').length"), 0);
  h.context.longSavedRows = Array.from({ length: 70 }, (_, index) => ({ kind: 'track', uri: `spotify:track:synthetic${index}` }));
  assert.equal(h.run("followingSavedTrackUris(longSavedRows,0,'spotify:track:synthetic0').length"), 50);
  h.run("spotifyDeviceId='synthetic-device'");
  await h.run("playSpotifyUri('spotify:track:synthetictrack','spotify:playlist:syntheticplaylist')");
  assert.equal(h.run('spotifyHasContext'), true);
  await h.run("playSpotifyUri('spotify:track:synthetictrack','spotify:album:syntheticalbum',followingSavedTrackUris(savedRows,0,'spotify:track:synthetictrack'))");
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { action: 'start', uri: 'spotify:track:synthetictrack', context_uri: 'spotify:playlist:syntheticplaylist' },
    { action: 'start', uri: 'spotify:track:synthetictrack', uris: ['spotify:track:synthetictrack', 'spotify:track:nexttrack'], device_id: 'synthetic-device' }
  ]);
  assert.equal(h.run('spotifyHasContext'), false, 'a track sequence is not an album or playlist context');
  h.run('shuffleEnabled=true');
  assert.equal(h.run("followingSavedTrackUris(savedRows,0,'spotify:track:synthetictrack').length"), 2, 'Shuffle still needs the saved-song sequence');
  await h.run("playSpotifyUri('spotify:track:synthetictrack','',followingSavedTrackUris(savedRows,0,'spotify:track:synthetictrack'))");
  assert.deepEqual(JSON.parse(JSON.stringify(requests.slice(2))), [
    { action: 'shuffle', state: false, device_id: 'synthetic-device' },
    { action: 'start', uri: 'spotify:track:synthetictrack', uris: ['spotify:track:synthetictrack', 'spotify:track:nexttrack'], device_id: 'synthetic-device' },
    { action: 'shuffle', state: true, device_id: 'synthetic-device' }
  ], 'Shuffle is restored after the selected song starts in the saved-song sequence');
  assert.equal(h.run('spotifyHasContext'), false);
  h.load('resetSpotifyAccountUi');
  h.run('spotifyLibraryPlaybackRecords=savedRows;resetSpotifyAccountUi()');
  assert.equal(h.run('spotifyLibraryPlaybackRecords.length'), 0);
});

test('Saved Music Play keeps the clicked song first and restores Shuffle for its saved-song sequence', async () => {
  const requests = [];
  const h = harness(async url => {
    assert.equal(url, '/api/spotify/currently-playing');
    return { ok: true, json: async () => ({ device: { id: 'synthetic-device' }, shuffle_state: requests.filter(request => request.action === 'shuffle').at(-1)?.state, item: { uri: requests.filter(request => request.action === 'start').at(-1)?.uri } }) };
  }, { spotifyPlaybackRequest: async (action, details) => requests.push({ action, ...details }) });
  h.load('followingSavedTrackUris', 'updatePlaybackModes', 'waitForSpotifyPlaybackState', 'playSpotifyUri');
  let onClick;
  h.context.document.addEventListener = (type, handler, capture) => { if (type === 'click' && capture) onClick = handler; };
  const handler = source.split('\n').find(line => line.startsWith("document.addEventListener('click',event=>{const searchResult=event.target.closest('.spotify-play-result')"));
  assert.ok(handler, 'the playback click handler exists');
  vm.runInContext(handler, h.context);
  h.run("spotifyDeviceId='synthetic-device';spotifyLibraryPlaybackRecords=[{kind:'track',uri:'spotify:track:synthetictrack'},{kind:'track',uri:'spotify:track:nexttrack'}]");
  const click = dataset => onClick({
    target: { closest: selector => selector === '.spotify-play-result' ? { dataset } : null },
    preventDefault() {}, stopImmediatePropagation() {}
  });
  const saved = { uri: 'spotify:track:synthetictrack', contextUri: 'spotify:album:syntheticalbum', playbackIndex: '0' };
  h.run("shuffleEnabled=true;spotifyDeviceId='synthetic-device'");
  click(saved);
  await h.run('spotifyModeQueue');
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { action: 'shuffle', state: false, device_id: 'synthetic-device' },
    { action: 'start', uri: saved.uri, uris: [saved.uri, 'spotify:track:nexttrack'], device_id: 'synthetic-device' },
    { action: 'shuffle', state: true, device_id: 'synthetic-device' }
  ], 'saved-song playback never switches to album context');
  assert.equal(h.run('shuffleEnabled'), true, 'the visible Shuffle setting stays on after playback starts');
  assert.equal(h.node('#shuffleButton').attributes['aria-pressed'], 'true');
  h.run('shuffleEnabled=false');
  click(saved);
  await h.run('spotifyModeQueue');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[3])), { action: 'start', uri: saved.uri, uris: [saved.uri, 'spotify:track:nexttrack'], device_id: 'synthetic-device' }, 'Shuffle off retains the saved-song sequence');
  click({ uri: saved.uri, contextUri: saved.contextUri });
  await Promise.resolve();
  assert.deepEqual(requests[4], { action: 'start', uri: saved.uri, context_uri: saved.contextUri }, 'album-view playback still uses its album context');
});

test('a failed saved-song start restores Shuffle and reports the failure', async () => {
  const requests = []; const messages = [];
  const h = harness(async () => ({ ok: true, json: async () => ({ device: { id: 'synthetic-device' }, shuffle_state: requests.at(-1)?.state }) }), {
    spotifyPlaybackRequest: async (action, details) => { requests.push({ action, ...details }); if (action === 'start') throw new Error('Synthetic start failure'); },
    showToast: message => messages.push(message)
  });
  h.load('waitForSpotifyPlaybackState', 'playSpotifyUri');
  h.run("spotifyDeviceId='synthetic-device';shuffleEnabled=true");
  const result = await h.run("playSpotifyUri('spotify:track:synthetictrack','',['spotify:track:synthetictrack','spotify:track:nexttrack'])");
  assert.equal(result, false);
  assert.deepEqual(requests.map(request => request.action), ['shuffle', 'start', 'shuffle']);
  assert.equal(requests[2].state, true);
  assert.equal(h.run('spotifyPlaybackStartPending'), 0);
  assert.equal(h.node('#shuffleButton').attributes['aria-busy'], 'false');
  assert.deepEqual(messages, ['Synthetic start failure']);
});

test('an unconfirmed Shuffle change never starts the wrong saved song', async () => {
  const requests = []; const messages = []; let checks = 0;
  const h = harness(async () => { checks++; return { ok: true, json: async () => ({ device: { id: 'synthetic-device' }, shuffle_state: true }) }; }, {
    spotifyPlaybackRequest: async (action, details) => requests.push({ action, ...details }),
    setTimeout: callback => { callback(); return 1; }, showToast: message => messages.push(message)
  });
  h.load('waitForSpotifyPlaybackState', 'playSpotifyUri');
  h.run("spotifyDeviceId='synthetic-device';shuffleEnabled=true");
  const result = await h.run("playSpotifyUri('spotify:track:synthetictrack','',['spotify:track:synthetictrack','spotify:track:nexttrack'])");
  assert.equal(result, false);
  assert.deepEqual(requests.map(request => request.action), ['shuffle', 'shuffle'], 'the URI list is not sent until Spotify confirms Shuffle is off');
  assert.equal(requests[1].state, true, 'the original Shuffle setting is restored');
  assert.equal(checks, 6, 'state checks are bounded');
  assert.match(messages[0], /Spotify did not confirm Shuffle turning off/);
});

test('saved-song playback never restores Shuffle through a disconnected account', async () => {
  const requests = [];
  const h = harness(async () => ({ ok: true, json: async () => ({ device: { id: 'synthetic-device' }, shuffle_state: false }) }), {
    spotifyPlaybackRequest: async (action, details) => { requests.push({ action, ...details }); if (action === 'shuffle') h.run('spotifyConnected=false;++spotifyAccountGeneration'); }
  });
  h.load('waitForSpotifyPlaybackState', 'playSpotifyUri');
  h.run("spotifyDeviceId='synthetic-device';shuffleEnabled=true");
  const result = await h.run("playSpotifyUri('spotify:track:synthetictrack','',['spotify:track:synthetictrack','spotify:track:nexttrack'])");
  assert.equal(result, false);
  assert.deepEqual(requests.map(request => request.action), ['shuffle']);
});

test('recently played tracks carry their album context into the Play action', async () => {
  let rows = [];
  const h = harness(async url => {
    assert.equal(url, '/api/spotify/recent');
    return { ok: true, json: async () => ({ recentlyPlayed: [{ name: 'Synthetic song', uri: 'spotify:track:synthetictrack', artists: [{ name: 'Artist' }], album: { name: 'Synthetic album', uri: 'spotify:album:syntheticalbum' } }] }) };
  }, { renderRecentTracks: items => { rows = items; }, formatTime: () => '0:00' });
  h.load('refreshSpotifyHome');
  await h.run('refreshSpotifyHome()');
  assert.equal(rows[0][6], 'spotify:track:synthetictrack');
  assert.equal(rows[0][7], 'spotify:album:syntheticalbum');
});

test('an older server gives device selection a restart instruction instead of Not found', async () => {
  const h = harness(async () => ({ status: 404, ok: false, json: async () => ({ error: 'Not found' }) }));
  h.load('loadSpotifyDevices');
  await h.run('loadSpotifyDevices()');
  assert.match(h.node('#playbackDeviceList').textContent, /Restart RCRD from Settings/);
  assert.doesNotMatch(h.node('#playbackDeviceList').textContent, /Not found/);
});

test('opening Playback health loads devices without a separate chooser action', () => {
  assert.match(markup, /id="playbackDeviceLoad"[^>]*>Refresh devices<\/button>/);
  assert.doesNotMatch(markup, /Choose playback device<\/button>/);
  const requests = [];
  const h = harness(async url => { requests.push(url); return { ok: true, json: async () => ({ devices: [] }) }; });
  h.load('loadSpotifyDevices');
  h.node('#playbackHealthPanel').hidden = true;
  h.node('#playbackDeviceList').hidden = true;
  h.run('spotifySyncTimer=1');
  h.context.playbackHealthPanel = h.node('#playbackHealthPanel');
  h.context.playbackHealthToggle = h.node('#playbackHealthToggle');
  h.context.playbackHealthToggle.addEventListener = (_event, handler) => { h.context.openHealth = handler; };
  vm.runInContext(source.split('\n').find(line => line.startsWith("playbackHealthToggle.addEventListener('click'")), h.context);
  h.run('openHealth()');
  assert.equal(h.node('#playbackHealthPanel').hidden, false);
  assert.equal(h.node('#playbackDeviceList').hidden, false);
  assert.equal(h.node('#playbackDeviceList').textContent, 'Loading available devices…');
  assert.deepEqual(requests, ['/api/spotify/devices']);
});

test('Refresh devices click displays loading feedback before the response', async () => {
  const response = deferred();
  const h = harness(() => response.promise);
  h.load('loadSpotifyDevices');
  h.node('#playbackDeviceLoad').addEventListener = (_event, handler) => { h.context.refreshDevices = handler; };
  vm.runInContext(source.split('\n').find(line => line.startsWith("document.querySelector('#playbackDeviceLoad').addEventListener('click'")), h.context);
  const refresh = h.run('refreshDevices({type:"click"})');
  assert.equal(h.node('#playbackDeviceList').textContent, 'Loading available devices…');
  response.resolve({ ok: true, json: async () => ({ devices: [] }) });
  await refresh;
  assert.match(h.node('#playbackDeviceList').innerHTML, /No controllable Spotify devices/);
});

test('device picker renders separate full-row choices with a distinct active label', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ devices: [
    { id: 'desk', name: 'Desk speaker', is_active: false, is_restricted: false },
    { id: 'rcrd', name: 'RCRD · Spotify', is_active: true, is_restricted: false }
  ] }) }));
  h.load('loadSpotifyDevices');
  await h.run('loadSpotifyDevices()');
  const html = h.node('#playbackDeviceList').innerHTML;
  assert.equal((html.match(/class="playback-device"/g) || []).length, 2);
  assert.match(html, /<span class="playback-device-name">Desk speaker<\/span><\/button>/);
  assert.match(html, /<span class="playback-device-name">RCRD · Spotify<\/span><span class="playback-device-status">Active<\/span>/);
});

test('open device picker drops closed devices on refresh and stops checking when hidden', async () => {
  const timers = new Set();
  let deviceIds = ['speaker', 'rcrd'];
  const h = harness(async () => ({ ok: true, json: async () => ({ devices: deviceIds.map(id => ({ id, name: id, is_restricted: false })) }) }), {
    setInterval: callback => { const timer = { callback }; timers.add(timer); return timer; },
    clearInterval: timer => timers.delete(timer)
  });
  h.load('loadSpotifyDevices');
  h.node('#playbackHealthPanel').hidden = false;
  h.context.document.visibilityState = 'visible';
  await h.run('loadSpotifyDevices()');
  assert.equal(timers.size, 1);
  deviceIds = ['rcrd'];
  await [...timers][0].callback();
  assert.doesNotMatch(h.node('#playbackDeviceList').innerHTML, /speaker/);
  assert.match(h.node('#playbackDeviceList').innerHTML, /rcrd/);
  h.context.document.visibilityState = 'hidden';
  h.run('syncSpotifyDeviceRefresh()');
  assert.equal(timers.size, 0);
  h.context.document.visibilityState = 'visible';
  h.run('syncSpotifyDeviceRefresh()');
  assert.equal(timers.size, 1);
  h.context.document.hasFocus = () => false;
  h.run('syncSpotifyDeviceRefresh()');
  assert.equal(timers.size, 0);
  h.context.document.hasFocus = () => true;
  h.run('syncSpotifyDeviceRefresh()');
  assert.equal(timers.size, 1);
  h.node('#playbackHealthPanel').hidden = true;
  h.run('syncSpotifyDeviceRefresh()');
  assert.equal(timers.size, 0);
});

test('a vanished device cannot remain selectable after a failed transfer', async () => {
  const toasts = [];
  let deviceIds = ['gone', 'rcrd'];
  const h = harness(async url => url === '/api/spotify/devices'
    ? { ok: true, json: async () => ({ devices: deviceIds.map(id => ({ id, name: id, is_restricted: false })) }) }
    : { status: 404, ok: false, json: async () => ({ error: 'That Spotify device is no longer available.' }) },
  { showToast: message => toasts.push(message) });
  h.load('loadSpotifyDevices', 'chooseSpotifyDevice');
  await h.run('loadSpotifyDevices()');
  deviceIds = ['rcrd'];
  const button = { dataset: { deviceId: 'gone' }, disabled: false, removed: false, remove() { this.removed = true; } };
  h.context.deviceButton = button;
  await h.run('chooseSpotifyDevice({target:{closest:()=>deviceButton}})');
  assert.equal(button.removed, true);
  assert.equal(h.run('availableSpotifyDevices.has("gone")'), false);
  assert.doesNotMatch(h.node('#playbackDeviceList').innerHTML, /gone/);
  assert.match(toasts[0], /no longer available/);
  assert.equal(h.run('spotifyTargetDeviceId'), null);
});

test('device refresh stops after throttling instead of retrying in the background', async () => {
  const timers = new Set();
  let throttled = false;
  const h = harness(async () => throttled
    ? { status: 429, ok: false, json: async () => ({ error: 'Spotify request limit reached.' }) }
    : { ok: true, json: async () => ({ devices: [{ id: 'speaker', name: 'Speaker' }] }) }, {
    setInterval: callback => { const timer = { callback }; timers.add(timer); return timer; },
    clearInterval: timer => timers.delete(timer)
  });
  h.load('loadSpotifyDevices');
  h.node('#playbackHealthPanel').hidden = false;
  await h.run('loadSpotifyDevices()');
  assert.equal(timers.size, 1);
  throttled = true;
  await [...timers][0].callback();
  assert.equal(timers.size, 0);
  assert.equal(h.run('availableSpotifyDevices.size'), 0);
  assert.match(h.node('#playbackDeviceList').textContent, /request limit reached/);
});

test('long-term favorites are loaded only on request and skip recent or possible collection matches', async () => {
  const calls = [];
  const h = harness(async url => { calls.push(url); return { ok: true, json: async () => ({ tracks: [{ album: { id: 'top-1', name: 'Top album', uri: 'spotify:album:top1', artists: [{ name: 'Example Artist' }], images: [] } }, { album: { id: 'top-2', name: 'Owned album', uri: 'spotify:album:top2', artists: [{ name: 'Example Artist' }], images: [] } }] }) }; }, { shelfMatchKey: (title, artist) => `${title}|${artist}`, shelfMatch: title => ({ collection: title === 'Owned album' ? 'possible' : '' }) });
  h.load('renderHomeRecommendations', 'refreshSpotifyTopAlbums');
  h.run("spotifyCanReadTop=true;homeDiscoveryMode='top';spotifyHomeRecommendations=[]");
  assert.equal(calls.length, 0);
  await h.run('refreshSpotifyTopAlbums()');
  assert.equal(calls.length, 1);
  assert.match(h.node('#recommendations').innerHTML, /Top album/);
  assert.doesNotMatch(h.node('#recommendations').innerHTML, /Owned album/);
});

test('For your ears paginates up to thirty distinct recent and saved albums', () => {
  const h = harness();
  h.load('renderPagination', 'renderHomeRecommendations', 'updateHomeRecommendations');
  h.context.recentFixture = Array.from({ length: 35 }, (_, index) => ({ album: { id: `recent-${index}`, name: `Recent ${index}`, artists: [{ name: 'Example Artist' }] } }));
  h.context.savedFixture = [{ title: 'Recent 0', artist: 'Example Artist' }, { title: 'Saved album', artist: 'Example Artist' }];
  h.run('updateHomeRecommendations(recentFixture,savedFixture)');
  assert.equal(h.run('spotifyHomeRecommendations.length'), 30);
  assert.equal((h.node('#recommendations').innerHTML.match(/<article>/g) || []).length, 8);
  assert.match(h.node('#homeSpotifyPagination').innerHTML, /Page 1 of 4/);
  h.run('homeRecommendationPage=4;renderHomeRecommendations()');
  assert.equal((h.node('#recommendations').innerHTML.match(/<article>/g) || []).length, 6);
  assert.match(h.node('#recommendations').innerHTML, /Recent 29/);
  assert.doesNotMatch(h.node('#recommendations').innerHTML, /Recent 30|Saved album/);
  h.context.savedFillFixture = [h.context.savedFixture[0], ...Array.from({ length: 35 }, (_, index) => ({ title: `Saved ${index}`, artist: 'Example Artist' }))];
  h.run('updateHomeRecommendations(recentFixture.slice(0,3),savedFillFixture)');
  assert.equal(h.run('spotifyHomeRecommendations.length'), 30);
  assert.equal(h.run('homeRecommendationPage'), 1);
  assert.equal((h.node('#recommendations').innerHTML.match(/<article>/g) || []).length, 8);
  assert.match(h.node('#recommendations').innerHTML, /Saved 4/);
  assert.doesNotMatch(h.node('#recommendations').innerHTML, /Saved 5|Saved 6/);
  h.run('updateHomeRecommendations(recentFixture.slice(0,3),savedFixture)');
  assert.equal(h.run('spotifyHomeRecommendations.length'), 4);
  assert.match(h.node('#recommendations').innerHTML, /Saved album/);
  assert.equal((h.node('#recommendations').innerHTML.match(/Recent 0/g) || []).length, 1);
  assert.equal(h.node('#homeSpotifyPagination').innerHTML, '');
});

test('Long-term favorites paginates eligible albums after overlap and shelf filtering', () => {
  const h = harness(undefined, { shelfMatchKey: (title, artist) => `${title}|${artist}`, shelfMatch: title => ({ collection: title === 'Top 1' ? 'possible' : '' }) });
  h.load('renderPagination', 'renderHomeRecommendations');
  h.context.topFixture = Array.from({ length: 30 }, (_, index) => ({ title: `Top ${index}`, artist: 'Example Artist' }));
  h.run("homeDiscoveryMode='top';spotifyHomeRecommendations=[{title:'Top 0',artist:'Example Artist'}];spotifyTopAlbums=topFixture;renderHomeRecommendations()");
  const html = h.node('#recommendations').innerHTML;
  assert.equal((html.match(/<article>/g) || []).length, 8);
  assert.doesNotMatch(html, /Top 0|Top 1|Top 10|Top 11/);
  assert.match(html, /Top 2/);
  assert.match(html, /Top 9/);
  assert.match(h.node('#homeSpotifyPagination').innerHTML, /Page 1 of 4/);
  h.run('homeRecommendationPage=4;renderHomeRecommendations()');
  assert.equal((h.node('#recommendations').innerHTML.match(/<article>/g) || []).length, 4);
  assert.match(h.node('#recommendations').innerHTML, /Top 29/);
  assert.doesNotMatch(h.node('#recommendations').innerHTML, /Top 1/);
});

test('home page buttons change cached recommendation pages without a provider request', () => {
  const requests = [];
  const h = harness(async url => { requests.push(url); throw new Error('Unexpected provider request'); });
  h.load('renderPagination', 'renderHomeRecommendations', 'updateHomeRecommendations');
  h.node('.active-view').id = 'home';
  h.context.document.addEventListener = (_type, handler) => { h.context.pageClick = handler; };
  h.node('#homeDiscoveryTitle').scrollIntoView = () => {};
  h.context.window = { scrollTo() {} };
  vm.runInContext(source.split('\n').find(line => line.startsWith("document.addEventListener('click',event=>{const button=event.target.closest('[data-page-target]'")), h.context);
  h.context.recentFixture = Array.from({ length: 18 }, (_, index) => ({ album: { id: `album-${index}`, name: `Album ${index}` } }));
  h.run('updateHomeRecommendations(recentFixture,[])');
  h.context.pageButton = { disabled: false, dataset: { pageTarget: 'home-recommendations', page: '2' } };
  h.run('pageClick({target:{closest:()=>pageButton}})');
  assert.equal(h.run('homeRecommendationPage'), 2);
  assert.match(h.node('#recommendations').innerHTML, /Album 8/);
  assert.doesNotMatch(h.node('#recommendations').innerHTML, /Album 0/);
  assert.match(h.node('#homeSpotifyPagination').innerHTML, /Page 2 of 3/);
  assert.deepEqual(requests, []);
  h.node('#searchInput').value = 'query';
  h.run('pageClick({target:{closest:()=>pageButton}})');
  assert.equal(h.run('homeRecommendationPage'), 2);
});

test('home catalog search clears recommendation pages and restores them when cleared', () => {
  const h = harness();
  h.load('renderPagination', 'renderHomeRecommendations', 'searchSpotifyCatalog');
  h.node('.active-view').id = 'home';
  h.run("spotifyHomeRecommendations=Array.from({length:18},(_,index)=>({title:'Album '+index,artist:'Example Artist'}));renderHomeRecommendations()");
  assert.match(h.node('#homeSpotifyPagination').innerHTML, /home-recommendations/);
  h.node('#searchInput').value = 'test';
  h.run("searchSpotifyCatalog('test')");
  assert.equal(h.node('#homeSpotifyPagination').innerHTML, '');
  h.node('#searchInput').value = '';
  h.run("searchSpotifyCatalog('')");
  assert.match(h.node('#homeSpotifyPagination').innerHTML, /home-recommendations/);
});

test('switching recommendation views starts each view on page one', () => {
  const h = harness(undefined, { shelfMatchKey: (title, artist) => `${title}|${artist}`, shelfMatch: () => ({ collection: '' }) });
  h.load('renderPagination', 'renderHomeRecommendations');
  h.node('#homeTopToggle').addEventListener = (_type, handler) => { h.context.toggleFavorites = handler; };
  vm.runInContext(source.split('\n').find(line => line.startsWith("document.querySelector('#homeTopToggle').addEventListener('click'")), h.context);
  h.run("spotifyCanReadTop=true;spotifyHomeRecommendations=Array.from({length:18},(_,index)=>({title:'Recent '+index,artist:'Example Artist'}));spotifyTopAlbums=Array.from({length:18},(_,index)=>({title:'Favorite '+index,artist:'Example Artist'}));homeRecommendationPage=3");
  h.run('toggleFavorites()');
  assert.equal(h.run('homeRecommendationPage'), 1);
  assert.match(h.node('#recommendations').innerHTML, /Favorite 0/);
  assert.match(h.node('#homeSpotifyPagination').innerHTML, /Page 1 of 3/);
  h.run('homeRecommendationPage=2;toggleFavorites()');
  assert.equal(h.run('homeRecommendationPage'), 1);
  assert.match(h.node('#recommendations').innerHTML, /Recent 0/);
});

test('switching recommendation views clears an album lookup and renders both modes', () => {
  const h = harness(undefined, { shelfMatchKey: (title, artist) => `${title}|${artist}`, shelfMatch: () => ({ collection: '' }) });
  h.node('.active-view').id = 'home';
  h.load('renderHomeRecommendations');
  h.node('#homeTopToggle').addEventListener = (_type, handler) => { h.context.toggleFavorites = handler; };
  vm.runInContext(source.split('\n').find(line => line.startsWith("document.querySelector('#homeTopToggle').addEventListener('click'")), h.context);
  h.node('#searchInput').value = 'Lookup album Example Artist';
  h.node('#homeSpotifySearchStatus').textContent = '1 possible album match on this page';
  h.run("spotifyCanReadTop=true;spotifySearchSequence=4;collectionSpotifyLookup={title:'Lookup album',artist:'Example Artist',query:'Lookup album Example Artist'};spotifyHomeRecommendations=[{title:'Recent album',artist:'Example Artist'}];spotifyTopAlbums=[{title:'Favorite album',artist:'Example Artist'}]");
  h.run('toggleFavorites()');
  assert.equal(h.node('#searchInput').value, '');
  assert.equal(h.run('collectionSpotifyLookup'), null);
  assert.equal(h.run('spotifySearchSequence'), 5, 'stale lookup responses are invalidated');
  assert.match(h.node('#recommendations').innerHTML, /Favorite album/);
  assert.equal(h.node('#homeSpotifySearchStatus').hidden, true);
  h.run('toggleFavorites()');
  assert.match(h.node('#recommendations').innerHTML, /Recent album/);
});

test('volume slider, whole-number feedback, and Spotify output use the same percentage', async () => {
  const slider = markup.match(/<input id="volumeControl"[^>]*>/)?.[0];
  assert.ok(slider);
  assert.match(slider, /step="1"/);
  assert.match(slider, /value="65"/, 'the initial thumb position agrees with the initial 65% label');
  let persisted = JSON.stringify({ volume: 65 });
  const sdkVolumes = [];
  const h = harness(undefined, {
    localStorage: { getItem: () => persisted, setItem: (_key, value) => { persisted = value; } },
    captureVolume: async value => { sdkVolumes.push(value); }
  });
  h.load('loadUiPreferences', 'saveUiPreference', 'renderVolumeControl', 'setSpotifyVolume');
  h.run('const preferenceDefaults={volume:65,ambientVisualizerEnabled:false,discogsFilters:{}}; const uiPreferences=loadUiPreferences(); let storageWarningShown=false; volume=uiPreferences.volume/100; spotifyPlayer={setVolume:captureVolume}');
  h.run('renderVolumeControl()');
  assert.equal(h.run('volume'), 0.65, 'an existing saved level remains the actual SDK level');
  assert.equal(h.node('#volumeControl').value, '65', 'the thumb agrees with the displayed and stored level');
  assert.equal(h.node('#volumeControl').attributes['aria-valuetext'], '65 percent');
  assert.equal(h.node('#volumeLevel').textContent, '65%', 'visible feedback matches the effective level');

  await h.run('setSpotifyVolume(1)');
  assert.equal(sdkVolumes.at(-1), 0.01, 'the first slider step sends one percent, not a squared value');
  assert.equal(JSON.parse(persisted).volume, 1);
  assert.equal(h.node('#volumeControl').attributes['aria-valuetext'], '1 percent');
  assert.equal(h.node('#volumeControl').title, 'Spotify volume: 1%');
  assert.equal(h.node('#volumeLevel').textContent, '1%');
  h.run('volume=loadUiPreferences().volume/100;renderVolumeControl()');
  assert.equal(h.node('#volumeControl').value, '1', 'the low setting survives reload');

  await h.run('setSpotifyVolume(2)');
  assert.ok(sdkVolumes.at(-1) > sdkVolumes.at(-2), 'low steps increase smoothly');
  await h.run('setSpotifyVolume(74)');
  assert.equal(sdkVolumes.at(-1), 0.74);
  assert.equal(JSON.parse(persisted).volume, 74);
  assert.equal(h.node('#volumeControl').value, '74');
  assert.equal(h.node('#volumeControl').attributes['aria-valuetext'], '74 percent');
  assert.equal(h.node('#volumeLevel').textContent, '74%');
  await h.run('setSpotifyVolume(0)');
  assert.equal(sdkVolumes.at(-1), 0, 'zero remains mute');
  assert.equal(h.node('#volumeLevel').textContent, '0%');
  await h.run('setSpotifyVolume(100)');
  assert.equal(sdkVolumes.at(-1), 1, 'the high end remains full volume');
  assert.equal(h.node('#volumeLevel').textContent, '100%');
  const remoteCommands=[];
  h.context.spotifyPlaybackRequest=async (action,details)=>{remoteCommands.push({action,...details});};
  h.run("spotifyTargetDeviceId='remote';spotifyDeviceId='local'");
  await h.run('setSpotifyVolume(37)');
  assert.deepEqual(remoteCommands,[{action:'volume',volume_percent:37}], 'a different Spotify device receives the same whole percentage');
  const previousCalls = sdkVolumes.length;
  const previousPreference = persisted;
  await h.run('setSpotifyVolume("invalid")');
  assert.equal(sdkVolumes.length, previousCalls, 'invalid input does not reach the SDK');
  assert.equal(persisted, previousPreference, 'invalid input does not overwrite the saved level');
});

test('speaker button mutes and restores the last audible level across reloads', async () => {
  assert.match(markup, /aria-label="Mute volume" aria-pressed="false" title="Mute volume" id="volumeButton"/);
  assert.match(source, /document\.querySelector\('#volumeButton'\)\.addEventListener\('click',toggleSpotifyMute\)/);
  let persisted = JSON.stringify({ volume: 65 });
  const sdkVolumes = [];
  const feedback = [];
  const h = harness(undefined, {
    localStorage: { getItem: () => persisted, setItem: (_key, value) => { persisted = value; } },
    captureVolume: async value => { sdkVolumes.push(value); },
    keepVolumeOpen: () => feedback.push('open'),
    scheduleVolumeClose: delay => feedback.push(delay)
  });
  h.load('loadUiPreferences', 'saveUiPreference', 'renderVolumeControl', 'setSpotifyVolume', 'toggleSpotifyMute');
  h.run('const preferenceDefaults={volume:65,volumeBeforeMute:65,ambientVisualizerEnabled:false,discogsFilters:{}};const uiPreferences=loadUiPreferences();let storageWarningShown=false;volume=uiPreferences.volume/100;let volumeBeforeMute=uiPreferences.volumeBeforeMute/100;spotifyPlayer={setVolume:captureVolume};renderVolumeControl()');
  assert.equal(h.node('#volumeButton').attributes['aria-pressed'], 'false');

  await h.run('toggleSpotifyMute()');
  assert.equal(sdkVolumes.at(-1), 0);
  assert.equal(JSON.parse(persisted).volume, 0);
  assert.equal(JSON.parse(persisted).volumeBeforeMute, 65);
  assert.equal(h.node('#volumeLevel').textContent, '0%');
  assert.equal(h.node('#volumeButton').attributes['aria-pressed'], 'true');
  assert.equal(h.node('#volumeButton').title, 'Unmute volume');
  assert.deepEqual(feedback, ['open', 1600]);

  await h.run('toggleSpotifyMute()');
  assert.ok(Math.abs(sdkVolumes.at(-1) - 0.65) < 1e-10);
  assert.equal(h.node('#volumeLevel').textContent, '65%');
  assert.equal(h.node('#volumeButton').attributes['aria-pressed'], 'false');

  await h.run('setSpotifyVolume(74)');
  await h.run('toggleSpotifyMute()');
  assert.equal(JSON.parse(persisted).volumeBeforeMute, 74);
  h.run('volume=loadUiPreferences().volume/100;volumeBeforeMute=loadUiPreferences().volumeBeforeMute/100;renderVolumeControl()');
  await h.run('toggleSpotifyMute()');
  assert.equal(sdkVolumes.at(-1), 0.74);
  assert.equal(h.node('#volumeLevel').textContent, '74%');

  h.node('#volumeControl').disabled = true;
  h.run('renderVolumeControl()');
  const priorCalls = sdkVolumes.length;
  const priorPreference = persisted;
  await h.run('toggleSpotifyMute()');
  assert.equal(h.node('#volumeButton').disabled, true);
  assert.equal(sdkVolumes.length, priorCalls);
  assert.equal(persisted, priorPreference);
  h.node('#volumeControl').disabled = false;
  h.run('spotifyTargetSupportsVolume=false;renderVolumeControl()');
  await h.run('toggleSpotifyMute()');
  assert.equal(h.node('#volumeButton').disabled, true);
  assert.equal(sdkVolumes.length, priorCalls);
  persisted = JSON.stringify({ volume: 0, volumeBeforeMute: -2 });
  assert.equal(h.run('loadUiPreferences().volumeBeforeMute'), 65, 'invalid restore levels fall back to the default');
});

test('connected Spotify keeps one connection state while requesting only the new permission', () => {
  const h = harness();
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:false,daysRemaining:90})');
  assert.equal(h.node('#connectSpotify').textContent, 'Spotify connected');
  assert.equal(h.node('#settingsSpotifyStatus').textContent, 'Connected');
  assert.equal(h.node('#settingsSpotifyReconnect').hidden, true);
  assert.equal(h.node('#settingsSpotifyDisconnect').hidden, false);
  assert.match(h.node('#spotifyReminder').innerHTML, /Enable Liked Songs/);
  assert.doesNotMatch(h.node('#spotifyReminder').innerHTML, /Reconnect|disconnected/i);
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:true,daysRemaining:90})');
  assert.equal(h.node('#spotifyReminder').hidden, true);
  assert.equal(h.node('#connectSpotify').textContent, 'Spotify connected');
});

test('missing Spotify playback scope points to Settings without starting an unusable player', async () => {
  let playerAttempts = 0;
  const h = harness(undefined, { window: { Spotify: {}, setInterval() {} }, Spotify: { Player: class { constructor() { playerAttempts++; } } } });
  h.load('initSpotifyPlayer');
  h.run('renderSpotifyConnectionStatus({connected:true,canStream:false,canModifyLibrary:true,daysRemaining:90})');
  assert.equal(h.node('#connectSpotify').textContent, 'Spotify connected');
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Playback permission needed');
  assert.match(h.node('#playbackHealthHelp').textContent, /Reconnect Spotify from Settings/);
  assert.equal(h.node('#playbackHealthRetry').hidden, true);
  assert.doesNotMatch(markup, /id="playbackHealthAuthorize"/);
  assert.match(h.node('#spotifyReminder').innerHTML, /Reconnect Spotify/);
  await h.run('initSpotifyPlayer()');
  assert.equal(playerAttempts, 0);
  h.run('renderSpotifyConnectionStatus({connected:true,canStream:true,canModifyLibrary:true,daysRemaining:90})');
  assert.equal(h.node('#playbackHealthRetry').hidden, false);
  assert.equal(h.node('#spotifyReminder').hidden, true);
});

test('Settings offers sign-out without promising to clear provider website sessions', () => {
  assert.match(markup, /id="settingsSpotifyDisconnect"[^>]*>Sign out<\/button>/);
  assert.match(markup, /id="settingsDiscogsDisconnect"[^>]*>Sign out<\/button>/);
  assert.match(markup, /Sign out here before another person connects/);
  assert.match(markup, /not the Spotify or Discogs website login/);
  assert.match(markup, /href="https:\/\/www\.discogs\.com\/"[^>]*rel="noopener noreferrer"/);
  const h = harness();
  h.run('updateSettingsAccountAction("Spotify",true);updateSettingsAccountAction("Discogs",true)');
  assert.equal(h.node('#settingsSpotifyReconnect').hidden, true);
  assert.equal(h.node('#settingsDiscogsReconnect').hidden, true);
  assert.equal(h.node('#settingsSpotifyDisconnect').hidden, false);
  assert.equal(h.node('#settingsDiscogsDisconnect').hidden, false);
});

test('profile connection buttons open account settings when connected and authorization when disconnected', () => {
  const h = harness();
  const destinations = [];
  h.node('[data-view="settings"]').click = () => destinations.push('settings');
  h.run('const location={href:""}');
  for (const service of ['Spotify', 'Discogs']) {
    const binding = source.match(new RegExp(`document\\.querySelector\\('#connect${service}'\\)\\.onclick=.*?;refresh${service === 'Spotify' ? 'SpotifyStatus' : 'DiscogsSession'}\\(\\);`))?.[0];
    assert.ok(binding, `${service} profile action exists`);
    h.run(binding.replace(/refresh(?:SpotifyStatus|DiscogsSession)\(\);$/, ''));
    h.run(`${service === 'Spotify' ? 'spotifyConnected' : 'apiConnected'}=true`);
    h.node(`#connect${service}`).onclick();
    assert.equal(destinations.at(-1), 'settings');
    h.run(`${service === 'Spotify' ? 'spotifyConnected' : 'apiConnected'}=false`);
    h.node(`#connect${service}`).onclick();
    assert.equal(h.run('location.href'), `/auth/${service.toLowerCase()}/start`);
  }
});

test('profile images open keyboard-accessible menus with Settings, guide, restart, and About on both layouts', () => {
  for (const [avatar, suffix] of [['profileAvatar', ''], ['profileAvatarMobile', 'Mobile']]) {
    const section = markup.slice(markup.indexOf(`id="${avatar}"`));
    assert.match(markup, new RegExp(`<details class="profile-menu(?: mobile-profile-menu)?"><summary class="profile-menu-trigger" aria-label="Open profile menu"[^>]*><span class="avatar is-placeholder" id="${avatar}"`));
    assert.match(section, new RegExp(`class="profile-connections" role="group" aria-label="Account connections"[\\s\\S]*id="connectSpotify${suffix}">Connect Spotify</button>[\\s\\S]*id="connectDiscogs${suffix}">Connect Discogs</button>`));
    assert.match(section, /href="#settings" data-view="settings">Settings<\/a>[\s\S]*href="#guide" data-view="guide">Help &amp; setup guide<\/a>[\s\S]*data-profile-action="restart">Restart RCRD<\/button>[\s\S]*<button type="button" data-profile-action="about">About RCRD<\/button>/);
  }
  assert.doesNotMatch(markup.match(/<div class="header-actions">[\s\S]*?<\/header>/)?.[0], /id="connect(?:Spotify|Discogs)"/);
  assert.doesNotMatch(markup, /class="settings-link"/);
  assert.match(markup, /Select your profile image to see Spotify and Discogs connection status/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'distinction.css'), 'utf8');
  assert.match(css, /\.mobile-profile-menu\{display:none\}/);
  assert.match(css, /@media\(max-width:620px\)[^\n]*\.mobile-profile-menu\{display:block/);
});

test('narrow-screen connection controls mirror account state and reuse the canonical action', () => {
  const h = harness();
  const observers = [];
  const connected = { Spotify: false, Discogs: false };
  const clicks = { Spotify: 0, Discogs: 0 };
  h.context.MutationObserver = class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} };
  h.load('syncMobileConnectionButton');
  for (const service of ['Spotify', 'Discogs']) {
    const primary = h.node(`#connect${service}`);
    const mobile = h.node(`#connect${service}Mobile`);
    primary.classList = { contains: name => name === 'connected' && connected[service] };
    primary.click = () => { clicks[service] += 1; };
    mobile.classList = { toggle: (name, value) => { if (name === 'connected') mobile.connected = value; } };
  }
  const start = source.indexOf("for(const service of ['Spotify','Discogs']){");
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  h.run(source.slice(start, end));
  assert.equal(observers.length, 2);
  for (const service of ['Spotify', 'Discogs']) {
    const primary = h.node(`#connect${service}`);
    const mobile = h.node(`#connect${service}Mobile`);
    primary.textContent = `${service} connected`;
    connected[service] = true;
    h.run(`syncMobileConnectionButton('${service}')`);
    assert.equal(mobile.textContent, `${service} connected`);
    assert.equal(mobile.connected, true);
    mobile.onclick();
    assert.equal(clicks[service], 1);
    primary.textContent = `Connect ${service}`;
    connected[service] = false;
    h.run(`syncMobileConnectionButton('${service}')`);
    assert.equal(mobile.textContent, `Connect ${service}`);
    assert.equal(mobile.connected, false);
  }
});

test('profile menu restarts in place and opens About as a modal without opening Settings', () => {
  const events = [];
  const menu = { open: true, querySelector: () => ({ focus: () => events.push('menu-focus') }) };
  const version = { removeAttribute: name => events.push(`version-remove-${name}`) };
  const clone = { removeAttribute: name => events.push(`about-remove-${name}`), querySelector: () => version };
  const nodes = {
    '#restartMenuStatus': { hidden: true, textContent: '' },
    '#settingsAbout': { cloneNode: deep => { assert.equal(deep, true);return clone; } },
    '#aboutDialogContent': { replaceChildren: node => { assert.equal(node, clone);events.push('about-content'); } },
    '#aboutDialog': { showModal: () => events.push('about-modal') }
  };
  const context = vm.createContext({
    profileMenus: [menu],
    document: { querySelector: selector => nodes[selector] },
    closeProfileMenus: except => { if (menu !== except) menu.open = false; },
    restartRcrd: onStatus => { events.push('restart'); onStatus('Restarting RCRD…'); }
  });
  vm.runInContext(definition('handleProfileMenuClick'), context);
  vm.runInContext(definition('handleProfileMenuKeydown'), context);
  const click = action => vm.runInContext('handleProfileMenuClick(event)', Object.assign(context, {
    event: { target: { closest: selector => selector === '.profile-menu' ? menu : selector === '.profile-menu-list a,.profile-menu-list button' ? { dataset: { profileAction: action } } : null } }
  }));
  click('restart');
  assert.deepEqual(events, ['restart']);
  assert.equal(nodes['#restartMenuStatus'].textContent, 'Restarting RCRD…');
  assert.equal(nodes['#restartMenuStatus'].hidden, false);
  assert.equal(menu.open, false);
  menu.open = true;
  click('about');
  assert.deepEqual(events.slice(1), ['about-remove-id', 'about-remove-tabindex', 'version-remove-id', 'about-content', 'about-modal']);
  assert.equal(menu.open, false);
  assert.match(markup, /<dialog id="aboutDialog" aria-label="About RCRD"><button type="button" class="about-dialog-close" id="aboutDialogClose" aria-label="Close About">×<\/button><div id="aboutDialogContent"><\/div><\/dialog>/);
  menu.open = true;
  let prevented = false;
  context.event = { key: 'Escape', preventDefault: () => { prevented = true; } };
  vm.runInContext('handleProfileMenuKeydown(event)', context);
  assert.equal(menu.open, false);
  assert.equal(prevented, true);
  assert.equal(events.at(-1), 'menu-focus');
  menu.open = true;
  context.event = { target: { closest: () => null } };
  vm.runInContext('handleProfileMenuClick(event)', context);
  assert.equal(menu.open, false);
});

test('mobile Settings avatar follows the account image and disconnected placeholder', () => {
  const h = harness();
  const source = h.node('#profileAvatar');
  const mobile = h.node('#profileAvatarMobile');
  let mobileHasImage = false, mobileHasPlaceholder = false;
  let sourceHasImage = true, sourceHasPlaceholder = false;
  source.classList = { contains: name => name === 'has-image' ? sourceHasImage : name === 'is-placeholder' && sourceHasPlaceholder };
  mobile.classList = { toggle: (name, value) => { if (name === 'has-image') mobileHasImage = value; else if (name === 'is-placeholder') mobileHasPlaceholder = value; } };
  source.style.backgroundImage = 'url("https://example.test/avatar.png")';
  source.textContent = '';
  h.load('syncMobileProfileAvatar');
  h.run('syncMobileProfileAvatar()');
  assert.equal(mobileHasImage, true);
  assert.equal(mobileHasPlaceholder, false);
  assert.equal(mobile.style.backgroundImage, source.style.backgroundImage);
  sourceHasImage = false;
  sourceHasPlaceholder = true;
  source.style.backgroundImage = '';
  source.textContent = '?';
  h.run('syncMobileProfileAvatar()');
  assert.equal(mobileHasImage, false);
  assert.equal(mobileHasPlaceholder, true);
  assert.equal(mobile.style.backgroundImage, '');
  assert.equal(mobile.textContent, '?');
});

test('disconnected profile placeholder yields to account initials and returns on sign-out', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ display_name: 'Synthetic Listener', followers: { total: 0 }, images: [] }) }));
  const avatar = h.node('#profileAvatar');
  const classes = new Set(['is-placeholder']);
  avatar.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  h.load('refreshSpotifyProfile', 'resetSpotifyAccountUi');
  await h.run('refreshSpotifyProfile()');
  assert.equal(avatar.textContent, 'SL');
  assert.equal(classes.has('is-placeholder'), false);
  h.run('resetSpotifyAccountUi()');
  assert.equal(avatar.textContent, '?');
  assert.equal(classes.has('is-placeholder'), true);
  assert.equal(classes.has('has-image'), false);
});

test('older server response requests a restart, not a needless Spotify reconnect', () => {
  const h = harness();
  h.run('renderSpotifyConnectionStatus({connected:true,daysRemaining:90})');
  assert.equal(h.node('#connectSpotify').textContent, 'Spotify connected');
  assert.match(h.node('#spotifyReminder').textContent, /Restart RCRD/);
  assert.doesNotMatch(h.node('#spotifyReminder').innerHTML, /data-spotify-authorize/);
});

test('disconnected Spotify presents only Connect and clears the permission notice', () => {
  const h = harness();
  h.run('renderSpotifyConnectionStatus({connected:false})');
  assert.equal(h.node('#connectSpotify').textContent, 'Connect Spotify');
  assert.equal(h.node('#settingsSpotifyStatus').textContent, 'Not connected');
  assert.equal(h.node('#settingsSpotifyReconnect').hidden, false);
  assert.equal(h.node('#settingsSpotifyDisconnect').hidden, true);
  assert.equal(h.node('#spotifyReminder').hidden, true);
});

test('failed status request does not claim that a connected Spotify account disconnected', async () => {
  const h = harness(async () => { throw new Error('Synthetic network failure'); }, { AbortController });
  h.load('refreshSpotifyStatus');
  h.node('#profileName').textContent='Synthetic connected account';
  h.node('#spotifyLibraryStatus').textContent='Checking connection…';
  h.node('#spotifyGrid').innerHTML='<p class="empty-state">Checking your Spotify connection…</p>';
  await h.run('refreshSpotifyStatus()');
  assert.equal(h.run('spotifyConnected'), true);
  assert.equal(h.node('#profileName').textContent, 'Synthetic connected account');
  assert.equal(h.node('#connectSpotify').textContent, 'Spotify status unavailable');
  assert.equal(h.node('#settingsSpotifyStatus').textContent, 'Unavailable');
  assert.equal(h.node('#settingsSpotifyReconnect').hidden, true);
  assert.equal(h.node('#settingsSpotifyDisconnect').hidden, true);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, 'Connection unavailable');
  assert.match(h.node('#spotifyGrid').innerHTML, /Could not check Spotify connection/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Checking your Spotify connection/);
});

test('stalled Spotify status check ends with a clear failure state and releases its timer', async () => {
  let deadline;
  let cleared = false;
  const h = harness((url, options) => {
    assert.equal(url, '/api/spotify/status');
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Synthetic abort'))));
  }, {
    AbortController,
    setTimeout: (callback, delay) => { deadline = { callback, delay }; return 4; },
    clearTimeout: id => { assert.equal(id, 4); cleared = true; }
  });
  h.load('refreshSpotifyStatus');
  h.node('#spotifyLibraryStatus').textContent='Checking connection…';
  const request = h.run('refreshSpotifyStatus()');
  assert.equal(deadline.delay, 10000);
  deadline.callback();
  await request;
  assert.equal(h.node('#spotifyLibraryStatus').textContent, 'Connection unavailable');
  assert.equal(h.node('#settingsSpotifyStatus').textContent, 'Unavailable');
  assert.equal(cleared, true);
});

test('connected status starts the player before background Spotify requests', async () => {
  const events = [];
  const h = harness(async url => {
    events.push(url);
    return { ok: true, json: async () => ({ connected: true, canModifyLibrary: true }) };
  }, {
    initSpotifyPlayer: () => { events.push('player'); },
    renderSpotifyLibrary() {}, renderHomeRecommendations() {},
    refreshSpotifyProfile: () => { events.push('profile'); },
    refreshSpotifyHome: () => { events.push('recent'); },
    refreshSpotifyPlaylists: () => { events.push('playlists'); },
    maybeLoadSpotifyLibrary: () => { events.push('library'); },
    renderPlayerLiked() {}, URLSearchParams, location: { search: '' }
  });
  h.load('refreshSpotifyStatus');
  await h.run('refreshSpotifyStatus()');
  assert.deepEqual(events, ['/api/spotify/status', 'player', 'profile', 'recent', 'playlists', 'library']);
  assert.match(markup, /<script defer src="https:\/\/sdk\.scdn\.co\/spotify-player\.js"><\/script>\s*<script src="app\.js"><\/script>/);
});

test('restored catalog scope never paints saved-library loading after Spotify connects', async () => {
  let libraryPaints = 0;
  const h = harness(async () => ({ ok: true, json: async () => ({ connected: true }) }), {
    initSpotifyPlayer() {}, renderSpotifyLibrary() { libraryPaints++; },
    renderHomeRecommendations() {}, refreshSpotifyProfile() {}, refreshSpotifyHome() {},
    refreshSpotifyPlaylists() {}, maybeLoadSpotifyLibrary() {}, renderPlayerLiked() {},
    URLSearchParams, location: { search: '' }
  });
  h.node('.active-view').id = 'spotify';
  h.run("spotifySearchMode='catalog'");
  h.load('searchSpotifyCatalog', 'refreshSpotifyStatus');
  await h.run('refreshSpotifyStatus()');
  assert.equal(libraryPaints, 0);
  assert.match(h.node('#spotifyGrid').innerHTML, /Search Spotify to find albums, tracks, artists, and playlists/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, 'Spotify catalog');
});

test('opening Saved Music with restored catalog scope shows its prompt once', () => {
  const searches = [];
  const h = harness(undefined, {
    uiPreferences: { spotifySearchScope: 'catalog' },
    allowedPreference: value => value,
    searchSpotifyCatalog(query) { searches.push(query); assert.equal(h.node('.active-view').id, 'spotify'); h.node('#spotifyGrid').innerHTML = '<p>Search Spotify to find albums and tracks.</p>'; h.node('#spotifyLibraryStatus').textContent = 'Spotify catalog'; }
  });
  const listeners = [];
  h.context.document.addEventListener = (type, listener) => { if (type === 'click') listeners.push(listener); };
  const options = ['library', 'catalog'].map(value => ({ dataset: { value }, textContent: value, setAttribute() {} }));
  h.context.document.querySelectorAll = selector => selector === '#spotifySearchScopeList [role="option"]' ? options : [];
  h.node('.active-view').id = 'home';
  h.node('#spotifyGrid').innerHTML = '<p class="empty-state">Checking your Spotify connection…</p>';
  h.node('#spotifyLibraryStatus').textContent = 'Checking connection…';
  h.load('setSpotifySearchScope');
  const navigation = source.split('\n').find(line => line.startsWith("document.addEventListener('click',event=>{if(!event.target.closest('[data-view=\"spotify\"]'))return;setSpotifySearchScope("));
  assert.ok(navigation);
  assert.ok(source.indexOf("document.addEventListener('click',e=>{const nav=e.target.closest('[data-view]')") < source.indexOf(navigation), 'the view switch runs before Saved Music renders');
  vm.runInContext(navigation, h.context);
  const click = { target: { closest: selector => selector === '[data-view="spotify"]' ? {} : null } };
  h.node('.active-view').id = 'spotify'; // The earlier document navigation listener has switched views.
  listeners[0](click);
  assert.deepEqual(searches, ['']);
  assert.equal(h.run('spotifySearchMode'), 'catalog');
  listeners[0](click);
  assert.deepEqual(searches, [''], 'returning to visible catalog results does not search again');
});

test('playlist preview paints before the full response and then becomes fully searchable', async () => {
  const preview = deferred();
  const full = deferred();
  const fullStarted = deferred();
  const calls = [];
  const h = harness(url => {
    calls.push(url);
    if (url.endsWith('&preview=1')) return preview.promise;
    fullStarted.resolve();
    return full.promise;
  }, { setSidebarPlaylistValue() {}, setSpotifySearchScope() {}, updateSearchContext() {} });
  h.load('renderSpotifyLibrary', 'spotifyPlaylistRecords', 'loadSpotifyPlaylist');
  const loading = h.run('loadSpotifyPlaylist("synthetic")');
  assert.match(h.node('#spotifyGrid').innerHTML, /Loading playlist/);
  preview.resolve({ ok: true, json: async () => ({ total: 80, tracks: [{ name: 'Preview track', artists: [{ name: 'Artist' }], album: { name: 'Album' }, uri: 'spotify:track:preview' }] }) });
  await fullStarted.promise;
  assert.match(h.node('#spotifyGrid').innerHTML, /Preview track/);
  assert.match(h.node('#spotifyLibraryStatus').textContent, /1 track from 80 playlist items.*loading full playlist/);
  assert.match(h.node('#spotifyLibraryNote').textContent, /Search and sort cover the preview/);
  assert.doesNotMatch(h.node('#spotifyLibraryNote').textContent, /unknown|updated/i);
  assert.deepEqual(calls, ['/api/spotify/playlist?id=synthetic&preview=1', '/api/spotify/playlist?id=synthetic']);
  h.node('#searchInput').value = 'Full track';
  full.resolve({ ok: true, json: async () => ({ tracks: [{ name: 'Preview track', album: { name: 'Album' } }, { name: 'Full track', album: { name: 'Album' } }] }) });
  await loading;
  assert.match(h.node('#spotifyGrid').innerHTML, /Full track/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Preview track/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 matching items');
  assert.doesNotMatch(h.node('#spotifyLibraryNote').textContent, /unknown|updated/i);
  assert.equal(h.run('spotifyPlaylistPreviewState'), null);
});

test('playlist preview failure falls back to the full result without claiming partial content', async () => {
  const calls = [];
  const h = harness(async url => {
    calls.push(url);
    return url.endsWith('&preview=1')
      ? { ok: false, json: async () => ({ error: 'Preview unavailable' }) }
      : { ok: true, json: async () => ({ tracks: [{ name: 'Full track', album: { name: 'Album' } }] }) };
  }, { setSidebarPlaylistValue() {}, setSpotifySearchScope() {}, updateSearchContext() {} });
  h.load('renderSpotifyLibrary', 'spotifyPlaylistRecords', 'loadSpotifyPlaylist');
  await h.run('loadSpotifyPlaylist("synthetic")');
  assert.equal(calls.length, 2);
  assert.match(h.node('#spotifyGrid').innerHTML, /Full track/);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '1 playlist tracks');
  assert.equal(h.run('spotifyPlaylistPreviewState'), null);
});

test('a stale cached playlist is visibly labeled with its last update', async () => {
  const updatedAt = Date.now() - 60000;
  const h = harness(async url => ({ ok: true, json: async () => ({ tracks: [{ name: 'Cached track', album: { name: 'Cached album' } }], ...(url.endsWith('&preview=1') ? { total: 1 } : {}), sync: { source: 'stale-cache', updatedAt } }) }), { setSidebarPlaylistValue() {}, setSpotifySearchScope() {}, updateSearchContext() {} });
  h.load('renderSpotifyLibrary', 'spotifyPlaylistRecords', 'loadSpotifyPlaylist');
  await h.run('loadSpotifyPlaylist("synthetic")');
  assert.match(h.node('#spotifyGrid').innerHTML, /Cached track/);
  assert.match(h.node('#spotifyLibraryNote').textContent, /Previously loaded data.*Spotify unavailable.*updated/);
});

test('a failed full playlist load keeps an honest preview and remains retryable', async () => {
  const toasts = [];
  const h = harness(async url => url.endsWith('&preview=1')
    ? { ok: true, json: async () => ({ total: 2, tracks: [{ name: 'Preview track', album: { name: 'Album' } }] }) }
    : { ok: false, json: async () => ({ error: 'Synthetic playlist failure' }) },
  { setSidebarPlaylistValue() {}, setSpotifySearchScope() {}, updateSearchContext() {}, showToast: message => toasts.push(message) });
  h.load('renderSpotifyLibrary', 'spotifyPlaylistRecords', 'loadSpotifyPlaylist');
  await h.run('loadSpotifyPlaylist("synthetic")');
  assert.match(h.node('#spotifyGrid').innerHTML, /Preview track/);
  assert.match(h.node('#spotifyLibraryStatus').textContent, /preview only/);
  assert.match(h.node('#spotifyLibraryNote').textContent, /Select this playlist again to retry/);
  assert.deepEqual(toasts, ['Synthetic playlist failure']);
});

test('switching playlist or disconnecting invalidates preview and full responses', async () => {
  const oldPreview = deferred();
  const oldFull = deferred();
  const newPreview = deferred();
  const newFull = deferred();
  const newFullStarted = deferred();
  const h = harness(url => {
    const isOld = url.includes('id=old');
    if (!isOld && !url.endsWith('&preview=1')) newFullStarted.resolve();
    return (isOld ? url.endsWith('&preview=1') ? oldPreview : oldFull : url.endsWith('&preview=1') ? newPreview : newFull).promise;
  }, { setSidebarPlaylistValue() {}, setSpotifySearchScope() {}, updateSearchContext() {} });
  h.load('renderSpotifyLibrary', 'spotifyPlaylistRecords', 'loadSpotifyPlaylist', 'resetSpotifyAccountUi');
  const oldRequest = h.run('loadSpotifyPlaylist("old")');
  const newRequest = h.run('loadSpotifyPlaylist("new")');
  oldPreview.resolve({ ok: true, json: async () => ({ total: 1, tracks: [{ name: 'Old private track' }] }) });
  await oldRequest;
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Old private track/);
  newPreview.resolve({ ok: true, json: async () => ({ total: 1, tracks: [{ name: 'New track' }] }) });
  await newFullStarted.promise;
  assert.match(h.node('#spotifyGrid').innerHTML, /New track/);
  h.run('resetSpotifyAccountUi()');
  newFull.resolve({ ok: true, json: async () => ({ tracks: [{ name: 'Stale full track' }] }) });
  await newRequest;
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Old private track|New track|Stale full track/);
});

test('selecting a playlist does not eagerly load saved music, but returning to Saved library does', async () => {
  const calls = [];
  const h = harness(async url => {
    calls.push(url);
    return { ok: true, json: async () => ({ saved: [], savedAlbums: [] }) };
  }, { setSidebarPlaylistValue() {}, setSpotifySearchScope() {}, updateSearchContext() {} });
  h.node('.active-view').id = 'spotify';
  h.node('#spotifyPlaylistSelect').value = 'synthetic';
  h.load('maybeLoadSpotifyLibrary', 'renderSpotifyLibrary', 'refreshSpotifyLibrary', 'spotifyPlaylistRecords', 'loadSpotifyPlaylist');
  h.run('maybeLoadSpotifyLibrary()');
  assert.deepEqual(calls, []);
  await h.run('loadSpotifyPlaylist("")');
  await h.run('spotifyLibraryPromise');
  assert.deepEqual(calls, ['/api/spotify/library']);
  assert.equal(h.run('spotifySavedLibraryLoaded'), true);
  assert.equal(h.node('#spotifyLibraryStatus').textContent, '0 saved items');
});

test('catalog scope notice auto-hides without hiding a later saved-library notice', () => {
  const timers = [];
  const h = harness(undefined, { setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; } });
  const options = ['library', 'catalog'].map((value, index) => ({ dataset: { value }, textContent: index ? 'Entire Spotify catalog' : 'Saved library', setAttribute() {} }));
  h.context.document.querySelectorAll = selector => selector === '#spotifySearchScopeList [role="option"]' ? options : [];
  h.load('setSpotifySearchScope');
  h.run("setSpotifySearchScope('catalog')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  assert.equal(timers[0].delay, 4000);
  timers[0].callback();
  assert.equal(h.node('#spotifyScopeNotice').hidden, true);
  h.run("showSpotifyLibraryNotice('Synthetic background sync')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  timers[1].callback();
  assert.equal(h.node('#spotifyScopeNotice').hidden, true);
  h.run("setSpotifySearchScope('catalog')");
  h.run("setSpotifySearchScope('library')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  timers[2].callback();
  assert.equal(h.node('#spotifyScopeNotice').hidden, false, 'an old catalog timer cannot hide the library notice');
});

test('returning from catalog settles a successful saved-library notice but keeps errors visible', () => {
  const timers = [];
  const h = harness(undefined, { setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; } });
  const options = ['library', 'catalog'].map((value, index) => ({ dataset: { value }, textContent: index ? 'Entire Spotify catalog' : 'Saved library', setAttribute() {} }));
  h.context.document.querySelectorAll = selector => selector === '#spotifySearchScopeList [role="option"]' ? options : [];
  h.load('setSpotifySearchScope');
  h.run("spotifySavedLibraryLoaded=true;spotifyLibraryLoaded=true;spotifyLibraryLastUpdatedGeneration=spotifyAccountGeneration;spotifyLibraryLastUpdated=1700000000000;spotifyLibrarySyncSource='cached'");
  h.run('showSpotifyLibraryNotice(savedLibraryFreshnessNote())');
  h.run("setSpotifySearchScope('catalog')");
  h.run("setSpotifySearchScope('library')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  assert.equal(timers.at(-1).delay, 4000);
  timers.at(-1).callback();
  assert.equal(h.node('#spotifyScopeNotice').hidden, true);
  assert.match(h.node('#spotifyCacheMeta').textContent, /^Updated /);
  assert.equal(h.node('#spotifyCacheMeta').hidden, false);

  h.run('showSpotifyLibraryNotice(savedLibraryFreshnessNote())');
  h.run("setSpotifySearchScope('library')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  timers.at(-1).callback();
  assert.equal(h.node('#spotifyScopeNotice').hidden, true);

  h.run("setSpotifySearchScope('catalog')");
  h.run("spotifyLibraryError='Synthetic failure';showSpotifyLibraryNotice('Spotify unavailable')");
  const timerCount = timers.length;
  h.run("setSpotifySearchScope('library')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  assert.equal(h.node('#spotifyLibraryNote').textContent, 'Spotify unavailable');
  assert.equal(timers.length, timerCount, 'an error is not scheduled to disappear');

  h.run("spotifyLibraryError='';spotifyLibrarySyncSource='stale-cache';setSpotifySearchScope('catalog');showSpotifyLibraryNotice('Previously loaded data · Spotify unavailable')");
  const staleTimerCount = timers.length;
  h.run("setSpotifySearchScope('library')");
  assert.equal(h.node('#spotifyScopeNotice').hidden, false);
  assert.match(h.node('#spotifyLibraryNote').textContent, /Previously loaded data/);
  assert.equal(timers.length, staleTimerCount, 'stale-data warning is not scheduled to disappear');
});

test('switching Spotify search scope restores the library note and ignores an older catalog result', async () => {
  assert.match(markup, /id="spotifyScopeNoteTitle"/);
  assert.match(markup, /id="spotifyCatalogNote" hidden/);
  const pendingCatalog = deferred();
  let runCatalogSearch;
  const h = harness(() => pendingCatalog.promise, { setTimeout: callback => { runCatalogSearch = callback; return 1; } });
  const options = ['library', 'catalog'].map((value, index) => ({ dataset: { value }, textContent: index ? 'Entire Spotify catalog' : 'Saved library', setAttribute() {} }));
  h.context.document.querySelectorAll = selector => selector === '#spotifySearchScopeList [role="option"]' ? options : [];
  h.node('.active-view').id = 'spotify';
  h.node('#spotifyLibraryNote').textContent = 'Showing 1 album from your saved library.';
  h.run("spotifySearchMode='library';spotifyLibraryLoaded=true;spotifyLibraryAlbums=[{title:'Synthetic saved album',artist:'Synthetic artist'}]");
  h.load('renderSpotifyLibrary', 'setSpotifySearchScope', 'searchSpotifyCatalog');
  h.run("setSpotifySearchScope('catalog');searchSpotifyCatalog('')");
  assert.equal(h.node('#spotifyScopeNoteTitle').textContent, 'Entire Spotify catalog');
  assert.equal(h.node('#spotifyCatalogNote').hidden, false);
  assert.equal(h.node('#spotifyLibraryNote').hidden, true);
  assert.equal(h.node('#spotifyCatalogNote').textContent, 'Search results come from the full Spotify catalog.');
  assert.equal(h.node('#spotifyLibraryNote').textContent, 'Showing 1 album from your saved library.');

  h.run("searchSpotifyCatalog('synthetic query')");
  const oldSearch = runCatalogSearch();
  h.run("setSpotifySearchScope('library');renderSpotifyLibrary('')");
  assert.equal(h.node('#spotifyScopeNoteTitle').textContent, 'Saved library');
  assert.equal(h.node('#spotifyLibraryNote').hidden, false);
  assert.equal(h.node('#spotifyCatalogNote').hidden, true);
  pendingCatalog.resolve({ ok: true, json: async () => ({ albums: { total: 1, items: [{ name: 'Old catalog result', type: 'album' }] } }) });
  await oldSearch;
  assert.match(h.node('#spotifyGrid').innerHTML, /Synthetic saved album/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Old catalog result/);
  assert.equal(h.node('#spotifyLibraryNote').textContent, 'Showing 1 album from your saved library.');
});

test('saved library sync updates its hidden note without replacing catalog results', async () => {
  const pendingLibrary = deferred();
  const h = harness(() => pendingLibrary.promise);
  const options = ['library', 'catalog'].map((value, index) => ({ dataset: { value }, textContent: index ? 'Entire Spotify catalog' : 'Saved library', setAttribute() {} }));
  h.context.document.querySelectorAll = selector => selector === '#spotifySearchScopeList [role="option"]' ? options : [];
  h.node('.active-view').id = 'spotify';
  h.run("spotifySearchMode='library'");
  h.load('renderSpotifyLibrary', 'setSpotifySearchScope', 'refreshSpotifyLibrary');
  h.run("setSpotifySearchScope('catalog')");
  h.node('#spotifyGrid').innerHTML = '<p>Catalog search prompt</p>';
  const loading = h.run('refreshSpotifyLibrary()');
  assert.match(h.node('#spotifyGrid').innerHTML, /Catalog search prompt/);
  pendingLibrary.resolve({ ok: true, json: async () => ({ saved: [], savedAlbums: [{ album: { id: 'synthetic-album', name: 'Fresh saved album', artists: [{ name: 'Synthetic artist' }] } }] }) });
  await loading;
  assert.match(h.node('#spotifyGrid').innerHTML, /Catalog search prompt/);
  assert.equal(h.node('#spotifyLibraryNote').textContent, 'Saved library ready.');
  h.run("setSpotifySearchScope('library');renderSpotifyLibrary('')");
  assert.match(h.node('#spotifyGrid').innerHTML, /Fresh saved album/);
  assert.equal(h.node('#spotifyLibraryNote').hidden, false);
});

test('Spotify profile response arriving after Disconnect cannot restore account details', async () => {
  const old = deferred();
  const h = harness(() => old.promise);
  h.load('refreshSpotifyProfile', 'resetSpotifyAccountUi');
  const request = h.run('refreshSpotifyProfile()');
  h.run('resetSpotifyAccountUi()');
  old.resolve({ ok: true, json: async () => ({ display_name: 'Previous account', followers: { total: 2 } }) });
  await request;
  assert.equal(h.node('#profileName').textContent, 'Connect account');
  assert.equal(h.node('#profileMeta').textContent, 'Spotify profile');
  assert.equal(h.run('spotifyConnected'), false);
});

test('old Spotify library completion cannot overwrite a newly connected account or clear its request', async () => {
  const old = deferred();
  const next = deferred();
  let calls = 0;
  const h = harness(() => (++calls === 1 ? old : next).promise);
  h.load('renderSpotifyLibrary', 'refreshSpotifyLibrary', 'resetSpotifyAccountUi');
  const oldRequest = h.run('refreshSpotifyLibrary()');
  h.run('resetSpotifyAccountUi()');
  h.run('spotifyConnected=true');
  const nextRequest = h.run('refreshSpotifyLibrary()');
  old.resolve({ ok: true, json: async () => ({ savedAlbums: [{ album: { id: 'old', name: 'Old private album' } }] }) });
  await oldRequest;
  assert.notEqual(h.run('spotifyLibraryPromise'), null);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Old private album/);
  next.resolve({ ok: true, json: async () => ({ savedAlbums: [{ album: { id: 'next', name: 'New account album' } }] }) });
  await nextRequest;
  assert.match(h.node('#spotifyGrid').innerHTML, /New account album/);
  assert.doesNotMatch(h.node('#spotifyGrid').innerHTML, /Old private album/);
});

test('old Spotify playlist and current track responses cannot repaint after Disconnect', async () => {
  const playlist = deferred();
  const track = deferred();
  const h = harness(url => url.includes('playlists') ? playlist.promise : track.promise);
  h.load('refreshSpotifyPlaylists', 'syncCurrentSpotifyTrack', 'resetSpotifyAccountUi');
  const playlistRequest = h.run('refreshSpotifyPlaylists()');
  const trackRequest = h.run('syncCurrentSpotifyTrack()');
  h.run('resetSpotifyAccountUi()');
  playlist.resolve({ ok: true, json: async () => ({ playlists: [{ id: 'old', name: 'Old playlist', tracksTotal: 1 }] }) });
  track.resolve({ ok: true, json: async () => ({ item: { name: 'Old private track' }, is_playing: true }) });
  await Promise.all([playlistRequest, trackRequest]);
  assert.equal(h.node('#spotifyPlaylistSelect').disabled, true);
  assert.doesNotMatch(h.node('#spotifyPlaylistSelect').innerHTML, /Old playlist/);
  assert.equal(h.run('spotifyTrackUri'), null);
});

test('old Spotify status cannot reconnect the UI after Disconnect', async () => {
  const old = deferred();
  const h = harness(() => old.promise);
  h.load('refreshSpotifyStatus', 'resetSpotifyAccountUi');
  const request = h.run('refreshSpotifyStatus()');
  h.run('resetSpotifyAccountUi()');
  old.resolve({ ok: true, json: async () => ({ connected: true, daysRemaining: 20 }) });
  await request;
  assert.equal(h.run('spotifyConnected'), false);
  assert.equal(h.node('#connectSpotify').textContent, 'Connect Spotify');
});

test('old Discogs collection response cannot restore releases after Disconnect', async () => {
  const old = deferred();
  const h = harness(() => old.promise, { fetchDiscogsSection: () => old.promise });
  h.run(`function renderCollection(){document.querySelector('#collectionGrid').innerHTML=collection.map(record=>record.title).join(',')}
    function renderWantlist(){document.querySelector('#wantlistGrid').innerHTML=wantlist.map(record=>record.title).join(',')}`);
  h.load('normalizeDiscogsRecord', 'refreshDiscogsSection', 'resetDiscogsAccountUi');
  const request = h.run("refreshDiscogsSection('collection')");
  h.run('resetDiscogsAccountUi()');
  old.resolve({ releases: [{ basic_information: { title: 'Old private record' } }] });
  await request;
  assert.equal(h.run('apiConnected'), false);
  assert.equal(h.node('#collectionGrid').innerHTML, '');
  assert.equal(h.node('#collectionCount').textContent, '0');
});

test('old Discogs session response cannot reconnect the UI after Disconnect', async () => {
  const old = deferred();
  const h = harness(() => old.promise);
  h.run('function renderCollection(){} function renderWantlist(){}');
  h.load('refreshDiscogsSession', 'resetDiscogsAccountUi');
  const request = h.run('refreshDiscogsSession()');
  h.run('resetDiscogsAccountUi()');
  old.resolve({ ok: true, json: async () => ({ connected: true }) });
  await request;
  assert.equal(h.run('apiConnected'), false);
  assert.equal(h.node('#connectDiscogs').textContent, 'Connect Discogs');
});

test('Discogs typing requests only the settled query while explicit searches stay immediate', async () => {
  const timers = new Map();
  const requests = [];
  const renders = [];
  let nextTimer = 0;
  const h = harness(async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ results: [{ title: url }], pagination: {} }) };
  }, {
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    collectDiscogsFilters: () => ({}),
    renderApiResults: results => renders.push(results[0]?.title)
  });
  h.load('renderCatalogPrompt', 'searchDiscogsApi', 'queueDiscogsSearch');
  h.run('queueDiscogsSearch("r");queueDiscogsSearch("record")');
  assert.equal(requests.length, 0);
  assert.equal(timers.size, 1);
  await [...timers.values()][0]();
  assert.equal(requests.length, 1);
  assert.match(requests[0], /q=record/);
  assert.equal(renders.length, 1);

  h.run('queueDiscogsSearch("pending")');
  await h.run('searchDiscogsApi("explicit")');
  assert.equal(timers.size, 0, 'an explicit search cancels pending typing');
  assert.match(requests.at(-1), /q=explicit/);
  h.run('queueDiscogsSearch("   ")');
  assert.equal(timers.size, 0, 'clearing the field needs no provider request');
  assert.equal(requests.length, 2);
  assert.match(h.node('#marketGrid').innerHTML, /Search for an artist/);
});

test('a new Discogs query prevents an older response from repainting results', async () => {
  const old = deferred();
  const timers = new Map();
  const rendered = [];
  const h = harness(url => url.includes('q=old') ? old.promise : Promise.resolve({ ok: true, json: async () => ({ results: [{ title: 'New result' }] }) }), {
    setTimeout: callback => { timers.set(1, callback); return 1; },
    clearTimeout: id => timers.delete(id),
    collectDiscogsFilters: () => ({}),
    renderApiResults: results => rendered.push(results[0]?.title)
  });
  h.load('renderCatalogPrompt', 'searchDiscogsApi', 'queueDiscogsSearch');
  const stale = h.run('searchDiscogsApi("old")');
  h.run('queueDiscogsSearch("new")');
  old.resolve({ ok: true, json: async () => ({ results: [{ title: 'Old result' }] }) });
  await stale;
  assert.equal(rendered.length, 0);
  await timers.get(1)();
  assert.deepEqual(rendered, ['New result']);
});

test('Discogs list navigation reuses fresh results and in-flight work, while a write forces that list only', async () => {
  const first = deferred();
  const requested = [];
  let collectionCalls = 0;
  const h = harness(async (url, options) => {
    requested.push(url);
    if(options?.method === 'POST')return { ok: true, json: async () => ({ ok: true }) };
    return { ok: true, json: async () => ({}) };
  }, {
    fetchDiscogsSection: path => {
      requested.push(path);
      if(path === '/api/collection' && ++collectionCalls === 1)return first.promise;
      return Promise.resolve({ releases: [{ basic_information: { title: `Fresh ${path}` } }] });
    }
  });
  h.run(`function renderCollection(){document.querySelector('#collectionGrid').innerHTML=collection.map(record=>record.title).join(',')}
    function renderWantlist(){document.querySelector('#wantlistGrid').innerHTML=wantlist.map(record=>record.title).join(',')}`);
  h.load('normalizeDiscogsRecord', 'refreshDiscogsSection', 'addApiRecord');
  const loading = h.run("refreshDiscogsSection('collection')");
  const same = h.run("refreshDiscogsSection('collection')");
  assert.equal(collectionCalls, 1, 'two navigations share the first list request');
  first.resolve({ releases: [{ basic_information: { title: 'Original record' } }] });
  await Promise.all([loading, same]);
  assert.match(h.node('#collectionCacheMeta').textContent, /^Updated /);
  assert.doesNotMatch(h.node('#collectionCacheMeta').textContent, /Live sync|Cached copy/);
  await h.run("refreshDiscogsSection('collection')");
  assert.equal(collectionCalls, 1, 'a fresh list is rendered from memory');
  assert.match(h.node('#collectionCacheMeta').textContent, /^Updated /);
  assert.doesNotMatch(h.node('#collectionCacheMeta').textContent, /Live sync|Cached copy/);

  await h.run('addApiRecord({disabled:false,textContent:"",dataset:{releaseId:"1"}},"collection")');
  assert.equal(collectionCalls, 2, 'the changed list is fetched after a successful write');
  assert.equal(requested.filter(path => path === '/api/wantlist').length, 0, 'the other list is not fetched');
  assert.match(h.node('#collectionGrid').innerHTML, /Fresh \/api\/collection/);
  h.run('discogsLoadedAt.collection=Date.now()-DISCOGS_LIST_FRESH_MS-1');
  await h.run("refreshDiscogsSection('collection')");
  assert.equal(collectionCalls, 3, 'expired data is fetched again');
});

test('forced Discogs refresh and Disconnect discard older list responses and cached state', async () => {
  const old = deferred();
  const fresh = deferred();
  let calls = 0;
  const h = harness(undefined, { fetchDiscogsSection: () => ++calls === 1 ? old.promise : fresh.promise });
  h.run(`function renderCollection(){document.querySelector('#collectionGrid').innerHTML=collection.map(record=>record.title).join(',')}
    function renderWantlist(){}`);
  h.load('normalizeDiscogsRecord', 'refreshDiscogsSection', 'resetDiscogsAccountUi');
  const stale = h.run("refreshDiscogsSection('collection')");
  const current = h.run("refreshDiscogsSection('collection',true)");
  old.resolve({ releases: [{ basic_information: { title: 'Old record' } }] });
  await stale;
  assert.doesNotMatch(h.node('#collectionGrid').innerHTML, /Old record/);
  fresh.resolve({ releases: [{ basic_information: { title: 'Current record' } }] });
  await current;
  assert.match(h.node('#collectionGrid').innerHTML, /Current record/);
  h.run('resetDiscogsAccountUi()');
  assert.equal(h.run('discogsLoadedAt.collection'), 0);
  assert.doesNotMatch(h.node('#collectionGrid').innerHTML, /Current record/);
});

test('a failed Discogs list load stays retryable instead of being cached', async () => {
  let calls = 0;
  const h = harness(undefined, {
    fetchDiscogsSection: async () => {
      if(++calls === 1)throw new Error('Synthetic provider unavailable');
      return { releases: [{ basic_information: { title: 'Recovered record' } }] };
    }
  });
  h.run(`function renderCollection(){document.querySelector('#collectionGrid').innerHTML=collection.map(record=>record.title).join(',')}`);
  h.load('normalizeDiscogsRecord', 'refreshDiscogsSection');
  await h.run("refreshDiscogsSection('collection')");
  assert.equal(h.run('discogsLoadedAt.collection'), 0);
  await h.run("refreshDiscogsSection('collection')");
  assert.equal(calls, 2);
  assert.match(h.node('#collectionGrid').innerHTML, /Recovered record/);
});

test('Discogs keeps loaded records and labels them stale after a failed refresh', async () => {
  let calls = 0;
  const h = harness(undefined, { fetchDiscogsSection: async () => {
    if (++calls === 2) throw new Error('Synthetic provider unavailable');
    return { releases: [{ basic_information: { title: 'Saved record' } }] };
  } });
  h.run("function renderCollection(){document.querySelector('#collectionGrid').innerHTML=collection.map(record=>record.title).join(',')}");
  h.load('normalizeDiscogsRecord', 'refreshDiscogsSection');
  await h.run("refreshDiscogsSection('collection')");
  await h.run("refreshDiscogsSection('collection',true)");
  assert.match(h.node('#collectionGrid').innerHTML, /Saved record/);
  assert.match(h.node('#collection .page-heading h1 span').textContent, /Discogs unavailable/);
  assert.match(h.node('#collectionCacheMeta').textContent, /Updated .* · May be outdated/);
  await h.run("refreshDiscogsSection('collection')");
  assert.equal(calls, 2);
  assert.match(h.node('#collectionCacheMeta').textContent, /May be outdated/);
});

test('Spotify progress reports counts and stale snapshots show their last update', async () => {
  const updatedAt = Date.now() - 60000;
  const h = harness(async url => url === '/api/spotify/library-progress'
    ? { ok: true, json: async () => ({ active: true, phase: 'tracks', tracks: { loaded: 50, total: 120 } }) }
    : { ok: true, json: async () => ({ saved: [], savedAlbums: [], recentlyPlayed: [], sync: { source: 'stale-cache', updatedAt } }) });
  h.load('pollSpotifyLibraryProgress', 'renderSpotifyLibrary', 'refreshSpotifyLibrary');
  await h.run('pollSpotifyLibraryProgress(0,0)');
  assert.match(h.node('#spotifyLibraryNote').textContent, /50 of 120 tracks loaded/);
  await h.run('refreshSpotifyLibrary()');
  assert.match(h.node('#spotifyLibraryNote').textContent, /Previously loaded data.*Spotify unavailable.*updated/);
});

test('shelf discovery distinguishes exact Discogs editions from possible album matches', () => {
  const h = harness(undefined, { discogsWebUrl: () => 'https://www.discogs.com/release/42', cover: () => '<div class="cover"></div>' });
  h.run("let discogsSearchSort='relevance'; collection=[{source:'discogs',releaseId:42,title:'A Record',artist:'Example Artist'}]; wantlist=[{source:'discogs',releaseId:99,title:'A Record',artist:'Example Artist'}]");
  h.load('shelfMatchKey', 'shelfMatch', 'shelfBadges', 'renderPressingCompareSelection', 'renderApiResults', 'spotifyAlbumCard', 'spotifySearchCard');
  assert.equal(h.run("shelfMatch('A Record','Example Artist',42).collection"), 'exact');
  assert.equal(h.run("shelfMatch('A Record','Example Artist',43).collection"), 'possible');
  h.run("renderApiResults([{id:42,title:'Example Artist - A Record',year:2020,format:['Vinyl']}])");
  assert.doesNotMatch(h.node('#marketGrid').innerHTML, /Discogs catalog/);
  assert.match(h.node('#marketGrid').innerHTML, /In collection/);
  assert.match(h.node('#marketGrid').innerHTML, /<div class="shelf-badges">/);
  assert.match(h.node('#marketGrid').innerHTML, /<span class="shelf-badge possible"[^>]*>Album in wantlist<\/span>/);
  assert.match(h.node('#marketGrid').innerHTML, /class="api-collection"[^>]*disabled/);
  const album = h.run("spotifyAlbumCard({title:'A Record',artist:'Example Artist',year:'2020',format:'Spotify album'})");
  assert.match(album, /Album in collection/);
  assert.equal((album.match(/Album in collection/g)||[]).length,1);
  assert.match(album,/class="spotify-collection-status shelf-badge possible"/);
  assert.doesNotMatch(album,/class="spotify-discogs"/);
  assert.match(album, /exact Discogs edition is not confirmed/, 'short badge retains the pressing caveat');
  assert.doesNotMatch(album, /In collection/);
  const lookup = h.run("spotifySearchCard({type:'album',name:'A Record',artists:[{name:'Example Artist'}]},'album',true)");
  assert.equal((lookup.match(/Album in collection/g) || []).length, 1, 'collection lookup places one status in the action slot');
  assert.match(lookup, /class="spotify-collection-status shelf-badge possible"/);
  assert.doesNotMatch(lookup, /class="spotify-discogs"/);
  assert.match(lookup, /exact Discogs edition is not confirmed/, 'album match does not claim the pressing is owned');
  const unowned = h.run("spotifySearchCard({type:'album',name:'Another Record',artists:[{name:'Example Artist'}]},'album',true)");
  assert.match(unowned, /class="spotify-discogs"/);
  assert.doesNotMatch(unowned, /spotify-collection-status/);
  const track = h.run("spotifySearchCard({type:'track',name:'Different song',artists:[{name:'Example Artist'}],album:{name:'A Record',artists:[{name:'Example Artist'}]}},'track')");
  assert.match(track, /Album in collection/, 'track results match their album, not the song title');
  assert.match(track, /<h3>Different song<\/h3>/);
  assert.match(track, /class="album-card has-album-column"/);
  assert.match(track, /<div class="album-name"><span>Album<\/span><strong title="A Record">A Record<\/strong><\/div>/);
  assert.match(track, /<h3>Different song<\/h3>[\s\S]*<div class="album-name">/, 'song title stays in the primary column before the separate album field');
  assert.doesNotMatch(album, /class="album-name"/, 'album rows already identify the album in their title');
  assert.doesNotMatch(track,/class="spotify-discogs"/,'owned album replaces the track Discogs action');
  const unownedTrack=h.run("spotifySearchCard({type:'track',name:'Different song',artists:[{name:'Example Artist'}],album:{name:'Another Record',artists:[{name:'Example Artist'}]}},'track')");
  assert.match(unownedTrack,/class="spotify-discogs" data-title="Another Record" data-artist="Example Artist"/,'unowned track action searches its album');
  const saved=h.run("spotifyAlbumCard({title:'Song',artist:'Example Artist',kind:'track',matchTitle:'A Record',album:'A Record',showPlayCount:true})");
  assert.match(saved,/<div class="spotify-discogs-actions"><div class="shelf-badges">[\s\S]*Album in wantlist[\s\S]*<span class="spotify-collection-status/,'wanted and owned status share the action slot');
  assert.doesNotMatch(saved,/<div class="shelf-badges">[\s\S]*class="spotify-play-result"/,'badges no longer precede Play in Saved music');
  for(const format of ['Recently played on Spotify','Long-term Spotify favorite']){
    h.context.syntheticFormat=format;
    const listening=h.run("spotifyAlbumCard({title:'A Record',artist:'Example Artist',format:syntheticFormat,uri:'spotify:album:'+ 'A'.repeat(22)})");
    assert.equal((listening.match(/Album in collection/g)||[]).length,1);
    assert.doesNotMatch(listening,/class="spotify-discogs"/);
  }
  h.run('apiConnected=false');
  assert.equal(h.run("shelfMatch('A Record','Example Artist',42).collection"), '');
});

test('pressing comparison requests details only after two or three editions are selected', async () => {
  const calls = [];
  const h = harness(async url => {
    calls.push(url);
    const id = Number(url.split('/').pop());
    return { ok: true, json: async () => ({ id, title: `Edition ${id}`, artists: ['Synthetic Artist'], year: 2020, country: 'US', formats: [{ name: 'Vinyl', quantity: '1', descriptions: ['LP'] }], labels: [{ name: 'Test Label', catalogNumber: `CAT-${id}` }], identifiers: [], trackCount: 10 }) };
  });
  const dialog = h.node('#pressingCompareDialog');
  dialog.showModal = () => { dialog.open = true; };
  h.load('pressingCompareField', 'pressingCompareCard', 'openPressingCompare');
  h.run('pressingCompareSelected.set(42,true);pressingCompareSelected.set(43,true)');
  assert.equal(calls.length, 0);
  await h.run('openPressingCompare()');
  assert.deepEqual(calls, ['/api/discogs/releases/42', '/api/discogs/releases/43']);
  assert.match(h.node('#pressingCompareDetails').innerHTML, /CAT-42/);
  assert.match(h.node('#pressingCompareDetails').innerHTML, /CAT-43/);
  h.run('pressingCompareSelected.clear()');
  await h.run('openPressingCompare()');
  assert.equal(calls.length, 2, 'comparison with fewer than two editions sends no request');
});

test('comparison tray stays outside the clipped main area and its actions respond to clicks', () => {
  const mainEnd = markup.indexOf('</main>');
  const trayPosition = markup.indexOf('id="pressingCompareTray"');
  const playerPosition = markup.indexOf('id="player"', mainEnd);
  assert.ok(mainEnd < trayPosition && trayPosition < playerPosition, 'fixed comparison tray is a top-level overlay');

  const calls = [];
  const h = harness(async url => {
    calls.push(url);
    const id = Number(url.split('/').pop());
    return { ok: true, json: async () => ({ id, title: `Edition ${id}`, artists: ['Synthetic Artist'], formats: [], labels: [], identifiers: [] }) };
  });
  h.node('.active-view').id = 'market';
  const dialog = h.node('#pressingCompareDialog');
  dialog.showModal = () => { dialog.open = true; };
  h.load('renderPressingCompareSelection', 'pressingCompareField', 'pressingCompareCard', 'openPressingCompare');
  h.run('pressingCompareSelected.set(42,true);pressingCompareSelected.set(43,true);renderPressingCompareSelection()');
  assert.equal(h.node('#pressingCompareTray').hidden, false);
  assert.equal(h.node('#pressingCompareOpen').disabled, false);

  let click;
  h.context.document.addEventListener = (type, listener) => { if (type === 'click') click = listener; };
  const comparisonClickHandler = source.split('\n').find(line => line.startsWith("document.addEventListener('click',event=>{const nav=event.target.closest('[data-view]')"));
  assert.ok(comparisonClickHandler, 'comparison click handler exists');
  vm.runInContext(comparisonClickHandler, h.context);
  const target = selector => ({ closest: query => query === selector ? {} : null });
  click({ target: target('#pressingCompareOpen') });
  assert.equal(dialog.open, true);
  assert.deepEqual(calls, ['/api/discogs/releases/42', '/api/discogs/releases/43']);
  click({ target: target('#pressingCompareClear') });
  assert.equal(h.node('#pressingCompareTray').hidden, true);
  assert.equal(h.run('pressingCompareSelected.size'), 0);
});

test('catalog Grid/List switches layout without replacing results or making another API request', () => {
  let libraryRenders = 0;
  const grid = { innerHTML: '<article>Catalog result</article>', classList: { toggle(name, value) { grid.listView = name === 'list-view' && value; } } };
  const button = { dataset: { layout: 'list' }, addEventListener: (_, listener) => { button.click = listener; }, classList: { toggle() {} } };
  const context = vm.createContext({
    document: { querySelectorAll: () => [button], querySelector: () => grid },
    renderSpotifyLibrary: () => { libraryRenders++; }
  });
  vm.runInContext("let spotifySearchMode='catalog',spotifyLibraryMode='grid';", context);
  const handler = source.match(/document\.querySelectorAll\('\.library-layout'\)\.forEach\(button=>button\.addEventListener\('click',\(\)=>\{spotifyLibraryMode=[\s\S]*?\}\)\);/);
  assert.ok(handler);
  vm.runInContext(handler[0], context);
  button.click();
  assert.equal(grid.listView, true);
  assert.equal(grid.innerHTML, '<article>Catalog result</article>');
  assert.equal(libraryRenders, 0);
});

test('stored records require a renderable shape; storage write failures leave the UI usable', () => {
  const fallback = [{ title: 'Fallback' }];
  let saved = '{}';
  const storage = {
    getItem: () => saved,
    setItem() { throw new Error('Synthetic quota exceeded'); }
  };
  const toasts = [];
  const h = harness(undefined, { localStorage: storage, showToast: message => toasts.push(message) });
  h.load('loadRecords', 'persist', 'saveUiPreference');
  h.context.fallback = fallback;
  h.run('let storageWarningShown=false;const uiPreferences={volume:50};collection=[{title:"A"}];let localCollection=[{title:"A"}],localWantlist=[]');
  assert.equal(h.run('loadRecords("records", fallback)'), fallback);
  saved = JSON.stringify([{ title: 'Untrusted', artist: 'Artist', tone: '#fff" onmouseover="x', accent: '#123456', word: 'A', format: 'Vinyl' }]);
  assert.equal(h.run('loadRecords("records", fallback)'), fallback);
  saved = JSON.stringify([{ title: 'Stored', artist: 'Artist', tone: '#123456', accent: '#abcdef', word: 'A', format: 'Vinyl' }]);
  assert.equal(h.run('loadRecords("records", fallback)')[0].title, 'Stored');
  assert.doesNotThrow(() => h.run('persist()'));
  assert.equal(h.node('#collectionCount').textContent, 1);
  assert.equal(h.node('#wantCount').textContent, 0);
  assert.equal(toasts.length, 1);
  h.run('persist()');
  assert.equal(toasts.length, 1);
  h.run('storageWarningShown=false;saveUiPreference("volume",75)');
  assert.equal(toasts.length, 2);
});

test('active album cards escape text and attributes before building markup', () => {
  const context = vm.createContext({ URL, shelfMatch: () => ({}), shelfBadges: () => '', spotifyPlayCounts: new Map() });
  for (const name of ['escapeHtml', 'safeImageUrl', 'cover', 'artistSearchButton', 'playCountText', 'playCountTitle', 'spotifyAlbumCard']) vm.runInContext(definition(name), context);
  const coverHtml = vm.runInContext("cover({tone:'#123456',accent:'#abcdef',word:'<svg onload=1>'})", context);
  assert.doesNotMatch(coverHtml, /<svg onload=1/);
  assert.match(coverHtml, /&lt;svg onload=1&gt;/);
  const spotify = vm.runInContext("spotifyAlbumCard({title:'Song',artist:'Artist',album:'<svg onload=1>',kind:'track',matchTitle:'<img src=x onerror=1>',matchArtist:'\" onmouseover=1',format:'Spotify saved track'})", context);
  assert.doesNotMatch(spotify, /Spotify saved track|class="format"/);
  assert.doesNotMatch(spotify, /<img src=x|<svg onload=1/);
  assert.match(spotify, /data-title="&lt;img src=x onerror=1&gt;"/);
  assert.match(spotify, /data-artist="&quot; onmouseover=1"/);
  assert.match(spotify, /<strong title="&lt;svg onload=1&gt;">&lt;svg onload=1&gt;<\/strong>/);
  context.spotifyPlayCounts.set('spotify:track:synthetic1', { plays: 42, match: 'exact' });
  const counted = vm.runInContext("spotifyAlbumCard({title:'Song',artist:'Artist',album:'Album',kind:'track',uri:'spotify:track:synthetic1',format:'Spotify saved track',showPlayCount:true})", context);
  assert.match(counted, /class="play-count"[^>]*>[\s\S]*?<span>Plays<\/span><strong>42<\/strong>/);
  assert.match(counted, /data-play-count-uri="spotify:track:synthetic1"/);
  assert.doesNotMatch(counted, /class="album-name"[^>]*>[\s\S]*?recorded plays/);
  const playlistCounted = vm.runInContext("spotifyAlbumCard({title:'Song',artist:'Artist',album:'Album',kind:'track',uri:'spotify:track:synthetic1',format:'Playlist track',showPlayCount:true})", context);
  assert.match(playlistCounted, /<span>Plays<\/span><strong>42<\/strong>/);
  context.spotifyPlayCounts.set('spotify:track:synthetic1', { plays: 5, match: 'song' });
  assert.match(vm.runInContext("spotifyAlbumCard({title:'Song',artist:'Artist',album:'Album',kind:'track',uri:'spotify:track:synthetic1',showPlayCount:true})", context), /<strong>≈ 5<\/strong>/);
  context.spotifyPlayCounts.set('spotify:track:synthetic1', { plays: null, match: 'unrecorded' });
  assert.match(vm.runInContext("spotifyAlbumCard({title:'Song',artist:'Artist',album:'Album',kind:'track',uri:'spotify:track:synthetic1',showPlayCount:true})", context), /<strong>Not recorded<\/strong>/);
  assert.match(vm.runInContext("spotifyAlbumCard({title:'Album only',artist:'Artist',format:'Spotify saved album',showPlayCount:true})", context), /<span>Plays<\/span><strong>—<\/strong>/);
});

test('dormant release dialog, handlers, and styles are absent', () => {
  assert.doesNotMatch(source, /\bconst albums=\[\]|function albumCard\(|\.view-release|\.add-to-collection|\.add-to-wantlist|\.like\b|#releaseDialog/);
  assert.doesNotMatch(markup, /id="releaseDialog"|id="releaseDetail"|id="closeRelease"/);
  assert.doesNotMatch(styles, /\.view-release|\.release-layout|\.release-facts|\.release-actions|\.release-copy|\.release-artist|\.add-to-collection|\.add-to-wantlist|\.like\b|\.close-dialog/);
});

test('saved-song play counts use a bounded same-site batch and distinguish approximate from missing', async () => {
  const nodes = ['spotify:track:synthetic1', 'spotify:track:synthetic2'].map(uri => ({ dataset: { playCountUri: uri }, title: '', value: { textContent: '' }, querySelector() { return this.value; } }));
  const checked = { textContent: '' };
  const requests = [];
  let reply = { ok: true, json: async () => ({ counts: { 'spotify:track:synthetic1': 5, 'spotify:track:synthetic2': null }, matches: { 'spotify:track:synthetic1': 'song', 'spotify:track:synthetic2': 'unrecorded' }, recentUnavailable: false, lastSynced: Date.UTC(2026, 9, 22) }) };
  let scheduled;
  const context = vm.createContext({
    document: { querySelector: selector => selector === '.active-view' ? { id: 'spotify' } : checked, querySelectorAll: () => nodes },
    fetch: async (url, options) => { requests.push({ url, options }); return reply; },
    clearTimeout() {}, setTimeout: callback => { scheduled = callback; return 1; },
    spotifyPlayCounts: new Map(), spotifyPlayCountFetchedAt: new Map()
  });
  vm.runInContext('let spotifyConnected=true,spotifyAccountGeneration=0,spotifyPlayCountRevision=0,spotifyPlayCountTimer=null;', context);
  for (const name of ['playCountText', 'playCountTitle', 'scheduleSpotifyPlayCounts']) vm.runInContext(definition(name), context);
  vm.runInContext("scheduleSpotifyPlayCounts([{kind:'track',uri:'spotify:track:synthetic1',title:'Song',artist:'Artist'},{kind:'track',uri:'spotify:track:synthetic2',title:'Other',artist:'Artist'}])", context);
  await scheduled();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/spotify/play-counts');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['X-RCRD-Request'], '1');
  assert.equal(JSON.parse(requests[0].options.body).tracks.length, 2);
  assert.equal(nodes[0].value.textContent, '≈ 5');
  assert.equal(nodes[1].value.textContent, 'Not recorded');
  assert.match(nodes[0].title, /recording may differ/);
  assert.match(checked.textContent, /^Last checked /);
  reply = { ok: true, json: async () => ({ counts: {}, matches: {}, recentUnavailable: true, lastSynced: Date.UTC(2026, 9, 22) }) };
  context.spotifyPlayCountFetchedAt.clear();
  vm.runInContext("scheduleSpotifyPlayCounts([{kind:'track',uri:'spotify:track:synthetic1',title:'Song',artist:'Artist'}])", context);
  await scheduled();
  assert.match(checked.textContent, /^Recent Spotify plays could not be checked\./);
  reply = { ok: false, json: async () => ({ error: 'Synthetic failure' }) };
  vm.runInContext("scheduleSpotifyPlayCounts([{kind:'track',uri:'spotify:track:synthetic1',title:'Song',artist:'Artist'}])", context);
  await scheduled();
  assert.equal(checked.textContent, 'Could not update play counts: Synthetic failure');
});

test('play-count sort loads all requested tracks in bounded batches, reuses cache, and stops on account change', async () => {
  let scheduled,disconnect=false,renders=0;
  const requests=[],counts=new Map(),fetched=new Map(),checked={textContent:''};
  const context=vm.createContext({
    document:{querySelector:selector=>selector==='.active-view'?{id:'spotify'}:selector==='#searchInput'?{value:''}:checked,querySelectorAll:()=>[]},
    spotifyPlayCounts:counts,spotifyPlayCountFetchedAt:fetched,
    clearTimeout(){},setTimeout:callback=>{scheduled=callback;return 1;},renderSpotifyLibrary:()=>{renders++;},
    fetch:async (url,options)=>{const batch=JSON.parse(options.body).tracks;requests.push(batch);if(disconnect)vm.runInContext('++spotifyAccountGeneration;spotifyConnected=false',context);return {ok:true,json:async()=>({counts:Object.fromEntries(batch.map((record,index)=>[record.uri,index+1])),matches:Object.fromEntries(batch.map(record=>[record.uri,'exact']))})};}
  });
  vm.runInContext("let spotifyConnected=true,spotifyAccountGeneration=0,spotifyPlayCountRevision=0,spotifyPlayCountTimer=null,spotifyLibrarySort='plays',spotifySearchMode='library',spotifyCatalogAlbumView=null,spotifyLibraryPage=1",context);
  vm.runInContext(definition('scheduleSpotifyPlayCounts'),context);
  context.records=Array.from({length:51},(_,index)=>({kind:'track',uri:`spotify:track:synthetic${index}`,title:`Song ${index}`,artist:'Example'}));
  vm.runInContext('scheduleSpotifyPlayCounts(records)',context);await scheduled();
  assert.deepEqual(requests.map(batch=>batch.length),[48,3]);assert.equal(counts.size,51);assert.equal(renders,1);
  vm.runInContext('scheduleSpotifyPlayCounts(records)',context);assert.equal(requests.length,2,'fresh cached counts require no requests');
  counts.clear();fetched.clear();disconnect=true;
  vm.runInContext('scheduleSpotifyPlayCounts(records)',context);await scheduled();
  assert.equal(requests.length,3,'account change prevents the second batch');assert.equal(counts.size,0);assert.equal(renders,1);
});

test('all client account and playback mutations send the same-site request header', async () => {
  const requests = [];
  const h = harness(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({}) };
  }, {
    refreshDiscogsSection: async () => {},
    refreshSettingsStatus: async () => {},
    resetSpotifyAccountUi() {}
  });
  h.load('addApiRecord', 'transferSpotifyPlayback', 'spotifyPlaybackRequest');
  const disconnectStart = source.indexOf('async function disconnectAccount(endpoint){');
  const disconnectEnd = source.indexOf("document.querySelector('#settingsSpotifyDisconnect')", disconnectStart);
  assert.ok(disconnectStart >= 0 && disconnectEnd > disconnectStart);
  vm.runInContext(source.slice(disconnectStart, disconnectEnd), h.context);
  h.run("spotifyDeviceId='synthetic-device'");
  await h.run('addApiRecord({disabled:false,textContent:"",dataset:{releaseId:"1"}},"collection")');
  await h.run('transferSpotifyPlayback()');
  await h.run('spotifyPlaybackRequest("pause")');
  await h.run("disconnectAccount('/api/spotify/disconnect')");
  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/collection', '/api/spotify/transfer', '/api/spotify/playback',
    '/api/spotify/disconnect'
  ]);
  for (const { options } of requests) assert.equal(options.headers['X-RCRD-Request'], '1');
});

test('clear-local-data action is separate, confirmed, and clears only RCRD browser keys after sign-out', async () => {
  assert.match(markup, /id="clearLocalAccountData"/);
  const stored = new Map([['rcrdCollection', '[{"title":"Synthetic"}]'], ['rcrdWantlist', '[{"title":"Synthetic"}]'], ['rcrdUiPreferences', '{"volume":20}'], ['unrelated', 'keep']]);
  const calls = [];
  const resets = [];
  let reloads = 0;
  let confirmed = false;
  const h = harness(async (url, options) => { calls.push({ url, options }); return { ok: true }; }, {
    confirm: () => confirmed,
    localStorage: { setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    sessionStorage: { removeItem() {} },
    location: { reload: () => { reloads++; } },
    resetSpotifyAccountUi: () => resets.push('spotify'),
    resetDiscogsAccountUi: () => resets.push('discogs'),
    refreshSettingsStatus: async () => {}
  });
  h.load('clearLocalAccountData');
  await h.run('clearLocalAccountData()');
  assert.equal(calls.length, 0, 'cancel leaves account access and data unchanged');
  confirmed = true;
  await h.run('clearLocalAccountData()');
  assert.deepEqual(calls.map(({ url }) => url), ['/api/spotify/disconnect', '/api/discogs/disconnect']);
  assert.ok(calls.every(({ options }) => options.headers['X-RCRD-Request'] === '1'));
  assert.deepEqual(resets, ['spotify', 'discogs']);
  assert.equal(stored.get('rcrdCollection'), '[]');
  assert.equal(stored.get('rcrdWantlist'), '[]');
  assert.equal(stored.has('rcrdUiPreferences'), false);
  assert.equal(stored.get('unrelated'), 'keep');
  assert.equal(reloads, 1);
});

test('failed second sign-out does not clear browser records or claim completion', async () => {
  const stored = new Map([['rcrdCollection', '[{"title":"Synthetic"}]']]);
  const calls = [];
  const h = harness(async url => { calls.push(url); return { ok: url.includes('spotify') }; }, {
    confirm: () => true,
    localStorage: { setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    resetSpotifyAccountUi() {},
    resetDiscogsAccountUi() { throw new Error('Discogs must not reset after failure'); },
    refreshSettingsStatus: async () => {},
    location: { reload() { throw new Error('Must not reload'); } }
  });
  h.load('clearLocalAccountData');
  await h.run('clearLocalAccountData()');
  assert.deepEqual(calls, ['/api/spotify/disconnect', '/api/discogs/disconnect']);
  assert.equal(stored.get('rcrdCollection'), '[{"title":"Synthetic"}]');
  assert.match(h.node('#clearLocalAccountDataStatus').textContent, /Could not finish/);
  assert.equal(h.node('#clearLocalAccountData').disabled, false);
});

test('browser storage failure after sign-out is reported instead of claiming local data was cleared', async () => {
  let reloads = 0;
  const h = harness(async () => ({ ok: true }), {
    confirm: () => true,
    localStorage: { setItem() { throw new Error('Synthetic storage failure'); }, removeItem() {} },
    resetSpotifyAccountUi() {},
    resetDiscogsAccountUi() {},
    refreshSettingsStatus: async () => {},
    location: { reload() { reloads++; } }
  });
  h.load('clearLocalAccountData');
  await h.run('clearLocalAccountData()');
  assert.equal(reloads, 0);
  assert.match(h.node('#clearLocalAccountDataStatus').textContent, /Could not finish/);
  assert.equal(h.node('#clearLocalAccountData').disabled, false);
});

test('an old Spotify SDK player cannot emit state or deliver a token after Disconnect', async () => {
  const connect = deferred();
  const token = deferred();
  let player;
  let timers = 0;
  const startupTimers = new Map();
  let tokenCallbacks = 0;
  class FakePlayer {
    constructor(config) { this.config = config; this.listeners = {}; player = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { return connect.promise; }
    disconnect() {}
  }
  const h = harness(() => token.promise, {
    window: { Spotify: {}, setInterval() { timers++; } },
    Spotify: { Player: FakePlayer },
    setTimeout: callback => { startupTimers.set(1, callback); return 1; },
    clearTimeout: id => startupTimers.delete(id),
    transferSpotifyPlayback: async () => true,
    syncCurrentSpotifyTrack() {}
  });
  h.load('resetSpotifyAccountUi');
  const start = source.indexOf('async function initSpotifyPlayer(){');
  const end = source.indexOf('\n}\nwindow.onSpotifyWebPlaybackSDKReady', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end + 2), h.context);
  const request = h.run('initSpotifyPlayer()');
  const tokenRequest = player.config.getOAuthToken(() => { tokenCallbacks++; });
  assert.equal(startupTimers.size, 1);
  h.run('resetSpotifyAccountUi()');
  assert.equal(startupTimers.size, 0);
  player.listeners.player_state_changed({ track_window: { current_track: { uri: 'spotify:track:old', name: 'Old track' } } });
  token.resolve({ ok: true, json: async () => ({ access_token: 'synthetic-token' }) });
  connect.resolve(true);
  await Promise.all([request, tokenRequest]);
  assert.equal(h.run('spotifyTrackUri'), null);
  assert.equal(tokenCallbacks, 0);
  assert.equal(timers, 0);
});

test('Spotify SDK failure is reported once and does not retry a failed connection', async () => {
  let attempts = 0;
  let disconnects = 0;
  let player;
  const toasts = [];
  class FakePlayer {
    constructor() { this.listeners = {}; player = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { attempts++; return Promise.resolve(false); }
    disconnect() { disconnects++; }
  }
  const h = harness(undefined, {
    window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer },
    showToast: message => toasts.push(message)
  });
  h.load('initSpotifyPlayer');
  player = null;
  await h.run('initSpotifyPlayer()');
  assert.equal(attempts, 1);
  assert.equal(disconnects, 1);
  assert.equal(h.run('spotifyPlayerConnectFailed'), true);
  assert.match(toasts[0], /Spotify player could not connect/);
  await h.run('initSpotifyPlayer()');
  assert.equal(attempts, 1);
  assert.equal(toasts.length, 1);
  assert.equal(player !== null, true);
});

test('slow player startup stays retryable and accepts a late ready event', async () => {
  const timers = new Map();
  const toasts = [];
  let player;
  let disconnects = 0;
  class FakePlayer {
    constructor() { this.listeners = {}; player = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { return Promise.resolve(true); }
    disconnect() { disconnects++; }
  }
  const h = harness(undefined, {
    window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer },
    setTimeout: (callback, delay) => { timers.set(1, { callback: () => { timers.delete(1); callback(); }, delay }); return 1; },
    clearTimeout: id => timers.delete(id),
    showToast: message => toasts.push(message)
  });
  h.load('initSpotifyPlayer');
  h.run('renderSpotifyConnectionStatus({connected:true})');
  await h.run('initSpotifyPlayer()');
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Starting player');
  assert.equal(timers.get(1).delay, 30000);
  timers.get(1).callback();
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Still connecting');
  assert.match(h.node('#playbackHealthHelp').textContent, /may still connect/);
  assert.equal(h.node('#playbackHealthRetry').hidden, false);
  assert.equal(h.node('#playbackHealthRetry').disabled, false);
  assert.equal(disconnects, 0);
  assert.equal(timers.size, 0);
  h.context.transferSpotifyPlayback=async()=>true;
  await player.listeners.ready({ device_id: 'late-device' });
  assert.equal(h.run('spotifyDeviceId'), 'late-device');
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Ready');
  assert.equal(h.node('#playbackHealthHelp').textContent, 'Player readiness and the active device are checked separately.');
  assert.deepEqual(toasts, ['Spotify player is still connecting', 'Spotify player ready']);
});

test('a Ready player can be re-registered without stealing playback from another Spotify window', async () => {
  const players=[],refreshes=[],transfers=[];
  class FakePlayer{
    constructor(){this.listeners={};players.push(this);}
    addListener(name,callback){this.listeners[name]=callback;}
    connect(){return Promise.resolve(true);}
    disconnect(){this.listeners.not_ready?.();void this.listeners.ready?.({device_id:'retired-device'});}
  }
  const h=harness(undefined,{window:{Spotify:{},setInterval(){}},Spotify:{Player:FakePlayer},loadSpotifyDevices:silent=>refreshes.push(silent),transferSpotifyPlayback:async()=>{transfers.push(1);return true;},syncCurrentSpotifyTrack(){}});
  h.load('initSpotifyPlayer','retrySpotifyPlayer');h.run('renderSpotifyConnectionStatus({connected:true})');
  await h.run('initSpotifyPlayer()');await players[0].listeners.ready({device_id:'old-local'});
  assert.equal(h.node('#playbackHealthRetry').hidden,false);assert.equal(h.node('#playbackHealthRetry').textContent,'Reconnect RCRD player');
  h.run("spotifyTargetDeviceId='spotify-dj-window';availableSpotifyDevices.set('old-local',{id:'old-local'})");refreshes.length=0;transfers.length=0;
  await h.run('retrySpotifyPlayer()');
  assert.equal(players.length,2);assert.equal(h.run('spotifyDeviceId'),null);assert.equal(h.run('spotifyTargetDeviceId'),'spotify-dj-window');
  assert.equal(h.node('#playbackHealthRetry').disabled,true);assert.equal(h.node('#playbackHealthRetry').textContent,'Connecting…');
  await players[0].listeners.ready({device_id:'stale-local'});assert.equal(h.run('spotifyDeviceId'),null);
  await players[1].listeners.ready({device_id:'new-local'});
  assert.equal(h.run('spotifyDeviceId'),'new-local');assert.equal(h.run('spotifyTargetDeviceId'),'spotify-dj-window');
  assert.equal(h.run("availableSpotifyDevices.has('old-local')"),false);assert.equal(h.node('#playbackHealthRetry').disabled,false);
  assert.deepEqual(refreshes,[true]);assert.deepEqual(transfers,[],'re-registering does not switch away from the chosen external player');
});

test('re-registration invalidates an old device-list response before refreshing the new player', async () => {
  const stale=deferred(),refreshed=deferred(),players=[];let requests=0;
  class FakePlayer{constructor(){this.listeners={};players.push(this);}addListener(name,callback){this.listeners[name]=callback;}connect(){return Promise.resolve(true);}disconnect(){}}
  const h=harness(async()=>{requests++;return requests===1?stale.promise:{ok:true,json:async()=>({devices:[{id:'new-local',name:'RCRD · Spotify'}]})};},{window:{Spotify:{},setInterval(){}},Spotify:{Player:FakePlayer},syncCurrentSpotifyTrack(){}});
  h.load('initSpotifyPlayer','retrySpotifyPlayer','loadSpotifyDevices');h.context.syncSpotifyDeviceRefresh=()=>refreshed.resolve();
  h.run("renderSpotifyConnectionStatus({connected:true});spotifyPlayerState='ready';spotifyDeviceId='old-local';spotifyTargetDeviceId='external'");
  const oldRequest=h.run('loadSpotifyDevices()');assert.equal(requests,1);
  await h.run('retrySpotifyPlayer()');await players[0].listeners.ready({device_id:'new-local'});await refreshed.promise;
  assert.equal(requests,2);assert.match(h.node('#playbackDeviceList').innerHTML,/new-local/);
  stale.resolve({ok:true,json:async()=>({devices:[{id:'old-local',name:'Old RCRD'}]})});await oldRequest;
  assert.match(h.node('#playbackDeviceList').innerHTML,/new-local/);assert.doesNotMatch(h.node('#playbackDeviceList').innerHTML,/old-local/);
});

test('SDK failure clears only its own stale playback target and ignores disconnect callbacks', async () => {
  for(const target of ['local-player','external-player']){
    let player;
    class FakePlayer{constructor(){this.listeners={};player=this;}addListener(name,callback){this.listeners[name]=callback;}connect(){return Promise.resolve(true);}disconnect(){void this.listeners.ready?.({device_id:'retired-device'});}}
    const h=harness(undefined,{window:{Spotify:{},setInterval(){}},Spotify:{Player:FakePlayer},transferSpotifyPlayback:async()=>true,syncCurrentSpotifyTrack(){}});
    h.load('initSpotifyPlayer');await h.run('initSpotifyPlayer()');await player.listeners.ready({device_id:'local-player'});
    h.run(`spotifyTargetDeviceId='${target}'`);player.listeners.authentication_error();
    assert.equal(h.run('spotifyDeviceId'),null);assert.equal(h.run('spotifyPlayerState'),'error');
    assert.equal(h.run('spotifyTargetDeviceId'),target==='local-player'?null:'external-player');
  }
});

test('player readiness and manual retry clear stale startup deadlines', async () => {
  const timers = new Map();
  let nextTimer = 0;
  let player;
  class FakePlayer {
    constructor() { this.listeners = {}; player = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { return Promise.resolve(true); }
    disconnect() {}
  }
  const h = harness(undefined, {
    window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    transferSpotifyPlayback: async () => true,
    syncCurrentSpotifyTrack() {}
  });
  h.load('initSpotifyPlayer', 'retrySpotifyPlayer');
  h.run('renderSpotifyConnectionStatus({connected:true})');
  await h.run('initSpotifyPlayer()');
  const firstDeadline = timers.get(1);
  h.run('retrySpotifyPlayer()');
  await Promise.resolve();
  assert.equal(timers.has(1), false);
  assert.equal(timers.has(2), true);
  firstDeadline();
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Starting player');
  await player.listeners.ready({ device_id: 'synthetic-device' });
  assert.equal(timers.size, 0);
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Ready');
});

test('failed or malformed SDK token responses leave a retryable player state', async () => {
  for (const [response, issue] of [
    [{ ok: false, status: 401 }, /Reconnect Spotify/],
    [{ ok: false, status: 403 }, /playback permission/],
    [{ ok: true, json: async () => ({}) }, /token unavailable/]
  ]) {
    let player;
    let tokenCallbacks = 0;
    class FakePlayer {
      constructor(config) { this.config = config; this.listeners = {}; player = this; }
      addListener(name, callback) { this.listeners[name] = callback; }
      connect() { return Promise.resolve(true); }
      disconnect() {}
    }
    const h = harness(async () => response, { window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer } });
    h.load('initSpotifyPlayer');
    h.run('renderSpotifyConnectionStatus({connected:true})');
    await h.run('initSpotifyPlayer()');
    await player.config.getOAuthToken(() => { tokenCallbacks++; });
    assert.equal(tokenCallbacks, 0);
    assert.equal(h.node('#playbackHealthPlayer').textContent, response.status===403?'Playback permission needed':'Unavailable');
    assert.match(h.node('#playbackHealthHelp').textContent, issue);
    assert.equal(h.node('#playbackHealthRetry').hidden, response.status===403);
    assert.doesNotMatch(markup, /id="playbackHealthAuthorize"/);
  }
});

test('playback health separates account connection, player readiness and active device', async () => {
  assert.match(markup, /id="playbackHealthToggle"[^>]*aria-controls="playbackHealthPanel"/);
  assert.match(markup, /id="playbackHealthRetry"/);
  const actionsStart = markup.indexOf('<div class="player-actions">');
  const healthPosition = markup.indexOf('id="playbackHealthToggle"', actionsStart);
  const likedPosition = markup.indexOf('id="playerLiked"', actionsStart);
  assert.ok(healthPosition > actionsStart && healthPosition < likedPosition, 'player status precedes the heart in the action row');
  assert.doesNotMatch(markup.slice(markup.indexOf('<div class="player-info">'), actionsStart), /playbackHealthToggle/);
  const h = harness(async () => ({ ok: true, json: async () => ({ device: { id: 'other-device', is_active: true, name: 'Living room speaker' } }) }));
  h.load('syncCurrentSpotifyTrack');
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:true})');
  assert.equal(h.node('#playbackHealthConnection').textContent, 'Connected');
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Waiting for player');
  assert.equal(h.node('#playbackHealthDevice').textContent, 'Not checked');
  h.run("spotifyPlayerState='ready';spotifyDeviceId='synthetic-device';renderPlaybackHealth()");
  assert.equal(h.node('#playbackHealthToggle').title, 'Player: Ready');
  await h.run('syncCurrentSpotifyTrack()');
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Ready');
  assert.equal(h.node('#playbackHealthDevice').textContent, 'Living room speaker');
  h.run('renderSpotifyConnectionStatus({connected:false})');
  assert.equal(h.node('#playbackHealthConnection').textContent, 'Not connected');
  assert.equal(h.node('#playbackHealthDevice').textContent, 'Not available');
});

test('an empty playback response reports no active device', async () => {
  const h = harness(async () => ({ ok: true, status: 204 }));
  h.load('syncCurrentSpotifyTrack');
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:true})');
  await h.run('syncCurrentSpotifyTrack()');
  assert.equal(h.node('#playbackHealthDevice').textContent, 'None reported');
});

test('failed active-device lookup stays unavailable without claiming another device', async () => {
  const h = harness(async () => ({ ok: false }));
  h.load('syncCurrentSpotifyTrack');
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:true})');
  await h.run('syncCurrentSpotifyTrack()');
  assert.equal(h.node('#playbackHealthDevice').textContent, 'Unavailable');
});

test('playback health retry is manual and keeps stale SDK events from restoring readiness', async () => {
  let attempts = 0;
  let oldPlayer;
  class FakePlayer {
    constructor() { this.listeners = {}; if (!oldPlayer) oldPlayer = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { attempts++; return Promise.resolve(attempts > 1); }
    disconnect() {}
  }
  const h = harness(undefined, { window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer } });
  h.load('initSpotifyPlayer', 'retrySpotifyPlayer');
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:true})');
  await h.run('initSpotifyPlayer()');
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Unavailable');
  assert.equal(h.node('#playbackHealthRetry').hidden, false);
  assert.equal(attempts, 1);
  h.run('retrySpotifyPlayer()');
  await Promise.resolve();
  oldPlayer.listeners.ready({ device_id: 'stale-device' });
  assert.equal(attempts, 2);
  assert.equal(h.run('spotifyDeviceId'), null);
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Starting player');
});

test('player constructor failure leaves a retryable health state', async () => {
  const h = harness(undefined, {
    window: { Spotify: {}, setInterval() {} },
    Spotify: { Player: class { constructor() { throw new Error('synthetic-private-provider-text'); } } }
  });
  h.load('initSpotifyPlayer');
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:true})');
  await h.run('initSpotifyPlayer()');
  assert.equal(h.node('#playbackHealthPlayer').textContent, 'Unavailable');
  assert.equal(h.node('#playbackHealthRetry').hidden, false);
  assert.doesNotMatch(h.node('#playbackHealthHelp').textContent, /synthetic-private-provider-text/);
});

test('playback health ignores a device response from a previous account', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  h.load('syncCurrentSpotifyTrack');
  h.run('renderSpotifyConnectionStatus({connected:true,canModifyLibrary:true})');
  const request = h.run('syncCurrentSpotifyTrack()');
  h.run('spotifyAccountGeneration++;renderSpotifyConnectionStatus({connected:false})');
  pending.resolve({ ok: true, json: async () => ({ device: { name: 'Old private device', is_active: true } }) });
  await request;
  assert.equal(h.node('#playbackHealthDevice').textContent, 'Not available');
  assert.doesNotMatch(h.node('#playbackHealthDevice').textContent, /Old private device/);
});

test('Spotify SDK errors identify initialization, playback, and autoplay failures without exposing provider text', async () => {
  const pending = deferred();
  const toasts = [];
  let player;
  class FakePlayer {
    constructor() { this.listeners = {}; player = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { return pending.promise; }
    disconnect() {}
  }
  const h = harness(undefined, {
    window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer },
    showToast: message => toasts.push(message)
  });
  h.load('resetSpotifyAccountUi');
  h.load('initSpotifyPlayer');
  const connecting = h.run('initSpotifyPlayer()');
  for (const event of ['playback_error', 'autoplay_failed', 'initialization_error']) {
    assert.equal(typeof player.listeners[event], 'function');
    player.listeners[event]({ message: 'synthetic-private-provider-text' });
  }
  assert.match(toasts[0], /could not play/i);
  assert.match(toasts[1], /autoplay/i);
  assert.match(toasts[2], /could not initialize/i);
  assert.equal(toasts.some(message => message.includes('synthetic-private-provider-text')), false);
  assert.equal(h.run('spotifyPlayerConnectFailed'), true);
  pending.resolve(false);
  await connecting;
  assert.equal(toasts.length, 3, 'connect failure does not replace the specific initialization error');
  h.run('resetSpotifyAccountUi()');
  player.listeners.playback_error({ message: 'stale-private-text' });
  assert.equal(toasts.length, 3);
  assert.equal(h.run('spotifyPlayerConnectFailed'), false);
});

test('Spotify SDK account and authentication failures clear the player without leaking provider text', async () => {
  for (const event of ['account_error', 'authentication_error']) {
    const pending = deferred();
    const toasts = [];
    let player;
    let disconnects = 0;
    class FakePlayer {
      constructor() { this.listeners = {}; player = this; }
      addListener(name, callback) { this.listeners[name] = callback; }
      connect() { return pending.promise; }
      disconnect() { disconnects++; }
    }
    const h = harness(undefined, {
      window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer },
      showToast: message => toasts.push(message)
    });
    h.load('initSpotifyPlayer');
    const connecting = h.run('initSpotifyPlayer()');
    player.listeners[event]({ message: 'synthetic-private-provider-text' });
    pending.resolve(false);
    await connecting;
    assert.equal(disconnects, 1);
    assert.equal(h.run('spotifyPlayer'), null);
    assert.equal(h.run('spotifyPlayerConnectFailed'), true);
    assert.equal(toasts.length, 1);
    assert.doesNotMatch(toasts[0], /synthetic-private-provider-text/);
  }
});

test('an offline Spotify SDK device is no longer used for Start or Play', async () => {
  let player;
  class FakePlayer {
    constructor() { this.listeners = {}; player = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { return Promise.resolve(true); }
    disconnect() {}
  }
  const h = harness(undefined, {
    window: { Spotify: {}, setInterval() {} }, Spotify: { Player: FakePlayer },
    transferSpotifyPlayback: async () => true, syncCurrentSpotifyTrack() {}
  });
  h.load('initSpotifyPlayer');
  await h.run('initSpotifyPlayer()');
  await player.listeners.ready({ device_id: 'synthetic-device' });
  assert.equal(h.run('spotifyDeviceId'), 'synthetic-device');
  assert.equal(h.run('spotifyPlayerState'), 'ready');
  player.listeners.not_ready();
  assert.equal(h.run('spotifyDeviceId'), null);
  assert.equal(h.run('spotifyPlayerState'), 'offline');
});

test('playback polling pauses while the window is hidden and resumes once visible', () => {
  const activeTimers = new Set();
  let nextTimer = 0;
  let polls = 0;
  const h = harness(undefined, {
    window: { setInterval: () => { const id = ++nextTimer; activeTimers.add(id); return id; } },
    clearInterval: id => activeTimers.delete(id),
    syncCurrentSpotifyTrack: () => { polls++; }
  });
  h.run('spotifyPlayer={};spotifyDeviceId="synthetic-device";document.visibilityState="visible";syncSpotifyPlaybackPolling()');
  assert.equal(polls, 1);
  assert.equal(activeTimers.size, 2, 'one provider poll and one local progress ticker');
  h.run('syncSpotifyPlaybackPolling()');
  assert.equal(polls, 1, 'repeat events do not create duplicate polls');
  assert.equal(activeTimers.size, 2, 'repeat events do not create duplicate intervals');
  h.run('document.visibilityState="hidden";syncSpotifyPlaybackPolling()');
  assert.equal(activeTimers.size, 0);
  assert.equal(h.run('spotifySyncTimer'), null);
  assert.equal(h.run('spotifyProgressTimer'), null);
  h.run('document.visibilityState="visible";syncSpotifyPlaybackPolling()');
  assert.equal(polls, 2, 'foregrounding immediately catches up');
  assert.equal(activeTimers.size, 2);
  h.run('spotifyDeviceId=null;syncSpotifyPlaybackPolling()');
  assert.equal(activeTimers.size, 0, 'offline devices are not polled');
  assert.match(source, /document\.addEventListener\('visibilitychange',syncSpotifyPlaybackPolling\)/);
});

test('external playback checks every three seconds while active and keeps the idle/local fallback', () => {
  const timers=new Map();let next=0,polls=0,focused=true;
  const h=harness(undefined,{window:{setInterval:(callback,delay)=>{timers.set(++next,{callback,delay});return next;}},syncCurrentSpotifyTrack:()=>{polls++;}});
  h.context.document.hasFocus=()=>focused;
  h.run("spotifyDeviceId='local';spotifyTargetDeviceId='external';document.visibilityState='visible';syncSpotifyPlaybackPolling()");
  const tick=[...timers.values()].find(timer=>timer.delay===3000).callback;
  assert.equal(polls,1);tick();assert.equal(polls,2,'active external state is fetched on the first short tick');
  focused=false;for(let index=0;index<4;index++)tick();assert.equal(polls,3,'unfocused window makes only the fifteen-second fallback request');
  focused=true;h.run('ambientLastActivity=Date.now()-60001');for(let index=0;index<4;index++)tick();assert.equal(polls,3,'idle focus alone does not cause rapid requests');
  tick();assert.equal(polls,4);
  h.run("spotifyTargetDeviceId='local';ambientLastActivity=Date.now()");for(let index=0;index<5;index++)tick();assert.equal(polls,5,'SDK-backed local playback retains its fallback cadence');
  h.run("document.visibilityState='hidden'");tick();assert.equal(polls,5);
});

test('overlapping playback checks coalesce and a forced refresh follows a stale response once', async () => {
  const old=deferred(),fresh=deferred();let requests=0;const shown=[];
  const h=harness(async()=>{requests++;return requests===1?old.promise:{ok:true,json:async()=>({item:{uri:'spotify:track:new',name:'New song',artists:[],album:{},duration_ms:1000},is_playing:true,progress_ms:10})};},{setSong:title=>{shown.push(title);fresh.resolve();}});
  h.load('syncCurrentSpotifyTrack');const pending=h.run('syncCurrentSpotifyTrack()');
  await h.run('syncCurrentSpotifyTrack()');await h.run('syncCurrentSpotifyTrack(true)');await h.run('syncCurrentSpotifyTrack(true)');
  assert.equal(requests,1,'a slow provider cannot accumulate concurrent polling requests');
  h.run('++spotifyPlaybackStateRevision');old.resolve({ok:true,json:async()=>({item:{name:'Old song'}})});
  await pending;await fresh.promise;assert.equal(requests,2);assert.deepEqual(shown,['New song']);
});

test('device transfer requests immediate display synchronization when polling is already running', async () => {
  const refreshed=[],h=harness(async()=>({ok:true,json:async()=>({ok:true})}),{syncCurrentSpotifyTrack:force=>refreshed.push(force)});
  h.load('chooseSpotifyDevice');h.context.syncSpotifyPlaybackPolling=()=>{};
  h.run("spotifySyncTimer=1;availableSpotifyDevices.set('external',{id:'external',name:'Spotify window'})");
  const button={disabled:false,dataset:{deviceId:'external'}};h.context.event={target:{closest:()=>button}};
  await h.run('chooseSpotifyDevice(event)');assert.deepEqual(refreshed,[true]);assert.equal(h.run('spotifyPlaybackStateRevision'),1);
  assert.match(source,/window\.addEventListener\('focus',[^\n]*syncCurrentSpotifyTrack\(true\)/);
});

test('track progress advances locally, pauses, and resets without extra provider requests', () => {
  let now = 1000;
  let requests = 0;
  const h = harness(() => { requests++; throw new Error('No provider request expected'); }, {
    performance: { now: () => now }
  });
  h.load('formatTime', 'updateProgress');
  h.run('spotifySyncTimer=1;document.visibilityState="visible";playing=true;updateProgress(10000,30000)');
  now = 1600;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerProgress').value, 10600);
  now = 2200;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerPosition').textContent, '0:11');
  h.run('playing=false');
  now = 4200;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerProgress').value, 11200, 'pause holds the visible position');
  h.run('playing=true');
  now = 4700;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerProgress').value, 11700, 'resume excludes paused time');
  h.run('updateProgress(4000,30000)');
  now = 5200;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerProgress').value, 4500, 'an authoritative seek reanchors progress');
  h.run('updateProgress(0,0)');
  now = 6200;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerProgress').value, 0, 'an empty playback state clears the slider');
  assert.equal(h.node('#playerPosition').textContent, '0:00');
  h.run('playing=true;updateProgress(29000,30000)');
  now = 8200;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerProgress').value, 30000, 'local progress stops at track duration');
  now = 9200;
  h.run('advanceSpotifyProgress()');
  assert.equal(h.node('#playerProgress').value, 30000, 'the ended track does not run past its duration');
  assert.equal(requests, 0);
});

test('a successful local seek updates track-bar progress immediately', async () => {
  const h = harness();
  h.load('formatTime', 'updateProgress', 'seekSpotifyPlayback');
  const positions = [];
  h.context.spotifyPlayerSeek = position => { positions.push(position); return Promise.resolve(); };
  h.run('spotifyDeviceId="synthetic-device";spotifyPlayer={seek:spotifyPlayerSeek};updateProgress(10000,30000)');
  await h.run('seekSpotifyPlayback(22000)');
  assert.deepEqual(positions, [22000]);
  assert.equal(h.node('#playerProgress').value, 22000);
  assert.equal(h.node('#playerPosition').textContent, '0:22');
});

test('bottom Play activates the Spotify player before playback while Pause does not', async () => {
  const activation = deferred();
  const events = [];
  const toasts = [];
  const h = harness(undefined, {
    activatePlayer: () => { events.push('activate'); return activation.promise; },
    spotifyPlaybackRequest: async action => { events.push(action); },
    renderPlayer: () => { events.push('render'); },
    showToast: message => toasts.push(message)
  });
  h.load('activeLocalSpotifyPlayer', 'toggleSpotifyPlayback');
  h.run('spotifyPlayer={activateElement:activatePlayer}');
  const play = h.run('toggleSpotifyPlayback()');
  assert.deepEqual(events, ['activate']);
  activation.resolve();
  await play;
  assert.deepEqual(events, ['activate', 'play', 'render']);
  assert.equal(h.run('playing'), true);
  await h.run('toggleSpotifyPlayback()');
  assert.deepEqual(events, ['activate', 'play', 'render', 'pause', 'render']);
  assert.equal(h.run('playing'), false);
  assert.deepEqual(toasts, []);
});

test('failed player activation does not send a bottom Play command', async () => {
  const requests = [];
  const toasts = [];
  const h = harness(undefined, {
    activatePlayer: () => Promise.reject(new Error('Synthetic activation failure')),
    spotifyPlaybackRequest: async action => { requests.push(action); },
    showToast: message => toasts.push(message)
  });
  h.load('activeLocalSpotifyPlayer', 'toggleSpotifyPlayback');
  h.run('spotifyPlayer={activateElement:activatePlayer}');
  await h.run('toggleSpotifyPlayback()');
  assert.deepEqual(requests, []);
  assert.equal(h.run('playing'), false);
  assert.deepEqual(toasts, ['Spotify player could not activate. Press Play to retry.']);
});

test('Next uses the active local player without waiting for the server and preserves rapid-click order', async () => {
  const first = deferred();
  const started = deferred();
  const calls = [];
  const h = harness(() => { throw new Error('The server should not receive a local skip'); });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = {
    getCurrentState: async () => ({ paused: false }),
    nextTrack() {
      calls.push('next');
      if (calls.length === 1) { started.resolve(); return first.promise; }
      return Promise.resolve();
    }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const firstClick = h.run("runPlaybackAction('next')");
  await started.promise;
  const secondClick = h.run("runPlaybackAction('next')");
  assert.deepEqual(calls, ['next'], 'the second skip waits for the first to finish');
  assert.equal(h.node('#nextButton').attributes['aria-busy'], 'true');
  assert.notEqual(h.node('#previousButton').attributes['aria-busy'], 'true');
  first.resolve();
  await Promise.all([firstClick, secondClick]);
  assert.deepEqual(calls, ['next', 'next']);
  assert.equal(h.node('#nextButton').attributes['aria-busy'], 'false');
  assert.equal(h.run('spotifySkipPending'), 0);
});

test('an inactive local player uses the existing authenticated skip request', async () => {
  const requests = [];
  const h = harness(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  h.load('spotifyPlaybackRequest', 'activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = { getCurrentState: async () => null, nextTrack() { throw new Error('Local skip must not run'); } };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  await h.run("runPlaybackAction('next')");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/spotify/playback');
  assert.equal(JSON.parse(requests[0].options.body).action, 'next');
  assert.equal(requests[0].options.headers['X-RCRD-Request'], '1');
});

test('Previous uses the active local player rather than the server', async () => {
  const calls = [];
  const h = harness(() => { throw new Error('The server should not receive a local skip'); });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = { getCurrentState: async () => ({ paused: false }), previousTrack: async () => { calls.push('previous'); } };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  await h.run("runPlaybackAction('previous')");
  assert.deepEqual(calls, ['previous']);
  assert.equal(h.node('#previousButton').attributes['aria-busy'], 'false');
  assert.notEqual(h.node('#nextButton').attributes['aria-busy'], 'true');
});

test('Shuffle exposes a clear on/off state without losing its availability hint', () => {
  const h = harness();
  h.load('updatePlaybackModes');
  h.run('updatePlaybackModes({shuffle_state:false})');
  assert.equal(h.node('#shuffleButton').attributes['aria-pressed'], 'false');
  assert.equal(h.node('#shuffleButton').attributes['aria-label'], 'Shuffle off');
  h.run('updatePlaybackModes({shuffle_state:true})');
  assert.equal(h.node('#shuffleButton').attributes['aria-pressed'], 'true');
  assert.equal(h.node('#shuffleButton').attributes['aria-label'], 'Shuffle on');
  h.run('applySpotifyActionAvailability({toggling_shuffle:true})');
  assert.equal(h.node('#shuffleButton').title, 'Shuffle on');
  h.run('applySpotifyActionAvailability({toggling_shuffle:false})');
  assert.equal(h.node('#shuffleButton').title, 'Shuffle unavailable for this playback');
  h.run('updatePlaybackModes({shuffle_state:false})');
  assert.equal(h.node('#shuffleButton').title, 'Shuffle unavailable for this playback');
  assert.equal(h.node('#shuffleButton').attributes['aria-pressed'], 'false');
});

test('Shuffle and Repeat skips use the authenticated mode-aware path on the RCRD device', async () => {
  const commands = [];
  let localSkips = 0;
  const h = harness(async (_url, options) => {
    commands.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  });
  h.load('updatePlaybackModes', 'spotifyPlaybackRequest', 'activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = {
    getCurrentState: async () => ({ paused: false, shuffle: true, repeat_mode: 1 }),
    nextTrack() { localSkips++; }, previousTrack() { localSkips++; }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  h.run("updatePlaybackModes({shuffle_state:true,repeat_state:'off'})");
  await h.run("runPlaybackAction('next')");
  h.run("updatePlaybackModes({shuffle_state:false,repeat_state:'context'})");
  await h.run("runPlaybackAction('previous')");
  assert.deepEqual(commands.map(({ action, device_id }) => [action, device_id]), [
    ['next', 'synthetic-device'], ['previous', 'synthetic-device']
  ]);
  assert.equal(localSkips, 0);
});

test('Next with a selected playback mode skips the SDK state read', async () => {
  for (const mode of ['shuffle', 'repeat']) {
    const requests = [];
    let stateReads = 0;
    const h = harness(undefined, {
      spotifyPlaybackRequest: async action => { requests.push(action); }
    });
    h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
    h.context.localPlayer = {
      getCurrentState() { stateReads++; return Promise.resolve({ paused: false }); },
      nextTrack() { throw new Error('A mode-aware skip must use Spotify playback'); }
    };
    h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
    h.run(mode === 'shuffle' ? 'shuffleEnabled=true' : "repeatMode='context'");
    await h.run("runPlaybackAction('next')");
    assert.deepEqual(requests, ['next']);
    assert.equal(stateReads, 0, `${mode} skips should not wait for SDK state`);
    assert.equal(h.run('spotifySkipPending'), 0);
  }
});

test('SDK mode state avoids a fast skip before the slower playback poll updates the buttons', async () => {
  const requests = [];
  let localSkips = 0;
  const h = harness(undefined, {
    spotifyPlaybackRequest: async action => { requests.push(action); }
  });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = {
    getCurrentState: async () => ({ paused: false, repeat_mode: 2 }),
    nextTrack() { localSkips++; }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  await h.run("runPlaybackAction('next')");
  assert.deepEqual(requests, ['next']);
  assert.equal(localSkips, 0);
});

test('a skip clicked during Shuffle waits for the mode command before reaching Spotify', async () => {
  const modeStarted = deferred();
  const modeFinished = deferred();
  const commands = [];
  let localSkips = 0;
  const h = harness(undefined, {
    spotifyPlaybackRequest: (action, details) => {
      commands.push([action, details?.state]);
      if (action === 'shuffle') { modeStarted.resolve(); return modeFinished.promise; }
      return Promise.resolve();
    }
  });
  h.load('updatePlaybackModes', 'activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = { getCurrentState: async () => ({ paused: false }), nextTrack() { localSkips++; } };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const shuffle = h.run("runPlaybackAction('shuffle')");
  await modeStarted.promise;
  const next = h.run("runPlaybackAction('next')");
  assert.deepEqual(commands, [['shuffle', true]]);
  assert.equal(h.node('#shuffleButton').disabled, true);
  modeFinished.resolve();
  await Promise.all([shuffle, next]);
  assert.deepEqual(commands, [['shuffle', true], ['next', undefined]]);
  assert.equal(localSkips, 0);
  assert.equal(h.run('shuffleEnabled'), true);
  assert.equal(h.node('#shuffleButton').disabled, false);
});

test('Shuffle clicked during a skip waits for that skip to finish', async () => {
  const skipStarted = deferred();
  const skipFinished = deferred();
  const commands = [];
  const h = harness(undefined, {
    spotifyPlaybackRequest: async (action, details) => { commands.push([action, details?.state]); }
  });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = {
    getCurrentState: async () => ({ paused: false }),
    nextTrack() { skipStarted.resolve(); return skipFinished.promise; }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const next = h.run("runPlaybackAction('next')");
  await skipStarted.promise;
  const shuffle = h.run("runPlaybackAction('shuffle')");
  assert.deepEqual(commands, []);
  skipFinished.resolve();
  await Promise.all([next, shuffle]);
  assert.deepEqual(commands, [['shuffle', true]]);
});

test('queued rapid skips finish before a later Shuffle without a control-queue cycle', { timeout: 1000 }, async () => {
  const firstStarted = deferred();
  const firstFinished = deferred();
  const commands = [];
  const h = harness(undefined, {
    spotifyPlaybackRequest: async (action, details) => { commands.push([action, details?.state]); }
  });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = {
    getCurrentState: async () => ({ paused: false }),
    nextTrack() {
      commands.push(['local-next']);
      if (commands.length === 1) { firstStarted.resolve(); return firstFinished.promise; }
      return Promise.resolve();
    }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const first = h.run("runPlaybackAction('next')");
  await firstStarted.promise;
  const second = h.run("runPlaybackAction('next')");
  const shuffle = h.run("runPlaybackAction('shuffle')");
  assert.deepEqual(commands, [['local-next']]);
  firstFinished.resolve();
  await Promise.all([first, second, shuffle]);
  assert.deepEqual(commands, [['local-next'], ['local-next'], ['shuffle', true]]);
});

test('a failed local skip reports an error without sending a second skip', async () => {
  const toasts = [];
  let serverCalls = 0;
  const h = harness(() => { serverCalls++; throw new Error('Unexpected server fallback'); }, { showToast: message => toasts.push(message) });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = {
    getCurrentState: async () => ({ paused: false }),
    nextTrack: async () => { throw new Error('Synthetic private provider text'); }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  await h.run("runPlaybackAction('next')");
  assert.equal(serverCalls, 0);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /could not skip in RCRD/i);
  assert.doesNotMatch(toasts[0], /Synthetic private provider text/);
  assert.equal(h.node('#nextButton').attributes['aria-busy'], 'false');
});

test('Disconnect while checking local playback cannot send a stale skip', async () => {
  const state = deferred();
  let skips = 0;
  const toasts = [];
  const h = harness(() => { throw new Error('Stale request must not reach the server'); }, { showToast: message => toasts.push(message) });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction', 'resetSpotifyAccountUi');
  h.context.localPlayer = { getCurrentState: () => state.promise, nextTrack() { skips++; } };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const click = h.run("runPlaybackAction('next')");
  await Promise.resolve();
  h.run('resetSpotifyAccountUi()');
  state.resolve({ paused: false });
  await click;
  assert.equal(skips, 0);
  assert.deepEqual(toasts, []);
  assert.equal(h.node('#nextButton').attributes['aria-busy'], 'false');
});

test('Play and Pause use local SDK controls and do not invert an SDK state update', async () => {
  const calls = [];
  const h = harness(() => { throw new Error('The server should not receive local Play or Pause'); });
  h.load('activeLocalSpotifyPlayer', 'toggleSpotifyPlayback');
  let paused = true;
  h.context.localPlayer = {
    activateElement: async () => { calls.push('activate'); },
    getCurrentState: async () => ({ paused }),
    resume: async () => { calls.push('resume'); paused = false; h.run('playing=true'); },
    pause: async () => { calls.push('pause'); paused = true; h.run('playing=false'); }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  await h.run('toggleSpotifyPlayback()');
  assert.equal(h.run('playing'), true);
  assert.equal(h.node('#playButton').attributes['aria-busy'], 'false');
  await h.run('toggleSpotifyPlayback()');
  assert.equal(h.run('playing'), false);
  assert.deepEqual(calls, ['activate', 'resume', 'pause']);
});

test('rapid Play then Pause clicks both execute in order while the first command is pending', async () => {
  const resume = deferred();
  const started = deferred();
  const calls = [];
  const h = harness(() => { throw new Error('Local toggles must not reach the server'); });
  h.load('activeLocalSpotifyPlayer', 'toggleSpotifyPlayback');
  let paused = true;
  h.context.localPlayer = {
    activateElement: async () => {},
    getCurrentState: async () => ({ paused }),
    resume() { calls.push('resume'); started.resolve(); return resume.promise.then(() => { paused = false; }); },
    pause() { calls.push('pause'); paused = true; return Promise.resolve(); }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const play = h.run('toggleSpotifyPlayback()');
  await started.promise;
  const pause = h.run('toggleSpotifyPlayback()');
  assert.deepEqual(calls, ['resume']);
  assert.equal(h.node('#playButton').attributes['aria-busy'], 'true');
  resume.resolve();
  await Promise.all([play, pause]);
  assert.deepEqual(calls, ['resume', 'pause']);
  assert.equal(h.run('playing'), false);
  assert.equal(h.node('#playButton').attributes['aria-busy'], 'false');
});

test('a newer SDK state wins over an older Play command completion', async () => {
  const resume = deferred();
  const started = deferred();
  const h = harness(() => { throw new Error('Local Play must not reach the server'); });
  h.load('activeLocalSpotifyPlayer', 'toggleSpotifyPlayback');
  h.context.localPlayer = {
    activateElement: async () => {},
    getCurrentState: async () => ({ paused: true }),
    resume: () => { started.resolve(); return resume.promise; }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const play = h.run('toggleSpotifyPlayback()');
  await started.promise;
  h.run('++spotifySdkStateRevision;playing=false');
  resume.resolve();
  await play;
  assert.equal(h.run('playing'), false);
});

test('Disconnect cancels queued local toggles without restoring playback state', async () => {
  const resume = deferred();
  const started = deferred();
  const calls = [];
  const toasts = [];
  const h = harness(() => { throw new Error('Stale toggle must not reach the server'); }, { showToast: message => toasts.push(message) });
  h.load('activeLocalSpotifyPlayer', 'toggleSpotifyPlayback', 'resetSpotifyAccountUi');
  h.context.localPlayer = {
    activateElement: async () => {},
    getCurrentState: async () => ({ paused: true }),
    resume: () => { calls.push('resume'); started.resolve(); return resume.promise; },
    pause: () => { calls.push('pause'); }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const first = h.run('toggleSpotifyPlayback()');
  await started.promise;
  const second = h.run('toggleSpotifyPlayback()');
  h.run('resetSpotifyAccountUi()');
  resume.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['resume']);
  assert.equal(h.run('playing'), false);
  assert.equal(h.node('#playButton').attributes['aria-busy'], 'false');
  assert.deepEqual(toasts, []);
});

test('an offline RCRD player never sends a device-less skip to another Spotify device', async () => {
  const toasts = [];
  let requests = 0;
  const h = harness(() => { requests++; throw new Error('Unexpected remote skip'); }, { showToast: message => toasts.push(message) });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = { getCurrentState: async () => null };
  h.run('spotifyPlayer=localPlayer;spotifyDeviceId=null');
  await h.run("runPlaybackAction('next')");
  assert.equal(requests, 0);
  assert.match(toasts[0], /No Spotify playback device is ready/);
});

test('a device lost while checking local state cannot redirect a skip to another device', async () => {
  const state = deferred();
  const started = deferred();
  const toasts = [];
  let requests = 0;
  const h = harness(() => { requests++; throw new Error('Unexpected remote skip'); }, { showToast: message => toasts.push(message) });
  h.load('activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = { getCurrentState: () => { started.resolve(); return state.promise; } };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const click = h.run("runPlaybackAction('next')");
  await started.promise;
  h.run('spotifyDeviceId=null');
  state.resolve({ paused: false });
  await click;
  assert.equal(requests, 0);
  assert.match(toasts[0], /No Spotify playback device is ready/);
});

test('a failed local Play never retries through the server or exposes SDK error text', async () => {
  const toasts = [];
  let requests = 0;
  const h = harness(() => { requests++; throw new Error('Unexpected server fallback'); }, { showToast: message => toasts.push(message) });
  h.load('activeLocalSpotifyPlayer', 'toggleSpotifyPlayback');
  h.context.localPlayer = {
    activateElement: async () => {},
    getCurrentState: async () => ({ paused: true }),
    resume: async () => { throw new Error('Synthetic private provider text'); }
  };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  await h.run('toggleSpotifyPlayback()');
  assert.equal(requests, 0);
  assert.equal(h.run('playing'), false);
  assert.match(toasts[0], /could not change playback in RCRD/i);
  assert.doesNotMatch(toasts[0], /Synthetic private provider text/);
  assert.equal(h.node('#playButton').attributes['aria-busy'], 'false');
});

test('a playback poll cannot repaint an old track during a pending skip', async () => {
  const poll = deferred();
  const skip = deferred();
  const h = harness(() => poll.promise);
  h.load('syncCurrentSpotifyTrack', 'activeLocalSpotifyPlayer', 'runPlaybackAction');
  h.context.localPlayer = { getCurrentState: async () => ({ paused: false }), nextTrack: () => skip.promise };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const oldPoll = h.run('syncCurrentSpotifyTrack()');
  const click = h.run("runPlaybackAction('next')");
  poll.resolve({ ok: true, json: async () => ({ item: { uri: 'spotify:track:old', name: 'Old track' }, is_playing: true }) });
  await oldPoll;
  assert.equal(h.run('spotifyTrackUri'), null);
  skip.resolve();
  await click;
});

test('Start and Play wait for a selected device instead of targeting another active device', async () => {
  const requests = [];
  const h = harness(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  h.load('spotifyPlaybackRequest');
  await assert.rejects(h.run('spotifyPlaybackRequest("start",{uri:"spotify:track:synthetic"})'), /No Spotify playback device is ready/);
  await assert.rejects(h.run('spotifyPlaybackRequest("play")'), /No Spotify playback device is ready/);
  assert.deepEqual(requests, []);
  await h.run('spotifyPlaybackRequest("pause")');
  h.run("spotifyDeviceId='synthetic-device'");
  await h.run('spotifyPlaybackRequest("play")');
  assert.deepEqual(requests.map(({ body }) => [body.action, body.device_id]), [
    ['pause', undefined], ['play', 'synthetic-device']
  ]);
});

test('a playback response from before Disconnect cannot be treated as a current command', async () => {
  const old = deferred();
  const h = harness(() => old.promise);
  h.load('spotifyPlaybackRequest', 'resetSpotifyAccountUi');
  const request = h.run('spotifyPlaybackRequest("pause")');
  h.run('resetSpotifyAccountUi()');
  old.resolve({ ok: true, json: async () => ({ ok: true }) });
  await assert.rejects(request, /no longer connected/);
});

test('saved Discogs records are removed while local records survive loading, provider refresh, and Disconnect', () => {
  const record = (title, source) => ({
    title, artist: 'Synthetic artist', tone: '#123456', accent: '#abcdef',
    word: title, format: 'Vinyl', ...(source ? { source } : {})
  });
  const local = record('Local record');
  const provider = record('Private provider record', 'discogs');
  const saved = new Map([
    ['rcrdCollection', JSON.stringify([local, provider])],
    ['rcrdWantlist', JSON.stringify([local, provider])]
  ]);
  const storage = {
    getItem: key => saved.has(key) ? saved.get(key) : null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key)
  };
  const h = harness(undefined, {
    localStorage: storage,
    renderCollection() {}, renderWantlist() {}
  });
  h.load('loadRecords', 'persist', 'purgeStoredDiscogsRecords', 'resetDiscogsAccountUi');
  h.context.provider = provider;
  h.run(`let storageWarningShown=false,discogsPurgeWarningShown=false;
    let localCollection=loadRecords('rcrdCollection',[]),localWantlist=loadRecords('rcrdWantlist',[]);
    collection=[provider];wantlist=[provider]`);
  assert.deepEqual(JSON.parse(JSON.stringify(h.run('localCollection.map(record=>record.title)'))), ['Local record']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.run('localWantlist.map(record=>record.title)'))), ['Local record']);
  h.run('persist()');
  assert.deepEqual(JSON.parse(saved.get('rcrdCollection')).map(item => item.title), ['Local record']);
  assert.deepEqual(JSON.parse(saved.get('rcrdWantlist')).map(item => item.title), ['Local record']);
  saved.set('rcrdCollection', JSON.stringify([local, provider]));
  saved.set('rcrdWantlist', JSON.stringify([provider, local]));
  h.run('resetDiscogsAccountUi()');
  assert.deepEqual(JSON.parse(saved.get('rcrdCollection')).map(item => item.title), ['Local record']);
  assert.deepEqual(JSON.parse(saved.get('rcrdWantlist')).map(item => item.title), ['Local record']);
  assert.equal(h.node('#collectionCount').textContent, '0');
});

test('failed Discogs storage purge warns while clearing account data from the view', () => {
  const toasts = [];
  const storage = {
    getItem: () => JSON.stringify([{ source: 'discogs', title: 'Private record' }]),
    setItem() { throw new Error('Synthetic storage failure'); },
    removeItem() { throw new Error('Synthetic storage failure'); }
  };
  const h = harness(undefined, {
    localStorage: storage,
    renderCollection() {}, renderWantlist() {},
    showToast: message => toasts.push(message)
  });
  h.load('purgeStoredDiscogsRecords', 'resetDiscogsAccountUi');
  h.run('let discogsPurgeWarningShown=false;resetDiscogsAccountUi()');
  assert.equal(h.node('#collectionCount').textContent, '0');
  assert.equal(h.node('#wantCount').textContent, '0');
  assert.match(toasts[0], /Could not clear saved Discogs records/);
});

test('repeat cycles OFF, ALL, ONE in a context and skips ALL for a standalone track', async () => {
  const commands = [];
  const h = harness(undefined, {
    spotifyPlaybackRequest: async (action, details) => commands.push({ action, ...details })
  });
  h.load('updatePlaybackModes', 'runPlaybackAction');
  h.run("updatePlaybackModes({repeat_state:'off',context:{uri:'spotify:album:synthetic'}})");
  for (const [mode, badge] of [['context', 'ALL'], ['track', '1'], ['off', '']]) {
    await h.run("runPlaybackAction('repeat')");
    assert.equal(h.run('repeatMode'), mode);
    assert.equal(h.node('#repeatButton').dataset.repeatBadge, badge);
  }
  h.run("updatePlaybackModes({repeat_state:'off',context:null})");
  await h.run("runPlaybackAction('repeat')");
  assert.equal(h.run('repeatMode'), 'track');
  await h.run("runPlaybackAction('repeat')");
  assert.equal(h.run('repeatMode'), 'off');
  assert.deepEqual(commands.map(({ action, state }) => [action, state]), [
    ['repeat', 'context'], ['repeat', 'track'], ['repeat', 'off'],
    ['repeat', 'track'], ['repeat', 'off']
  ]);
});

test('repeat ignores overlapping clicks and remains retryable after a failed command', async () => {
  const first = deferred();
  const commands = [];
  const toasts = [];
  let fail = false;
  const h = harness(undefined, {
    spotifyPlaybackRequest: (action, details) => {
      commands.push({ action, ...details });
      if (commands.length === 1) return first.promise;
      if (fail) return Promise.reject(new Error('Synthetic repeat failure'));
      return Promise.resolve();
    },
    showToast: message => toasts.push(message)
  });
  h.load('updatePlaybackModes', 'runPlaybackAction');
  h.run("updatePlaybackModes({repeat_state:'off',context:{uri:'spotify:playlist:synthetic'}})");
  const click = h.run("runPlaybackAction('repeat')");
  await h.run("runPlaybackAction('repeat')");
  assert.equal(commands.length, 1);
  assert.equal(h.node('#repeatButton').disabled, true);
  first.resolve();
  await click;
  assert.equal(h.run('repeatMode'), 'context');
  assert.equal(h.node('#repeatButton').disabled, false);
  fail = true;
  await h.run("runPlaybackAction('repeat')");
  assert.equal(h.run('repeatMode'), 'context');
  assert.equal(h.node('#repeatButton').disabled, false);
  assert.match(toasts.at(-1), /Synthetic repeat failure/);
  fail = false;
  await h.run("runPlaybackAction('repeat')");
  assert.equal(h.run('repeatMode'), 'track');
  assert.deepEqual(commands.map(command => command.state), ['context', 'track', 'track']);
});

test('Repeat and Shuffle mode commands stay ordered when clicked together', async () => {
  const shuffleStarted = deferred();
  const shuffleFinished = deferred();
  const commands = [];
  const h = harness(undefined, {
    spotifyPlaybackRequest: (action, details) => {
      commands.push([action, details.state]);
      if (action === 'shuffle') { shuffleStarted.resolve(); return shuffleFinished.promise; }
      return Promise.resolve();
    }
  });
  h.load('updatePlaybackModes', 'runPlaybackAction');
  h.run("updatePlaybackModes({repeat_state:'off',context:{uri:'spotify:album:synthetic'}})");
  const shuffle = h.run("runPlaybackAction('shuffle')");
  await shuffleStarted.promise;
  const repeat = h.run("runPlaybackAction('repeat')");
  assert.deepEqual(commands, [['shuffle', true]]);
  shuffleFinished.resolve();
  await Promise.all([shuffle, repeat]);
  assert.deepEqual(commands, [['shuffle', true], ['repeat', 'context']]);
});

test('failed Shuffle does not claim a mode change and allows a retry', async () => {
  let fail = true;
  const commands = [];
  const toasts = [];
  const h = harness(undefined, {
    spotifyPlaybackRequest: async (action, details) => {
      commands.push([action, details.state]);
      if (fail) throw new Error('Synthetic Shuffle failure');
    },
    showToast: message => toasts.push(message)
  });
  h.load('updatePlaybackModes', 'runPlaybackAction');
  await h.run("runPlaybackAction('shuffle')");
  assert.equal(h.run('shuffleEnabled'), false);
  assert.equal(h.node('#shuffleButton').disabled, false);
  assert.match(toasts[0], /Synthetic Shuffle failure/);
  fail = false;
  await h.run("runPlaybackAction('shuffle')");
  assert.deepEqual(commands, [['shuffle', true], ['shuffle', true]]);
  assert.equal(h.run('shuffleEnabled'), true);
});

test('an empty Spotify playback response clears repeat state without throwing', async () => {
  const h = harness(async () => ({ ok: true, json: async () => null }));
  h.load('updatePlaybackModes', 'syncCurrentSpotifyTrack');
  h.run("updatePlaybackModes({repeat_state:'track',shuffle_state:true,context:{uri:'spotify:album:synthetic'}})");
  await h.run('syncCurrentSpotifyTrack()');
  assert.equal(h.run('repeatMode'), 'off');
  assert.equal(h.run('shuffleEnabled'), false);
  assert.equal(h.run('spotifyHasContext'), false);
  assert.equal(h.node('#repeatButton').dataset.repeatBadge, '');
});

test('an older SDK repeat event does not overwrite an acknowledged repeat command', async () => {
  let player;
  class FakePlayer {
    constructor() { this.listeners = {}; player = this; }
    addListener(name, callback) { this.listeners[name] = callback; }
    connect() { return Promise.resolve(true); }
  }
  const h = harness(undefined, {
    window: { Spotify: {}, setInterval() {} },
    Spotify: { Player: FakePlayer },
    syncCurrentSpotifyTrack() {}
  });
  h.load('updatePlaybackModes');
  const start = source.indexOf('async function initSpotifyPlayer(){');
  const end = source.indexOf('\n}\nwindow.onSpotifyWebPlaybackSDKReady', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end + 2), h.context);
  await h.run('initSpotifyPlayer()');
  h.run("updatePlaybackModes({repeat_state:'context',shuffle_state:true,context:{uri:'spotify:album:synthetic'}})");
  player.listeners.player_state_changed({ repeat_mode: 0, shuffle: false, track_window: {} });
  assert.equal(h.run('repeatMode'), 'context');
  assert.equal(h.run('shuffleEnabled'), true);
  assert.equal(h.node('#repeatButton').dataset.repeatBadge, 'ALL');
});

test('a playback poll started before Shuffle succeeds cannot restore its old mode', async () => {
  const old = deferred();
  const h = harness(() => old.promise, { spotifyPlaybackRequest: async () => ({ ok: true }) });
  h.load('updatePlaybackModes', 'syncCurrentSpotifyTrack', 'runPlaybackAction');
  const poll = h.run('syncCurrentSpotifyTrack()');
  await h.run("runPlaybackAction('shuffle')");
  assert.equal(h.run('shuffleEnabled'), true);
  old.resolve({ ok: true, json: async () => ({ shuffle_state: false }) });
  await poll;
  assert.equal(h.run('shuffleEnabled'), true);
});

test('a playback poll started before repeat succeeds cannot restore its old mode', async () => {
  const old = deferred();
  const h = harness(() => old.promise, { spotifyPlaybackRequest: async () => ({ ok: true }) });
  h.load('updatePlaybackModes', 'syncCurrentSpotifyTrack', 'runPlaybackAction');
  h.run("updatePlaybackModes({repeat_state:'off',context:{uri:'spotify:album:synthetic'}})");
  const poll = h.run('syncCurrentSpotifyTrack()');
  await h.run("runPlaybackAction('repeat')");
  assert.equal(h.run('repeatMode'), 'context');
  old.resolve({ ok: true, json: async () => null });
  await poll;
  assert.equal(h.run('repeatMode'), 'context');
  assert.equal(h.run('spotifyHasContext'), true);
});

test('disconnect during a repeat request releases the button and cannot restore the old mode', async () => {
  const old = deferred();
  const toasts = [];
  const h = harness(() => old.promise, { showToast: message => toasts.push(message) });
  h.load('updatePlaybackModes', 'spotifyPlaybackRequest', 'runPlaybackAction', 'resetSpotifyAccountUi');
  h.run("updatePlaybackModes({repeat_state:'off',context:{uri:'spotify:album:synthetic'}})");
  const click = h.run("runPlaybackAction('repeat')");
  assert.equal(h.node('#repeatButton').disabled, true);
  h.run('resetSpotifyAccountUi()');
  assert.equal(h.node('#repeatButton').disabled, false);
  old.resolve({ ok: true, json: async () => ({ ok: true }) });
  await click;
  assert.equal(h.run('repeatMode'), 'off');
  assert.equal(h.run('repeatRequestPending'), false);
  assert.deepEqual(toasts, []);
});

test('Disconnect cancels a pending Shuffle and the skip queued behind it', async () => {
  const modeStarted = deferred();
  const modeFinished = deferred();
  const commands = [];
  const h = harness(undefined, {
    spotifyPlaybackRequest: (action, details) => {
      commands.push([action, details?.state]);
      if (action === 'shuffle') { modeStarted.resolve(); return modeFinished.promise; }
      return Promise.resolve();
    }
  });
  h.load('updatePlaybackModes', 'activeLocalSpotifyPlayer', 'runPlaybackAction', 'resetSpotifyAccountUi');
  h.context.localPlayer = { getCurrentState: async () => ({ paused: false }), nextTrack() { commands.push(['local-next']); } };
  h.run("spotifyPlayer=localPlayer;spotifyDeviceId='synthetic-device'");
  const shuffle = h.run("runPlaybackAction('shuffle')");
  await modeStarted.promise;
  const next = h.run("runPlaybackAction('next')");
  h.run('resetSpotifyAccountUi()');
  modeFinished.resolve();
  await Promise.all([shuffle, next]);
  assert.deepEqual(commands, [['shuffle', true]]);
  assert.equal(h.run('shuffleEnabled'), false);
  assert.equal(h.run('shuffleRequestPending'), false);
  assert.equal(h.node('#shuffleButton').disabled, false);
});

test('imported listening counts render safely and clear when Spotify disconnects', () => {
  assert.match(markup, /id="spotifyHistoryImport"/);
  assert.match(markup, /id="spotifyHistoryDelete"/);
  const pagers = [];
  const h = harness(undefined, { renderPagination: (...args) => pagers.push(args) });
  h.load('renderListeningHistory', 'resetSpotifyAccountUi');
  h.node('#spotifyHistoryTracks').scrollTop = 120;
  h.run("renderListeningHistory({imported:true,totalPlays:2,trackCount:1,lastAt:'2025-01-02T12:00:00Z',importedAt:Date.now(),page:1,perPage:12,matches:1,tracks:[{title:'<img src=x onerror=1>',artist:'Synthetic artist',album:'Synthetic album',plays:2}]})");
  assert.equal(h.node('#spotifyHistoryDelete').hidden, false);
  assert.equal(h.node('#spotifyHistoryBrowse').hidden, false);
  const item = h.node('#spotifyHistoryTracks').children[0];
  assert.equal(item.children[1].children[0].textContent, '<img src=x onerror=1>');
  assert.equal(item.children[1].children[1].textContent, 'Synthetic artist · Synthetic album');
  assert.equal(item.children[2].textContent, '2 plays');
  assert.equal(h.node('#spotifyHistoryTracks').scrollTop, 0);
  assert.deepEqual(pagers[0], ['spotifyHistoryPagination', 1, 1, 12, 'spotify-history', true]);
  h.run('resetSpotifyAccountUi()');
  assert.equal(h.node('#spotifyHistoryDelete').hidden, true);
  assert.equal(h.node('#spotifyHistoryBrowse').hidden, true);
  assert.equal(h.node('#spotifyHistoryTracks').children.length, 0);
  assert.equal(h.node('#spotifyHistoryImport').disabled, true);
});

test('history pager offers first and last while other pagers keep their existing controls', () => {
  const h = harness();
  h.load('renderPagination');
  h.run("renderPagination('spotifyHistoryPagination',1,30,12,'spotify-history',true)");
  const first = h.node('#spotifyHistoryPagination').innerHTML;
  assert.match(first, /data-page="1" disabled aria-label="First page">First/);
  assert.match(first, /data-page="3"  aria-label="Last page">Last/);
  h.run("renderPagination('spotifyHistoryPagination',3,30,12,'spotify-history',true)");
  assert.match(h.node('#spotifyHistoryPagination').innerHTML, /data-page="3" disabled aria-label="Last page">Last/);
  h.run("renderPagination('collectionPagination',1,30,12,'collection')");
  assert.doesNotMatch(h.node('#collectionPagination').innerHTML, /First page|Last page/);
});

test('listening history requests a bounded page with current search and sort controls', async () => {
  const requests = [];
  const h = harness(async url => {
    requests.push(new URL(url, 'http://127.0.0.1'));
    return { ok: true, json: async () => ({ imported: true, totalPlays: 40, trackCount: 30, lastAt: '2025-01-02T12:00:00Z', importedAt: Date.now(), page: 2, perPage: 12, matches: 30, tracks: [{ title: 'Synthetic title', artist: 'Synthetic artist', album: 'Synthetic album', plays: 4 }] }) };
  });
  h.node('#spotifyHistorySearch').value = 'Synthetic';
  h.node('#spotifyHistorySort').value = 'artist';
  h.node('#spotifyHistoryDirection').value = 'asc';
  h.load('renderListeningHistory', 'refreshListeningHistory');
  await h.run('refreshListeningHistory(2)');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/api/spotify/history');
  assert.equal(requests[0].searchParams.get('page'), '2');
  assert.equal(requests[0].searchParams.get('sort'), 'artist');
  assert.equal(requests[0].searchParams.get('direction'), 'asc');
  assert.equal(requests[0].searchParams.get('q'), 'Synthetic');
  assert.equal(h.node('#spotifyHistoryTracks').children.length, 1);
  assert.equal(h.node('#spotifyHistoryMatches').textContent, 'Showing 13–13 of 30 matching tracks');
});

test('history import requires explicit account confirmation before uploading a ZIP', async () => {
  const uploads = [];
  let consent = false;
  let onFileChange;
  const h = harness(async (url, options) => {
    uploads.push({ url, options });
    return { ok: true, json: async () => ({ imported: false }) };
  }, { confirm: () => consent });
  h.load('renderListeningHistory');
  h.node('#spotifyHistoryFile').addEventListener = (name, listener) => { if (name === 'change') onFileChange = listener; };
  const start = source.indexOf("document.querySelector('#spotifyHistoryFile').addEventListener('change',async event=>{");
  const end = source.indexOf("document.querySelector('#spotifyHistoryDelete').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), h.context);
  const file = { name: 'synthetic.zip', size: 100 };
  await onFileChange({ target: { files: [file], value: 'synthetic.zip' } });
  assert.equal(uploads.length, 0, 'cancelling does not upload the export');
  assert.match(h.node('#spotifyHistoryStatus').textContent, /Import cancelled/);
  consent = true;
  await onFileChange({ target: { files: [file], value: 'synthetic.zip' } });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].url, '/api/spotify/history');
  assert.equal(uploads[0].options.headers['X-RCRD-History-Account-Confirmed'], '1');
  assert.equal(uploads[0].options.body, file);
});
