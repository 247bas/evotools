// Lazy loader for the vendored evo-sdk v4, shared across the suite. Same pattern
// as onboard; the explorer only ever reads, so trusted mode is fine.

export const NETWORK = 'testnet';

let _mod = null;
let _sdk = null;
let _connecting = null;

export async function loadEvo() {
  if (!_mod) _mod = await import('../../shared/vendor/evo-sdk.module.js');
  return _mod;
}

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
