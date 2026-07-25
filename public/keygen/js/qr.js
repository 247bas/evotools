// Minimal QR encoder — byte mode, error correction level M, versions 1-10.
// Self-contained on purpose: the offline copy of this page runs under a CSP that
// forbids every network request, so a CDN library is not an option.
// Returns a square boolean matrix; true = dark module.

// ── GF(256), primitive polynomial 0x11d ─────────────────────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1]; // highest degree first
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = buf[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], factor);
  }
  return buf.slice(data.length);
}

// ── version tables (level M only) ───────────────────────────────────────────
// [total codewords, EC codewords per block, [blocks, data codewords] groups]
const VERSIONS = {
  1: [26, 10, [[1, 16]]],
  2: [44, 16, [[1, 28]]],
  3: [70, 26, [[1, 44]]],
  4: [100, 18, [[2, 32]]],
  5: [134, 24, [[2, 43]]],
  6: [172, 16, [[4, 27]]],
  7: [196, 18, [[4, 31]]],
  8: [242, 22, [[2, 38], [2, 39]]],
  9: [292, 22, [[3, 36], [2, 37]]],
  10: [346, 26, [[4, 43], [1, 44]]],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const dataCapacity = (v) => VERSIONS[v][2].reduce((n, [blocks, words]) => n + blocks * words, 0);

// ── bit stream ──────────────────────────────────────────────────────────────
class Bits {
  constructor() { this.bits = []; }
  push(value, length) { for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1); }
  get length() { return this.bits.length; }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

// ── BCH codes for the format and version areas ──────────────────────────────
// Format info: 5 data bits (2 EC level + 3 mask), 10 BCH bits, XOR 0x5412.
function formatBits(maskId) {
  const data = (0b00 << 3) | maskId; // 0b00 = level M
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  return ((data << 10) | rem) ^ 0b101010000010010;
}
// Version info (v7+): 6 data bits, 12 BCH bits.
function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  return (version << 12) | rem;
}

// ── matrix ──────────────────────────────────────────────────────────────────
function blankMatrix(size) {
  return {
    modules: Array.from({ length: size }, () => new Array(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
    size,
  };
}

function placeFunctionPatterns(m, version) {
  const { size } = m;
  const set = (r, c, dark) => { m.modules[r][c] = dark; m.reserved[r][c] = true; };

  const finder = (top, left) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r, cc = left + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(rr, cc, inRing || inCore);
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

  const centers = ALIGN[version];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  set(size - 8, 8, true); // dark module

  // reserve the format areas (contents written after masking)
  for (let i = 0; i < 9; i++) { if (!m.reserved[8][i]) set(8, i, false); if (!m.reserved[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { if (!m.reserved[8][size - 1 - i]) set(8, size - 1 - i, false); if (!m.reserved[size - 1 - i][8]) set(size - 1 - i, 8, false); }

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3), b = i % 3;
      set(size - 11 + b, a, dark);
      set(a, size - 11 + b, dark);
    }
  }
}

function placeData(m, bytes) {
  const { size } = m;
  let bitIndex = 0;
  const totalBits = bytes.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (m.reserved[row][col]) continue;
        let dark = false;
        if (bitIndex < totalBits) dark = ((bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1) === 1;
        m.modules[row][col] = dark;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(modules) {
  const size = modules.length;
  let score = 0;

  // rule 1: runs of five or more
  for (let i = 0; i < size; i++) {
    for (const line of [modules[i], modules.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (line[j] === line[j - 1]) { run++; } else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }
  // rule 2: 2x2 blocks of one colour
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }
  // rule 3: finder-like patterns
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line, pat, at) => pat.every((v, k) => line[at + k] === v);
  for (let i = 0; i < size; i++) {
    const row = modules[i];
    const col = modules.map((r) => r[i]);
    for (const line of [row, col]) {
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(line, P1, j)) score += 40;
        if (matches(line, P2, j)) score += 40;
      }
    }
  }
  // rule 4: overall balance
  let dark = 0;
  for (const row of modules) for (const v of row) if (v) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

// The 15 format bits appear twice. Bit 0 is the least significant bit; the
// column-8 copy runs top to bottom, the row-8 copy runs right to left.
function applyFormat(m, maskId) {
  const { size } = m;
  const bits = formatBits(maskId);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const row = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    m.modules[row][8] = dark;
    const col = i < 8 ? size - 1 - i : i === 8 ? 7 : 14 - i;
    m.modules[8][col] = dark;
  }
  m.modules[size - 8][8] = true; // the dark module is never part of the format
}

// Encode `text` and return { size, modules }.
export function qrMatrix(text) {
  const data = new TextEncoder().encode(text);

  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + data.length * 8 <= dataCapacity(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error(`${data.length} bytes is too long for this encoder (max ${dataCapacity(10)}).`);

  const [, ecPerBlock, groups] = VERSIONS[version];
  const capacity = dataCapacity(version);

  const bits = new Bits();
  bits.push(0b0100, 4);
  bits.push(data.length, version <= 9 ? 8 : 16);
  for (const b of data) bits.push(b, 8);
  bits.push(0, Math.min(4, capacity * 8 - bits.length)); // terminator
  if (bits.length % 8) bits.push(0, 8 - (bits.length % 8));
  const payload = Array.from(bits.toBytes());
  for (let i = 0; payload.length < capacity; i++) payload.push(i % 2 === 0 ? 0xec : 0x11);

  // split into blocks, compute EC, then interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, words] of groups) {
    for (let i = 0; i < count; i++) {
      const block = payload.slice(offset, offset + words);
      offset += words;
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(Uint8Array.from(block), ecPerBlock));
    }
  }
  const interleaved = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) interleaved.push(b[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of ecBlocks) interleaved.push(b[i]);

  const size = version * 4 + 17;
  const base = blankMatrix(size);
  placeFunctionPatterns(base, version);
  placeData(base, Uint8Array.from(interleaved));

  // pick the mask with the lowest penalty
  let best = null;
  for (let maskId = 0; maskId < 8; maskId++) {
    const m = {
      size,
      reserved: base.reserved,
      modules: base.modules.map((row) => row.slice()),
    };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!m.reserved[r][c] && MASKS[maskId](r, c)) m.modules[r][c] = !m.modules[r][c];
      }
    }
    applyFormat(m, maskId);
    const score = penalty(m.modules);
    if (!best || score < best.score) best = { score, modules: m.modules, maskId };
  }
  return { size, modules: best.modules, version, mask: best.maskId };
}

// Render a matrix as an SVG string. `quiet` is the mandatory light border.
export function qrSvg(text, { scale = 4, quiet = 4, dark = '#000', light = '#fff' } = {}) {
  const { size, modules } = qrMatrix(text);
  const dim = (size + quiet * 2) * scale;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges" role="img"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
