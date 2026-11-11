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
    const open = async () => {
      await page.locator('.sidebar .profile-menu summary').click();
      await page.locator('.sidebar [data-profile-action="about"]').click();
      assert.equal(await page.locator('#aboutDialog').evaluate(dialog => dialog.open), true);
    };
    await open();
    await page.locator('#aboutDialogContent').click();
    assert.equal(await page.locator('#aboutDialog').evaluate(dialog => dialog.open), true, 'content click leaves About open');
    await page.mouse.click(10, 10);
    assert.equal(await page.locator('#aboutDialog').evaluate(dialog => dialog.open), false, 'backdrop click closes About');
    await open();
    await page.locator('#aboutDialogClose').click();
    assert.equal(await page.locator('#aboutDialog').evaluate(dialog => dialog.open), false, 'close button still works');
    assert.deepEqual(errors, []);
    fixture.assertClean();
    await context.close();
    console.log('About dialog backdrop and close button passed with a synthetic account.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
