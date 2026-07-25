// Network-aware lazy loader for the vendored evo-sdk v4 (WASM inlined). The
// module is ~9.5MB, so we import it dynamically only when the user actually
// starts — the landing page stays light. One connected SDK is cached per
// network. Same pattern as dash-name and the explorer.

export const NETWORKS = ['testnet', 'mainnet'];

let _network = 'testnet';
let _mod = null;          // the evo-sdk module namespace
const _sdks = {};         // connected EvoSDK per network
const _connecting = {};

export function setNetwork(n) { if (NETWORKS.includes(n)) _network = n; }
export function getNetwork() { return _network; }
export const isMainnet = () => _network === 'mainnet';

// Load and cache the SDK module (triggers WASM init on first real call).
export async function loadEvo() {
  if (!_mod) {
    _mod = await import('../../shared/vendor/evo-sdk.module.js');
  }
  return _mod;
}

// Return a connected SDK for the current network, sharing the in-flight promise
// so concurrent callers don't open two connections.
export async function getSdk() {
  const net = _network;
  const Evo = await loadEvo();
  if (_sdks[net] && _sdks[net].isConnected) return _sdks[net];
  if (!_connecting[net]) {
    _connecting[net] = (async () => {
      const sdk = net === 'mainnet' ? Evo.EvoSDK.mainnetTrusted() : Evo.EvoSDK.testnetTrusted();
      await sdk.connect();
      _sdks[net] = sdk;
      _connecting[net] = null;
      return sdk;
    })();
  }
  return _connecting[net];
}

// ── small byte helpers ─────────────────────────────────────────────────────
export const hexToBytes = (hex) =>
  Uint8Array.from(hex.match(/.{2}/g), (b) => parseInt(b, 16));

export const randomBytes32 = () => crypto.getRandomValues(new Uint8Array(32));
