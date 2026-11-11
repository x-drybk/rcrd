const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'distinction.css'), 'utf8');
const start = source.indexOf('const VISUALIZER_IDLE_MS=5*60*1000;');
const endMarker = 'initializeAmbientVisualizer();';
const end = source.indexOf(endMarker, start);
assert.ok(start >= 0 && end > start, 'ambient visualizer behavior exists');
const visualizerSource = source.slice(start, end + endMarker.length);
const idleMs = 5 * 60 * 1000;

function harness(savedEnabled = false, fullscreenMode = 'supported') {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const preferences = [];
  const documentListeners = new Map();
  const fullscreen = { requests: 0, exits: 0, options: [] };
  const element = () => ({
    hidden: false, checked: false, disabled: false, open: false, isConnected: true, textContent: '',
    listeners: new Map(), focusCalls: 0,
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    focus() { this.focusCalls++; document.activeElement = this; }
  });
  const overlay = element();
  overlay.hidden = true;
  const setting = element();
  const startButton = element();
  const playerButton = element();
  const hint = element();
  hint.textContent = 'Click, tap, or press any key to return';
  const dialog = element();
  const previousFocus = element();
  const elements = {
    '#ambientVisualizer': overlay,
    '#ambientVisualizerEnabled': setting,
    '#startAmbientVisualizer': startButton,
    '#playerVisualizer': playerButton,
    '#ambientVisualizerHint': hint,
    '#spotifyMixDialog': dialog,
    '#pressingCompareDialog': element(),
    '#aboutDialog': element()
  };
  const document = {
    visibilityState: 'visible', activeElement: previousFocus,
    fullscreenEnabled: fullscreenMode !== 'unsupported', fullscreenElement: null,
    querySelector(selector) { return selector === 'dialog[open]' ? [elements['#spotifyMixDialog'], elements['#pressingCompareDialog'], elements['#aboutDialog']].find(dialog => dialog.open) : elements[selector]; },
    exitFullscreen() {
      fullscreen.exits++;
      this.fullscreenElement = null;
      return Promise.resolve();
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    }
  };
  if (fullscreenMode !== 'unsupported') {
    overlay.requestFullscreen = options => {
      fullscreen.requests++;
      fullscreen.options.push(options);
      if (fullscreenMode === 'rejected') return Promise.reject(new Error('Fullscreen denied'));
      document.fullscreenElement = overlay;
      return Promise.resolve();
    };
  }
  const context = vm.createContext({
    document,
    Date: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    saveUiPreference(key, value) { preferences.push([key, value]); },
    uiPreferences: { ambientVisualizerEnabled: savedEnabled }
  });
  vm.runInContext(visualizerSource, context);
  return {
    overlay, setting, startButton, playerButton, hint, dialog, compareDialog: elements['#pressingCompareDialog'], document,
    previousFocus, preferences, timers, fullscreen,
    run(code) { return vm.runInContext(code, context); },
    event(type, properties = {}) {
      const event = {
        type, ...properties, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }
      };
      for (const listener of documentListeners.get(type) || []) listener(event);
      return event;
    },
    enable(value) {
      setting.checked = value;
      setting.listeners.get('change')({ currentTarget: setting });
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      now = target;
    }
  };
}

test('ambient visualizer is opt-in and starts hidden', () => {
  assert.match(markup, /id="ambientVisualizerEnabled"/);
  assert.match(markup, /id="startAmbientVisualizer" disabled/);
  assert.match(markup, /id="playerVisualizer"/);
  assert.match(markup, /id="ambientVisualizer"[^>]* hidden/);
  const h = harness();
  assert.equal(h.setting.checked, false);
  assert.equal(h.startButton.disabled, true);
  assert.equal(h.timers.size, 0);
  h.advance(idleMs * 2);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.run('showAmbientVisualizer()'), false);
});

test('track-bar visualizer icon depicts a record in fullscreen corners, not EQ bars', () => {
  const button = markup.match(/<button[^>]*id="playerVisualizer"[^>]*>(.*?)<\/button>/);
  assert.ok(button);
  assert.match(button[0], /aria-label="Open fullscreen visualizer"/);
  assert.match(button[1], /<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/);
  assert.match(button[1], /<circle cx="12" cy="12" r="5\.25"/);
  assert.match(button[1], /<circle cx="12" cy="12" r="1\.25"/);
  assert.doesNotMatch(button[1], /M4 15v5M9 8v12M14 4v16M19 11v9/);
});

test('stored opt-in requires a literal Boolean true', () => {
  const defaults = source.split('\n').find(line => line.startsWith('const preferenceDefaults='));
  const load = source.split('\n').find(line => line.startsWith('function loadUiPreferences('));
  assert.ok(defaults && load);
  const enabled = stored => vm.runInNewContext(
    `${defaults}\n${load}\nloadUiPreferences().ambientVisualizerEnabled`,
    { localStorage: { getItem: () => stored } }
  );
  assert.equal(enabled(null), false);
  assert.equal(enabled('{"ambientVisualizerEnabled":true}'), true);
  assert.equal(enabled('{"ambientVisualizerEnabled":"true"}'), false);
  assert.equal(enabled('{"ambientVisualizerEnabled":1}'), false);
  assert.equal(enabled('{broken'), false);
});

