// Is that a shielded address?
//
// A shielded (Orchard) address on Platform is 43 raw bytes: an 11-byte
// diversifier and a 32-byte transmission key, a point on the Pallas curve. Dash
// writes it as bech32m under the same `dash` / `tdash` prefix a transparent
// platform address carries, with a type byte in front: 0x10 for shielded, 0xb0
// for pay-to-pubkey-hash. Read five bits at a time, 0x10 begins 00010, which is
// the letter z, and 0xb0 begins 10110, a k. That is the whole reason one kind
// reads dash1z… and the other dash1k…. Unlike Zcash there is no F4Jumble and no
// unified-address wrapper: the raw bytes match Orchard, the spelling is Dash's.
//
// Read off rs-dpp `address_funds/orchard_address.rs` at v4.1.1. No SDK here:
// bech32m is forty lines, and the page should answer without 10 MB of WASM.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export const SHIELDED_TYPE = 0x10;
export const P2PKH_TYPE = 0xb0;
export const DIVERSIFIER_BYTES = 11;
export const PKD_BYTES = 32;
export const RAW_BYTES = DIVERSIFIER_BYTES + PKD_BYTES; // 43

const HRP = { dash: 'mainnet', tdash: 'testnet' };
const hrpFor = (network) => (network === 'testnet' ? 'tdash' : 'dash');

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk = (chk ^ GEN[i]) >>> 0;
  }
  return chk;
}

const hrpExpand = (hrp) => [
  ...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31),
];

// Regroup bits, 8→5 for encoding (padded) and 5→8 for decoding (strict).
function convertBits(data, from, to, pad) {
  const maxv = (1 << to) - 1;
  const maxAcc = (1 << (from + to - 1)) - 1;
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const v of data) {
    if (v < 0 || v >>> from) return null;
    acc = ((acc << from) | v) & maxAcc;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >>> bits) & maxv); }
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return out;
}

export function encodeBech32m(hrp, bytes) {
  const data = convertBits(bytes, 8, 5, true);
  const values = [...hrpExpand(hrp), ...data];
  const mod = polymod([...values, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join('')}`;
}

export function decodeBech32m(str) {
  const s = str.trim();
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new Error('mixes upper and lower case, which bech32 forbids');
  const lower = s.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) throw new Error('is not bech32: no prefix, or nothing after the 1');
  const hrp = lower.slice(0, pos);
  const data = [...lower.slice(pos + 1)].map((c) => CHARSET.indexOf(c));
  if (data.includes(-1)) throw new Error('holds a character bech32 does not use (b, i, o and 1 are out)');
  if (polymod([...hrpExpand(hrp), ...data]) !== BECH32M_CONST) throw new Error('has a typo in it: its checksum does not match');
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  if (!bytes) throw new Error('has bad padding');
  return { hrp, bytes: Uint8Array.from(bytes) };
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// The 43 raw bytes → the spelling for a network.
export function encodeShielded(raw, network) {
  if (raw.length !== RAW_BYTES) throw new Error(`a raw shielded address is ${RAW_BYTES} bytes`);
  return encodeBech32m(hrpFor(network), [SHIELDED_TYPE, ...raw]);
}

// What kind of address did somebody paste? Never a lookup: none of these kinds
// can be looked up by address on the shielded side, which is rather the point.
export function classify(input) {
  const s = (input || '').trim();
  if (!s) return { kind: 'empty' };

  // A layer-1 address: base58, 34 characters, X on mainnet and y on testnet
  // (7 / 8 / 9 for pay-to-script-hash). Shape only; the map checks the checksum.
  if (/^[1-9A-HJ-NP-Za-km-z]{34}$/.test(s)) {
    if (/^[X7]/.test(s)) return { kind: 'layer1', network: 'mainnet', address: s };
    if (/^[y89]/.test(s)) return { kind: 'layer1', network: 'testnet', address: s };
  }
  if (!/^t?dash1/i.test(s)) {
    return { kind: 'other', reason: 'Not a Platform address: those start with dash1 (mainnet) or tdash1 (testnet).' };
  }

  let decoded;
  try { decoded = decodeBech32m(s); } catch (e) { return { kind: 'invalid', reason: `That address ${e.message}.` }; }
  const network = HRP[decoded.hrp];
  if (!network) return { kind: 'invalid', reason: `The prefix "${decoded.hrp}" is not one Platform uses.` };
  const { bytes } = decoded;
  const type = bytes[0];

  if (type === SHIELDED_TYPE) {
    if (bytes.length !== RAW_BYTES + 1) {
      return { kind: 'invalid', reason: `A shielded address carries ${RAW_BYTES} bytes after its type byte; this one carries ${bytes.length - 1}.` };
    }
    return {
      kind: 'shielded',
      network,
      address: s.toLowerCase(),
      diversifier: toHex(bytes.slice(1, 1 + DIVERSIFIER_BYTES)),
      pkd: toHex(bytes.slice(1 + DIVERSIFIER_BYTES)),
    };
  }
  if (type === P2PKH_TYPE) {
    return { kind: 'platform', network, address: s.toLowerCase(), hash: toHex(bytes.slice(1)), hashBytes: bytes.slice(1) };
  }
  return { kind: 'platform-other', network, type };
}
