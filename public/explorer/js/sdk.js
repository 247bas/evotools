// Network-aware lazy loader for the vendored evo-sdk v4. The explorer is
// read-only, so browsing mainnet is safe; onboard/playground stay testnet.
// One connected SDK is cached per network; getSdk() uses the current network.

export const NETWORKS = ['testnet', 'mainnet'];

let _network = 'testnet';
let _mod = null;
const _sdks = {};       // network -> connected EvoSDK
const _connecting = {}; // network -> in-flight connect promise

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
