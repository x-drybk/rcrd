const crypto = require('node:crypto');

const MAGIC = Buffer.from('RCRDEVT3');
const HEADER_BYTES = 44;
const RECORD_BYTES = 25;
const MAX_RECORDS = 2000000;

function digest(...parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(String(part)).update('\0');
  return hash.digest().subarray(0, 16);
}

function recordFor({ uri, playedAt, msPlayed = 30000, pending = false }) {
  if (!/^spotify:track:[A-Za-z0-9]+$/.test(uri || '') || !Number.isSafeInteger(playedAt) || playedAt < 0 ||
      !Number.isSafeInteger(msPlayed) || msPlayed < 30000 || msPlayed > 86400000 || typeof pending !== 'boolean') {
    throw new Error('Invalid imported event identity.');
  }
  const record = Buffer.alloc(RECORD_BYTES);
  digest(uri).copy(record, 0);
  // A Spotify play has no stable event ID. Match the existing RCRD recent-play
  // ledger by URI and UTC millisecond timestamp; duration can change in exports.
  record.writeBigInt64LE(BigInt(playedAt), 16);
  record[24] = pending ? 1 : 0;
  return record;
}

function compareIdentity(left, right) { return Buffer.compare(left.subarray(0, 24), right.subarray(0, 24)); }

function pack(records) {
  if (records.length > MAX_RECORDS) throw new Error('Imported event index exceeds the supported limit.');
  const payload = Buffer.concat(records, records.length * RECORD_BYTES);
  return packPayload(payload);
}

function packPayload(payload) {
  if (payload.length % RECORD_BYTES || payload.length / RECORD_BYTES > MAX_RECORDS) throw new Error('Imported event index exceeds the supported limit.');
  const output = Buffer.alloc(HEADER_BYTES + payload.length);
  MAGIC.copy(output, 0);
  output.writeUInt32BE(payload.length / RECORD_BYTES, 8);
  crypto.createHash('sha256').update(payload).digest().copy(output, 12);
  payload.copy(output, HEADER_BYTES);
  return output;
}

function inspect(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES || !buffer.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid imported event index.');
  const count = buffer.readUInt32BE(8);
  if (count > MAX_RECORDS || buffer.length !== HEADER_BYTES + count * RECORD_BYTES) throw new Error('Invalid imported event index size.');
  const payload = buffer.subarray(HEADER_BYTES);
  if (!crypto.createHash('sha256').update(payload).digest().equals(buffer.subarray(12, 44))) throw new Error('Imported event index checksum failed.');
  let prior = null;
  for (let offset = 0; offset < payload.length; offset += RECORD_BYTES) {
    const record = payload.subarray(offset, offset + RECORD_BYTES);
    if (record[24] > 1 || prior && compareIdentity(prior, record) >= 0) throw new Error('Imported event index order is invalid.');
    prior = record;
  }
  return { payload, count };
}

function unpack(buffer) {
  const { payload } = inspect(buffer);
  const records = [];
  for (let offset = 0; offset < payload.length; offset += RECORD_BYTES) records.push(payload.subarray(offset, offset + RECORD_BYTES));
  return records;
}

function encode(events) {
  if (!Array.isArray(events) || events.length > MAX_RECORDS) throw new Error('Imported event index exceeds the supported limit.');
  const records = events.map(recordFor).sort(compareIdentity);
  const unique = [];
  for (const record of records) {
    const previous = unique[unique.length - 1];
    if (previous && compareIdentity(previous, record) === 0) {
      if (previous[24] !== record[24]) throw new Error('Imported event classification changed.');
      continue;
    }
    unique.push(record);
  }
  return pack(unique);
}

