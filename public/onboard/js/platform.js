// Platform operations: read an address balance, move credits onto that address
// from an identity you already own, create an identity from the funded address,
// and register a DPNS username. Pinned to evo-sdk v4 (see PLAN.md).

import { loadEvo, getSdk, getNetwork, hexToBytes, randomBytes32 } from './sdk.js';
import { deriveIdentityKeys } from './wallet.js';
import { registerName as registerNameResumable } from '../../shared/dpns-register.js';

// Balance of a platform address, in credits (bigint). 0n when unfunded.
export async function getAddressBalance(address) {
  const sdk = await getSdk();
  const info = await sdk.addresses.get(address);
  return info?.balance ?? 0n;
}

// Balance of an identity, in credits (bigint).
export async function getIdentityBalance(identityId) {
  const sdk = await getSdk();
  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`Identity not found on this network: ${identityId}`);
  return identity.balance ?? 0n;
}

// Move credits from an identity you own onto a platform address. This is how a
// mainnet address gets funded without Dash Core: the identity pays, signed with
// its TRANSFER key (purpose TRANSFER, the only key allowed to move credits).
export async function fundAddressFromIdentity({ identityId, transferWif, address, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { IdentitySigner, PrivateKey } = Evo;

  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  const transferKeys = keys.filter((k) => k.purpose === 'TRANSFER' && !k.disabledAt);
  if (!transferKeys.length) throw new Error('This identity has no TRANSFER key, so it cannot send credits.');

  let privateKeyBytes;
  try { privateKeyBytes = PrivateKey.fromWIF(transferWif).toBytes(); }
  catch { throw new Error('That is not a valid WIF private key.'); }
  const match = transferKeys.some((k) => {
    try { return k.validatePrivateKey(privateKeyBytes, getNetwork()); } catch { return false; }
  });
  if (!match) throw new Error('That key is not the TRANSFER key of this identity.');

  const signer = new IdentitySigner();
  signer.addKeyFromWif(transferWif);

  // It wants the fetched Identity, not an id — same trap as topUpIdentity, and
  // the error ("'identity' is required") does not say which of the two it means.
  // Outputs are plain objects here; unlike fundFromAssetLock they all carry an
  // amount, because the identity keeps whatever is left.
  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`Identity not found on this network: ${identityId}`);
  const result = await sdk.addresses.transferFromIdentity({
    identity,
    outputs: [{ address, amount }],
    signer,
  });
  return { newBalance: result?.newBalance };
}

// The other direction: move credits from a platform address into an identity.
// Needed twice over — to empty a funding key you want to throw away, and to
// refill an identity that ran out mid-registration.
export async function topUpIdentity({ identityId, addressWif, address, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { PlatformAddressSigner, PrivateKey } = Evo;

  let key;
  try { key = PrivateKey.fromWIF(addressWif); }
  catch { throw new Error('That is not a valid WIF private key.'); }
  const derived = new PlatformAddressSigner().addKey(key).toBech32m(getNetwork());
  if (derived !== address) {
    throw new Error('That key does not belong to this address.');
  }

  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`Identity not found on this network: ${identityId}`);

  // Same shape trap as transferFromIdentity: the fetched Identity, not an id.
  const signer = new PlatformAddressSigner();
  signer.addKey(key);
  const result = await sdk.addresses.topUpIdentity({
    identity,
    inputs: [{ address, amount }],
    signer,
  });
  return { newBalance: result?.newBalance };
}

// Create an identity funded from the platform address. `amount` is the credits
// (bigint) to move into the new identity. Returns the id, the Identity object
// (when available), and the derived keys for later use.
export async function createIdentity({ mnemonic, address, addressPrivateKeyWif, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk(); // also guarantees the WASM is initialised
  const {
    Identity, Identifier, IdentityPublicKeyInCreation,
    IdentitySigner, PlatformAddressSigner, PrivateKey, KeyType,
  } = Evo;

  const derived = await deriveIdentityKeys(mnemonic);

  const id = typeof Identifier.random === 'function'
    ? Identifier.random()
    : new Identifier(randomBytes32());
  const identity = new Identity(id);
  for (const d of derived) {
    identity.addPublicKey(
      new IdentityPublicKeyInCreation({
        keyId: d.spec.keyId,
        purpose: d.spec.purpose,
        securityLevel: d.spec.securityLevel,
        keyType: KeyType.ECDSA_SECP256K1,
        data: hexToBytes(d.publicKeyHex),
      }).toIdentityPublicKey(),
    );
  }

  const identitySigner = new IdentitySigner();
  for (const d of derived) identitySigner.addKeyFromWif(d.privateKeyWif);

  const addressSigner = new PlatformAddressSigner();
  addressSigner.addKey(PrivateKey.fromWIF(addressPrivateKeyWif));

  let identityId;
  let identityObj = null;
  try {
    const result = await sdk.addresses.createIdentity({
      identity,
      inputs: [{ address, amount }],
      identitySigner,
      addressSigner,
    });
    identityObj = result.identity;
    identityId = identityObj.id.toString();
  } catch (e) {
    // Known SDK bug (dashpay/platform#3095): proof verification can fail even
    // though the identity WAS created. The real id is in the message.
    const match = e?.message?.match(/proof returned identity (\w+) but/);
    if (!match) throw e;
    identityId = match[1];
  }

  return { identityId, identityObj, derived };
}

// Live validity/availability check for a username label (no .dash suffix).
export async function checkUsername(label) {
  const sdk = await getSdk();
  const valid = await sdk.dpns.isValidUsername(label);
  if (!valid) return { valid: false, contested: false, available: false };
  const [contested, available] = await Promise.all([
    sdk.dpns.isContestedUsername(label),
    sdk.dpns.isNameAvailable(label),
  ]);
  return { valid, contested, available };
}

// Register a DPNS name for the identity. Goes through the resumable path rather
// than sdk.dpns.registerName, so an interruption between the preorder and the
// domain document does not throw the preorder (and its fee) away.
export async function registerUsername({ label, identityId, identityObj, derived }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { IdentitySigner, PrivateKey } = Evo;

  const identity = identityObj ?? (await sdk.identities.fetch(identityId));
  if (!identity) throw new Error(`could not load identity ${identityId}`);

  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  // Key getters return enum NAMES as strings — compare strings.
  const identityKey = keys.find(
    (k) => k.purpose === 'AUTHENTICATION' && k.securityLevel === 'CRITICAL',
  );
  if (!identityKey) throw new Error('no CRITICAL authentication key on identity');

  const criticalWif = derived.find((d) => d.spec.keyId === 2)?.privateKeyWif;
  if (!criticalWif) throw new Error('missing CRITICAL key WIF');

  const signer = new IdentitySigner();
  signer.addKeyFromWif(criticalWif);

  return registerNameResumable({
    sdk, Evo, label, identity, identityKey, signer,
    privateKeyBytes: PrivateKey.fromWIF(criticalWif).toBytes(),
    network: getNetwork(),
  });
}
