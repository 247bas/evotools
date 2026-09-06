// shielded — the Orchard pool on Platform: what is in it, how it moves, what
// the six shielded transitions cost, and whether an address is a shielded one.
// Every value from the chain or the index is rendered with textContent.
import { statistic, flows, apiHost, LAUNCH } from './api.js';
import { poolState } from './pool.js';
import {
  TYPES, DENOMINATIONS, POOL, FEES, minimumFor, dash, PROTOCOL_THESE_HOLD_FOR, CREDITS_PER_DASH,
} from './fees.js';
import { classify } from './address.js';
import { looksLikeSecret } from '../../shared/secrets.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const num = (n) => Number(n).toLocaleString('en-US');
const unit = (net) => (net === 'mainnet' ? 'DASH' : 'tDASH');
const NETS = ['mainnet', 'testnet'];
const fmtDay = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const DIRECTION = (t) => (t.from !== 'pool' && t.to === 'pool' ? 'in' : t.from === 'pool' && t.to !== 'pool' ? 'out' : 'transfer');

function showError(e) {
  const box = $('error');
  box.textContent = typeof e === 'string' ? e : (e?.message || String(e));
  box.hidden = false;
}

function copyBtn(text, label = 'Copy') {
  const b = el('button', 'btn ghost sm', label);
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => (b.textContent = label), 1200); } catch { /* ignore */ }
  });
  return b;
}

// ── the two pools ────────────────────────────────────────────────────────────
const indexByNet = {};  // network -> statistic(), shared by the table and the denominations
const chainByNet = {};  // network -> poolState()

function poolCard(net) {
  const card = el('div', 'sh-pool');
  card.append(el('div', 'sh-pool-net', net));
  const amount = el('div', 'sh-pool-amount', '…');
  card.append(amount);
  const stats = el('div', 'sh-stats');
  const stat = (k) => {
    const s = el('div', 'sh-stat');
    s.append(el('div', 'sh-stat-k', k));
    const v = el('div', 'sh-stat-v', '…');
    s.append(v);
    stats.append(s);
    return v;
  };
  const notes = stat('Notes');
  const anchors = stat('Anchors');
  const protocol = stat('Protocol');
  card.append(stats);
  const index = el('div', 'sh-pool-index', 'Reading the index…');
  card.append(index);
  return {
    card,
    chain(d) {
      amount.replaceChildren(document.createTextNode(dash(d.balance, 2)), el('small', null, unit(net)));
      notes.textContent = d.notes == null ? '—' : `${num(d.notes)}${d.notesCapped ? '+' : ''}`;
      anchors.textContent = num(d.anchors);
      protocol.textContent = d.protocolVersion ? `v${d.protocolVersion}` : '—';
    },
    chainError(msg) {
      amount.textContent = '—';
      card.append(el('div', 'error', `The chain did not answer: ${msg}`));
    },
    index(s) {
      index.replaceChildren();
      const bit = (v, label) => { index.append(el('b', null, v)); index.append(el('span', null, label)); };
      index.append(el('span', null, 'Index: '));
      bit(num(s.transitions), ' transitions · ');
      bit(dash(s.inCredits, 2), ' in · ');
      bit(dash(s.outCredits, 2), ' out');
    },
    indexError(msg) { index.textContent = `The index did not answer: ${msg}`; },
  };
}

