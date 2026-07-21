// Wallet + key derivation, mirroring evo-cookbook recipe 10 (the verified v4
// Platform Address flow). All of this is offline — no network, no Dash Core.

import { loadEvo, NETWORK } from './sdk.js';

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

// Generate a fresh testnet wallet and its funding (platform) address.
export async function generateWallet() {
  const { wallet } = await loadEvo();
  const mnemonic = await wallet.generateMnemonic();
  const funding = await deriveFundingAddress(mnemonic);
  return { mnemonic, ...funding };
}

// Funding address: BIP44 m/44'/1'/0'/0/0 → bech32m platform address (tdash1…).
export async function deriveFundingAddress(mnemonic) {
  const { wallet, PrivateKey, PlatformAddressSigner } = await loadEvo();
  const pathInfo = await wallet.derivationPathBip44Testnet(0, 0, 0);
  const keyInfo = await wallet.deriveKeyFromSeedWithPath({
    mnemonic,
    path: pathInfo.path,
    network: NETWORK,
  });
  const addressPrivateKeyWif = keyInfo.toObject().privateKeyWif;
  const address = new PlatformAddressSigner()
    .addKey(PrivateKey.fromWIF(addressPrivateKeyWif))
    .toBech32m(NETWORK);
  return { address, addressPrivateKeyWif };
}

// Derive the 5 identity keys for identity index 0 via DIP-13:
//   m/9'/1'/5'/0'/0'/0'/{keyId}'
export async function deriveIdentityKeys(mnemonic) {
  const { wallet } = await loadEvo();
  const specs = await keySpecs();
  const base = await wallet.derivationPathDip13Testnet(5);
  return Promise.all(
    specs.map(async (spec) => {
      const path = `${base.path}/0'/0'/0'/${spec.keyId}'`;
      const k = await wallet.deriveKeyFromSeedWithPath({ mnemonic, path, network: NETWORK });
      const obj = k.toObject();
      return { spec, publicKeyHex: obj.publicKey, privateKeyWif: obj.privateKeyWif };
    }),
  );
}
