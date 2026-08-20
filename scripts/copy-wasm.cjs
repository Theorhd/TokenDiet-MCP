const fs = require('node:fs');
const path = require('node:path');

const distWasmsDir = path.resolve(__dirname, '..', 'dist', 'wasms');
fs.mkdirSync(distWasmsDir, { recursive: true });

// Copy tree-sitter.wasm
const coreWasmSrc = path.resolve(__dirname, '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
if (fs.existsSync(coreWasmSrc)) {
  fs.copyFileSync(coreWasmSrc, path.join(distWasmsDir, 'tree-sitter.wasm'));
  console.log('✓ Copied tree-sitter.wasm');
}

// Copy language wasms
const wasmsSrcDir = path.resolve(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out');
if (fs.existsSync(wasmsSrcDir)) {
  const files = fs.readdirSync(wasmsSrcDir).filter(f => f.endsWith('.wasm'));
  for (const file of files) {
    fs.copyFileSync(path.join(wasmsSrcDir, file), path.join(distWasmsDir, file));
  }
  console.log(`✓ Copied ${files.length} language WASMs to dist/wasms/`);
}
