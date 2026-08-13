// The map's screen side: paste something public, fill the boxes, and say what
// was found — including the way back from an identity to the coins that paid it.
import {
  resolve, fundingSource, dashFromCredits, dashFromDuffs,
  SECRET_REFUSED, MAX_INPUT, EXAMPLES, linkFor,
} from './map.js';
import { setNetwork, getNetwork, NETWORKS } from './sdk.js';
import { looksLikeSecret } from '../../shared/secrets.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const unit = () => (getNetwork() === 'mainnet' ? 'DASH' : 'tDASH');
const fmtDate = (d) => (d ? d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const EMPTY = '—';
const SVG_NS = 'http://www.w3.org/2000/svg';

function setBox(id, value, live) {
  $(id).textContent = value ?? EMPTY;
  const box = $(`${id}-box`);
  if (box) box.classList.toggle('on', !!live);
}

// An address is worth nothing with its middle cut out — you cannot check it, copy
// it or recognise it. SVG text does not wrap, so it is split over two lines here
// instead, at the halfway mark.
function setAddress(id, address, live) {
  const node = $(id);
  const box = $(`${id.replace('Addr', 'Val')}-box`);
  if (box) box.classList.toggle('on', !!live);
  node.replaceChildren();
  if (!address) { node.textContent = EMPTY; return; }
  const x = node.getAttribute('x');
  const y = Number(node.getAttribute('y'));
  const half = Math.ceil(address.length / 2);
  const lines = address.length > 22 ? [address.slice(0, half), address.slice(half)] : [address];
  lines.forEach((line, i) => {
    const t = document.createElementNS(SVG_NS, 'tspan');
    t.setAttribute('x', x);
    t.setAttribute('y', y + i * 13);
    t.textContent = line;
    node.append(t);
  });
}

// What crossed which boundary for the thing you looked up. The diagram carries
// the general rule; these three lines carry this identity's own numbers, on the
// arrow the money actually took.
const FLOW_MINT_DEFAULT = '→ mint 0.0024 · top up   ← pay out, needs the TRANSFER key';

function setFlows(trace) {
  $('flowLock').textContent = '';
  $('flowShield').textContent = '';
  $('flowMint').textContent = FLOW_MINT_DEFAULT;
  if (!trace) return;
  if (trace.kind === 'from-asset-lock' && trace.origin?.lockedDash) {
    $('flowLock').textContent = `${trace.origin.lockedDash} ${unit()} locked away here`;
  }
  if (trace.kind === 'from-shielded' && trace.shieldedCredits) {
    $('flowShield').textContent = `${dashFromCredits(trace.shieldedCredits)} ${unit()} came out`;
  }
  if (trace.kind === 'from-addresses' && trace.inputs?.[0]) {
    $('flowMint').textContent = `→ minted with ${dashFromCredits(trace.inputs[0].credits)} ${unit()} from that address`;
  }
}

function reset() {
  for (const id of ['l1Val', 'platVal', 'idVal']) setBox(id, EMPTY, false);
  for (const id of ['l1Addr', 'platAddr', 'idAddr']) setAddress(id, null, false);
  setFlows(null);
  $('findings').replaceChildren();
  $('mapError').hidden = true;
}

function showError(e) {
  const box = $('mapError');
  box.textContent = typeof e === 'string' ? e : (e?.message || String(e));
  box.hidden = false;
}

function card(title) {
  const d = el('div', 'finding');
  d.append(el('h4', null, title));
  return d;
}

function identityCardEl(c, network) {
  const d = card(c.names?.[0] ? c.names[0] : 'Identity');
  d.append(el('div', 'mono', c.id));
  const row = el('div', 'row');
  row.append(el('span', null, 'credits'));
  row.append(el('span', 'v', `${dashFromCredits(c.credits)} ${unit()}`));
  d.append(row);

  // A collector can hold dozens of names; a wall of them buries everything under
  // it. Show a handful, count the rest, and open the lot on request.
  if (c.names?.length) {
    const SHOWN = 12;
    const names = el('div', 'names');
    const chip = (n) => names.append(el('span', null, n));
    c.names.slice(0, SHOWN).forEach(chip);
    if (c.names.length > SHOWN) {
      const rest = c.names.slice(SHOWN);
      const more = el('button', 'chip-more', `+${rest.length} more${c.names.length >= 100 ? ' (the query stops at 100)' : ''}`);
      more.type = 'button';
      more.addEventListener('click', () => { more.remove(); rest.forEach(chip); });
      names.append(more);
    }
    d.append(names);
  }

  // A contested claim is not a name yet and not a failure either: it is money
  // parked on a vote. It belongs on the map precisely because nothing else lists
  // it. Said about the identity on screen, which is not necessarily the reader's.
  for (const p of c.pending || []) {
    const line = el('div', 'row pending');
    line.append(el('span', null, `${p.name} — claimed, in a masternode vote`));
    line.append(el('span', 'v', p.endsAt ? `decided ${fmtDate(p.endsAt)}` : 'two weeks from the claim'));
    d.append(line);
    const standing = !p.isContender
      ? 'this identity is not among the contenders'
      : p.contenders > 1
        ? `one of ${p.contenders} contenders, with ${p.votes} vote${p.votes === 1 ? '' : 's'}${p.ahead ? ' — ahead for now' : ''}`
        : `the only contender, with ${p.votes} vote${p.votes === 1 ? '' : 's'} so far`;
    d.append(el('div', 'mono', `${standing}. Its preorder holds 0.2 ${unit()} until the vote ends, which the balance above does not count.`));
  }

  if (!c.hasTransferKey) d.append(el('div', 'mono', 'No TRANSFER key: this identity cannot pay credits back out.'));

  const acts = el('div', 'acts');
  const net = network === 'mainnet' ? '&net=mainnet' : '';
  const link = (label, href) => { const a = el('a', null, label); a.href = href; acts.append(a); };
  link('Open in explorer →', `/explorer/?kind=identity&q=${c.id}${net}`);
  link('Move credits →', '/credits/');
  link('Claim a name →', '/name/');
  d.append(acts);
  return d;
}

// Where an identity came from. This is the half nothing else shows: the address
// that paid for it, and the layer-1 address that is the same key.
function traceEl(trace, network) {
  if (trace?.error) {
    const d = card('Could not trace the funding');
    d.append(el('div', 'mono', trace.error));
    return d;
  }
  // The other route in daily use: coins locked on layer 1 mint the identity
  // directly, with no platform address in between. Not an older way of doing it
  // — mainnet sees more of these than of the platform-address kind.
  if (trace?.kind === 'from-asset-lock') {
    const d = card('Minted straight from layer 1');
    if (trace.createdAt) d.append(el('div', 'mono', `created ${fmtDate(new Date(trace.createdAt))} — coins were locked on layer 1 and became this identity directly, without a platform address in between`));
    if (trace.lock?.txid) {
      const r = el('div', 'row');
      r.append(el('span', null, 'asset lock'));
      r.append(el('span', 'v', `${trace.lock.txid}:${trace.lock.vout}`));
      d.append(r);
    }
    if (trace.origin) {
      if (trace.origin.lockedDash) {
        const r = el('div', 'row');
        r.append(el('span', null, 'locked away'));
        r.append(el('span', 'v', `${trace.origin.lockedDash} ${unit()}`));
        d.append(r);
      }
      if (trace.origin.from.length) {
        const r = el('div', 'row');
        r.append(el('span', null, 'paid by'));
        r.append(el('span', 'v', trace.origin.from.join(', ')));
        d.append(r);
      }
      if (trace.origin.when) d.append(el('div', 'mono', `locked ${fmtDate(trace.origin.when)}`));
    }
    return d;
  }
  // Minted out of the shielded pool: the money is real and the amount is public,
  // but there is deliberately no address behind it to show.
  if (trace?.kind === 'from-shielded') {
    const d = card('Minted from the shielded pool');
    if (trace.createdAt) d.append(el('div', 'mono', `created ${fmtDate(new Date(trace.createdAt))}`));
    if (trace.shieldedCredits) {
      const r = el('div', 'row');
      r.append(el('span', null, 'came out of the pool'));
      r.append(el('span', 'v', `${dashFromCredits(trace.shieldedCredits)} ${unit()}`));
      d.append(r);
    }
    d.append(el('div', 'mono', 'No funding address exists to trace: the pool hides who paid, and only the amount leaving it is public. Three routes mint an identity on mainnet, and this is one of them.'));
    return d;
  }
  if (trace?.kind && trace.kind !== 'from-addresses') {
    const d = card('Funded a different way');
    d.append(el('div', 'mono', `Its creation transition is a ${trace.kind}, so no platform address paid for it. An identity filled by another identity has no layer-1 origin at all.`));
    return d;
  }
  if (!trace?.inputs?.length) return undefined;

  const d = card('Where this identity came from');
  if (trace.createdAt) d.append(el('div', 'mono', `created ${fmtDate(new Date(trace.createdAt))}`));
  for (const input of trace.inputs) {
    const r1 = el('div', 'row');
    r1.append(el('span', null, 'paid from'));
    r1.append(el('span', 'v', input.platformAddress));
    d.append(r1);
    const r2 = el('div', 'row');
    r2.append(el('span', null, 'the same key on layer 1'));
    r2.append(el('span', 'v', input.l1Address));
    d.append(r2);
    const r3 = el('div', 'row');
    r3.append(el('span', null, 'amount'));
    r3.append(el('span', 'v', `${dashFromCredits(input.credits)} ${unit()}`));
    d.append(r3);
  }

  const acts = el('div', 'acts');
  const btn = el('a', null, 'And where did those coins come from? →');
  btn.href = '#';
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    btn.textContent = 'Reading layer 1…';
    try {
      const hops = await fundingSource(trace.inputs[0].l1Address, network);
      btn.remove();
      for (const hop of hops) {
        const line = el('div', 'mono', hop.isLock
          ? `${fmtDate(hop.when)} — the asset lock itself: coins left layer 1 here`
          : hop.from.length
            ? `${fmtDate(hop.when)} — paid in from ${hop.from.join(', ')}`
            : `${fmtDate(hop.when)} — ${hop.txid}`);
        d.append(line);
      }
    } catch (e) {
      btn.textContent = 'And where did those coins come from? →';
      d.append(el('div', 'mono', `Layer 1 would not answer: ${e?.message || e}`));
    }
  });
  acts.append(btn);
  d.append(acts);
  return d;
}

