// Synthetic release regression. The fixture never opens a real account or local server.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { createFixture, ORIGIN } = require('../walkthrough/source/demo-fixture.cjs');

(async () => {
  const fixture = createFixture(path.resolve(__dirname, '..'), { fontManifest: {} });
  const browser = await chromium.launch({ headless: true, ...(process.env.RCRD_CHROME_PATH ? { executablePath: process.env.RCRD_CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const playbackActions = [];
    let updateAvailable = true, installAttempts = 0, editPermissionDenied = false;
    await context.addInitScript(fixture.sdkInstaller, fixture.initial);
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.pathname === '/api/update-check') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ currentVersion: '1.3.43', latestVersion: '1.3.44', updateAvailable, installAvailable: updateAvailable, releaseUrl: 'https://github.com/x-drybk/rcrd/releases/tag/v1.3.44' }) });
      if (url.pathname === '/api/update-install') { installAttempts++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic update helper unavailable.' }) }); }
      if (url.pathname === '/api/spotify/playlist/edit' && editPermissionDenied) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Allow RCRD to edit public Spotify playlists. Playback is already connected.', needsSpotifyAuthorization: true }) });
      if (url.pathname === '/api/spotify/playback' && request.method() === 'POST') playbackActions.push(request.postDataJSON().action);
      return fixture.route(route);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    await page.waitForFunction(() => spotifyConnected && Boolean(spotifyDeviceId));

    await page.locator('#previousButton').click();
    await page.waitForFunction(() => document.querySelector('#previousButton').getAttribute('aria-busy') === 'false');
    await page.locator('#previousButton').click();
    await page.waitForFunction(() => document.querySelector('#previousButton').getAttribute('aria-busy') === 'false');
    assert.deepEqual(playbackActions.slice(0, 2), ['seek', 'previous'], 'Previous restarts after 15 seconds, then skips on the next press');

    await page.locator('.profile-menu:not(.mobile-profile-menu) .profile-menu-trigger').click();
    await page.locator('.profile-menu:not(.mobile-profile-menu) [data-profile-action="about"]').click();
    assert.equal(await page.locator('#aboutDialog').evaluate(dialog => dialog.open), true);
    await page.locator('#aboutDialog [data-check-updates]').click();
    await page.locator('#updateDialogTitle').getByText('RCRD 1.3.44 is available').waitFor();
    assert.equal(await page.locator('#updateInstallButton').isVisible(), true, 'verified release offers installation');
    assert.equal(await page.locator('#updateReleaseLink').getAttribute('href'), 'https://github.com/x-drybk/rcrd/releases/tag/v1.3.44');
    await page.locator('#updateInstallButton').click();
    await page.locator('#updateDialogTitle').getByText('Update could not finish').waitFor();
    assert.equal(installAttempts, 1, 'install action reaches the local update endpoint');
    assert.match(await page.locator('#updateDialogMessage').textContent(), /Synthetic update helper unavailable/);
    await page.locator('#updateDialogClose').click();
    assert.equal(await page.locator('#updateDialog').evaluate(dialog => dialog.open), false);
    updateAvailable = false;
    await page.locator('#aboutDialog [data-check-updates]').click();
    await page.locator('#updateDialogTitle').getByText('RCRD is up to date').waitFor();
    assert.equal(await page.locator('#updateInstallButton').isVisible(), false);
    await page.locator('#updateDialogClose').click();
    await page.locator('#aboutDialogClose').click();

    await page.evaluate(() => document.querySelector('[data-view="spotify"]').click());
    await page.locator('#sidebarPlaylistTrigger').click();
    await page.locator('#sidebarPlaylistList [data-playlist-id="0000000000000000000800"]').click();
    await page.locator('#spotifyEditPlaylist').click();
    assert.equal(await page.locator('#spotifyEditPlaylistName').inputValue(), 'Morning records');
    await page.locator('#spotifyEditPlaylistName').fill('Afternoon records');
    await page.locator('#spotifyEditPlaylistNameForm button').click();
    await page.waitForFunction(() => document.querySelector('#spotifyEditPlaylistStatus').textContent.includes('Renamed to Afternoon records'));
    await page.locator('#spotifyEditPlaylistSearch').fill('Blue Hour');
    await page.locator('#spotifyEditPlaylistResults .playlist-song-add:not(:disabled)').first().waitFor();
    await page.locator('#spotifyEditPlaylistResults .playlist-song-add:not(:disabled)').first().click();
    await page.waitForFunction(() => document.querySelector('#spotifyEditPlaylistCount').textContent === '21 songs');
    const addedUri = await page.locator('#spotifyEditPlaylistSongs .playlist-song-remove').last().getAttribute('data-uri');
    await page.locator(`#spotifyEditPlaylistSongs .playlist-song-remove[data-uri="${addedUri}"]`).first().click();
    await page.locator(`#spotifyEditPlaylistSongs .playlist-song-remove[data-uri="${addedUri}"]`).first().click();
    await page.waitForFunction(() => document.querySelector('#spotifyEditPlaylistCount').textContent === '20 songs');
    await page.waitForFunction(() => document.querySelector('#sidebarPlaylistValue').textContent === 'Afternoon records (20)');
    assert.match(await page.locator('#sidebarPlaylistValue').textContent(), /Afternoon records \(20\)/);
    await page.locator('#spotifyEditPlaylistClose').click();
    editPermissionDenied = true;
    await page.locator('#spotifyEditPlaylist').click();
    await page.locator('#spotifyEditPlaylistPermission button').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#spotifyEditPlaylistAuthorize').textContent(), 'Allow playlist editing');
    assert.match(await page.locator('#spotifyEditPlaylistPermission p').textContent(), /Playback is already connected/);
    assert.equal(await page.locator('#spotifyEditPlaylistNameForm').isVisible(), false, 'editor controls wait for Spotify approval');
    if (process.env.RCRD_PERMISSION_CAPTURE) await page.screenshot({ path: process.env.RCRD_PERMISSION_CAPTURE });
    await page.locator('#spotifyEditPlaylistClose').click();
    editPermissionDenied = false;
    await page.locator('#spotifyEditPlaylist').click();
    await page.locator('#spotifyEditPlaylistSongs .playlist-song-row').first().waitFor();
    await page.setViewportSize({ width: 360, height: 780 });
    const editor = await page.locator('#spotifyEditPlaylistDialog').boundingBox();
    assert.ok(editor.x >= 0 && editor.x + editor.width <= 361, 'playlist editor fits a narrow phone');
    if (process.env.RCRD_EDITOR_CAPTURE) await page.screenshot({ path: process.env.RCRD_EDITOR_CAPTURE });
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.evaluate(() => {
      spotifyLibraryTracks = [{ uri: 'spotify:track:stale', title: 'Old account track' }];
      spotifyLibraryLoaded = true;
      spotifyPlayCountFetchedAt.set('spotify:track:stale', Date.now());
    });
    fixture.setAccount('second-listener');
    await page.evaluate(() => refreshSpotifyStatus());
    await page.waitForFunction(() => spotifyAccountMarker === 'second-listener' && document.querySelector('#profileName').textContent === 'Second listener');
    const account = await page.evaluate(() => ({ generation: spotifyAccountGeneration, staleTrack: spotifyLibraryTracks.some(track => track.uri === 'spotify:track:stale'), stalePlayCount: spotifyPlayCountFetchedAt.has('spotify:track:stale') }));
    assert.ok(account.generation > 0, 'account change invalidates the previous generation');
    assert.equal(account.staleTrack, false, 'old account library is cleared');
    assert.equal(account.stalePlayCount, false, 'old account play counts are cleared');
    assert.equal(await page.locator('#spotifyEditPlaylistDialog').evaluate(dialog => dialog.open), false, 'account change closes the previous account playlist editor');

    await page.setViewportSize({ width: 360, height: 780 });
    for (const view of ['spotify', 'collection', 'wantlist']) {
      await page.evaluate(name => document.querySelector(`[data-view="${name}"]`).click(), view);
      const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1, `${view} has no horizontal page overflow on a narrow phone`);
    }
    await page.evaluate(() => document.querySelector('[data-view="spotify"]').click());
    await page.locator('#spotifyCreatePlaylist').click();
    assert.equal(await page.locator('#spotifyCreatePlaylistDialog').evaluate(dialog => dialog.open), true);
    await page.locator('#spotifyCreatePlaylistClose').click();
    assert.equal(await page.locator('#spotifyCreatePlaylistDialog').evaluate(dialog => dialog.open), false);
    assert.deepEqual(errors, [], 'release flows raise no browser exceptions');
    fixture.assertClean();
    assert.ok(fixture.blocked.every(origin => origin === 'https://sdk.scdn.co'), 'only the fixture-provided Spotify SDK is referenced externally');
    console.log('Synthetic release browser flows passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
