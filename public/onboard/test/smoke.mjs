// Smoke test: exercises the real app modules against testnet, up to (but not
// including) broadcasting. Run: node test/smoke.mjs
import { generateWallet, deriveIdentityKeys, keySpecs } from '../js/wallet.js';
import { loadEvo, getSdk } from '../js/sdk.js';
import { getAddressBalance, checkUsername } from '../js/platform.js';

const ok = (m) => console.log(`  ✅ ${m}`);
const info = (m) => console.log(`  ·  ${m}`);
let failed = 0;
const check = (cond, m) => cond ? ok(m) : (failed++, console.log(`  ❌ ${m}`));

console.log('\n1. Wallet generation (offline)');
const w = await generateWallet();
check(typeof w.mnemonic === 'string' && w.mnemonic.split(' ').length >= 12, `mnemonic (${w.mnemonic.split(' ').length} words)`);
check(w.address.startsWith('tdash1'), `platform address ${w.address}`);
check(typeof w.addressPrivateKeyWif === 'string' && w.addressPrivateKeyWif.length > 40, 'funding key WIF present');

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

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