function render(state) {
  const net = state.network;
  $('netsel').value = net;

  if (state.l1) {
    setBox('l1Val', `${dashFromDuffs(state.l1.duffs)} ${unit()}`, true);
    setAddress('l1Addr', state.l1.address, true);
  }
  if (state.platform) {
    setBox('platVal', `${dashFromCredits(state.platform.credits)} ${unit()}`, true);
    setAddress('platAddr', state.platform.address, true);
  }
  const first = state.identities?.[0];
  if (first) {
    setBox('idVal', `${dashFromCredits(first.credits)} ${unit()}`, true);
    setAddress('idAddr', first.id, true);
  }

  setFlows(state.trace);

  const out = $('findings');
  out.replaceChildren();

  if (state.l1?.unconfirmedDuffs > 0) {
    const w = card('Waiting for a confirmation');
    w.append(el('div', 'mono', `${dashFromDuffs(state.l1.unconfirmedDuffs)} ${unit()} on layer 1 is not spendable yet. An asset lock needs one confirmation.`));
    out.append(w);
  }

  for (const c of state.identities || []) out.append(identityCardEl(c, net));

  if (state.trace) {
    const t = traceEl(state.trace, net);
    if (t) out.append(t);
  }

  // An empty box invites the wrong conclusion. Say why it is empty.
  if (state.platformUnused) {
    setBox('platVal', 'not used', false);
    setAddress('platAddr', null, false);
    const p = card('No platform address in this story');
    p.append(el('div', 'mono', state.platformUnused));
    out.append(p);
  }

  // Somebody pasted an address that no identity carries. That is normal — the
  // key that funds an identity is usually not one of its keys — so say what it
  // does mean rather than showing nothing.
  if (!state.identities?.length && state.keyHash) {
    const none = card('No identity carries this key');
    none.append(el('div', 'mono', 'The balances above are all there is. A funding key is normally separate from the keys an identity holds, so a key that opens nothing is exactly what one looks like.'));
    const acts = el('div', 'acts');
    const a = el('a', null, 'Mint an identity from it →'); a.href = '/onboard/'; acts.append(a);
    none.append(acts);
    out.append(none);
  }
}

