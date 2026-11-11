const defaultCollection=[];
const defaultWantlist=[];
function loadRecords(key,fallback){try{const stored=JSON.parse(localStorage.getItem(key));const records=Array.isArray(stored)?stored.filter(record=>record?.source!=='discogs'):null;const color=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);return Array.isArray(records)&&records.every(record=>record&&typeof record==='object'&&!Array.isArray(record)&&typeof record.title==='string'&&typeof record.artist==='string'&&color(record.tone)&&color(record.accent)&&typeof record.word==='string'&&typeof record.format==='string'&&(record.price==null||typeof record.price==='number'&&Number.isFinite(record.price))&&(record.formatTags==null||Array.isArray(record.formatTags)&&record.formatTags.every(tag=>typeof tag==='string')))?records:fallback}catch{return fallback}}
const preferenceDefaults={volume:65,volumeBeforeMute:65,ambientVisualizerEnabled:false,spotifyLibraryMode:'grid',spotifyLibrarySort:'recent',spotifyPageSize:24,spotifySortDirection:'desc',spotifySearchScope:'library',collectionFilter:'all',collectionSort:'recent',collectionPageSize:24,collectionSortDirection:'desc',wantlistSort:'recent',wantlistPageSize:24,wantlistSortDirection:'desc',discogsSearchSort:'relevance',discogsSearchSortDirection:'desc',discogsFilters:{format:'',condition:'',country:'',genre:'',year:''}};
function allowedPreference(value,allowed,fallback){return allowed.includes(value)?value:fallback}
function loadUiPreferences(){try{const stored=JSON.parse(localStorage.getItem('rcrdUiPreferences')||'{}');const volume=Number.isFinite(Number(stored.volume))?Math.max(0,Math.min(100,Number(stored.volume))):preferenceDefaults.volume;const prior=Number(stored.volumeBeforeMute);return {...preferenceDefaults,...stored,volume,volumeBeforeMute:volume>0?volume:Number.isFinite(prior)&&prior>0?Math.min(100,prior):preferenceDefaults.volumeBeforeMute,ambientVisualizerEnabled:stored.ambientVisualizerEnabled===true,discogsFilters:{...preferenceDefaults.discogsFilters,...(stored.discogsFilters||{})}}}catch{return {...preferenceDefaults,discogsFilters:{...preferenceDefaults.discogsFilters}}}}
const uiPreferences=loadUiPreferences();
let storageWarningShown=false;
function saveUiPreference(key,value){uiPreferences[key]=value;try{localStorage.setItem('rcrdUiPreferences',JSON.stringify(uiPreferences));storageWarningShown=false}catch{if(!storageWarningShown){storageWarningShown=true;showToast('Local changes could not be saved in this browser.')}}}
let localCollection=loadRecords('rcrdCollection',defaultCollection);let localWantlist=loadRecords('rcrdWantlist',defaultWantlist);let collection=[...localCollection];let wantlist=[...localWantlist];let spotifyPageSize=allowedPreference(Number(uiPreferences.spotifyPageSize),[12,24,48],24);let collectionPage=1;let collectionPageSize=allowedPreference(Number(uiPreferences.collectionPageSize),[12,24,48],24);let collectionFilter=allowedPreference(uiPreferences.collectionFilter,['all','vinyl','cd'],'all');let collectionSort=allowedPreference(uiPreferences.collectionSort,['recent','artist','title','year','format'],'recent');let wantlistPage=1;let wantlistPageSize=allowedPreference(Number(uiPreferences.wantlistPageSize),[12,24,48],24);let wantlistSort=allowedPreference(uiPreferences.wantlistSort,['recent','artist','title','year','format'],'recent');let spotifyLibraryPage=1;let spotifyCatalogPage=1;let discogsSearchPage=1;let discogsSearchSort=allowedPreference(uiPreferences.discogsSearchSort,['relevance','artist','title','year','format'],'relevance');let discogsSearchResults=[];let discogsSearchPagination={};
let recentTracksData=[];
let spotifyPlayCounts=new Map();let spotifyPlayCountFetchedAt=new Map();let spotifyPlayCountTimer=null;let spotifyPlayCountRevision=0;
function playCountText(result){return Number.isSafeInteger(result?.plays)&&result.plays>0?`${result.match==='song'?'≈ ':''}${result.plays.toLocaleString()}`:result===undefined?'Checking…':'Not recorded'}
function playCountTitle(result){return result?.match==='song'?'Matched by song title and artist in the imported history; the recording may differ.':result?.match==='ambiguous'?'Several imported recordings match this title and artist; a count cannot be assigned safely.':result?.match==='unrecorded'?'No reliable match in imported or recently collected plays.':'Recorded plays for this Spotify track ID.'}
let spotifyPassiveSyncAt=0;let spotifyPassiveSyncBusy=false;
async function syncPassiveSpotifyPlays(){
  if(!spotifyConnected||document.visibilityState!=='visible'||spotifyPassiveSyncBusy||Date.now()-spotifyPassiveSyncAt<300000)return;
  spotifyPassiveSyncAt=Date.now();spotifyPassiveSyncBusy=true;const generation=spotifyAccountGeneration;
  try{const response=await fetch('/api/spotify/play-counts');if(response.ok&&generation===spotifyAccountGeneration&&document.querySelector('.active-view')?.id==='spotify'&&spotifyLibraryLoaded){spotifyPlayCountFetchedAt.clear();renderSpotifyLibrary(document.querySelector('#searchInput').value,spotifyLibraryPage)}}catch{}finally{spotifyPassiveSyncBusy=false}
}
function resetSpotifyPlayCounts(){spotifyPlayCounts.clear();spotifyPlayCountFetchedAt.clear();clearTimeout(spotifyPlayCountTimer);spotifyPlayCountTimer=null;spotifyPassiveSyncAt=0;++spotifyPlayCountRevision;const info=document.querySelector('#spotifyPlayCountInfo');if(info){info.hidden=true;info.querySelector('details')?.removeAttribute('open')}const checked=document.querySelector('#spotifyPlayCountChecked');if(checked)checked.textContent='Play counts not checked yet.'}
function scheduleSpotifyPlayCounts(records){
  clearTimeout(spotifyPlayCountTimer);
  if(!spotifyConnected||document.querySelector('.active-view')?.id!=='spotify')return;
  const tracks=[...new Map(records.filter(record=>record.kind==='track'&&/^spotify:track:[A-Za-z0-9]+$/.test(record.uri||'')).map(record=>[record.uri,{uri:record.uri,title:record.title,artist:record.artist}])).values()];
  const missing=tracks.filter(record=>Date.now()-(spotifyPlayCountFetchedAt.get(record.uri)||0)>300000);
  if(!missing.length)return;
  const revision=++spotifyPlayCountRevision;const generation=spotifyAccountGeneration;
  spotifyPlayCountTimer=setTimeout(async()=>{
    try{
      let data,recentUnavailable=false;
      for(let offset=0;offset<missing.length;offset+=48){
        if(generation!==spotifyAccountGeneration||revision!==spotifyPlayCountRevision||!spotifyConnected||document.querySelector('.active-view')?.id!=='spotify')return;
        const batch=missing.slice(offset,offset+48);
        const response=await fetch('/api/spotify/play-counts',{method:'POST',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({tracks:batch})});data=await response.json();
        if(generation!==spotifyAccountGeneration||revision!==spotifyPlayCountRevision||!spotifyConnected||document.querySelector('.active-view')?.id!=='spotify')return;
        if(!response.ok)throw new Error(data.error||'Could not update play counts');
        recentUnavailable=recentUnavailable||data.recentUnavailable===true;
        for(const record of batch){const count=data.counts?.[record.uri];const match=data.matches?.[record.uri];if((Number.isSafeInteger(count)&&count>0||count===null)&&['exact','song','ambiguous','unrecorded'].includes(match)){spotifyPlayCounts.set(record.uri,{plays:count,match});spotifyPlayCountFetchedAt.set(record.uri,Date.now())}}
        if(missing.length>48)document.querySelector('#spotifyPlayCountChecked').textContent=`Checking play counts for sorting… ${Math.min(offset+48,missing.length)} of ${missing.length}`;
      }
      document.querySelectorAll('#spotifyGrid [data-play-count-uri]').forEach(node=>{const result=spotifyPlayCounts.get(node.dataset.playCountUri);if(result){node.querySelector('strong').textContent=playCountText(result);node.title=playCountTitle(result)}});
      const checked=Number.isSafeInteger(data.lastSynced)?`Last checked ${new Date(data.lastSynced).toLocaleString()}.`:'Play counts checked.';
      document.querySelector('#spotifyPlayCountChecked').textContent=recentUnavailable?`Recent Spotify plays could not be checked. ${checked}`:checked;
      if(typeof spotifyLibrarySort!=='undefined'&&spotifyLibrarySort==='plays'&&spotifySearchMode==='library'&&!spotifyCatalogAlbumView&&document.querySelector('.active-view')?.id==='spotify'&&missing.every(record=>spotifyPlayCountFetchedAt.has(record.uri)))renderSpotifyLibrary(document.querySelector('#searchInput').value,spotifyLibraryPage,true);
    }catch(error){if(generation===spotifyAccountGeneration&&revision===spotifyPlayCountRevision)document.querySelector('#spotifyPlayCountChecked').textContent=`Could not update play counts: ${error.message}`}
  },250);
}
let spotifyLibraryPlaybackRecords=[];
let playing=false;
let spotifyPlayer=null;let spotifyPlayerConnectFailed=false;let spotifyDeviceId=null;let spotifyTargetDeviceId=null;let spotifyTargetSupportsVolume=true;let spotifyDeviceRequestRevision=0;let spotifyDeviceRefreshTimer=null;let spotifyDeviceRefreshBusy=0;let spotifyDeviceRefreshEnabled=false;let spotifySyncTimer=null;let spotifyProgressTimer=null;let spotifyPlayerReadyTimer=null;let spotifyTrackUri=null;let spotifyDurationMs=0;let spotifyPositionMs=0;let spotifyProgressUpdatedAt=0;let spotifyPlaybackStateRevision=0;let spotifySdkStateRevision=0;let spotifySkipQueue=Promise.resolve();let spotifySkipPending=0;let spotifySkipBusy={next:0,previous:0};let spotifyToggleQueue=Promise.resolve();let spotifyTogglePending=0;let spotifyModeQueue=Promise.resolve();let spotifyPlaybackStartPending=0;let volume=uiPreferences.volume/100;let volumeBeforeMute=uiPreferences.volumeBeforeMute/100;let shuffleEnabled=false;let repeatMode='off';let spotifyHasContext=false;let shuffleRequestPending=false;let shuffleRevision=0;let repeatRequestPending=false;let repeatRevision=0;
let spotifyHealthConnection=null;let spotifyCanStream=null;let spotifyPlayerState='waiting';let spotifyPlayerIssue='';let spotifyActiveDevice='Not checked';let availableSpotifyDevices=new Map();
let spotifyCanModifyLibrary=false;let likedStatus=null;let likedRequestRevision=0;let likedCheckPending=false;let likedMutationPending=false;
let spotifyMixRevision=0;let spotifyMixController=null;let spotifyMixPreview=null;
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))}
function safeImageUrl(value){try{const parsed=new URL(value);return parsed.protocol==='https:'?parsed.href:''}catch{return ''}}
function discogsWebUrl(result){const value=String(result?.uri||'').trim();try{const parsed=new URL(value,'https://www.discogs.com');if(parsed.protocol==='https:'&&parsed.hostname==='www.discogs.com'&&/^\/(release|master)\/[^/]+/.test(parsed.pathname))return parsed.href}catch{}const id=Number(result?.id||result?.releaseId);return Number.isSafeInteger(id)&&id>0?`https://www.discogs.com/release/${id}`:'https://www.discogs.com'}
function discogsDataCredit(result){const href=discogsWebUrl(result);return href==='https://www.discogs.com'?'':`<a class="discogs-data-credit" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Data provided by Discogs.</a>`}
function cover(a,extra=''){const image=safeImageUrl(a.image);return `<div class="cover ${extra}" style="--cover:${a.tone};--accent:${a.accent}">${image?`<img src="${escapeHtml(image)}" alt="" loading="lazy" />`:`<span class="cover-word">${escapeHtml(a.word).replaceAll('\n','<br>')}</span><span class="disc"></span>`}</div>`}
document.querySelector('#recommendations').innerHTML='<p class="empty-state">Checking your Spotify connection…</p>';
document.querySelector('#spotifyGrid').innerHTML='<p class="empty-state">Checking your Spotify connection…</p>';
function renderPagination(id,page,total,pageSize,target,showEdges=false){
  const nav=document.querySelector(`#${id}`);if(!nav)return;
  const pages=Math.ceil(total/pageSize);if(pages<=1){nav.innerHTML='';return}
  const start=Math.max(1,page-2);const end=Math.min(pages,page+2);
  let buttons=showEdges?`<button data-page-target="${target}" data-page="1" ${page===1?'disabled':''} aria-label="First page">First</button>`:'';
  buttons+=`<button data-page-target="${target}" data-page="${page-1}" ${page===1?'disabled':''} aria-label="Previous page">←</button>`;
  for(let value=start;value<=end;value+=1)buttons+=`<button data-page-target="${target}" data-page="${value}" class="${value===page?'active':''}" ${value===page?'aria-current="page"':''}>${value}</button>`;
  buttons+=`<button data-page-target="${target}" data-page="${page+1}" ${page===pages?'disabled':''} aria-label="Next page">→</button>`;
  if(showEdges)buttons+=`<button data-page-target="${target}" data-page="${pages}" ${page===pages?'disabled':''} aria-label="Last page">Last</button>`;
  nav.innerHTML=buttons+`<span>Page ${page} of ${pages}</span>`;
}
function sortRecords(items,mode,direction=['recent','year'].includes(mode)?'desc':'asc'){const records=[...items];const valueFor=(entry,field)=>{const record=entry.a||entry;const value=field==='album'?(record.album||record.title):record[field];return String(value||'').trim()};if(mode==='relevance'||(mode==='recent'&&!records.some(entry=>valueFor(entry,'addedAt'))))return direction==='asc'?records.reverse():records;return records.sort((left,right)=>{const field=mode==='recent'?'addedAt':mode;if(mode==='plays'){const count=entry=>{const record=entry.a||entry;const value=spotifyPlayCounts.get(record.uri)?.plays;return record.kind==='track'&&Number.isSafeInteger(value)&&value>0?value:null};const a=count(left),b=count(right);if(a===null)return b===null?0:1;if(b===null)return-1;return direction==='desc'?b-a:a-b}const a=valueFor(left,field);const b=valueFor(right,field);if(!a&&b)return 1;if(a&&!b)return-1;const order=a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});return direction==='desc'?-order:order})}
function formatTagsFor(record){if(Array.isArray(record.formatTags)&&record.formatTags.length)return record.formatTags;const value=String(record.format||'').toLowerCase();const tags=[];if(/\bvinyl\b|\blp\b|\b12["″]?\b|\b10["″]?\b|\b7["″]?\b|shellac/.test(value))tags.push('vinyl');if(/\bcd\b|compact disc/.test(value))tags.push('cd');if(/cassette|\btape\b/.test(value))tags.push('cassette');return tags.length?tags:['other']}
function renderCollection(){const matching=sortRecords(collection.map((a,index)=>({a,index})).filter(({a})=>collectionFilter==='all'||formatTagsFor(a).includes(collectionFilter)),collectionSort,document.querySelector('#collectionSortDirection').value);const pages=Math.max(1,Math.ceil(matching.length/collectionPageSize));collectionPage=Math.min(collectionPage,pages);const offset=(collectionPage-1)*collectionPageSize;const records=matching.slice(offset,offset+collectionPageSize);document.querySelector('#collectionGrid').innerHTML=records.map(({a,index})=>{const title=String(a.title||'').trim();const artist=String(a.artist||'').trim();const search=title&&title!=='Untitled release'?[title,artist==='Unknown artist'?'':artist].filter(Boolean).join(' ').slice(0,200).trim():'';const spotifyButton=search?`<button type="button" class="collection-spotify" data-title="${escapeHtml(title)}" data-artist="${escapeHtml(artist==='Unknown artist'?'':artist)}" aria-label="Find ${escapeHtml(title)} in Spotify">Find in Spotify →</button>`:'';return `<article class="collection-card" data-title="${escapeHtml(`${a.title} ${a.artist}`.toLowerCase())}" data-format="${escapeHtml(formatTagsFor(a).join(' '))}">${cover(a)}<div class="album-meta">${a.source==='discogs'?'':`<button class="remove-record" data-list="collection" data-index="${index}" aria-label="Remove ${escapeHtml(a.title)} from collection">×</button>`}<h3>${escapeHtml(a.title)}</h3><p>${artistSearchButton(a.artist,'discogs')} · ${escapeHtml(a.year)}</p>${a.source==='discogs'?'':`<div class="value">EST. VALUE ${a.price}</div>`}${spotifyButton}${a.source==='discogs'?discogsDataCredit(a):''}</div></article>`}).join('')||`<p class="empty-state">${collectionFilter==='all'?'Your Discogs collection is ready for its first record.':`No ${escapeHtml(collectionFilter)} records were found.`}</p>`;renderPagination('collectionPagination',collectionPage,matching.length,collectionPageSize,'collection')}
function renderWantlist(){const ordered=sortRecords(wantlist.map((a,index)=>({a,index})),wantlistSort,document.querySelector('#wantlistSortDirection').value);const pages=Math.max(1,Math.ceil(ordered.length/wantlistPageSize));wantlistPage=Math.min(wantlistPage,pages);const offset=(wantlistPage-1)*wantlistPageSize;const records=ordered.slice(offset,offset+wantlistPageSize);document.querySelector('#wantlistGrid').innerHTML=records.map(({a,index})=>{const releaseId=Number(a.releaseId);const releaseLink=a.source==='discogs'&&Number.isSafeInteger(releaseId)&&releaseId>0?`<a class="wantlist-shop" href="https://www.discogs.com/release/${releaseId}" target="_blank" rel="noopener noreferrer">Shop on Discogs ↗</a>`:'';return `<article class="want-card" data-title="${escapeHtml(`${a.title} ${a.artist}`.toLowerCase())}">${cover(a)}<div><h3>${escapeHtml(a.title)}</h3><p>${artistSearchButton(a.artist,'discogs')} · ${escapeHtml(a.year)}</p><button class="find-listing" data-album="${escapeHtml(`${a.artist} ${a.title}`)}">Find editions →</button>${releaseLink}${a.source==='discogs'?discogsDataCredit(a):''}${a.source==='discogs'?'':`<button class="remove-record secondary-action" data-list="wantlist" data-index="${index}">Remove</button>`}</div></article>`}).join('')||'<p class="empty-state">Your Discogs wantlist is clear.</p>';renderPagination('wantlistPagination',wantlistPage,ordered.length,wantlistPageSize,'wantlist')}
renderCollection();renderWantlist();
function renderCatalogPrompt(){discogsSearchResults=[];discogsSearchPagination={};document.querySelector('#marketGrid').innerHTML='<p class="empty-state">Search for an artist, album, or track above to explore releases on Discogs.</p>';document.querySelector('#marketResults').textContent='Search the Discogs catalog';document.querySelector('#marketPagination').innerHTML=''}
let discogsSearchSequence=0;let discogsSearchTimer=null;let discogsMasterId=null;let discogsMasterTitle='';
function renderListeningDiscogsSuggestions(items,message='No recent Spotify plays yet. Play something on Spotify, then return here.'){const target=document.querySelector('#listeningDiscogsSuggestions');if(!target)return;const seen=new Set();const distinct=items.map((track,index)=>({track,index})).filter(({track})=>{const key=track[6]||[track[1],track[2]].join('|').toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).slice(0,3);target.innerHTML=distinct.map(({track:t,index:i})=>`<button class="discogs-suggestion track-discogs" data-track="${i}" aria-label="Search ${escapeHtml(t[1])} by ${escapeHtml(t[2].split(' · ')[0])} in Discogs"><span><strong>${escapeHtml(t[1])}</strong><small>${escapeHtml(t[2])}</small></span><b>Search ↗</b></button>`).join('')||`<p class="empty-state">${escapeHtml(message)}</p>`}
function renderRecentTracks(items=[]){recentTracksData=items;const target=document.querySelector('#recentTracks');if(target)target.innerHTML=items.map((t,i)=>`<div class="track"><span class="track-num">${String(i+1).padStart(2,'0')}</span><div class="track-cover" style="--cover:${t[4]}">${t[5]?`<img src="${escapeHtml(t[5])}" alt="" loading="lazy" />`:''}</div><div><strong>${escapeHtml(t[1])}</strong><small>${escapeHtml(t[2])}</small></div><button class="track-play" data-track="${i}" aria-label="Play ${escapeHtml(t[1])}">▶</button><button class="track-discogs" data-track="${i}" aria-label="Search ${escapeHtml(t[1])} in Discogs">Discogs ↗</button><time>${escapeHtml(t[3])}</time>${/^spotify:track:([A-Za-z0-9]{22})$/.test(t[6]||'')?`<a class="spotify-source-link" href="https://open.spotify.com/track/${t[6].slice(-22)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(t[1])} on Spotify" title="Open Spotify"><img src="assets/spotify-icon-white.svg" alt="" /></a>`:''}</div>`).join('')||'<p class="empty-state">No recently played Spotify tracks were found.</p>';renderListeningDiscogsSuggestions(items)}
renderListeningDiscogsSuggestions([],'Checking your Spotify connection…');
function persist(){try{localStorage.setItem('rcrdCollection',JSON.stringify(localCollection.filter(record=>record.source!=='discogs')));localStorage.setItem('rcrdWantlist',JSON.stringify(localWantlist.filter(record=>record.source!=='discogs')));storageWarningShown=false}catch{if(!storageWarningShown){storageWarningShown=true;showToast('Local changes could not be saved in this browser.')}}document.querySelector('#collectionCount').textContent=collection.length;document.querySelector('#wantCount').textContent=wantlist.length}
persist();
function showToast(text){const e=document.querySelector('#toast');e.textContent=text;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2300)}
function renderPlaybackHealth(){
  const connected=spotifyHealthConnection===true;
  const playerLabels={waiting:'Waiting for player',starting:'Starting player',delayed:'Still connecting',ready:'Ready',offline:'Offline',error:'Unavailable'};
  const permissionMissing=connected&&spotifyCanStream===false;
  const playerLabel=permissionMissing?'Playback permission needed':connected?playerLabels[spotifyPlayerState]||'Unavailable':'Not available';
  document.querySelector('#playbackHealthConnection').textContent=spotifyHealthConnection===null?'Unavailable':connected?'Connected':'Not connected';
  document.querySelector('#playbackHealthPlayer').textContent=playerLabel;
  document.querySelector('#playbackHealthDevice').textContent=connected?spotifyActiveDevice:'Not available';
  document.querySelector('#playbackHealthHelp').textContent=!connected?'Connect Spotify to use the RCRD player.':permissionMissing?'Spotify did not grant playback permission. Reconnect Spotify from Settings to approve playback in RCRD.':spotifyPlayerIssue||'Player readiness and the active device are checked separately.';
  const toggle=document.querySelector('#playbackHealthToggle');
  toggle.textContent=connected?`Player: ${playerLabel}`:spotifyHealthConnection===null?'Spotify status unavailable':'Connect Spotify';
  toggle.title=toggle.textContent;
  toggle.classList.toggle('is-ready',connected&&spotifyPlayerState==='ready');
  const retry=document.querySelector('#playbackHealthRetry');
  retry.hidden=!connected||permissionMissing;retry.disabled=spotifyPlayerState==='starting';
  retry.textContent=spotifyPlayerState==='starting'?'Connecting…':spotifyPlayerState==='ready'?'Reconnect RCRD player':'Retry player';
  retry.title='Register this RCRD window as a Spotify playback device again';
  document.querySelector('#playbackDeviceLoad').hidden=!connected;
}
document.addEventListener('click',e=>{const nav=e.target.closest('[data-view]');if(nav){e.preventDefault();document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.remove('active'));document.querySelector('#'+nav.dataset.view).classList.add('active-view');if(nav.closest('.sidebar'))nav.classList.add('active');window.scrollTo(0,0);updateSearchContext();if(nav.id==='openPlaylists')document.querySelector('#spotifyPlaylistSelect').focus();if(apiConnected&&['collection','wantlist'].includes(nav.dataset.view))refreshDiscogsSection(nav.dataset.view)}if(e.target.matches('.remove-record')){const list=e.target.dataset.list;const index=+e.target.dataset.index;const removed=(list==='collection'?collection:wantlist)[index];if(list==='collection')collection.splice(index,1);else wantlist.splice(index,1);if(removed?.source!=='discogs'){const saved=list==='collection'?localCollection:localWantlist;const savedIndex=saved.indexOf(removed);if(savedIndex!==-1)saved.splice(savedIndex,1)}persist();renderCollection();renderWantlist();showToast(`${removed.title} removed from ${list==='collection'?'collection':'wantlist'}`)}if(e.target.matches('.find-listing')){searchInDiscogs(e.target.dataset.album,'')}const discogsTrack=e.target.closest('.track-discogs');if(discogsTrack){const t=recentTracksData[+discogsTrack.dataset.track];searchInDiscogs(t[1],t[2].split(' · ')[0])}if(e.target.matches('.track-play')){const t=recentTracksData[+e.target.dataset.track];if(!t?.[6])showToast('This Spotify track is not playable')}if(e.target.matches('.chip')){document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));e.target.classList.add('active');document.querySelectorAll('.collection-card').forEach(c=>c.style.display=e.target.dataset.filter==='all'||c.dataset.format===e.target.dataset.filter?'block':'none')} });
let activeSearchView='home';let lastSearchContext='spotify';let returnView='home';let spotifyLibraryAlbums=[];let spotifySavedAlbums=[];let spotifyLibraryTracks=[];let spotifyHomeRecommendations=[];let spotifyTopAlbums=[];let spotifyTopRequest=null;let spotifyCanReadTop=false;let homeDiscoveryMode='recent';let spotifyLibraryLoaded=false;let spotifySavedLibraryLoaded=false;let spotifyPlaylistPreviewState=null;let spotifyLibraryPromise=null;let spotifyLibraryError='';let spotifyLibraryRevision=0;let spotifyLibraryNeedsRefresh=false;let spotifyLibraryMode=allowedPreference(uiPreferences.spotifyLibraryMode,['grid','list'],'grid');let spotifyLibrarySort=allowedPreference(uiPreferences.spotifyLibrarySort,['recent','title','artist','album','year','plays'],'recent');let spotifySearchMode=allowedPreference(uiPreferences.spotifySearchScope,['library','catalog'],'library');let spotifySearchSequence=0;let spotifySearchTimer=null;let spotifySearchCompletion=null;let discogsFilters={...uiPreferences.discogsFilters};
let collectionSpotifyLookup=null;
let spotifyCatalogResults=[];let spotifyCatalogAlbumView=null;
let spotifyLibraryProgressTimer=null;let spotifyLibraryProgressBusy=false;let spotifyLibraryLastUpdated=0;let spotifyLibraryLastUpdatedGeneration=-1;let spotifyLibrarySyncSource='live';let spotifyNoticeTimer=null;
function libraryUpdatedLabel(timestamp){return Number.isSafeInteger(timestamp)&&timestamp>0?new Date(timestamp).toLocaleString():'time unknown'}
function spotifySourceLabel(source){return source==='stale-cache'?'Previously loaded data · Spotify unavailable':''}
function spotifySyncLabel(source,updatedAt){return [spotifySourceLabel(source),Number.isSafeInteger(updatedAt)&&updatedAt>0?`updated ${libraryUpdatedLabel(updatedAt)}`:''].filter(Boolean).join(' · ')}
function savedLibraryFreshnessNote(){if(spotifyLibraryLastUpdatedGeneration!==spotifyAccountGeneration)return 'Waiting for sync details.';return spotifySyncLabel(spotifyLibrarySyncSource,spotifyLibraryLastUpdated)||'Saved library ready.'}
function cacheTimestampLabel(source,updatedAt){const time=Number.isSafeInteger(updatedAt)&&updatedAt>0?`Updated ${libraryUpdatedLabel(updatedAt)}`:'Update time unavailable';return source==='stale-cache'?`${time} · May be outdated`:time}
function scheduleSpotifyCatalogNoticeDismissal(){if(spotifySearchMode!=='catalog')return;const generation=spotifyAccountGeneration;spotifyNoticeTimer=setTimeout(()=>{if(generation===spotifyAccountGeneration&&spotifySearchMode==='catalog')document.querySelector('#spotifyScopeNotice').hidden=true;spotifyNoticeTimer=null},4000)}
function showSpotifyLibraryNotice(message){clearTimeout(spotifyNoticeTimer);spotifyNoticeTimer=null;document.querySelector('#spotifyLibraryNote').textContent=message;document.querySelector('#spotifyScopeNotice').hidden=false;const meta=document.querySelector('#spotifyCacheMeta');meta.hidden=true;meta.textContent='';scheduleSpotifyCatalogNoticeDismissal()}
function settleSpotifyLibraryNotice(source,updatedAt,message){showSpotifyLibraryNotice(message);if(source==='stale-cache'||spotifySearchMode==='catalog')return;const notice=document.querySelector('#spotifyScopeNotice');const meta=document.querySelector('#spotifyCacheMeta');meta.textContent=cacheTimestampLabel(source,updatedAt);const generation=spotifyAccountGeneration,playlist=document.querySelector('#spotifyPlaylistSelect').value;spotifyNoticeTimer=setTimeout(()=>{if(generation!==spotifyAccountGeneration||spotifySearchMode!=='library'||playlist!==document.querySelector('#spotifyPlaylistSelect').value||document.querySelector('#spotifyLibraryNote').textContent!==message)return;notice.hidden=true;meta.hidden=false;spotifyNoticeTimer=null},4000)}
async function pollSpotifyLibraryProgress(generation,revision){
  if(spotifyLibraryProgressBusy||generation!==spotifyAccountGeneration||revision!==spotifyLibraryRevision||!spotifyConnected)return;
  spotifyLibraryProgressBusy=true;
  try{const response=await fetch('/api/spotify/library-progress');if(!response.ok)return;const progress=await response.json();if(generation!==spotifyAccountGeneration||revision!==spotifyLibraryRevision||!progress.active)return;const part=progress.phase==='albums'?'albums':'tracks';const value=progress[part]||{};const count=Number(value.loaded)||0;const total=Number.isSafeInteger(value.total)?` of ${value.total}`:'';showSpotifyLibraryNotice(progress.phase==='recent'?'Saved library sync: finishing recently played tracks…':`Saved library sync: ${count}${total} ${part} loaded…`);}catch{}finally{spotifyLibraryProgressBusy=false}
}
function updateSearchContext(){const search=document.querySelector('#searchInput');const view=document.querySelector('.active-view')?.id||'home';document.querySelector('.search').hidden=['guide','settings'].includes(view);syncSpotifySortControls();activeSearchView=view==='home'?'spotify':view;if(view==='home')search.placeholder='Search all of Spotify…';else search.placeholder=activeSearchView==='spotify'?(spotifySearchMode==='catalog'?'Search all of Spotify…':(document.querySelector('#spotifyPlaylistSelect').value?'Search this Spotify playlist…':'Search your Spotify library…')):'Search the Discogs catalog…'}
function searchInDiscogs(title,artist){const query=String(title||'').trim();returnView=document.querySelector('.active-view')?.id||'home';document.querySelector('[data-view="market"]').click();document.querySelector('#marketBack').hidden=returnView==='market';document.querySelector('#discogsArtist').value=artist||'';document.querySelector('#discogsReleaseTitle').value='';document.querySelector('#discogsCatno').value='';document.querySelector('#discogsBarcode').value='';document.querySelector('#searchInput').value=query;searchDiscogsApi(query);showToast(`Searching Discogs for ${[artist,query].filter(Boolean).join(' · ')}`)}
function artistSearchButton(artist,provider){const name=String(artist||'').trim();if(!name||name==='Unknown artist'||!['spotify','discogs'].includes(provider))return escapeHtml(name);return `<button type="button" class="artist-search-link" data-artist="${escapeHtml(name)}" data-provider="${provider}" aria-label="Search ${provider==='spotify'?'Spotify':'Discogs'} for ${escapeHtml(name)}">${escapeHtml(name)}</button>`}
function searchForArtist(artist,provider){
  if(typeof artist!=='string'||!['spotify','discogs'].includes(provider))return;
  const query=artist.trim().replace(/\s*\(\d+\)$/,'').slice(0,200).trim();if(!query||query==='Unknown artist')return;
  if(provider==='spotify'){
    if(!spotifyConnected){showToast('Connect Spotify to search artists.');return}
    collectionSpotifyLookup=null;spotifyCatalogAlbumView=null;document.querySelector('#searchInput').value='';
    document.querySelector('.sidebar nav a[data-view="spotify"]').click();setSpotifySearchScope('catalog');
    document.querySelector('#searchInput').value=query;updateSearchContext();searchSpotifyCatalog(query);
  }else{
    for(const name of ['Format','Condition','Country','Genre','Year'])document.querySelector('#discogs'+name).value='';
    syncDiscogsThemedSelects();searchInDiscogs('',query);
  }
}
document.addEventListener('click',event=>{const artist=event.target.closest('.artist-search-link');if(artist){event.preventDefault();searchForArtist(artist.dataset.artist,artist.dataset.provider)}});
function searchInSpotify(title,artist){const cleanTitle=String(title||'').trim();if(!cleanTitle)return;const cleanArtist=String(artist||'').trim().replace(/\s*\(\d+\)$/,'');const query=[cleanTitle,cleanArtist].filter(Boolean).join(' ').slice(0,200).trim();document.querySelector('.sidebar nav a[data-view="home"]').click();collectionSpotifyLookup={title:cleanTitle,artist:cleanArtist,query};document.querySelector('#searchInput').value=query;filterCards(query)}
document.querySelector('#heroRecordSearch').addEventListener('submit',event=>{event.preventDefault();const input=document.querySelector('#heroRecordQuery');const query=input.value.trim();if(!query){input.focus();return}for(const name of ['Condition','Country','Genre','Year'])document.querySelector('#discogs'+name).value='';document.querySelector('#discogsFormat').value=document.querySelector('#heroRecordSearch input[name="recordFormat"]:checked').value;syncDiscogsThemedSelects();searchInDiscogs(query,'')});
renderCatalogPrompt();
let spotifyHomeNextRefresh=0;let spotifyHomeRateLimitedUntil=0;let spotifyHomeRequest=null;let spotifyAccountGeneration=0;
let apiConnected=false;let spotifyConnected=false;let discogsAccountGeneration=0;const discogsRefreshSequence={collection:0,wantlist:0};const discogsLoadedAt={collection:0,wantlist:0};const discogsRefreshRequest={collection:null,wantlist:null};const DISCOGS_LIST_FRESH_MS=60000;
const discogsLastFailureAt={collection:0,wantlist:0};
function renderApiResults(results,pagination={}){
  discogsSearchResults=results;discogsSearchPagination=pagination;
  const sortable=results.filter(Boolean).map(item=>{const parts=String(item.title||'').split(' - ');const artist=parts.length>1?parts.shift():'';const title=parts.length?parts.join(' - '):String(item.title||'');return {item,artist,title,album:title,year:item.year,format:(item.format||[]).join(', ')}});
  const safeResults=sortRecords(sortable,discogsSearchSort,document.querySelector('#discogsSearchSortDirection').value).map(entry=>entry.item);
  const cards=safeResults.map(r=>{
    const image=safeImageUrl(r.cover_image);const parts=String(r.title||'').split(' - ');const artist=parts.length>1?parts.shift():'';const title=parts.length?parts.join(' - '):String(r.title||'');const match=shelfMatch(title,artist,Number(r.id));
    const releaseId=Number(r.id);const canCompare=Number.isSafeInteger(releaseId)&&releaseId>0;
    const masterId=Number(r.master_id);const versions=Number.isSafeInteger(masterId)&&masterId>0&&!discogsMasterId?`<button type="button" class="master-versions" data-master-id="${masterId}" data-master-title="${escapeHtml(r.title||'This album')}">Explore editions →</button>`:'';
    return `<article class="market-card api-card" data-title="${escapeHtml((r.title||'').toLowerCase())}"><div class="api-cover">${image?`<img src="${escapeHtml(image)}" alt="" loading="lazy" />`:'<span>RCRD</span>'}</div><div class="market-meta"><h3>${artist?`${artistSearchButton(artist,'discogs')} - ${escapeHtml(title)}`:escapeHtml(r.title||'Untitled release')}</h3><p>${escapeHtml(r.year||'Year unknown')} · ${escapeHtml((r.format||[]).join(', ')||'Release')}</p>${shelfBadges(match)}<div class="listing-footer"><button class="api-collection" data-release-id="${Number(r.id)||0}" ${match.collection==='exact'?'disabled':''}>${match.collection==='exact'?'In collection':'+ Collection'}</button><button class="api-wantlist" data-release-id="${Number(r.id)||0}" ${match.wantlist==='exact'?'disabled':''}>${match.wantlist==='exact'?'In wantlist':'+ Wantlist'}</button></div>${canCompare?`<button type="button" class="pressing-compare-select" data-release-id="${releaseId}" aria-pressed="${pressingCompareSelected.has(releaseId)}">${pressingCompareSelected.has(releaseId)?'✓ Selected':'Compare'}</button>`:''}${versions}${discogsDataCredit(r)}</div></article>`
  }).join('');
  document.querySelector('#marketGrid').innerHTML=cards||'<p class="empty-state">No Discogs releases matched this search.</p>';document.querySelector('#marketResults').textContent=discogsMasterId?`${Number(pagination.items||safeResults.length)} editions · ${discogsMasterTitle}`:`${Number(pagination.items||safeResults.length)} Discogs releases`;renderPagination('marketPagination',Number(pagination.page||1),Number(pagination.items||safeResults.length),Number(pagination.per_page||24),'discogs-search');renderPressingCompareSelection()
}
async function searchDiscogsApi(query,page=1){clearTimeout(discogsSearchTimer);discogsSearchTimer=null;discogsMasterId=null;document.querySelector('#discogsVersionsBack').hidden=true;const sequence=++discogsSearchSequence;const identifiers={artist:document.querySelector('#discogsArtist').value.trim(),release_title:document.querySelector('#discogsReleaseTitle').value.trim(),catno:document.querySelector('#discogsCatno').value.trim(),barcode:document.querySelector('#discogsBarcode').value.trim()};if(!query.trim()&&!Object.values(identifiers).some(Boolean)){renderCatalogPrompt();return;}discogsSearchPage=page;document.querySelector('#marketResults').textContent='Searching Discogs…';try{const params=new URLSearchParams({q:query.trim(),page:String(discogsSearchPage),...collectDiscogsFilters(),...identifiers});const response=await fetch(`/api/search?${params}`);const data=await response.json();if(sequence!==discogsSearchSequence)return;if(!response.ok)throw new Error(data.error||'Discogs search failed');renderApiResults(data.results||[],data.pagination||{})}catch(error){if(sequence!==discogsSearchSequence)return;showToast(error.message);document.querySelector('#marketGrid').innerHTML=`<p class="empty-state">${escapeHtml(error.message)}</p>`;document.querySelector('#marketPagination').innerHTML='';document.querySelector('#marketResults').textContent='Discogs search unavailable'}}
async function searchDiscogsMaster(id,title,page=1){if(!Number.isSafeInteger(id)||id<=0)return;const sequence=++discogsSearchSequence;discogsMasterId=id;discogsMasterTitle=title.slice(0,100);discogsSearchPage=page;document.querySelector('#discogsVersionsBack').hidden=false;document.querySelector('#marketResults').textContent='Loading album editions…';try{const response=await fetch(`/api/discogs/masters/${id}/versions?page=${page}`);const data=await response.json();if(sequence!==discogsSearchSequence||discogsMasterId!==id)return;if(!response.ok)throw new Error(data.error||'Could not load album editions');renderApiResults(data.results||[],data.pagination||{})}catch(error){if(sequence!==discogsSearchSequence)return;document.querySelector('#marketGrid').innerHTML=`<p class="empty-state">${escapeHtml(error.message)}</p>`;document.querySelector('#marketPagination').innerHTML='';document.querySelector('#marketResults').textContent='Album editions unavailable'}}
function queueDiscogsSearch(query){clearTimeout(discogsSearchTimer);discogsSearchTimer=null;++discogsSearchSequence;const hasIdentifier=['discogsArtist','discogsReleaseTitle','discogsCatno','discogsBarcode'].some(id=>document.querySelector(`#${id}`).value.trim());if(!query.trim()&&!hasIdentifier){renderCatalogPrompt();return}document.querySelector('#marketResults').textContent='Searching Discogs…';discogsSearchTimer=setTimeout(()=>searchDiscogsApi(query),250)}
async function addApiRecord(button,list){const generation=discogsAccountGeneration;button.disabled=true;button.textContent='Adding…';try{const response=await fetch(`/api/${list}`,{method:'POST',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({release_id:Number(button.dataset.releaseId)})});const data=await response.json();if(generation!==discogsAccountGeneration){button.disabled=false;button.textContent=list==='wantlist'?'+ Wantlist':'+ Collection';return}if(!response.ok)throw new Error(data.error||`Could not update ${list}`);button.textContent='✓ Added';await refreshDiscogsSection(list,true);if(generation===discogsAccountGeneration)showToast(`Added to your Discogs ${list}`);else{button.disabled=false;button.textContent=list==='wantlist'?'+ Wantlist':'+ Collection'}}catch(error){button.disabled=false;button.textContent=list==='wantlist'?'+ Wantlist':'+ Collection';if(generation===discogsAccountGeneration)showToast(error.message)}}
function collectDiscogsFilters(){discogsFilters={};for(const name of ['format','condition','country','genre','year']){const value=document.querySelector(`#discogs${name[0].toUpperCase()+name.slice(1)}`)?.value.trim();if(value)discogsFilters[name]=value}return discogsFilters}
function filterCards(q){q=q.toLowerCase();if(activeSearchView==='spotify'){if(document.querySelector('.active-view')?.id==='home')setSpotifySearchScope('catalog');if(spotifySearchMode==='catalog'){searchSpotifyCatalog(q)}else renderSpotifyLibrary(q);return}searchDiscogsApi(q)}
document.addEventListener('click',event=>{const button=event.target.closest('.collection-spotify');if(button)searchInSpotify(button.dataset.title,button.dataset.artist)});
document.querySelectorAll('[data-view]').forEach(link=>link.addEventListener('click',()=>{if(link.dataset.view!=='home'){if(collectionSpotifyLookup){++spotifySearchSequence;clearTimeout(spotifySearchTimer);spotifySearchTimer=null;if(spotifySearchCompletion){spotifySearchCompletion();spotifySearchCompletion=null}document.querySelector('#searchInput').value='';renderHomeRecommendations()}collectionSpotifyLookup=null}const nextContext=['home','spotify'].includes(link.dataset.view)?'spotify':'discogs';if(nextContext!==lastSearchContext){clearTimeout(discogsSearchTimer);discogsSearchTimer=null;++discogsSearchSequence;document.querySelector('#searchInput').value='';lastSearchContext=nextContext;if(nextContext==='spotify')setSpotifySearchScope('library');else spotifySearchMode='library';updateSearchContext()}}));document.querySelector('#searchInput').addEventListener('input',e=>{collectionSpotifyLookup=null;if(activeSearchView==='spotify')filterCards(e.target.value);else queueDiscogsSearch(e.target.value)});
document.addEventListener('click',event=>{if(event.target.closest('[data-view="spotify"]'))maybeLoadSpotifyLibrary()});
document.addEventListener('click',e=>{if(e.target.closest('.brand')){document.querySelector('.brand').classList.remove('active');document.querySelector('.sidebar nav a[data-view="home"]').classList.add('active');collectionSpotifyLookup=null;document.querySelector('#searchInput').value='';homeDiscoveryMode='recent';homeRecommendationPage=1;document.querySelector('#homeDiscoveryTitle').textContent='For your ears';document.querySelector('#homeTopToggle').textContent=spotifyCanReadTop?'Long-term favorites':'Enable long-term favorites';searchSpotifyCatalog('')}});
for(const name of ['format','condition','country','genre','year'])document.querySelector(`#discogs${name[0].toUpperCase()+name.slice(1)}`).addEventListener('change',()=>{collectDiscogsFilters();saveUiPreference('discogsFilters',{...discogsFilters});searchDiscogsApi(document.querySelector('#searchInput').value)});
for(const id of ['discogsArtist','discogsReleaseTitle','discogsCatno','discogsBarcode'])document.querySelector(`#${id}`).addEventListener('input',()=>queueDiscogsSearch(document.querySelector('#searchInput').value));
document.querySelector('#discogsVersionsBack').addEventListener('click',()=>searchDiscogsApi(document.querySelector('#searchInput').value));
document.addEventListener('click',event=>{const button=event.target.closest('.master-versions');if(button)searchDiscogsMaster(Number(button.dataset.masterId),button.dataset.masterTitle||'This album')});
let discogsPurgeWarningShown=false;
function purgeStoredDiscogsRecords(){
  let failed=false;
  for(const key of ['rcrdCollection','rcrdWantlist']){
    try{
      const raw=localStorage.getItem(key);
      if(raw===null)continue;
      let records;
      try{records=JSON.parse(raw)}catch{localStorage.removeItem(key);continue}
      if(!Array.isArray(records)){localStorage.removeItem(key);continue}
      const local=records.filter(record=>record?.source!=='discogs');
      if(local.length!==records.length)localStorage.setItem(key,JSON.stringify(local));
    }catch{failed=true}
  }
  if(failed&&!discogsPurgeWarningShown){discogsPurgeWarningShown=true;showToast('Could not clear saved Discogs records from this browser.')}
  if(!failed)discogsPurgeWarningShown=false;
}
function resetDiscogsAccountUi(){apiConnected=false;++discogsAccountGeneration;++discogsSearchSequence;clearTimeout(discogsSearchTimer);discogsSearchTimer=null;++discogsRefreshSequence.collection;++discogsRefreshSequence.wantlist;discogsLoadedAt.collection=0;discogsLoadedAt.wantlist=0;discogsRefreshRequest.collection=null;discogsRefreshRequest.wantlist=null;purgeStoredDiscogsRecords();collection=[];wantlist=[];collectionPage=1;wantlistPage=1;const button=document.querySelector('#connectDiscogs');button.textContent='Connect Discogs';button.classList.remove('connected');renderCollection();renderWantlist();document.querySelector('#collectionCount').textContent='0';document.querySelector('#wantCount').textContent='0';document.querySelector('#collection .page-heading .eyebrow').textContent='DISCOGS COLLECTION';document.querySelector('#collection .page-heading h1 span').textContent='Not connected';document.querySelector('#wantlist .page-heading h1 span').textContent='Not connected';for(const section of ['collection','wantlist']){const meta=document.querySelector(`#${section}CacheMeta`);meta.hidden=true;meta.textContent=''}document.querySelector('#collectionPagination').innerHTML='';document.querySelector('#wantlistPagination').innerHTML=''}
async function refreshDiscogsSession(){const generation=discogsAccountGeneration;try{const response=await fetch('/api/session');const state=await response.json();if(generation!==discogsAccountGeneration)return;apiConnected=Boolean(state.connected);const button=document.querySelector('#connectDiscogs');button.textContent=apiConnected?'Discogs connected':'Connect Discogs';button.classList.toggle('connected',apiConnected);if(apiConnected){await refreshDiscogsData()}else{resetDiscogsAccountUi()}if(generation===discogsAccountGeneration&&apiConnected&&new URLSearchParams(location.search).get('discogs')==='connected'){showToast('Discogs connected successfully');history.replaceState({},'',location.pathname)}}catch{if(generation===discogsAccountGeneration)resetDiscogsAccountUi()}}
document.querySelector('#connectDiscogs').onclick=()=>{if(apiConnected)document.querySelector('[data-view="settings"]').click();else location.href='/auth/discogs/start'};refreshDiscogsSession();
function setSidebarPlaylistOptions(playlists=[],message='Saved library',disabled=false){const menu=document.querySelector('#sidebarPlaylistMenu');const trigger=document.querySelector('#sidebarPlaylistTrigger');const list=document.querySelector('#sidebarPlaylistList');trigger.disabled=disabled;trigger.dataset.value='';document.querySelector('#sidebarPlaylistValue').textContent=message;trigger.setAttribute('aria-expanded','false');menu.classList.remove('is-open');list.hidden=true;list.innerHTML=disabled?'':[{id:'',name:'Saved library'},...playlists].map((playlist,index)=>`<button type="button" role="option" data-playlist-id="${escapeHtml(playlist.id)}" aria-selected="${index===0}">${escapeHtml(playlist.name)}</button>`).join('');syncThemedSelect(document.querySelector('#spotifyPlaylistSelect'))}
function setSidebarPlaylistValue(id=''){const trigger=document.querySelector('#sidebarPlaylistTrigger');const options=[...document.querySelectorAll('#sidebarPlaylistList [role="option"]')];const selected=options.find(option=>option.dataset.playlistId===id)||options[0];const selectedId=selected?.dataset.playlistId||'';trigger.dataset.value=selectedId;document.querySelector('#sidebarPlaylistValue').textContent=selected?.textContent||'Saved library';options.forEach(option=>option.setAttribute('aria-selected',String(option===selected)));const playlistSelect=document.querySelector('#spotifyPlaylistSelect');playlistSelect.value=selectedId;syncThemedSelect(playlistSelect)}
function closeSidebarPlaylistMenu(){const menu=document.querySelector('#sidebarPlaylistMenu');menu.classList.remove('is-open');document.querySelector('#sidebarPlaylistTrigger').setAttribute('aria-expanded','false');document.querySelector('#sidebarPlaylistList').hidden=true}
let restartFeedbackTimer=null;
function confirmRcrdRestart(){
  const dialog=document.querySelector('#restartConfirmDialog');
  if(dialog.open)return Promise.resolve(false);
  dialog.returnValue='';
  dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='restart'),{once:true}));
}
async function restartRcrd(onStatus){
  const button=document.querySelector('#restartRcrd');
  const status=document.querySelector('#restartRcrdStatus');
  if(button.disabled||!await confirmRcrdRestart())return;
  const updateStatus=message=>{status.textContent=message;if(typeof onStatus==='function')onStatus(message)};
  clearTimeout(restartFeedbackTimer);
  restartFeedbackTimer=null;
  button.disabled=true;
  updateStatus('Requesting restart…');
  try{
    const response=await fetch('/api/admin/restart',{method:'POST',headers:{'X-RCRD-Request':'1'}});
    if(response.status===404)throw new Error('The running server is older. Restart once using the RCRD launcher to enable this button.');
    const data=await response.json();
    if(!response.ok||data.ok!==true||!Number.isInteger(data.previousPid))throw new Error(data.error||'Restart was not accepted.');
    updateStatus('Restarting RCRD…');
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),2000);
      try{
        const health=await fetch('/api/health',{cache:'no-store',signal:controller.signal});
        const result=await health.json();
        if(health.ok&&result.ok===true&&result.app==='rcrd'&&Number.isInteger(result.pid)&&result.pid!==data.previousPid){
          updateStatus('RCRD restarted successfully. Reloading…');
          try{sessionStorage.setItem('rcrd-restart-completed',String(Date.now()));if(typeof onStatus==='function')sessionStorage.setItem('rcrd-restart-from-menu','1')}
          catch{updateStatus('RCRD restarted successfully. Reload this page to load the update.');button.disabled=false;return}
          location.reload();return;
        }
      }catch{}finally{clearTimeout(timeout)}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('RCRD did not return within 30 seconds. Use the RCRD launcher to start it, then reload this page.');
  }catch(error){updateStatus(error.message||'Restart failed.');button.disabled=false}
}
document.querySelector('#restartRcrd').addEventListener('click',()=>restartRcrd());
const profileMenus=[...document.querySelectorAll('.profile-menu')];
function syncMobileConnectionButton(service){
  const source=document.querySelector(`#connect${service}`);
  const mobile=document.querySelector(`#connect${service}Mobile`);
  mobile.textContent=source.textContent;
  mobile.classList.toggle('connected',source.classList.contains('connected'));
}
for(const service of ['Spotify','Discogs']){
  const source=document.querySelector(`#connect${service}`);
  document.querySelector(`#connect${service}Mobile`).onclick=()=>source.click();
  new MutationObserver(()=>syncMobileConnectionButton(service)).observe(source,{attributes:true,attributeFilter:['class'],childList:true});
  syncMobileConnectionButton(service);
}
function closeProfileMenus(except=null){for(const menu of profileMenus)if(menu!==except)menu.open=false}
for(const menu of profileMenus)menu.addEventListener('toggle',()=>{if(menu.open)closeProfileMenus(menu)});
function handleProfileMenuClick(event){
  const menu=event.target.closest('.profile-menu');
  if(!menu){closeProfileMenus();return}
  const option=event.target.closest('.profile-menu-list a,.profile-menu-list button');
  if(!option)return;
  closeProfileMenus();
  if(option.dataset.profileAction==='restart'){
    const notice=document.querySelector('#restartMenuStatus');
    notice.hidden=true;
    notice.textContent='';
    restartRcrd(message=>{notice.textContent=message;notice.hidden=false});
  }else if(option.dataset.profileAction==='about'){
    const about=document.querySelector('#settingsAbout').cloneNode(true);
    about.removeAttribute('id');
    about.removeAttribute('tabindex');
    about.querySelector('#rcrdVersion').removeAttribute('id');
    document.querySelector('#aboutDialogContent').replaceChildren(about);
    document.querySelector('#aboutDialog').showModal();
  }
}
document.addEventListener('click',handleProfileMenuClick);
document.querySelector('#aboutDialogClose').addEventListener('click',()=>document.querySelector('#aboutDialog').close());
function handleProfileMenuKeydown(event){
  if(event.key!=='Escape')return;
  const open=profileMenus.find(menu=>menu.open);
  if(!open)return;
  closeProfileMenus();
  open.querySelector('summary').focus();
  event.preventDefault();
}
document.addEventListener('keydown',handleProfileMenuKeydown);
function restoreRestartFeedback(){
  try{
    const value=sessionStorage.getItem('rcrd-restart-completed');
    const fromMenu=sessionStorage.getItem('rcrd-restart-from-menu')==='1';
    sessionStorage.removeItem('rcrd-restart-completed');
    sessionStorage.removeItem('rcrd-restart-from-menu');
    if(!value)return;
    const completedAt=Number(value);
    const age=Date.now()-completedAt;
    if(Number.isFinite(completedAt)&&age>=0&&age<60000){
      const status=document.querySelector('#restartRcrdStatus');
      status.textContent='RCRD restarted successfully.';
      const menuNotice=document.querySelector('#restartMenuStatus');
      if(fromMenu){menuNotice.textContent=status.textContent;menuNotice.hidden=false}
      clearTimeout(restartFeedbackTimer);
      restartFeedbackTimer=setTimeout(()=>{
        if(status.textContent==='RCRD restarted successfully.')status.textContent='';
        if(fromMenu&&menuNotice.textContent==='RCRD restarted successfully.'){menuNotice.textContent='';menuNotice.hidden=true}
        restartFeedbackTimer=null;
      },8000);
    }
  }catch{}
}
restoreRestartFeedback();

