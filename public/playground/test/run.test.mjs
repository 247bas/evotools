// Validates transform() + the "recipe runs against the vendored SDK" premise.
// Skips the browser Blob layer; imports the transformed code directly in Node.
// Run: node public/playground/test/run.test.mjs
import { transform, applyNetwork } from '../js/run.js';
import { pathToFileURL } from 'node:url';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SDK = pathToFileURL(
  '/home/pc/Desktop/Claude Code Projects/Dash/evotools/public/shared/vendor/evo-sdk.module.js',
).href;
const BASE = 'https://raw.githubusercontent.com/247bas/evo-cookbook/main/recipes/';

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed++; console.log(`  ❌ ${m}`); };

async function runRecipe(file, env = {}) {
  const src = await (await fetch(BASE + file)).text();
  const code = transform(src, { sdkUrl: SDK, env });
  const tmp = join(tmpdir(), `evo-pg-${file}-${process.pid}.mjs`);
  await writeFile(tmp, code, 'utf8');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let exitedClean = false;
  try {
    await import(pathToFileURL(tmp).href);
  } catch (e) {
    if (e && e.__evoExit) exitedClean = true;
    else { console.log = orig; throw e; }
  } finally {
    console.log = orig;
    await rm(tmp, { force: true });
  }
  return { out: lines.join('\n'), exitedClean };
}

console.log('\n1. recipe 01-connect (transform + run vs vendored SDK)');
const r1 = await runRecipe('01-connect.mjs');
r1.out.includes('connected: true') ? ok('printed "connected: true"') : bad(`missing connect output:\n${r1.out}`);
r1.exitedClean ? ok('process.exit() shim stopped it cleanly') : bad('did not hit __evoExit');

console.log('\n2. recipe 10-identity-from-address, no env (multi-line import + node:crypto shim)');
const r10 = await runRecipe('10-identity-from-address.mjs', {});
r10.out.includes('New testnet wallet generated') ? ok('ran the no-mnemonic branch (generated a wallet)') : bad(`unexpected:\n${r10.out}`);
/tdash1[a-z0-9]+/.test(r10.out) ? ok('printed a platform address') : bad('no platform address in output');
r10.out.includes('bridge.thepasta.org') ? ok('printed the funding URL') : bad('no funding URL');
r10.exitedClean ? ok('exited cleanly at process.exit(0)') : bad('did not exit cleanly');

console.log('\n3. applyNetwork() rewrites the SDK factory, not comments/data');
{
  const t = [
    `const NETWORK = 'testnet';`,
    `const sdk = EvoSDK.testnetTrusted();`,
    `const proof = EvoSDK.testnet();`,
    `// a long-lived testnet identity stays a comment`,
    `console.log('New testnet wallet generated');`,
  ].join('\n');
  const m = applyNetwork(t, 'mainnet');
  m.includes('EvoSDK.mainnetTrusted()') ? ok('testnetTrusted → mainnetTrusted') : bad('trusted factory not switched');
  m.includes('EvoSDK.mainnet()') ? ok('proof-mode testnet() → mainnet()') : bad('proof factory not switched');
  m.includes("NETWORK = 'mainnet'") ? ok("NETWORK = 'testnet' literal switched") : bad('network literal not switched');
  m.includes('// a long-lived testnet identity stays a comment') ? ok('comment left untouched') : bad('rewrote a comment');
  m.includes("'New testnet wallet generated'") ? ok('log substring left untouched') : bad('rewrote a log substring');
  applyNetwork(m, 'testnet') === t ? ok('round-trips back to the testnet original') : bad('not reversible');
}

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
