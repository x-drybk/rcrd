const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.RCRD_PLAYWRIGHT_MODULE||'playwright');
const {createFixture,ORIGIN,tracks}=require('../walkthrough/source/demo-fixture.cjs');
(async()=>{
  const fixture=createFixture(path.resolve(__dirname,'..'),{fontManifest:{}});
  const lead={id:'A'.repeat(22),name:'The Paper Lanterns'};
  const seed={...tracks[0],artists:[lead]};
  const candidates=Array.from({length:120},(_,i)=>({...tracks[10],uri:`spotify:track:${String(900+i).padStart(22,'0')}`,name:`Related song ${i+1}`,artists:[{id:String(2000+Math.floor(i/10)).padStart(22,'0'),name:`Linked artist ${Math.floor(i/10)}`}],album:{...tracks[10].album,id:String(800+i).padStart(22,'0')}}));
  const discoveryArtists=[...new Map(candidates.map(track=>[track.artists[0].id,{id:track.artists[0].id,source:Number(track.artists[0].id)%2?'discogs-style':'listenbrainz',style:'Indie Rock'}])).values()];
  let sparse=false;
  const browser=await chromium.launch({headless:true,...(process.env.RCRD_CHROME_PATH?{executablePath:process.env.RCRD_CHROME_PATH}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(fixture.sdkInstaller,fixture.initial);
    const starts=[];
    await context.route('**/*',route=>{
      const request=route.request();const url=new URL(request.url());
      const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(url.origin===ORIGIN){
        if(url.pathname==='/api/spotify/currently-playing')return json({...fixture.initial,item:seed});
        if(url.pathname==='/api/spotify/mix-sources')return json({seed,playlists:[],savedTracks:[],discoveryArtists,discoveryTracks:candidates.slice(0,sparse?20:120),discoveryWarnings:sparse?['listenbrainz-unavailable']:[],playCounts:{},partial:sparse});
        if(url.pathname==='/api/spotify/recent')return json({recentlyPlayed:[]});
        if(url.pathname==='/api/spotify/liked'&&request.method()==='GET')return json({saved:false});
        if(url.pathname==='/api/spotify/playback'&&request.postDataJSON()?.action==='start')starts.push(request.postDataJSON());
      }
      return /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)?route.fulfill({contentType:'text/css',body:''}):fixture.route(route);
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(ORIGIN);
    await page.locator('#playerMix:enabled').waitFor();await page.locator('#playerMix').click();
    const mixBox=await page.locator('#playerMix').boundingBox();const heartBox=await page.locator('#playerLiked').boundingBox();
    assert.ok(Math.abs(mixBox.y-heartBox.y)<3,'Mix stays on the same player row');
    const dialog=page.getByRole('dialog',{name:'RCRD Mix',exact:true});await dialog.waitFor();
    await page.locator('#spotifyMixStart:enabled').waitFor();
    assert.equal(await dialog.locator('.mix-track').count(),100);assert.equal(starts.length,0);
    assert.match(await dialog.textContent(),/Related artist via ListenBrainz/);assert.match(await dialog.textContent(),/Shares Discogs style: Indie Rock/);
    assert.match(await page.locator('#spotifyMixDescription').textContent(),/Your library and imported listening history stay local/);
    assert.deepEqual(await page.locator('#spotifyMixDescription a').evaluateAll(links=>links.map(link=>link.href)),['https://musicbrainz.org/','https://listenbrainz.org/','https://www.discogs.com/']);
    await dialog.locator('input').nth(1).uncheck();
    assert.match(await page.locator('#spotifyMixStatus').textContent(),/99 tracks selected/);
    assert.equal(await page.locator('#spotifyMixStart').isDisabled(),true);
    if(process.env.RCRD_MIX_SCREENSHOT)await page.screenshot({path:process.env.RCRD_MIX_SCREENSHOT});
    await page.getByRole('button',{name:'Close RCRD Mix'}).click();
    await dialog.waitFor({state:'hidden'});assert.equal(starts.length,0);
    await page.locator('#playerMix').click();await page.locator('#spotifyMixStart:enabled').waitFor();
    await page.locator('#spotifyMixStart').click();await dialog.waitFor({state:'hidden'});
    assert.equal(starts.length,1);assert.equal(starts[0].uris.length,100);assert.equal(starts[0].uris[0],seed.uri);
    sparse=true;await page.locator('#playerMix').click();
    await page.waitForFunction(()=>document.querySelector('#spotifyMixStatus').textContent.includes('at least 100 are required'));
    assert.match(await page.locator('#spotifyMixStatus').textContent(),/ListenBrainz related-artist discovery was unavailable/);
    assert.equal(await page.locator('#spotifyMixStart').isDisabled(),true);assert.equal(starts.length,1);
    assert.deepEqual(errors,[]);fixture.assertClean();
    console.log('PASS related-music Mix: discovery-only 100-track preview, source reasons and privacy disclosure, 99-track refusal, cancellation, confirmed full playback, and specific sparse-source warnings');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
