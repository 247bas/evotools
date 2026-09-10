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
const refusesTo = async (fn, want, label) => {
  try { await fn(); failed++; console.log(`  ❌ ${label}: did not refuse`); }
  catch (e) { check(String(e.message).includes(want), `${label} — ${e.message.slice(0, 80)}`); }
};
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

console.log('\n9. Adding a key to an identity that already exists');
{
  const { buildAddKeyTransition, missingRoles } = await import('../js/keys.js');
  const Evo = await import('../../shared/vendor/evo-sdk.module.js');
  const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  const built = await buildAddKeyTransition({
    mnemonic: PHRASE, network: 'testnet',
    identityId: 'GLFyDxwzoKBC1dr9HQYtrYCJfoDeNjm3JA2EGKZyjgn7',
    revision: 2, nonce: 5, masterKeyId: 0, newKeyId: 4,
  });
  check(/^[0-9a-f]+$/.test(built.hex), `built a signed transition, ${built.hex.length} hex chars`);
  check(built.added.path === "m/9'/1'/5'/0'/0'/0'/4'", `the new key comes off ${built.added.path}`);

  // The two signatures are the whole point. The master's says who authorised
  // the change; the added key's proves whoever added it holds it. Both have to
  // survive serialisation, and the second one only does when it is set on the
  // key before the transition is built — writing to publicKeyIdsToAdd
  // afterwards is lost, which is the trap this pins.
  const back = Evo.IdentityUpdateTransition.fromStateTransition(Evo.StateTransition.fromHex(built.hex));
  const object = back.toObject();
  check(object.signature?.length === 65, `master signature carried: ${object.signature?.length} bytes, key #${object.signaturePublicKeyId}`);
  check(object.addPublicKeys?.[0]?.signature?.length === 65, `proof of possession carried: ${object.addPublicKeys?.[0]?.signature?.length} bytes`);
  check(object.signaturePublicKeyId === 0, 'signed by the master key, which is the only key an identity update accepts');

  // Straight from the SDK rather than from memory: what each transition needs.
  const levels = back.toStateTransition().getKeyLevelRequirement('AUTHENTICATION');
  check(JSON.stringify(levels) === '["MASTER"]', `an identity update requires ${JSON.stringify(levels)}`);

  // Which of the five an identity is missing, and whether the slot is free.
  const lynx = [
    { keyId: 0, purpose: 'AUTHENTICATION', securityLevel: 'MASTER' },
    { keyId: 1, purpose: 'AUTHENTICATION', securityLevel: 'HIGH' },
    { keyId: 2, purpose: 'ENCRYPTION', securityLevel: 'MEDIUM' },
    { keyId: 3, purpose: 'TRANSFER', securityLevel: 'CRITICAL' },
  ];
  const missing = missingRoles(lynx);
  check(missing.length === 1 && missing[0].securityLevel === 'CRITICAL',
    'thedesertlynx.dash is missing exactly the CRITICAL authentication key');
  check(missing[0].slotTaken === true, 'and its usual slot #2 is taken, so a new key needs a free one');
  check(missingRoles([]).length === 5, 'an empty identity is missing all five');

  // Contract bounds. A key bound to a contract works only there, which is what
  // DashPay's contact requests demand — and what makes the key useless if it
  // leaks. Both shapes have to survive the hex, the same way the signatures do.
  const DASHPAY = 'Bwr4WHCPz5rFVAD87RqTs3izo4zpzwsEdKPWUT1NS1C7';
  const bound = await buildAddKeyTransition({
    mnemonic: PHRASE, network: 'mainnet',
    identityId: 'BC6nzq4iDzknwaUQEei3HSNfVQ9FQgFRDGvUPRCyGEfA',
    revision: 2, nonce: 5, masterKeyId: 0, newKeyId: 4,
    purpose: 'ENCRYPTION', securityLevel: 'MEDIUM',
    boundContractId: DASHPAY, boundDocumentType: 'contactRequest',
  });
  const boundBack = Evo.IdentityUpdateTransition
    .fromStateTransition(Evo.StateTransition.fromHex(bound.hex)).publicKeyIdsToAdd[0];
  check(String(boundBack.contractBounds?.identifier) === DASHPAY, 'a bound key carries its contract through the hex');
  check(boundBack.contractBounds?.documentTypeName === 'contactRequest', 'and the document type it is bound to');
  check(boundBack.contractBounds?.contractBoundsType === 'documentType', 'as a documentType bound, not a whole-contract one');
  check(boundBack.purpose === 'ENCRYPTION', 'with the purpose it was asked for');
  check(boundBack.signature?.length === 65, 'and still its proof of possession, which the bound changes the bytes of');

  const wholeContract = await buildAddKeyTransition({
    mnemonic: PHRASE, network: 'mainnet',
    identityId: 'BC6nzq4iDzknwaUQEei3HSNfVQ9FQgFRDGvUPRCyGEfA',
    revision: 2, nonce: 5, masterKeyId: 0, newKeyId: 4, boundContractId: DASHPAY,
  });
  const wholeBack = Evo.IdentityUpdateTransition
    .fromStateTransition(Evo.StateTransition.fromHex(wholeContract.hex)).publicKeyIdsToAdd[0];
  check(wholeBack.contractBounds?.contractBoundsType === 'singleContract', 'no document type gives a whole-contract bound');

  const unbound = Evo.IdentityUpdateTransition
    .fromStateTransition(Evo.StateTransition.fromHex(built.hex)).publicKeyIdsToAdd[0];
  check(!unbound.contractBounds, 'and a key asked for without a bound has none, rather than an empty one');

  // A pasted master key is the route for an identity that never came from a
  // phrase — Dash Evo Tool hands out keys, not phrases. Both routes have to
  // reach the same key, or the check against the identity is meaningless.
  const masterKey = await Evo.wallet.deriveKeyFromSeedWithPath({
    mnemonic: PHRASE, path: "m/9'/1'/5'/0'/0'/0'/0'", network: 'testnet',
  });
  const common = {
    network: 'testnet', identityId: 'GLFyDxwzoKBC1dr9HQYtrYCJfoDeNjm3JA2EGKZyjgn7',
    revision: 2, nonce: 5, masterKeyId: 0, newKeyId: 5,
  };
  const viaPhrase = await buildAddKeyTransition({ ...common, mnemonic: PHRASE });
  const viaWif = await buildAddKeyTransition({ ...common, masterWif: masterKey.privateKeyWif });
  check(viaWif.masterKeyHash === viaPhrase.masterKeyHash,
    'a pasted master key reaches the same key as deriving it from the phrase');
  check(viaWif.generated === true && viaPhrase.generated === false,
    'with no phrase and no key given, one is generated; with a phrase it is derived');
  check(/^[59KLc]/.test(viaWif.added.wif), 'and the generated key comes back as a WIF, the only copy of it');

  const supplied = await Evo.wallet.generateKeyPair('testnet');
  const viaBoth = await buildAddKeyTransition({
    ...common, masterWif: masterKey.privateKeyWif, newKeyWif: supplied.privateKeyWif,
  });
  check(viaBoth.added.wif === supplied.privateKeyWif, 'a key you already hold can be added as it is');
  check(viaBoth.generated === false, 'and is not reported as generated');

  await refusesTo(() => buildAddKeyTransition({ ...common }),
    'recovery phrase or the private key', 'neither a phrase nor a master key');
  await refusesTo(() => buildAddKeyTransition({ ...common, masterWif: 'not-a-wif' }),
    'master key is not a valid WIF', 'a master key that is not a WIF');
  await refusesTo(() => buildAddKeyTransition({ ...common, masterWif: masterKey.privateKeyWif, newKeyWif: 'not-a-wif' }),
    'new key is not a valid WIF', 'a new key that is not a WIF');

  await refusesTo(() => buildAddKeyTransition({
    mnemonic: PHRASE, network: 'testnet', identityId: 'GLFyDxwzoKBC1dr9HQYtrYCJfoDeNjm3JA2EGKZyjgn7',
    revision: 2, nonce: 5, masterKeyId: 0, newKeyId: 0,
  }), 'master key', 'adding a key into the master key\'s own slot');
}

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
