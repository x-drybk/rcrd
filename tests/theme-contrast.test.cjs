const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const css = ['styles.css', 'distinction.css']
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.split(',').map(value => value.trim()),
  declarations: Object.fromEntries(body.split(';').map(value => {
    const colon = value.indexOf(':');
    return colon < 0 ? null : [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
  }).filter(Boolean))
}));

function property(selector, name) {
  let value;
  for (const rule of rules) {
    if (rule.selectors.includes(selector) && rule.declarations[name]) value = rule.declarations[name];
  }
  assert.ok(value, `${selector} defines ${name}`);
  return value.replace(/\s*!important\s*$/, '').trim();
}

function color(value) {
  let resolved = value;
  for (let depth = 0; depth < 8 && /^var\(--[\w-]+\)$/.test(resolved); depth++) {
    resolved = property(':root', resolved.slice(4, -1));
  }
  if (resolved === 'white') resolved = '#ffffff';
  if (resolved === 'black') resolved = '#000000';
  if (/^#[\da-f]{3}$/i.test(resolved)) resolved = `#${[...resolved.slice(1)].map(digit => digit.repeat(2)).join('')}`;
  assert.match(resolved, /^#[\da-f]{6}$/i, `A solid color was expected, got ${resolved}`);
  return resolved;
}

function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground, background) {
  const a = luminance(color(foreground));
  const b = luminance(color(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function expectContrast(label, foregroundSelector, backgroundSelector, minimum = 4.5) {
  const foreground = property(foregroundSelector, 'color');
  const background = backgroundSelector.startsWith('#')
    ? backgroundSelector
    : property(backgroundSelector, 'background');
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= minimum, `${label}: ${ratio.toFixed(2)}:1 is below ${minimum}:1`);
}

test('browser app frame uses the same dark color as the page', () => {
  const pageTheme = page.match(/<meta name="theme-color" content="([^"]+)"\s*\/>/)?.[1];
  assert.ok(pageTheme, 'page advertises a browser theme color');
  assert.equal(color(pageTheme), color(property('body', 'background')));
  assert.equal(color(manifest.theme_color), color(pageTheme));
});

test('Settings grid uses the available width and keeps its compact layout', () => {
  assert.match(css, /\.settings-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:18px\}/);
  assert.doesNotMatch(css, /\.settings-grid\{[^}]*max-width:/);
  assert.match(css, /@media\(max-width:620px\)\{\.settings-grid\{grid-template-columns:1fr\}/);
  assert.equal(property('.settings-grid .guide-entry', 'grid-column'), '1/-1');
  assert.equal(property('.account-settings', 'grid-column'), '1/-1');
  assert.match(css, /\.account-settings-layout\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:760px\)\{\.account-settings-layout\{grid-template-columns:1fr\}/);
  assert.equal(property('.account-settings-layout .settings-help', 'font-size'), '12px');
  assert.equal(property('.account-settings-layout .settings-help', 'line-height'), '1.5');
  assert.equal(property('.account-settings-layout .settings-help', 'color'), 'var(--muted)');
  assert.equal(property('.ambient-settings', 'min-width'), '0');
  assert.equal(property('.history-settings', 'grid-column'), '1/-1');
  const settings = page.match(/<section id="settings"[\s\S]*?<section id="guide"/)?.[0] || '';
  const positions = ['RCRD guide', 'Account access', 'Optional features', 'Ambient visualizer', '<h2>Lyrics</h2>', 'Your listening history', 'Restart RCRD', 'Clear RCRD data', '<p class="eyebrow">ABOUT</p>'].map(label => settings.indexOf(label));
  assert.ok(positions.every(position => position >= 0));
  assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]), 'Settings groups optional features together and keeps About last');
  assert.match(settings, /class="lyrics-settings"|class="settings-card lyrics-settings"/);
  assert.match(settings, /id="spotifyHistoryImport"/);
  assert.match(settings, /GENIUS_ACCESS_TOKEN/);
  assert.match(settings, /Genius API clients/);
  const guide = page.split('<section id="guide"')[1] || '';
  assert.doesNotMatch(guide, /<h2>Optional lyrics<\/h2>|GENIUS_ACCESS_TOKEN/, 'lyrics setup is not duplicated in the guide');
  assert.equal(property('.settings-section-heading', 'grid-column'), '1/-1');
});

