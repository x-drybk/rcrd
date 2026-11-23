// Exercise source-inspecting tests with Windows checkout line endings without changing files.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceFiles = new Set(['app.js', 'server.js'].map(name => path.join(root, name).toLowerCase()));
const readFileSync = fs.readFileSync;
fs.readFileSync = function readWithCrLf(file, ...options) {
  const contents = readFileSync.call(this, file, ...options);
  return typeof file === 'string' && sourceFiles.has(path.resolve(file).toLowerCase()) && typeof contents === 'string'
    ? contents.replace(/\r?\n/g, '\r\n')
    : contents;
};

require('./run.cjs');
