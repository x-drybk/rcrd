const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const browserTests = fs.readdirSync(__dirname).filter(name => name.endsWith('.browser.cjs')).sort();
if (!browserTests.length) throw new Error('No synthetic browser tests found.');

for (const file of browserTests) {
  process.stdout.write(`\nBrowser check: ${file}\n`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

process.stdout.write(`\nAll ${browserTests.length} synthetic browser checks passed.\n`);