test('listening history has a compact themed scroll area and matching destructive action', () => {
  assert.match(page, /class="secondary-action danger-action history-delete" id="spotifyHistoryDelete"/);
  assert.match(page, /id="spotifyHistoryTracks"[^>]*tabindex="0"/);
  assert.equal(property('.history-top-tracks', 'max-height'), '336px');
  assert.equal(property('.history-top-tracks', 'overflow-y'), 'auto');
  assert.equal(property('.history-top-tracks li', 'min-height'), '56px');
  assert.equal(property('.history-delete', 'font'), "600 12px 'DM Sans',sans-serif");
  assert.equal(property('.history-delete', 'border'), property('.clear-local-data', 'border'));
});

test('player health and quick actions share a row and hide retry until needed', () => {
  assert.equal(property('.player-actions', 'flex-direction'), 'row');
  assert.equal(property('.player-quick-actions', 'display'), 'flex');
  assert.equal(property('.player-actions button.playback-health-retry[hidden]', 'display'), 'none');
  assert.equal(property('.toast', 'pointer-events'), 'none', 'a faded toast must not block Retry player');
  expectContrast('player health status', '.player-actions button.playback-health-toggle', '#0d1d15');
});

test('track-bar quick actions share one interaction style and consistent labels', () => {
  const actions = page.split('<div class="player-quick-actions">')[1]?.split('<button type="button" class="ambient-visualizer"')[0] || '';
  for (const id of ['playerLiked', 'playerLyrics', 'playerMix', 'playerVisualizer', 'playerDiscogs', 'volumeButton']) assert.match(actions, new RegExp(`id="${id}"`));
  assert.match(actions, /id="playerDiscogs"[^>]*>Discogs<\/button>/);
  assert.doesNotMatch(actions, /Discogs ↗/);
  for (const selector of ['.player-actions .player-quick-actions>button', '.player-actions .volume-wrap>button', '.player-actions button.playback-health-toggle']) {
    assert.equal(property(selector, 'height'), '30px');
    assert.equal(property(selector, 'border-radius'), '4px');
  }
  assert.equal(property(':root', '--ui-hover-surface'), '#213c2b');
  for (const selector of ['.player-actions .player-quick-actions>button:hover:not(:disabled)', '.player-actions .volume-wrap>button:hover:not(:disabled)', '.player-actions button.playback-health-toggle:hover']) assert.equal(property(selector, 'background'), 'var(--ui-hover-surface)');
});

test('playback device choices override the compact track-bar button layout', () => {
  assert.equal(property('#playbackDeviceList', 'grid-template-columns'), 'minmax(0,1fr)');
  assert.equal(property('.player-actions button.playback-device', 'width'), '100%');
  assert.equal(property('.player-actions button.playback-device', 'display'), 'flex');
  assert.equal(property('.player-actions button.playback-device', 'text-align'), 'left');
  expectContrast('device name', '.player-actions button.playback-device', '.player-actions button.playback-device');
  expectContrast('device status', '.playback-device-status', '.player-actions button.playback-device');
});

test('shelf badges wrap within cards and occupy their own Spotify list row', () => {
  assert.equal(property('.shelf-badges', 'display'), 'flex');
  assert.equal(property('.shelf-badges', 'flex-wrap'), 'wrap');
  assert.equal(property('.shelf-badge', 'max-width'), '100%');
  assert.equal(property('.spotify-library-shell .list-view .shelf-badges', 'grid-column'), '1 / -1');
  assert.equal(property('.spotify-library-shell .list-view .shelf-badges', 'grid-row'), '4');
});

