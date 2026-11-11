const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'distinction.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const issueTemplateRoot = path.join(root, '.github', 'ISSUE_TEMPLATE');
const bugForm = fs.readFileSync(path.join(issueTemplateRoot, 'bug_report.yml'), 'utf8');
const ideaForm = fs.readFileSync(path.join(issueTemplateRoot, 'feature_request.yml'), 'utf8');
const issueConfig = fs.readFileSync(path.join(issueTemplateRoot, 'config.yml'), 'utf8');

test('Listening hero uses the requested supporting copy', () => {
  assert.match(page, /<h1>Hear it\.<br \/><i>Then<\/i> find it\.<\/h1><p class="hero-copy">Let listening lead the way\. Discover records worth keeping, then find the edition that belongs in your collection\.<\/p>/);
  assert.doesNotMatch(page, /Your listening informs discovery\. When a record sticks/);
  assert.match(css, /@media\(min-width:1051px\)\{\.hero\{grid-template-columns:minmax\(0,\.8fr\) minmax\(380px,1\.2fr\)\}\.hero-copy-panel \.hero-copy\{max-width:400px\}\}/);
});

test('About displays the package version and the requested creator credit', () => {
  const settings = page.match(/<section id="settings"[\s\S]*?<section id="guide"/)?.[0];
  assert.ok(settings);
  assert.match(settings, /Clear local RCRD data[\s\S]*<article class="settings-card about-settings" id="settingsAbout" tabindex="-1">[\s\S]*<\/article>\s*<\/div>\s*<\/section>\s*<section id="guide"/);
  assert.match(css, /\.about-settings\{grid-column:1\/-1\}/);
  assert.match(page, /id="rcrdVersion"/);
  assert.match(page, /Created in 2026 by Kevin M\. Byrd with ChatGPT\./);
  assert.match(settings, /A home to listen, discover, and collect what matters\./);
  assert.match(settings, /<p class="about-feedback"><a href="https:\/\/github\.com\/x-drybk\/rcrd\/issues\/new\/choose" target="_blank" rel="noopener noreferrer">Send feedback on GitHub ↗<\/a>/);
  assert.match(settings, /Reports are public; never include credentials, account data, or listening-history files\./);
  assert.match(css, /\.provider-credits a,\.about-feedback a,\.about-feedback a:visited\{color:var\(--lime\)\}/);
  assert.match(settings, /<p class="about-disclaimer">RCRD is a personal, non-commercial project and is not intended for sale or profit\. It uses provider APIs with your authorization where required\./);
  assert.match(settings, /not affiliated with, sponsored or endorsed by Spotify, Genius, MusicBrainz or ListenBrainz/);
  assert.match(settings, /This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs\. ‘Discogs’ is a trademark of Zink Media, LLC\./);
  for (const service of ['MusicBrainz', 'ListenBrainz', 'Spotify', 'Discogs', 'Genius']) assert.match(settings, new RegExp(`<a href="https:\/\/[^\"]+"[^>]*>${service}<\\/a>`));
  assert.match(css, /\.about-settings \.about-disclaimer\{[^}]*border-top:1px solid var\(--line\);[^}]*font-style:italic/);
  assert.doesNotMatch(page, /A local-first space for listening, discovery, and collecting\./);
  assert.match(script, /fetch\('\/api\/health',\{cache:'no-store'\}\)/);
  assert.match(server, /version: appVersion/);
});

test('public feedback uses structured GitHub forms with privacy safeguards', () => {
  for (const form of [bugForm, ideaForm]) {
    assert.match(form, /  - user-feedback/);
    assert.match(form, /GitHub issues are public\./);
    assert.match(form, /Do not include `\.env` or `\.data` contents, credentials, tokens, session details, Spotify history exports, personal listening history, or other private information\./);
    assert.match(form, /id: privacy[\s\S]*required: true/);
  }
  assert.match(bugForm, /id: version[\s\S]*id: problem[\s\S]*id: steps[\s\S]*id: area/);
  assert.match(ideaForm, /id: problem[\s\S]*id: proposal[\s\S]*id: alternatives/);
  assert.match(issueConfig, /^blank_issues_enabled: false/m);
  assert.match(issueConfig, /url: https:\/\/github\.com\/x-drybk\/rcrd#readme/);
});

test('current version is sourced from package metadata and used by the default Discogs agent', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(server, /userAgent: process\.env\.DISCOGS_USER_AGENT \|\| `RCRD\/\$\{appVersion\}`/);
  assert.match(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), new RegExp(`DISCOGS_USER_AGENT=RCRD/${version.replaceAll('.', '\\.')} `));
});

