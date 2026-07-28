// Smoke test: exercises the real app modules against testnet, up to (but not
// including) broadcasting. Run: node test/smoke.mjs
import { readFileSync } from 'node:fs';
import {
  generateWallet, deriveIdentityKeys, keySpecs,
  generateIdentityMnemonic, platformAddressFromWif, isValidMnemonic, deriveFundingAddress,
} from '../js/wallet.js';
import { loadEvo, getSdk, setNetwork } from '../js/sdk.js';
import {
  getAddressBalance, checkUsername, fundAddressFromIdentity, verifyIdentityKeys,
} from '../js/platform.js';
import { deriveAll } from '../../keygen/js/keys.js';
import { qrMatrix } from '../../shared/qr.js';

const ok = (m) => console.log(`  ✅ ${m}`);
const info = (m) => console.log(`  ·  ${m}`);
let failed = 0;
const check = (cond, m) => cond ? ok(m) : (failed++, console.log(`  ❌ ${m}`));

console.log('\n1. Wallet generation (offline)');
const w = await generateWallet();
check(typeof w.mnemonic === 'string' && w.mnemonic.split(' ').length >= 12, `mnemonic (${w.mnemonic.split(' ').length} words)`);
check(w.address.startsWith('tdash1'), `platform address ${w.address}`);
check(typeof w.addressPrivateKeyWif === 'string' && w.addressPrivateKeyWif.length > 40, 'funding key WIF present');

// Funding money arrives from a phone or an exchange page, so step 2 shows the
// layer-1 address as a QR next to the copy button.
const qrWallet = qrMatrix(w.coreAddress);
check(qrWallet.size === qrWallet.modules.length, `QR of the Dash address, ${qrWallet.size}×${qrWallet.size} modules`);
check(qrMatrix('X'.repeat(34)).modules.some((row, r) => row.some((m, c) => m !== qrWallet.modules[r]?.[c])), 'another address gives another code');

console.log('\n2. Identity key derivation (DIP-13)');
const derived = await deriveIdentityKeys(w.mnemonic);
const specs = await keySpecs();
check(derived.length === 5, `derived ${derived.length} keys`);
check(derived.every((d, i) => d.spec.keyId === specs[i].keyId), 'key ids 0..4 in order');
check(derived.every((d) => /^[0-9a-f]{66}$/.test(d.publicKeyHex)), 'each public key is 33-byte compressed hex');

console.log('\n3. Build identity shell + signers (WASM object construction)');
const Evo = await loadEvo();
const { Identity, Identifier, IdentityPublicKeyInCreation, IdentitySigner, PlatformAddressSigner, PrivateKey, KeyType } = Evo;
const hexToBytes = (h) => Uint8Array.from(h.match(/.{2}/g), (b) => parseInt(b, 16));
const id = typeof Identifier.random === 'function' ? Identifier.random() : new Identifier(crypto.getRandomValues(new Uint8Array(32)));
const identity = new Identity(id);
for (const d of derived) {
  identity.addPublicKey(new IdentityPublicKeyInCreation({
    keyId: d.spec.keyId, purpose: d.spec.purpose, securityLevel: d.spec.securityLevel,
    keyType: KeyType.ECDSA_SECP256K1, data: hexToBytes(d.publicKeyHex),
  }).toIdentityPublicKey());
}
ok('identity shell built with 5 public keys');
const isigner = new IdentitySigner();
for (const d of derived) isigner.addKeyFromWif(d.privateKeyWif);
ok('IdentitySigner accepted all 5 WIFs');
const asigner = new PlatformAddressSigner();
asigner.addKey(PrivateKey.fromWIF(w.addressPrivateKeyWif));
ok('PlatformAddressSigner accepted funding key');

console.log('\n4. Connect + read address balance (network)');
await getSdk();
ok('connected to testnet');
const bal = await getAddressBalance(w.address);
check(typeof bal === 'bigint', `fresh address balance = ${bal} credits (expected 0n)`);

console.log('\n5. DPNS checks (network)');
const rnd = 'evo-onboard-' + Math.random().toString(36).slice(2, 8);
const good = await checkUsername(rnd);
check(good.valid && good.available, `random name "${rnd}" valid+available`);
const badChars = await checkUsername('-bad-');
check(badChars.valid === false, 'invalid name "-bad-" rejected');
const dashTaken = await checkUsername('dash');
info(`"dash" -> valid=${dashTaken.valid} available=${dashTaken.available} contested=${dashTaken.contested}`);

console.log('\n6. Mainnet mode: own funding key, no wallet generated (network)');
setNetwork('mainnet');
const mainKey = Evo.PrivateKey.fromBytes(crypto.getRandomValues(new Uint8Array(32)), 'mainnet');
const byo = await platformAddressFromWif(mainKey.toWIF());
check(byo.address.startsWith('dash1'), `WIF -> mainnet platform address ${byo.address}`);
check(byo.addressPrivateKeyWif === mainKey.toWIF(), 'funding WIF passed through untouched');
try { await platformAddressFromWif('not-a-wif'); failed++; console.log('  ❌ garbage WIF accepted'); }
catch (e) { check(/valid WIF/.test(e.message), `garbage WIF rejected — ${e.message}`); }

