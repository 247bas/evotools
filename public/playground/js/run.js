// Turn a cookbook recipe (Node ESM) into a browser-runnable module and run it.
//
// The recipes import from '@dashevo/evo-sdk' and use Node-isms (process.exit,
// process.env, node:crypto). We rewrite the SDK import to the vendored WASM
// bundle, drop node: imports, and provide small shims. The rewritten code runs
// as a real ES module (via a Blob URL) so top-level await works exactly as in
// Node.

// Fully-qualified so it resolves cleanly from inside a blob: module (whose base
// URL is opaque). Falls back to a bare path outside the browser (Node tests pass
// their own sdkUrl).
const SDK_URL =
  (typeof location !== 'undefined' ? location.origin : '') + '/shared/vendor/evo-sdk.module.js';

// Rewrite imports + inject shims. Pure string work — also unit-tested in Node.
export function transform(source, { sdkUrl = SDK_URL, env = {} } = {}) {
  const evoImports = [];
  const importRe = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g;
  const body = source.replace(importRe, (_full, binding, spec) => {
    if (spec === '@dashevo/evo-sdk') {
      evoImports.push(`import ${binding.trim()} from '${sdkUrl}';`);
    }
    // '@dashevo/evo-sdk' is re-emitted at the top; node:* imports are dropped
    // (the shims below cover what the recipes actually use). Either way the
    // original import line is removed from the body.
    return '';
  });

  const shims = [
    // process.exit() must genuinely stop the recipe (some exit early). Throw a
    // sentinel the runner treats as a clean finish.
    `const process = { exit: () => { throw { __evoExit: true }; }, env: ${JSON.stringify(env)} };`,
    `const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));`,
  ].join('\n');

  return `${evoImports.join('\n')}\n${shims}\n${body}`;
}

// Point a recipe's EvoSDK factory calls at a network ('testnet' | 'mainnet').
// Only the factory identifiers and the bare `'testnet'`/`'mainnet'` string
// literals are touched — comments, log strings and example data (names, ids)
// are left as-is. Idempotent and direction-independent, so it's safe to run on
// code the user has already edited or already switched once.
export function applyNetwork(source, net) {
  return source
    .replace(/\b(?:testnet|mainnet)Trusted\b/g, `${net}Trusted`)          // EvoSDK.testnetTrusted()
    .replace(/(EvoSDK\s*\.\s*)(?:testnet|mainnet)(\s*\()/g, `$1${net}$2`)  // EvoSDK.testnet()  (proof mode)
    .replace(/(['"])(?:testnet|mainnet)\1/g, `$1${net}$1`);               // const NETWORK = 'testnet'
}

// Format a console arg the way a dev expects, including bigints.
export function fmt(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return `${v}n`;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? `${val}n` : val), 2);
  } catch {
    return String(v);
  }
}

// Run transformed recipe code as a module, streaming console output to onLog.
export async function runCode(source, { env = {}, onLog } = {}) {
  const code = transform(source, { env });
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const patch = (level) => (...args) => {
    onLog?.(level, args.map(fmt).join(' '));
    orig[level]?.(...args);
  };
  console.log = patch('log');
  console.info = patch('info');
  console.warn = patch('warn');
  console.error = patch('error');

  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    await import(/* @vite-ignore */ url);
  } catch (e) {
    if (!(e && e.__evoExit)) onLog?.('error', e?.message || String(e));
  } finally {
    Object.assign(console, orig);
    URL.revokeObjectURL(url);
  }
}