test('Saved music groups wantlist badges with the right-hand Discogs action', () => {
  assert.equal(property('.spotify-discogs-actions','display'),'flex');
  assert.equal(property('.spotify-library-shell .list-view .spotify-discogs-actions','grid-row'),'1 / span 3');
  assert.match(css,/\.spotify-library-shell \.list-view \.spotify-discogs-actions\{grid-column:5;/);
  assert.match(css,/@media\(min-width:621px\) and \(max-width:900px\)\{\.spotify-library-shell \.list-view \.spotify-discogs-actions\{grid-column:4/);
  assert.equal(property('.spotify-library-shell .spotify-discogs-actions .shelf-badges','margin'),'0');
  const badge='#spotify .spotify-discogs-actions .shelf-badge';
  const action='#spotify .spotify-discogs-actions>.spotify-discogs';
  for(const name of ['width','height','padding','font','box-sizing','justify-content'])assert.equal(property(badge,name),property(action,name),`stacked ${name} matches`);
  assert.equal(property(badge,'height'),'28px');
  assert.equal(property('.spotify-discogs-actions','width'),'120px');
});

test('Spotify track rows give album names and play counts separate list columns with narrow-screen fallbacks', () => {
  assert.equal(property('#spotify:has(#spotifyGrid.list-view)', 'max-width'), '1300px');
  assert.equal(property('.spotify-library-shell .list-view .album-card', 'min-height'), '82px');
  assert.equal(property('.spotify-library-shell .list-view .album-meta', 'column-gap'), '16px');
  assert.equal(property('.spotify-library-shell .list-view .album-meta', 'padding'), '0');
  assert.match(css, /\.spotify-library-shell \.list-view \.album-name\{grid-column:2;grid-row:1 \/ span 3;margin:0\}/);
  assert.match(css, /\.spotify-library-shell \.list-view \.play-count\{grid-column:3;grid-row:1 \/ span 3;margin:0\}/);
  assert.match(css, /\.spotify-library-shell \.list-view \.spotify-play-result\{grid-column:4;/);
  assert.match(css, /\.spotify-library-shell \.list-view \.spotify-discogs\{grid-column:5;/);
  assert.equal(property('.spotify-library-shell .list-view .album-meta .format', 'grid-column'), '1');
  assert.match(css, /@media\(max-width:900px\)\{\.spotify-library-shell \.list-view \.album-name\{grid-column:1;grid-row:3\}/);
  assert.match(css, /@media\(max-width:900px\)\{\.spotify-library-shell \.list-view \.album-name\{[^}]+\}\.spotify-library-shell \.list-view \.play-count\{grid-column:2;/);
  assert.match(css, /@media\(max-width:620px\)\{[^\n]*\.spotify-library-shell \.list-view \.album-meta\{display:block\}/);
});

test('clickable album titles retain metadata styling without a separate navigation grid cell', () => {
  assert.equal(property('.album-name .spotify-album-title','font'),'inherit');
  assert.equal(property('.album-name .spotify-album-title','background'),'none');
  assert.equal(property('.album-name .spotify-album-title','padding'),'0');
  assert.equal(property('.spotify-album-title:focus-visible','outline-offset'),'3px');
  assert.doesNotMatch(css,/\\.home-album-link/);
  assert.equal(property('.spotify-library-shell .spotify-list-header-columns', 'grid-template-columns'), property('.spotify-library-shell .list-view .album-card .album-meta', 'grid-template-columns'));
});

test('Saved Music list labels Title, Album and conditional Plays columns only when rows fit', () => {
  assert.match(page, /<div class="spotify-library-shell"><div class="spotify-list-header"><span class="spotify-list-header-spacer" aria-hidden="true"><\/span><div class="spotify-list-header-columns"><span>Title<\/span><span>Album<\/span><span class="spotify-list-plays-heading">Plays<\/span><\/div><\/div><div class="album-grid" id="spotifyGrid">/);
  assert.equal(property('.spotify-list-plays-heading', 'display'), 'none');
  assert.equal(property('.spotify-library-shell:has(#spotifyGrid.list-view .has-play-count) .spotify-list-plays-heading', 'grid-column'), '3');
  assert.equal(property('.spotify-library-shell .spotify-list-header-columns span:nth-child(2)', 'grid-column'), '2');
  assert.equal(property('.spotify-library-shell .list-view .album-name>span', 'display'), 'none');
  assert.equal(property('.spotify-library-shell .list-view .play-count>span', 'display'), 'none');
  assert.equal(property('.spotify-list-header', 'display'), 'none');
  assert.match(css, /@media\(min-width:901px\)\{\.spotify-library-shell:has\(#spotifyGrid\.list-view \.album-card\) \.spotify-list-header\{[^}]*display:grid;/);
  assert.match(css, /\.spotify-list-header-columns\{display:grid;grid-template-columns:minmax\(140px,1\.1fr\) minmax\(145px,\.9fr\) minmax\(86px,\.45fr\) auto auto 26px;column-gap:16px\}/);
  assert.match(css, /\.spotify-list-header-columns span:first-child\{grid-column:1\}\.spotify-list-header-columns span:last-child\{grid-column:2\}/);
});

test('play-count help shares the Saved Music toolbar and keeps its timestamp inside the disclosure', () => {
  assert.match(page, /<div class="library-controls"><div class="play-count-info-row" id="spotifyPlayCountInfo" hidden><details class="play-count-disclosure">/);
  assert.match(page, /<\/details><\/div><button class="library-layout active" data-layout="grid">Grid<\/button>/);
  assert.match(page, /id="spotifyPlayCountNote"[^>]*>[^<]*<\/p><span class="cache-meta" id="spotifyPlayCountChecked"/);
  assert.match(css, /\.play-count-info-row\{display:flex;align-items:center;margin-right:4px\}/);
  assert.match(css, /\.play-count-disclosure-content\{[^}]*left:0;/);
  assert.match(css, /\.play-count-disclosure summary\{[^}]*padding:0 8px;[^}]*color:var\(--muted\);/);
  assert.match(css, /\.play-count-disclosure summary:hover,\.play-count-disclosure summary:focus-visible,\.play-count-disclosure\[open\] summary\{color:var\(--lime\)\}/);
});

test('catalog album view hides result-only controls while retaining the shared album layout', () => {
  assert.match(css, /#spotify \.library-controls\[hidden\]\{display:none\}/);
  assert.match(css, /#spotify \.spotify-library-shell:has\(\.collection-lookup-results\)\{max-height:none;overflow:visible\}/);
  assert.match(css, /\.album-grid\.collection-lookup-results\{grid-template-columns:minmax\(0,1fr\)/);
});

test('browser and Windows app icons contain their advertised sizes', () => {
  const icon = manifest.icons.find(item => item.src === 'assets/rcrd-app-icon.png');
  assert.equal(icon?.sizes, '512x512');
  assert.match(page, /rel="icon"[^>]*href="assets\/rcrd-app-icon\.png"/);
  assert.match(page, /<a class="brand"[^>]*aria-label="RCRD home"[^>]*>[\s\S]*?<svg class="brand-mark"[^>]*aria-hidden="true"[^>]*width="72" height="72"/);
  assert.match(css, /\.brand \.brand-mark\{[^}]*width:72px;height:72px/);
  assert.match(css, /@media\(min-width:901px\)\{\.brand\{font-size:24px;gap:12px\}\.sidebar nav\{margin-top:56px\}\}/);
  assert.match(css, /@media\(max-width:900px\)\{\.brand\{gap:0;justify-content:center\}\.brand \.brand-mark\{width:40px;height:40px\}\}/);
  assert.match(page, /<circle cx="20" cy="20" r="18"[^>]*stroke="#9dc3a3"/);
  assert.match(page, /<text[^>]*fill="#d9ff48"[^>]*>R<\/text>/);
  const png = fs.readFileSync(path.join(root, icon.src));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);

  const ico = fs.readFileSync(path.join(root, 'assets/rcrd-app-icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.equal(count, 7);
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    sizes.push(ico[entry] || 256);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + length <= ico.length);
    assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
});

test('dark-theme action text stays readable in normal, hover, and disabled states', () => {
  assert.match(page, /href="styles\.css"[\s\S]*href="distinction\.css"/);
  expectContrast('collection Spotify link', '.collection-card .collection-spotify', '#111813');
  expectContrast('collection Spotify link hover', '.collection-card .collection-spotify:hover', '#111813');
  for (const selector of [
    '.api-collection', '.api-wantlist',
    '.want-card .find-listing', '.cart-btn', '.cart-btn span', '.add-cart',
    '.primary', '.connect-button', '.chip.active'
  ]) expectContrast(selector, selector, selector);
  assert.ok(contrast(property(':root', '--ui-hover-text'), property(':root', '--ui-hover-surface')) >= 4.5,
    'shared dark hover and focus colors remain readable');
  assert.ok(contrast('#ff9f91', '#372722') >= 4.5, 'destructive hover retains readable red text');
  for (const selector of [
    '.api-collection:disabled', '.api-wantlist:disabled'
  ]) expectContrast(selector, selector, selector);
  assert.match(property('button:focus-visible', 'outline'), /var\(--lime\)/);
});

test('dark-theme supporting labels, icons, and status text remain legible', () => {
  for (const [label, selector, background, minimum] of [
    ['header slogan', '.mode-label', 'body', 4.5],
    ['Spotify slogan', 'header>.mode-label>span:first-child b', 'body', 4.5],
    ['Discogs slogan', 'header>.mode-label>span:last-child b', 'body', 4.5],
    ['account status', '.settings-status strong', '.settings-card', 4.5],
    ['disconnect action', '.danger-action', '.settings-card', 4.5],
    ['account-switch link', '.account-switch-help a', '.settings-card', 4.5],
    ['account-switch link hover', '.account-switch-help a:hover', '.settings-card', 4.5],
    ['catalog condition', '.condition', '.market-card', 4.5],
    ['catalog image fallback', '.api-cover', '.api-cover', 4.5],
    ['player favorite', '.player-actions button.player-liked', '.player', 3],
    ['recent track play', '.track .track-play', 'body', 3],
    ['recent track Discogs link', '.track .track-discogs', 'body', 4.5],
    ['recent track number', '.track-num', 'body', 4.5],
    ['recent track time', '.track time', 'body', 4.5],
    ['Spotify result play', '.spotify-play-result', '.spotify-play-result', 4.5],
    ['Spotify result play hover', '.spotify-play-result', '.spotify-play-result:hover', 4.5],
    ['sidebar hover', '.sidebar nav a:hover', '.sidebar nav a:hover', 4.5]
  ]) expectContrast(label, selector, background, minimum);
  assert.equal(property('.sidebar nav a:hover b', 'color'), 'inherit');
  assert.equal(property('.listing-footer', 'border-color'), 'var(--line)');
});

test('interactive controls have distinct boundaries on dark surfaces', () => {
  for (const [selector, surface] of [
    ['.search', '.search'],
    ['.scope-menu-trigger', '.scope-menu-trigger'],
    ['.scope-menu.is-open .scope-menu-trigger', '.scope-menu.is-open .scope-menu-trigger'],
    ['.playlist-menu-trigger', '.playlist-menu-trigger'],
    ['.playlist-menu.is-open .playlist-menu-trigger', '.playlist-menu.is-open .playlist-menu-trigger'],
    ['.scope-menu-list', '.scope-menu-list'],
    ['.playlist-menu-list', '.playlist-menu-list'],
    ['.library-layout', 'body'],
    ['.sort-direction-toggle', 'body'],
    ['.discogs-sort-direction', 'body'],
    ['.chip', 'body'],
    ['.spotify-toolbar select', '.spotify-toolbar select'],
    ['.market-filters input', '.market-filters input'],
    ['.result-sort select', '.result-sort select'],
    ['.manual-refresh', 'body'],
    ['.hero-record-search>input', '.hero-record-search>input']
  ]) {
    const ratio = contrast(property(selector, 'border-color'), property(surface, 'background'));
    assert.ok(ratio >= 3, `${selector} border: ${ratio.toFixed(2)}:1 is below 3:1`);
  }
  assert.equal(property('.spotify-toolbar select', 'color-scheme'), 'dark');
  assert.equal(property('.spotify-home-sort select', 'color-scheme'), 'dark');
});

test('themed dropdown options remain legible when selected or highlighted', () => {
  expectContrast('dropdown option', '.scope-menu-list [role="option"]', '.scope-menu-list');
  expectContrast('dropdown highlighted option', '.scope-menu-list [role="option"]:hover', '.scope-menu-list [role="option"]:hover');
  expectContrast('dropdown selected option', '.scope-menu-list [role="option"][aria-selected="true"]', '.scope-menu-list [role="option"][aria-selected="true"]');
});

test('pagination selection, hover, and keyboard focus use the shared interaction palette', () => {
  assert.match(page, /<nav class="pagination" id="marketPagination"/);
  assert.equal(property('.pagination button.active', 'background'), 'var(--ui-selected-surface)');
  assert.equal(property(':root', '--ui-hover-surface'), '#213c2b');
  assert.ok(contrast('var(--lime)', property('.pagination button.active', 'background')) >= 4.5);
  assert.ok(contrast('var(--lime)', property(':root', '--ui-hover-surface')) >= 4.5);
  assert.equal(property('.pagination button:disabled', 'opacity'), '.35');
  assert.match(property('button:focus-visible', 'outline'), /var\(--lime\)/);
});

test('volume slider keeps the player theme and remains visible from the keyboard', () => {
  assert.match(page, /aria-label="Mute volume" aria-pressed="false" title="Mute volume" id="volumeButton"/);
  assert.match(page, /class="volume-waves"/);
  assert.match(page, /class="volume-muted-mark"/);
  assert.match(page, /<output id="volumeLevel" class="volume-level" for="volumeControl" aria-live="polite">65%<\/output>/);
  assert.ok(parseFloat(property('.volume-control', 'height')) >= 120, 'the volume track leaves enough room for fine pointer adjustments');
  assert.equal(property('.volume-control', 'appearance'), 'none');
  assert.equal(property('.volume-control', '-webkit-appearance'), 'none');
  assert.equal(property('.volume-control', 'accent-color'), 'var(--lime)');
  assert.equal(property('.volume-control', 'color-scheme'), 'dark');
  assert.equal(property('.volume-control::-webkit-slider-thumb', '-webkit-appearance'), 'none');
  assert.equal(property('.volume-control::-webkit-slider-thumb', 'box-shadow'), '0 0 0 2px #0d1d15');
  assert.equal(property('.volume-wrap:focus-within .volume-control', 'display'), 'block');
  assert.equal(property('.volume-wrap.volume-open .volume-level', 'display'), 'block');
  assert.equal(property('.volume-wrap:focus-within .volume-level', 'display'), 'block');
  assert.ok(contrast(property('.volume-level', 'color'), property('.volume-level', 'background')) >= 4.5);
  assert.equal(property('.volume-muted-mark', 'display'), 'none');
  assert.equal(property('#volumeButton[aria-pressed="true"] .volume-waves', 'display'), 'none');
  assert.equal(property('#volumeButton[aria-pressed="true"] .volume-muted-mark', 'display'), 'block');
  assert.equal(property('#volumeButton[aria-pressed="true"]', 'color'), 'var(--lime)');
  assert.match(property('.volume-control:focus-visible', 'outline'), /var\(--lime\)/);
  for (const selector of ['.volume-control::-webkit-slider-thumb', '.volume-control::-webkit-slider-runnable-track']) {
    const ratio = contrast(property(selector, 'background'), '#0d1d15');
    assert.ok(ratio >= 3, `${selector}: ${ratio.toFixed(2)}:1 is below 3:1`);
  }
});

test('pending playback controls use the existing lime highlight', () => {
  assert.equal(property('.playback-secondary[aria-busy="true"]', 'color'), '#d9ff48');
  assert.match(property('.playback-buttons .play-button[aria-busy="true"]', 'box-shadow'), /#d9ff48/);
});

test('enabled Shuffle has a filled, contrasting track-bar state', () => {
  assert.equal(property('#shuffleButton.active', 'background'), 'var(--lime)');
  const ratio = contrast(property('#shuffleButton.active', 'color'), property(':root', '--lime'));
  assert.ok(ratio >= 4.5, `Shuffle icon: ${ratio.toFixed(2)}:1 is below 4.5:1`);
});

test('lyrics credit link stays subdued and readable without changing the main source link', () => {
  assert.equal(property('.lyrics-credit a', 'color'), 'var(--muted)');
  assert.equal(property('.lyrics-credit a:visited', 'color'), 'var(--muted)');
  assert.equal(property('.lyrics-credit a:hover', 'color'), 'var(--lime)');
  assert.equal(property('.lyrics-credit a:focus-visible', 'color'), 'var(--lime)');
  assert.equal(property('#lyricsSource', 'color'), 'var(--lime)');
  assert.ok(contrast(property('.lyrics-credit a', 'color'), property('#lyricsDialog', 'background')) >= 4.5);
});
