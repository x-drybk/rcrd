const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const net=require('node:net');

const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
function definition(name){
  const lines=source.split('\n');
  const start=lines.findIndex(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));
  assert.ok(start>=0,`Missing helper ${name}`);
  if(lines[start].trimEnd().endsWith('}'))return lines[start];
  const end=lines.findIndex((line,index)=>index>start&&line.trimEnd()==='}');
  assert.ok(end>start,`Missing helper terminator ${name}`);
  return lines.slice(start,end+1).join('\n');
}
const artistId='A'.repeat(22);
const otherArtistId='B'.repeat(22);
const mbid='11111111-2222-3333-4444-555555555555';
const otherMbid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const spotifyUrl=id=>`https://open.spotify.com/artist/${id}`;
const musicUrl=n=>`https://musicbrainz.org/ws/2/url?resource=${encodeURIComponent(spotifyUrl(String(n).padStart(22,'0')))}&inc=artist-rels&fmt=json`;
const relation=(id=mbid,extra={})=>({'target-type':'artist',artist:{id},...extra});
function json(value,{status=200,headers={}}={}){
  return {ok:status>=200&&status<300,status,headers:{get:name=>headers[name.toLowerCase()]??null},text:async()=>JSON.stringify(value)};
}
const abortError=()=>Object.assign(new Error('Synthetic cancellation'),{name:'AbortError'});
function harness({contact='maintainer@example.org',fetch:fetcher=async()=>json({ok:true}),maxBytes=1024}={}){
  let now=100000;
  let sequence=0;
  const timers=new Map();
  const calls=[];
  const pacing=[];
  const environment=contact===undefined?{}:{RCRD_METADATA_CONTACT:contact};
  function schedule(callback,delay){
    const timer=++sequence;
    const entry={callback,delay,at:now+delay};
    timers.set(timer,entry);
    // Only the documented pacing wait advances automatically; provider timeouts
    // remain under each test's control and never consume wall-clock time.
    if(delay<20000){pacing.push(delay);queueMicrotask(()=>{if(timers.delete(timer)){now=Math.max(now,entry.at);callback();}});}
    return timer;
  }
  const context=vm.createContext({URL,URLSearchParams,Buffer,AbortController,net,process:{env:environment},Date:class extends Date{static now(){return now;}},setTimeout:schedule,clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{calls.push({url,options,at:now});return fetcher(url,options);}});
  vm.runInContext(`const providerTimeoutMs=20000,maxProviderResponseBytes=${maxBytes},appVersion='1.2.0'; const publicMusicState=new Map();`,context);
  for(const name of ['providerResponse','providerObject','discogsRetryAfter','musicMbid','metadataContact','publicMusicJson','musicArtistLinks'])vm.runInContext(definition(name),context);
  const ensure=()=>{};
  return {
    context,calls,pacing,timers,environment,ensure,
    run:code=>vm.runInContext(code,context),
    lookup:(url,check=ensure)=>context.publicMusicJson(url,check),
    provider:(url,options)=>context.providerResponse(url,options),
    links:data=>context.musicArtistLinks(data),
    advance:milliseconds=>{now+=milliseconds;},
    expireProviderTimeout:()=>{for(const [id,timer] of [...timers])if(timer.delay===20000&&timers.delete(id))timer.callback();}
  };
}

test('metadata contact accepts a maintainer email or HTTPS contact page without reading configuration files',()=>{
  for(const value of ['maintainer@example.org',' https://example.org/rcrd/contact ']){
    const h=harness({contact:value});assert.equal(h.run('metadataContact()'),value.trim());
  }
  for(const value of ['', 'not a contact','http://example.org/contact','https://127.0.0.1/contact','https://localhost/contact','https://service.internal/contact','https://example.org/contact?token=private','https://example.org/contact#private','https://user:pass@example.org/contact','maintainer@example.org\r\nAuthorization: secret','https://example.org/(contact)','x'.repeat(201)])assert.equal(harness({contact:value}).run('metadataContact()'),'',value);
});

test('missing or invalid maintainer contact fails before any public request',async()=>{
  for(const contact of ['', 'not a contact']){
    const h=harness({contact});await assert.rejects(h.lookup(musicUrl(1)),{code:'metadata-contact-required'});assert.equal(h.calls.length,0);
  }
});

test('public lookups allow only fixed HTTPS origins and supported metadata paths',async()=>{
  const h=harness();
  const denied=['http://musicbrainz.org/ws/2/url','https://unrelated.example/ws/2/url','https://musicbrainz.org.evil.example/ws/2/url','https://musicbrainz.org:444/ws/2/url','https://user:pass@musicbrainz.org/ws/2/url','https://musicbrainz.org/ws/2/artist','https://musicbrainz.org/ws/2/url#fragment','https://musicbrainz.org/ws/2/isrc/not-an-isrc','https://api.listenbrainz.org/1/lb-radio/artist/'+'-'.repeat(36),`https://api.listenbrainz.org/1/lb-radio/artist/${mbid}/extra`,musicUrl(1)+'&extra='+'x'.repeat(8000)];
  for(const url of denied)await assert.rejects(h.lookup(url),/Unsupported public music lookup/);
  assert.equal(h.calls.length,0);
  await h.lookup(musicUrl(1));
  await h.lookup('https://musicbrainz.org/ws/2/isrc/USABC1234567?inc=artist-credits&fmt=json');
  await h.lookup(`https://api.listenbrainz.org/1/lb-radio/artist/${mbid}?mode=easy`);
  assert.equal(h.calls.length,3);
});