function syncAlbumTrackLikedStatus(uri,saved,includeChecking=false){
  for(const button of document.querySelectorAll('.collection-lookup-results .spotify-track-liked')){
    if(button.dataset.uri===uri&&button.dataset.likedState!=='saving'&&(includeChecking||button.dataset.likedState!=='checking'))renderAlbumTrackLiked(button,saved?'saved':'unsaved');
  }
}
function renderPlayerLiked(){
  const mix=document.querySelector('#playerMix');if(mix)mix.disabled=!spotifyConnected||!/^spotify:track:[A-Za-z0-9]{22}$/.test(spotifyTrackUri||'');
  const button=document.querySelector('#playerLiked');
  if(!button)return;
  const playable=Boolean(spotifyTrackUri);
  let label='Connect Spotify to use Liked Songs';
  if(spotifyConnected&&!spotifyCanModifyLibrary)label='Enable Liked Songs permission to save tracks';
  else if(spotifyConnected&&!playable)label='Play a Spotify track to use Liked Songs';
  else if(spotifyConnected&&likedMutationPending)label='Updating Liked Songs…';
  else if(spotifyConnected&&likedCheckPending)label='Checking Liked Songs…';
  else if(spotifyConnected&&likedStatus===null)label='Retry Liked Songs status';
  else if(spotifyConnected)label=likedStatus?'Remove from Liked Songs':'Save to Liked Songs';
  button.disabled=!spotifyConnected||!spotifyCanModifyLibrary||!playable||likedCheckPending||likedMutationPending;
  button.classList.toggle('is-liked',likedStatus===true&&playable);
  button.setAttribute('aria-label',spotifyConnected&&spotifyCanModifyLibrary&&playable&&likedStatus!==null?'Liked Songs':label);
  button.setAttribute('aria-pressed',spotifyConnected&&spotifyCanModifyLibrary&&likedStatus===null&&playable?'mixed':String(likedStatus===true&&playable&&spotifyConnected));
  button.setAttribute('aria-busy',String(likedCheckPending||likedMutationPending));
  button.title=label;
}
async function refreshCurrentTrackLikedStatus(){
  const uri=spotifyTrackUri;
  if(!spotifyConnected||!spotifyCanModifyLibrary||!uri)return;
  const generation=spotifyAccountGeneration;
  const revision=likedRequestRevision;
  likedCheckPending=true;
  renderPlayerLiked();
  try{
    const response=await fetch(`/api/spotify/liked?uri=${encodeURIComponent(uri)}`);
    const data=await response.json();
    if(!spotifyConnected||generation!==spotifyAccountGeneration||revision!==likedRequestRevision||uri!==spotifyTrackUri)return;
    if(!response.ok)throw new Error(data.error||'Could not check Liked Songs');
    if(typeof data.saved!=='boolean')throw new Error('Spotify returned an invalid Liked Songs status');
    likedStatus=data.saved;
    syncAlbumTrackLikedStatus(uri,data.saved);
  }catch(error){
    if(spotifyConnected&&generation===spotifyAccountGeneration&&revision===likedRequestRevision&&uri===spotifyTrackUri){likedStatus=null;showToast(error.message||'Could not check Liked Songs')}
  }finally{
    if(generation===spotifyAccountGeneration&&revision===likedRequestRevision&&uri===spotifyTrackUri){likedCheckPending=false;renderPlayerLiked()}
  }
}
function syncSpotifyAlbumTrackIndicator(){
  for(const row of document.querySelectorAll('.collection-lookup-results .spotify-album-track')){
    const current=row.querySelector('.spotify-play-result')?.dataset.uri===spotifyTrackUri;
    row.classList.toggle('is-current',current);row.classList.toggle('is-playing',current&&playing);
    if(current)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
    row.querySelector('.spotify-album-track-state').textContent=current?(playing?'Now playing':'Paused'):'';
  }
}
function setCurrentSpotifyTrackUri(uri){
  const next=typeof uri==='string'&&/^spotify:track:[A-Za-z0-9]+$/.test(uri)?uri:null;
  if(next===spotifyTrackUri)return;
  closeLyricsDialog();
  spotifyTrackUri=next;
  document.querySelector('#playerLyrics').disabled=!spotifyConnected||!next;
  const artwork=document.querySelector('#playerAlbumOpen');if(artwork){artwork.disabled=true;artwork.setAttribute('data-album-id','');artwork.setAttribute('aria-label','Album unavailable')}
  syncSpotifyAlbumTrackIndicator();
  ++likedRequestRevision;
  likedStatus=null;
  likedCheckPending=false;
  likedMutationPending=false;
  renderPlayerLiked();
  return refreshCurrentTrackLikedStatus();
}
async function toggleCurrentTrackLiked(){
  if(!spotifyConnected||!spotifyCanModifyLibrary||!spotifyTrackUri||likedCheckPending||likedMutationPending)return;
  if(likedStatus===null)return refreshCurrentTrackLikedStatus();
  const uri=spotifyTrackUri;
  const generation=spotifyAccountGeneration;
  const revision=likedRequestRevision;
  const desired=!likedStatus;
  likedMutationPending=true;
  renderPlayerLiked();
  try{
    const response=await fetch('/api/spotify/liked',{method:'PUT',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({uri,saved:desired})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not update Liked Songs');
    if(data.ok!==true||data.saved!==desired)throw new Error('Spotify did not confirm the Liked Songs change');
    if(generation!==spotifyAccountGeneration||!spotifyConnected)return;
    syncAlbumTrackLikedStatus(uri,desired,true);
    ++spotifyLibraryRevision;
    spotifyLibraryNeedsRefresh=true;
    spotifyLibraryPromise=null;
    if(revision===likedRequestRevision&&uri===spotifyTrackUri){likedStatus=desired;showToast(data.cacheWarning|| (desired?'Saved to Liked Songs':'Removed from Liked Songs'))}
    if(document.querySelector('.active-view')?.id==='spotify')document.querySelector('#spotifyLibraryNote').textContent=data.cacheWarning||'Liked Songs changed. Reopen Saved music to refresh the full library.';
  }catch(error){
    if(generation===spotifyAccountGeneration&&revision===likedRequestRevision&&uri===spotifyTrackUri)showToast(error.message||'Could not update Liked Songs');
  }finally{
    if(generation===spotifyAccountGeneration&&revision===likedRequestRevision&&uri===spotifyTrackUri){likedMutationPending=false;renderPlayerLiked()}
  }
}
document.querySelector('#playerLiked').addEventListener('click',toggleCurrentTrackLiked);
renderPlayerLiked();
function resetSpotifyAccountUi(){resetSpotifyMix();spotifyCatalogAlbumView=null;spotifyCatalogResults=[];document.querySelector('#spotify .library-controls').hidden=false;document.querySelector('#spotifyGrid').classList.remove('collection-lookup-results');spotifyConnected=false;spotifyCanStream=false;spotifyCanModifyLibrary=false;spotifyPlayerConnectFailed=false;++spotifyAccountGeneration;++likedRequestRevision;++spotifyLibraryRevision;resetListeningHistoryUi();resetSpotifyPlayCounts();likedStatus=null;likedCheckPending=false;likedMutationPending=false;spotifyLibraryNeedsRefresh=false;++spotifyPlaylistSequence;++spotifySearchSequence;clearTimeout(spotifySearchTimer);if(spotifySearchCompletion){spotifySearchCompletion();spotifySearchCompletion=null}spotifyHomeRequest=null;spotifyHomeNextRefresh=0;spotifyHomeRateLimitedUntil=0;spotifyLibraryAlbums=[];spotifySavedAlbums=[];spotifyLibraryTracks=[];spotifyLibraryPlaybackRecords=[];spotifyHomeRecommendations=[];spotifyLibraryLoaded=false;spotifySavedLibraryLoaded=false;spotifyPlaylistPreviewState=null;spotifyLibraryPromise=null;spotifyLibraryError='';spotifyTrackUri=null;renderPlayerLiked();spotifyDeviceId=null;spotifyPlayerState='waiting';spotifyPlayerIssue='';spotifyActiveDevice='Not checked';spotifySkipQueue=Promise.resolve();spotifySkipPending=0;spotifySkipBusy={next:0,previous:0};spotifyToggleQueue=Promise.resolve();spotifyTogglePending=0;spotifyModeQueue=Promise.resolve();spotifyPlaybackStartPending=0;document.querySelectorAll('#previousButton,#nextButton,#playButton').forEach(button=>button.setAttribute('aria-busy','false'));shuffleRequestPending=false;++shuffleRevision;const shuffleButton=document.querySelector('#shuffleButton');if(shuffleButton){shuffleButton.disabled=false;shuffleButton.setAttribute('aria-busy','false')}repeatRequestPending=false;++repeatRevision;const repeatButton=document.querySelector('#repeatButton');if(repeatButton){repeatButton.disabled=false;repeatButton.setAttribute('aria-busy','false')}if(spotifySyncTimer){clearInterval(spotifySyncTimer);spotifySyncTimer=null}clearTimeout(spotifyPlayerReadyTimer);spotifyPlayerReadyTimer=null;if(spotifyPlayer){try{spotifyPlayer.disconnect()}catch{}spotifyPlayer=null}const avatar=document.querySelector('#profileAvatar');avatar.classList.remove('has-image');avatar.classList.add('is-placeholder');avatar.style.backgroundImage='';avatar.textContent='?';document.querySelector('#profileName').textContent='Connect account';document.querySelector('#profileMeta').textContent='Spotify profile';const connect=document.querySelector('#connectSpotify');connect.textContent='Connect Spotify';connect.classList.remove('connected');document.querySelector('#spotifyReminder').hidden=true;const playlistSelect=document.querySelector('#spotifyPlaylistSelect');playlistSelect.disabled=true;playlistSelect.innerHTML='<option value="">Connect Spotify for playlists</option>';setSidebarPlaylistOptions([],'Connect Spotify for playlists',true);document.querySelector('#spotifyGrid').innerHTML='<p class="empty-state">Connect Spotify to load and search your saved library.</p>';document.querySelector('#spotifyPagination').innerHTML='';document.querySelector('#spotifyLibraryStatus').textContent='Not connected';showSpotifyLibraryNotice('Connect Spotify to load your saved albums, tracks, and playlists.');document.querySelector('#spotifyCacheMeta').textContent='';document.querySelector('#recommendations').innerHTML='<p class="empty-state">Connect Spotify to see recommendations from your listening.</p>';document.querySelector('#homeSpotifyPagination').innerHTML='';recentTracksData=[];renderListeningDiscogsSuggestions([],'Connect Spotify to see your recent plays.');setSong('Connect Spotify','Playback unavailable','');playing=false;updatePlaybackModes({repeat_state:'off',shuffle_state:false,context:null});const progress=document.querySelector('#playerProgress');progress.value=0;updateProgress(0,0);renderPlayer();renderSpotifyConnectionStatus({connected:false})}
function renderSpotifyConnectionStatus(status){
  spotifyHealthConnection=typeof status.connected==='boolean'?status.connected:null;
  spotifyCanStream=status.connected===false?false:typeof status.canStream==='boolean'?status.canStream:null;
  if(status.connected===false)collectionSpotifyLookup=null;
  if(status.connected===false){spotifyTargetDeviceId=null;spotifyTargetSupportsVolume=true;++spotifyDeviceRequestRevision;spotifyDeviceRefreshBusy=0;spotifyDeviceRefreshEnabled=false;availableSpotifyDevices.clear();document.querySelector('#playbackDeviceList').hidden=true;document.querySelector('#playbackDeviceList').innerHTML='';syncSpotifyDeviceRefresh();document.querySelector('#volumeControl').disabled=false;renderVolumeControl();applySpotifyActionAvailability(null);spotifyCanReadTop=false;spotifyTopAlbums=[];spotifyTopRequest=null;homeDiscoveryMode='recent';homeRecommendationPage=1;document.querySelector('#homeSpotifyPagination').innerHTML='';document.querySelector('#homeDiscoveryTitle').textContent='For your ears';document.querySelector('#homeTopToggle').textContent='Long-term favorites'}
  renderPlaybackHealth();
  if(typeof status.connected!=='boolean'){
    document.querySelector('#connectSpotify').textContent='Spotify status unavailable';
    document.querySelector('#connectSpotify').classList.remove('connected');
    document.querySelector('#settingsSpotifyStatus').textContent='Unavailable';
    document.querySelector('#settingsSpotifyReconnect').hidden=true;
    document.querySelector('#settingsSpotifyDisconnect').hidden=true;
    const notice=document.querySelector('#spotifyReminder');
    notice.textContent='Could not confirm Spotify connection status. Reload to try again; your saved authorization has not been removed.';
    notice.hidden=false;
    return;
  }
  const connected=Boolean(status.connected);
  const button=document.querySelector('#connectSpotify');
  const reminder=document.querySelector('#spotifyReminder');
  button.textContent=connected?'Spotify connected':'Connect Spotify';
  button.classList.toggle('connected',connected);
  reminder.hidden=true;
  reminder.innerHTML='';
  document.querySelector('#settingsSpotifyStatus').textContent=connected?'Connected':'Not connected';
  updateSettingsAccountAction('Spotify',connected);
  let help='Spotify renewal status is available after connection.';
  if(connected&&status.needsReauthorization){
    help='Spotify is connected, but its authorization needs renewal.';
    reminder.innerHTML='<strong>Spotify authorization needs renewal.</strong> <button type="button" class="secondary-action" data-spotify-authorize>Renew authorization</button>';
  }else if(connected&&status.canStream===false){
    help='Spotify is connected, but playback permission is missing. Reconnect Spotify to approve playback in RCRD.';
    reminder.innerHTML='<strong>Spotify playback permission is missing.</strong> <button type="button" class="secondary-action" data-spotify-authorize>Reconnect Spotify</button>';
  }else if(connected&&status.canModifyLibrary===false){
    help='Spotify is connected. Liked Songs needs an additional permission; playback and existing library access remain connected.';
    reminder.innerHTML='<strong>Spotify is connected.</strong> Grant the additional permission to save tracks. <button type="button" class="secondary-action" data-spotify-authorize>Enable Liked Songs</button>';
  }else if(connected&&typeof status.canModifyLibrary!=='boolean'){
    help='Spotify is connected. Restart RCRD to load the Liked Songs server update.';
    reminder.textContent=help;
  }else if(connected&&Number.isFinite(status.daysRemaining)){
    help=`Spotify authorization renewal: ${status.daysRemaining} day${status.daysRemaining===1?'':'s'} remaining.`;
    if(status.daysRemaining<=14)reminder.innerHTML=`<strong>Spotify authorization reminder:</strong> renew within ${status.daysRemaining} day${status.daysRemaining===1?'':'s'}. <button type="button" class="secondary-action" data-spotify-authorize>Renew authorization</button>`;
  }
  reminder.hidden=!connected||!(status.needsReauthorization||status.canStream===false||status.canModifyLibrary!==true||(Number.isFinite(status.daysRemaining)&&status.daysRemaining<=14));
  document.querySelector('#settingsSpotifyRenewal').textContent=help;
}
document.addEventListener('click',event=>{if(event.target.closest('[data-spotify-authorize]'))location.href='/auth/spotify/start'});
async function refreshSpotifyStatus(){
  const generation=spotifyAccountGeneration;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('/api/spotify/status',{signal:controller.signal});
    const status=await response.json();
    if(generation!==spotifyAccountGeneration)return;
    if(!response.ok)throw new Error('Spotify connection status unavailable');
    const couldModifyLibrary=spotifyCanModifyLibrary;
    spotifyConnected=Boolean(status.connected);
    spotifyCanModifyLibrary=spotifyConnected&&Boolean(status.canModifyLibrary);
    spotifyCanReadTop=spotifyConnected&&Boolean(status.canReadTop);
    document.querySelector('#homeTopToggle').textContent=spotifyCanReadTop?'Long-term favorites':'Enable long-term favorites';
    renderSpotifyConnectionStatus(status);
    if(!spotifyConnected)resetSpotifyAccountUi();
    renderPlayerLiked();
    if(spotifyConnected&&!couldModifyLibrary&&spotifyCanModifyLibrary&&spotifyTrackUri)refreshCurrentTrackLikedStatus();
    if(spotifyConnected){initSpotifyPlayer();if(spotifySearchMode==='catalog'){if(document.querySelector('.active-view')?.id==='spotify')searchSpotifyCatalog(document.querySelector('#searchInput').value)}else renderSpotifyLibrary();spotifyHomeRecommendations=[];renderHomeRecommendations('Loading your Spotify listening…');renderListeningDiscogsSuggestions([],'Loading your recent Spotify plays…');refreshSpotifyProfile();refreshSpotifyHome();refreshSpotifyPlaylists();maybeLoadSpotifyLibrary()}
    if(spotifyConnected&&new URLSearchParams(location.search).get('spotify')==='connected'){showToast('Spotify connected successfully');history.replaceState({},'',location.pathname)}
  }catch{
    if(generation!==spotifyAccountGeneration)return;
    renderSpotifyConnectionStatus({});
    const libraryStatus=document.querySelector('#spotifyLibraryStatus');
    if(libraryStatus.textContent==='Checking connection…'){
      libraryStatus.textContent='Connection unavailable';
      document.querySelector('#spotifyGrid').innerHTML='<p class="empty-state">Could not check Spotify connection. Reload RCRD to try again.</p>';
    }
  }finally{clearTimeout(timeout)}
}
async function refreshSpotifyProfile(){const generation=spotifyAccountGeneration;try{const response=await fetch('/api/spotify/me');if(!response.ok)return;const profile=await response.json();if(!spotifyConnected||generation!==spotifyAccountGeneration)return;const name=profile.display_name||profile.id||'Spotify account';const avatar=document.querySelector('#profileAvatar');document.querySelector('#profileName').textContent=name;document.querySelector('#profileMeta').textContent=`${profile.followers?.total||0} followers`;const imageUrl=profile.images?.[0]?.url;let safeImageUrl=null;try{const parsed=imageUrl?new URL(imageUrl):null;if(parsed?.protocol==='https:')safeImageUrl=parsed.href}catch{}avatar.classList.remove('is-placeholder');if(safeImageUrl){avatar.classList.add('has-image');avatar.style.backgroundImage=`url(${JSON.stringify(safeImageUrl)})`;avatar.textContent=''}else{avatar.classList.remove('has-image');avatar.style.backgroundImage='';avatar.textContent=name.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase()}}catch{}}
function syncMobileProfileAvatar(){const source=document.querySelector('#profileAvatar');const mobile=document.querySelector('#profileAvatarMobile');mobile.classList.toggle('has-image',source.classList.contains('has-image'));mobile.classList.toggle('is-placeholder',source.classList.contains('is-placeholder'));mobile.style.backgroundImage=source.style.backgroundImage;mobile.textContent=source.textContent}
new MutationObserver(syncMobileProfileAvatar).observe(document.querySelector('#profileAvatar'),{attributes:true,attributeFilter:['class','style'],childList:true,characterData:true,subtree:true});syncMobileProfileAvatar();
function shelfMatchKey(title,artist){const clean=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s*\(\d+\)$/,'').replace(/[^a-z0-9]+/g,' ').trim();return `${clean(title)}|${clean(artist)}`}
function shelfMatch(title,artist,releaseId=0){
  if(!apiConnected)return {collection:'',wantlist:''};
  const key=shelfMatchKey(title,artist);
  const match=list=>{const exact=Number.isSafeInteger(Number(releaseId))&&Number(releaseId)>0&&list.some(item=>item.source==='discogs'&&Number(item.releaseId)===Number(releaseId));if(exact)return 'exact';return key!=='|'&&list.some(item=>item.source==='discogs'&&shelfMatchKey(item.title,item.artist)===key)?'possible':''};
  return {collection:match(collection),wantlist:match(wantlist)};
}
function shelfBadges(match){const badges=['collection','wantlist'].map(list=>{const kind=match[list];return kind?`<span class="shelf-badge ${kind}" title="${kind==='exact'?'Exact Discogs release ID':'Album title and artist match; the exact Discogs edition is not confirmed'}">${kind==='exact'?`In ${list}`:`Album in ${list}`}</span>`:''}).join('');return badges?`<div class="shelf-badges">${badges}</div>`:''}
const pressingCompareSelected=new Map();let pressingCompareRevision=0;
function renderPressingCompareSelection(){const tray=document.querySelector('#pressingCompareTray');tray.hidden=pressingCompareSelected.size===0||document.querySelector('.active-view')?.id!=='market';document.querySelector('#pressingCompareCount').textContent=`${pressingCompareSelected.size} of 3 editions selected`;document.querySelector('#pressingCompareOpen').disabled=pressingCompareSelected.size<2;document.querySelectorAll('.pressing-compare-select').forEach(button=>{const selected=pressingCompareSelected.has(Number(button.dataset.releaseId));button.setAttribute('aria-pressed',String(selected));button.textContent=selected?'✓ Selected':'Compare';button.disabled=!selected&&pressingCompareSelected.size>=3})}
function pressingCompareField(label,value){return `<div class="pressing-compare-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value||'Not listed')}</dd></div>`}
function pressingCompareCard(release){const format=release.formats.map(item=>[item.quantity&&`${item.quantity}×`,item.name,...item.descriptions].filter(Boolean).join(' · ')).join('; ');const labels=release.labels.map(item=>[item.name,item.catalogNumber].filter(Boolean).join(' · ')).join('; ');const identifiers=release.identifiers.map(item=>`${item.type}: ${item.value}`).join('; ');return `<article class="pressing-compare-card"><h3>${escapeHtml(release.title||'Untitled release')}</h3><p>${escapeHtml(release.artists.join(', ')||'Unknown artist')}</p><dl>${pressingCompareField('Release ID',String(release.id))}${pressingCompareField('Year',release.year?String(release.year):'')}${pressingCompareField('Country',release.country)}${pressingCompareField('Format',format)}${pressingCompareField('Label / catalog number',labels)}${pressingCompareField('Barcode / matrix',identifiers)}${pressingCompareField('Track count',release.trackCount==null?'':String(release.trackCount))}</dl>${discogsDataCredit({id:release.id})}</article>`}
async function openPressingCompare(){const ids=[...pressingCompareSelected.keys()];if(ids.length<2||ids.length>3)return;const dialog=document.querySelector('#pressingCompareDialog');if(dialog.open)return;const revision=++pressingCompareRevision;const details=document.querySelector('#pressingCompareDetails');details.innerHTML='<p>Loading edition details…</p>';dialog.showModal();const settled=await Promise.allSettled(ids.map(async id=>{const response=await fetch(`/api/discogs/releases/${id}`);const data=await response.json();if(!response.ok||Number(data.id)!==id||!Array.isArray(data.artists)||!Array.isArray(data.formats)||!Array.isArray(data.labels)||!Array.isArray(data.identifiers)||data.formats.some(item=>!Array.isArray(item.descriptions)))throw new Error('Could not load this edition');return data}));if(revision!==pressingCompareRevision||!dialog.open)return;details.innerHTML=settled.map((result,index)=>result.status==='fulfilled'?pressingCompareCard(result.value):`<article class="pressing-compare-card"><h3>Release ${ids[index]}</h3><p>Details unavailable. Try comparing again.</p></article>`).join('')}
document.addEventListener('click',event=>{const nav=event.target.closest('[data-view]');if(nav){renderPressingCompareSelection();if(nav.dataset.view==='spotify'&&spotifyCatalogAlbumView)returnToSpotifyCatalogResults();if(nav.dataset.view==='spotify'&&spotifyLibraryLoaded&&spotifySearchMode==='library')renderSpotifyLibrary(document.querySelector('#searchInput').value,spotifyLibraryPage);if(nav.dataset.view==='market'&&discogsSearchResults.length)renderApiResults(discogsSearchResults,discogsSearchPagination);if(nav.dataset.view==='home'&&spotifyHomeRecommendations.length&&!document.querySelector('#searchInput').value.trim())renderHomeRecommendations()}const choice=event.target.closest('.pressing-compare-select');if(choice){const id=Number(choice.dataset.releaseId);if(!Number.isSafeInteger(id)||id<=0)return;if(pressingCompareSelected.has(id))pressingCompareSelected.delete(id);else if(pressingCompareSelected.size<3)pressingCompareSelected.set(id,true);renderPressingCompareSelection();return}if(event.target.closest('#pressingCompareClear')){pressingCompareSelected.clear();renderPressingCompareSelection();return}if(event.target.closest('#pressingCompareOpen'))openPressingCompare();if(event.target.closest('#pressingCompareClose'))document.querySelector('#pressingCompareDialog').close()});
document.querySelector('#pressingCompareDialog').addEventListener('close',()=>{++pressingCompareRevision});
function spotifyAlbumCard(record){const play=record.uri?`<button class="spotify-play-result" data-uri="${escapeHtml(record.uri)}"${record.kind==='track'&&record.contextUri?` data-context-uri="${escapeHtml(record.contextUri)}"`:''}${Number.isSafeInteger(record.playbackIndex)?` data-playback-index="${record.playbackIndex}"`:''} aria-label="Play ${escapeHtml(record.title)}">▶ Play</button>`:'';const detail=record.subtitle||`${record.artist} · ${record.year}`;const artist=String(record.artist||'').trim();const artistDetail=record.artistSearchable!==false&&artist&&detail.startsWith(artist)?artistSearchButton(artist,'spotify')+escapeHtml(detail.slice(artist.length)):escapeHtml(detail);const spotifyTarget=/^spotify:(track|album|artist|playlist):([A-Za-z0-9]{22})$/.exec(record.uri||'');const spotifyLink=spotifyTarget?`<a class="spotify-source-link" href="https://open.spotify.com/${spotifyTarget[1]}/${spotifyTarget[2]}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(record.title)} on Spotify" title="Open Spotify"><img src="assets/spotify-icon-white.svg" alt="" /></a>`:'';const matchTitle=record.matchTitle||(['Spotify saved album','Recently played on Spotify','Long-term Spotify favorite','Spotify album'].includes(record.format)?record.title:'');const matchArtist=record.matchArtist||record.artist;const match=matchTitle?shelfMatch(matchTitle,matchArtist):{collection:'',wantlist:''};const inCollection=Boolean(match.collection);const badges=shelfBadges(inCollection?{...match,collection:''}:match);const discogsAction=inCollection?`<span class="spotify-collection-status shelf-badge ${match.collection}" title="${match.collection==='exact'?'Exact Discogs release ID':'Album title and artist match; the exact Discogs edition is not confirmed'}">Album in collection</span>`:`<button class="spotify-discogs" data-title="${escapeHtml(matchTitle||record.title)}" data-artist="${escapeHtml(matchArtist)}">Find this on Discogs ↗</button>`;const shelfActions=record.showPlayCount||record.albumViewAction==='catalog';const discogsSlot=shelfActions?`<div class="spotify-discogs-actions">${badges}${discogsAction}</div>`:discogsAction;const albumName=record.kind==='track'?record.album||'Album unavailable':'';const countUri=record.showPlayCount&&record.kind==='track'?record.uri:'';const recorded=spotifyPlayCounts.get(countUri);const playCount=record.showPlayCount?`<div class="play-count"${countUri?` data-play-count-uri="${escapeHtml(countUri)}"`:''} title="${escapeHtml(countUri?playCountTitle(recorded):'Album rows do not have a song play count.')}"><span>Plays</span><strong>${countUri?playCountText(recorded):'—'}</strong></div>`:'';const albumId=record.viewAlbum?/^spotify:album:([A-Za-z0-9]{22})$/.exec(record.albumViewUri||record.uri||'')?.[1]:'';const openClass=record.albumViewAction==='catalog'?'spotify-catalog-album-open':'home-album-open';const artwork=albumId?`<button type="button" class="${openClass} home-album-cover" data-album-id="${albumId}" aria-label="${record.albumViewAction==='catalog'?'Go to album for':'View tracks on'} ${escapeHtml(record.albumViewTitle||record.title)}">${cover(record)}</button>`:cover(record);return `<article class="album-card${albumName?' has-album-column':''}${record.showPlayCount?' has-play-count':''}" data-title="${escapeHtml(`${record.title} ${record.artist}`.toLowerCase())}">${artwork}<div class="album-meta"><h3>${albumId?`<button type="button" class="${openClass} spotify-album-title" data-album-id="${albumId}">${escapeHtml(record.title)}</button>`:escapeHtml(record.title)}</h3><p>${artistDetail}</p>${!record.format||record.format==='Spotify saved track'?'':`<div class="format">${escapeHtml(record.format)}</div>`}${albumName?`<div class="album-name"><span>Album</span><strong title="${escapeHtml(albumName)}">${albumId?`<button type="button" class="${openClass} spotify-album-title" data-album-id="${albumId}">${escapeHtml(albumName)}</button>`:escapeHtml(albumName)}</strong></div>`:''}${playCount}${shelfActions?'':badges}${play}${discogsSlot}${spotifyLink}</div></article>`}
const HOME_RECOMMENDATION_LIMIT=30;
const HOME_RECOMMENDATION_PAGE_SIZE=8;
let homeRecommendationPage=1;
function renderHomeRecommendations(message='Spotify has not returned any listening-based albums yet.'){
  if(document.querySelector('.active-view')?.id==='home'&&document.querySelector('#searchInput').value.trim())return;
  const grid=document.querySelector('#recommendations');
  grid.classList.remove('collection-lookup-results','list-view');
  const status=document.querySelector('#homeSpotifySearchStatus');status.hidden=true;status.textContent='';
  document.querySelector('#homeSpotifySortField').hidden=true;
  document.querySelector('#homeTopToggle').hidden=false;
  const recent=homeDiscoveryMode==='top'?new Set(spotifyHomeRecommendations.map(item=>shelfMatchKey(item.title,item.artist))):null;
  const records=homeDiscoveryMode==='top'?spotifyTopAlbums.filter(item=>!recent.has(shelfMatchKey(item.title,item.artist))&&(!apiConnected||!shelfMatch(item.title,item.artist).collection)).slice(0,HOME_RECOMMENDATION_LIMIT):spotifyHomeRecommendations;
  const totalPages=Math.max(1,Math.ceil(records.length/HOME_RECOMMENDATION_PAGE_SIZE));
  homeRecommendationPage=Math.min(Math.max(1,homeRecommendationPage),totalPages);
  const page=records.slice((homeRecommendationPage-1)*HOME_RECOMMENDATION_PAGE_SIZE,homeRecommendationPage*HOME_RECOMMENDATION_PAGE_SIZE);
  const refresh=document.querySelector('#homeRefresh');
  refresh.hidden=homeDiscoveryMode==='top';
  refresh.title='Refresh listening recommendations';refresh.setAttribute('aria-label','Refresh listening recommendations');
  const emptyMessage=homeDiscoveryMode==='top'?(spotifyTopAlbums.length?'No distinct long-term favorites without a possible collection match were found.':'Load long-term favorites to explore albums beyond your recent plays.'):message;
  grid.innerHTML=page.length?page.map(record=>spotifyAlbumCard({...record,viewAlbum:true})).join(''):`<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
  renderPagination('homeSpotifyPagination',homeRecommendationPage,records.length,HOME_RECOMMENDATION_PAGE_SIZE,'home-recommendations');
}
function syncSpotifySortControls(){
  for(const control of document.querySelectorAll('#spotifySort,#homeSpotifySort')){
    const library=control.id==='spotifySort'&&spotifySearchMode==='library';
    const plays=control.querySelector('option[value="plays"]');if(plays){plays.hidden=!library;plays.disabled=!library}
    control.value=spotifyLibrarySort==='plays'&&!library?'recent':spotifyLibrarySort;syncThemedSelect(control);
    const choice=control.closest('.themed-select')?.querySelector('[data-value="plays"]');if(choice){choice.hidden=!library;choice.disabled=!library}
  }
}
function openHomeSpotifyAlbum(id,playbackAlbum=null){
  if(!spotifyConnected||document.querySelector('.active-view')?.id!=='home'||!/^[A-Za-z0-9]{22}$/.test(id||''))return;
  const result=playbackAlbum?.id===id&&typeof playbackAlbum.name==='string'?playbackAlbum:spotifyCatalogResults.find(item=>(item.type==='track'?item.album?.id:item.type==='album'?item.id:'')===id);
  const album=result?.type==='track'?result.album:result;
  const record=[...spotifyHomeRecommendations,...spotifyTopAlbums].find(item=>item.uri===`spotify:album:${id}`)||(album?{title:album.name,artist:album.artists?.map(item=>item.name).join(', ')||'',image:album.images?.[0]?.url,uri:`spotify:album:${id}`}:null);
  if(!record)return;
  const title=String(record.title||'').trim();const artist=String(record.artist||'').trim();if(!title)return;
  const query=[title,artist].filter(Boolean).join(' ').slice(0,200).trim();
  collectionSpotifyLookup={title,artist,query,item:{id,type:'album',name:title,artists:[{name:artist}],images:[{url:record.image}],uri:record.uri}};
  document.querySelector('#searchInput').value=query;
  filterCards(query);
  document.querySelector('#homeDiscoveryTitle').scrollIntoView({behavior:'smooth',block:'start'});
}
function returnToHomeRecommendations(){collectionSpotifyLookup=null;document.querySelector('#searchInput').value='';filterCards('');document.querySelector('#homeDiscoveryTitle').scrollIntoView({behavior:'smooth',block:'start'})}
document.addEventListener('click',event=>{const open=event.target.closest('.home-album-open');if(open){openHomeSpotifyAlbum(open.dataset.albumId);return}if(event.target.closest('.home-album-back'))returnToHomeRecommendations()});
async function refreshSpotifyTopAlbums(force=false){if(!spotifyConnected||!spotifyCanReadTop){if(force)showToast(spotifyConnected?'Enable long-term favorites before refreshing.':'Connect Spotify to refresh long-term favorites.');return}if(spotifyTopRequest)return spotifyTopRequest;const generation=spotifyAccountGeneration;const grid=document.querySelector('#recommendations');if(!force||!spotifyTopAlbums.length)grid.innerHTML='<p class="empty-state">Loading long-term favorites…</p>';const request=(async()=>{try{const response=await fetch('/api/spotify/top-albums',force?{method:'POST',headers:{'X-RCRD-Request':'1'}}:undefined);const data=await response.json();if(!spotifyConnected||generation!==spotifyAccountGeneration||homeDiscoveryMode!=='top')return;if(!response.ok)throw new Error(data.error||'Could not load long-term favorites');if(!Array.isArray(data.tracks))throw new Error('Spotify returned invalid top tracks');const previous=JSON.stringify(spotifyTopAlbums);const seen=new Set();spotifyTopAlbums=data.tracks.map(({album})=>{if(!album||typeof album.id!=='string'||typeof album.name!=='string'||seen.has(album.id))return null;seen.add(album.id);return {title:album.name,artist:Array.isArray(album.artists)?album.artists.map(item=>item.name).filter(Boolean).join(', '):'Spotify',year:String(album.release_date||'').slice(0,4)||'Year unknown',tone:'#31595c',accent:'#f1b597',word:album.name,image:safeImageUrl(album.images?.[0]?.url),format:'Long-term Spotify favorite',uri:album.uri}}).filter(Boolean);renderHomeRecommendations();if(force)showToast(previous===JSON.stringify(spotifyTopAlbums)?'Long-term favorites refreshed. Spotify returned the same albums.':'Long-term favorites refreshed.')}catch(error){if(spotifyConnected&&generation===spotifyAccountGeneration&&homeDiscoveryMode==='top'){if(!spotifyTopAlbums.length)grid.innerHTML=`<p class="empty-state">${escapeHtml(error.message)}</p>`;showToast(error.message)}}})();spotifyTopRequest=request;try{await request}finally{if(generation===spotifyAccountGeneration&&spotifyTopRequest===request)spotifyTopRequest=null}}
document.querySelector('#homeTopToggle').addEventListener('click',()=>{if(!spotifyConnected){showToast('Connect Spotify to explore long-term favorites');return}if(!spotifyCanReadTop){location.href='/auth/spotify/start?top=1';return}++spotifySearchSequence;clearTimeout(spotifySearchTimer);spotifySearchTimer=null;if(spotifySearchCompletion){spotifySearchCompletion();spotifySearchCompletion=null}collectionSpotifyLookup=null;document.querySelector('#searchInput').value='';homeDiscoveryMode=homeDiscoveryMode==='top'?'recent':'top';homeRecommendationPage=1;document.querySelector('#homeSpotifyPagination').innerHTML='';document.querySelector('#homeDiscoveryTitle').textContent=homeDiscoveryMode==='top'?'Long-term favorites to explore':'For your ears';document.querySelector('#homeTopToggle').textContent=homeDiscoveryMode==='top'?'Recent & saved':'Long-term favorites';if(homeDiscoveryMode==='top'&&!spotifyTopAlbums.length)refreshSpotifyTopAlbums();else renderHomeRecommendations()});
function updateHomeRecommendations(recentTracks,savedAlbums){const recentAlbums=[];const seen=new Set();for(const track of recentTracks||[]){const album=track?.album;if(!album?.id||seen.has(album.id))continue;seen.add(album.id);recentAlbums.push({title:album.name||track.name||'Untitled album',artist:album.artists?.map(item=>item.name).join(', ')||track.artists?.map(item=>item.name).join(', ')||'Spotify',year:(album.release_date||'').slice(0,4)||'Year unknown',tone:'#31595c',accent:'#f1b597',word:album.name||track.name,image:safeImageUrl(album.images?.[0]?.url),format:'Recently played on Spotify',uri:album.uri});if(recentAlbums.length>=HOME_RECOMMENDATION_LIMIT)break}const records=[...recentAlbums];for(const album of savedAlbums||[]){const key=`${album.title}\u0000${album.artist}`;if(records.some(item=>`${item.title}\u0000${item.artist}`===key))continue;records.push(album);if(records.length>=HOME_RECOMMENDATION_LIMIT)break}spotifyHomeRecommendations=records.slice(0,HOME_RECOMMENDATION_LIMIT);homeRecommendationPage=1;const searchingHome=document.querySelector('.active-view')?.id==='home'&&document.querySelector('#searchInput').value.trim();if(!searchingHome)renderHomeRecommendations()}
async function refreshSpotifyHome(force=false){
  if(!spotifyConnected)return;
  if(spotifyHomeRequest)return spotifyHomeRequest;
  if(Date.now()<spotifyHomeRateLimitedUntil){if(force)showToast('Spotify is temporarily rate-limiting requests. Try again shortly.');return}
  if(Date.now()<spotifyHomeNextRefresh&&!force)return;
  const generation=spotifyAccountGeneration;
  spotifyHomeNextRefresh=Date.now()+300000;
  const request=(async()=>{
    try{
      const response=await fetch('/api/spotify/recent',force?{method:'POST',headers:{'X-RCRD-Request':'1'}}:undefined);const data=await response.json();
      if(!spotifyConnected||generation!==spotifyAccountGeneration)return;
      if(!response.ok){if(response.status===429){spotifyHomeRateLimitedUntil=Date.now()+Math.max(300000,(Number(data.retryAfter)||0)*1000);spotifyHomeNextRefresh=spotifyHomeRateLimitedUntil}throw new Error(data.error||'Could not load recent Spotify listening')}
      const recentTracks=(data.recentlyPlayed||[]).filter(Boolean);
      updateHomeRecommendations(recentTracks,spotifySavedAlbums);
      renderRecentTracks(recentTracks.map((track,index)=>[index+1,track.name,`${track.artists?.map(item=>item.name).join(', ')||'Spotify'} · ${track.album?.name||'Album'}`,formatTime(track.duration_ms||0),'#31595c',safeImageUrl(track.album?.images?.[0]?.url),track.uri,track.album?.uri||'']));
    }catch(error){
      if(!spotifyConnected||generation!==spotifyAccountGeneration)return;
      const searchingHome=document.querySelector('.active-view')?.id==='home'&&document.querySelector('#searchInput').value.trim();
      if(!spotifyHomeRecommendations.length&&!searchingHome)renderHomeRecommendations(error.message);
      recentTracksData=[];renderListeningDiscogsSuggestions([],error.message);showToast(error.message);
    }
  })();
  spotifyHomeRequest=request;
  try{await request}finally{if(generation===spotifyAccountGeneration)spotifyHomeRequest=null}
}
function maybeLoadSpotifyLibrary(){
  if(!spotifyConnected||document.querySelector('.active-view')?.id!=='spotify'||document.querySelector('#spotifyPlaylistSelect').value)return;
  if(spotifyLibraryNeedsRefresh){spotifyLibraryNeedsRefresh=false;spotifySavedLibraryLoaded=false;spotifyLibraryLoaded=false;spotifyLibraryPromise=null}
  if(!spotifySavedLibraryLoaded)refreshSpotifyLibrary();
}
function savedTrackDisplayKey(record){if(record.kind!=='track'||!record.title||!record.artist||!record.album)return '';const artwork=record.image||record.albumId;if(!artwork)return '';return [record.title,record.artist,record.album,record.year,artwork].map(value=>String(value||'').trim().toLocaleLowerCase()).join('\u0000')}
function renderSpotifyLibrary(query='',page=1,countsReady=false){
  const q=query.trim().toLowerCase();const grid=document.querySelector('#spotifyGrid');const playlistSelected=Boolean(document.querySelector('#spotifyPlaylistSelect').value);const preview=playlistSelected?spotifyPlaylistPreviewState:null;
  spotifyCatalogAlbumView=null;grid.classList.toggle('collection-lookup-results',false);document.querySelector('#spotify .library-controls').hidden=false;
  if(!spotifyLibraryLoaded){spotifyLibraryPlaybackRecords=[];document.querySelector('#spotifyPlayCountInfo').hidden=true;grid.innerHTML=`<p class="empty-state">${escapeHtml(spotifyLibraryError||(playlistSelected?'Loading playlist…':'Loading your complete Spotify library…'))}</p>`;document.querySelector('#spotifyLibraryStatus').textContent=spotifyLibraryError?'Library unavailable':playlistSelected?'Loading playlist':'Loading library';document.querySelector('#spotifyPagination').innerHTML='';return}
  const tracks=!playlistSelected?spotifyLibraryTracks.filter(record=>!q||`${record.title} ${record.artist} ${record.album}`.toLowerCase().includes(q)):[];
  const trackAlbumIds=new Set(tracks.map(record=>record.albumId).filter(Boolean));
  const albums=spotifyLibraryAlbums.filter(record=>(!q||`${record.title} ${record.artist} ${record.album||''}`.toLowerCase().includes(q))&&(!record.albumId||!trackAlbumIds.has(record.albumId)));
  spotifyLibraryPage=page;const records=sortRecords([...tracks,...albums],spotifyLibrarySort,document.querySelector('#spotifySortDirection').value);spotifyLibraryPlaybackRecords=playlistSelected?[]:records;const pages=Math.max(1,Math.ceil(records.length/spotifyPageSize));spotifyLibraryPage=Math.min(spotifyLibraryPage,pages);const first=(spotifyLibraryPage-1)*spotifyPageSize;const visible=records.slice(first,first+spotifyPageSize);const groups=[];const groupByKey=new Map();visible.forEach((record,index)=>{const key=playlistSelected?'':savedTrackDisplayKey(record);let group=key?groupByKey.get(key):null;if(!group){group=[];groups.push(group);if(key)groupByKey.set(key,group)}group.push({record,index:first+index})});const cardFor=({record,index})=>spotifyAlbumCard({...record,showPlayCount:true,viewAlbum:/^[A-Za-z0-9]{22}$/.test(record.albumId||''),albumViewUri:`spotify:album:${record.albumId}`,albumViewTitle:record.album||record.title,albumViewAction:'catalog',...(!playlistSelected&&record.kind==='track'?{playbackIndex:index}:{})});grid.classList.toggle('list-view',spotifyLibraryMode==='list');grid.innerHTML=groups.map(group=>group.length===1?cardFor(group[0]):`<div class="saved-track-group">${cardFor(group[0])}<details class="saved-track-versions"><summary>${group.length} saved versions · show others</summary>${group.slice(1).map(cardFor).join('')}</details></div>`).join('')||(preview?`<p class="empty-state">${q?'No preview tracks matched; the full playlist is not available yet.':preview.status==='loading'?'Checking the full playlist…':'Only a preview is available.'}</p>`:'<p class="empty-state">No Spotify library items matched this search.</p>');
  document.querySelector('#spotifyPlayCountInfo').hidden=!visible.some(record=>record.kind==='track');
  if(!countsReady)scheduleSpotifyPlayCounts(spotifyLibrarySort==='plays'?records:visible);
  const libraryStatus=tracks.length?`${tracks.length} ${q?'matching':'saved'} ${tracks.length===1?'song':'songs'}`:albums.length?`${albums.length} ${q?'matching':'saved'} ${albums.length===1?'album':'albums'}`:q?'0 matching items':'0 saved items';
  document.querySelector('#spotifyLibraryStatus').textContent=preview?`${q?`${records.length} preview matches`:`${spotifyLibraryAlbums.length} ${spotifyLibraryAlbums.length===1?'track':'tracks'} from ${preview.total} playlist items`} · ${preview.status==='loading'?'loading full playlist':'preview only'}`:playlistSelected?q?`${records.length} matching items`:`${records.length} playlist tracks`:libraryStatus;renderPagination('spotifyPagination',spotifyLibraryPage,records.length,spotifyPageSize,'spotify-library');
}
function spotifySearchCard(item,type,collectionLookup=false,catalogAlbumAction=false){const image=safeImageUrl(item.images?.[0]?.url||item.album?.images?.[0]?.url);const title=item.name||'Untitled';const artist=item.type==='artist'?title:item.artists?.map(value=>value.name).join(', ')||item.owner?.display_name||item.type||'Spotify';const subtitle=item.type==='playlist'?`${item.items?.total||item.tracks?.total||0} tracks`:item.type==='artist'?'Artist':item.album?.name||'Spotify catalog';const album=item.type==='track'?item.album:item.type==='album'?item:null;const albumId=/^[A-Za-z0-9]{22}$/.test(album?.id||'')?album.id:'';const matchTitle=item.type==='track'?item.album?.name||'':item.type==='album'?title:'';const matchArtist=item.type==='track'?item.album?.artists?.map(value=>value.name).join(', ')||artist:artist;return spotifyAlbumCard({title,artist,artistSearchable:item.type!=='playlist',album:item.album?.name||'',kind:item.type==='track'?'track':'',contextUri:item.type==='track'?item.album?.uri||'':'',matchTitle,matchArtist,collectionLookup,viewAlbum:catalogAlbumAction&&Boolean(albumId),albumViewUri:albumId?`spotify:album:${albumId}`:'',albumViewTitle:album?.name,albumViewAction:catalogAlbumAction==='home'?'home':catalogAlbumAction?'catalog':'',subtitle:collectionLookup&&item.type==='album'?artist:item.type==='track'?artist:`${artist} · ${subtitle}`,year:'',tone:'#31595c',accent:'#f1b597',word:title,image,format:collectionLookup&&item.type==='album'?'':`Spotify ${item.type||type}`,uri:item.uri})}
function spotifyCollectionResultCard(item){const id=/^[A-Za-z0-9]{22}$/.test(item.id||'')?item.id:'';const tracks=id?'Loading tracks…':'Track list unavailable for this result.';return `<div class="spotify-lookup-row">${spotifySearchCard(item,item.type,true)}<section class="spotify-lookup-tracks" data-album-id="${escapeHtml(id)}" aria-label="Tracks on ${escapeHtml(item.name||'this album')}"><h4>Tracks</h4><div class="spotify-lookup-track-list" role="status">${tracks}</div><p class="spotify-lookup-track-error" role="status" hidden></p><button type="button" class="spotify-lookup-more" data-offset="0" hidden>Show more tracks</button></section></div>`}
function openSpotifyCatalogAlbum(id){
  if(!spotifyConnected||document.querySelector('.active-view')?.id!=='spotify'||!/^[A-Za-z0-9]{22}$/.test(id||''))return;
  const result=spotifyCatalogResults.find(item=>(item.type==='track'?item.album?.id:item.type==='album'?item.id:'')===id);
  const saved=spotifySearchMode==='library'?[...spotifyLibraryTracks,...spotifyLibraryAlbums].find(record=>record.albumId===id):null;
  const album=saved?{id,type:'album',name:saved.album||saved.title,artists:[{name:saved.matchArtist||saved.artist}],images:[{url:saved.image}],uri:`spotify:album:${id}`}:result?.type==='track'?result.album:result;
  if(!album||album.id!==id)return;
  ++spotifySearchSequence;clearTimeout(spotifySearchTimer);spotifySearchTimer=null;if(spotifySearchCompletion){spotifySearchCompletion();spotifySearchCompletion=null}
  const grid=document.querySelector('#spotifyGrid');const pagination=document.querySelector('#spotifyPagination');const status=document.querySelector('#spotifyLibraryStatus');const note=document.querySelector('#spotifyCatalogNote');
  spotifyCatalogAlbumView={markup:grid.innerHTML,pagination:pagination.innerHTML,status:status.textContent,note:note.textContent,query:document.querySelector('#searchInput').value,page:spotifyCatalogPage};
  grid.classList.remove('list-view');grid.classList.add('collection-lookup-results');grid.innerHTML=`<button type="button" class="view-back spotify-catalog-album-back">← Back to results</button>${spotifyCollectionResultCard({...album,type:'album'})}`;
  pagination.innerHTML='';status.textContent='Album tracks';note.textContent='Select a track to play or save it to Liked Songs.';document.querySelector('#spotify .library-controls').hidden=true;
  void loadSpotifyAlbumTracks(id,0,spotifySearchSequence);
}
function returnToSpotifyCatalogResults(){
  const previous=spotifyCatalogAlbumView;if(!previous)return;
  ++spotifySearchSequence;spotifyCatalogAlbumView=null;
  const grid=document.querySelector('#spotifyGrid');grid.classList.remove('collection-lookup-results');grid.classList.toggle('list-view',spotifyLibraryMode==='list');grid.innerHTML=previous.markup;
  document.querySelector('#spotifyPagination').innerHTML=previous.pagination;document.querySelector('#spotifyLibraryStatus').textContent=previous.status;document.querySelector('#spotifyCatalogNote').textContent=previous.note;
  document.querySelector('#searchInput').value=previous.query;spotifyCatalogPage=previous.page;document.querySelector('#spotify .library-controls').hidden=false;
}
document.addEventListener('click',event=>{const open=event.target.closest('.spotify-catalog-album-open');if(open){openSpotifyCatalogAlbum(open.dataset.albumId);return}if(event.target.closest('.spotify-catalog-album-back'))returnToSpotifyCatalogResults()});
function spotifyAlbumLookupKey(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s*\(\d+\)$/,'').replace(/[^a-z0-9]+/g,' ').trim()}
function matchesCollectionSpotifyAlbum(item,lookup){if(item?.type!=='album'||spotifyAlbumLookupKey(item.name)!==spotifyAlbumLookupKey(lookup.title))return false;if(!lookup.artist)return true;const wanted=spotifyAlbumLookupKey(lookup.artist);if(wanted==='various'||wanted==='various artists')return true;const artists=Array.isArray(item.artists)?item.artists.map(artist=>artist?.name||''):[];return spotifyAlbumLookupKey(artists.join(' '))===wanted||artists.some(artist=>spotifyAlbumLookupKey(artist)===wanted)}
function uniqueCollectionSpotifyAlbums(items){const seen=new Set();return items.filter(item=>{const artists=Array.isArray(item.artists)?item.artists:[];const key=`${spotifyAlbumLookupKey(item.name)}|${spotifyAlbumLookupKey(artists.map(artist=>artist?.name||'').join(' '))}`;if(seen.has(key))return false;seen.add(key);return true})}
function searchSpotifyCatalog(query,page=1,force=false){
  const sequence=++spotifySearchSequence;clearTimeout(spotifySearchTimer);
  if(spotifySearchCompletion){spotifySearchCompletion();spotifySearchCompletion=null}
  const cleanQuery=query.trim();const lookup=collectionSpotifyLookup&&cleanQuery.toLowerCase()===collectionSpotifyLookup.query.toLowerCase()?collectionSpotifyLookup:null;spotifyCatalogPage=page;
  const onHome=document.querySelector('.active-view')?.id==='home';
  if(onHome&&cleanQuery){const refresh=document.querySelector('#homeRefresh');refresh.hidden=false;refresh.title='Refresh Spotify search';refresh.setAttribute('aria-label','Refresh Spotify search')}
  if(!onHome){spotifyCatalogAlbumView=null;spotifyCatalogResults=[];document.querySelector('#spotify .library-controls').hidden=false;document.querySelector('#spotifyPlayCountInfo').hidden=true}
  const grid=document.querySelector(onHome?'#recommendations':'#spotifyGrid');
  const status=document.querySelector(onHome?'#homeSpotifySearchStatus':'#spotifyLibraryStatus');
  const paginationId=onHome?'homeSpotifyPagination':'spotifyPagination';
  const homeSort=document.querySelector('#homeSpotifySortField');
  grid.classList.toggle('list-view',!onHome&&spotifyLibraryMode==='list');grid.classList.toggle('collection-lookup-results',Boolean(lookup));status.hidden=false;
  if(onHome)homeSort.hidden=!cleanQuery||Boolean(lookup);
  document.querySelector(`#${paginationId}`).innerHTML='';
  if(!cleanQuery){
    if(onHome){if(spotifyConnected){renderHomeRecommendations('Loading your Spotify listening…');if(!spotifyHomeRecommendations.length)refreshSpotifyHome()}else{grid.innerHTML='<p class="empty-state">Connect Spotify to see recommendations from your listening.</p>'}status.hidden=true}
    else{grid.innerHTML='<p class="empty-state">Search Spotify to find albums, tracks, artists, and playlists.</p>';status.textContent='Spotify catalog'}
    document.querySelector('#spotifyCatalogNote').textContent='Search results come from the full Spotify catalog.';return
  }
  if(!spotifyConnected){grid.innerHTML='<p class="empty-state">Reconnect Spotify to search the full catalog.</p>';status.textContent='Spotify connection required';return}
  status.textContent='Searching Spotify…';
  if(onHome&&lookup?.item){grid.innerHTML=`<button type="button" class="view-back home-album-back">← Back to recommendations</button>${spotifyCollectionResultCard(lookup.item)}`;status.textContent='Album tracks';document.querySelector('#spotifyCatalogNote').textContent='Select a track to play or save it to Liked Songs.';return loadSpotifyAlbumTracks(lookup.item.id,0,sequence)}
  if(lookup)grid.innerHTML='<p class="empty-state">Finding Spotify album…</p>';
  return new Promise(resolve=>{spotifySearchCompletion=resolve;spotifySearchTimer=setTimeout(async()=>{
    try{
      const offset=(spotifyCatalogPage-1)*10;const requestOptions=force?{method:'POST',headers:{'X-RCRD-Request':'1'}}:undefined;const searchTerms=lookup?[`album:${lookup.title}`,!lookup.searchByTitle&&lookup.artist?`artist:${lookup.artist}`:''].filter(Boolean).join(' ').slice(0,200):cleanQuery;
      let response=await fetch(`/api/spotify/search?q=${encodeURIComponent(searchTerms)}&offset=${offset}${lookup?'&type=album':''}`,requestOptions);let data=await response.json();if(sequence!==spotifySearchSequence)return;if(!response.ok)throw new Error(data.error||'Spotify search failed');
      let groups=(lookup?[data.albums]:[data.albums,data.tracks,data.artists,data.playlists]).filter(Boolean);let results=groups.flatMap(group=>group.items||[]).filter(Boolean).filter(item=>!lookup||matchesCollectionSpotifyAlbum(item,lookup));
      if(lookup&&!results.length&&page===1&&!lookup.searchByTitle&&lookup.artist){const titleSearch=`album:${lookup.title}`.slice(0,200);response=await fetch(`/api/spotify/search?q=${encodeURIComponent(titleSearch)}&offset=0&type=album`,requestOptions);data=await response.json();if(sequence!==spotifySearchSequence)return;if(!response.ok)throw new Error(data.error||'Spotify search failed');lookup.searchByTitle=true;groups=[data.albums].filter(Boolean);results=groups.flatMap(group=>group.items||[]).filter(item=>matchesCollectionSpotifyAlbum(item,lookup))}
      if(lookup)results=uniqueCollectionSpotifyAlbums(results);const sortable=results.map(item=>({item,title:item.name,artist:item.artists?.map(value=>value.name).join(', ')||item.owner?.display_name||'',album:item.album?.name||(item.type==='album'?item.name:''),year:(item.release_date||item.album?.release_date||'').slice(0,4)}));const ordered=sortRecords(sortable,spotifyLibrarySort==='plays'?'recent':spotifyLibrarySort,document.querySelector('#spotifySortDirection').value).map(entry=>entry.item);const total=groups.reduce((sum,group)=>sum+Number(group.total||0),0);const pages=Math.min(101,Math.max(1,...groups.map(group=>Math.ceil(Number(group.total||0)/10))));
      spotifyCatalogResults=ordered;grid.innerHTML=ordered.map(item=>lookup?spotifyCollectionResultCard(item):spotifySearchCard(item,item.type,false,onHome?'home':true)).join('')||`<p class="empty-state">${lookup?'No close album matches on this page. Try another page or edit the search.':'No Spotify results matched this search.'}</p>`;status.textContent=lookup?`${ordered.length} possible album ${ordered.length===1?'match':'matches'} on this page`:`${total} Spotify results`;renderPagination(paginationId,spotifyCatalogPage,pages,1,'spotify-catalog');document.querySelector('#spotifyCatalogNote').textContent=lookup?'Album matches are not necessarily the same physical pressing.':'Results are from the full Spotify catalog.';
      if(lookup){const ids=ordered.map(item=>item.id).filter(id=>/^[A-Za-z0-9]{22}$/.test(id||''));for(let index=0;index<ids.length&&sequence===spotifySearchSequence;index+=3)await Promise.all(ids.slice(index,index+3).map(id=>loadSpotifyAlbumTracks(id,0,sequence)))}
    }catch(error){if(sequence!==spotifySearchSequence)return;showToast(error.message);grid.innerHTML=`<p class="empty-state">${escapeHtml(error.message)}</p>`;document.querySelector(`#${paginationId}`).innerHTML='';status.textContent='Spotify search unavailable'}
    finally{if(spotifySearchCompletion===resolve)spotifySearchCompletion=null;resolve()}
  },force?0:250)})
}
async function loadSpotifyAlbumTracks(id,offset,sequence){
  if(!/^[A-Za-z0-9]{22}$/.test(id||'')||!Number.isInteger(offset)||offset<0||offset>950||offset%50)return;
  const panel=document.querySelector(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${id}"]`);if(!panel)return;
  const list=panel.querySelector('.spotify-lookup-track-list');const more=panel.querySelector('.spotify-lookup-more');const errorNote=panel.querySelector('.spotify-lookup-track-error');const generation=spotifyAccountGeneration;
  more.hidden=true;more.disabled=true;errorNote.hidden=true;
  try{
    const response=await fetch(`/api/spotify/albums/${id}/tracks?offset=${offset}`);const data=await response.json();
    if(sequence!==spotifySearchSequence||generation!==spotifyAccountGeneration||!spotifyConnected)return;
    if(!response.ok)throw new Error(data.error||'Could not load album tracks');
    if(!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.total<0)throw new Error('Spotify returned an invalid track list');
    const rows=data.items.map((track,index)=>{if(!/^spotify:track:[A-Za-z0-9]+$/.test(track?.uri||'')||typeof track.name!=='string')return '';const number=Number.isSafeInteger(track.track_number)&&track.track_number>0?track.track_number:offset+index+1;const disc=Number.isSafeInteger(track.disc_number)&&track.disc_number>1?`${track.disc_number}.`:'';const duration=Number.isFinite(track.duration_ms)&&track.duration_ms>=0?formatTime(track.duration_ms):'—';return `<div class="spotify-album-track"><span>${disc}${number}</span><div class="spotify-album-track-title"><strong>${escapeHtml(track.name)}</strong><span class="spotify-album-track-state"></span></div><span>${duration}</span><button type="button" class="spotify-track-liked" data-uri="${escapeHtml(track.uri)}" data-liked-state="checking" aria-label="Checking Liked Songs" title="Checking Liked Songs" disabled>…</button><button type="button" class="spotify-play-result" data-uri="${escapeHtml(track.uri)}" data-context-uri="spotify:album:${id}" aria-label="Play ${escapeHtml(track.name)}">▶ Play</button>${/^spotify:track:([A-Za-z0-9]{22})$/.test(track.uri)?`<a class="spotify-track-source" href="https://open.spotify.com/track/${track.uri.slice(-22)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(track.name)} on Spotify" title="Open Spotify"><img src="assets/spotify-icon-white.svg" alt="" /></a>`:''}</div>`}).join('');
    if(offset===0)list.innerHTML=rows||'<p class="empty-state">No playable tracks were returned for this album.</p>';else list.insertAdjacentHTML('beforeend',rows);
    syncSpotifyAlbumTrackIndicator();
    if(rows)void loadSpotifyAlbumLikedStatus(panel,sequence,generation);
    const nextOffset=offset+50;more.hidden=nextOffset>=data.total||nextOffset>950;more.dataset.offset=String(nextOffset);more.textContent='Show more tracks';more.disabled=false;
  }catch(error){if(sequence!==spotifySearchSequence||generation!==spotifyAccountGeneration||!spotifyConnected)return;if(offset===0)list.innerHTML='';errorNote.textContent=error.message;errorNote.hidden=false;more.dataset.offset=String(offset);more.textContent='Retry tracks';more.hidden=false;more.disabled=false}
}
function renderAlbumTrackLiked(button,state){
  button.dataset.likedState=state;
  const label=state==='saved'?'In Liked Songs':state==='unsaved'?(spotifyCanModifyLibrary?'Save to Liked Songs':'Enable Liked Songs permission in Settings'):state==='error'?'Retry Liked Songs status':state==='saving'?'Saving to Liked Songs…':'Checking Liked Songs…';
  button.textContent=state==='saved'?'♥':state==='unsaved'?'♡':state==='error'?'↻':'…';
  button.disabled=state==='saved'||state==='saving'||state==='checking'||(state==='unsaved'&&!spotifyCanModifyLibrary);
  button.setAttribute('aria-label',label);button.title=label;
}
async function loadSpotifyAlbumLikedStatus(panel,sequence,generation,uri=''){
  const buttons=[...panel.querySelectorAll('.spotify-track-liked')].filter(button=>uri?button.dataset.uri===uri:button.dataset.likedState==='checking');
  const current=()=>spotifyConnected&&sequence===spotifySearchSequence&&generation===spotifyAccountGeneration&&document.querySelector(`.collection-lookup-results .spotify-lookup-tracks[data-album-id="${panel.dataset.albumId}"]`)===panel;
  for(let start=0;start<buttons.length;start+=40){
    const chunk=buttons.slice(start,start+40);chunk.forEach(button=>renderAlbumTrackLiked(button,'checking'));
    try{
      const response=await fetch(`/api/spotify/liked?uris=${encodeURIComponent(chunk.map(button=>button.dataset.uri).join(','))}`);const data=await response.json();
      if(!current())return;
      if(!response.ok)throw new Error(data.error||'Could not check Liked Songs');
      if(!Array.isArray(data.saved)||data.saved.length!==chunk.length||data.saved.some(value=>typeof value!=='boolean'))throw new Error('Spotify returned an invalid Liked Songs status');
      chunk.forEach((button,index)=>{
        if(button.dataset.likedState!=='checking')return;
        renderAlbumTrackLiked(button,data.saved[index]?'saved':'unsaved');
        if(button.dataset.uri===spotifyTrackUri&&!likedMutationPending){
          ++likedRequestRevision;likedCheckPending=false;likedStatus=data.saved[index];renderPlayerLiked();
        }
      });
    }catch{if(!current())return;chunk.forEach(button=>{if(button.dataset.likedState==='checking')renderAlbumTrackLiked(button,'error')})}
  }
}
async function saveSpotifyAlbumTrack(button){
  const uri=button.dataset.uri;const generation=spotifyAccountGeneration;const sequence=spotifySearchSequence;
  if(!spotifyConnected||!spotifyCanModifyLibrary||button.dataset.likedState!=='unsaved'||!/^spotify:track:[A-Za-z0-9]+$/.test(uri||''))return;
  const peers=[...new Set([button,...document.querySelectorAll('.collection-lookup-results .spotify-track-liked')])].filter(item=>item.dataset.uri===uri);
  peers.forEach(item=>renderAlbumTrackLiked(item,'saving'));
  if(uri===spotifyTrackUri){likedMutationPending=true;renderPlayerLiked()}
  try{
    const response=await fetch('/api/spotify/liked',{method:'PUT',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({uri,saved:true})});const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Could not save to Liked Songs');
    if(data.ok!==true||data.saved!==true)throw new Error('Spotify did not confirm the Liked Songs change');
    if(generation!==spotifyAccountGeneration||!spotifyConnected)return;
    ++spotifyLibraryRevision;spotifyLibraryNeedsRefresh=true;spotifyLibraryPromise=null;
    if(uri===spotifyTrackUri){++likedRequestRevision;likedCheckPending=false;likedStatus=true}
    if(sequence===spotifySearchSequence)peers.forEach(item=>renderAlbumTrackLiked(item,'saved'));
    showToast(data.cacheWarning||'Saved to Liked Songs');
  }catch(error){if(generation===spotifyAccountGeneration&&sequence===spotifySearchSequence&&spotifyConnected){peers.forEach(item=>renderAlbumTrackLiked(item,'unsaved'));showToast(error.message||'Could not save to Liked Songs')}}
  finally{if(generation===spotifyAccountGeneration&&uri===spotifyTrackUri){likedMutationPending=false;renderPlayerLiked()}}
}
document.addEventListener('click',event=>{const more=event.target.closest('.spotify-lookup-more');if(!more||more.disabled)return;const panel=more.closest('.spotify-lookup-tracks');loadSpotifyAlbumTracks(panel.dataset.albumId,Number(more.dataset.offset),spotifySearchSequence)});
document.addEventListener('click',event=>{const button=event.target.closest('.spotify-track-liked');if(!button||button.disabled)return;if(button.dataset.likedState==='error'){loadSpotifyAlbumLikedStatus(button.closest('.spotify-lookup-tracks'),spotifySearchSequence,spotifyAccountGeneration,button.dataset.uri);return}void saveSpotifyAlbumTrack(button)});
let spotifyPlaylistSequence=0;
function spotifyPlaylistRecords(tracks,playlistId=''){return tracks.filter(track=>track&&typeof track==='object').map(track=>{const album=track.album||{};const albumContext=album.uri||(typeof album.id==='string'&&/^[A-Za-z0-9]+$/.test(album.id)?`spotify:album:${album.id}`:'');const contextUri=/^[A-Za-z0-9]+$/.test(playlistId)?`spotify:playlist:${playlistId}`:albumContext;return {title:track.name||'Untitled track',artist:track.artists?.map(item=>item.name).join(', ')||'Spotify',album:album.name||'Album unavailable',albumId:typeof album.id==='string'?album.id:'',kind:'track',contextUri,matchTitle:album.name||'',matchArtist:album.artists?.map(item=>item.name).join(', ')||track.artists?.map(item=>item.name).join(', ')||'',year:(album.release_date||'').slice(0,4)||'Year unknown',tone:'#31595c',accent:'#f1b597',word:album.name||track.name,image:safeImageUrl(album.images?.[0]?.url),format:'Playlist track',addedAt:'',uri:track.uri}})}
async function loadSpotifyPlaylist(id,force=false){
  if(!spotifyConnected)return;
  const generation=spotifyAccountGeneration;const sequence=++spotifyPlaylistSequence;++spotifySearchSequence;clearTimeout(spotifySearchTimer);if(spotifySearchCompletion){spotifySearchCompletion();spotifySearchCompletion=null}
  const current=()=>spotifyConnected&&generation===spotifyAccountGeneration&&sequence===spotifyPlaylistSequence;
  document.querySelector('#spotifyPlaylistSelect').value=id;setSidebarPlaylistValue(id);setSpotifySearchScope('library',true);if(!force)document.querySelector('#searchInput').value='';updateSearchContext();if(!force||spotifyLibraryLoaded)spotifyPlaylistPreviewState=null;spotifyLibraryError='';
  if(!id){spotifyLibraryLoaded=spotifySavedLibraryLoaded&&!spotifyLibraryNeedsRefresh;spotifyLibraryAlbums=spotifyLibraryLoaded?spotifySavedAlbums:[];renderSpotifyLibrary('');if(spotifyLibraryLoaded)settleSpotifyLibraryNotice(spotifyLibrarySyncSource,spotifyLibraryLastUpdated,savedLibraryFreshnessNote());else showSpotifyLibraryNotice('Loading your saved Spotify albums…');maybeLoadSpotifyLibrary();return}
  if(!force){spotifyLibraryAlbums=[];spotifyLibraryLoaded=false;renderSpotifyLibrary('')}showSpotifyLibraryNotice(force?'Refreshing selected playlist…':'Loading selected playlist…');
  const endpoint=`/api/spotify/playlist?id=${encodeURIComponent(id)}`;
  try{
    if(!force){const previewResponse=await fetch(`${endpoint}&preview=1`);const previewData=await previewResponse.json();if(!current())return;
    if(!previewResponse.ok||!Array.isArray(previewData.tracks)||!Number.isSafeInteger(previewData.total)||previewData.total<0||previewData.total<previewData.tracks.length)throw new Error('Playlist preview unavailable');
    spotifyLibraryAlbums=spotifyPlaylistRecords(previewData.tracks,id);spotifyLibraryLoaded=true;spotifyPlaylistPreviewState={total:previewData.total,status:'loading'};
    renderSpotifyLibrary(document.querySelector('#searchInput').value);const previewSync=spotifySyncLabel(previewData.sync?.source,previewData.sync?.updatedAt);showSpotifyLibraryNotice(`${previewSync?`${previewSync} · `:''}Showing ${spotifyLibraryAlbums.length} ${spotifyLibraryAlbums.length===1?'track':'tracks'} from ${previewData.total} playlist items. Search and sort cover the preview until loading completes.`)}
  }catch{if(!current())return}
  try{
    const response=await fetch(endpoint,force?{method:'POST',headers:{'X-RCRD-Request':'1'}}:undefined);const data=await response.json();if(!current())return;
    if(!response.ok)throw new Error(data.error||'Could not load playlist');if(!Array.isArray(data.tracks))throw new Error('Spotify returned an invalid playlist');
    const records=spotifyPlaylistRecords(data.tracks,id);spotifyLibraryAlbums=records;spotifyLibraryLoaded=true;spotifyPlaylistPreviewState=null;spotifyLibraryError='';renderSpotifyLibrary(document.querySelector('#searchInput').value);const sync=spotifySyncLabel(data.sync?.source,data.sync?.updatedAt);settleSpotifyLibraryNotice(data.sync?.source,data.sync?.updatedAt,`${sync?`${sync} · `:''}Showing ${records.length} tracks from the selected playlist.`);
  }catch(error){
    if(!current())return;
    if(spotifyPlaylistPreviewState){spotifyPlaylistPreviewState.status='unavailable';renderSpotifyLibrary(document.querySelector('#searchInput').value);showSpotifyLibraryNotice('Only the playlist preview is available. Select this playlist again to retry loading the rest.')}
    else if(force&&spotifyLibraryLoaded){showSpotifyLibraryNotice(`Showing the previous playlist copy · refresh failed (${error.message}).`)}
    else{spotifyLibraryError='This playlist could not be loaded. Choose another playlist or try again.';renderSpotifyLibrary('');document.querySelector('#spotifyLibraryStatus').textContent='Playlist unavailable'}
    showToast(error.message);
  }
}
async function refreshSpotifyPlaylists(){if(!spotifyConnected)return;const generation=spotifyAccountGeneration;try{const response=await fetch('/api/spotify/playlists');const data=await response.json();if(!spotifyConnected||generation!==spotifyAccountGeneration)return;if(!response.ok)throw new Error(data.error||'Could not load Spotify playlists');const playlists=(data.playlists||[]).map(list=>({id:list.id,name:`${list.name} (${list.tracksTotal})`}));const select=document.querySelector('#spotifyPlaylistSelect');select.disabled=false;select.innerHTML='<option value="">Saved library</option>'+playlists.map(list=>`<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}</option>`).join('');setSidebarPlaylistOptions(playlists);if(!data.playlists?.length)showSpotifyLibraryNotice('No readable Spotify playlists were returned for this account.')}catch(error){if(!spotifyConnected||generation!==spotifyAccountGeneration)return;showSpotifyLibraryNotice(error.message);const select=document.querySelector('#spotifyPlaylistSelect');select.disabled=true;select.innerHTML='<option value="">Playlists unavailable</option>';setSidebarPlaylistOptions([],'Playlists unavailable',true)}}
async function refreshSpotifyLibrary(force=false){
  if(!spotifyConnected||spotifySavedLibraryLoaded&&!force)return;
  if(spotifyLibraryPromise)return spotifyLibraryPromise;
  const generation=spotifyAccountGeneration;
  const revision=spotifyLibraryRevision;
  spotifyLibraryError='';
  showSpotifyLibraryNotice(spotifyLibraryLastUpdatedGeneration===generation?`Refreshing saved library · previously loaded data${spotifyLibraryLastUpdated>0?` from ${libraryUpdatedLabel(spotifyLibraryLastUpdated)}`:''} remains available.`:'Syncing saved library…');
  if(spotifyLibraryProgressTimer)clearInterval(spotifyLibraryProgressTimer);
  const progressTimer=setInterval(()=>{if(generation!==spotifyAccountGeneration||!spotifyConnected){clearInterval(progressTimer);if(spotifyLibraryProgressTimer===progressTimer)spotifyLibraryProgressTimer=null;return}pollSpotifyLibraryProgress(generation,revision)},1500);spotifyLibraryProgressTimer=progressTimer;
  if(!force&&!document.querySelector('#spotifyPlaylistSelect').value){spotifyLibraryLoaded=false;if(spotifySearchMode==='library')renderSpotifyLibrary(document.querySelector('#searchInput').value)}
  spotifyLibraryPromise=(async()=>{
    try{
      const response=await fetch('/api/spotify/library',force?{method:'POST',headers:{'X-RCRD-Request':'1'}}:undefined);
      const data=await response.json();
      if(!spotifyConnected||generation!==spotifyAccountGeneration||revision!==spotifyLibraryRevision)return;
      if(!response.ok)throw new Error(data.error||'Could not load Spotify library');
      const albumsById=new Map();
      (data.savedAlbums||[]).forEach(entry=>{const album=entry.album||entry;if(!album.id)return;albumsById.set(album.id,{album,addedAt:entry.added_at||'',trackNames:[]})});
      spotifyLibraryTracks=(data.saved||[]).flatMap(entry=>{const record=spotifyPlaylistRecords([entry?.track||entry])[0];return record?[{...record,format:'Spotify saved track',addedAt:entry?.added_at||''}]:[]});
      (data.saved||[]).forEach(entry=>{const track=entry.track||entry;const album=track.album||{};if(!album.id)return;const existing=albumsById.get(album.id)||{album,addedAt:entry.added_at||'',trackNames:[]};existing.trackNames.push(track.name||'');if(String(entry.added_at||'')>String(existing.addedAt||''))existing.addedAt=entry.added_at;albumsById.set(album.id,existing)});
      spotifySavedAlbums=[...albumsById.values()].map(({album,addedAt,trackNames})=>({title:album.name||'Untitled album',artist:album.artists?.map(item=>item.name).join(', ')||'Spotify',album:album.name||'Untitled album',albumId:typeof album.id==='string'?album.id:'',year:(album.release_date||'').slice(0,4)||'Year unknown',tone:'#31595c',accent:'#f1b597',word:album.name||'Spotify',image:safeImageUrl(album.images?.[0]?.url),format:'Spotify saved album',addedAt,searchText:trackNames.join(' '),uri:album.uri}));
      spotifySavedLibraryLoaded=true;
      spotifyLibraryLastUpdated=Number.isSafeInteger(data.sync?.updatedAt)?data.sync.updatedAt:0;spotifyLibraryLastUpdatedGeneration=generation;spotifyLibrarySyncSource=data.sync?.source||'unknown';
      if(!document.querySelector('#spotifyPlaylistSelect').value){spotifyLibraryLoaded=true;spotifyLibraryAlbums=spotifySavedAlbums;if(spotifySearchMode==='library')renderSpotifyLibrary(document.querySelector('#searchInput').value);settleSpotifyLibraryNotice(spotifyLibrarySyncSource,spotifyLibraryLastUpdated,savedLibraryFreshnessNote())}
      updateHomeRecommendations(data.recentlyPlayed||[],spotifySavedAlbums);
    }catch(error){
      if(!spotifyConnected||generation!==spotifyAccountGeneration||revision!==spotifyLibraryRevision)return;
      spotifyLibraryError=error.message;
      if(!document.querySelector('#spotifyPlaylistSelect').value){if(spotifySavedLibraryLoaded&&spotifyLibraryLastUpdatedGeneration===generation){spotifyLibraryLoaded=true;spotifyLibraryAlbums=spotifySavedAlbums}if(spotifySearchMode==='library')renderSpotifyLibrary(document.querySelector('#searchInput').value);showSpotifyLibraryNotice(spotifyLibraryLoaded?`Previously loaded data${spotifyLibraryLastUpdated>0?` · updated ${libraryUpdatedLabel(spotifyLibraryLastUpdated)}`:''} · Spotify unavailable (${error.message}).`:error.message)}
    }finally{if(spotifyLibraryProgressTimer===progressTimer){clearInterval(progressTimer);spotifyLibraryProgressTimer=null}if(generation===spotifyAccountGeneration&&revision===spotifyLibraryRevision)spotifyLibraryPromise=null}
  })();
  return spotifyLibraryPromise;
}
let listeningHistoryRevision=0;
let listeningHistoryBusy=false;
let listeningHistoryPage=1;
let listeningHistorySearchTimer=null;
function resetListeningHistoryUi(){
  ++listeningHistoryRevision;
  listeningHistoryBusy=false;
  listeningHistoryPage=1;
  clearTimeout(listeningHistorySearchTimer);listeningHistorySearchTimer=null;
  document.querySelector('#spotifyHistoryImport').disabled=true;
  document.querySelector('#spotifyHistoryDelete').hidden=true;
  document.querySelector('#spotifyHistoryStatus').textContent='Connect Spotify to import listening history.';
  document.querySelector('#spotifyHistoryBrowse').hidden=true;
  document.querySelector('#spotifyHistorySearch').value='';
  document.querySelector('#spotifyHistorySort').value='plays';syncThemedSelect(document.querySelector('#spotifyHistorySort'));
  const direction=document.querySelector('#spotifyHistoryDirection');direction.value='desc';direction.textContent='↓';direction.setAttribute('aria-label','Sort descending');direction.title='Sort descending';
  document.querySelector('#spotifyHistoryMatches').textContent='';
  document.querySelector('#spotifyHistoryTracks').replaceChildren();
  document.querySelector('#spotifyHistoryPagination').innerHTML='';
}
function renderListeningHistory(data){
  const status=document.querySelector('#spotifyHistoryStatus');
  const browse=document.querySelector('#spotifyHistoryBrowse');
  const list=document.querySelector('#spotifyHistoryTracks');
  list.replaceChildren();
  document.querySelector('#spotifyHistoryDelete').hidden=!data.imported&&!data.recentPlaysStored;
  document.querySelector('#spotifyHistoryImport').disabled=!spotifyConnected||listeningHistoryBusy;
  if(!data.imported){browse.hidden=true;document.querySelector('#spotifyHistoryMatches').textContent='';document.querySelector('#spotifyHistoryPagination').innerHTML='';status.textContent=data.recentPlaysStored?'Recent Spotify plays are recorded on this computer. Import a ZIP to add older listening.':'No history imported for this Spotify account yet.';return}
  browse.hidden=false;
  const through=new Date(data.lastAt);
  status.textContent=`${Number(data.totalPlays).toLocaleString()} plays across ${Number(data.trackCount).toLocaleString()} tracks · through ${through.toLocaleDateString()} · imported ${new Date(data.importedAt).toLocaleDateString()}. Reimport a newer ZIP to refresh.`;
  if(!Array.isArray(data.tracks)){document.querySelector('#spotifyHistoryMatches').textContent='Restart RCRD to browse all imported tracks.';document.querySelector('#spotifyHistoryPagination').innerHTML='';return}
  const page=Number(data.page)||1;const perPage=Number(data.perPage)||12;const matches=Number(data.matches)||0;
  listeningHistoryPage=page;
  document.querySelector('#spotifyHistoryMatches').textContent=matches?`Showing ${(page-1)*perPage+1}–${(page-1)*perPage+data.tracks.length} of ${matches.toLocaleString()} ${document.querySelector('#spotifyHistorySearch').value.trim()?'matching ':''}tracks`:'No tracks match this search.';
  for(const [index,track] of data.tracks.entries()){
    const item=document.createElement('li');
    const rank=document.createElement('span');rank.className='history-rank';rank.textContent=String((page-1)*perPage+index+1);
    const detail=document.createElement('span');detail.className='history-track';
    const title=document.createElement('b');title.textContent=track.title;
    const artist=document.createElement('small');artist.textContent=[track.artist,track.album].filter(Boolean).join(' · ');
    detail.append(title,artist);
    const count=document.createElement('strong');count.className='history-plays';count.textContent=`${Number(track.plays).toLocaleString()} plays`;
    item.append(rank,detail,count);list.append(item);
  }
  list.scrollTop=0;
  renderPagination('spotifyHistoryPagination',page,matches,perPage,'spotify-history',true);
}
async function refreshListeningHistory(page=listeningHistoryPage){
  const revision=++listeningHistoryRevision;
  const generation=spotifyAccountGeneration;
  if(!spotifyConnected){resetListeningHistoryUi();return}
  listeningHistoryPage=page;
  document.querySelector('#spotifyHistoryImport').disabled=listeningHistoryBusy;
  if(!listeningHistoryBusy){if(document.querySelector('#spotifyHistoryBrowse').hidden)document.querySelector('#spotifyHistoryStatus').textContent='Checking imported history…';else document.querySelector('#spotifyHistoryMatches').textContent='Loading tracks…'}
  try{
    const params=new URLSearchParams({page:String(page),sort:document.querySelector('#spotifyHistorySort').value,direction:document.querySelector('#spotifyHistoryDirection').value,q:document.querySelector('#spotifyHistorySearch').value.trim()});
    const response=await fetch(`/api/spotify/history?${params}`);const data=await response.json();
    if(revision!==listeningHistoryRevision||generation!==spotifyAccountGeneration||!spotifyConnected||listeningHistoryBusy)return;
    if(!response.ok)throw new Error(data.error||'Could not load listening history');
    renderListeningHistory(data);
    resetSpotifyPlayCounts();if(document.querySelector('.active-view')?.id==='spotify')renderSpotifyLibrary(document.querySelector('#searchInput').value,spotifyLibraryPage);
  }catch(error){if(revision===listeningHistoryRevision&&generation===spotifyAccountGeneration&&!listeningHistoryBusy){const target=document.querySelector('#spotifyHistoryBrowse').hidden?'#spotifyHistoryStatus':'#spotifyHistoryMatches';document.querySelector(target).textContent=error.message}}
}
document.querySelector('#spotifyHistorySearch').addEventListener('input',()=>{clearTimeout(listeningHistorySearchTimer);listeningHistorySearchTimer=setTimeout(()=>{listeningHistorySearchTimer=null;refreshListeningHistory(1)},250)});
document.querySelector('#spotifyHistorySort').addEventListener('change',()=>refreshListeningHistory(1));
document.querySelector('#spotifyHistoryDirection').addEventListener('click',event=>{const button=event.currentTarget;button.value=button.value==='desc'?'asc':'desc';button.textContent=button.value==='desc'?'↓':'↑';button.setAttribute('aria-label',button.value==='desc'?'Sort descending':'Sort ascending');button.title=button.getAttribute('aria-label');refreshListeningHistory(1)});
document.querySelector('#spotifyHistoryImport').addEventListener('click',()=>document.querySelector('#spotifyHistoryFile').click());
document.querySelector('#spotifyHistoryFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';
  if(!file||!spotifyConnected||listeningHistoryBusy)return;
  const status=document.querySelector('#spotifyHistoryStatus');
  if(!/\.zip$/i.test(file.name)||file.size<4||file.size>256*1024*1024){status.textContent='Select the Extended Streaming History ZIP from Spotify (up to 256 MB).';return}
  if(!confirm('Confirm this ZIP belongs to the Spotify account currently connected to RCRD. Some Spotify exports have no account ID, so RCRD cannot verify them. Importing the wrong ZIP would assign its counts to this account. Continue?')){status.textContent='Import cancelled. No listening counts were changed.';return}
  const generation=spotifyAccountGeneration;
  const revision=++listeningHistoryRevision;
  listeningHistoryBusy=true;
  document.querySelector('#spotifyHistoryImport').disabled=true;
  document.querySelector('#spotifyHistoryDelete').disabled=true;
  status.textContent='Importing locally… Larger histories may take a few minutes. Keep RCRD open.';
  try{
    const response=await fetch('/api/spotify/history',{method:'POST',headers:{'Content-Type':'application/zip','X-RCRD-Request':'1','X-RCRD-History-Account-Confirmed':'1'},body:file});
    const data=await response.json();
    if(generation!==spotifyAccountGeneration||revision!==listeningHistoryRevision||!spotifyConnected)return;
    if(!response.ok)throw new Error(data.error||'Could not import Spotify history');
    listeningHistoryPage=1;document.querySelector('#spotifyHistorySearch').value='';document.querySelector('#spotifyHistorySort').value='plays';syncThemedSelect(document.querySelector('#spotifyHistorySort'));const direction=document.querySelector('#spotifyHistoryDirection');direction.value='desc';direction.textContent='↓';direction.setAttribute('aria-label','Sort descending');direction.title='Sort descending';
    renderListeningHistory(data);
  }catch(error){if(generation===spotifyAccountGeneration&&revision===listeningHistoryRevision)status.textContent=error.message}
  finally{if(generation===spotifyAccountGeneration&&revision===listeningHistoryRevision){listeningHistoryBusy=false;document.querySelector('#spotifyHistoryImport').disabled=false;document.querySelector('#spotifyHistoryDelete').disabled=false}}
});
document.querySelector('#spotifyHistoryDelete').addEventListener('click',async()=>{
  if(!spotifyConnected||listeningHistoryBusy||!confirm('Delete imported and recently recorded play counts for this Spotify account from RCRD? The Spotify download on your computer is not changed.'))return;
  const generation=spotifyAccountGeneration;
  listeningHistoryBusy=true;
  document.querySelector('#spotifyHistoryDelete').disabled=true;
  document.querySelector('#spotifyHistoryStatus').textContent='Deleting recorded counts…';
  try{
    const response=await fetch('/api/spotify/history',{method:'DELETE',headers:{'X-RCRD-Request':'1'}});
    const data=await response.json();
    if(generation!==spotifyAccountGeneration||!spotifyConnected)return;
    if(!response.ok)throw new Error(data.error||'Could not delete recorded counts');
    renderListeningHistory({imported:false});
    resetSpotifyPlayCounts();if(document.querySelector('.active-view')?.id==='spotify')renderSpotifyLibrary(document.querySelector('#searchInput').value,spotifyLibraryPage);
  }catch(error){if(generation===spotifyAccountGeneration)document.querySelector('#spotifyHistoryStatus').textContent=error.message}
  finally{if(generation===spotifyAccountGeneration){listeningHistoryBusy=false;document.querySelector('#spotifyHistoryDelete').disabled=false;document.querySelector('#spotifyHistoryImport').disabled=false}}
});
document.querySelector('#connectSpotify').onclick=()=>{if(spotifyConnected)document.querySelector('[data-view="settings"]').click();else location.href='/auth/spotify/start'};refreshSpotifyStatus();
function updateSettingsAccountAction(service,connected){const connect=document.querySelector(`#settings${service}Reconnect`);const disconnect=document.querySelector(`#settings${service}Disconnect`);connect.hidden=connected;disconnect.hidden=!connected}
async function refreshSettingsStatus(){
  const spotifyGeneration=spotifyAccountGeneration;
  const discogsGeneration=discogsAccountGeneration;
  try{
    const [spotifyResponse,discogsResponse]=await Promise.all([fetch('/api/spotify/status'),fetch('/api/session')]);
    const spotify=await spotifyResponse.json();
    const discogs=await discogsResponse.json();
    if(spotifyGeneration!==spotifyAccountGeneration||discogsGeneration!==discogsAccountGeneration)return;
    if(!spotifyResponse.ok||!discogsResponse.ok)throw new Error('Connection status unavailable');
    renderSpotifyConnectionStatus(spotify);
    const discogsIsConnected=Boolean(discogs.connected);
    document.querySelector('#settingsDiscogsStatus').textContent=discogsIsConnected?'Connected':'Not connected';
    updateSettingsAccountAction('Discogs',discogsIsConnected);
    refreshListeningHistory();
  }catch{
    if(spotifyGeneration!==spotifyAccountGeneration||discogsGeneration!==discogsAccountGeneration)return;
    renderSpotifyConnectionStatus({});
    document.querySelector('#settingsDiscogsStatus').textContent='Unavailable';
    updateSettingsAccountAction('Discogs',false);
  }
}
document.querySelector('#settingsSpotifyReconnect').onclick=()=>location.href='/auth/spotify/start';document.querySelector('#settingsDiscogsReconnect').onclick=()=>location.href='/auth/discogs/start';async function disconnectAccount(endpoint){try{const response=await fetch(endpoint,{method:'POST',headers:{'X-RCRD-Request':'1'}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Sign out failed');if(endpoint.includes('spotify'))resetSpotifyAccountUi();if(endpoint.includes('discogs'))resetDiscogsAccountUi();await refreshSettingsStatus();showToast(`${endpoint.includes('spotify')?'Spotify':'Discogs'} signed out of RCRD`)}catch(error){showToast(error.message)}}document.querySelector('#settingsSpotifyDisconnect').onclick=()=>disconnectAccount('/api/spotify/disconnect');document.querySelector('#settingsDiscogsDisconnect').onclick=()=>disconnectAccount('/api/discogs/disconnect');document.querySelectorAll('[data-view="settings"]').forEach(link=>link.addEventListener('click',refreshSettingsStatus));refreshSettingsStatus();
async function clearLocalAccountData(){
  const button=document.querySelector('#clearLocalAccountData');
  const status=document.querySelector('#clearLocalAccountDataStatus');
  if(button.disabled||!confirm('Sign out of Spotify and Discogs and clear this browser\'s RCRD collection, wantlist, and preferences? This cannot be undone. Provider website logins and developer credentials will remain.'))return;
  button.disabled=true;
  status.textContent='Signing out and clearing local data…';
  try{
    for(const [service,reset] of [['spotify',resetSpotifyAccountUi],['discogs',resetDiscogsAccountUi]]){
      const response=await fetch(`/api/${service}/disconnect`,{method:'POST',headers:{'X-RCRD-Request':'1'}});
      if(!response.ok)throw new Error('An account could not be signed out. Local records have not been cleared.');
      reset();
    }
    localStorage.setItem('rcrdCollection','[]');
    localStorage.setItem('rcrdWantlist','[]');
    localStorage.removeItem('rcrdUiPreferences');
    try{sessionStorage.removeItem('rcrd-restart-completed');sessionStorage.removeItem('rcrd-restart-from-menu')}catch{}
    status.textContent='RCRD data cleared. Reloading…';
    try{location.reload()}catch{status.textContent='RCRD data cleared. Reload this page to finish.';button.disabled=false}
  }catch{
    status.textContent='Could not finish clearing RCRD data. Check account status and try again; local records may remain.';
    button.disabled=false;
    await refreshSettingsStatus();
  }
}
document.querySelector('#clearLocalAccountData').addEventListener('click',clearLocalAccountData);
function setSong(title,artist,image='',album=null){
  if(!spotifyConnected)closeLyricsDialog();
  document.querySelector('#playerLyrics').disabled=!spotifyConnected||!spotifyTrackUri;
  setPlayerAlbum(album,artist,image);document.querySelector('#playerTitle').textContent=title;document.querySelector('#playerArtist').textContent=artist;const spotifyLink=document.querySelector('#playerSpotifyLink');const trackId=/^spotify:track:([A-Za-z0-9]{22})$/.exec(spotifyTrackUri||'')?.[1];spotifyLink.hidden=!trackId;if(trackId)spotifyLink.href=`https://open.spotify.com/track/${trackId}`;document.querySelector('#playerDiscogs').dataset.query=`${artist} ${title}`;const art=safeImageUrl(image);for(const artwork of document.querySelectorAll('.mini-cover')){artwork.classList.toggle('has-art',Boolean(art));artwork.style.backgroundImage=art?`url("${art}")`:''}
}
let lyricsRequestRevision=0;let lyricsController=null;
function closeLyricsDialog(){++lyricsRequestRevision;if(lyricsController){lyricsController.abort();lyricsController=null}const dialog=document.querySelector('#lyricsDialog');if(dialog?.open)dialog.close();document.querySelector('#lyricsEmbed')?.replaceChildren()}
function handleLyricsDialogBackdropPointer(event){
  const dialog=event.currentTarget;
  if(!dialog.open||event.target!==dialog)return;
  const bounds=dialog.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>=bounds.right||event.clientY<bounds.top||event.clientY>=bounds.bottom)closeLyricsDialog();
}
async function openLyricsDialog(){
  if(!spotifyConnected||!spotifyTrackUri)return;
  closeLyricsDialog();
  const revision=lyricsRequestRevision;const uri=spotifyTrackUri;const generation=spotifyAccountGeneration;
  const title=document.querySelector('#playerTitle').textContent.trim();const artist=document.querySelector('#playerArtist').textContent.trim();
  const dialog=document.querySelector('#lyricsDialog');const status=document.querySelector('#lyricsStatus');const source=document.querySelector('#lyricsSource');
  document.querySelector('#lyricsTrack').textContent=`${title} · ${artist}`;status.hidden=false;status.textContent='Finding lyrics on Genius…';source.hidden=true;source.removeAttribute('href');dialog.showModal();
  const controller=new AbortController();lyricsController=controller;
  const current=()=>revision===lyricsRequestRevision&&uri===spotifyTrackUri&&generation===spotifyAccountGeneration&&dialog.open;
  try{
    const response=await fetch('/api/lyrics/genius',{method:'POST',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({title,artist}),signal:controller.signal});
    const data=await response.json();if(!current())return;
    if(!response.ok){status.textContent=typeof data.error==='string'?data.error:'Lyrics are unavailable right now.';if(response.status===404){source.href=`https://genius.com/search?q=${encodeURIComponent(`${title} ${artist}`)}`;source.textContent='Search Genius ↗';source.hidden=false}return}
    if(!Number.isSafeInteger(data.id)||data.id<1)throw new Error('Genius returned an invalid song match.');
    const frame=document.createElement('iframe');frame.title=`Genius lyrics for ${title}`;frame.setAttribute('sandbox','allow-scripts allow-popups allow-popups-to-escape-sandbox');frame.referrerPolicy='no-referrer';frame.dataset.geniusId=String(data.id);frame.src=`/genius-embed?id=${data.id}`;
    frame.addEventListener('load',()=>{if(current()&&frame.isConnected)status.hidden=true},{once:true});document.querySelector('#lyricsEmbed').replaceChildren(frame);
    let sourceUrl=`https://genius.com/songs/${data.id}`;
    try{const page=new URL(data.url);if(page.protocol==='https:'&&page.hostname==='genius.com'&&!page.port&&!page.username&&!page.password&&page.pathname.length>1)sourceUrl=`https://genius.com${page.pathname}`}catch{}
    status.textContent='Loading lyrics from Genius…';source.href=sourceUrl;source.textContent='Read on Genius ↗';source.hidden=false;
  }catch(error){if(current()&&error.name!=='AbortError')status.textContent='Lyrics are unavailable right now. Try again later.'}
  finally{if(lyricsController===controller)lyricsController=null}
}
function handleGeniusEmbedMessage(event){
  const frame=document.querySelector('#lyricsEmbed iframe');
  if(!frame||!document.querySelector('#lyricsDialog').open||event.source!==frame.contentWindow||event.data?.type!=='rcrd-genius-embed-error'||String(event.data.id)!==frame.dataset.geniusId)return;
  frame.remove();const status=document.querySelector('#lyricsStatus');status.hidden=false;status.textContent='Genius matched this song, but cannot display its lyrics inside RCRD. Use Read on Genius to view them.';
}
window.addEventListener('message',handleGeniusEmbedMessage);
document.querySelector('#playerLyrics').addEventListener('click',openLyricsDialog);
document.querySelector('#lyricsDialogClose').addEventListener('click',closeLyricsDialog);
document.querySelector('#lyricsDialog').addEventListener('close',closeLyricsDialog);
document.querySelector('#lyricsDialog').addEventListener('pointerdown',handleLyricsDialogBackdropPointer);
function renderPlayer(){const button=document.querySelector('#playButton');button.textContent=playing?'Ⅱ':'▶';button.classList.toggle('showing-play',!playing);syncSpotifyAlbumTrackIndicator()}
document.querySelector('#playButton').onclick=()=>{playing=!playing;renderPlayer()};document.querySelector('#playerDiscogs').onclick=()=>{const query=document.querySelector('#playerDiscogs').dataset.query;if(query)searchInDiscogs(query,'')};document.querySelector('#startListening').onclick=()=>document.querySelector('#recommendations').scrollIntoView({behavior:'smooth'});
document.addEventListener('click',e=>{if(e.target.matches('.api-wantlist'))addApiRecord(e.target,'wantlist');if(e.target.matches('.api-collection'))addApiRecord(e.target,'collection')});
function formatTime(milliseconds){const totalSeconds=Math.max(0,Math.floor(milliseconds/1000));return `${Math.floor(totalSeconds/60)}:${String(totalSeconds%60).padStart(2,'0')}`}
function updateProgress(position,duration){spotifyDurationMs=Number.isFinite(duration)&&duration>0?duration:0;spotifyPositionMs=Number.isFinite(position)&&position>0?Math.min(position,spotifyDurationMs):0;spotifyProgressUpdatedAt=performance.now();const progress=document.querySelector('#playerProgress');if(progress){progress.max=spotifyDurationMs||100;progress.value=spotifyPositionMs}document.querySelector('#playerPosition').textContent=formatTime(spotifyPositionMs);document.querySelector('#playerDuration').textContent=formatTime(spotifyDurationMs)}
function advanceSpotifyProgress(){if(!spotifyConnected||!spotifySyncTimer||document.visibilityState==='hidden'){if(spotifyProgressTimer){clearInterval(spotifyProgressTimer);spotifyProgressTimer=null}return}if(!playing||!spotifyDurationMs||spotifyPositionMs>=spotifyDurationMs){spotifyProgressUpdatedAt=performance.now();return}const elapsed=performance.now()-spotifyProgressUpdatedAt;if(!Number.isFinite(elapsed)||elapsed<=0)return;updateProgress(Math.min(spotifyDurationMs,spotifyPositionMs+elapsed),spotifyDurationMs)}
function updatePlaybackModes(state={}, {syncRepeat=true,syncShuffle=true}={}){if(state===null)state={repeat_state:'off',shuffle_state:false,context:null};const nextShuffle=typeof state.shuffle_state==='boolean'?state.shuffle_state:state.shuffle;if(syncShuffle&&typeof nextShuffle==='boolean')shuffleEnabled=nextShuffle;const sdkRepeat={0:'off',1:'context',2:'track'}[state.repeat_mode];const nextRepeat=syncRepeat?(state.repeat_state||sdkRepeat):undefined;if(['off','context','track'].includes(nextRepeat))repeatMode=nextRepeat;if(Object.prototype.hasOwnProperty.call(state,'context'))spotifyHasContext=Boolean(state.context?.uri);const shuffleButton=document.querySelector('#shuffleButton');if(shuffleButton){const label=shuffleEnabled?'Shuffle on':'Shuffle off';shuffleButton.classList.toggle('active',shuffleEnabled);shuffleButton.title=shuffleButton.dataset.playbackUnavailable==='true'?'Shuffle unavailable for this playback':label;shuffleButton.setAttribute('aria-label',label);shuffleButton.setAttribute('aria-pressed',String(shuffleEnabled))}const repeatButton=document.querySelector('#repeatButton');if(repeatButton){const label=repeatMode==='context'?'Repeat all':repeatMode==='track'?'Repeat one':'Repeat off';repeatButton.classList.toggle('active',repeatMode!=='off');repeatButton.dataset.repeatMode=repeatMode;repeatButton.dataset.repeatBadge=repeatMode==='context'?'ALL':repeatMode==='track'?'1':'';repeatButton.title=label;repeatButton.setAttribute('aria-label',label);repeatButton.setAttribute('aria-pressed',String(repeatMode!=='off'))}}
function applySpotifyActionAvailability(actions){for(const [selector,key,label] of [['#nextButton','skipping_next','Skip next'],['#previousButton','skipping_prev','Skip previous'],['#shuffleButton','toggling_shuffle','Shuffle']]){const button=document.querySelector(selector);if(!button)continue;const unavailable=actions?.[key]===false;button.dataset.playbackUnavailable=String(unavailable);button.disabled=unavailable;button.title=unavailable?`${label} unavailable for this playback` :key==='toggling_shuffle'?(shuffleEnabled?'Shuffle on':'Shuffle off'):label}const repeat=document.querySelector('#repeatButton');if(repeat){const unavailable=actions?.toggling_repeat_context===false&&actions?.toggling_repeat_track===false;repeat.dataset.playbackUnavailable=String(unavailable);repeat.disabled=unavailable;if(unavailable)repeat.title='Repeat unavailable for this playback'}const progress=document.querySelector('#playerProgress');if(progress)progress.disabled=actions?.seeking===false}
function setPlayerAlbum(album,artist='',image=''){
  const button=document.querySelector('#playerAlbumOpen');
  const id=typeof album?.id==='string'&&/^[A-Za-z0-9]{22}$/.test(album.id)?album.id:/^spotify:album:([A-Za-z0-9]{22})$/.exec(album?.uri||'')?.[1]||'';
  const title=typeof album?.name==='string'?album.name.trim():'';
  const available=Boolean(spotifyConnected&&spotifyTrackUri&&id&&title);
  button.disabled=!available;
  button.dataset.albumId=available?id:'';button.dataset.albumTitle=available?title:'';
  button.dataset.albumArtist=available?artist:'';button.dataset.albumImage=available?safeImageUrl(image):'';
  button.setAttribute('aria-label',available?`View album: ${title}`:'Album unavailable');
  button.title=available?`View ${title} and its tracks`:'Play a Spotify song to view its album';
}
function openPlayerAlbum(){
  const button=document.querySelector('#playerAlbumOpen');const id=button.dataset.albumId;
  if(button.disabled||!spotifyConnected||!spotifyTrackUri||!/^[A-Za-z0-9]{22}$/.test(id||''))return;
  const album={id,type:'album',name:button.dataset.albumTitle,artists:[{name:button.dataset.albumArtist}],images:[{url:button.dataset.albumImage}],uri:`spotify:album:${id}`};
  document.querySelector('.sidebar nav a[data-view="home"]').click();
  openHomeSpotifyAlbum(id,album);
}
document.querySelector('#playerAlbumOpen').addEventListener('click',openPlayerAlbum);
let spotifyPlaybackSyncGeneration=null;let spotifyPlaybackSyncAgain=false;
async function syncCurrentSpotifyTrack(force=false){
  if(!spotifyConnected||spotifySkipPending||spotifyTogglePending||spotifyPlaybackStartPending||shuffleRequestPending||repeatRequestPending)return;
  if(spotifyPlaybackSyncGeneration===spotifyAccountGeneration){if(force)spotifyPlaybackSyncAgain=true;return}
  const generation=spotifyAccountGeneration;const requestRepeatRevision=repeatRevision;const requestShuffleRevision=shuffleRevision;const playbackRevision=spotifyPlaybackStateRevision;
  spotifyPlaybackSyncGeneration=generation;spotifyPlaybackSyncAgain=false;
  const current=()=>spotifyConnected&&generation===spotifyAccountGeneration&&requestRepeatRevision===repeatRevision&&requestShuffleRevision===shuffleRevision&&playbackRevision===spotifyPlaybackStateRevision&&!spotifySkipPending&&!spotifyTogglePending&&!spotifyPlaybackStartPending&&!shuffleRequestPending&&!repeatRequestPending;
  try{
    const response=await fetch('/api/spotify/currently-playing');
    if(!response.ok){if(current()){spotifyActiveDevice='Unavailable';renderPlaybackHealth()}return}
    const item=response.status===204?null:await response.json();if(!current())return;
    const device=item?.device;
    spotifyActiveDevice=device?.is_active===false?'None reported':device?.id&&device.id===spotifyDeviceId?'RCRD · Spotify':typeof device?.name==='string'&&device.name.trim()?device.name.trim().slice(0,80):'None reported';
    if(device?.is_active&&typeof device.id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(device.id)&&!spotifyTargetDeviceId){spotifyTargetDeviceId=device.id;spotifyTargetSupportsVolume=device.supports_volume!==false;document.querySelector('#volumeControl').disabled=!spotifyTargetSupportsVolume;renderVolumeControl()}
    renderPlaybackHealth();updatePlaybackModes(item);applySpotifyActionAvailability(item?.actions);
    if(item?.item){const track=item.item;setCurrentSpotifyTrackUri(track.uri);setSong(track.name,track.artists?.map(artist=>artist.name).join(', ')||'Spotify',track.album?.images?.[0]?.url||'',track.album);playing=item.is_playing;updateProgress(item.progress_ms||0,track.duration_ms||0);renderPlayer()}
    else{setCurrentSpotifyTrackUri(null);setSong('Nothing playing','Playback unavailable','');playing=false;updateProgress(0,0);renderPlayer()}
  }catch{if(current()){spotifyActiveDevice='Unavailable';renderPlaybackHealth()}}
  finally{if(spotifyPlaybackSyncGeneration===generation){spotifyPlaybackSyncGeneration=null;const again=spotifyPlaybackSyncAgain;spotifyPlaybackSyncAgain=false;if(again&&spotifyConnected&&generation===spotifyAccountGeneration&&document.visibilityState!=='hidden')void syncCurrentSpotifyTrack()}}
}
function syncSpotifyPlaybackPolling(){
  if(!spotifyConnected||(!spotifyDeviceId&&!spotifyTargetDeviceId)||document.visibilityState==='hidden'){
    if(spotifySyncTimer){clearInterval(spotifySyncTimer);spotifySyncTimer=null}
    if(spotifyProgressTimer){clearInterval(spotifyProgressTimer);spotifyProgressTimer=null}
    return;
  }
  if(!spotifyProgressTimer){spotifyProgressUpdatedAt=performance.now();spotifyProgressTimer=window.setInterval(advanceSpotifyProgress,250)}
  if(spotifySyncTimer)return;
  syncCurrentSpotifyTrack();
  let ticks=0;
  spotifySyncTimer=window.setInterval(()=>{
    if(document.visibilityState==='hidden')return;
    const remote=spotifyTargetDeviceId&&spotifyTargetDeviceId!==spotifyDeviceId;
    const focused=typeof document.hasFocus!=='function'||document.hasFocus();
    const active=remote&&focused&&Date.now()-ambientLastActivity<60000;
    // SDK events cover local playback; actively watched external playback needs fresher metadata.
    if(++ticks%5===0||active)void syncCurrentSpotifyTrack();
  },3000);
}
async function transferSpotifyPlayback(){if(!spotifyDeviceId)return false;const generation=spotifyAccountGeneration;try{const response=await fetch('/api/spotify/transfer',{method:'PUT',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({device_id:spotifyDeviceId})});if(!spotifyConnected||generation!==spotifyAccountGeneration)return false;if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Could not activate the Spotify player')}return true}catch(error){if(spotifyConnected&&generation===spotifyAccountGeneration)showToast(error.message);return false}}
async function initSpotifyPlayer(){
  if(!spotifyConnected||spotifyCanStream===false||spotifyPlayer||spotifyPlayerConnectFailed||!window.Spotify)return;
  spotifyPlayerState='starting';spotifyPlayerIssue='';renderPlaybackHealth();
  const generation=spotifyAccountGeneration;
  let player;
  const current=()=>spotifyConnected&&generation===spotifyAccountGeneration&&spotifyPlayer===player;
  try{player=new Spotify.Player({name:'RCRD · Spotify',volume,getOAuthToken:async callback=>{
    if(!current())return;
    try{const response=await fetch('/api/spotify/token');if(!current())return;if(!response.ok){if(response.status===403)spotifyCanStream=false;failPlayer(response.status===403?'Spotify playback permission is missing. Reconnect Spotify.':response.status===401?'Spotify authorization could not be renewed. Reconnect Spotify.':'Spotify player token unavailable. Retry the player.');return}const data=await response.json();if(!current())return;if(typeof data?.access_token!=='string'||!data.access_token){failPlayer('Spotify player token unavailable. Retry the player.');return}callback(data.access_token)}
    catch{failPlayer('Spotify player token unavailable. Retry the player.')}
  }})}catch{spotifyPlayerConnectFailed=true;spotifyPlayerState='error';spotifyPlayerIssue='Spotify player could not initialize in this runtime. Retry the player.';renderPlaybackHealth();showToast(spotifyPlayerIssue);return}
  spotifyPlayer=player;
  const failPlayer=message=>{if(!current())return;clearTimeout(spotifyPlayerReadyTimer);spotifyPlayerReadyTimer=null;spotifyPlayerConnectFailed=true;if(spotifyTargetDeviceId===spotifyDeviceId)spotifyTargetDeviceId=null;availableSpotifyDevices.delete(spotifyDeviceId);spotifyDeviceId=null;spotifyPlayerState='error';spotifyPlayerIssue=message;spotifyActiveDevice='Not checked';renderPlaybackHealth();if(spotifySyncTimer){clearInterval(spotifySyncTimer);spotifySyncTimer=null}spotifyPlayer=null;try{player.disconnect()}catch{}showToast(message)};
  player.addListener('ready',async({device_id})=>{if(!current())return;if(typeof device_id!=='string'||!device_id){failPlayer('Spotify player did not provide a usable device. Retry the player.');return}clearTimeout(spotifyPlayerReadyTimer);spotifyPlayerReadyTimer=null;spotifyDeviceId=device_id;if(!spotifyTargetDeviceId){spotifyTargetDeviceId=device_id;spotifyTargetSupportsVolume=true}spotifyPlayerState='ready';spotifyPlayerIssue='';spotifyActiveDevice='Checking…';renderPlaybackHealth();showToast('Spotify player ready');if(spotifyTargetDeviceId===device_id)await transferSpotifyPlayback();if(current()){syncSpotifyPlaybackPolling();if(!document.querySelector('#playbackHealthPanel').hidden)void loadSpotifyDevices(true)}});
  player.addListener('not_ready',()=>{if(current()){clearTimeout(spotifyPlayerReadyTimer);spotifyPlayerReadyTimer=null;if(spotifyTargetDeviceId===spotifyDeviceId)spotifyTargetDeviceId=null;spotifyDeviceId=null;spotifyPlayerState='offline';spotifyPlayerIssue='The RCRD player went offline. Retry to reconnect it.';spotifyActiveDevice='Not checked';renderPlaybackHealth();syncSpotifyPlaybackPolling();showToast('Spotify player is offline')}});
  player.addListener('authentication_error',()=>failPlayer('Spotify player authentication failed. Reconnect Spotify.'));
  player.addListener('account_error',()=>failPlayer('Spotify Premium is required for playback in RCRD.'));
  player.addListener('initialization_error',()=>failPlayer('Spotify player could not initialize in this runtime. Protected playback may be unavailable.'));
  player.addListener('playback_error',()=>{if(current())showToast('Spotify could not play this track in RCRD.')});
  player.addListener('autoplay_failed',()=>{if(current())showToast('Spotify autoplay was blocked. Press Play to retry.')});
  player.addListener('player_state_changed',state=>{if(!current()||(spotifyTargetDeviceId||spotifyDeviceId)!==spotifyDeviceId)return;++spotifyPlaybackStateRevision;++spotifySdkStateRevision;updatePlaybackModes(state,{syncRepeat:false,syncShuffle:false});if(!state?.track_window?.current_track){setCurrentSpotifyTrackUri(null);return}const track=state.track_window.current_track;setCurrentSpotifyTrackUri(track.uri);setSong(track.name,track.artists?.map(artist=>artist.name).join(', ')||'Spotify',track.album?.images?.[0]?.url||'',track.album);playing=!state.paused;updateProgress(state.position||0,track.duration_ms||0);renderPlayer()});
  spotifyPlayerReadyTimer=setTimeout(()=>{if(current()&&spotifyPlayerState==='starting'){spotifyPlayerReadyTimer=null;spotifyPlayerState='delayed';spotifyPlayerIssue='Spotify has not reported the RCRD player ready yet. It may still connect; use Retry player if it does not.';renderPlaybackHealth();showToast('Spotify player is still connecting')}},30000);
  let connected=false;try{connected=await player.connect()}catch{}
  if(!current()){if(connected)try{player.disconnect()}catch{}return}
  if(!connected&&spotifyPlayerState!=='ready')failPlayer('Spotify player could not connect in this runtime. Retry the player.');
}
window.onSpotifyWebPlaybackSDKReady=()=>{if(spotifyConnected)initSpotifyPlayer()};window.setInterval(()=>{if(spotifyConnected&&!spotifyPlayer&&!spotifyPlayerConnectFailed&&window.Spotify)initSpotifyPlayer()},2000);
const playbackHealthToggle=document.querySelector('#playbackHealthToggle');const playbackHealthPanel=document.querySelector('#playbackHealthPanel');
function closePlaybackHealth(){playbackHealthPanel.hidden=true;playbackHealthToggle.setAttribute('aria-expanded','false');syncSpotifyDeviceRefresh()}
function retrySpotifyPlayer(){
  if(!spotifyConnected)return;
  clearTimeout(spotifyPlayerReadyTimer);spotifyPlayerReadyTimer=null;
  const oldPlayer=spotifyPlayer;const oldDevice=spotifyDeviceId;
  // Retire the player before disconnect(), which may synchronously emit SDK events.
  spotifyPlayer=null;spotifyDeviceId=null;
  if(spotifyTargetDeviceId===oldDevice)spotifyTargetDeviceId=null;
  ++spotifyDeviceRequestRevision;spotifyDeviceRefreshBusy=0;
  availableSpotifyDevices.delete(oldDevice);
  document.querySelectorAll('.playback-device').forEach(button=>{if(button.dataset.deviceId===oldDevice)button.remove()});
  if(oldPlayer)try{oldPlayer.disconnect()}catch{}
  spotifyPlayerConnectFailed=false;spotifyPlayerState='waiting';spotifyPlayerIssue='';spotifyActiveDevice='Not checked';
  syncSpotifyPlaybackPolling();renderPlaybackHealth();
  if(window.Spotify)return initSpotifyPlayer();
  spotifyPlayerIssue='Spotify player SDK is unavailable in this window. Reload RCRD and try again.';renderPlaybackHealth();
}
playbackHealthToggle.addEventListener('click',()=>{const opening=playbackHealthPanel.hidden;playbackHealthPanel.hidden=!opening;playbackHealthToggle.setAttribute('aria-expanded',String(opening));if(opening&&spotifyConnected&&!spotifySyncTimer){spotifyActiveDevice='Checking…';renderPlaybackHealth();syncCurrentSpotifyTrack()}if(opening&&spotifyConnected)loadSpotifyDevices();syncSpotifyDeviceRefresh()});
document.querySelector('#playbackHealthRetry').addEventListener('click',retrySpotifyPlayer);
function syncSpotifyDeviceRefresh(){const list=document.querySelector('#playbackDeviceList');const panel=document.querySelector('#playbackHealthPanel');const active=spotifyConnected&&spotifyDeviceRefreshEnabled&&!panel.hidden&&!list.hidden&&document.visibilityState!=='hidden'&&(typeof document.hasFocus!=='function'||document.hasFocus());if(!active&&spotifyDeviceRefreshTimer){clearInterval(spotifyDeviceRefreshTimer);spotifyDeviceRefreshTimer=null}else if(active&&!spotifyDeviceRefreshTimer)spotifyDeviceRefreshTimer=setInterval(()=>loadSpotifyDevices(true),30000)}
async function loadSpotifyDevices(silent=false){if(!spotifyConnected||spotifyDeviceRefreshBusy)return;const revision=++spotifyDeviceRequestRevision;const generation=spotifyAccountGeneration;spotifyDeviceRefreshBusy=revision;const list=document.querySelector('#playbackDeviceList');list.hidden=false;if(!silent)list.textContent='Loading available devices…';try{const response=await fetch('/api/spotify/devices');const data=await response.json();if(revision!==spotifyDeviceRequestRevision||generation!==spotifyAccountGeneration||!spotifyConnected)return;if(response.status===404)throw new Error('Restart RCRD from Settings, then reload this page to use device selection.');if(!response.ok)throw new Error(data.error||'Could not load Spotify devices');if(!Array.isArray(data.devices))throw new Error('Spotify returned an invalid device list');availableSpotifyDevices=new Map(data.devices.filter(device=>typeof device?.id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(device.id)).map(device=>[device.id,device]));list.innerHTML=[...availableSpotifyDevices.values()].map(device=>{const selected=device.id===(spotifyTargetDeviceId||spotifyDeviceId);const status=device.is_restricted?'Unavailable':device.is_active?'Active':'';return `<button type="button" class="playback-device" data-device-id="${escapeHtml(device.id)}" ${device.is_restricted?'disabled':''} aria-pressed="${selected}"><span class="playback-device-name">${escapeHtml(device.name)}</span>${status?`<span class="playback-device-status">${status}</span>`:''}</button>`}).join('')||'<p>No controllable Spotify devices were found.</p>';spotifyDeviceRefreshEnabled=true}catch(error){if(revision===spotifyDeviceRequestRevision&&generation===spotifyAccountGeneration){spotifyDeviceRefreshEnabled=false;availableSpotifyDevices.clear();list.textContent=error.message}}finally{if(spotifyDeviceRefreshBusy===revision){spotifyDeviceRefreshBusy=0;syncSpotifyDeviceRefresh()}}}
document.querySelector('#playbackDeviceLoad').addEventListener('click',()=>loadSpotifyDevices());
async function chooseSpotifyDevice(event){const button=event.target.closest('.playback-device');if(!button||button.disabled)return;const device=availableSpotifyDevices.get(button.dataset.deviceId);if(!device||device.is_restricted)return;const generation=spotifyAccountGeneration;++spotifyPlaybackStateRevision;button.disabled=true;try{const response=await fetch('/api/spotify/transfer',{method:'PUT',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({device_id:device.id})});const data=await response.json();if(generation!==spotifyAccountGeneration||!spotifyConnected)return;if(response.status===404){availableSpotifyDevices.delete(device.id);button.remove();showToast('That Spotify device is no longer available. Choose another.');await loadSpotifyDevices(true);return}if(!response.ok)throw new Error(data.error||'Could not switch Spotify devices');spotifyTargetDeviceId=device.id;spotifyTargetSupportsVolume=device.supports_volume!==false;document.querySelector('#volumeControl').disabled=!spotifyTargetSupportsVolume;renderVolumeControl();spotifyActiveDevice=device.id===spotifyDeviceId?'RCRD · Spotify':device.name;renderPlaybackHealth();document.querySelectorAll('.playback-device').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.deviceId===device.id)));showToast(`Playback moved to ${device.name}`);const polling=Boolean(spotifySyncTimer);syncSpotifyPlaybackPolling();if(polling)void syncCurrentSpotifyTrack(true)}catch(error){if(generation===spotifyAccountGeneration)showToast(error.message)}finally{if(generation===spotifyAccountGeneration)button.disabled=false}}
document.querySelector('#playbackDeviceList').addEventListener('click',chooseSpotifyDevice);
document.addEventListener('click',event=>{if(!event.target.closest('.playback-health-toggle,.playback-health-panel'))closePlaybackHealth()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!playbackHealthPanel.hidden){closePlaybackHealth();playbackHealthToggle.focus()}});
renderPlaybackHealth();
document.addEventListener('visibilitychange',syncSpotifyPlaybackPolling);
document.addEventListener('visibilitychange',()=>{syncSpotifyDeviceRefresh();if(document.visibilityState==='visible'&&!playbackHealthPanel.hidden&&!document.querySelector('#playbackDeviceList').hidden)loadSpotifyDevices(true)});
window.addEventListener('focus',()=>{if(!playbackHealthPanel.hidden&&!document.querySelector('#playbackDeviceList').hidden)loadSpotifyDevices(true);syncSpotifyDeviceRefresh();if(spotifyConnected&&document.visibilityState!=='hidden')void syncCurrentSpotifyTrack(true)});
window.addEventListener('blur',syncSpotifyDeviceRefresh);
async function spotifyPlaybackRequest(action,details={}){if(!spotifyConnected)throw new Error('Connect Spotify to use playback controls');const target=spotifyTargetDeviceId||spotifyDeviceId;if((action==='start'||action==='play')&&!target)throw new Error('No Spotify playback device is ready. Choose a device from Playback health.');const generation=spotifyAccountGeneration;const response=await fetch('/api/spotify/playback',{method:'POST',headers:{'Content-Type':'application/json','X-RCRD-Request':'1'},body:JSON.stringify({action,device_id:target||undefined,...details})});const data=await response.json();if(!spotifyConnected||generation!==spotifyAccountGeneration)throw new Error('Spotify playback is no longer connected');if(!response.ok)throw new Error(data.error||'Spotify playback command failed');return data}
async function activeLocalSpotifyPlayer(){const player=spotifyPlayer;const deviceId=spotifyDeviceId;const generation=spotifyAccountGeneration;if(!spotifyConnected||!player||!deviceId||(spotifyTargetDeviceId||deviceId)!==deviceId||typeof player.getCurrentState!=='function')return null;let state;try{state=await player.getCurrentState()}catch{return null}return spotifyConnected&&generation===spotifyAccountGeneration&&player===spotifyPlayer&&deviceId===spotifyDeviceId&&(spotifyTargetDeviceId||deviceId)===deviceId&&state?{player,state}:null}
function mixTextKey(value){return String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim()}
function spotifyMixTrack(track){
  if(!track||track.type&&track.type!=='track'||track.is_local||track.is_playable===false||Object.keys(track.restrictions||{}).length||!/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri||'')||typeof track.name!=='string'||!track.name.trim()||track.name.length>300)return null;
  const artists=Array.isArray(track.artists)?track.artists.slice(0,10).filter(artist=>typeof artist?.id==='string'&&/^[A-Za-z0-9]{22}$/.test(artist.id)&&typeof artist.name==='string'&&artist.name.trim()&&artist.name.length<=180):[];
  if(!artists.length||artists.length!==Math.min(track.artists.length,10))return null;
  const name=track.name.trim();const modes=['live','remix','karaoke','instrumental','acoustic','demo','sped up','slowed','tribute'].filter(mode=>new RegExp(`(?:[([]|\\s[-–—]\\s).*\\b${mode}\\b`,'i').test(name));
  const titleKey=mixTextKey(name.replace(/\s*[-(\[]\s*(?:\d{4}\s*)?remaster(?:ed)?[^)\]]*[)\]]?\s*$/i,''));
  return {uri:track.uri,title:name,artist:artists.map(artist=>artist.name).join(', '),artists:artists.map(artist=>({id:artist.id,name:artist.name})),album:typeof track.album?.name==='string'?track.album.name.slice(0,300):'Album unavailable',albumId:/^[A-Za-z0-9]{22}$/.test(track.album?.id||'')?track.album.id:'',modes,titleKey,isrc:/^[A-Za-z0-9]{12}$/.test(track.external_ids?.isrc||'')?track.external_ids.isrc.toUpperCase():''};
}
function buildSpotifyMix(seedTrack,sources){
  const seed=spotifyMixTrack(seedTrack);if(!seed)return [];
  const lead=seed.artists[0].id;
  const evidence=new Map();const discovery=new Map();const pool=[];const seenLists=new Set();
  for(const artist of (Array.isArray(sources?.discoveryArtists)?sources.discoveryArtists:[]).slice(0,40)){
    if(typeof artist?.id!=='string'||!/^[A-Za-z0-9]{22}$/.test(artist.id)||!['listenbrainz','discogs-style'].includes(artist.source))continue;
    if(artist.source==='discogs-style'&&(typeof artist.style!=='string'||!artist.style.trim()||artist.style.length>80||/[\u0000-\u001f\u007f]/.test(artist.style)))continue;
    if(!discovery.has(artist.id)||artist.source==='listenbrainz')discovery.set(artist.id,{source:artist.source,style:artist.source==='discogs-style'?artist.style.trim():''});
  }
  for(const list of (Array.isArray(sources?.playlists)?sources.playlists:[]).slice(0,8)){
    if(!/^[A-Za-z0-9]{22}$/.test(list?.id||'')||seenLists.has(list.id)||!Array.isArray(list.tracks))continue;seenLists.add(list.id);
    const tracks=list.tracks.slice(0,2000).map(spotifyMixTrack).filter(Boolean);
    const seedSongs=new Set(tracks.filter(track=>track.artists.some(artist=>artist.id===lead)).map(track=>track.titleKey));
    if(!tracks.some(track=>track.uri===seed.uri)&&seedSongs.size<2)continue;
    const credits=new Map();for(const track of tracks){const artist=track.artists[0].id;if(!credits.has(artist))credits.set(artist,new Set());credits.get(artist).add(track.titleKey);}
    // A very broad playlist is weak evidence of an artist relationship.
    if(credits.size>80)continue;
    for(const [artist,songs] of credits){const previous=evidence.get(artist)||{lists:0,songs:0,score:0};previous.lists++;previous.songs+=songs.size;previous.score+=Math.min(songs.size,5)/Math.max(1,credits.size);evidence.set(artist,previous);}
    pool.push(...tracks);
  }
  pool.push(...(Array.isArray(sources?.savedTracks)?sources.savedTracks:[]).slice(0,10000).map(spotifyMixTrack).filter(Boolean));
  pool.push(...(Array.isArray(sources?.discoveryTracks)?sources.discoveryTracks:[]).slice(0,1000).map(spotifyMixTrack).filter(Boolean));
  const candidates=pool.filter(track=>{const relation=evidence.get(track.artists[0].id);return (track.artists.some(artist=>artist.id===lead)||relation&&(relation.songs>=2||relation.lists>=2)||discovery.has(track.artists[0].id))&&track.modes.every(mode=>seed.modes.includes(mode));});
  const count=track=>Number.isSafeInteger(sources?.playCounts?.[track.uri])&&sources.playCounts[track.uri]>0?sources.playCounts[track.uri]:0;
  candidates.sort((a,b)=>(evidence.get(b.artists[0].id)?.score||0)-(evidence.get(a.artists[0].id)?.score||0)||count(b)-count(a)||Number(a.albumId===seed.albumId)-Number(b.albumId===seed.albumId)||a.title.localeCompare(b.title));
  const songKey=track=>`${track.titleKey}|${track.artists.map(artist=>artist.id).sort().join(',')}`;
  const seenUris=new Set([seed.uri]);const seenSongs=new Set([songKey(seed)]);const seenIsrc=new Set(seed.isrc?[seed.isrc]:[]);
  const selected=[{...seed,reason:'Starting song'}];const artistCounts=new Map([[lead,1]]);const albumCounts=new Map(seed.albumId?[[seed.albumId,1]]:[]);
  while(candidates.length&&selected.length<100){
    let index=candidates.findIndex(track=>track.artists[0].id!==selected.at(-1).artists[0].id);if(index<0)index=0;
    const track=candidates.splice(index,1)[0];const primary=track.artists[0].id;const key=songKey(track);
    if(seenUris.has(track.uri)||seenSongs.has(key)||track.isrc&&seenIsrc.has(track.isrc)||(artistCounts.get(primary)||0)>=10||track.albumId&&(albumCounts.get(track.albumId)||0)>=4)continue;
    seenUris.add(track.uri);seenSongs.add(key);if(track.isrc)seenIsrc.add(track.isrc);
    artistCounts.set(primary,(artistCounts.get(primary)||0)+1);if(track.albumId)albumCounts.set(track.albumId,(albumCounts.get(track.albumId)||0)+1);
    const relation=evidence.get(primary);const related=discovery.get(primary);
    selected.push({...track,reason:primary===lead?'Same lead artist':track.artists.some(artist=>artist.id===lead)?'Direct collaboration with the lead artist':relation&&(relation.songs>=2||relation.lists>=2)?`Shares ${relation.lists} of your playlists with the starting artist`:related.source==='listenbrainz'?'Related artist via ListenBrainz':`Shares Discogs style: ${related.style}`});
  }
  return selected;
}
function spotifyMixSourceWarnings(sources){
  const messages={
    'metadata-contact-required':'Public music discovery is unavailable until the RCRD maintainer configures an API contact address.',
    'musicbrainz-unavailable':'MusicBrainz artist lookup was unavailable.',
    'musicbrainz-unresolved':'The starting artist could not be matched confidently in MusicBrainz.',
    'listenbrainz-unavailable':'ListenBrainz related-artist discovery was unavailable.',
    'listenbrainz-empty':'ListenBrainz returned no usable related artists for this song.',
    'discogs-unavailable':'Discogs style discovery was unavailable.',
    'discogs-empty':'Discogs returned no usable style matches for this song.',
    'spotify-discovery-partial':'Some recommended artists or songs could not be matched confidently on Spotify.',
    'spotify-discovery-empty':'No recommended songs could be matched confidently on Spotify.',
    'discovery-time-limit':'Related-music discovery reached its time limit. Try again to reuse completed lookups.'
  };
  const codes=[...new Set((Array.isArray(sources?.discoveryWarnings)?sources.discoveryWarnings:[]).slice(0,20).filter(code=>typeof code==='string'&&Object.hasOwn(messages,code)))].slice(0,8);
  return codes.length?codes.map(code=>messages[code]).join(' '):sources?.partial===true?'Some sources were unavailable or reached the lookup limit; this preview uses the evidence available.':'';
}
function resetSpotifyMix(){
  ++spotifyMixRevision;if(spotifyMixController)spotifyMixController.abort();spotifyMixController=null;spotifyMixPreview=null;
  const dialog=document.querySelector('#spotifyMixDialog');if(dialog?.open)dialog.close();
  const tracks=document.querySelector('#spotifyMixTracks');if(tracks)tracks.innerHTML='';
  const start=document.querySelector('#spotifyMixStart');if(start){start.disabled=true;start.setAttribute('aria-busy','false')}
}
function updateSpotifyMixSelection(){
  const count=document.querySelectorAll('#spotifyMixTracks input:checked').length;
  document.querySelector('#spotifyMixStart').disabled=!spotifyMixPreview||spotifyMixPreview.generation!==spotifyAccountGeneration||!spotifyConnected||count<100||document.querySelector('#spotifyMixStart').getAttribute('aria-busy')==='true';
  document.querySelector('#spotifyMixStatus').textContent=`${count} tracks selected. ${count<100?'At least 100 unique tracks are required.':'Start mix will replace the current playback sequence. Spotify shuffle and repeat settings still apply.'}${spotifyMixPreview?.warning?' '+spotifyMixPreview.warning:''}`;
}
async function openSpotifyMix(){
  const dialog=document.querySelector('#spotifyMixDialog');if(dialog.open)return;
  const uri=spotifyTrackUri;if(!spotifyConnected||!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri||'')){showToast('Play a Spotify song first to preview a mix.');return}
  resetSpotifyMix();const revision=spotifyMixRevision;const generation=spotifyAccountGeneration;const controller=new AbortController();spotifyMixController=controller;
  const current=()=>spotifyConnected&&generation===spotifyAccountGeneration&&revision===spotifyMixRevision&&dialog.open;
  const status=document.querySelector('#spotifyMixStatus');status.textContent='Finding related artists and building a 100-song mix… The first lookup can take up to a minute.';dialog.showModal();
  const timeout=setTimeout(()=>controller.abort(),60000);
  const read=async path=>{const response=await fetch(path,{signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not build this mix.');return data;};
  try{
    const playback=await read('/api/spotify/currently-playing');if(!current())return;
    const seed=spotifyMixTrack(playback.item);if(!seed||seed.uri!==uri)throw new Error('The playing song changed or its artist credits are unavailable. Close this preview and try again.');
    const sources=await read(`/api/spotify/mix-sources?uri=${encodeURIComponent(uri)}`);
    if(!current())return;
    if(sources.seed?.uri!==uri||!Array.isArray(sources.playlists)||!Array.isArray(sources.savedTracks))throw new Error('Spotify returned invalid Mix source data.');
    const tracks=buildSpotifyMix(playback.item,sources);const warning=spotifyMixSourceWarnings(sources);
    if(tracks.length<100){status.textContent=`Only ${tracks.length} unique tracks qualified; at least 100 are required. RCRD will not add unrelated songs to fill a mix.${warning?' '+warning:''}`;return}
    spotifyMixPreview={generation,tracks,warning};
    document.querySelector('#spotifyMixTracks').innerHTML=tracks.map((track,index)=>`<label class="mix-track"><input type="checkbox" data-mix-index="${index}" checked ${index===0?'disabled':''}><span><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)} · ${escapeHtml(track.album)}</span><small>${escapeHtml(track.reason)}</small></span></label>`).join('');
    updateSpotifyMixSelection();
  }catch(error){if(current())status.textContent=error.name==='AbortError'?'Mix lookup timed out. Close this preview and try again.':error.message||'Could not build this mix.';}
  finally{clearTimeout(timeout);if(spotifyMixController===controller)spotifyMixController=null;}
}
async function startSpotifyMix(){
  const preview=spotifyMixPreview;const button=document.querySelector('#spotifyMixStart');if(button.disabled||button.getAttribute('aria-busy')==='true'||!preview||!spotifyConnected||preview.generation!==spotifyAccountGeneration)return;
  const selected=[...document.querySelectorAll('#spotifyMixTracks input:checked')].map(input=>preview.tracks[Number(input.dataset.mixIndex)]?.uri);
  if(selected.length!==100||new Set(selected).size!==selected.length||selected[0]!==preview.tracks[0].uri||selected.some(uri=>!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri||'')))return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{const started=await playSpotifyUri(selected[0],'',selected);if(started&&preview===spotifyMixPreview&&preview.generation===spotifyAccountGeneration)document.querySelector('#spotifyMixDialog').close();}
  finally{if(preview===spotifyMixPreview){button.setAttribute('aria-busy','false');updateSpotifyMixSelection();}}
}
document.querySelector('#playerMix').addEventListener('click',openSpotifyMix);
document.querySelector('#spotifyMixStart').addEventListener('click',startSpotifyMix);
document.querySelector('#spotifyMixClose').addEventListener('click',()=>document.querySelector('#spotifyMixDialog').close());
document.querySelector('#spotifyMixDialog').addEventListener('close',()=>{if(!document.querySelector('#spotifyMixDialog').open)resetSpotifyMix();});
document.querySelector('#spotifyMixTracks').addEventListener('change',updateSpotifyMixSelection);
function followingSavedTrackUris(records,index,uri){if(!Number.isSafeInteger(index)||index<0||records[index]?.uri!==uri||records[index]?.kind!=='track'||!/^spotify:track:[A-Za-z0-9]+$/.test(uri))return [];const uris=[];for(let offset=0;offset<records.length&&uris.length<50;offset++){const record=records[(index+offset)%records.length];if(record.kind==='track'&&/^spotify:track:[A-Za-z0-9]+$/.test(record.uri))uris.push(record.uri)}return uris.length>1?uris:[]}
async function waitForSpotifyPlaybackState(deviceId,generation,matches,description){
  for(let attempt=0;attempt<5;attempt++){
    if(!spotifyConnected||generation!==spotifyAccountGeneration)throw new Error('Spotify playback is no longer connected');
    const response=await fetch('/api/spotify/currently-playing');
    if(!response.ok)throw new Error('Could not confirm Spotify playback. Try again.');
    const state=response.status===204?null:await response.json();
    if(state?.device?.id===deviceId&&matches(state))return;
    if(attempt<4)await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error(`Spotify did not confirm ${description}. Try again.`);
}
async function playSpotifyUri(uri,contextUri='',uris=[]){
  const generation=spotifyAccountGeneration;
  try{
    if((spotifyTargetDeviceId||spotifyDeviceId)===spotifyDeviceId&&spotifyPlayer?.activateElement)await spotifyPlayer.activateElement();
    if(generation!==spotifyAccountGeneration)return false;
    if(uris.length>1){
      spotifyPlaybackStartPending++;
      const button=document.querySelector('#shuffleButton');
      if(button){button.disabled=true;button.setAttribute('aria-busy','true')}
      const request=Promise.all([spotifyModeQueue,spotifySkipQueue]).then(async()=>{
        if(!spotifyConnected||generation!==spotifyAccountGeneration)throw new Error('Spotify playback is no longer connected');
        const deviceId=spotifyTargetDeviceId||spotifyDeviceId;
        if(!deviceId)throw new Error('No Spotify playback device is ready. Choose a device from Playback health.');
        const restoreShuffle=shuffleEnabled;
        let shuffleOffRequested=false;
        try{
          if(restoreShuffle){
            shuffleOffRequested=true;
            await spotifyPlaybackRequest('shuffle',{state:false,device_id:deviceId});
            await waitForSpotifyPlaybackState(deviceId,generation,state=>state.shuffle_state===false,'Shuffle turning off');
          }
          if(deviceId!==(spotifyTargetDeviceId||spotifyDeviceId))throw new Error('Playback device changed. Choose the song again.');
          ++spotifyPlaybackStateRevision;
          await spotifyPlaybackRequest('start',{uri,uris,device_id:deviceId});
          spotifyHasContext=false;
          if(restoreShuffle)await waitForSpotifyPlaybackState(deviceId,generation,state=>state.item?.uri===uri,'the selected song');
        }finally{
          if(shuffleOffRequested&&spotifyConnected&&generation===spotifyAccountGeneration){
            try{await spotifyPlaybackRequest('shuffle',{state:true,device_id:deviceId});await waitForSpotifyPlaybackState(deviceId,generation,state=>state.shuffle_state===true,'Shuffle turning back on');++shuffleRevision;updatePlaybackModes({shuffle_state:true})}
            catch{if(generation===spotifyAccountGeneration){++shuffleRevision;updatePlaybackModes({shuffle_state:false})}throw new Error('Could not confirm Shuffle was restored. Check the Shuffle control.')}
          }
        }
        return true;
      });
      spotifyModeQueue=request.catch(()=>{});
      try{await request}finally{if(generation===spotifyAccountGeneration){spotifyPlaybackStartPending--;if(!spotifyPlaybackStartPending){if(button){button.disabled=button.dataset.playbackUnavailable==='true';button.setAttribute('aria-busy','false')}void syncCurrentSpotifyTrack(true)}}}
    }else{
      ++spotifyPlaybackStateRevision;
      await spotifyPlaybackRequest('start',{uri,...(contextUri?{context_uri:contextUri}:{})});
      spotifyHasContext=Boolean(contextUri)||!uri.startsWith('spotify:track:');
    }
    if(generation!==spotifyAccountGeneration)return false;
    showToast('Spotify playback started');return true;
  }catch(error){if(generation===spotifyAccountGeneration)showToast(error.message);return false}
}
async function toggleSpotifyPlayback(){
  const generation=spotifyAccountGeneration;
  const button=document.querySelector('#playButton');
  const queued=spotifyTogglePending>0;
  let activation=Promise.resolve(true);
  if((!playing||queued)&&(spotifyTargetDeviceId||spotifyDeviceId)===spotifyDeviceId&&spotifyPlayer?.activateElement){try{activation=Promise.resolve(spotifyPlayer.activateElement()).then(()=>true,()=>false)}catch{activation=Promise.resolve(false)}}
  spotifyTogglePending++;
  button?.setAttribute('aria-busy','true');
  ++spotifyPlaybackStateRevision;
  const request=spotifyToggleQueue.catch(()=>{}).then(async()=>{
    if(generation!==spotifyAccountGeneration)return;
    if(!spotifyConnected)throw new Error('Connect Spotify to use playback controls');
    const local=await activeLocalSpotifyPlayer();
    if(!spotifyConnected||generation!==spotifyAccountGeneration)return;
    const localState=local&&typeof local.state.paused==='boolean';
    const shouldPlay=queued?!playing:localState?local.state.paused:!playing;
    if(shouldPlay&&!(await activation))throw new Error('Spotify player could not activate. Press Play to retry.');
    const sdkRevision=spotifySdkStateRevision;
    if(localState&&typeof local.player[shouldPlay?'resume':'pause']==='function'){
      try{await local.player[shouldPlay?'resume':'pause']()}catch{throw new Error('Spotify could not change playback in RCRD. Try again.')}
    }else await spotifyPlaybackRequest(shouldPlay?'play':'pause');
    if(!spotifyConnected||generation!==spotifyAccountGeneration)return;
    if(sdkRevision===spotifySdkStateRevision){playing=shouldPlay;renderPlayer()}
  });
  spotifyToggleQueue=request.catch(()=>{});
  try{await request}catch(error){if(generation===spotifyAccountGeneration)showToast(error.message)}finally{if(generation===spotifyAccountGeneration){spotifyTogglePending--;if(!spotifyTogglePending)button?.setAttribute('aria-busy','false')}}
}
document.querySelector('#playButton').onclick=toggleSpotifyPlayback;
function handlePlaybackKeyboardShortcut(event){
  if(event.repeat||event.defaultPrevented||event.isComposing||event.altKey||event.metaKey||event.shiftKey)return;
  const buttonId=event.key===' '&&!event.ctrlKey?'playButton':event.ctrlKey&&event.key==='ArrowRight'?'nextButton':event.ctrlKey&&event.key==='ArrowLeft'?'previousButton':null;
  const volumeDirection=event.ctrlKey&&event.key==='ArrowUp'?1:event.ctrlKey&&event.key==='ArrowDown'?-1:0;
  if(!buttonId&&!volumeDirection)return;
  if(!document.querySelector('#ambientVisualizer').hidden||document.querySelector('dialog[open]'))return;
  if(event.target?.closest?.('input,textarea,select,button,a,[contenteditable],[role="button"],[role="option"],[role="listbox"],[role="slider"],[role="combobox"],[tabindex]'))return;
  if(volumeDirection){
    const control=document.querySelector('#volumeControl');
    if(!control||control.disabled)return;
    const current=Number(control.value);
    if(!Number.isFinite(current))return;
    event.preventDefault();
    const next=Math.max(0,Math.min(100,current+volumeDirection*5));
    if(next!==current){void setSpotifyVolume(next);keepVolumeOpen();scheduleVolumeClose(1600)}
    return;
  }
  const button=document.querySelector(`#${buttonId}`);
  if(!button||button.disabled)return;
  event.preventDefault();
  button.click();
}
document.addEventListener('keydown',handlePlaybackKeyboardShortcut);
async function seekSpotifyPlayback(value){const position=Number(value);if(!Number.isSafeInteger(position)||position<0)return;if((spotifyTargetDeviceId||spotifyDeviceId)===spotifyDeviceId&&spotifyPlayer&&spotifyDurationMs){try{await spotifyPlayer.seek(position);updateProgress(position,spotifyDurationMs);return}catch{showToast('Spotify seeking is unavailable');return}}if(spotifyConnected&&spotifyTargetDeviceId){try{await spotifyPlaybackRequest('seek',{position_ms:position})}catch(error){showToast(error.message);return}}updateProgress(position,spotifyDurationMs||239000)}
function renderVolumeControl(){const control=document.querySelector('#volumeControl');const percent=volume*100;const displayPercent=percent>0&&percent<1?'<1':String(Math.round(percent));control.value=String(percent>0&&percent<1?1:Math.round(percent));control.setAttribute('aria-valuetext',percent>0&&percent<1?'less than 1 percent':`${displayPercent} percent`);control.title=`Spotify volume: ${displayPercent}%`;document.querySelector('#volumeLevel').textContent=`${displayPercent}%`;const button=document.querySelector('#volumeButton');button.setAttribute('aria-pressed',String(volume===0));button.title=volume===0?'Unmute volume':'Mute volume';button.disabled=control.disabled||!spotifyTargetSupportsVolume}
async function setSpotifyVolume(value){const position=Number(value);if(!Number.isFinite(position)||!spotifyTargetSupportsVolume)return;const fraction=Math.max(0,Math.min(1,position/100));if(volume>0&&fraction===0){volumeBeforeMute=volume;saveUiPreference('volumeBeforeMute',Number((volumeBeforeMute*100).toFixed(2)))}volume=fraction;if(volume>0)volumeBeforeMute=volume;saveUiPreference('volume',Number((volume*100).toFixed(2)));renderVolumeControl();try{if(spotifyTargetDeviceId&&spotifyTargetDeviceId!==spotifyDeviceId)await spotifyPlaybackRequest('volume',{volume_percent:Math.round(volume*100)});else if(spotifyPlayer)await spotifyPlayer.setVolume(volume)}catch{showToast('Spotify volume control is unavailable')}}
function toggleSpotifyMute(){if(document.querySelector('#volumeControl').disabled||!spotifyTargetSupportsVolume)return;const request=setSpotifyVolume(volume>0?0:volumeBeforeMute*100);keepVolumeOpen();scheduleVolumeClose(1600);return request}
document.querySelector('#volumeButton').addEventListener('click',toggleSpotifyMute);
document.querySelector('#playerProgress').addEventListener('input',e=>seekSpotifyPlayback(e.target.value));document.querySelector('#volumeControl').addEventListener('input',e=>setSpotifyVolume(e.target.value));const volumeWrap=document.querySelector('.volume-wrap');let volumeCloseTimer=null;function keepVolumeOpen(){clearTimeout(volumeCloseTimer);volumeWrap.classList.add('volume-open')}function scheduleVolumeClose(delay=500){clearTimeout(volumeCloseTimer);volumeCloseTimer=setTimeout(()=>{if(!volumeWrap.matches(':hover'))volumeWrap.classList.remove('volume-open')},delay)}volumeWrap.addEventListener('pointerenter',keepVolumeOpen);volumeWrap.addEventListener('pointerleave',()=>scheduleVolumeClose());document.addEventListener('click',e=>{const action=e.target.closest('.spotify-discogs');if(action)searchInDiscogs(action.dataset.title,action.dataset.artist)});
function setSpotifySearchScope(value,persistPreference=false){const previousMode=spotifySearchMode;const select=document.querySelector('#spotifySearchScope');const options=[...document.querySelectorAll('#spotifySearchScopeList [role="option"]')];const selected=options.find(option=>option.dataset.value===value)||options[0];spotifySearchMode=selected?.dataset.value||'library';document.querySelector('#spotifyPageSizeControl').hidden=spotifySearchMode==='catalog';if(previousMode==='catalog'&&spotifySearchMode==='library'){spotifyCatalogAlbumView=null;spotifyCatalogResults=[];document.querySelector('#spotify .library-controls').hidden=false;document.querySelector('#spotifyGrid').classList.remove('collection-lookup-results');++spotifySearchSequence;clearTimeout(spotifySearchTimer);spotifySearchTimer=null}select.value=spotifySearchMode;document.querySelector('#spotifySearchScopeValue').textContent=selected?.textContent||'Saved library';document.querySelector('#spotifyScopeNoteTitle').textContent=spotifySearchMode==='catalog'?'Entire Spotify catalog':'Saved library';clearTimeout(spotifyNoticeTimer);spotifyNoticeTimer=null;const cacheMeta=document.querySelector('#spotifyCacheMeta');const notice=document.querySelector('#spotifyScopeNotice');notice.hidden=spotifySearchMode==='library'&&Boolean(cacheMeta.textContent)&&spotifyLibraryLoaded&&!spotifyLibraryError;cacheMeta.hidden=!notice.hidden||spotifySearchMode==='catalog';document.querySelector('#spotifyLibraryNote').hidden=spotifySearchMode==='catalog';document.querySelector('#spotifyCatalogNote').hidden=spotifySearchMode!=='catalog';scheduleSpotifyCatalogNoticeDismissal();if(spotifySearchMode==='library'&&!notice.hidden&&spotifySavedLibraryLoaded&&spotifyLibraryLoaded&&!spotifyLibraryError&&spotifyLibrarySyncSource!=='stale-cache'&&!document.querySelector('#spotifyPlaylistSelect').value&&document.querySelector('#spotifyLibraryNote').textContent===savedLibraryFreshnessNote())settleSpotifyLibraryNotice(spotifyLibrarySyncSource,spotifyLibraryLastUpdated,savedLibraryFreshnessNote());options.forEach(option=>option.setAttribute('aria-selected',String(option===selected)));syncSpotifySortControls();if(persistPreference)saveUiPreference('spotifySearchScope',spotifySearchMode)}
function closeSpotifySearchScope(){document.querySelector('#spotifySearchScopeMenu').classList.remove('is-open');document.querySelector('#spotifySearchScopeList').hidden=true;document.querySelector('#spotifySearchScopeTrigger').setAttribute('aria-expanded','false')}
document.querySelector('#spotifySearchScope').addEventListener('change',e=>{setSpotifySearchScope(e.target.value);updateSearchContext();filterCards(document.querySelector('#searchInput').value)});const scopeTrigger=document.querySelector('#spotifySearchScopeTrigger');const scopeList=document.querySelector('#spotifySearchScopeList');scopeTrigger.addEventListener('click',()=>{const opening=scopeList.hidden;document.querySelector('#spotifySearchScopeMenu').classList.toggle('is-open',opening);scopeList.hidden=!opening;scopeTrigger.setAttribute('aria-expanded',String(opening));if(opening)(scopeList.querySelector('[aria-selected="true"]')||scopeList.querySelector('[role="option"]'))?.focus()});scopeList.addEventListener('click',event=>{const option=event.target.closest('[role="option"]');if(!option)return;setSpotifySearchScope(option.dataset.value);closeSpotifySearchScope();updateSearchContext();filterCards(document.querySelector('#searchInput').value);scopeTrigger.focus()});scopeList.addEventListener('keydown',event=>{const options=[...scopeList.querySelectorAll('[role="option"]')];const index=options.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus()}if(event.key==='Enter'||event.key===' '){event.preventDefault();document.activeElement.click()}if(event.key==='Escape'){event.preventDefault();closeSpotifySearchScope();scopeTrigger.focus()}});document.querySelector('#spotifyPlaylistSelect').addEventListener('change',e=>loadSpotifyPlaylist(e.target.value));const sidebarPlaylistTrigger=document.querySelector('#sidebarPlaylistTrigger');const sidebarPlaylistList=document.querySelector('#sidebarPlaylistList');sidebarPlaylistTrigger.addEventListener('click',()=>{if(sidebarPlaylistTrigger.disabled)return;const opening=sidebarPlaylistList.hidden;document.querySelector('#sidebarPlaylistMenu').classList.toggle('is-open',opening);sidebarPlaylistList.hidden=!opening;sidebarPlaylistTrigger.setAttribute('aria-expanded',String(opening));if(opening)(sidebarPlaylistList.querySelector('[aria-selected="true"]')||sidebarPlaylistList.querySelector('[role="option"]'))?.focus()});sidebarPlaylistList.addEventListener('click',event=>{const option=event.target.closest('[role="option"]');if(!option)return;const id=option.dataset.playlistId||'';setSidebarPlaylistValue(id);closeSidebarPlaylistMenu();document.querySelector('[data-view="spotify"]').click();loadSpotifyPlaylist(id)});sidebarPlaylistList.addEventListener('keydown',event=>{const options=[...sidebarPlaylistList.querySelectorAll('[role="option"]')];const index=options.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus()}if(event.key==='Escape'){event.preventDefault();closeSidebarPlaylistMenu();sidebarPlaylistTrigger.focus()}});document.addEventListener('click',event=>{if(!event.target.closest('#sidebarPlaylistMenu'))closeSidebarPlaylistMenu();if(!event.target.closest('#spotifySearchScopeMenu'))closeSpotifySearchScope()});document.querySelectorAll('#spotifySort,#homeSpotifySort').forEach(select=>select.addEventListener('change',e=>{spotifyLibrarySort=e.target.value;syncSpotifySortControls();if(document.querySelector('.active-view')?.id==='home'||spotifySearchMode==='catalog')searchSpotifyCatalog(document.querySelector('#searchInput').value,spotifyCatalogPage);else renderSpotifyLibrary(document.querySelector('#searchInput').value)}));document.querySelector('#collectionSort').addEventListener('change',e=>{collectionSort=e.target.value;collectionPage=1;renderCollection()});document.querySelector('#wantlistSort').addEventListener('change',e=>{wantlistSort=e.target.value;wantlistPage=1;renderWantlist()});document.querySelector('#discogsSearchSort').addEventListener('change',e=>{discogsSearchSort=e.target.value;if(discogsSearchResults.length)renderApiResults(discogsSearchResults,discogsSearchPagination)});document.querySelectorAll('.library-layout').forEach(button=>button.addEventListener('click',()=>{spotifyLibraryMode=button.dataset.layout;document.querySelectorAll('.library-layout').forEach(item=>item.classList.toggle('active',item===button));if(spotifySearchMode==='catalog')document.querySelector('#spotifyGrid').classList.toggle('list-view',spotifyLibraryMode==='list');else renderSpotifyLibrary(document.querySelector('#searchInput').value)}));document.querySelector('#marketBack').onclick=()=>{document.querySelector(`[data-view="${returnView==='market'?'home':returnView}"]`).click();document.querySelector('#marketBack').hidden=true};setSpotifySearchScope('library');updateSearchContext();

