// One key, two spellings.
//
// A platform address is 21 bytes: a type byte (0xb0 for pay-to-pubkey-hash) and
// the same 20-byte public key hash a layer-1 address carries. So `dash1…` and
// `X…` are the same key written twice, and converting between them is arithmetic
// — no node, no lookup. That is what lets the map show both sides of a key when
// somebody pastes only one of them.
//
// The SDK handles the bech32m half (PlatformAddress). Base58check it does not
// expose for addresses, so it lives here: 33 lines, and the checksum makes a
// typo impossible to mistake for a valid address.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Dash pay-to-pubkey-hash version bytes.
export const L1_VERSION = { mainnet: 0x4c, testnet: 0x8c };

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const checksum = async (bytes) => (await sha256(await sha256(bytes))).slice(0, 4);

function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

function b58decode(str) {
  let n = 0n;
  for (const c of str) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('That is not a Dash address.');
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of str) { if (c !== '1') break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

// Layer-1 address → the 20-byte hash inside it, and which network it belongs to.
export async function hashFromL1(address) {
  const raw = b58decode(address.trim());
  if (raw.length !== 25) throw new Error('That is not a Dash address.');
  const body = raw.slice(0, 21);
  const want = await checksum(body);
  if (!raw.slice(21).every((b, i) => b === want[i])) throw new Error('That address has a typo in it — its checksum does not match.');
  const network = Object.keys(L1_VERSION).find((n) => L1_VERSION[n] === body[0]);
  if (!network) throw new Error('That address is not a Dash pay-to-pubkey-hash address.');
  return { hash: body.slice(1), network };
}

export async function l1FromHash(hash, network) {
  const body = new Uint8Array(21);
  body[0] = L1_VERSION[network] ?? L1_VERSION.mainnet;
  body.set(hash, 1);
  const raw = new Uint8Array(25);
  raw.set(body);
  raw.set(await checksum(body), 21);
  return b58encode(raw);
}

// The platform half, through the SDK so the type byte and the bech32m rules stay
// its problem rather than ours.
export function hashFromPlatform(Evo, address) {
  const pa = Evo.PlatformAddress.fromBech32m(address.trim());
  return { hash: pa.hash(), hex: pa.hashToHex(), network: /^tdash1/i.test(address.trim()) ? 'testnet' : 'mainnet' };
}

export function platformFromHash(Evo, hash, network) {
  return Evo.PlatformAddress.fromP2pkhHash(hash).toBech32m(network);
}

export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
