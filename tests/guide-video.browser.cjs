// Optional browser regression: local synthetic fixture only, no account or provider data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.RCRD_PLAYWRIGHT_MODULE || 'playwright');
const { createFixture, ORIGIN } = require('../walkthrough/source/demo-fixture.cjs');

(async () => {
  const fixture = createFixture(path.resolve(__dirname, '..'), { fontManifest: {} });
  const browser = await chromium.launch({ headless: true, ...(process.env.RCRD_CHROME_PATH ? { executablePath: process.env.RCRD_CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(fixture.sdkInstaller, fixture.initial);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)
        ? route.fulfill({ contentType: 'text/css', body: '' }) : fixture.route(route);
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    await page.locator('.sidebar .profile-menu summary').click();
    await page.locator('.sidebar .profile-menu a[data-view="guide"]').click();
    assert.equal(await page.locator('#guide').evaluate(element => element.classList.contains('active-view')), true);
    assert.equal(await page.locator('.guide-video-details').evaluate(element => element.open), false);
    await page.locator('.guide-toc a[href="#guide-video"]').click();
    assert.equal(await page.locator('#guide-video').evaluate(element => element.getBoundingClientRect().top < innerHeight), true);
    await page.locator('.guide-video-details summary').click();
    assert.equal(await page.locator('.guide-video-details').evaluate(element => element.open), true);
    const video = await page.locator('.guide-video-details video').evaluate(element => ({
      src: new URL(element.currentSrc || element.src).pathname,
      preload: element.preload,
      controls: element.controls,
      width: element.getBoundingClientRect().width,
      parentWidth: element.parentElement.getBoundingClientRect().width
    }));
    assert.equal(video.src, '/walkthrough/RCRD-complete-walkthrough.mp4');
    assert.equal(video.preload, 'none');
    assert.equal(video.controls, true);
    assert.ok(video.width > 600 && video.width <= video.parentWidth + 1);
    await page.setViewportSize({ width: 600, height: 900 });
    const narrow = await page.locator('.guide-video-details video').evaluate(element => element.getBoundingClientRect().toJSON());
    assert.ok(narrow.x >= 0 && narrow.right <= 600, 'video fits a narrow viewport');
    assert.equal(await page.locator('.guide-video-transcript a').getAttribute('href'), '/walkthrough/RCRD-complete-walkthrough-transcript.md');
    assert.deepEqual(errors, []);
    fixture.assertClean();
    await context.close();
    console.log('Guide video disclosure and responsive layout passed with a synthetic account.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