const discogsThemedSelectIds=['collectionSort','wantlistSort','collectionPageSize','wantlistPageSize','discogsFormat','discogsCondition','discogsCountry','discogsGenre','discogsSearchSort'];
const spotifyThemedSelectIds=['spotifySort','spotifyPageSize','homeSpotifySort','homeSpotifySortDirection','spotifyPlaylistSelect','spotifyHistorySort'];
function syncThemedSelect(select){const menu=select?.closest('.themed-select');if(!menu)return;const options=[...select.options];const list=menu.querySelector('.themed-select-list');const rendered=[...list.querySelectorAll('[role="option"]')];if(rendered.length!==options.length||options.some((option,index)=>rendered[index].dataset.value!==option.value||rendered[index].textContent!==option.textContent)){list.innerHTML=options.map(option=>`<button type="button" role="option" data-value="${escapeHtml(option.value)}" aria-selected="false">${escapeHtml(option.textContent)}</button>`).join('')}const selected=options.find(option=>option.value===select.value)||options[0];const trigger=menu.querySelector('.themed-select-trigger');menu.querySelector('.themed-select-value').textContent=selected?.textContent||'';trigger.setAttribute('aria-label',`${menu.dataset.label}: ${selected?.textContent||''}`);trigger.disabled=select.disabled||!options.length;if(trigger.disabled)closeThemedSelect(menu);list.querySelectorAll('[role="option"]').forEach(option=>option.setAttribute('aria-selected',String(option.dataset.value===select.value)))}
function closeThemedSelect(menu){menu.classList.remove('is-open');menu.querySelector('.themed-select-list').hidden=true;menu.querySelector('.themed-select-trigger').setAttribute('aria-expanded','false')}
function enhanceThemedSelect(select){if(!select||select.dataset.themed==='true')return;select.dataset.themed='true';const label=select.getAttribute('aria-label')||select.closest('label')?.firstChild?.textContent.trim()||'Choose option';const menu=document.createElement('div');menu.className='themed-select scope-menu';menu.dataset.label=label;select.before(menu);menu.appendChild(select);select.hidden=true;select.setAttribute('aria-hidden','true');select.tabIndex=-1;const trigger=document.createElement('button');trigger.type='button';trigger.className='themed-select-trigger scope-menu-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.innerHTML='<span class="themed-select-value"></span><span class="scope-menu-arrow" aria-hidden="true">⌄</span>';const list=document.createElement('div');list.className='themed-select-list scope-menu-list';list.role='listbox';list.setAttribute('aria-label',label);list.hidden=true;list.innerHTML=[...select.options].map(option=>`<button type="button" role="option" data-value="${escapeHtml(option.value)}" aria-selected="false">${escapeHtml(option.textContent)}</button>`).join('');menu.prepend(trigger);menu.appendChild(list);syncThemedSelect(select);trigger.addEventListener('click',()=>{const opening=list.hidden;document.querySelectorAll('.themed-select.is-open').forEach(other=>{if(other!==menu)closeThemedSelect(other)});menu.classList.toggle('is-open',opening);list.hidden=!opening;trigger.setAttribute('aria-expanded',String(opening));if(opening)(list.querySelector('[aria-selected="true"]')||list.querySelector('[role="option"]'))?.focus()});list.addEventListener('click',event=>{const option=event.target.closest('[role="option"]');if(!option)return;select.value=option.dataset.value;syncThemedSelect(select);closeThemedSelect(menu);select.dispatchEvent(new Event('change',{bubbles:true}));trigger.focus()});list.addEventListener('keydown',event=>{const options=[...list.querySelectorAll('[role="option"]:not([hidden]):not(:disabled)')];const index=options.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus()}if(event.key==='Enter'||event.key===' '){event.preventDefault();document.activeElement.click()}if(event.key==='Escape'){event.preventDefault();closeThemedSelect(menu);trigger.focus()}});select.addEventListener('change',()=>syncThemedSelect(select))}
function syncDiscogsThemedSelects(){discogsThemedSelectIds.forEach(id=>syncThemedSelect(document.querySelector(`#${id}`)))}
[...discogsThemedSelectIds,...spotifyThemedSelectIds].forEach(id=>enhanceThemedSelect(document.querySelector(`#${id}`)));document.addEventListener('click',event=>{if(!event.target.closest('.themed-select'))document.querySelectorAll('.themed-select.is-open').forEach(closeThemedSelect)});
document.querySelectorAll('#spotifySort,#homeSpotifySort').forEach(select=>select.addEventListener('change',()=>document.querySelectorAll('#spotifySort,#homeSpotifySort').forEach(syncThemedSelect)));
document.querySelector('#spotifySearchScope').addEventListener('change',()=>saveUiPreference('spotifySearchScope',spotifySearchMode));
scopeList.addEventListener('click',event=>{if(event.target.closest('[role="option"]'))saveUiPreference('spotifySearchScope',spotifySearchMode)});
document.querySelectorAll('#spotifySort,#homeSpotifySort').forEach(control=>control.addEventListener('change',()=>saveUiPreference('spotifyLibrarySort',spotifyLibrarySort)));
document.querySelector('#collectionSort').addEventListener('change',()=>saveUiPreference('collectionSort',collectionSort));
document.querySelector('#wantlistSort').addEventListener('change',()=>saveUiPreference('wantlistSort',wantlistSort));
document.querySelector('#spotifyPageSize').addEventListener('change',event=>{spotifyPageSize=allowedPreference(Number(event.target.value),[12,24,48],24);spotifyLibraryPage=1;saveUiPreference('spotifyPageSize',spotifyPageSize);renderSpotifyLibrary(document.querySelector('#searchInput').value)});
for(const [id,render] of [['collectionPageSize',renderCollection],['wantlistPageSize',renderWantlist]]){
  document.querySelector(`#${id}`).addEventListener('change',event=>{
    const size=allowedPreference(Number(event.target.value),[12,24,48],24);
    if(id==='collectionPageSize'){collectionPageSize=size;collectionPage=1}else{wantlistPageSize=size;wantlistPage=1}
    saveUiPreference(id,size);render();
  });
}
document.querySelector('#discogsSearchSort').addEventListener('change',()=>saveUiPreference('discogsSearchSort',discogsSearchSort));
document.querySelectorAll('.library-layout').forEach(button=>button.addEventListener('click',()=>saveUiPreference('spotifyLibraryMode',spotifyLibraryMode)));
const playbackControls=document.querySelector('.playback-controls');const playButton=document.querySelector('#playButton');const playbackButtons=document.createElement('div');playbackButtons.className='playback-buttons';playbackButtons.innerHTML='<button class="playback-secondary" id="shuffleButton" aria-label="Shuffle off" aria-pressed="false" title="Shuffle off">↝</button><button class="playback-secondary" id="previousButton" aria-label="Previous track" title="Previous track">|◀</button><button class="play-button" id="playButton" aria-label="Play or pause">Ⅱ</button><button class="playback-secondary" id="nextButton" aria-label="Next track" title="Next track">▶|</button><button class="playback-secondary" id="repeatButton" aria-label="Repeat" title="Repeat">↻</button>';playbackControls.replaceChild(playbackButtons,playButton);document.querySelector('#playButton').onclick=toggleSpotifyPlayback;renderPlayer();const playbackProgress=playbackControls.querySelector('.progress-wrap');playbackControls.appendChild(playbackProgress);
async function runPlaybackAction(action){
  const requestGeneration=spotifyAccountGeneration;
  try{
    if(action==='previous'||action==='next'){
      ++spotifyPlaybackStateRevision;
      spotifySkipPending++;
      spotifySkipBusy[action]++;
      document.querySelector(action==='next'?'#nextButton':'#previousButton')?.setAttribute('aria-busy','true');
      const precedingModes=spotifyModeQueue;
      const request=spotifySkipQueue.catch(()=>{}).then(async()=>{
        if(requestGeneration!==spotifyAccountGeneration)return;
        if(!spotifyConnected)throw new Error('Connect Spotify to use playback controls');
        await precedingModes;
        if(requestGeneration!==spotifyAccountGeneration)return;
        if(!spotifyTargetDeviceId&&!spotifyDeviceId)throw new Error('No Spotify playback device is ready.');
        // A selected mode already requires Spotify's mode-aware skip; no SDK state read is needed.
        if(shuffleEnabled||repeatMode!=='off'){
          await spotifyPlaybackRequest(action);
          return;
        }
        const local=await activeLocalSpotifyPlayer();
        if(!spotifyConnected||requestGeneration!==spotifyAccountGeneration)return;
        if(!spotifyTargetDeviceId&&!spotifyDeviceId)throw new Error('No Spotify playback device is ready.');
        const method=action==='next'?'nextTrack':'previousTrack';
        const modeActive=local?.state.shuffle===true||local?.state.repeat_mode>0;
        if(local&&!modeActive&&typeof local.player[method]==='function'){
          try{await local.player[method]()}catch{throw new Error('Spotify could not skip in RCRD. Try again.')}
        }else await spotifyPlaybackRequest(action);
      });
      spotifySkipQueue=request.catch(()=>{});
      try{await request}finally{if(requestGeneration===spotifyAccountGeneration){spotifySkipPending--;spotifySkipBusy[action]--;if(!spotifySkipBusy[action])document.querySelector(action==='next'?'#nextButton':'#previousButton')?.setAttribute('aria-busy','false')}}
    }
    if(action==='shuffle'){
      if(shuffleRequestPending||spotifyPlaybackStartPending)return;
      shuffleRequestPending=true;
      const generation=spotifyAccountGeneration;
      const button=document.querySelector('#shuffleButton');
      if(button){button.disabled=true;button.setAttribute('aria-busy','true')}
      const request=Promise.all([spotifyModeQueue,spotifySkipQueue]).then(async()=>{
        if(generation!==spotifyAccountGeneration)return;
        const nextState=!shuffleEnabled;
        await spotifyPlaybackRequest('shuffle',{state:nextState});
        if(generation!==spotifyAccountGeneration)return;
        ++shuffleRevision;
        updatePlaybackModes({shuffle_state:nextState});
      });
      spotifyModeQueue=request.catch(()=>{});
      try{await request}finally{if(generation===spotifyAccountGeneration){shuffleRequestPending=false;if(button){button.disabled=button.dataset.playbackUnavailable==='true';button.setAttribute('aria-busy','false')}}}
    }
    if(action==='repeat'){
      if(repeatRequestPending)return;
      repeatRequestPending=true;
      const generation=spotifyAccountGeneration;
      const button=document.querySelector('#repeatButton');
      if(button){button.disabled=true;button.setAttribute('aria-busy','true')}
      const request=Promise.all([spotifyModeQueue,spotifySkipQueue]).then(async()=>{
        if(generation!==spotifyAccountGeneration)return;
        const nextMode=repeatMode==='off'?(spotifyHasContext?'context':'track'):repeatMode==='context'?'track':'off';
        await spotifyPlaybackRequest('repeat',{state:nextMode});
        if(generation!==spotifyAccountGeneration)return;
        ++repeatRevision;
        updatePlaybackModes({repeat_state:nextMode});
        showToast(nextMode==='context'?'Repeat all':nextMode==='track'?'Repeat one':'Repeat off');
      });
      spotifyModeQueue=request.catch(()=>{});
      try{await request}finally{
        if(generation===spotifyAccountGeneration){repeatRequestPending=false;if(button){button.disabled=button.dataset.playbackUnavailable==='true';button.setAttribute('aria-busy','false')}}
      }
    }
  }catch(error){if(requestGeneration===spotifyAccountGeneration)showToast(error.message)}
}
document.querySelector('#shuffleButton').onclick=()=>runPlaybackAction('shuffle');document.querySelector('#previousButton').onclick=()=>runPlaybackAction('previous');document.querySelector('#nextButton').onclick=()=>runPlaybackAction('next');document.querySelector('#repeatButton').onclick=()=>runPlaybackAction('repeat');
function normalizeDiscogsRecord(entry){const release=entry.basic_information||entry;const format=release.formats?.map(item=>[item.name,...(item.descriptions||[])].filter(Boolean).join(' · ')).join(', ')||'Release';return {title:release.title||'Untitled release',artist:release.artists?.map(item=>item.name).join(', ')||'Unknown artist',album:release.title||'Untitled release',year:release.year||'Year unknown',tone:'#31595c',accent:'#f1b597',word:release.title||'RCRD',format,addedAt:entry.date_added||release.date_added||'',image:safeImageUrl(release.cover_image||release.thumb),price:null,source:'discogs',releaseId:release.id||entry.id}}
async function fetchDiscogsSection(path,label){const response=await fetch(path);const data=await response.json();if(!response.ok)throw new Error(data.error||`Could not load Discogs ${label}`);return data}
async function refreshDiscogsSection(section,force=false){
  if(!['collection','wantlist'].includes(section)||!apiConnected)return;
  if(!force&&discogsRefreshRequest[section])return discogsRefreshRequest[section];
  const heading=document.querySelector(`#${section} .page-heading h1 span`);
  const meta=document.querySelector(`#${section}CacheMeta`);
  if(!force&&discogsLoadedAt[section]&&Date.now()-discogsLoadedAt[section]<DISCOGS_LIST_FRESH_MS){const stale=discogsLastFailureAt[section]>discogsLoadedAt[section];heading.textContent=`${section==='collection'?collection.length:wantlist.length} records${stale?' · Discogs unavailable':''}`;meta.textContent=cacheTimestampLabel(stale?'stale-cache':'cached',discogsLoadedAt[section]);meta.hidden=false;return}
  const generation=discogsAccountGeneration;const sequence=++discogsRefreshSequence[section];const isCollection=section==='collection';
  const grid=document.querySelector(isCollection?'#collectionGrid':'#wantlistGrid');const count=document.querySelector(isCollection?'#collectionCount':'#wantCount');const pagination=document.querySelector(isCollection?'#collectionPagination':'#wantlistPagination');
  if(discogsLoadedAt[section]){heading.textContent=`${isCollection?collection.length:wantlist.length} records · Refreshing…`;meta.textContent=cacheTimestampLabel('cached',discogsLoadedAt[section]);meta.hidden=false}
  else{grid.innerHTML=`<p class="empty-state">Loading your Discogs ${section}…</p>`;count.textContent='—';pagination.innerHTML=''}
  const request=(async()=>{
    try{
      const data=await fetchDiscogsSection(`/api/${section}`,section);
      if(!apiConnected||generation!==discogsAccountGeneration||sequence!==discogsRefreshSequence[section])return;
      const records=(data.releases||[]).map(normalizeDiscogsRecord);
      if(isCollection){collection=records;collectionPage=1;renderCollection();if(data.username)document.querySelector('#collection .page-heading .eyebrow').textContent=`${data.username}'S SHELF`}
      else{wantlist=records;wantlistPage=1;renderWantlist()}
      count.textContent=records.length;discogsLoadedAt[section]=Date.now();discogsLastFailureAt[section]=0;heading.textContent=`${records.length} records`;meta.textContent=cacheTimestampLabel('live',discogsLoadedAt[section]);meta.hidden=false;
      if(discogsSearchResults.length&&document.querySelector('.active-view')?.id==='market')renderApiResults(discogsSearchResults,discogsSearchPagination);
      if(spotifyLibraryLoaded&&document.querySelector('.active-view')?.id==='spotify'&&spotifySearchMode==='library')renderSpotifyLibrary(document.querySelector('#searchInput').value,spotifyLibraryPage);
      if(spotifyHomeRecommendations.length&&document.querySelector('.active-view')?.id==='home'&&!document.querySelector('#searchInput').value.trim())renderHomeRecommendations();
    }catch(error){if(!apiConnected||generation!==discogsAccountGeneration||sequence!==discogsRefreshSequence[section])return;discogsLastFailureAt[section]=Date.now()+1;if(discogsLoadedAt[section]){heading.textContent=`${isCollection?collection.length:wantlist.length} records · Discogs unavailable`;meta.textContent=cacheTimestampLabel('stale-cache',discogsLoadedAt[section]);meta.hidden=false}else grid.innerHTML=`<p class="empty-state">${escapeHtml(error.message)}</p>`;showToast(error.message)}
  })();
  discogsRefreshRequest[section]=request;
  try{await request}finally{if(discogsRefreshRequest[section]===request)discogsRefreshRequest[section]=null}
}
async function refreshDiscogsData(){await Promise.allSettled([refreshDiscogsSection('collection'),refreshDiscogsSection('wantlist')])}

document.addEventListener('click',event=>{const button=event.target.closest('[data-page-target]');if(!button||button.disabled)return;const page=Number(button.dataset.page);if(!Number.isInteger(page)||page<1)return;const target=button.dataset.pageTarget;if(target==='spotify-history'){refreshListeningHistory(page);document.querySelector('#spotifyHistoryBrowse').scrollIntoView({behavior:'smooth',block:'start'});return}if(target==='home-recommendations'){if(!spotifyConnected||document.querySelector('.active-view')?.id!=='home'||document.querySelector('#searchInput').value.trim())return;homeRecommendationPage=page;renderHomeRecommendations();document.querySelector('#homeDiscoveryTitle').scrollIntoView({behavior:'smooth',block:'start'});return}if(target==='collection'){collectionPage=page;renderCollection()}if(target==='wantlist'){wantlistPage=page;renderWantlist()}if(target==='spotify-library')renderSpotifyLibrary(document.querySelector('#searchInput').value,page);if(target==='spotify-catalog')searchSpotifyCatalog(document.querySelector('#searchInput').value,page);if(target==='discogs-search'){if(discogsMasterId)searchDiscogsMaster(discogsMasterId,discogsMasterTitle,page);else searchDiscogsApi(document.querySelector('#searchInput').value,page)}window.scrollTo({top:0,behavior:'smooth'})});
document.addEventListener('click',event=>{const chip=event.target.closest('.chip[data-filter]');if(!chip)return;collectionFilter=chip.dataset.filter||'all';collectionPage=1;renderCollection()});
document.addEventListener('click',event=>{const searchResult=event.target.closest('.spotify-play-result');const recentButton=event.target.closest('.track-play');if(!searchResult&&!recentButton)return;event.preventDefault();event.stopImmediatePropagation();const recent=recentButton?recentTracksData[Number(recentButton.dataset.track)]:null;const uri=searchResult?.dataset.uri||recent?.[6];const savedTrack=searchResult?.dataset.playbackIndex!==undefined;const contextUri=savedTrack?'':searchResult?.dataset.contextUri||recent?.[7]||'';if(!uri){showToast('This Spotify result is not playable');return}const uris=savedTrack?followingSavedTrackUris(spotifyLibraryPlaybackRecords,Number(searchResult.dataset.playbackIndex),uri):[];playSpotifyUri(uri,contextUri,uris)},true);


// Direction controls reuse each tab's existing sort/render handler.
function syncSpotifySortDirection(value){document.querySelectorAll('#spotifySortDirection,#homeSpotifySortDirection').forEach(item=>{item.value=value;if(item.matches('button')){const descending=value==='desc';item.textContent=descending?'↓':'↑';item.setAttribute('aria-label',descending?'Sort descending':'Sort ascending');item.title=descending?'Sort descending':'Sort ascending'}syncThemedSelect(item)})}
document.querySelector('#spotifySortDirection').addEventListener('click',event=>{event.currentTarget.value=event.currentTarget.value==='desc'?'asc':'desc';event.currentTarget.dispatchEvent(new Event('change'))});
document.querySelectorAll('.discogs-sort-direction').forEach(button=>button.addEventListener('click',event=>{const control=event.currentTarget;control.value=control.value==='desc'?'asc':'desc';const descending=control.value==='desc';control.textContent=descending?'↓':'↑';control.setAttribute('aria-label',descending?'Sort descending':'Sort ascending');control.title=descending?'Sort descending':'Sort ascending';control.dispatchEvent(new Event('change'))}));
document.querySelectorAll('#spotifySortDirection,#homeSpotifySortDirection,#collectionSortDirection,#wantlistSortDirection,#discogsSearchSortDirection').forEach(control=>control.addEventListener('change',()=>{if(control.id==='spotifySortDirection'||control.id==='homeSpotifySortDirection')syncSpotifySortDirection(control.value);document.querySelector('#'+control.id.replace('Direction','')).dispatchEvent(new Event('change'))}));
document.querySelectorAll('#spotifySortDirection,#homeSpotifySortDirection,#collectionSortDirection,#wantlistSortDirection,#discogsSearchSortDirection').forEach(control=>control.addEventListener('change',()=>{const key=control.id==='homeSpotifySortDirection'?'spotifySortDirection':control.id;saveUiPreference(key,control.value)}));
document.addEventListener('click',event=>{const chip=event.target.closest('.chip[data-filter]');if(chip)saveUiPreference('collectionFilter',chip.dataset.filter||'all')});

function setDirectionControl(id,value){const control=document.querySelector(`#${id}`);if(!control)return;control.value=allowedPreference(value,['asc','desc'],'desc');if(control.matches('button')){const descending=control.value==='desc';control.textContent=descending?'↓':'↑';control.setAttribute('aria-label',descending?'Sort descending':'Sort ascending');control.title=descending?'Sort descending':'Sort ascending'}syncThemedSelect(control)}
function applyUiPreferences(){
  renderVolumeControl();
  syncSpotifySortControls();
  document.querySelector('#spotifyPageSize').value=String(spotifyPageSize);syncThemedSelect(document.querySelector('#spotifyPageSize'));
  setSpotifySearchScope(allowedPreference(uiPreferences.spotifySearchScope,['library','catalog'],'library'));
  document.querySelectorAll('.library-layout').forEach(button=>button.classList.toggle('active',button.dataset.layout===spotifyLibraryMode));
  document.querySelectorAll('.chip[data-filter]').forEach(chip=>chip.classList.toggle('active',chip.dataset.filter===collectionFilter));
  document.querySelector('#collectionSort').value=collectionSort;document.querySelector('#collectionPageSize').value=String(collectionPageSize);document.querySelector('#wantlistPageSize').value=String(wantlistPageSize);document.querySelector('#wantlistSort').value=wantlistSort;document.querySelector('#discogsSearchSort').value=discogsSearchSort;
  setDirectionControl('spotifySortDirection',uiPreferences.spotifySortDirection);setDirectionControl('homeSpotifySortDirection',uiPreferences.spotifySortDirection);setDirectionControl('collectionSortDirection',uiPreferences.collectionSortDirection);setDirectionControl('wantlistSortDirection',uiPreferences.wantlistSortDirection);setDirectionControl('discogsSearchSortDirection',uiPreferences.discogsSearchSortDirection);
  for(const name of ['format','condition','country','genre']){const control=document.querySelector(`#discogs${name[0].toUpperCase()+name.slice(1)}`);control.value=String(uiPreferences.discogsFilters?.[name]||'')}
  const savedYear=String(uiPreferences.discogsFilters?.year||'');document.querySelector('#discogsYear').value=/^\d{0,4}$/.test(savedYear)?savedYear:'';
  collectDiscogsFilters();syncDiscogsThemedSelects();renderCollection();renderWantlist();
}
applyUiPreferences();
document.addEventListener('click',event=>{if(!event.target.closest('[data-view="spotify"]'))return;setSpotifySearchScope(allowedPreference(uiPreferences.spotifySearchScope,['library','catalog'],'library'));const grid=document.querySelector('#spotifyGrid');if(spotifyConnected&&spotifySearchMode==='catalog'&&(!grid.innerHTML.trim()||document.querySelector('#spotifyLibraryStatus').textContent==='Checking connection…'))searchSpotifyCatalog(document.querySelector('#searchInput').value)});
document.querySelector('#heroRecordSearch').addEventListener('submit',()=>{collectDiscogsFilters();saveUiPreference('discogsFilters',{...discogsFilters})});


document.addEventListener('click',event=>{if(event.target.closest('[data-view="home"]'))refreshSpotifyHome()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&document.querySelector('.active-view')?.id==='home')refreshSpotifyHome()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncPassiveSpotifyPlays()});
setInterval(syncPassiveSpotifyPlays,300000);

