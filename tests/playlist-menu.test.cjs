const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'distinction.css'), 'utf8');

test('sidebar playlist picker uses a custom listbox instead of a native select', () => {
  const sidebar = htmlSource.match(/<div class="sidebar-playlists[^\n]+/)?.[0] || '';
  assert.match(sidebar, /aria-haspopup="listbox"/);
  assert.match(sidebar, /role="listbox"/);
  assert.doesNotMatch(sidebar, /<select/);
  assert.match(sidebar, /Your playlists and ones you help manage/);
  assert.match(htmlSource, /class="spotify-playlist-field"[\s\S]*?Your playlists and ones you help manage/);
  assert.match(cssSource, /\.sidebar-playlists \.playlist-access-hint\{margin:0 10px 8px;font-size:10px;white-space:nowrap/);
  assert.match(htmlSource, /followed playlists are unavailable to this app/);
  assert.match(cssSource, /\.playlist-access-hint\{[^}]*font:italic/);
});

test('expanded sidebar playlists overlay navigation without a nested scrollbar or page reflow', () => {
  const navStyle = cssSource.match(/\.sidebar nav\{([^}]*)\}/g)?.at(-1) || '';
  const sidebarStyles = cssSource.match(/\.sidebar\{([^}]*)\}/g) || [];
  const listStyle = cssSource.match(/\.playlist-menu-list\{([^}]*)\}/)?.[1] || '';
  const controlStyle = cssSource.match(/\.playlist-menu-control\{([^}]*)\}/)?.[1] || '';
  assert.match(navStyle, /overflow:visible/);
  assert.ok(sidebarStyles.some(rule => /position:sticky/.test(rule)));
  assert.match(htmlSource, /class="playlist-menu-control"><button[^\n]+id="sidebarPlaylistTrigger"[^\n]+id="sidebarPlaylistList"/);
  assert.match(controlStyle, /position:relative/);
  assert.match(listStyle, /position:absolute/);
  assert.match(listStyle, /top:calc\(100% - 8px\)/);
  assert.doesNotMatch(listStyle, /max-height|overflow:auto/);
  assert.doesNotMatch(cssSource, /body:has\(\.playlist-menu\.is-open\) \.sidebar\{position:relative\}/);
});

test('Spotify results grow with the page rather than creating a second scrollbar', () => {
  const shellStyle = cssSource.match(/\.spotify-library-shell\{([^}]*)\}/g)?.at(-1) || '';
  assert.match(shellStyle, /max-height:none/);
  assert.match(shellStyle, /overflow:visible/);
  assert.match(cssSource, /body\{display:grid;grid-template-columns:248px minmax\(0,1fr\)/);
  assert.match(cssSource, /main\{width:100%;margin-left:0\}/);
});

test('themed option lists overlay results without creating a nested scrollbar', () => {
  const listStyle = cssSource.match(/\.themed-select-list\{([^}]*)\}/g)?.at(-1) || '';
  assert.match(listStyle, /position:absolute/);
  assert.match(listStyle, /max-height:none/);
  assert.match(listStyle, /overflow:visible/);
  assert.doesNotMatch(cssSource, /\.spotify-toolbar:has\(\.themed-select\.is-open\)/);
});

test('playlist menu renders themed option buttons and a disabled connection state', () => {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      disabled: false, dataset: {}, hidden: false, innerHTML: '', textContent: '',
      classList: { remove() {} }, setAttribute() {}
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    syncThemedSelect() {}
  });
  const definition = appSource.split('\n').find(line => line.startsWith('function setSidebarPlaylistOptions('));
  vm.runInContext(definition, context);
  vm.runInContext(`setSidebarPlaylistOptions([{id:'mix1',name:'Road < Mix (12)'}])`, context);
  assert.match(node('#sidebarPlaylistList').innerHTML, /role="option"/);
  assert.match(node('#sidebarPlaylistList').innerHTML, /Road &lt; Mix/);
  assert.doesNotMatch(node('#sidebarPlaylistList').innerHTML, /<option/);
  vm.runInContext(`setSidebarPlaylistOptions([], 'Connect Spotify for playlists', true)`, context);
  assert.equal(node('#sidebarPlaylistTrigger').disabled, true);
  assert.equal(node('#sidebarPlaylistValue').textContent, 'Connect Spotify for playlists');
});

