const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encode, merge, unpack, lookup, countsByTrackAndRange, trackKey, RECORD_BYTES } = require('../scripts/History-Event-Index.cjs');

const uri = 'spotify:track:syntheticA';
const row = (time, msPlayed = 60000, track = uri, pending = false) => ({ uri: track, playedAt: time, msPlayed, pending });

test('event index unions disjoint and overlapping archives without inflating reimports', () => {
  const first = encode([row(1000), row(2000)]);
  const second = encode([row(2000), row(3000), row(4000)]);
  const union = merge(first, second);
  assert.equal(unpack(union).length, 4);
  assert.equal(unpack(merge(union, first)).length, 4);
  assert.equal(union.length, 44 + 4 * RECORD_BYTES);
  assert.equal(union.includes(Buffer.from(uri)), false, 'the event index does not repeat raw track URIs');
});

test('track distinguishes identities at the same timestamp while export duration does not', () => {
  const index = encode([row(1000), row(1000, 61000), row(1000, 60000, 'spotify:track:syntheticB')]);
  assert.equal(unpack(index).length, 2);
});

test('duplicate identity with conflicting legacy classification is rejected', () => {
  assert.throws(() => encode([row(1000), row(1000, 60000, uri, true)]), /classification changed/);
  assert.throws(() => merge(encode([row(1000)]), encode([row(1000, 60000, uri, true)])), /classification changed/);
});

test('index validates bounds, order, and checksum before use', () => {
  assert.throws(() => encode([row(-1)]), /Invalid imported event identity/);
  const index = encode([row(1000)]);
  const damaged = Buffer.from(index);
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => unpack(damaged), /checksum failed/);
  assert.throws(() => unpack(index.subarray(0, -1)), /size/);
});

test('lookup and legacy range counts distinguish certain new plays from ambiguous overlap', () => {
  const index = encode([row(1000), row(2000), row(3000)]);
  const has = lookup(index);
  assert.equal(has(uri, 2000), true);
  assert.equal(has(uri, 2500), false);
  const counts = countsByTrackAndRange(index, { first: 1000, last: 2000 });
  assert.deepEqual(counts.get(trackKey(uri)), { inside: 2, outside: 1 });
});
