const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function handlePlaybackKeyboardShortcut(');
const marker = "document.addEventListener('keydown',handlePlaybackKeyboardShortcut);";
const end = source.indexOf(marker, start);
assert.ok(start >= 0 && end > start, 'playback keyboard shortcut exists');

function harness() {
  const clicks = [];
  const volumeAdjustments = [];
  const volumeFeedback = [];
  let listener;
  const visualizer = { hidden: true };
  const volumeControl = { value: '50', disabled: false };
  let dialogOpen = false;
  const buttons = Object.fromEntries(['playButton', 'nextButton', 'previousButton'].map(id => [id, {
    disabled: false,
    click() { clicks.push(id); }
  }]));
  const document = {
    querySelector(selector) {
      if (selector === '#ambientVisualizer') return visualizer;
      if (selector === '#volumeControl') return volumeControl;
      if (selector === 'dialog[open]') return dialogOpen ? {} : null;
      if (selector.startsWith('#') && selector.slice(1) in buttons) return buttons[selector.slice(1)];
      throw new Error(`Unexpected selector: ${selector}`);
    },
    addEventListener(type, callback) {
      assert.equal(type, 'keydown');
      listener = callback;
    }
  };
  vm.runInNewContext(source.slice(start, end + marker.length), {
    document,
    setSpotifyVolume(value) { volumeControl.value = String(value); volumeAdjustments.push(value); },
    keepVolumeOpen() { volumeFeedback.push('open'); },
    scheduleVolumeClose(delay) { volumeFeedback.push(delay); }
  });
  return {
    visualizer,
    volumeControl,
    volumeAdjustments,
    volumeFeedback,
    buttons,
    setDialogOpen(value) { dialogOpen = value; },
    clicks,
    key(properties = {}) {
      const event = {
        key: ' ',
        target: { closest() { return null; } },
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...properties
      };
      listener(event);
      return event;
    }
  };
}

test('Space invokes the existing Play/Pause button and prevents page scrolling', () => {
  const h = harness();
  const event = h.key();
  assert.deepEqual(h.clicks, ['playButton']);
  assert.equal(event.defaultPrevented, true);
  assert.match(source, /document\.querySelector\('#playButton'\)\.onclick=toggleSpotifyPlayback;/);
});

test('Ctrl+Right and Ctrl+Left use the existing Next and Previous controls', () => {
  const h = harness();
  assert.equal(h.key({ key: 'ArrowRight', ctrlKey: true }).defaultPrevented, true);
  assert.equal(h.key({ key: 'ArrowLeft', ctrlKey: true }).defaultPrevented, true);
  assert.deepEqual(h.clicks, ['nextButton', 'previousButton']);
  assert.match(source, /document\.querySelector\('#previousButton'\)\.onclick=\(\)=>runPlaybackAction\('previous'\)/);
  assert.match(source, /document\.querySelector\('#nextButton'\)\.onclick=\(\)=>runPlaybackAction\('next'\)/);
});

test('Ctrl+Up and Ctrl+Down adjust the existing volume control in bounded steps', () => {
  const h = harness();
  assert.equal(h.key({ key: 'ArrowUp', ctrlKey: true }).defaultPrevented, true);
  assert.equal(h.key({ key: 'ArrowDown', ctrlKey: true }).defaultPrevented, true);
  assert.deepEqual(h.volumeAdjustments, [55, 50]);
  assert.deepEqual(h.volumeFeedback, ['open', 1600, 'open', 1600]);
  h.volumeControl.value = '98';
  h.key({ key: 'ArrowUp', ctrlKey: true });
  h.key({ key: 'ArrowUp', ctrlKey: true });
  h.volumeControl.value = '2';
  h.key({ key: 'ArrowDown', ctrlKey: true });
  h.key({ key: 'ArrowDown', ctrlKey: true });
  assert.deepEqual(h.volumeAdjustments, [55, 50, 100, 0]);
  assert.deepEqual(h.volumeFeedback, ['open', 1600, 'open', 1600, 'open', 1600, 'open', 1600]);
});

test('playback shortcut leaves focused controls and editing alone', () => {
  const h = harness();
  for (const selector of ['input', 'textarea', 'select', 'button', 'a', '[contenteditable]', '[role="option"]', '[tabindex]']) {
    const event = h.key({ target: { closest(query) { return query.includes(selector) ? {} : null; } } });
    assert.equal(event.defaultPrevented, false, selector);
  }
  assert.equal(h.clicks.length, 0);
});

test('playback shortcut ignores other keys, modifiers, repeats, composition, and handled events', () => {
  const h = harness();
  for (const properties of [
    { key: 'Enter' }, { key: 'ArrowRight' }, { key: 'ArrowLeft' }, { key: 'ArrowUp' }, { key: 'ArrowDown' },
    { key: ' ', ctrlKey: true }, { altKey: true }, { metaKey: true },
    { shiftKey: true }, { repeat: true }, { isComposing: true }, { defaultPrevented: true }
  ]) h.key(properties);
  assert.equal(h.clicks.length, 0);
  assert.equal(h.volumeAdjustments.length, 0);
});

test('playback shortcut does not play while a dialog or visualizer is open', () => {
  const h = harness();
  h.setDialogOpen(true);
  assert.equal(h.key().defaultPrevented, false);
  assert.equal(h.key({ key: 'ArrowRight', ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.key({ key: 'ArrowUp', ctrlKey: true }).defaultPrevented, false);
  h.setDialogOpen(false);
  h.visualizer.hidden = false;
  assert.equal(h.key().defaultPrevented, false);
  assert.equal(h.key({ key: 'ArrowLeft', ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.key({ key: 'ArrowDown', ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.clicks.length, 0);
  assert.equal(h.volumeAdjustments.length, 0);
  assert.equal(h.volumeFeedback.length, 0);
});

test('volume shortcut respects focused controls, unavailable volume, and disallowed key states', () => {
  const h = harness();
  const editing = h.key({ key: 'ArrowUp', ctrlKey: true, target: { closest() { return {}; } } });
  assert.equal(editing.defaultPrevented, false);
  h.volumeControl.disabled = true;
  assert.equal(h.key({ key: 'ArrowDown', ctrlKey: true }).defaultPrevented, false);
  h.volumeControl.disabled = false;
  for (const properties of [
    { repeat: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { isComposing: true }, { defaultPrevented: true }
  ]) assert.equal(h.key({ key: 'ArrowUp', ctrlKey: true, ...properties }).defaultPrevented, Boolean(properties.defaultPrevented));
  assert.equal(h.volumeAdjustments.length, 0);
  assert.equal(h.volumeFeedback.length, 0);
});

test('volume feedback closes after the shortcut delay while pointer exit keeps its shorter delay', () => {
  const blockStart = source.indexOf("const volumeWrap=document.querySelector('.volume-wrap')");
  const blockEnd = source.indexOf("document.addEventListener('click'", blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  const classes = new Set();
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let hovering = false;
  const wrap = {
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    matches: selector => selector === ':hover' && hovering,
    addEventListener: (type, callback) => listeners.set(type, callback)
  };
  const context = vm.createContext({
    document: { querySelector: () => wrap },
    clearTimeout: id => timers.delete(id),
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }
  });
  vm.runInContext(source.slice(blockStart, blockEnd), context);
  vm.runInContext('keepVolumeOpen();scheduleVolumeClose(1600)', context);
  assert.equal(classes.has('volume-open'), true);
  assert.equal([...timers.values()][0].delay, 1600);
  listeners.get('pointerenter')();
  assert.equal(timers.size, 0, 'hovering cancels the shortcut close timer');
  hovering = true;
  listeners.get('pointerleave')();
  assert.equal([...timers.values()][0].delay, 500);
  [...timers.values()][0].callback();
  assert.equal(classes.has('volume-open'), true, 'hover keeps the control visible');
  hovering = false;
  listeners.get('pointerleave')();
  [...timers.values()][0].callback();
  assert.equal(classes.has('volume-open'), false);
});

test('skip shortcuts leave focused controls alone and ignore unavailable buttons', () => {
  const h = harness();
  const editing = h.key({ key: 'ArrowLeft', ctrlKey: true, target: { closest() { return {}; } } });
  assert.equal(editing.defaultPrevented, false);
  h.buttons.nextButton.disabled = true;
  assert.equal(h.key({ key: 'ArrowRight', ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.key({ key: 'ArrowLeft', ctrlKey: true, repeat: true }).defaultPrevented, false);
  assert.equal(h.key({ key: 'ArrowLeft', ctrlKey: true, altKey: true }).defaultPrevented, false);
  assert.equal(h.clicks.length, 0);
});