test('each requested library view has a themed manual refresh action', () => {
  for (const id of ['homeRefresh', 'spotifyLibraryRefresh', 'collectionRefresh', 'wantlistRefresh']) assert.match(page, new RegExp(`id="${id}"`));
  for (const [view, sort, refresh] of [['collection', 'collectionSortDirection', 'collectionRefresh'], ['wantlist', 'wantlistSortDirection', 'wantlistRefresh']]) {
    const controls = page.match(new RegExp(`<section id="${view}"[\\s\\S]*?<div class="toolbar-refresh-actions">([\\s\\S]*?)<\\/div>`))?.[1] || '';
    assert.ok(controls.indexOf(`id="${sort}"`) < controls.indexOf(`id="${refresh}"`) && controls.includes(`id="${sort}"`) && controls.includes(`id="${refresh}"`), `${view} refresh follows sorting`);
  }
  for (const label of ['Refresh listening recommendations', 'Refresh saved music', 'Refresh Discogs collection', 'Refresh Discogs wantlist']) assert.match(page, new RegExp(`aria-label="${label}" title="${label}">↻<\\/button>`));
  assert.match(page, /class="home-heading-row"><h2 id="homeDiscoveryTitle">For your ears<\/h2><button[^>]+id="homeRefresh"/);
  assert.doesNotMatch(page, /id="homeRefresh"[^>]*>↻ Refresh/);
  assert.match(css, /\.manual-refresh:hover,\.manual-refresh:focus-visible/);
  assert.match(css, /\.manual-refresh\[aria-busy="true"\]/);
  assert.match(css, /\.home-heading-row \.manual-refresh\{[^}]*border:0;[^}]*font-size:15px\}/);
  assert.match(css, /\.home-heading-row \.manual-refresh:focus-visible\{[^}]*outline:2px solid var\(--lime\)/);
  assert.match(css, /\.section-title-actions \.text-button\{[^}]*display:inline-flex;align-items:center;[^}]*line-height:1/);
  assert.match(css, /\.section-title-actions \.text-button span\{[^}]*line-height:1/);
  assert.match(script, /refreshSpotifyHome\(true\)/);
  assert.match(script, /refreshSpotifyLibrary\(true\)/);
  assert.match(script, /refreshDiscogsSection\(section,true\)/);
});

test('play-count explanation and check status stay inside the accessible Plays disclosure', () => {
  assert.match(page, /<div class="library-controls"><div class="play-count-info-row" id="spotifyPlayCountInfo" hidden><details class="play-count-disclosure"><summary aria-label="About play counts" title="About play counts">Plays<span class="play-count-help-icon" aria-hidden="true">i<\/span><\/summary>/);
  assert.match(page, /<\/details><\/div><button class="library-layout active" data-layout="grid">Grid<\/button>/);
  assert.match(page, /id="spotifyPlayCountNote">Plays combine your imported Spotify history/);
  assert.match(page, /id="spotifyPlayCountNote"[^>]*>[^<]*<\/p><span class="cache-meta" id="spotifyPlayCountChecked" role="status" aria-live="polite">Play counts not checked yet\.<\/span><\/div><\/details>/);
  assert.match(script, /querySelector\('#spotifyPlayCountInfo'\)\.hidden=!visible\.some\(record=>record\.kind==='track'\)/);
  assert.match(script, /if\(!onHome\)\{[^}]*document\.querySelector\('#spotifyPlayCountInfo'\)\.hidden=true\}/);
  assert.match(css, /\.play-count-info-row\[hidden\]\{display:none\}/);
  assert.match(css, /\.play-count-disclosure summary\{[^}]*height:32px;[^}]*font:500 10px/);
  assert.match(css, /\.play-count-disclosure summary\{[^}]*gap:5px;[^}]*cursor:pointer\}/);
  assert.match(css, /\.play-count-help-icon\{[^}]*width:13px;height:13px;border:1px solid currentColor;border-radius:50%;/);
  assert.match(css, /\.play-count-disclosure summary::marker\{content:''\}/);
  assert.match(css, /\.play-count-disclosure summary:focus-visible\{outline:2px solid var\(--lime\)/);
});

