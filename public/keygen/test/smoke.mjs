// Smoke test for keygen: derivation is offline and deterministic, the QR encodes
// the address, and the result matches what onboard derives from the same phrase.
// Run: node public/keygen/test/smoke.mjs
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { generateMnemonic, isValidMnemonic, deriveAll, derivationSnippet } from '../js/keys.js';
import { qrMatrix } from '../../shared/qr.js';
import {
  buildOfflineHtml, extractMarkup, SDK_SPECIFIER, KEYS_SPECIFIER, QR_SPECIFIER,
} from '../js/offline.js';
import { deriveFundingAddress, deriveIdentityKeys } from '../../onboard/js/wallet.js';
import { setNetwork } from '../../onboard/js/sdk.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (cond, m) => (cond ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));

console.log('\n1. Generate + derive (offline)');
const mnemonic = await generateMnemonic();
check(mnemonic.split(' ').length >= 12, `mnemonic (${mnemonic.split(' ').length} words)`);
const main = await deriveAll(mnemonic, 'mainnet');
const test = await deriveAll(mnemonic, 'testnet');
check(main.address.startsWith('dash1'), `mainnet address ${main.address}`);
check(test.address.startsWith('tdash1'), `testnet address ${test.address}`);
check(main.address !== test.address, 'the two networks derive different addresses');
check(main.keys.length === 5 && main.keys.every((k) => /^[0-9a-f]{66}$/.test(k.publicKeyHex)), '5 identity keys with 33-byte public keys');
check(main.fundingPath === "m/44'/5'/0'/0/0", `funding path ${main.fundingPath}`);
check(main.keys[2].path === "m/9'/5'/5'/0'/0'/0'/2'", `critical key path ${main.keys[2].path}`);

console.log('\n2. Deterministic — same phrase, same keys');
const again = await deriveAll(mnemonic, 'mainnet');
check(again.address === main.address && again.keys.every((k, i) => k.wif === main.keys[i].wif), 'a second run reproduces every key');

console.log('\n3. Matches onboard, so the two tools agree');
for (const network of ['mainnet', 'testnet']) {
  setNetwork(network);
  const viaOnboard = await deriveFundingAddress(mnemonic);
  const viaKeygen = network === 'mainnet' ? main : test;
  check(viaOnboard.address === viaKeygen.address, `${network}: same funding address as onboard`);
  const onboardKeys = await deriveIdentityKeys(mnemonic);
  check(
    onboardKeys.every((d, i) => d.privateKeyWif === viaKeygen.keys[i].wif),
    `${network}: same 5 identity keys as onboard`,
  );
}

console.log('\n4. Rejects a broken phrase');
check((await isValidMnemonic('not really a mnemonic at all')) === false, 'garbage phrase rejected');
check((await isValidMnemonic(mnemonic)) === true, 'generated phrase accepted');

console.log('\n5. QR encodes the address');
const qr = qrMatrix(main.address);
check(qr.size === qr.modules.length && qr.modules.every((r) => r.length === qr.size), `square matrix ${qr.size}×${qr.size}`);
const finder = qr.modules[0].slice(0, 7).every(Boolean) && qr.modules[6].slice(0, 7).every(Boolean);
check(finder, 'finder pattern present in the top-left corner');
check(qrMatrix(test.address).size >= 21, 'testnet address encodes too');

