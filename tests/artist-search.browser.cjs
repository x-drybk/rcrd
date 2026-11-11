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
    await page.locator('.sidebar nav [data-view="spotify"]').click();
    let artist=page.locator('#spotifyGrid .artist-search-link').first();
    await artist.waitFor();const name=await artist.textContent();
    const spotifyRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/spotify/search');
    await artist.press('Enter');
    const spotifyUrl=new URL((await spotifyRequest).url());
    assert.equal(spotifyUrl.searchParams.get('q'),name);
    assert.equal(await page.locator('#spotifySearchScope').inputValue(),'catalog');
    assert.equal(await page.locator('#searchInput').inputValue(),name);
    for(const view of ['collection','wantlist']){
      await page.locator(`.sidebar nav [data-view="${view}"]`).click();
      artist=page.locator(`#${view} .artist-search-link`).first();await artist.waitFor();
      const name=await artist.textContent();
      const padding=await artist.evaluate(element=>getComputedStyle(element).padding);
      assert.equal(padding,'0px',`${view} artist keeps text-link styling`);
      await page.evaluate(()=>{document.querySelector('#discogsFormat').value='Vinyl';document.querySelector('#discogsReleaseTitle').value='Old album';});
      const discogsRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/search');
      await artist.click();
      const url=new URL((await discogsRequest).url());
      assert.equal(url.searchParams.get('artist'),name);
      assert.equal(url.searchParams.get('q'),'');
      assert.ok(!url.searchParams.get('format'));assert.ok(!url.searchParams.get('release_title'));
      assert.equal(await page.locator('#market').evaluate(element=>element.classList.contains('active-view')),true);
      await page.locator('#marketGrid .artist-search-link').first().waitFor();
    }
    const catalogArtist=page.locator('#marketGrid .artist-search-link').first();
    const catalogRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/search');
    await catalogArtist.press('Enter');await catalogRequest;
    assert.deepEqual(errors,[]);fixture.assertClean();
    console.log('PASS Spotify artist keyboard search, Discogs collection/wantlist/catalog searches and filter reset');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