test('public provider headers contain attribution but no credentials, cookies, or private account fields',async()=>{
  const h=harness();await h.lookup(musicUrl(1));const request=h.calls[0];
  assert.equal(request.options.redirect,'error');assert.equal(request.options.headers.Accept,'application/json');assert.equal(request.options.headers['User-Agent'],'RCRD/1.2.0 (maintainer@example.org)');
  assert.deepEqual(Object.keys(request.options.headers).sort(),['Accept','User-Agent']);
  assert.equal(request.options.body,undefined);assert.doesNotMatch(request.url,/access_token|refresh_token|account|playlist|history/i);
});

test('artist links accept exact single and batch Spotify artist URLs and reject URL lookalikes',()=>{
  const h=harness();assert.equal(h.links({resource:spotifyUrl(artistId),relations:[relation()]}).get(artistId),mbid);
  const result=h.links({urls:[{resource:spotifyUrl(artistId),relations:[relation(),relation()]},{resource:spotifyUrl(otherArtistId),relations:[relation(otherMbid)]}]});
  assert.equal(result.size,2);assert.equal(result.get(otherArtistId),otherMbid);
  for(const resource of [spotifyUrl(artistId)+'/',spotifyUrl(artistId)+'?si=anything',spotifyUrl(artistId)+'#fragment',spotifyUrl(artistId).replace('https:','http:'),spotifyUrl(artistId).replace('open.spotify.com','open.spotify.com.evil.example'),'https://open.spotify.com/album/'+artistId])assert.equal(h.links({resource,relations:[relation()]}).size,0);
  assert.equal(h.links({resource:spotifyUrl(artistId),relations:[relation('not-an-mbid')]}).size,0);
});

test('ended and ambiguous artist relationships cannot verify a Spotify artist',()=>{
  const h=harness();
  assert.equal(h.links({resource:spotifyUrl(artistId),relations:[relation(mbid,{ended:true})]}).size,0);
  assert.equal(h.links({resource:spotifyUrl(artistId),relations:[relation(mbid),relation(otherMbid)]}).size,0);
  const rows=[{resource:spotifyUrl(artistId),relations:[relation()]},{resource:spotifyUrl(artistId),relations:[relation(otherMbid)]}];
  assert.equal(h.links({urls:rows}).size,0,'conflicting duplicate URL rows must not become last-row-wins');
  assert.equal(h.links({urls:[...rows,rows[0]]}).size,0,'a later duplicate must not restore an ambiguous mapping');
});

test('artist relationship input is bounded and does not mutate caller metadata',()=>{
  const h=harness();const row={resource:spotifyUrl(artistId),relations:[relation()]};const before=JSON.stringify(row);h.links(row);assert.equal(JSON.stringify(row),before);
  const rows=Array.from({length:40},()=>({resource:'https://unrelated.example',relations:[]}));rows.push(row);assert.equal(h.links({urls:rows}).size,0);
});

test('malformed public JSON and non-object payloads fail visibly instead of becoming cache entries',async()=>{
  for(const text of ['not json','null','[]','"text"']){
    const h=harness({fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>text})});
    await assert.rejects(h.lookup(musicUrl(1)),/invalid JSON response/);await assert.rejects(h.lookup(musicUrl(1)),/invalid JSON response/);assert.equal(h.calls.length,2);
  }
});

test('provider byte limits reject declared, buffered, and streaming oversized responses',async()=>{
  const declared=harness({maxBytes:32,fetch:async()=>({headers:{get:()=>33},text:async()=>{throw new Error('Oversized response must not be read');}})});
  await assert.rejects(declared.provider('https://musicbrainz.org/ws/2/url'),/exceeded the supported size/);assert.equal(declared.calls[0].options.signal.aborted,true);assert.equal(declared.timers.size,0);
  const buffered=harness({maxBytes:32,fetch:async()=>({headers:{get:()=>null},text:async()=>'x'.repeat(33)})});await assert.rejects(buffered.provider('https://musicbrainz.org/ws/2/url'),/exceeded the supported size/);
  let cancelled=0;let read=0;const streaming=harness({maxBytes:32,fetch:async()=>({headers:{get:()=>null},body:{getReader:()=>({read:async()=>++read===1?{value:Buffer.alloc(33),done:false}:{done:true},cancel:async()=>{cancelled++;}})}})});
  await assert.rejects(streaming.provider('https://musicbrainz.org/ws/2/url'),/exceeded the supported size/);assert.equal(cancelled,1);assert.equal(streaming.timers.size,0);
});