// ── examples ─────────────────────────────────────────────────────────────────
function renderExamples() {
  const p = $('examples');
  const list = EXAMPLES[getNetwork()] ?? [];
  p.replaceChildren();
  if (!list.length) { p.hidden = true; return; }
  p.hidden = false;
  p.append(el('span', null, 'Try it: '));
  list.forEach(({ q, note }, i) => {
    if (i) p.append(el('span', null, ' · '));
    const b = el('button', 'eg', q);
    b.type = 'button';
    b.addEventListener('click', () => { $('q').value = q; run(); });
    p.append(b);
    if (note) p.append(el('span', 'eg-note', ` — ${note}`));
  });
}

// ── shareable URL ────────────────────────────────────────────────────────────
// A filled-in map is worth sending to somebody, which means the query has to
// survive in the link. Only input that has already passed the secret check gets
// written here, so a key can never reach the address bar, the browser's history
// or a link that gets forwarded.
function syncUrl(q, net) {
  history.replaceState(null, '', linkFor(q, net) || location.pathname);
}

// Everything arriving from the URL is treated as if a stranger typed it: the
// network has to be one of the two known names, the query goes into the field as
// text (never as markup — this page builds every node with textContent), and a
// secret in a link is wiped from the address bar before anything else happens.
function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  const net = p.get('net');
  if (NETWORKS.includes(net)) { setNetwork(net); $('netsel').value = net; }
  renderExamples();
  const q = (p.get('q') ?? '').trim();
  if (!q) return;
  if (looksLikeSecret(q)) {
    syncUrl('', getNetwork());
    showError(new Error(`${SECRET_REFUSED} The link you followed carried one, and it has been removed from the address bar.`));
    return;
  }
  $('q').value = q.slice(0, MAX_INPUT);
  run();
}

