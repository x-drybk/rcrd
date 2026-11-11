const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sortRecords = vm.runInNewContext('(' + source.split('\n').find(line => line.startsWith('function sortRecords(')) + ')');
test('text sorting works in both directions, preserves input and puts missing values last', () => {
  const rows = [{ title: 'Zulu' }, { title: '' }, { title: 'alpha' }];
  assert.equal(sortRecords(rows, 'title', 'asc').map(r => r.title).join('|'), 'alpha|Zulu|');
  assert.equal(sortRecords(rows, 'title', 'desc').map(r => r.title).join('|'), 'Zulu|alpha|');
  assert.equal(rows[0].title, 'Zulu');
});
test('year and added date sorting respects direction for collection wrappers', () => {
  const rows = [{ a: { year: 2024, addedAt: '2024-01-01' } }, { a: { year: 1990, addedAt: '2023-01-01' } }];
  for (const field of ['year', 'recent']) {
    assert.equal(sortRecords(rows, field, 'asc')[0].a.year, 1990);
    assert.equal(sortRecords(rows, field, 'desc')[0].a.year, 2024);
  }
});
test('Spotify Title and Album are distinct sorts with labels matching their fields', () => {
  const rows = [
    { title: 'Zebra song', album: 'Alpha album', kind: 'track' },
    { title: 'Alpha song', album: 'Zulu album', kind: 'track' },
    { title: 'Middle album', kind: 'album' }
  ];
  assert.equal(sortRecords(rows, 'title', 'asc').map(row => row.title).join('|'), 'Alpha song|Middle album|Zebra song');
  assert.equal(sortRecords(rows, 'album', 'asc').map(row => row.title).join('|'), 'Zebra song|Middle album|Alpha song');
  for (const id of ['spotifySort', 'homeSpotifySort']) {
    const options = markup.match(new RegExp(`<select id="${id}"[^>]*>(.*?)<\\/select>`))?.[1] || '';
    assert.match(options, /<option value="title">Title<\/option>/);
    assert.match(options, /<option value="album">Album<\/option>/);
    assert.doesNotMatch(options, /Song or album title/);
  }
});

test('play-count sorting is numeric, stable, non-mutating and leaves unknown counts last', () => {
  const spotifyPlayCounts = new Map([['one',{plays:2}],['two',{plays:100}],['three',{plays:100}],['missing',{plays:null}]]);
  const sort = vm.runInNewContext('(' + source.split('\n').find(line => line.startsWith('function sortRecords(')) + ')', { spotifyPlayCounts });
  const rows = ['one','missing','two','three','unchecked'].map(uri => ({ uri, kind:'track' }));
  rows.push({ uri:'album', kind:'album' });
  assert.equal(sort(rows,'plays','desc').map(row=>row.uri).join('|'),'two|three|one|missing|unchecked|album');
  assert.equal(sort(rows,'plays','asc').map(row=>row.uri).join('|'),'one|two|three|missing|unchecked|album');
  assert.equal(rows[0].uri,'one');
  assert.match(markup, /<option value="plays">Play count<\/option>/);
});