test('provider cancellation composes caller abort and internal timeout without leaking listeners',async()=>{
  let listener=null;let removed=0;const signal={aborted:false,addEventListener(name,callback){assert.equal(name,'abort');listener=callback;},removeEventListener(name,callback){assert.equal(name,'abort');assert.equal(callback,listener);removed++;}};
  const h=harness({fetch:async(url,options)=>{assert.notEqual(options.signal,signal);return json({ok:true});}});await h.provider(musicUrl(1),{signal,redirect:'error'});assert.equal(removed,1);assert.equal(h.timers.size,0);
  const pendingFetch=(url,{signal})=>new Promise((resolve,reject)=>{if(signal.aborted)reject(abortError());else signal.addEventListener('abort',()=>reject(abortError()),{once:true});});
  const caller=new AbortController();const cancelled=harness({fetch:pendingFetch});const pending=cancelled.provider(musicUrl(1),{signal:caller.signal});caller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled.timers.size,0);
  const expired=harness({fetch:pendingFetch});const timed=expired.provider(musicUrl(1));expired.expireProviderTimeout();await assert.rejects(timed,{name:'AbortError'});assert.equal(expired.timers.size,0);
  const already=new AbortController();already.abort();const prior=harness({fetch:pendingFetch});await assert.rejects(prior.provider(musicUrl(1),{signal:already.signal}),{name:'AbortError'});assert.equal(prior.timers.size,0);
});

test('public queues pace starts by at least one second independently for each origin',async()=>{
  const h=harness();await Promise.all([h.lookup(musicUrl(1)),h.lookup(musicUrl(2)),h.lookup(musicUrl(3))]);assert.deepEqual(h.calls.map(call=>call.at),[100000,101000,102000]);assert.deepEqual(h.pacing,[1000,1000]);
  await h.lookup(`https://api.listenbrainz.org/1/lb-radio/artist/${mbid}`);assert.equal(h.calls.at(-1).at,102000,'one provider does not impose an artificial delay on the other');assert.equal(h.timers.size,0);
});

test('public 429 and exhausted-budget responses honor cooldown without retries',async()=>{
  let first=true;const h=harness({fetch:async()=>{if(first){first=false;return json({}, {status:429,headers:{'retry-after':'7'}});}return json({ok:true});}});
  await assert.rejects(h.lookup(musicUrl(1)),{status:429});await assert.rejects(h.lookup(musicUrl(2)),{status:429});assert.equal(h.calls.length,1);
  h.advance(7000);await h.lookup(musicUrl(2));assert.equal(h.calls.length,2);
  const exhausted=harness({fetch:async()=>json({ok:true},{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset-in':'5'}})});
  await exhausted.lookup(musicUrl(1));await assert.rejects(exhausted.lookup(musicUrl(2)),{status:429});assert.equal(exhausted.calls.length,1);exhausted.advance(5000);await exhausted.lookup(musicUrl(2));assert.equal(exhausted.calls.length,2);
});

test('public 503 failures use a bounded fallback cooldown and never cache failure responses',async()=>{
  let first=true;const h=harness({fetch:async()=>{if(first){first=false;return json({}, {status:503});}return json({ok:true});}});await assert.rejects(h.lookup(musicUrl(1)),{status:503});h.advance(59000);await assert.rejects(h.lookup(musicUrl(1)),{status:429});assert.equal(h.calls.length,1);h.advance(1000);await h.lookup(musicUrl(1));assert.equal(h.calls.length,2);
});

test('duplicate public lookups share provider work; cache expires and remains bounded to 64 entries',async()=>{
  const h=harness();await Promise.all([h.lookup(musicUrl(1)),h.lookup(musicUrl(1)),h.lookup(musicUrl(1))]);assert.equal(h.calls.length,1);
  for(let i=2;i<=65;i++)await h.lookup(musicUrl(i));assert.equal(h.calls.length,65);await h.lookup(musicUrl(65));assert.equal(h.calls.length,65);await h.lookup(musicUrl(1));assert.equal(h.calls.length,66,'oldest entry is evicted at the 64-entry bound');
  h.advance(86400001);await h.lookup(musicUrl(1));assert.equal(h.calls.length,67,'expired public metadata is fetched again');assert.equal(h.timers.size,0);
});

test('queued or cached lookups still enforce caller cancellation and preserve retryability',async()=>{
  const h=harness();let cancelled=false;const ensure=()=>{if(cancelled)throw Object.assign(new Error('Synthetic cancelled caller'),{status:409});};
  await h.lookup(musicUrl(1),ensure);cancelled=true;await assert.rejects(h.lookup(musicUrl(1),ensure),{status:409});assert.equal(h.calls.length,1);
  await assert.rejects(h.lookup(musicUrl(2),ensure),{status:409});assert.equal(h.calls.length,1);cancelled=false;await h.lookup(musicUrl(2),ensure);assert.equal(h.calls.length,2);
});