test('enabling persists the choice and shows the visualizer only after uninterrupted idle time', () => {
  const h = harness();
  h.enable(true);
  assert.deepEqual(h.preferences, [['ambientVisualizerEnabled', true]]);
  assert.equal(h.startButton.disabled, false);
  h.advance(idleMs - 1000);
  h.event('pointermove');
  h.advance(1000);
  assert.equal(h.overlay.hidden, true);
  h.advance(idleMs - 1000);
  assert.equal(h.overlay.hidden, false);
  assert.equal(h.document.activeElement, h.overlay);
  assert.equal(h.overlay.focusCalls, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.fullscreen.requests, 0);
});

test('Settings button requests fullscreen and interaction restores focus and rearms the idle timer', () => {
  const h = harness(true);
  assert.equal(h.setting.checked, true);
  h.startButton.listeners.get('click')();
  assert.equal(h.overlay.hidden, false);
  assert.equal(h.fullscreen.requests, 1);
  assert.equal(h.fullscreen.options[0].navigationUI, 'hide');
  assert.equal(h.document.fullscreenElement, h.overlay);
  const move = h.event('pointermove');
  assert.equal(move.prevented, false);
  assert.equal(h.overlay.hidden, false);
  const input = h.event('pointerdown');
  assert.equal(input.prevented, true);
  assert.equal(input.stopped, true);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.fullscreen.exits, 1);
  assert.equal(h.document.activeElement, h.previousFocus);
  h.advance(idleMs);
  assert.equal(h.overlay.hidden, false);
  assert.equal(h.fullscreen.requests, 1, 'idle activation remains in-page');
  h.enable(false);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.preferences, [['ambientVisualizerEnabled', false]]);
});

test('hidden tabs do not activate the visualizer and restart idle timing when visible', () => {
  const h = harness(true);
  h.advance(idleMs / 2);
  h.document.visibilityState = 'hidden';
  h.event('visibilitychange');
  assert.equal(h.timers.size, 0);
  h.advance(idleMs * 2);
  assert.equal(h.overlay.hidden, true);
  h.document.visibilityState = 'visible';
  h.event('visibilitychange');
  h.advance(idleMs - 1);
  assert.equal(h.overlay.hidden, true);
  h.advance(1);
  assert.equal(h.overlay.hidden, false);
  h.document.visibilityState = 'hidden';
  h.event('visibilitychange');
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.document.activeElement, h.previousFocus);
  assert.equal(h.timers.size, 0);
});

test('an open mix dialog defers automatic activation', () => {
  assert.match(markup, /id="spotifyMixDialog"/);
  const h = harness(true);
  h.dialog.open = true;
  h.advance(idleMs);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.timers.size, 1);
  h.dialog.open = false;
  h.advance(idleMs);
  assert.equal(h.overlay.hidden, false);
});

test('an open pressing comparison also defers automatic visualizer activation', () => {
  const h = harness(true);
  h.compareDialog.open = true;
  h.advance(idleMs);
  assert.equal(h.overlay.hidden, true);
  h.compareDialog.open = false;
  h.advance(idleMs);
  assert.equal(h.overlay.hidden, false);
});

test('an open About dialog keeps the visualizer from covering it', () => {
  const h = harness(true);
  h.document.querySelector('#aboutDialog').open = true;
  h.advance(idleMs);
  assert.equal(h.overlay.hidden, true);
  h.document.querySelector('#aboutDialog').open = false;
  h.advance(idleMs);
  assert.equal(h.overlay.hidden, false);
});

test('player button opens the visualizer and requests fullscreen synchronously without automatic mode', () => {
  const h = harness();
  assert.equal(h.setting.checked, false);
  assert.equal(h.startButton.disabled, true);
  h.document.activeElement = h.playerButton;
  h.playerButton.listeners.get('click')();
  assert.equal(h.overlay.hidden, false);
  assert.equal(h.document.activeElement, h.overlay);
  assert.equal(h.fullscreen.requests, 1);
  assert.equal(h.fullscreen.options[0].navigationUI, 'hide');
  assert.equal(h.document.fullscreenElement, h.overlay);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.preferences, []);
});

test('unsupported or rejected fullscreen keeps the visualizer open with a fallback hint', async () => {
  for (const button of ['playerButton', 'startButton']) {
    for (const mode of ['unsupported', 'rejected']) {
      const h = harness(button === 'startButton', mode);
      const originalHint = h.hint.textContent;
      h[button].listeners.get('click')();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.overlay.hidden, false, `${button}: ${mode} should not close the visualizer`);
      assert.notEqual(h.hint.textContent, originalHint, `${button}: ${mode} should explain the fallback`);
      assert.match(h.hint.textContent, /full.?screen|window/i);
      assert.equal(h.fullscreen.requests, mode === 'rejected' ? 1 : 0);
    }
  }
});

