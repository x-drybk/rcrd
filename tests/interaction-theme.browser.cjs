// Optional browser regression. Uses the local synthetic fixture, never account data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.RCRD_PLAYWRIGHT_MODULE || 'playwright');
const { createFixture, ORIGIN } = require('../walkthrough/source/demo-fixture.cjs');

const hoverSurface = 'rgb(33, 60, 43)';
const lime = 'rgb(217, 255, 72)';

(async () => {
  const fixture = createFixture(path.resolve(__dirname, '..'), { fontManifest: {} });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.RCRD_CHROME_PATH ? { executablePath: process.env.RCRD_CHROME_PATH } : {})
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(fixture.sdkInstaller, fixture.initial);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)
        ? route.fulfill({ contentType: 'text/css', body: '' }) : fixture.route(route);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    await page.addStyleTag({ content: '*{transition:none!important}' });
    await page.evaluate(() => {
      document.querySelectorAll('.view').forEach(view => view.classList.add('active-view'));
      document.querySelectorAll('.profile-menu').forEach(menu => { menu.open = true; });
      document.querySelector('#sidebarPlaylistTrigger').disabled = false;
      document.querySelector('#sidebarPlaylistList').hidden = false;
      document.querySelector('#spotifySearchScopeList').hidden = false;
      document.querySelector('#settingsSpotifyReconnect').hidden = false;
      document.querySelector('#wantlistGrid').insertAdjacentHTML('beforeend', '<article class="want-card"><button id="themeWantAction" class="find-listing">Find editions</button></article>');
      document.querySelector('#marketGrid').insertAdjacentHTML('beforeend', '<article class="market-card"><button id="themeCatalogAction" class="api-collection">Add to collection</button></article>');
      document.querySelector('#collectionPagination').innerHTML = '<button class="active">1</button><button id="themeNextPage">2</button>';
    });

    const guideLayout = await page.evaluate(() => {
      const content = document.querySelector('.guide-content').getBoundingClientRect();
      const blocks = ['guide-listening', 'guide-collecting', 'guide-optional-features'].map(id => document.getElementById(id).getBoundingClientRect());
      return { width: content.width, blocks: blocks.map(({ width, top, bottom }) => ({ width, top, bottom })), optionalColumns: getComputedStyle(document.querySelector('#guide-optional-features')).columnCount };
    });
    assert.equal(guideLayout.optionalColumns, '2', 'the wide optional-features card balances copy in two columns');
    for (const block of guideLayout.blocks) assert.ok(block.width >= guideLayout.width - 2, 'guide cards use the full available width');
    assert.ok(guideLayout.blocks[0].bottom < guideLayout.blocks[1].top && guideLayout.blocks[1].bottom < guideLayout.blocks[2].top, 'core and optional guide sections flow without a side-card gap');

    const controls = [
      ['sidebar navigation', '.sidebar nav a[data-view="spotify"]'],
      ['guide navigation', '.guide-toc a[href="#guide-listening"]'],
      ['profile menu', '.profile-menu-list a[data-view="settings"]'],
      ['playlist trigger', '#sidebarPlaylistTrigger'],
      ['playlist option', '#sidebarPlaylistList [role="option"]:first-child'],
      ['Spotify scope', '#spotifySearchScopeTrigger'],
      ['Spotify scope option', '#spotifySearchScopeList [data-value="catalog"]'],
      ['Saved music view switch', '#spotify .library-layout[data-layout="list"]'],
      ['collection filter', '#collection .chip[data-filter="vinyl"]'],
      ['collection sort direction', '#collectionSortDirection'],
      ['collection pagination', '#themeNextPage'],
      ['wantlist refresh', '#wantlistRefresh'],
      ['wantlist action', '#themeWantAction'],
      ['catalog sort direction', '#discogsSearchSortDirection'],
      ['catalog action', '#themeCatalogAction'],
      ['Settings primary action', '#restartRcrd'],
      ['Settings secondary action', '#settingsSpotifyReconnect'],
      ['guide action', '.guide-entry .guide-open'],
      ['Listening text action', '#homeTopToggle'],
      ['track-bar action', '#playerDiscogs']
    ];
    for (const [label, selector] of controls) {
      if (selector.startsWith('#sidebarPlaylistList')) await page.locator('#sidebarPlaylistList').evaluate(list => { list.hidden = false; });
      if (selector.startsWith('#spotifySearchScopeList')) await page.locator('#spotifySearchScopeList').evaluate(list => { list.hidden = false; });
      const control = page.locator(selector).first();
      await control.hover();
      const style = await control.evaluate(node => {
        const css = getComputedStyle(node);
        return { background: css.backgroundColor, color: css.color, radius: css.borderRadius };
      });
      assert.equal(style.background, hoverSurface, `${label} has the shared hover surface`);
      assert.equal(style.color, lime, `${label} has the shared hover text`);
      assert.equal(style.radius, '4px', `${label} has the shared corner shape`);
    }

    for (const [label, selector] of [
      ['guide navigation', '.guide-toc a[href="#guide-listening"]'],
      ['collection filter', '#collection .chip[data-filter="vinyl"]'],
      ['Settings primary action', '#restartRcrd'],
      ['Spotify scope', '#spotifySearchScopeTrigger']
    ]) {
      const control = page.locator(selector);
      await control.focus();
      const style = await control.evaluate(node => {
        const css = getComputedStyle(node);
        return { focused: node.matches(':focus-visible'), background: css.backgroundColor, outline: css.outlineColor };
      });
      assert.equal(style.focused, true, `${label} is keyboard-focus visible`);
      assert.equal(style.background, hoverSurface, `${label} uses the same focus surface`);
      assert.equal(style.outline, lime, `${label} keeps a visible focus ring`);
    }

    for (const [label, selector] of [
      ['current sidebar page', '.sidebar nav a.active'],
      ['selected collection filter', '#collection .chip.active'],
      ['selected library layout', '#spotify .library-layout.active'],
      ['selected pagination page', '#collectionPagination button.active'],
      ['selected scope option', '#spotifySearchScopeList [aria-selected="true"]']
    ]) {
      const style = await page.locator(selector).first().evaluate(node => {
        const css = getComputedStyle(node);
        return { background: css.backgroundColor, color: css.color };
      });
      assert.equal(style.background, 'rgb(41, 70, 51)', `${label} has the shared selected surface`);
      assert.equal(style.color, lime, `${label} has the shared selected text`);
    }

    for (const [label, selector] of [
      ['previous track', '#previousButton'],
      ['next track', '#nextButton'],
      ['repeat', '#repeatButton']
    ]) {
      const control = page.locator(selector);
      await control.hover();
      assert.equal(await control.evaluate(node => getComputedStyle(node).backgroundColor), hoverSurface, `${label} shows transport hover feedback`);
    }
    await page.locator('#playButton').hover();
    assert.equal(await page.locator('#playButton').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(234, 255, 138)', 'play/pause highlights while retaining its lime treatment');

    await page.evaluate(() => {
      document.querySelector('#playbackHealthPanel').hidden = false;
      document.querySelector('#playbackHealthRetry').hidden = false;
      document.querySelector('#playbackDeviceLoad').hidden = false;
      const list = document.querySelector('#playbackDeviceList');
      list.hidden = false;
      list.innerHTML = '<button class="playback-device" aria-pressed="false"><span class="playback-device-name">Fixture device</span><span class="playback-device-status">Ready</span></button>';
      document.querySelector('#spotifyHistoryDelete').hidden = false;
    });
    for (const [label, selector] of [
      ['retry player', '#playbackHealthRetry'],
      ['refresh devices', '#playbackDeviceLoad'],
      ['device choice', '#playbackDeviceList .playback-device']
    ]) {
      const control = page.locator(selector);
      await control.hover();
      const style = await control.evaluate(node => {
        const css = getComputedStyle(node);
        return { background: css.backgroundColor, color: css.color, radius: css.borderRadius, height: node.getBoundingClientRect().height };
      });
      assert.equal(style.background, hoverSurface, `${label} uses the shared hover surface`);
      assert.equal(style.color, lime, `${label} uses the shared hover text`);
      assert.equal(style.radius, '4px', `${label} uses the shared corner shape`);
      assert.ok(style.height >= 36, `${label} keeps a usable hit area`);
    }
    await page.locator('#playbackHealthPanel').evaluate(panel => { panel.hidden = true; });

    for (const [label, selector] of [
      ['delete recorded counts', '#spotifyHistoryDelete'],
      ['clear local RCRD data', '#clearLocalAccountData']
    ]) {
      const control = page.locator(selector);
      const before = await control.boundingBox();
      await control.hover();
      const after = await control.boundingBox();
      assert.ok(before.height >= 40, `${label} has the intended button height`);
      assert.equal(after.width, before.width, `${label} does not change width on hover`);
      assert.equal(after.height, before.height, `${label} does not change height on hover`);
      assert.equal(await control.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(55, 39, 34)', `${label} retains red caution hover`);
    }

    await page.locator('#clearLocalAccountData').hover();
    assert.equal(await page.locator('#clearLocalAccountData').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(55, 39, 34)', 'destructive actions retain a red warning hover');
    await page.locator('#startAmbientVisualizer').hover();
    assert.notEqual(await page.locator('#startAmbientVisualizer').evaluate(node => getComputedStyle(node).backgroundColor), hoverSurface, 'disabled actions do not highlight');
    await page.locator('#lyricsDialog').evaluate(dialog => dialog.showModal());
    const lyricsCredit = page.locator('.lyrics-credit a');
    assert.equal(await lyricsCredit.evaluate(node => getComputedStyle(node).color), 'rgb(164, 174, 167)', 'Genius credit uses the subdued dialog text color');
    await lyricsCredit.hover();
    assert.equal(await lyricsCredit.evaluate(node => getComputedStyle(node).color), lime, 'Genius credit highlights on hover');
    await page.mouse.move(0, 0);
    await lyricsCredit.focus();
    assert.equal(await lyricsCredit.evaluate(node => getComputedStyle(node).color), lime, 'Genius credit highlights for keyboard focus');
    await page.locator('#lyricsDialog').evaluate(dialog => dialog.close());
    await page.setViewportSize({ width: 600, height: 900 });
    const narrowGuide = await page.locator('#guide-optional-features').evaluate(node => ({ columns: getComputedStyle(node).columnCount, client: node.clientWidth, scroll: node.scrollWidth }));
    assert.equal(narrowGuide.columns, '1', 'optional guidance stacks into one column on narrow screens');
    assert.ok(narrowGuide.scroll <= narrowGuide.client + 1, 'optional guidance does not overflow horizontally');
    await page.locator('.mobile-profile-menu').evaluate(menu => { menu.open = true; });
    await page.locator('.mobile-profile-menu a[data-view="settings"]').hover();
    assert.equal(await page.locator('.mobile-profile-menu a[data-view="settings"]').evaluate(node => getComputedStyle(node).backgroundColor), hoverSurface, 'the mobile Settings menu uses the same hover surface');
    assert.deepEqual(errors, [], 'synthetic browser interaction audit has no page errors');
    if (process.env.RCRD_THEME_CAPTURE) await page.screenshot({ path: process.env.RCRD_THEME_CAPTURE });
    await context.close();
    console.log('Shared interaction styling passed across navigation, guide, menus, controls, Settings, and track bar.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