async function run() {
  const raw = $('q').value.trim();
  reset();
  if (!raw) { syncUrl('', getNetwork()); return; }
  // Before the URL is touched. resolve() refuses a secret too, but by then it
  // would already be in the address bar.
  if (looksLikeSecret(raw)) {
    $('q').value = '';
    syncUrl('', getNetwork());
    showError(new Error(SECRET_REFUSED));
    return;
  }
  if (raw.length > MAX_INPUT) {
    syncUrl('', getNetwork());
    showError(new Error(`That is longer than any identifier this map takes (${MAX_INPUT} characters).`));
    return;
  }
  syncUrl(raw, $('netsel').value);
  const btn = $('goBtn');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Reading the chain…';
  try {
    render(await resolve(raw, { network: $('netsel').value }));
    // An input that names its own network (a y… address, a tdash1… one) moves the
    // toggle, so the link has to be re-stamped with the network actually used.
    syncUrl(raw, getNetwork());
    renderExamples();
  } catch (e) {
    showError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

$('finder').addEventListener('submit', (e) => { e.preventDefault(); run(); });
$('netsel').addEventListener('change', () => {
  setNetwork($('netsel').value);
  renderExamples();
  if ($('q').value.trim()) run(); else { reset(); syncUrl('', getNetwork()); }
});

loadFromUrl();