async function loadPools() {
  const box = $('pools');
  box.replaceChildren();
  const cards = Object.fromEntries(NETS.map((net) => [net, poolCard(net)]));
  for (const net of NETS) box.append(cards[net].card);

  await Promise.all(NETS.flatMap((net) => [
    statistic(net).then((s) => {
      indexByNet[net] = s;
      cards[net].index(s);
      if (net === currentNet()) renderTypes(s, net);
      if (net === 'mainnet') renderDenomCount(s);
    }).catch((e) => cards[net].indexError(e?.message || e)),
    poolState(net).then((d) => {
      chainByNet[net] = d;
      cards[net].chain(d);
      if (net === 'mainnet') renderDenoms(d.protocolVersion);
    }).catch((e) => cards[net].chainError(e?.message || e)),
  ]));
  $('asOf').textContent = `read ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ── the chart: credits in and out per week ───────────────────────────────────
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
// The top of the axis: a round number just above the tallest bar, so a chart
// whose biggest week is 2,200 tops out at 2,500 rather than 5,000.
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const toDash = (c) => Number(c) / Number(CREDITS_PER_DASH);

// Drawn at the width the box actually has, in real pixels, so the labels stay
// 11px on a phone instead of shrinking with a fixed viewBox.
let lastFlows = null;
function renderChart(box, f, net) {
  lastFlows = { f, net };
  const W = Math.max(320, Math.round(box.clientWidth || 640)); const H = 220; const L = 62; const R = 10; const T = 12; const B = 30;
  const n = f.in.length;
  const maxIn = Math.max(0, ...f.in.map((x) => toDash(x.credits)));
  const maxOut = Math.max(0, ...f.out.map((x) => toDash(x.credits)));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  if (!n || (maxIn === 0 && maxOut === 0)) {
    const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' });
    t.textContent = `Nothing has moved on ${net} since ${fmtDay(LAUNCH)}.`;
    svg.append(t);
    box.replaceChildren(svg);
    return;
  }
  const yMax = niceMax(Math.max(maxIn, maxOut));
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  for (const v of [0, yMax / 2, yMax]) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'axis' }));
    const t = svgEl('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
    t.textContent = num(v);
    svg.append(t);
  }
  const gw = (W - L - R) / n;
  const bw = Math.max(2, gw * 0.34);
  const every = Math.ceil(n / 6);
  f.in.forEach((pt, i) => {
    const x0 = L + i * gw + gw * 0.14;
    const week = `${fmtDay(pt.at)} – ${fmtDay(new Date(pt.at.getTime() + 7 * 86400000 - 1))}`;
    const bar = (cls, credits, x) => {
      const v = toDash(credits);
      const r = svgEl('rect', { x, y: y(v), width: bw, height: Math.max(0, y(0) - y(v)), class: `bar ${cls}` });
      const title = svgEl('title');
      title.textContent = `${week}: ${dash(credits, 2)} ${unit(net)} ${cls === 'in' ? 'into' : 'out of'} the pool`;
      r.append(title);
      svg.append(r);
    };
    bar('in', pt.credits, x0);
    bar('out', f.out[i]?.credits ?? 0n, x0 + bw + 2);
    if (i % every === 0) {
      const t = svgEl('text', { x: x0, y: H - 10, class: 'tick' });
      t.textContent = fmtDay(pt.at);
      svg.append(t);
    }
  });
  box.replaceChildren(svg);
}

function renderTypes(s, net) {
  const tb = $('types').querySelector('tbody');
  tb.replaceChildren();
  for (const t of s.types) {
    const dir = DIRECTION(t);
    const tr = el('tr', dir);
    const name = el('td');
    name.append(el('div', null, t.name));
    name.append(el('div', 'dir', `${t.from} → ${t.to}`));
    tr.append(name);
    tr.append(el('td', 'type', String(t.n)));
    tr.append(el('td', 'num', num(t.count)));
    tr.append(el('td', 'num', `${dash(t.credits, 2)} ${unit(net)}`));
    tb.append(tr);
  }
}

async function loadFlows(net) {
  const box = $('chart');
  box.replaceChildren(el('div', 'sh-sub', `Reading ${net}…`));
  $('chartNote').textContent = '';
  try {
    const f = await flows(net);
    if (net !== currentNet()) return;
    renderChart(box, f, net);
    $('chartNote').textContent = `${f.weeks} weeks since ${fmtDay(LAUNCH)}; the last bar is the week in progress`;
    const s = indexByNet[net] ?? await statistic(net);
    indexByNet[net] = s;
    renderTypes(s, net);
  } catch (e) {
    box.replaceChildren(el('div', 'error', `Could not read the series: ${e?.message || e}`));
  }
}

// ── the six moves ────────────────────────────────────────────────────────────
function renderMoves() {
  const box = $('moves');
  for (const t of TYPES) {
    const row = el('div', 'sh-move');
    const name = el('div', 'sh-move-name', t.name);
    name.append(el('span', 'type', `type ${t.n}`));
    row.append(name);
    const path = el('div', 'sh-move-path');
    const side = (s) => el('span', s === 'pool' ? 'pool' : null, s);
    path.append(side(t.from), el('span', null, ' → '), side(t.to));
    row.append(path);
    const f = minimumFor(t.key, 2);
    const fee = el('div', 'sh-move-fee', `${f.plusStorage ? '' : '≥ '}${dash(f.credits)} DASH`);
    fee.append(el('small', null, f.plusStorage
      ? `compute fee; storage metered on the ${t.pays}`
      : 'carved from the notes, two actions'));
    row.append(fee);
    box.append(row);
  }
  $('feeNote').textContent = `Minimums at protocol ${PROTOCOL_THESE_HOLD_FOR}, read off the constants Platform runs on: one Halo 2 proof check at ${dash(FEES.proofVerification)} DASH plus ${dash(FEES.perAction)} per action. A move paid from the pool adds ${num(FEES.storageBytesPerAction)} bytes of storage per action at ${num(FEES.creditsPerByte)} credits a byte; an unshield adds ${num(FEES.unshieldAddressBytes)} bytes for the address write, a withdrawal ${num(FEES.withdrawalDocumentBytes)} for the Core document. No pool-paid fee may exceed ${dash(FEES.implicitFeeCap)} DASH. A spend also needs at least ${num(POOL.minimumNotesForOutgoing)} notes in the pool to hide among, and an anchor from the last ${num(POOL.anchorRetentionBlocks)} blocks. Protocol 14 rebalances the fee constants.`;
}

// ── is this a shielded address? ──────────────────────────────────────────────
function part(label, value) {
  const p = el('div', 'part');
  p.append(el('span', null, label));
  p.append(el('code', null, value));
  return p;
}
function mapLink(q, net, label) {
  const a = el('a', null, label);
  a.href = `/map/?q=${encodeURIComponent(q)}${net === 'testnet' ? '&net=testnet' : '&net=mainnet'}`;
  return a;
}

function runCheck() {
  const out = $('addrOut');
  const value = $('addr').value;
  out.replaceChildren();
  if (!value.trim()) return;
  if (looksLikeSecret(value)) {
    out.append(el('div', 'note bad', 'That looks like a key or a recovery phrase, and nothing on this page needs one. It was not sent anywhere. Paste an address instead.'));
    return;
  }
  const c = classify(value);
  if (c.kind === 'shielded') {
    const box = el('div', 'sh-addr shielded');
    box.append(el('div', 'kind', `A shielded address on ${c.network}`));
    box.append(part('address', c.address));
    box.append(part('diversifier', c.diversifier));
    box.append(part('pk_d', c.pkd));
    box.append(el('div', 'then', 'Nobody can look this up, and that includes this page: a note is encrypted to it, and only the viewing key finds it back. Pay it from a wallet that speaks Orchard.'));
    out.append(box);
    return;
  }
  if (c.kind === 'platform') {
    const box = el('div', 'sh-addr');
    box.append(el('div', 'kind', `A transparent platform address on ${c.network}`));
    box.append(part('address', c.address));
    box.append(part('key hash', c.hash));
    const then = el('div', 'then', 'Its balance and every move are public: it starts with a k, not a z. ');
    then.append(mapLink(c.address, c.network, 'See it on the map ↗'));
    box.append(then);
    out.append(box);
    return;
  }
  if (c.kind === 'platform-other') {
    const box = el('div', 'sh-addr');
    box.append(el('div', 'kind', `A platform address on ${c.network} of type 0x${c.type.toString(16)}`));
    box.append(el('div', 'then', 'Not a shielded one (type 0x10) and not pay-to-pubkey-hash (0xb0).'));
    out.append(box);
    return;
  }
  if (c.kind === 'layer1') {
    const box = el('div', 'sh-addr');
    box.append(el('div', 'kind', `A layer-1 address on ${c.network}`));
    box.append(part('address', c.address));
    const then = el('div', 'then', 'Plain DASH, nothing shielded about it. ');
    then.append(mapLink(c.address, c.network, 'The map shows what this key holds on both layers ↗'));
    box.append(then);
    out.append(box);
    return;
  }
  out.append(el('div', 'note bad', c.reason || 'That is not an address.'));
}

// ── an identity straight out of the pool ─────────────────────────────────────
function renderDenoms(protocolVersion) {
  const pv = DENOMINATIONS[protocolVersion] ? protocolVersion : PROTOCOL_THESE_HOLD_FOR;
  $('denomText').textContent = `Identity Create from Shielded Pool, type 20, mints an identity from notes alone, so no address ever links to it. The amount has to be one of a fixed set, which keeps identities made this way from being told apart by what funded them. At protocol ${pv} the set is:`;
  $('denoms').replaceChildren(...DENOMINATIONS[pv].map((d) => el('span', 'sh-denom', `${dash(d)} DASH`)));
}
function renderDenomCount(s) {
  const t = s.types.find((x) => x.key === 'IDENTITY_CREATE_FROM_SHIELDED_POOL');
  if (!t) return;
  $('denomCount').textContent = `${num(t.count)} identities on mainnet were made this way so far, ${dash(t.credits, 2)} DASH between them. The map traces such an identity back to the pool and stops there, because there is nothing before it to show.`;
}

// ── the snippet and the source line ──────────────────────────────────────────
function renderSnippet() {
  const code = `import { EvoSDK } from '@dashevo/evo-sdk';\n\nconst sdk = EvoSDK.mainnetTrusted();\nawait sdk.connect();\n\nconst credits = await sdk.shielded.poolState();           // bigint, or undefined when empty\nconst notes = await sdk.shielded.encryptedNotes(0n, 8192); // startIndex must be 0\nconst anchors = await sdk.shielded.anchors();              // Uint8Array[]\nconst latest = await sdk.shielded.mostRecentAnchor();\nconst [status] = await sdk.shielded.nullifiers([nullifierBytes]);\n\n// The counts per type and the weekly series are not chain queries; they come\n// from pshenmic's public index:\n//   GET ${apiHost('mainnet')}/transactions/shielded/statistic\n//   GET ${apiHost('mainnet')}/transactions/shield/history?timestamp_start=…&timestamp_end=…&intervalsCount=10`;
  const d = el('details', 'sh-raw');
  d.append(el('summary', null, 'SDK snippet'));
  const wrap = el('div');
  wrap.append(el('pre', 'box mono', code));
  wrap.append(copyBtn(code));
  d.append(wrap);
  $('snippetBox').replaceChildren(d);
}

// ── wiring ───────────────────────────────────────────────────────────────────
const currentNet = () => $('netsel').value;
const params = new URLSearchParams(location.search);
if (params.get('net') === 'testnet') $('netsel').value = 'testnet';

$('netsel').addEventListener('change', () => {
  const url = new URL(location.href);
  if (currentNet() === 'mainnet') url.searchParams.delete('net');
  else url.searchParams.set('net', 'testnet');
  history.replaceState(null, '', url);
  loadFlows(currentNet());
});
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (lastFlows) renderChart($('chart'), lastFlows.f, lastFlows.net); }, 150);
});
$('addrBtn').addEventListener('click', runCheck);
$('addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') runCheck(); });

renderMoves();
renderDenoms(PROTOCOL_THESE_HOLD_FOR);
renderSnippet();
$('source').textContent = `Chain reads go through @dashevo/evo-sdk to the masternodes; counts and the weekly series come from the public platform-explorer API (${apiHost('mainnet').replace('https://', '')}, testnet at ${apiHost('testnet').replace('https://', '')}).`;
Promise.all([loadPools(), loadFlows(currentNet())]).catch(showError);
