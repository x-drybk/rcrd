// Optional browser regression: npm run test:layout. Uses no live server or accounts.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.RCRD_PLAYWRIGHT_MODULE || 'playwright');
const { createFixture, ORIGIN } = require('../walkthrough/source/demo-fixture.cjs');

(async () => {
  const fixture = createFixture(path.resolve(__dirname, '..'), {fontManifest:{}});
  const browser = await chromium.launch({headless:true, ...(process.env.RCRD_CHROME_PATH ? {executablePath:process.env.RCRD_CHROME_PATH} : {})});
  try {
    const context = await browser.newContext({viewport:{width:1920,height:1080}});
    await context.addInitScript(fixture.sdkInstaller, fixture.initial);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)
        ? route.fulfill({contentType:'text/css',body:''}) : fixture.route(route);
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    await page.evaluate(() => {
      document.querySelector('.active-view').classList.remove('active-view');
      document.querySelector('#settings').classList.add('active-view');
    });
    const optionalLayout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {grid:rect('.settings-grid'),account:rect('.account-settings'),heading:rect('.settings-section-heading'),visualizer:rect('.ambient-settings'),lyrics:rect('.lyrics-settings'),history:rect('.history-settings')};
    });
    assert.ok(Math.abs(optionalLayout.account.x - optionalLayout.grid.x) <= 2 && Math.abs(optionalLayout.account.width - optionalLayout.grid.width) <= 2, 'Account access fills the top Settings row without an empty right column');
    const accountText = await page.evaluate(() => ({status:getComputedStyle(document.querySelector('.account-settings .settings-status')).fontSize,renewal:getComputedStyle(document.querySelector('#settingsSpotifyRenewal')).fontSize,guidance:getComputedStyle(document.querySelector('.account-switch-help')).fontSize}));
    assert.deepEqual(accountText,{status:'12px',renewal:'12px',guidance:'12px'},'Account access guidance uses the same text scale as connection rows');
    assert.ok(optionalLayout.heading.y < optionalLayout.visualizer.y && optionalLayout.visualizer.y < optionalLayout.history.y, 'optional features appear together in Settings');
    assert.ok(Math.abs(optionalLayout.visualizer.y - optionalLayout.lyrics.y) <= 2, 'optional visualizer and lyrics cards align');
    if (process.env.RCRD_LAYOUT_CAPTURE_SETTINGS) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE_SETTINGS,fullPage:true});
    await page.setViewportSize({width:600,height:1080});
    const compactOptions = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {visualizer:rect('.ambient-settings'),lyrics:rect('.lyrics-settings'),history:rect('.history-settings'),viewport:innerWidth};
    });
    assert.ok(compactOptions.visualizer.y < compactOptions.lyrics.y && compactOptions.lyrics.y < compactOptions.history.y, 'optional features stack in one readable sequence on narrow screens');
    for (const card of [compactOptions.visualizer,compactOptions.lyrics,compactOptions.history]) assert.ok(card.x >= 0 && card.x + card.width <= compactOptions.viewport + 1, 'optional card fits the viewport');
    await page.setViewportSize({width:1920,height:1080});
    await page.evaluate(() => {
      document.querySelector('#settings').classList.remove('active-view');
      document.querySelector('#guide').classList.add('active-view');
    });
    const guideLayout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {content:rect('.guide-content'),manage:rect('#guide-settings')};
    });
    assert.ok(Math.abs(guideLayout.manage.x - guideLayout.content.x) <= 2 && Math.abs(guideLayout.manage.width - guideLayout.content.width) <= 2, 'Manage RCRD fills the guide row instead of leaving an empty column');
    if (process.env.RCRD_LAYOUT_CAPTURE_GUIDE) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE_GUIDE,fullPage:true});
    await page.evaluate(() => {
      document.querySelector('#guide').classList.remove('active-view');
      document.querySelector('#home').classList.add('active-view');
    });
    for (const width of [1920,900,700,600,360]) {
      await page.setViewportSize({width,height:1080});
      const player = await page.evaluate(() => {
        spotifyTrackUri='spotify:track:1234567890123456789012';
        setSong('Synthetic song','Synthetic artist');
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {bar:rect('#player'),info:rect('.player-now-playing .player-info'),title:rect('#playerTitle'),actions:rect('.player-actions'),controls:rect('.playback-controls'),health:rect('#playbackHealthToggle'),quick:rect('.player-quick-actions'),link:rect('#playerSpotifyLink'),icon:rect('#playerSpotifyLink img'),href:document.querySelector('#playerSpotifyLink').href,buttons:['#playerLiked','#playerLyrics','#playerMix','#playerVisualizer','#playerDiscogs','#volumeButton'].map(rect)};
      });
      assert.equal(player.href,'https://open.spotify.com/track/1234567890123456789012');
      assert.ok(player.icon.width>=21 && player.link.x+player.link.width<=player.bar.x+player.bar.width+1,`Spotify link fits the player at ${width}`);
      assert.ok(player.health.x+player.health.width<=player.quick.x+1,`health stays left of quick controls at ${width}`);
      assert.ok(Math.abs(player.health.y+player.health.height/2-player.quick.y-player.quick.height/2)<=2,`status and quick controls align vertically at ${width}`);
      for (const [index,selector] of ['#playerLiked','#playerLyrics','#playerMix','#playerVisualizer','#playerDiscogs','#volumeButton'].entries()) {
        const button=player.buttons[index];
        assert.equal(await page.locator(selector).isVisible(),true,`${selector} remains visible at ${width}`);
        assert.ok(button.width>=24 && button.x>=player.bar.x && button.x+button.width<=player.bar.x+player.bar.width+1,`${selector} stays inside player at ${width}`);
        if(index)assert.ok(player.buttons[index-1].x+player.buttons[index-1].width<=button.x+1,`${selector} does not overlap previous action at ${width}`);
      }
      assert.ok(player.controls.x+player.controls.width<=player.actions.x+1,`playback controls do not overlap actions at ${width}: controls end ${player.controls.x+player.controls.width}, actions start ${player.actions.x}`);
      if(width>620){
        assert.ok(player.link.x>=player.title.x+player.title.width-1 && player.link.x+player.link.width<=player.info.x+player.info.width+1,`Spotify source follows the song title at ${width}`);
        assert.ok(player.info.x+player.info.width<=player.actions.x,`song details do not overlap actions at ${width}`);
        const longTitle=await page.evaluate(()=>{setSong('An exceptionally long synthetic title that must truncate cleanly','Synthetic artist');return {title:document.querySelector('#playerTitle').getBoundingClientRect().toJSON(),link:document.querySelector('#playerSpotifyLink').getBoundingClientRect().toJSON(),info:document.querySelector('.player-info').getBoundingClientRect().toJSON()}});
        assert.ok(longTitle.title.x+longTitle.title.width<=longTitle.link.x+1 && longTitle.link.x+longTitle.link.width<=longTitle.info.x+longTitle.info.width+1,`long song titles leave room for the source link at ${width}`);
      }else assert.ok(player.link.x+player.link.width<=player.actions.x+1,`compact Spotify source precedes actions at ${width}`);
      if (width===1920 && process.env.RCRD_LAYOUT_CAPTURE_PLAYER) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE_PLAYER});
      if (width===600 && process.env.RCRD_LAYOUT_CAPTURE_PLAYER_MOBILE) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE_PLAYER_MOBILE});
    }
    await page.setViewportSize({width:1920,height:1080});
    await page.evaluate(() => ['playerLiked','playerLyrics','playerMix'].forEach(id => { document.getElementById(id).disabled = false; }));
    for (const selector of ['#playbackHealthToggle','#playerLiked','#playerLyrics','#playerMix','#playerVisualizer','#playerDiscogs','#volumeButton']) {
      await page.locator(selector).hover();
      await page.waitForTimeout(180);
      const style = await page.locator(selector).evaluate(button => {
        const computed = getComputedStyle(button);
        return {height:button.getBoundingClientRect().height,radius:computed.borderRadius,background:computed.backgroundColor,decoration:computed.textDecorationLine};
      });
      assert.equal(style.height,30,`${selector} uses the shared action height`);
      assert.equal(style.radius,'4px',`${selector} uses the shared action shape`);
      assert.equal(style.background,'rgb(33, 60, 43)',`${selector} uses the shared hover surface`);
      assert.equal(style.decoration,'none',`${selector} does not acquire a text-only hover treatment`);
    }
    await page.locator('#volumeControl').evaluate(control=>{control.value='74';control.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await page.locator('#volumeControl').inputValue(),'74');
    assert.equal(await page.locator('#volumeLevel').innerText(),'74%');
    assert.equal(await page.locator('#volumeControl').getAttribute('aria-valuetext'),'74 percent');
    await page.locator('#volumeControl').evaluate(control=>{control.value='1';control.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await page.locator('#volumeLevel').innerText(),'1%');
    await page.locator('#volumeControl').evaluate(control=>{control.value='65';control.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await page.locator('#playerMoreMenu').count(),0,'the player actions no longer require a menu');
    await page.locator('#toast').evaluate(element=>{element.textContent='Synthetic notice';element.classList.add('show')});
    assert.equal(await page.locator('#playerVisualizer').evaluate(element=>{const box=element.getBoundingClientRect();return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('#playerVisualizer')===element}),true,'the visible visualizer remains clickable above a notice');
    if (process.env.RCRD_LAYOUT_CAPTURE_PLAYER_MENU) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE_PLAYER_MENU});
    await page.locator('#playerVisualizer').click();
    assert.equal(await page.locator('#ambientVisualizer').isVisible(),true);
    await page.keyboard.press('Escape');
    await page.locator('.sidebar nav [data-view="spotify"]').click();
    await page.locator('#spotifyGrid .has-play-count .album-name button').first().waitFor();
    await page.evaluate(()=>{
      apiConnected=true;collection=[];
      wantlist=spotifyLibraryTracks.map(record=>({source:'discogs',title:record.album,artist:record.artist}));
      renderSpotifyLibrary('');
    });
    assert.equal(await page.locator('#spotifyGrid .home-album-link').count(),0);
    await page.locator('.library-layout[data-layout="list"]').click();
    const header = page.locator('.spotify-list-header');
    const row = page.locator('#spotifyGrid .album-card').first();
    const sourceLink = row.locator('.spotify-source-link');
    assert.equal(await sourceLink.count(), 1);
    assert.match(await sourceLink.getAttribute('href'), /^https:\/\/open\.spotify\.com\/(track|album)\/[A-Za-z0-9]{22}$/);
    assert.match(await sourceLink.getAttribute('aria-label'), /^Open .+ on Spotify$/);
    assert.equal((await sourceLink.innerText()).trim(), '');
    const sourceIcon = sourceLink.locator('img');
    assert.equal(await sourceIcon.getAttribute('src'), 'assets/spotify-icon-white.svg');
    assert.equal(await sourceIcon.evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.ok((await sourceIcon.boundingBox()).width >= 21);
    assert.ok((await page.locator('#spotify .provider-section-footer img').boundingBox()).width >= 70);
    const albumLabel = row.locator('.album-name>span');
    const playsLabel = row.locator('.play-count>span');
    const intersects = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
    for (const width of [1920,1100,900,700,600]) {
      await page.setViewportSize({width,height:1080});
      assert.equal(await header.isVisible(), width > 900, `header visibility at ${width}`);
      assert.equal(await albumLabel.isVisible(), width <= 900, `Album row label at ${width}`);
      assert.equal(await playsLabel.isVisible(), width <= 900, `Plays row label at ${width}`);
      for (const text of ['Not recorded','≈123,456']) {
        await row.locator('.play-count strong').evaluate((element,value) => {element.textContent=value;}, text);
        const album = await row.locator('.album-name').boundingBox();
        const plays = await row.locator('.play-count').boundingBox();
        const link = await row.locator('.album-name button').boundingBox();
        const badge=await row.locator('.spotify-discogs-actions .shelf-badge').boundingBox();
        const action=await row.locator('.spotify-discogs-actions .spotify-discogs').boundingBox();
        const source=await sourceLink.boundingBox();
        const title=await row.locator('h3').boundingBox();
        assert.ok(Math.abs(badge.width-action.width)<1&&Math.abs(badge.height-action.height)<1,`stacked badge/button dimensions match at ${width}`);
        assert.ok(!intersects(link, plays) && !intersects(album, plays), `separate album title/count at ${width}`);
        assert.ok(!intersects(badge,album)&&!intersects(badge,plays)&&!intersects(badge,action),`wantlist badge stays separate from metadata and action at ${width}`);
        assert.ok(source.x > title.x && !intersects(source,title) && !intersects(source,action),`Spotify icon stays on the right without covering the title or action at ${width}`);
        if(width>620)assert.ok(badge.x>plays.x,'wantlist is in the right-hand action column');
        if (width > 900) {
          for (const [heading,cell] of [['span:nth-child(2)',album],['.spotify-list-plays-heading',plays]]) {
            const box = await header.locator(`.spotify-list-header-columns ${heading}`).boundingBox();
            assert.ok(Math.abs(box.x-cell.x)<1, `${heading} aligned at ${width}`);
          }
        }
      }
      console.log(`PASS ${width}px: labels, column alignment, right-hand wantlist and no overlapping metadata`);
    }
    await page.setViewportSize({width:1920,height:1080});
    if (process.env.RCRD_LAYOUT_CAPTURE) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE});
    await page.locator('.library-layout[data-layout="grid"]').click();
    assert.equal(await header.isVisible(), false);
    assert.equal(await albumLabel.isVisible(), true);
    assert.equal(await playsLabel.isVisible(), true);
    await page.locator('.library-layout[data-layout="list"]').click();
    await row.locator('.album-name button').press('Enter');
    await page.locator('#spotifyGrid .spotify-album-track').first().waitFor();
    const trackSource = page.locator('#spotifyGrid .spotify-album-track .spotify-track-source').first();
    assert.match(await trackSource.getAttribute('href'), /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}$/);
    assert.match(await trackSource.getAttribute('aria-label'), /^Open .+ on Spotify$/);
    assert.equal((await trackSource.innerText()).trim(), '');
    const trackIcon = trackSource.locator('img');
    assert.equal(await trackIcon.getAttribute('src'), 'assets/spotify-icon-white.svg');
    assert.equal(await trackIcon.evaluate(image => image.complete && image.naturalWidth > 0), true);
    assert.ok((await trackIcon.boundingBox()).width >= 21);
    const trackRow = page.locator('#spotifyGrid .spotify-album-track').first();
    const trackTitle = await trackRow.locator('.spotify-album-track-title').boundingBox();
    const trackPlay = await trackRow.locator('.spotify-play-result').boundingBox();
    const trackLink = await trackSource.boundingBox();
    assert.ok(trackLink.x > trackTitle.x + trackTitle.width && trackLink.x >= trackPlay.x + trackPlay.width);
    await page.locator('.spotify-catalog-album-back').click();
    await page.locator('#spotifyGrid .album-name button').first().waitFor();
    // Catalog rows deliberately have no play counts; do not advertise an empty column.
    await row.evaluate(element => {element.classList.remove('has-play-count');element.querySelector('.play-count').remove();});
    await page.locator('#spotifyGrid .has-play-count').evaluateAll(elements => elements.forEach(element => element.remove()));
    assert.equal(await page.locator('.spotify-list-plays-heading').isVisible(), false);
    assert.equal(await row.locator('.album-name strong').isVisible(), true);
    await page.locator('.sidebar nav [data-view="market"]').click();
    await page.evaluate(() => renderApiResults([{id:9001,title:'The Paper Lanterns - Northern Lights',year:2020,format:['Vinyl']}],{items:1}));
    const discogsCard = page.locator('#marketGrid .market-card').first();
    assert.equal(await discogsCard.locator('.discogs-data-credit').count(), 1);
    assert.equal(await discogsCard.locator('.release-link').count(), 0);
    assert.equal(await discogsCard.locator('.discogs-data-credit').getAttribute('href'), 'https://www.discogs.com/release/9001');
    assert.equal((await discogsCard.locator('.discogs-data-credit').innerText()).trim(), 'Data provided by Discogs.');
    const creditBox = await discogsCard.locator('.discogs-data-credit').boundingBox();
    const cardBox = await discogsCard.boundingBox();
    assert.ok(creditBox.x > cardBox.x + cardBox.width / 2, 'Discogs credit is tucked against the right side of its release card');
    await page.locator('.sidebar nav [data-view="home"]').click();
    await page.evaluate(() => {
      const host = document.createElement('section');
      host.className = 'recent-section';
      host.innerHTML = '<div id="recentTracks"></div>';
      document.querySelector('#home').append(host);
    });
    for (const width of [1920,600]) {
      await page.setViewportSize({width,height:1080});
      const position = await page.evaluate(() => {
        renderRecentTracks([['','Synthetic song','Synthetic artist','3:00','#123456','','spotify:track:1234567890123456789012']]);
        const recent = document.querySelector('#recentTracks .track');
        return {title:recent.querySelector('strong').getBoundingClientRect().toJSON(),source:recent.querySelector('.spotify-source-link').getBoundingClientRect().toJSON()};
      });
      assert.ok(position.source.x > position.title.x + position.title.width, `recent Spotify icon sits right of the title at ${width}`);
    }
    const lyricsFailure = await page.evaluate(() => {
      const dialog=document.querySelector('#lyricsDialog');dialog.showModal();
      const host=document.querySelector('#lyricsEmbed');const frame=document.createElement('iframe');frame.dataset.geniusId='123';frame.src='about:blank';host.replaceChildren(frame);
      const status=document.querySelector('#lyricsStatus');status.hidden=true;
      window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'rcrd-genius-embed-error',id:123}}));
      const ignored=host.contains(frame);
      window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{type:'rcrd-genius-embed-error',id:123}}));
      const result={ignored,removed:!host.contains(frame),visible:!status.hidden,message:status.textContent};dialog.close();return result;
    });
    assert.equal(lyricsFailure.ignored,true,'unrelated pages cannot report an embed failure');
    assert.equal(lyricsFailure.removed,true,'blocked Genius embeds leave no empty frame');
    assert.equal(lyricsFailure.visible,true);
    assert.match(lyricsFailure.message,/cannot display its lyrics inside RCRD/);
    if (process.env.RCRD_LAYOUT_CAPTURE_DISCOGS) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE_DISCOGS});
    await page.setViewportSize({width:1920,height:1080});
    const disconnectedArt = await page.evaluate(() => {
      resetSpotifyAccountUi();
      const avatar=document.querySelector('#profileAvatar');
      const cover=document.querySelector('#playerAlbumOpen');
      return {avatar:avatar.classList.contains('is-placeholder'),avatarIcon:getComputedStyle(avatar,'::before').content,cover:cover.classList.contains('has-art'),coverMark:getComputedStyle(cover,'::before').content,coverBackground:getComputedStyle(cover).backgroundImage,coverCenter:getComputedStyle(cover,'::after').content,coverDisabled:cover.disabled};
    });
    assert.equal(disconnectedArt.avatar,true);
    await page.waitForFunction(() => document.querySelector('#profileAvatarMobile').classList.contains('is-placeholder'));
    assert.notEqual(disconnectedArt.avatarIcon,'none');
    assert.equal(disconnectedArt.cover,false);
    assert.equal(disconnectedArt.coverMark,'none');
    assert.match(disconnectedArt.coverBackground,/rcrd-cover-placeholder\.webp/);
    assert.equal(disconnectedArt.coverCenter,'none');
    assert.equal(disconnectedArt.coverDisabled,true,'placeholder artwork is not a false album action');
    if (process.env.RCRD_LAYOUT_CAPTURE_PLACEHOLDERS) await page.screenshot({path:process.env.RCRD_LAYOUT_CAPTURE_PLACEHOLDERS});
    const realArt = await page.evaluate(() => {
      const cover=document.querySelector('#playerAlbumOpen');
      cover.classList.add('has-art');cover.style.backgroundImage='url("https://example.test/album.png")';
      return {background:getComputedStyle(cover).backgroundImage,record:getComputedStyle(cover,'::before').content,center:getComputedStyle(cover,'::after').display};
    });
    assert.match(realArt.background,/example\.test\/album\.png/);
    assert.equal(realArt.record,'none');
    assert.equal(realArt.center,'none');
    assert.deepEqual(errors, []);
    fixture.assertClean();
    console.log('PASS grid labels and no-count header fallback; no browser page errors');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
