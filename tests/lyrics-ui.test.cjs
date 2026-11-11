const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function definition(name) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line.startsWith(`function ${name}(`) || line.startsWith(`async function ${name}(`));
  assert.ok(start >= 0, `${name} exists`);
  if (lines[start].trimEnd().endsWith('}')) return lines[start];
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `${name} closes`);
  return lines.slice(start, end + 1).join('\n');
}
function fixture(fetcher) {
  const nodes = new Map();
  const node = selector => {
    if (selector === '#lyricsEmbed iframe') return node('#lyricsEmbed').children[0] || null;
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: '', hidden: false, href: '', children: [], attributes: {},
      removeAttribute(name) { delete this.attributes[name]; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      replaceChildren(...children) { this.children = children; },
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return nodes.get(selector);
  };
  node('#playerTitle').textContent = 'Synthetic song';
  node('#playerArtist').textContent = 'Synthetic artist';
  const context = vm.createContext({
    document: { querySelector: node, createElement: tag => ({ tag, dataset: {}, contentWindow: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {}, remove() { node('#lyricsEmbed').replaceChildren(); } }) },
    fetch: fetcher, AbortController, encodeURIComponent, URL
  });
  vm.runInContext("let spotifyConnected=true,spotifyTrackUri='spotify:track:synthetic',spotifyAccountGeneration=0,lyricsRequestRevision=0,lyricsController=null;", context);
  for (const name of ['closeLyricsDialog', 'handleLyricsDialogBackdropPointer', 'openLyricsDialog', 'handleGeniusEmbedMessage']) vm.runInContext(definition(name), context);
  return { node, run: code => vm.runInContext(code, context) };
}

test('Lyrics dialog embeds only a validated Genius ID and provides a direct source link', async () => {
  const calls = [];
  const h = fixture(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ id: 123, title: 'Synthetic song', url: 'https://genius.com/Synthetic-artist-synthetic-song-lyrics' }) };
  });
  await h.run('openLyricsDialog()');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/lyrics/genius');
  assert.equal(calls[0].options.headers['X-RCRD-Request'], '1');
  assert.equal(h.node('#lyricsTrack').textContent, 'Synthetic song · Synthetic artist');
  assert.equal(h.node('#lyricsSource').href, 'https://genius.com/Synthetic-artist-synthetic-song-lyrics');
  assert.equal(h.node('#lyricsEmbed').children[0].src, '/genius-embed?id=123');
  assert.equal(h.node('#lyricsEmbed').children[0].attributes.sandbox, 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
  h.run('closeLyricsDialog()');
  assert.equal(h.node('#lyricsDialog').open, false);
  assert.equal(h.node('#lyricsEmbed').children.length, 0);
});

test('Lyrics lookup ignores a stale song after track or account change', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = fixture(() => pending);
  const lookup = h.run('openLyricsDialog()');
  h.run("spotifyTrackUri='spotify:track:other';spotifyAccountGeneration++;closeLyricsDialog()");
  finish({ ok: true, json: async () => ({ id: 456 }) });
  await lookup;
  assert.equal(h.node('#lyricsDialog').open, false);
  assert.equal(h.node('#lyricsEmbed').children.length, 0);
  assert.equal(h.node('#lyricsSource').hidden, true);
});

test('Lyrics backdrop closes the dialog while inside clicks leave it open', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = fixture(() => pending);
  const dialog = h.node('#lyricsDialog');
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 500 });
  const lookup = h.run('openLyricsDialog()');
  assert.equal(dialog.open, true);
  h.run('handleLyricsDialogBackdropPointer({currentTarget:document.querySelector("#lyricsDialog"),target:{},clientX:50,clientY:50})');
  assert.equal(dialog.open, true, 'a child element does not dismiss lyrics');
  h.run('handleLyricsDialogBackdropPointer({currentTarget:document.querySelector("#lyricsDialog"),target:document.querySelector("#lyricsDialog"),clientX:250,clientY:250})');
  assert.equal(dialog.open, true, 'the dialog background does not dismiss lyrics');
  h.run('handleLyricsDialogBackdropPointer({currentTarget:document.querySelector("#lyricsDialog"),target:document.querySelector("#lyricsDialog"),clientX:50,clientY:250})');
  assert.equal(dialog.open, false, 'a pointer on the backdrop dismisses lyrics');
  finish({ ok: true, json: async () => ({ id: 456 }) });
  await lookup;
  assert.equal(h.node('#lyricsEmbed').children.length, 0, 'a dismissed lookup cannot refill the dialog');
  assert.match(source, /querySelector\('#lyricsDialog'\)\.addEventListener\('pointerdown',handleLyricsDialogBackdropPointer\)/);
  assert.match(source, /querySelector\('#lyricsDialogClose'\)\.addEventListener\('click',closeLyricsDialog\)/);
});

test('Lyrics missing match offers a safe Genius search link without an embed', async () => {
  const h = fixture(async () => ({ ok: false, status: 404, json: async () => ({ error: 'No unambiguous Genius match was found.' }) }));
  await h.run('openLyricsDialog()');
  assert.match(h.node('#lyricsStatus').textContent, /No unambiguous/);
  assert.equal(h.node('#lyricsSource').hidden, false);
  assert.match(h.node('#lyricsSource').href, /^https:\/\/genius\.com\/search\?q=/);
  assert.equal(h.node('#lyricsEmbed').children.length, 0);
});

test('Lyrics embed failure replaces the frame with a clear link, ignoring unrelated messages', async () => {
  const h = fixture(async () => ({ ok: true, json: async () => ({ id: 123 }) }));
  await h.run('openLyricsDialog()');
  const frame = h.node('#lyricsEmbed').children[0];
  h.run('handleGeniusEmbedMessage({source:{},data:{type:"rcrd-genius-embed-error",id:123}})');
  assert.equal(h.node('#lyricsEmbed').children.length, 1);
  h.run('handleGeniusEmbedMessage({source:document.querySelector("#lyricsEmbed iframe").contentWindow,data:{type:"rcrd-genius-embed-error",id:124}})');
  assert.equal(h.node('#lyricsEmbed').children.length, 1);
  h.run('handleGeniusEmbedMessage({source:document.querySelector("#lyricsEmbed iframe").contentWindow,data:{type:"rcrd-genius-embed-error",id:123}})');
  assert.equal(h.node('#lyricsEmbed').children.length, 0);
  assert.equal(h.node('#lyricsStatus').hidden, false);
  assert.match(h.node('#lyricsStatus').textContent, /cannot display its lyrics inside RCRD/);
  assert.equal(h.node('#lyricsSource').href, 'https://genius.com/songs/123');
  assert.equal(frame.dataset.geniusId, '123');
});

test('Lyrics source ignores an unsafe provider URL', async () => {
  const h = fixture(async () => ({ ok: true, json: async () => ({ id: 123, url: 'https://genius.com.evil.example/redirect' }) }));
  await h.run('openLyricsDialog()');
  assert.equal(h.node('#lyricsSource').href, 'https://genius.com/songs/123');
});
