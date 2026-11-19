const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PARTS = ['history', 'recent', 'events'];
const SUFFIX = { history: '.json', recent: '.recent.json', events: '.events.bin' };

function paths(root, key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid account storage key.');
  const base = path.join(root, key);
  return { base, journal: `${base}.transaction.json`, files: Object.fromEntries(PARTS.map(part => [part, `${base}${SUFFIX[part]}`])) };
}

function atomic(file, value) {
  const staged = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try { fs.writeFileSync(staged, value, { mode: 0o600 }); fs.renameSync(staged, file); }
  finally { try { fs.unlinkSync(staged); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

function recover(root, key) {
  const target = paths(root, key);
  let journal;
  try { journal = JSON.parse(fs.readFileSync(target.journal, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw new Error('Could not recover local listening history. Back up the .data folder.'); }
  if (!/^[a-f0-9]{32}$/.test(journal?.id || '') || !['prepared', 'committed', 'rolledback'].includes(journal.state) ||
      !PARTS.every(part => typeof journal.existed?.[part] === 'boolean')) throw new Error('Invalid listening-history transaction journal.');
  if (journal.state === 'prepared') {
    for (const part of PARTS) {
      const file = target.files[part];
      const backup = `${file}.${journal.id}.backup`;
      if (journal.existed[part]) {
        if (!fs.existsSync(backup)) throw new Error('Missing listening-history recovery backup.');
        atomic(file, fs.readFileSync(backup));
      } else {
        try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    atomic(target.journal, JSON.stringify({ ...journal, state: 'rolledback' }));
  }
  for (const part of PARTS) {
    try { fs.unlinkSync(`${target.files[part]}.${journal.id}.backup`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  fs.unlinkSync(target.journal);
}

function commit(root, key, values, fault = () => {}) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  recover(root, key);
  const target = paths(root, key);
  const id = crypto.randomBytes(16).toString('hex');
  const existed = Object.fromEntries(PARTS.map(part => [part, fs.existsSync(target.files[part])]));
  const staged = {};
  let prepared = false;
  try {
    for (const part of PARTS) {
      if (values[part] !== null && values[part] !== undefined) {
        staged[part] = `${target.files[part]}.${id}.stage`;
        fs.writeFileSync(staged[part], values[part], { mode: 0o600 });
      }
      if (existed[part]) fs.copyFileSync(target.files[part], `${target.files[part]}.${id}.backup`);
    }
    atomic(target.journal, JSON.stringify({ id, state: 'prepared', existed }));
    prepared = true;
    fault('prepared');
    for (const part of PARTS) {
      if (staged[part]) fs.renameSync(staged[part], target.files[part]);
      else if (existed[part]) fs.unlinkSync(target.files[part]);
      fault(part);
    }
    atomic(target.journal, JSON.stringify({ id, state: 'committed', existed }));
    fault('committed');
    recover(root, key);
  } catch (error) {
    if (prepared) recover(root, key);
    throw error;
  } finally {
    for (const part of PARTS) {
      if (staged[part]) try { fs.unlinkSync(staged[part]); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!prepared) try { fs.unlinkSync(`${target.files[part]}.${id}.backup`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = { paths, recover, commit };
