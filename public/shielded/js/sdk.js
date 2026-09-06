// The vendored evo-sdk, one connection per network, loaded on demand. The page
// shows both pools side by side, so it asks for a network by name rather than
// keeping a current one.

export const NETWORKS = ['mainnet', 'testnet'];

let _mod = null;
const _sdks = {};
const _connecting = {};

export async function loadEvo() {
  if (!_mod) _mod = await import('../../shared/vendor/evo-sdk.module.js');
  return _mod;
}

export async function getSdkFor(net) {
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