const VISUALIZER_IDLE_MS=5*60*1000;
const ambientVisualizer=document.querySelector('#ambientVisualizer');
const ambientVisualizerEnabled=document.querySelector('#ambientVisualizerEnabled');
const startAmbientVisualizer=document.querySelector('#startAmbientVisualizer');
const playerVisualizer=document.querySelector('#playerVisualizer');
const ambientVisualizerHint=document.querySelector('#ambientVisualizerHint');
const defaultAmbientVisualizerHint=ambientVisualizerHint.textContent;
let ambientVisualizerTimer=null;
let ambientLastActivity=Date.now();
let ambientPreviousFocus=null;
let ambientWasFullscreen=false;

function clearAmbientVisualizerTimer(){
  if(ambientVisualizerTimer!==null){clearTimeout(ambientVisualizerTimer);ambientVisualizerTimer=null}
}
function restoreVisualizerAfterFullscreenExitFailure(previousFocus){
  if(document.fullscreenElement!==ambientVisualizer)return;
  ambientPreviousFocus=previousFocus;
  ambientVisualizer.hidden=false;
  ambientVisualizer.focus({preventScroll:true});
  ambientVisualizerHint.textContent='Could not leave fullscreen. Press Esc to return.';
}
function hideAmbientVisualizer(restoreFocus=false){
  if(ambientVisualizer.hidden)return;
  const ownedFullscreen=document.fullscreenElement===ambientVisualizer;
  const previousFocus=ambientPreviousFocus;
  ambientVisualizer.hidden=true;
  if(restoreFocus&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  ambientPreviousFocus=null;
  if(ownedFullscreen){
    try{
      const exit=document.exitFullscreen();
      if(exit?.catch)exit.catch(()=>restoreVisualizerAfterFullscreenExitFailure(previousFocus));
    }catch{restoreVisualizerAfterFullscreenExitFailure(previousFocus)}
  }
}
function showAmbientVisualizer({manual=false}={}){
  if((!manual&&!ambientVisualizerEnabled.checked)||document.visibilityState==='hidden'||document.querySelector('dialog[open]')||!ambientVisualizer.hidden)return false;
  clearAmbientVisualizerTimer();
  ambientPreviousFocus=document.activeElement;
  ambientVisualizerHint.textContent=defaultAmbientVisualizerHint;
  ambientVisualizer.hidden=false;
  ambientVisualizer.focus({preventScroll:true});
  return true;
}
function markVisualizerFullscreenUnavailable(){
  if(!ambientVisualizer.hidden)ambientVisualizerHint.textContent='Fullscreen unavailable here. Click or press a key to return.';
}
function startFullscreenVisualizer(){
  if(!showAmbientVisualizer({manual:true}))return false;
  if(typeof ambientVisualizer.requestFullscreen!=='function'||document.fullscreenEnabled===false){markVisualizerFullscreenUnavailable();return false}
  try{
    const request=ambientVisualizer.requestFullscreen({navigationUI:'hide'});
    if(request?.catch)request.catch(markVisualizerFullscreenUnavailable);
    return true;
  }catch{markVisualizerFullscreenUnavailable();return false}
}
function handleVisualizerFullscreenChange(){
  if(document.fullscreenElement===ambientVisualizer){
    ambientWasFullscreen=true;
    if(ambientVisualizer.hidden){
      try{const exit=document.exitFullscreen();if(exit?.catch)exit.catch(()=>restoreVisualizerAfterFullscreenExitFailure(null))}
      catch{restoreVisualizerAfterFullscreenExitFailure(null)}
    }
    return;
  }
  if(!ambientWasFullscreen)return;
  ambientWasFullscreen=false;
  if(!ambientVisualizer.hidden){
    hideAmbientVisualizer(true);
    ambientLastActivity=Date.now();
    armAmbientVisualizerTimer();
  }
}
function armAmbientVisualizerTimer(){
  clearAmbientVisualizerTimer();
  if(!ambientVisualizerEnabled.checked||!ambientVisualizer.hidden||document.visibilityState==='hidden')return;
  const remaining=Math.max(0,VISUALIZER_IDLE_MS-(Date.now()-ambientLastActivity));
  ambientVisualizerTimer=setTimeout(()=>{
    ambientVisualizerTimer=null;
    if(!ambientVisualizerEnabled.checked||document.visibilityState==='hidden')return;
    if(document.querySelector('dialog[open]')){ambientLastActivity=Date.now();armAmbientVisualizerTimer();return}
    if(Date.now()-ambientLastActivity<VISUALIZER_IDLE_MS){armAmbientVisualizerTimer();return}
    showAmbientVisualizer();
  },remaining);
}
function recordVisualizerActivity(event){
  const wasVisible=!ambientVisualizer.hidden;
  if(wasVisible&&event.type==='pointermove')return;
  if(wasVisible){
    if(['pointerdown','touchstart','keydown','wheel'].includes(event.type)){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    hideAmbientVisualizer(true);
  }
  ambientLastActivity=Date.now();
  if(wasVisible)armAmbientVisualizerTimer();
}
function setAmbientVisualizerEnabled(enabled){
  ambientVisualizerEnabled.checked=enabled===true;
  startAmbientVisualizer.disabled=!ambientVisualizerEnabled.checked;
  saveUiPreference('ambientVisualizerEnabled',ambientVisualizerEnabled.checked);
  ambientLastActivity=Date.now();
  if(!ambientVisualizerEnabled.checked)hideAmbientVisualizer(true);
  armAmbientVisualizerTimer();
}
function handleVisualizerVisibilityChange(){
  if(document.visibilityState==='hidden'){
    clearAmbientVisualizerTimer();
    hideAmbientVisualizer(true);
    return;
  }
  ambientLastActivity=Date.now();
  armAmbientVisualizerTimer();
}
function initializeAmbientVisualizer(){
  ambientVisualizerEnabled.checked=uiPreferences.ambientVisualizerEnabled===true;
  startAmbientVisualizer.disabled=!ambientVisualizerEnabled.checked;
  ambientVisualizerEnabled.addEventListener('change',event=>setAmbientVisualizerEnabled(event.currentTarget.checked));
  startAmbientVisualizer.addEventListener('click',startFullscreenVisualizer);
  playerVisualizer.addEventListener('click',startFullscreenVisualizer);
  ambientVisualizer.addEventListener('click',()=>recordVisualizerActivity({type:'click'}));
  document.addEventListener('pointermove',recordVisualizerActivity,{capture:true,passive:true});
  document.addEventListener('pointerdown',recordVisualizerActivity,true);
  document.addEventListener('touchstart',recordVisualizerActivity,{capture:true,passive:false});
  document.addEventListener('keydown',recordVisualizerActivity,true);
  document.addEventListener('wheel',recordVisualizerActivity,{capture:true,passive:false});
  document.addEventListener('visibilitychange',handleVisualizerVisibilityChange);
  document.addEventListener('fullscreenchange',handleVisualizerFullscreenChange);
  armAmbientVisualizerTimer();
}
initializeAmbientVisualizer();

async function refreshAboutVersion(){
  const label=document.querySelector('#rcrdVersion');
  try{const response=await fetch('/api/health',{cache:'no-store'});const data=await response.json();if(!response.ok||typeof data.version!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(data.version))throw new Error('Version unavailable');label.textContent=data.version}
  catch{label.textContent='Unavailable'}
}
async function runManualRefresh(button,task){
  if(button.disabled)return;
  button.disabled=true;button.setAttribute('aria-busy','true');
  try{await task()}catch(error){showToast(error.message)}
  finally{button.disabled=false;button.setAttribute('aria-busy','false')}
}
document.querySelector('#homeRefresh').addEventListener('click',event=>runManualRefresh(event.currentTarget,async()=>{
  if(!spotifyConnected){showToast('Connect Spotify to refresh your listening');return}
  const query=document.querySelector('#searchInput').value.trim();
  if(query){await searchSpotifyCatalog(query,homeRecommendationPage,true);return}
  if(homeDiscoveryMode==='top')return;
  await refreshSpotifyHome(true);
}));
document.querySelector('#spotifyLibraryRefresh').addEventListener('click',event=>runManualRefresh(event.currentTarget,async()=>{
  if(!spotifyConnected){showToast('Connect Spotify to refresh saved music');return}
  if(spotifySearchMode==='catalog'){
    const query=document.querySelector('#searchInput').value.trim();
    if(!query){showToast('Enter a search to refresh Spotify catalog results');return}
    await searchSpotifyCatalog(query,spotifyCatalogPage,true);return;
  }
  const playlistId=document.querySelector('#spotifyPlaylistSelect').value;
  if(playlistId)await loadSpotifyPlaylist(playlistId,true);
  else await refreshSpotifyLibrary(true);
}));
for(const section of ['collection','wantlist'])document.querySelector(`#${section}Refresh`).addEventListener('click',event=>runManualRefresh(event.currentTarget,()=>discogsRefreshRequest[section]||refreshDiscogsSection(section,true)));
refreshAboutVersion();
