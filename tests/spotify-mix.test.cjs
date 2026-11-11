const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function definition(name){const lines=source.split('\n');const start=lines.findIndex(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));assert.ok(start>=0);if(lines[start].trimEnd().endsWith('}'))return lines[start];const end=lines.findIndex((line,index)=>index>start&&line==='}');assert.ok(end>start);return lines.slice(start,end+1).join('\n');}
const id=n=>String(n).padStart(22,'0');const lead={id:id(1),name:'Example Artist'};
function track(n,extra={}){return {type:'track',uri:`spotify:track:${id(n)}`,name:`Song ${n}`,artists:[lead],album:{id:id(10000+n),name:`Album ${n}`},...extra};}
const seed=track(1000);
function sources(){return {seed,playlists:[{id:id(400),tracks:[seed,...Array.from({length:120},(_,i)=>track(i+1,{artists:[{id:id(2+Math.floor(i/10)),name:`Linked artist ${Math.floor(i/10)}`}]}))]}],savedTracks:[],playCounts:{},partial:false};}
function discoverySources(){const data=sources();const discoveryTracks=data.playlists[0].tracks.slice(1);return {...data,playlists:[],discoveryTracks,discoveryArtists:[...new Map(discoveryTracks.map(track=>[track.artists[0].id,{id:track.artists[0].id,source:'listenbrainz'}])).values()],discoveryWarnings:[]};}
function harness(fetch=async()=>{throw new Error('Unexpected request');}){
  const nodes=new Map();let checks=[];const requests=[];const plays=[];
  const node=selector=>{if(!nodes.has(selector)){let html='';const element={disabled:false,open:false,attributes:{},textContent:'',setAttribute(name,value){this.attributes[name]=String(value);},getAttribute(name){return this.attributes[name];},showModal(){this.open=true;},close(){this.open=false;}};Object.defineProperty(element,'innerHTML',{get:()=>html,set:value=>{html=value;if(selector==='#spotifyMixTracks')checks=[...value.matchAll(/data-mix-index="(\d+)"/g)].map(match=>({checked:true,dataset:{mixIndex:match[1]}}));}});nodes.set(selector,element);}return nodes.get(selector);};
  const context=vm.createContext({document:{querySelector:node,querySelectorAll:()=>checks.filter(input=>input.checked)},AbortController,setTimeout,clearTimeout,fetch:(url,options)=>{requests.push({url,options});return fetch(url,options);},playSpotifyUri:async(...args)=>{plays.push(args);return true;},showToast:()=>{}});
  vm.runInContext(`let spotifyConnected=true,spotifyAccountGeneration=0,spotifyTrackUri='${seed.uri}',spotifyMixRevision=0,spotifyMixController=null,spotifyMixPreview=null;`,context);
  for(const name of ['escapeHtml','mixTextKey','spotifyMixTrack','buildSpotifyMix','spotifyMixSourceWarnings','resetSpotifyMix','updateSpotifyMixSelection','openSpotifyMix','startSpotifyMix'])vm.runInContext(definition(name),context);
  return {node,context,requests,plays,checks:()=>checks,run:code=>vm.runInContext(code,context),build:(data,s=seed)=>{context.seedFixture=s;context.sourcesFixture=data;return vm.runInContext('buildSpotifyMix(seedFixture,sourcesFixture)',context);}};
}
function provider(data=sources()){return async url=>({ok:true,json:async()=>url==='/api/spotify/currently-playing'?{item:seed}:data});}
test('automatically selects 100 tracks across playlist-linked artists with evidence and diversity caps',()=>{
  const mix=harness().build(sources());assert.equal(mix.length,100);assert.equal(mix[0].uri,seed.uri);assert.ok(mix.slice(1).every(track=>/Shares 1 of your playlists/.test(track.reason)));
  const artists=new Map();const albums=new Map();for(const track of mix){const artist=track.artists[0].id;artists.set(artist,(artists.get(artist)||0)+1);albums.set(track.albumId,(albums.get(track.albumId)||0)+1);}
  assert.ok(artists.size>=10);assert.ok([...artists.values()].every(count=>count<=10));assert.ok([...albums.values()].every(count=>count<=4));
});
test('public discovery alone selects 100 exact artist-ID matches without personal playlists',()=>{
  const data=discoverySources();assert.equal(data.playlists.length,0);assert.equal(data.savedTracks.length,0);
  const mix=harness().build(data);assert.equal(mix.length,100);assert.equal(mix[0].uri,seed.uri);assert.ok(mix.slice(1).every(track=>track.reason==='Related artist via ListenBrainz'));
  assert.ok(new Set(mix.map(track=>track.artists[0].id)).size>=10);assert.equal(new Set(mix.map(track=>track.uri)).size,100);
});
test('discovery accepts only approved exact primary artist IDs and validated source metadata',()=>{
  const approved={id:id(91),source:'listenbrainz'};const approvedArtist={id:approved.id,name:'Related Artist'};const data={discoveryArtists:[approved],discoveryTracks:[track(1,{artists:[approvedArtist]}),track(2,{artists:[{id:id(92),name:approvedArtist.name}]}),track(3,{artists:[{id:id(93),name:'Unapproved lead'},approvedArtist]})]};
  assert.deepEqual(Array.from(harness().build(data),track=>track.uri),[seed.uri,track(1).uri]);
  for(const artist of [{id:91,source:'listenbrainz'},{id:id(91),source:'unknown'},{id:id(91),source:'discogs-style'},{id:id(91),source:'discogs-style',style:' '},{id:id(91),source:'discogs-style',style:'a'.repeat(81)},{id:id(91),source:'discogs-style',style:'Rock\nMetal'}])assert.equal(harness().build({...data,discoveryArtists:[artist]}).length,1);
  assert.equal(harness().build({...data,discoveryArtists:null}).length,1);assert.equal(harness().build({...data,discoveryTracks:{}}).length,1);
});
test('discovery response collections are bounded and preserve version, duplicate, artist and album filters',()=>{
  const data=discoverySources();data.discoveryTracks.push({...data.discoveryTracks[0]},track(900,{artists:data.discoveryTracks[0].artists,name:'Alternate - Karaoke'}),track(901,{artists:data.discoveryTracks[0].artists,is_playable:false}));
  const mix=harness().build(data);assert.equal(mix.length,100);assert.ok(!mix.some(item=>item.uri===track(900).uri||item.uri===track(901).uri));
  const finalArtist={id:id(90),source:'listenbrainz'};const candidate=track(902,{artists:[{id:finalArtist.id,name:'Beyond artist limit'}]});
  assert.equal(harness().build({discoveryArtists:[...Array.from({length:40},(_,i)=>({id:id(i+2),source:'listenbrainz'})),finalArtist],discoveryTracks:[candidate]}).length,1);
  assert.equal(harness().build({discoveryArtists:[finalArtist],discoveryTracks:[...Array(1000).fill(null),candidate]}).length,1);
  assert.equal(harness().build({discoveryArtists:[finalArtist],discoveryTracks:Array.from({length:30},(_,i)=>track(i+1,{artists:candidate.artists,album:seed.album}))}).length,4);
});
test('discovery preview explains source reasons and escapes externally supplied styles',async()=>{
  const data=discoverySources();data.discoveryArtists[0]={...data.discoveryArtists[0],source:'discogs-style',style:'<img src=x onerror=1>'};const h=harness(provider(data));await h.run('openSpotifyMix()');
  assert.equal(h.checks().length,100);assert.match(h.node('#spotifyMixTracks').innerHTML,/Related artist via ListenBrainz/);assert.match(h.node('#spotifyMixTracks').innerHTML,/Shares Discogs style: &lt;img src=x onerror=1&gt;/);assert.doesNotMatch(h.node('#spotifyMixTracks').innerHTML,/<img/);assert.equal(h.plays.length,0);
});
test('name guesses, history popularity and saved-library presence do not admit unrelated artists',()=>{
  const data=sources();const unrelated=track(900,{artists:[{id:id(900),name:lead.name}]});data.savedTracks=[unrelated];data.playCounts[unrelated.uri]=999999;assert.ok(!harness().build(data).some(track=>track.uri===unrelated.uri));
  data.playlists[0].tracks.shift();assert.equal(harness().build(data).length,1);
});
test('one unanchored seed-artist song and very broad playlists are insufficient evidence',()=>{
  const data=sources();data.playlists[0].tracks[0]=track(999);assert.equal(harness().build(data).length,1);
  data.playlists[0].tracks=[seed,...Array.from({length:81},(_,i)=>track(i+1,{artists:[{id:id(i+2),name:`Artist ${i}`}]}))];assert.equal(harness().build(data).length,1);
});
test('two seed-artist songs anchor a playlist; duplicate list IDs do not inflate evidence',()=>{
  const data=sources();data.playlists[0].tracks.splice(0,1,track(998),track(999));assert.equal(harness().build(data).length,100);
  const single=track(900,{artists:[{id:id(900),name:'Isolated artist'}]});data.playlists[0].tracks.push(single);data.playlists.push(data.playlists[0]);assert.ok(!harness().build(data).some(track=>track.uri===single.uri));
});
test('alternate versions, unavailable/local and invalid metadata remain excluded',()=>{
  const h=harness();const variants=['Live','Remix','Karaoke','Instrumental','Acoustic','Demo','Sped up','Slowed','Tribute'].map((mode,i)=>track(i+1,{name:`Song - ${mode}`}));
  const invalid=[track(20,{is_local:true}),track(21,{is_playable:false}),track(22,{restrictions:{reason:'market'}}),track(23,{type:'episode'}),track(24,{artists:[{name:'Missing ID'}]})];assert.equal(h.build({savedTracks:[...variants,...invalid]}).length,1);
  assert.equal(h.build({savedTracks:[track(30,{name:'Another (Live)'})]},track(1000,{name:'Seed (Live)'})).length,2);assert.equal(h.build({savedTracks:[track(31,{name:'Live Forever'})]}).length,2);
});
test('duplicate URIs, remasters, reordered credits and ISRCs are removed; album cap applies',()=>{
  const a=track(1,{name:'Shared song',external_ids:{isrc:'USABC1234567'}});assert.equal(harness().build({savedTracks:[a,a,track(2,{name:'Shared song - 2020 Remaster'}),track(3,{external_ids:{isrc:'USABC1234567'}})]}).length,2);
  const collaborator={id:id(91),name:'Collaborator'};assert.equal(harness().build({savedTracks:[track(4,{name:'Shared',artists:[lead,collaborator]}),track(5,{name:'Shared',artists:[collaborator,lead]})]}).length,2);
  assert.equal(harness().build({savedTracks:Array.from({length:20},(_,i)=>track(i+1,{album:seed.album}))}).length,4);
});
test('imported counts rank only eligible songs',()=>{const data=sources();data.playCounts[track(10).uri]=10000;assert.equal(harness().build(data)[1].uri,track(10).uri);});
test('invalid seed cannot produce a mix',()=>{for(const value of [null,{...seed,uri:'bad'},{...seed,artists:[]},{...seed,is_playable:false}])assert.equal(harness().build(sources(),value).length,0);});
test('preview never auto-plays; 99 selected cannot start; confirmation forwards all 100',async()=>{
  const h=harness(provider());await h.run('openSpotifyMix()');assert.equal(h.plays.length,0);assert.equal(h.requests.length,2);assert.equal(h.checks().length,100);
  h.checks()[1].checked=false;h.run('updateSpotifyMixSelection()');assert.equal(h.node('#spotifyMixStart').disabled,true);await h.run('startSpotifyMix()');assert.equal(h.plays.length,0);
  h.checks()[1].checked=true;h.run('updateSpotifyMixSelection()');await h.run('startSpotifyMix()');assert.equal(h.plays.length,1);assert.equal(h.plays[0][2].length,100);assert.equal(h.node('#spotifyMixDialog').open,false);
});
test('99 qualifying songs never enable playback or pad with unrelated songs',async()=>{
  const data=sources();data.playlists[0].tracks=data.playlists[0].tracks.slice(0,99);const h=harness(provider(data));await h.run('openSpotifyMix()');assert.equal(h.node('#spotifyMixStart').disabled,true);assert.match(h.node('#spotifyMixStatus').textContent,/Only 99 unique tracks/);assert.equal(h.plays.length,0);
});
test('account reset aborts pending lookup and rejects late responses',async()=>{
  let finish;const h=harness(()=>new Promise(resolve=>finish=resolve));const pending=h.run('openSpotifyMix()');h.run('spotifyConnected=false;++spotifyAccountGeneration;resetSpotifyMix()');assert.equal(h.requests[0].options.signal.aborted,true);
  finish({ok:true,json:async()=>({item:seed})});await pending;assert.equal(h.node('#spotifyMixDialog').open,false);assert.equal(h.node('#spotifyMixTracks').innerHTML,'');assert.equal(h.requests.length,1);
});
test('provider failures, malformed sources and partial results are disclosed',async()=>{
  const failed=harness(async()=>({ok:false,json:async()=>({error:'Synthetic failure'})}));await failed.run('openSpotifyMix()');assert.match(failed.node('#spotifyMixStatus').textContent,/Synthetic failure/);
  const malformed=harness(provider({...sources(),playlists:null}));await malformed.run('openSpotifyMix()');assert.match(malformed.node('#spotifyMixStatus').textContent,/invalid Mix source/);
  const partial=harness(provider({...sources(),partial:true}));await partial.run('openSpotifyMix()');assert.match(partial.node('#spotifyMixStatus').textContent,/lookup limit/);assert.equal(partial.node('#spotifyMixStart').disabled,false);
});
test('sparse discovery reports allowlisted source failures without echoing provider text',async()=>{
  const data={...discoverySources(),discoveryTracks:[],partial:true,discoveryWarnings:['musicbrainz-unresolved','listenbrainz-unavailable','listenbrainz-unavailable','<img src=x onerror=1>','__proto__']};const h=harness(provider(data));await h.run('openSpotifyMix()');
  const status=h.node('#spotifyMixStatus').textContent;assert.match(status,/Only 1 unique tracks qualified/);assert.match(status,/could not be matched confidently in MusicBrainz/);assert.equal((status.match(/ListenBrainz related-artist discovery was unavailable/g)||[]).length,1);assert.doesNotMatch(status,/<img|__proto__|Some sources/);assert.equal(h.node('#spotifyMixStart').disabled,true);
  data.discoveryTracks=discoverySources().discoveryTracks;const complete=harness(provider(data));await complete.run('openSpotifyMix()');assert.match(complete.node('#spotifyMixStatus').textContent,/ListenBrainz related-artist discovery was unavailable/);assert.equal(complete.node('#spotifyMixStart').disabled,false);
});
test('preview escapes names and rejects an obsolete starting song',async()=>{
  const data=sources();data.playlists[0].tracks[1].name='<img src=x onerror=1>';const h=harness(provider(data));await h.run('openSpotifyMix()');assert.match(h.node('#spotifyMixTracks').innerHTML,/&lt;img/);assert.doesNotMatch(h.node('#spotifyMixTracks').innerHTML,/<img/);
  const changed=harness(async()=>({ok:true,json:async()=>({item:track(999)})}));await changed.run('openSpotifyMix()');assert.equal(changed.requests.length,1);assert.match(changed.node('#spotifyMixStatus').textContent,/playing song changed/);
});
test('playback failure retains preview; overlapping and stale-account starts are suppressed',async()=>{
  const h=harness(provider());await h.run('openSpotifyMix()');h.context.playSpotifyUri=async()=>false;await h.run('startSpotifyMix()');assert.equal(h.node('#spotifyMixDialog').open,true);assert.equal(h.node('#spotifyMixStart').disabled,false);
  let finish;let calls=0;h.context.playSpotifyUri=()=>{calls++;return new Promise(resolve=>finish=resolve);};const pending=h.run('startSpotifyMix()');h.run('updateSpotifyMixSelection()');await h.run('startSpotifyMix()');assert.equal(calls,1);finish(false);await pending;h.run('++spotifyAccountGeneration');await h.run('startSpotifyMix()');assert.equal(calls,1);
});
test('lookup deadline aborts stalled reads and leaves playback disabled',async()=>{
  let expire;const h=harness((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})))));
  h.context.setTimeout=(callback,delay)=>{assert.equal(delay,60000);expire=callback;return 1;};h.context.clearTimeout=()=>{};
  const pending=h.run('openSpotifyMix()');expire();await pending;assert.match(h.node('#spotifyMixStatus').textContent,/timed out/);assert.equal(h.node('#spotifyMixStart').disabled,true);assert.equal(h.plays.length,0);
});
test('account change during SDK activation prevents playback',async()=>{
  let finish;const calls=[];const context=vm.createContext({activate:()=>new Promise(resolve=>finish=resolve),spotifyPlaybackRequest:async()=>calls.push('start'),showToast:()=>{}});vm.runInContext("let spotifyAccountGeneration=0,spotifyTargetDeviceId='local',spotifyDeviceId='local',spotifyPlayer={activateElement:activate},spotifyPlaybackStateRevision=0,spotifyHasContext=false;",context);vm.runInContext(definition('playSpotifyUri'),context);
  const pending=vm.runInContext(`playSpotifyUri('${seed.uri}')`,context);vm.runInContext('++spotifyAccountGeneration',context);finish();assert.equal(await pending,false);assert.deepEqual(calls,[]);
});
