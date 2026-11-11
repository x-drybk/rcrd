const fs = require('node:fs');
const path = require('node:path');

global.fetch = async url => {
  const target = new URL(url);
  if (target.origin !== 'https://api.discogs.com' || target.pathname !== '/database/search') {
    throw new Error('Synthetic test blocked an unexpected provider request');
  }
  process.send?.({ type: 'synthetic-provider-call' });
  fs.appendFileSync(path.join(__dirname, 'provider-calls.txt'), 'x');
  return new Response('{}', { status: 429, headers: { 'Retry-After': '4' } });
};
