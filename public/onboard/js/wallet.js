// Wallet + key derivation, mirroring evo-cookbook recipe 10 (the verified v4
// Platform Address flow). All of this is offline — no network, no Dash Core.

import { loadEvo, getNetwork } from './sdk.js';

// The 5 standard identity keys (DIP-9/DIP-13 layout, same as Dash Evo Tool):
//   0 MASTER auth · 1 HIGH auth · 2 CRITICAL auth · 3 TRANSFER · 4 ENCRYPTION
// Purpose/SecurityLevel are WASM enums, so this is built after the module loads.
export async function keySpecs() {
  const { Purpose, SecurityLevel } = await loadEvo();
  return [
    { keyId: 0, purpose: Purpose.AUTHENTICATION, securityLevel: SecurityLevel.MASTER, label: 'Master (authentication)' },
    { keyId: 1, purpose: Purpose.AUTHENTICATION, securityLevel: SecurityLevel.HIGH, label: 'High (authentication)' },
    { keyId: 2, purpose: Purpose.AUTHENTICATION, securityLevel: SecurityLevel.CRITICAL, label: 'Critical (authentication)' },
    { keyId: 3, purpose: Purpose.TRANSFER, securityLevel: SecurityLevel.CRITICAL, label: 'Transfer' },
    { keyId: 4, purpose: Purpose.ENCRYPTION, securityLevel: SecurityLevel.MEDIUM, label: 'Encryption' },
  ];
}

// Generate a fresh wallet and its funding (platform) address, on the current
// network. Used for the testnet walkthrough; on mainnet you bring your own key.
export async function generateWallet() {
  const { wallet } = await loadEvo();
  const mnemonic = await wallet.generateMnemonic();
  const funding = await deriveFundingAddress(mnemonic);
  return { mnemonic, ...funding };
}

// Generate the mnemonic that will hold the new identity's keys. On mainnet this
// is the only key material the browser creates — the funding key stays yours,
// and a phrase made offline in keygen can replace this one entirely.
export async function generateIdentityMnemonic() {
  const { wallet } = await loadEvo();
  return wallet.generateMnemonic();
}

export async function isValidMnemonic(mnemonic) {
  const { wallet } = await loadEvo();
  try { return await wallet.validateMnemonic(mnemonic); } catch { return false; }
}

// Funding address from a mnemonic: BIP44 m/44'/{coin}'/0'/0/0 → bech32m
// platform address (tdash1… on testnet, dash1… on mainnet).
export async function deriveFundingAddress(mnemonic) {
  const { wallet } = await loadEvo();
  const net = getNetwork();
  const pathInfo = net === 'mainnet'
    ? await wallet.derivationPathBip44Mainnet(0, 0, 0)
    : await wallet.derivationPathBip44Testnet(0, 0, 0);
  const keyInfo = await wallet.deriveKeyFromSeedWithPath({ mnemonic, path: pathInfo.path, network: net });
  return platformAddressFromWif(keyInfo.toObject().privateKeyWif);
}

// Funding address from a key the user already controls. The WIF never leaves the
// page; it is only used to derive the address and later to sign the funding input.
export async function platformAddressFromWif(wif) {
  const { PrivateKey, PlatformAddressSigner } = await loadEvo();
  let privateKey;
  try { privateKey = PrivateKey.fromWIF(wif); }
  catch { throw new Error('That is not a valid WIF private key.'); }
  const address = new PlatformAddressSigner().addKey(privateKey).toBech32m(getNetwork());
  return { address, addressPrivateKeyWif: wif };
}

// Derive the 5 identity keys for identity index 0 via DIP-13:
//   m/9'/{coin}'/5'/0'/0'/0'/{keyId}'
export async function deriveIdentityKeys(mnemonic) {
  const { wallet } = await loadEvo();
  const net = getNetwork();
  const specs = await keySpecs();
  const base = net === 'mainnet'
    ? await wallet.derivationPathDip13Mainnet(5)
    : await wallet.derivationPathDip13Testnet(5);
  return Promise.all(
    specs.map(async (spec) => {
      const path = `${base.path}/0'/0'/0'/${spec.keyId}'`;
      const k = await wallet.deriveKeyFromSeedWithPath({ mnemonic, path, network: net });
      const obj = k.toObject();
      return { spec, publicKeyHex: obj.publicKey, privateKeyWif: obj.privateKeyWif };
    }),
  );
}
