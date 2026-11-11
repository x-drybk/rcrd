const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function renderer() {
  const target = { innerHTML: '' };
  const context = vm.createContext({ document: { querySelector: () => target }, escapeHtml: value => String(value).replaceAll('<', '&lt;') });
  vm.runInContext(source.split('\n').find(line => line.startsWith('function renderListeningDiscogsSuggestions(')), context);
  return { target, render: context.renderListeningDiscogsSuggestions };
}
test('recent plays deduplicate songs while retaining original search-action indexes', () => {
  const { target, render } = renderer();
  const track = (title, uri) => [1, title, 'Artist · Album', '3:00', '', '', uri];
  render([track('One','spotify:track:1'), track('One','spotify:track:1'), track('Two','spotify:track:2'), track('Three','spotify:track:3'), track('Four','spotify:track:4')]);
  assert.equal((target.innerHTML.match(/<button/g) || []).length, 3);
  for (const index of [0,2,3]) assert.ok(target.innerHTML.includes(`data-track="${index}"`));
  assert.ok(!target.innerHTML.includes('Four'));
});
test('empty and unavailable states show messages without sample songs', () => {
  const { target, render } = renderer();
  render([]);
  assert.match(target.innerHTML, /No recent Spotify plays/);
  assert.ok(!target.innerHTML.includes('<button'));
  render([], 'Spotify unavailable <details>');
  assert.match(target.innerHTML, /Spotify unavailable &lt;details>/);
});
