// Isolated browser regression; uses synthetic provider responses, never real accounts.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.RCRD_PLAYWRIGHT_MODULE||'playwright');
const {createFixture,ORIGIN,tracks}=require('../walkthrough/source/demo-fixture.cjs');
(async()=>{
  const fixture=createFixture(path.resolve(__dirname,'..'),{fontManifest:{}});
  const browser=await chromium.launch({headless:true,...(process.env.RCRD_CHROME_PATH?{executablePath:process.env.RCRD_CHROME_PATH}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(fixture.sdkInstaller,fixture.initial);
    let saved=false;
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname))return route.fulfill({contentType:'text/css',body:''});
      if(url.origin===ORIGIN&&url.pathname==='/api/spotify/liked'){
        const request=route.request();
        if(request.method()==='PUT')saved=JSON.parse(request.postData()).saved;
        const body=request.method()==='PUT'?{ok:true,saved}:url.searchParams.has('uris')?{saved:url.searchParams.get('uris').split(',').map(uri=>uri===tracks[0].uri?saved:false)}:{saved};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      }
      return fixture.route(route);
    });
    const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(ORIGIN);
    const player=page.locator('#playerLiked');
    await page.waitForFunction(()=>document.querySelector('#playerLiked')?.getAttribute('aria-pressed')==='false'&&!document.querySelector('#playerLiked').disabled);
    // Simulate a later provider-confirmed album read correcting earlier player state.
    saved=true;
    await page.locator('#playerAlbumOpen').click();
    const heart=page.locator(`.collection-lookup-results .spotify-track-liked[data-uri="${tracks[0].uri}"]`);
    await page.waitForFunction(uri=>document.querySelector(`.spotify-track-liked[data-uri="${uri}"]`)?.dataset.likedState==='saved',tracks[0].uri);
    assert.equal(await player.getAttribute('aria-pressed'),'true');
    assert.ok((await player.getAttribute('class')).includes('is-liked'));
    await player.click();
    await page.waitForFunction(uri=>document.querySelector(`.spotify-track-liked[data-uri="${uri}"]`)?.dataset.likedState==='unsaved',tracks[0].uri);
    assert.equal(await player.getAttribute('aria-pressed'),'false');
    await heart.click();
    await page.waitForFunction(()=>document.querySelector('#playerLiked')?.getAttribute('aria-pressed')==='true');
    assert.equal(await heart.textContent(),'♥');
    assert.deepEqual(errors,[]);fixture.assertClean();
    console.log('PASS album read, track-bar removal and album save keep both rendered hearts synchronized');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