console.log('\n6. Offline copy assembles and stays sealed');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sources = {
  page: read('../index.html'),
  theme: read('../../shared/theme.css'),
  css: read('../css/keygen.css'),
  appJs: read('../js/app.js'),
  keysJs: read('../js/keys.js'),
  qrJs: read('../../shared/qr.js'),
  sdk: read('../../shared/vendor/evo-sdk.module.js'),
};
// The page fetches those same sources by URL to build the copy in the browser,
// and this test reads them from disk — so a file that moves passes here while
// the download 404s in production. Check the URLs the page actually asks for.
const fetched = [...sources.appJs.matchAll(/fetchText\('([^']+)'\)/g)].map((m) => m[1]);
check(fetched.length === 7, `the offline build fetches ${fetched.length} sources`);
for (const url of fetched) {
  // The site is served from public/, which is two levels up from this test.
  check(existsSync(new URL(`../..${url}`, import.meta.url)), `${url} exists where the page asks for it`);
}

// The bootstrap rewires imports by string replacement — if a specifier ever
// changes, the offline copy breaks silently, so assert they still match.
check(sources.keysJs.includes(SDK_SPECIFIER), `keys.js still imports ${SDK_SPECIFIER}`);
check(sources.appJs.includes(KEYS_SPECIFIER), `app.js still imports ${KEYS_SPECIFIER}`);
check(sources.appJs.includes(QR_SPECIFIER), `app.js still imports ${QR_SPECIFIER}`);

const html = buildOfflineHtml(sources);
check(html.includes("connect-src 'none'"), 'the copy forbids every network request');
check(['src-sdk', 'src-qr', 'src-keys', 'src-app'].every((id) => html.includes(`id="${id}"`)), 'all four sources are inlined');
check(!html.includes('src="/shared/nav.js"') && !html.includes('src="js/app.js"'), 'no external script tags survive');
check(html.includes('id="genBtn"') && html.includes('id="downloadBtn"'), 'the markup came along');
check(!html.includes(mnemonic), 'no generated phrase leaked into the copy');
const mb = Buffer.byteLength(html) / 1e6;
check(mb > 8 && mb < 20, `one file of ${mb.toFixed(1)} MB`);
let markupThrew = false;
try { extractMarkup('<html><body>nothing here</body></html>'); } catch { markupThrew = true; }
check(markupThrew, 'a page without the wrapper is refused instead of silently truncated');

console.log('\n7. Printing includes the private keys even when collapsed');
check(/beforeprint/.test(sources.appJs) && /secretBlock'\)\.open = true/.test(sources.appJs), 'app.js opens the key section before printing');
check(sources.appJs.includes("printing.addEventListener") || sources.appJs.includes('matchMedia'), 'a media-query fallback exists for browsers without beforeprint');
check(!/@media print[\s\S]*#secretBlock\s*{\s*display:\s*block/.test(sources.css), 'the print stylesheet no longer pretends CSS can open a <details>');
check(sources.page.includes('kg-printonly') && /\.kg-printonly\s*{\s*display:\s*block/.test(sources.css), 'the print-only heading exists and is shown in print');

console.log('\n8. The SDK snippet in the dropdown actually runs');
// Take the code we show developers, point the import at the vendored SDK, feed
// it the phrase from step 1, and check it lands on the same address.
for (const network of ['mainnet', 'testnet']) {
  const expected = network === 'mainnet' ? main : test;
  const runnable = derivationSnippet(network)
    .replace("'@dashevo/evo-sdk'", "'../../shared/vendor/evo-sdk.module.js'")
    .replace('const mnemonic = await wallet.generateMnemonic();', `const mnemonic = ${JSON.stringify(mnemonic)};`)
    + '\nexport const out = { address, fundingWif, identityKeys };\n';
  const tmp = new URL(`./.snippet-${network}.mjs`, import.meta.url);
  writeFileSync(tmp, runnable);
  try {
    const { out } = await import(tmp.href);
    check(out.address === expected.address, `${network}: snippet derives ${out.address}`);
    check(out.fundingWif === expected.fundingWif, `${network}: snippet derives the same funding key`);
    check(
      out.identityKeys.length === 5 && out.identityKeys.every((k, i) => k.privateKeyWif === expected.keys[i].wif),
      `${network}: snippet derives the same 5 identity keys`,
    );
  } catch (e) {
    failed++;
    console.log(`  ❌ ${network}: snippet failed to run — ${e?.message || e}`);
  } finally {
    rmSync(tmp, { force: true });
  }
}

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