const mainMnemonic = await generateIdentityMnemonic();
const mainKeys = await deriveIdentityKeys(mainMnemonic);
check(mainKeys.length === 5 && mainKeys.every((d) => /^[0-9a-f]{66}$/.test(d.publicKeyHex)), 'DIP-13 mainnet identity keys derived');
check(mainKeys[0].privateKeyWif !== derived[0].privateKeyWif, 'mainnet keys differ from the testnet ones');
await getSdk();
const mainBal = await getAddressBalance(byo.address);
check(typeof mainBal === 'bigint' && mainBal === 0n, `fresh mainnet address balance = ${mainBal} credits`);

console.log('\n6b. A phrase made in keygen produces the same identity keys here');
check((await isValidMnemonic(mainMnemonic)) === true, 'a real phrase is accepted');
check((await isValidMnemonic('this is not a mnemonic at all')) === false, 'a broken phrase is refused');
const fromKeygen = await deriveAll(mainMnemonic, 'mainnet');
const viaOnboard = await deriveIdentityKeys(mainMnemonic); // still on mainnet from step 6
check(
  viaOnboard.length === 5 && viaOnboard.every((d, i) => d.privateKeyWif === fromKeygen.keys[i].wif),
  'onboard derives exactly the keys keygen showed offline',
);
check(
  viaOnboard.every((d, i) => d.publicKeyHex === fromKeygen.keys[i].publicKeyHex),
  'and the same public keys, so the minted identity carries them',
);
// EVO_PRIVATE_WIF is the CRITICAL identity key, not the funding key — one signs,
// the other pays, and they sit on different paths. Mistaking one for the other
// makes a correct handover look broken.
const envWif = viaOnboard.find((d) => d.spec.keyId === 2).privateKeyWif;
check(envWif === fromKeygen.keys[2].wif, "the .env key is keygen's identity key #2");
check(envWif !== fromKeygen.fundingWif, 'and is not the funding key keygen shows above it');
check(viaOnboard.every((d) => d.path?.startsWith("m/9'")), `identity keys carry their path (${viaOnboard[2].path})`);
check(fromKeygen.fundingPath.startsWith("m/44'"), `while funding lives on ${fromKeygen.fundingPath}`);

console.log('\n6c. Telling a one-phrase setup from a two-key one');
// What the wallet step claims on screen: derive the funding address the phrase
// would produce and compare it with the address actually in use.
setNetwork('testnet');
const own = await generateWallet();
const fromOwnPhrase = await deriveFundingAddress(own.mnemonic);
check(fromOwnPhrase.address === own.address, 'a generated wallet: phrase and funding key match');
setNetwork('mainnet');
const strangerKey = Evo.PrivateKey.fromBytes(crypto.getRandomValues(new Uint8Array(32)), 'mainnet');
const strangerAddr = (await platformAddressFromWif(strangerKey.toWIF())).address;
const fromMainPhrase = await deriveFundingAddress(mainMnemonic);
check(fromMainPhrase.address !== strangerAddr, 'a supplied key: phrase and funding key are separate');
check(typeof (await platformAddressFromWif(strangerKey.toWIF())).coreAddress === 'string', 'a supplied key also yields its layer-1 address');

console.log('\n6d. transferFromIdentity is called the way the SDK wants it');
// Verified live on testnet: it needs the fetched Identity, not an id, and the
// error ("'identity' is required") does not say which. A regex here because the
// call itself moves credits, which a smoke test should not do on every run.
const platformSrc = readFileSync(new URL('../js/platform.js', import.meta.url), 'utf8');
const transferCall = platformSrc.slice(platformSrc.indexOf('transferFromIdentity({'));
check(/transferFromIdentity\(\{\s*\n\s*identity,/.test(transferCall), 'the fetched Identity object is passed');
check(!/transferFromIdentity\(\{[^}]*identityId,/.test(transferCall), 'not the bare id, which the SDK rejects');
check(/outputs: \[\{ address, amount \}\]/.test(transferCall), 'outputs are plain objects carrying an amount');

console.log('\n7. Mainnet funding guard: wrong key is refused before broadcast');
try {
  await fundAddressFromIdentity({
    identityId: 'CkKwW6VVEvo1EEps7NERZADE13ZWUwwz7kkuZentxVuj', // bas.dash
    transferWif: mainKey.toWIF(),
    address: byo.address,
    amount: 100_000n,
  });
  failed++; console.log('  ❌ transfer with a foreign key was not refused');
} catch (e) {
  check(/not the TRANSFER key/.test(e.message), `foreign key refused — ${e.message}`);
}

// The last screen hands over a phrase and a set of keys. If the phrase changed
// after the identity was minted, both still look perfectly normal and neither
// opens anything — so the screen checks itself against the chain.
console.log('\n8. The handover is checked against the identity on chain');
const BAS = 'CkKwW6VVEvo1EEps7NERZADE13ZWUwwz7kkuZentxVuj'; // bas.dash, mainnet
const strangerPhrase = await generateIdentityMnemonic();
const strangerKeys = await deriveIdentityKeys(strangerPhrase);
const foreign = await verifyIdentityKeys({ identityId: BAS, mnemonic: strangerPhrase, derived: strangerKeys });
check(foreign.phraseMatches === true, 'a phrase that derives the keys shown is accepted as consistent');
check(foreign.keysMatch === false, `keys from another phrase are not the ones on ${BAS.slice(0, 8)}… (${foreign.checked} checked)`);

const swapped = await verifyIdentityKeys({
  identityId: BAS,
  mnemonic: await generateIdentityMnemonic(), // the phrase that got swapped in
  derived: strangerKeys,                      // the keys the identity was built from
});
check(swapped.phraseMatches === false, 'a phrase that does not derive those keys is caught');

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
