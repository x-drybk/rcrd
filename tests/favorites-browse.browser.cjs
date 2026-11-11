const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.RCRD_PLAYWRIGHT_MODULE||'playwright');
const {createFixture,ORIGIN}=require('../walkthrough/source/demo-fixture.cjs');
(async()=>{
  const fixture=createFixture(path.resolve(__dirname,'..'),{fontManifest:{}});
  const browser=await chromium.launch({headless:true,...(process.env.RCRD_CHROME_PATH?{executablePath:process.env.RCRD_CHROME_PATH}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(fixture.sdkInstaller,fixture.initial);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      return /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)?route.fulfill({contentType:'text/css',body:''}):fixture.route(route);
    });
    const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(ORIGIN);
    await page.waitForFunction(()=>spotifyConnected&&spotifyHomeRecommendations.length>0);
    assert.equal(await page.locator('#recommendations .home-album-link').count(),0);
    await page.locator('#recommendations .home-album-cover').first().press('Enter');
    await page.locator('#recommendations .spotify-album-track').first().waitFor();
    await page.locator('#recommendations .home-album-back').click();
    await page.locator('#recommendations .home-album-cover').first().waitFor();
    assert.equal(await page.locator('#recommendations .home-album-link').count(),0);
    await page.evaluate(()=>{
      apiConnected=true;wantlist=[];collection=[{source:'discogs',title:'Owned album',artist:'Example Artist'}];
      homeDiscoveryMode='recent';homeRecommendationPage=1;
      spotifyHomeRecommendations=['Owned album','Other album'].map((title,index)=>({title,artist:'Example Artist',year:'2020',format:'Recently played on Spotify',uri:`spotify:album:${String(index+1).padStart(22,'0')}`}));
      renderHomeRecommendations();
    });
    const owned=page.locator('#recommendations .album-card').nth(0);
    const unowned=page.locator('#recommendations .album-card').nth(1);
    assert.equal(await owned.locator('.spotify-discogs').count(),0);
    assert.equal(await owned.locator('.spotify-collection-status').count(),1);
    assert.equal(await owned.locator('.shelf-badges').count(),0);
    const ownedPlay=await owned.locator('.spotify-play-result').boundingBox();
    const otherPlay=await unowned.locator('.spotify-play-result').boundingBox();
    assert.ok(Math.abs(ownedPlay.y-otherPlay.y)<1,'collection match does not push Play down');
    const status=await owned.locator('.spotify-collection-status').boundingBox();
    const action=await unowned.locator('.spotify-discogs').boundingBox();
    assert.ok(Math.abs(status.y-action.y)<1,'collection status occupies the Discogs action slot');
    await page.evaluate(()=>{
      homeDiscoveryMode='top';spotifyHomeRecommendations=[];apiConnected=false;
      spotifyTopAlbums=Array.from({length:18},(_,index)=>({title:`Synthetic favorite ${index}`,artist:'Example Artist',uri:`spotify:album:${String(index+1).padStart(22,'0')}`}));
      homeRecommendationPage=1;renderHomeRecommendations();
    });
    const titles=()=>page.locator('#recommendations .album-meta h3').allTextContents();
    const shown=new Set(await titles());const calls=fixture.requests.length;
    assert.equal(await page.locator('#homeRefresh').isVisible(),false);
    await page.locator('#homeSpotifyPagination').getByRole('button',{name:'2',exact:true}).click();
    for(const title of await titles()){assert.ok(!shown.has(title));shown.add(title);}
    assert.equal(await page.locator('#homeRefresh').isVisible(),false);
    await page.locator('#homeSpotifyPagination').getByRole('button',{name:'3',exact:true}).click();
    for(const title of await titles()){assert.ok(!shown.has(title));shown.add(title);}
    assert.equal(shown.size,18);
    assert.equal(await page.locator('#homeRefresh').isVisible(),false);
    assert.equal(fixture.requests.length,calls,'different albums use only loaded data');
    await page.evaluate(()=>{homeDiscoveryMode='recent';renderHomeRecommendations();});
    assert.equal(await page.getByRole('button',{name:'Refresh listening recommendations',exact:true}).isVisible(),true);
    await page.evaluate(()=>{homeDiscoveryMode='top';spotifyTopAlbums=spotifyTopAlbums.slice(0,4);renderHomeRecommendations();});
    assert.equal(await page.locator('#homeRefresh').isVisible(),false);
    assert.deepEqual(errors,[]);fixture.assertClean();
    console.log('PASS artwork navigation, collection replacement and action alignment, favorites visibility and pagination');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
