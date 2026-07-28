// The vendored evo-sdk, loaded only when a row is opened. The list itself never
// touches it: 10 MB of WASM is far too much to pay for a page that renders fine
// from the index alone.

export const NETWORKS = ['testnet', 'mainnet'];

let _network = 'mainnet';
let _mod = null;
const _sdks = {};
const _connecting = {};

export function setNetwork(n) { if (NETWORKS.includes(n)) _network = n; }
export function getNetwork() { return _network; }

export async function loadEvo() {
  if (!_mod) _mod = await import('../../shared/vendor/evo-sdk.module.js');
  return _mod;
}

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