test('Escape dismisses visualizer fullscreen, restores focus, and exits only its own fullscreen', () => {
  const h = harness();
  h.document.activeElement = h.playerButton;
  h.playerButton.listeners.get('click')();
  const escape = h.event('keydown', { key: 'Escape' });
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.fullscreen.exits, 1);
  assert.equal(h.document.activeElement, h.playerButton);

  const unrelated = harness(true);
  unrelated.run('showAmbientVisualizer()');
  unrelated.document.fullscreenElement = unrelated.dialog;
  unrelated.event('pointerdown');
  assert.equal(unrelated.overlay.hidden, true);
  assert.equal(unrelated.fullscreen.exits, 0);
});

test('browser fullscreen exit dismisses the visualizer and restores focus', () => {
  const h = harness();
  h.document.activeElement = h.playerButton;
  h.playerButton.listeners.get('click')();
  h.event('fullscreenchange');
  h.document.fullscreenElement = null;
  h.event('fullscreenchange');
  assert.equal(h.overlay.hidden, true);
  assert.equal(h.fullscreen.exits, 0);
  assert.equal(h.document.activeElement, h.playerButton);
});

test('ambient records keep spinning while reduced motion softens background movement', () => {
  assert.doesNotMatch(markup, /ambient-visualizer-bars/);
  assert.match(markup, /ambient-visualizer-scene/);
  assert.equal((markup.match(/<i class="ambient-visualizer-disc ambient-visualizer-disc-(?:one|two|three)"><\/i>/g) || []).length, 3);
  assert.doesNotMatch(styles, /ambient-visualizer-bars|@keyframes ambient-bar/);
  assert.match(styles, /\.ambient-visualizer::before\{background:radial-gradient/);
  assert.match(styles, /\.ambient-visualizer-disc::before\{content:'R';[^}]*conic-gradient\([^)]*\)[^}]*animation:ambient-disc-spin 8s linear infinite/);
  assert.match(styles, /\.ambient-visualizer-disc-two::before\{animation-duration:12s;animation-direction:reverse\}/);
  const discWidth = name => {
    const match = styles.match(new RegExp(`\\.ambient-visualizer-disc-${name}\\{width:clamp\\((\\d+)px,(\\d+)vmin,(\\d+)px\\)`));
    assert.ok(match, `${name} record has a responsive width`);
    return match.slice(1).map(Number);
  };
  const firstWidth = discWidth('one');
  const secondWidth = discWidth('two');
  const thirdWidth = discWidth('three');
  for (let i = 0; i < thirdWidth.length; i++) {
    assert.ok(thirdWidth[i] > Math.max(firstWidth[i], secondWidth[i]), 'third record stays larger across width bounds');
  }
  assert.match(styles, /\.ambient-visualizer-disc-three\{[^}]*left:auto;right:8%;top:8%/);
  assert.match(styles, /\.ambient-visualizer-disc-three::before\{animation-duration:16s\}/);
  assert.match(styles, /@media\(max-aspect-ratio:6\/5\)\{[^\n]*\.ambient-visualizer-disc-three\{right:-15%;top:10%\}/);
  assert.match(styles, /@media\(max-width:620px\)\{\.ambient-visualizer-disc-one\{[^\n]*\.ambient-visualizer-disc-three\{right:-20%;top:12%\}/);
  assert.match(styles, /@keyframes ambient-disc-spin\{to\{transform:rotate\(360deg\)\}\}/);
  const reducedMotionIndex = styles.indexOf('@media(prefers-reduced-motion:reduce)');
  assert.ok(reducedMotionIndex >= 0, 'reduced-motion treatment exists');
  const reducedMotionRules = styles.slice(reducedMotionIndex);
  assert.doesNotMatch(reducedMotionRules, /\.ambient-visualizer\{background:\s*(?:#000(?:000)?|black)\b/i);
  assert.match(reducedMotionRules, /\.ambient-visualizer::before,\.ambient-visualizer::after\{animation:ambient-color-breathe/);
  assert.doesNotMatch(reducedMotionRules, /\.ambient-visualizer-disc::before\{/);
  assert.match(reducedMotionRules, /\.ambient-visualizer-disc-one,\.ambient-visualizer-disc-two,\.ambient-visualizer-disc-three\{animation:ambient-disc-breathe/);
});

test('ambient records use distinct wide and narrow placements', () => {
  assert.match(styles, /\.ambient-visualizer-disc-two\{[^}]*left:23%;right:auto;bottom:2%/);
  assert.match(styles, /@media\(max-width:1500px\)\{\.ambient-visualizer-disc-two\{left:16%\}/);
  assert.match(styles, /@media\(max-aspect-ratio:6\/5\)\{\.ambient-visualizer-disc-two\{left:-14%;bottom:-17%\}/);
  assert.match(styles, /@media\(max-width:620px\)\{\.ambient-visualizer-disc-one\{[^\n]*\.ambient-visualizer-disc-two\{left:-20%;right:auto;bottom:-15%\}/);
});
