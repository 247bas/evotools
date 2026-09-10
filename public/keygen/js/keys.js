// Offline key derivation. Every call here runs inside the WASM SDK — no network,
// no SDK connection. The network is always an explicit argument so nothing
// depends on shared state.
//
// The specifier below is a plain string on purpose: the offline single-file copy
// rewrites it to a blob URL holding the same SDK source.
const SDK_URL = '../../shared/vendor/evo-sdk.module.js';

let _evo = null;
export async function loadEvo() {
  if (!_evo) _evo = await import(SDK_URL);
  return _evo;
}

// The 5 standard identity keys (DIP-9/DIP-13 layout, same as Dash Evo Tool).
export const KEY_ROLES = [
  { keyId: 0, purpose: 'AUTHENTICATION', securityLevel: 'MASTER', label: 'Master', use: 'changes the identity itself' },
  { keyId: 1, purpose: 'AUTHENTICATION', securityLevel: 'HIGH', label: 'High', use: 'signs documents and names' },
  { keyId: 2, purpose: 'AUTHENTICATION', securityLevel: 'CRITICAL', label: 'Critical', use: 'signs documents and names' },
  { keyId: 3, purpose: 'TRANSFER', securityLevel: 'CRITICAL', label: 'Transfer', use: 'moves credits out' },
  { keyId: 4, purpose: 'ENCRYPTION', securityLevel: 'MEDIUM', label: 'Encryption', use: 'encrypts messages' },
];

export async function generateMnemonic() {
  const { wallet } = await loadEvo();
  return wallet.generateMnemonic();
}

export async function isValidMnemonic(mnemonic) {
  const { wallet } = await loadEvo();
  try { return await wallet.validateMnemonic(mnemonic); } catch { return false; }
}

// Funding path: BIP44 m/44'/{5|1}'/0'/0/0 → bech32m platform address.
async function fundingPath(network) {
  const { wallet } = await loadEvo();
  return network === 'mainnet'
    ? wallet.derivationPathBip44Mainnet(0, 0, 0)
    : wallet.derivationPathBip44Testnet(0, 0, 0);
}

// Identity path base: DIP-13 m/9'/{5|1}'/5'.
async function identityBase(network) {
  const { wallet } = await loadEvo();
  return network === 'mainnet'
    ? wallet.derivationPathDip13Mainnet(5)
    : wallet.derivationPathDip13Testnet(5);
}

// The SDK calls behind this page, as copy-paste code. Lives here rather than in
// the UI so the smoke test can run it and prove the snippet is not fiction.
export function derivationSnippet(network) {
  const suffix = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  const coin = network === 'mainnet' ? '5' : '1';
  return `import { wallet, PrivateKey, PlatformAddressSigner } from '@dashevo/evo-sdk';

// Nothing here touches the network: no EvoSDK instance, no connect().
// This is why the page keeps working with the cable pulled out.
const mnemonic = await wallet.generateMnemonic();

// Funding key — BIP44 m/44'/${coin}'/0'/0/0 — becomes the address that pays.
const funding = await wallet.derivationPathBip44${suffix}(0, 0, 0);
const fundingKey = await wallet.deriveKeyFromSeedWithPath({
  mnemonic, path: funding.path, network: '${network}',
});
const { privateKeyWif: fundingWif, publicKey } = fundingKey.toObject();
const address = new PlatformAddressSigner()
  .addKey(PrivateKey.fromWIF(fundingWif))
  .toBech32m('${network}');   // ${network === 'mainnet' ? 'dash1…' : 'tdash1…'}

// Same key, ordinary Dash address — this is the one any wallet can pay.
const coreAddress = await wallet.pubkeyToAddress(publicKey, '${network}');

// The five identity keys — DIP-13 m/9'/${coin}'/5'/0'/0'/0'/{keyId}
// 0 MASTER · 1 HIGH · 2 CRITICAL (authentication) · 3 TRANSFER · 4 ENCRYPTION
const base = await wallet.derivationPathDip13${suffix}(5);
const identityKeys = [];
for (const keyId of [0, 1, 2, 3, 4]) {
  const key = await wallet.deriveKeyFromSeedWithPath({
    mnemonic, path: \`\${base.path}/0'/0'/0'/\${keyId}'\`, network: '${network}',
  });
  identityKeys.push(key.toObject()); // { publicKey, privateKeyWif }
}

// Next step lives in /onboard and does need a connected SDK:
// sdk.addresses.createIdentity({ identity, inputs: [{ address, amount }], … })`;
}

// Everything a person needs to write down, derived from one phrase.
export async function deriveAll(mnemonic, network) {
  const Evo = await loadEvo();
  const { wallet, PrivateKey, PlatformAddressSigner } = Evo;

  const fp = await fundingPath(network);
  const fundingKey = await wallet.deriveKeyFromSeedWithPath({ mnemonic, path: fp.path, network });
  const { privateKeyWif: fundingWif, publicKey: fundingPublicKey } = fundingKey.toObject();
  const address = new PlatformAddressSigner().addKey(PrivateKey.fromWIF(fundingWif)).toBech32m(network);
  // The same key also has an ordinary Dash address — same public key hash, other
  // encoding. That is the one any wallet can pay, which is how coins get in.
  const coreAddress = await wallet.pubkeyToAddress(fundingPublicKey, network);

  const base = await identityBase(network);
  const keys = await Promise.all(KEY_ROLES.map(async (role) => {
    const path = `${base.path}/0'/0'/0'/${role.keyId}'`;
    const k = await wallet.deriveKeyFromSeedWithPath({ mnemonic, path, network });
    const obj = k.toObject();
    return { ...role, path, wif: obj.privateKeyWif, publicKeyHex: obj.publicKey };
  }));

  return { mnemonic, network, address, coreAddress, fundingPath: fp.path, fundingWif, keys };
}