function fromRaw(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length % RECORD_BYTES || buffer.length / RECORD_BYTES > MAX_RECORDS) throw new Error('Invalid raw imported events.');
  const offsets = new Uint32Array(buffer.length / RECORD_BYTES);
  for (let offset = 0; offset < buffer.length; offset += RECORD_BYTES) {
    if (buffer[offset + 24] !== 0) throw new Error('Invalid raw imported event.');
    offsets[offset / RECORD_BYTES] = offset;
  }
  offsets.sort((a, b) => Buffer.compare(buffer.subarray(a, a + 24), buffer.subarray(b, b + 24)));
  const unique = Buffer.allocUnsafe(buffer.length);
  let used = 0; let prior = -1;
  for (const offset of offsets) {
    if (prior >= 0 && Buffer.compare(buffer.subarray(prior, prior + 24), buffer.subarray(offset, offset + 24)) === 0) continue;
    buffer.copy(unique, used, offset, offset + RECORD_BYTES);
    used += RECORD_BYTES; prior = offset;
  }
  return packPayload(unique.subarray(0, used));
}

function countsByTrack(index) {
  const counts = new Map();
  const { payload } = inspect(index);
  for (let offset = 0; offset < payload.length; offset += RECORD_BYTES) {
    const key = payload.subarray(offset, offset + 16).toString('hex');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function countsByTrackAndRange(index, range) {
  const counts = new Map();
  const { payload } = inspect(index);
  for (let offset = 0; offset < payload.length; offset += RECORD_BYTES) {
    const key = payload.subarray(offset, offset + 16).toString('hex');
    const at = Number(payload.readBigInt64LE(offset + 16));
    const count = counts.get(key) || { inside: 0, outside: 0 };
    if (range && at >= range.first && at <= range.last) count.inside++;
    else count.outside++;
    counts.set(key, count);
  }
  return counts;
}

function trackKey(uri) { return digest(uri).toString('hex'); }

function lookup(index) {
  const { payload } = inspect(index);
  return (uri, playedAt) => {
    const key = recordFor({ uri, playedAt });
    let low = 0; let high = payload.length / RECORD_BYTES;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const offset = middle * RECORD_BYTES;
      const order = Buffer.compare(payload.subarray(offset, offset + 24), key.subarray(0, 24));
      if (order < 0) low = middle + 1; else high = middle;
    }
    return low < payload.length / RECORD_BYTES && Buffer.compare(payload.subarray(low * RECORD_BYTES, low * RECORD_BYTES + 24), key.subarray(0, 24)) === 0;
  };
}

function merge(existing, incoming) {
  const left = inspect(existing); const right = inspect(incoming);
  if (left.count + right.count > MAX_RECORDS * 2) throw new Error('Imported event index exceeds the supported limit.');
  const output = Buffer.allocUnsafe(Math.min(MAX_RECORDS, left.count + right.count) * RECORD_BYTES);
  let a = 0; let b = 0; let used = 0;
  while (a < left.payload.length || b < right.payload.length) {
    if (used >= output.length) throw new Error('Imported event index exceeds the supported limit.');
    if (a >= left.payload.length) { right.payload.copy(output, used, b, b + RECORD_BYTES); b += RECORD_BYTES; used += RECORD_BYTES; continue; }
    if (b >= right.payload.length) { left.payload.copy(output, used, a, a + RECORD_BYTES); a += RECORD_BYTES; used += RECORD_BYTES; continue; }
    const order = Buffer.compare(left.payload.subarray(a, a + 24), right.payload.subarray(b, b + 24));
    if (order < 0) { left.payload.copy(output, used, a, a + RECORD_BYTES); a += RECORD_BYTES; }
    else if (order > 0) { right.payload.copy(output, used, b, b + RECORD_BYTES); b += RECORD_BYTES; }
    else {
      if (left.payload[a + 24] !== right.payload[b + 24]) throw new Error('Imported event classification changed.');
      left.payload.copy(output, used, a, a + RECORD_BYTES); a += RECORD_BYTES; b += RECORD_BYTES;
    }
    used += RECORD_BYTES;
  }
  return packPayload(output.subarray(0, used));
}

module.exports = { encode, fromRaw, merge, unpack, countsByTrack, countsByTrackAndRange, lookup, trackKey, recordFor, MAX_RECORDS, RECORD_BYTES };
