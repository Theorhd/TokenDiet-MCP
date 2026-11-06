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

// Copy only supported language WASMs (reduces bundle size by ~73%)
const SUPPORTED_WASMS = new Set([
  'tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-go.wasm',
  'tree-sitter-rust.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-c_sharp.wasm',
  'tree-sitter-ruby.wasm',
  'tree-sitter-php.wasm',
]);

const wasmsSrcDir = path.resolve(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out');
if (fs.existsSync(wasmsSrcDir)) {
  const files = fs.readdirSync(wasmsSrcDir).filter(f => SUPPORTED_WASMS.has(f));
  for (const file of files) {
    fs.copyFileSync(path.join(wasmsSrcDir, file), path.join(distWasmsDir, file));
  }
  console.log(`✓ Copied ${files.length} language WASMs to dist/wasms/`);
}
