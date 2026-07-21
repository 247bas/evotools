// Platform operations: read an address balance, create an identity from the
// funded address, and register a DPNS username. Pinned to evo-sdk v4 (see PLAN.md).

import { loadEvo, getSdk, hexToBytes, randomBytes32 } from './sdk.js';
import { deriveIdentityKeys } from './wallet.js';

// Balance of a platform address, in credits (bigint). 0n when unfunded.
export async function getAddressBalance(address) {
  const sdk = await getSdk();
  const info = await sdk.addresses.get(address);
  return info?.balance ?? 0n;
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

// Register a DPNS name for the identity, signed with the CRITICAL auth key (#2).
export async function registerUsername({ label, identityId, identityObj, derived }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { IdentitySigner } = Evo;

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

  return sdk.dpns.registerName({ label, identity, identityKey, signer });
}
