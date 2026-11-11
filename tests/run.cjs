const fs = require('node:fs');
const path = require('node:path');

const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs')).sort();
if (!files.length) throw new Error('No test files found.');

for (const file of files) {
  require(path.join(__dirname, file));
}