/* ------------------------------------------------------------------ *
 * Adding a key to an identity that already exists
 *
 * An identity's key set is not fixed at creation. `IdentityUpdate` adds keys,
 * and it is the one transition the MASTER key signs — the SDK says so itself:
 * `getKeyLevelRequirement('AUTHENTICATION')` on an update returns ["MASTER"],
 * where a contract create returns ["CRITICAL","HIGH"]. So the master key, which
 * can sign nothing else, exists for exactly this.
 *
 * It only goes one way. The SDK's own note on `disablePublicKeys`: "Cannot
 * disable master, critical auth, or transfer keys." A CRITICAL authentication
 * key you add can never be taken off again, so it had better be one you keep.
 *
 * Nothing below touches the network, which is the point: the phrase stays on
 * the machine that holds it and only a signed transition travels. What the
 * chain has to supply — the identity's revision, its nonce, and which key is
 * the master — are arguments, so an offline copy can be handed them on paper.
 * ------------------------------------------------------------------ */

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));

/**
 * Build and sign an IdentityUpdate that adds one key. No network, no SDK
 * connection — the same guarantee the rest of this file makes.
 *
 * Returns the signed transition as hex, ready to be broadcast from anywhere,
 * plus the key that was added so it can be written down before it is used.
 */
export async function buildAddKeyTransition({
  mnemonic, network, identityId, revision, nonce,
  masterKeyId = 0, newKeyId, purpose = 'AUTHENTICATION', securityLevel = 'CRITICAL',
}) {
  const Evo = await loadEvo();
  const {
    wallet, PrivateKey, IdentityPublicKey, IdentityPublicKeyInCreation,
    IdentityUpdateTransition, KeyType,
  } = Evo;

  if (!Number.isInteger(newKeyId) || newKeyId < 0) throw new Error('The new key needs a key id.');
  if (newKeyId === masterKeyId) throw new Error('That slot is the master key.');

  const base = await identityBase(network);
  const at = async (keyId) => {
    const path = `${base.path}/0'/0'/0'/${keyId}'`;
    const k = await wallet.deriveKeyFromSeedWithPath({ mnemonic, path, network });
    return { path, ...k.toObject() };
  };

  const master = await at(masterKeyId);
  const fresh = await at(newKeyId);

  const added = new IdentityPublicKeyInCreation({
    keyId: newKeyId,
    purpose,
    securityLevel,
    keyType: KeyType.ECDSA_SECP256K1,
    data: hexToBytes(fresh.publicKey),
  });

  // Proof of possession: the key being added signs the transition, proving
  // whoever adds it holds it. Two things about this are easy to get wrong.
  // It has to be signed over the transition with the key signatures still
  // empty, or the bytes change under it; and it has to be set on the key
  // object *before* the transition is built, because `publicKeyIdsToAdd` hands
  // back copies and writing to those is lost at serialisation.
  const probe = new IdentityUpdateTransition({
    identityId, revision: BigInt(revision), nonce: BigInt(nonce),
    addPublicKeys: [added], disablePublicKeys: [],
  }).toStateTransition();
  probe.signByPrivateKey(PrivateKey.fromWIF(fresh.privateKeyWif), newKeyId, KeyType.ECDSA_SECP256K1);
  added.signature = probe.signature;

  const transition = new IdentityUpdateTransition({
    identityId, revision: BigInt(revision), nonce: BigInt(nonce),
    addPublicKeys: [added], disablePublicKeys: [],
  }).toStateTransition();

  const masterPublicKey = new IdentityPublicKey({
    keyId: masterKeyId,
    purpose: 'AUTHENTICATION',
    securityLevel: 'MASTER',
    keyType: KeyType.ECDSA_SECP256K1,
    data: hexToBytes(master.publicKey),
    readOnly: false,
  });
  transition.sign(PrivateKey.fromWIF(master.privateKeyWif), masterPublicKey);

  return {
    hex: transition.toHex(),
    masterKeyHash: masterPublicKey.getPublicKeyHash(),
    added: {
      keyId: newKeyId,
      purpose,
      securityLevel,
      path: fresh.path,
      publicKeyHex: fresh.publicKey,
      wif: fresh.privateKeyWif,
    },
  };
}

/** What the five standard slots are for, and which of them an identity is missing. */
export function missingRoles(existingKeys) {
  const taken = new Set((existingKeys ?? []).map((k) => k.keyId));
  const filled = (role) => (existingKeys ?? []).some(
    (k) => k.purpose === role.purpose && k.securityLevel === role.securityLevel && !k.disabled,
  );
  return KEY_ROLES
    .filter((role) => !filled(role))
    // A slot another key already sits in cannot be reused, whatever its purpose.
    .map((role) => ({ ...role, slotTaken: taken.has(role.keyId) }));
}
