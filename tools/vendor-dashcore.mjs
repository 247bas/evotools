// Bundles @dashevo/dashcore-lib for the browser into
// public/shared/vendor/dashcore.bundle.js. Run: npm run vendor:dashcore
//
// Why a bundle at all: the evo-sdk can hold an asset lock proof but cannot build
// the layer-1 transaction that creates one. dashcore-lib can, and it is the
// reference implementation, but it is CommonJS with Node built-ins.
//
// Two things this file exists to remember:
//  - IIFE, not ESM. The ESM output dies on the `events` shim ("EventEmitter2 is
//    not a constructor") because dashcore's `require('events')` expects the CJS
//    export to be the constructor itself.
//  - `@dashevo/bls` pulls in `fs` and `path` for its Node branch, which the
//    browser never takes. Stubbing them keeps the bundle buildable; BLS itself
//    is not used for asset locks.
import esbuild from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'evotools-dashcore-'));
const empty = join(tmp, 'empty.cjs');
const shim = join(tmp, 'shim.js');
writeFileSync(empty, 'module.exports = {};\n');
writeFileSync(shim, "import { Buffer } from 'buffer';\nimport process from 'process';\nexport { Buffer, process };\n");

await esbuild.build({
  stdin: {
    contents: "module.exports = require('@dashevo/dashcore-lib');",
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  globalName: 'dashcore',
  platform: 'browser',
  minify: true,
  target: ['es2022'],
  define: { global: 'globalThis' },
  inject: [shim],
  alias: {
    fs: empty, path: empty, worker_threads: empty, module: empty,
    stream: 'stream-browserify', crypto: 'crypto-browserify', buffer: 'buffer',
    assert: 'assert', url: 'url', string_decoder: 'string_decoder', process: 'process',
  },
  outfile: 'public/shared/vendor/dashcore.bundle.js',
});

console.log('vendored public/shared/vendor/dashcore.bundle.js');
