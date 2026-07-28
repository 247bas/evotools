// The map's screen side: paste something public, fill the boxes, and say what
// was found — including the way back from an identity to the coins that paid it.
import { resolve, fundingSource, dashFromCredits, dashFromDuffs } from './map.js';
import { setNetwork, getNetwork } from './sdk.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const short = (s, head = 10, tail = 6) => (s && s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s || '');
const unit = () => (getNetwork() === 'mainnet' ? 'DASH' : 'tDASH');
const fmtDate = (d) => (d ? d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const EMPTY = '—';
function setBox(id, value, live) {
  $(id).textContent = value ?? EMPTY;
  const box = $(`${id}-box`);
  if (box) box.classList.toggle('on', !!live);
}

function reset() {
  for (const id of ['l1Val', 'l1Addr', 'platVal', 'platAddr', 'idVal', 'idAddr']) setBox(id, EMPTY, false);
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
      r.append(el('span', 'v', `${trace.lock.txid.slice(0, 20)}…:${trace.lock.vout}`));
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
        r.append(el('span', 'v', trace.origin.from.map((a) => short(a, 12, 6)).join(', ')));
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
            ? `${fmtDate(hop.when)} — paid in from ${hop.from.map((a) => short(a, 10, 5)).join(', ')}`
            : `${fmtDate(hop.when)} — ${hop.txid.slice(0, 16)}…`);
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
    setBox('l1Addr', short(state.l1.address, 12, 6), true);
  }
  if (state.platform) {
    setBox('platVal', `${dashFromCredits(state.platform.credits)} ${unit()}`, true);
    setBox('platAddr', short(state.platform.address, 12, 6), true);
  }
  const first = state.identities?.[0];
  if (first) {
    setBox('idVal', `${dashFromCredits(first.credits)} ${unit()}`, true);
    setBox('idAddr', short(first.id, 10, 5), true);
  }

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
    setBox('platAddr', '—', false);
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

async function run() {
  const raw = $('q').value.trim();
  reset();
  if (!raw) return;
  const btn = $('goBtn');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Reading the chain…';
  try {
    render(await resolve(raw, { network: $('netsel').value }));
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
  if ($('q').value.trim()) run(); else reset();
});