test('Discogs list-size controls match the shared theme and keep refresh last', () => {
  for (const [view, id, refresh] of [['collection', 'collectionPageSize', 'collectionRefresh'], ['wantlist', 'wantlistPageSize', 'wantlistRefresh']]) {
    const controls = page.match(new RegExp(`<section id="${view}"[\\s\\S]*?<div class="toolbar-refresh-actions">([\\s\\S]*?)<\\/div>`))?.[1] || '';
    assert.ok(controls.includes(`class="result-sort page-size-control"`) && controls.indexOf(`id="${id}"`) < controls.indexOf(`id="${refresh}"`));
    assert.match(script, new RegExp(`'${id}'`));
  }
  assert.match(css, /\.page-size-control \.themed-select\{min-width:70px\}/);
});

test('Settings opens a local guide and offers a return path', () => {
  const settings = page.match(/<section id="settings"[\s\S]*?<section id="guide"/)?.[0];
  assert.ok(settings, 'Settings and guide views exist');
  assert.match(settings, /<div class="page-heading"><h1>Settings<\/h1><\/div>/);
  assert.doesNotMatch(settings, /LOCAL ADMIN/);
  assert.doesNotMatch(settings, /CREDENTIAL SOURCE|discogsCredentialSource|spotifyCredentialSource/);
  assert.match(settings, /href="#guide" data-view="guide"/);
  assert.match(page, /<section id="guide" class="view guide-view" aria-labelledby="guideTitle">/);
  assert.match(page, /href="#settings" data-view="settings">← Settings<\/a>/);
  assert.match(script, /document\.querySelector\('\.search'\)\.hidden=\['guide','settings'\]\.includes\(view\)/);
  assert.match(css, /\.search\[hidden\]\{display:none\}/);
  assert.match(css, /\.guide-content\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:18px\}/);
  assert.match(css, /#guide-listening,#guide-collecting,#guide-optional-features,#guide-settings\{column-count:2;column-gap:28px\}/);
  assert.match(css, /@media\(max-width:760px\)\{#guide-listening,#guide-collecting,#guide-optional-features,#guide-settings\{column-count:1\}\}/);
});

test('guide offers a local, opt-in video walkthrough with a readable transcript', () => {
  assert.match(page, /href="#guide-video">Watch walkthrough<\/a>/);
  assert.match(page, /<section class="guide-block guide-video-block" id="guide-video">/);
  assert.match(page, /<details class="guide-video-details"><summary>Watch the complete walkthrough<\/summary><video controls preload="none" playsinline aria-label="RCRD complete video walkthrough" src="\/walkthrough\/RCRD-complete-walkthrough\.mp4">/);
  assert.match(page, /href="\/walkthrough\/RCRD-complete-walkthrough-transcript\.md"/);
  assert.match(css, /\.guide-video-details video\{display:block;width:100%;max-height:70vh;aspect-ratio:16\/9/);
  assert.match(server, /\['walkthrough\/RCRD-complete-walkthrough\.mp4', 'video\/mp4'\]/);
});

test('clear-data action uses Settings button typography and retains its warning treatment', () => {
  assert.match(page, /class="secondary-action danger-action clear-local-data" id="clearLocalAccountData"/);
  assert.match(css, /\.clear-local-data\{[^}]*border:1px solid #9a605b;[^}]*font-size:12px;font-weight:600\}/);
  assert.match(css, /\.danger-action\{color:#ff9f91!important\}/);
  assert.match(css, /\.clear-local-data:hover,\.clear-local-data:focus-visible\{[^}]*border-color:#ff9f91\}/);
});

test('guide covers setup, workflows, account management, and recovery without exposing the admin file', () => {
  for (const id of ['setup', 'listening', 'collecting', 'optional-features', 'settings', 'troubleshooting']) {
    assert.match(page, new RegExp(`href="#guide-${id}"`));
    assert.match(page, new RegExp(`class="guide-block" id="guide-${id}"`));
  }
  assert.match(page, /Never share or paste your <code>\.env<\/code> file/);
  assert.match(page, /Click the speaker icon to mute or restore the previous volume/);
  assert.doesNotMatch(page, /href="[^"]*ADMIN_GUIDE\.md"/);
  assert.doesNotMatch(server, /\['ADMIN_GUIDE\.md',\s*'text\//);
});

test('first-run guide links only to publisher downloads and provider setup pages', () => {
  const setup = page.match(/<section class="guide-block" id="guide-setup">([\s\S]*?)<section class="guide-block" id="guide-listening">/)?.[1];
  assert.ok(setup);
  const links = [...setup.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">/g)].map(match => match[1]);
  assert.deepEqual(links, [
    'https://nodejs.org/en/download',
    'https://www.google.com/chrome/',
    'https://developer.spotify.com/dashboard',
    'https://developer.spotify.com/documentation/web-api/concepts/apps',
    'https://www.discogs.com/settings/developers',
    'https://support.discogs.com/hc/en-us/articles/360007423833-How-Do-I-Change-My-Account-Settings'
  ]);
  assert.match(setup, /SPOTIFY_CLIENT_ID/);
  assert.match(setup, /DISCOGS_CONSUMER_KEY/);
  assert.match(setup, /http:\/\/127\.0\.0\.1:3000\/auth\/spotify\/callback/);
  assert.match(setup, /http:\/\/127\.0\.0\.1:3000\/auth\/discogs\/callback/);
  assert.match(setup, /Double-click <strong>Launch RCRD\.cmd<\/strong> to open RCRD/);
  assert.match(setup, /taskbar shortcut if you have pinned one yourself/);
  assert.match(setup, /Settings → Restart RCRD/);
  assert.doesNotMatch(setup, /(?:client_secret|consumer_secret)=[^<\s]+/i);
});

test('pre-launch documentation offers the same official setup destinations', () => {
  const links = [
    'https://nodejs.org/en/download', 'https://www.google.com/chrome/',
    'https://developer.spotify.com/dashboard', 'https://developer.spotify.com/documentation/web-api/concepts/apps',
    'https://www.discogs.com/settings/developers',
    'https://support.discogs.com/hc/en-us/articles/360007423833-How-Do-I-Change-My-Account-Settings'
  ];
  for (const file of ['README.md', 'SHARE_README.md']) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const link of links) assert.ok(content.includes(link), `${file} includes ${link}`);
    assert.match(content, /Never (?:send|share|publish).*\.env|do not publish or share them/i);
  }
  const launcher = fs.readFileSync(path.join(root, 'Launch RCRD.vbs'), 'utf8');
  assert.match(launcher, /Open README\.md for official download and first-run setup links/);
});

test('root README directs new users to setup and the bundled admin guide', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const shareReadme = fs.readFileSync(path.join(root, 'SHARE_README.md'), 'utf8');
  assert.match(readme, /^# RCRD — Start here/m);
  assert.match(readme, /\[first-time setup\]\(#first-time-setup\)/);
  assert.match(readme, /^## First-time setup$/m);
  for (const content of [readme, shareReadme]) {
    assert.match(content, /\[Admin Guide\]\(ADMIN_GUIDE\.md\)/);
    assert.match(content, /\[Security Note\]\(SECURITY\.md\)/);
  }
  for (const file of ['ADMIN_GUIDE.md', 'SECURITY.md']) {
    assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} exists beside the README`);
  }
});

test('optional Genius lyrics have attribution and privacy guidance in app and packaged documentation', () => {
  assert.match(page, /Lyrics displayed by <a href="https:\/\/genius\.com\/"[^>]*>Genius<\/a>\. RCRD is not affiliated with Genius and does not store lyric text/);
  const optional = page.match(/id="guide-optional-features"([\s\S]*?)<\/section>/)?.[1] || '';
  for (const feature of ['Long-term favorites', 'RCRD Mix', 'Recorded play counts', 'Lyrics', 'Ambient visualizer']) assert.match(optional, new RegExp(feature));
  assert.match(optional, /Genius may receive your IP address/);
  for (const file of ['README.md', 'SHARE_README.md', 'ADMIN_GUIDE.md', 'SECURITY.md']) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(content, /Genius/, `${file} explains optional Genius lyrics`);
    assert.match(content, /GENIUS_ACCESS_TOKEN/, `${file} names the private token setting`);
  }
  assert.match(fs.readFileSync(path.join(root, 'SHARE_README.md'), 'utf8'), /not affiliated with Genius/);
});
