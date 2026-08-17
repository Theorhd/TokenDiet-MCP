// Post-build fix: esbuild strips the "node:" prefix from node:sqlite
const fs = require('fs');
const path = require('path');

const distFile = path.join(__dirname, '..', 'dist', 'index.js');
let content = fs.readFileSync(distFile, 'utf8');

// Fix: replace `from "sqlite"` with `from "node:sqlite"`
content = content.replace(/from "sqlite"/g, 'from "node:sqlite"');

fs.writeFileSync(distFile, content);
console.log('Fixed node:sqlite import in dist/index.js');
