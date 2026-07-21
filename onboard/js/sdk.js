// Lazy loader for the vendored evo-sdk v4 (WASM inlined). The module is ~9.5MB,
// so we import it dynamically only when the user actually starts — the landing
// page stays light. One EvoSDK instance is created and reused across steps.
// The SDK is shared by all tools in the monorepo (evotools/shared/vendor).

export const NETWORK = 'testnet';

let _mod = null;       // the evo-sdk module namespace
let _sdk = null;       // connected EvoSDK singleton
let _connecting = null;

// Load and cache the SDK module (triggers WASM init on first real call).
export async function loadEvo() {
  if (!_mod) {
    _mod = await import('../../shared/vendor/evo-sdk.module.js');
  }
  return _mod;
}

// Return a connected testnet SDK, connecting once and sharing the promise so
// concurrent callers don't open two connections.
export async function getSdk() {
  const Evo = await loadEvo();
  if (_sdk && _sdk.isConnected) return _sdk;
  if (!_connecting) {
    _connecting = (async () => {
      const sdk = Evo.EvoSDK.testnetTrusted();
      await sdk.connect();
      _sdk = sdk;
      _connecting = null;
      return sdk;
    })();
  }
  return _connecting;
}

// ── small byte helpers ─────────────────────────────────────────────────────
export const hexToBytes = (hex) =>
  Uint8Array.from(hex.match(/.{2}/g), (b) => parseInt(b, 16));

export const randomBytes32 = () => crypto.getRandomValues(new Uint8Array(32));