test('themed Spotify sort menu selects by keyboard and closes on Escape', () => {
  const ids = appSource.match(/const spotifyThemedSelectIds=\[([^\]]+)\]/)?.[1] || '';
  for (const id of ['spotifySort', 'spotifyPageSize', 'homeSpotifySort', 'homeSpotifySortDirection', 'spotifyPlaylistSelect']) {
    assert.match(ids, new RegExp(`'${id}'`));
  }
  assert.match(appSource, /\.\.\.spotifyThemedSelectIds\]\.forEach\(id=>enhanceThemedSelect/);
  let focused;
  let changes = 0;
  const display = { textContent: '' };
  const trigger = {
    listeners: {}, attributes: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { focused = this; }
  };
  const list = {
    hidden: true, listeners: {}, rendered: [],
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute() {},
    get innerHTML() { return this.html || ''; },
    set innerHTML(html) {
      this.html = html;
      this.rendered = [...html.matchAll(/data-value="([^"]*)" aria-selected="false">([^<]*)<\/button>/g)]
        .map(([, value, label]) => ({
          dataset: { value }, textContent: label.replaceAll('&lt;', '<'), attributes: {},
          setAttribute(name, state) { this.attributes[name] = state; },
          closest() { return this; },
          focus() { focused = this; },
          click() { list.listeners.click({ target: this }); }
        }));
    },
    querySelectorAll() { return this.rendered; },
    querySelector() { return this.rendered.find(option => option.attributes['aria-selected'] === 'true'); }
  };
  const menu = {
    dataset: {}, open: false,
    classList: {
      toggle(_name, open) { menu.open = open; },
      remove() { menu.open = false; }
    },
    appendChild(node) { if (node === select) select.menu = menu; },
    prepend() {},
    querySelector(selector) {
      return { '.themed-select-list': list, '.themed-select-trigger': trigger, '.themed-select-value': display }[selector];
    }
  };
  const select = {
    dataset: {}, options: [
      { value: 'recent', textContent: 'Recently saved' },
      { value: 'title', textContent: 'Title' },
      { value: 'artist', textContent: 'Artist' }
    ],
    value: 'recent', disabled: false, listeners: {},
    getAttribute(name) { return name === 'aria-label' ? 'Sort Spotify results' : null; },
    setAttribute() {}, before() {},
    closest(selector) { return selector === '.themed-select' ? this.menu : null; },
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); },
    dispatchEvent(event) { changes++;for (const listener of this.listeners[event.type] || []) listener(event); }
  };
  const elements = [menu, trigger, list];
  const context = vm.createContext({
    select, Event,
    document: { createElement: () => elements.shift(), querySelectorAll: () => [], get activeElement() { return focused; } },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  });
  for (const name of ['closeThemedSelect', 'syncThemedSelect', 'enhanceThemedSelect']) {
    const definition = appSource.split('\n').find(line => line.startsWith(`function ${name}(`));
    assert.ok(definition, `${name} exists`);
    vm.runInContext(definition, context);
  }
  vm.runInContext('enhanceThemedSelect(select)', context);
  assert.equal(select.hidden, true);
  assert.equal(list.role, 'listbox');
  trigger.listeners.click();
  assert.equal(menu.open, true);
  assert.equal(focused, list.rendered[0]);
  list.listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(focused, list.rendered[1]);
  list.listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(select.value, 'title');
  assert.equal(display.textContent, 'Title');
  assert.equal(changes, 1);
  assert.equal(menu.open, false);
  assert.equal(focused, trigger);
  trigger.listeners.click();
  list.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(menu.open, false);
  assert.equal(select.value, 'title');
  select.options.push({ value: 'year', textContent: 'Year < 2020' });
  select.value = 'year';
  vm.runInContext('syncThemedSelect(select)', context);
  assert.equal(list.rendered.length, 4);
  assert.match(list.innerHTML, /Year &lt; 2020/);
  assert.equal(display.textContent, 'Year < 2020');
  assert.equal(list.rendered[3].attributes['aria-selected'], 'true');
  select.disabled = true;
  vm.runInContext('syncThemedSelect(select)', context);
  assert.equal(trigger.disabled, true);
  assert.equal(list.hidden, true);
  assert.equal(trigger.attributes['aria-expanded'], 'false');
});
