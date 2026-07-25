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
const fundingWif = fundingKey.toObject().privateKeyWif;
const address = new PlatformAddressSigner()
  .addKey(PrivateKey.fromWIF(fundingWif))
  .toBech32m('${network}');   // ${network === 'mainnet' ? 'dash1…' : 'tdash1…'}

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
  const fundingWif = fundingKey.toObject().privateKeyWif;
  const address = new PlatformAddressSigner().addKey(PrivateKey.fromWIF(fundingWif)).toBech32m(network);

  const base = await identityBase(network);
  const keys = await Promise.all(KEY_ROLES.map(async (role) => {
    const path = `${base.path}/0'/0'/0'/${role.keyId}'`;
    const k = await wallet.deriveKeyFromSeedWithPath({ mnemonic, path, network });
    const obj = k.toObject();
    return { ...role, path, wif: obj.privateKeyWif, publicKeyHex: obj.publicKey };
  }));

  return { mnemonic, network, address, fundingPath: fp.path, fundingWif, keys };
}
