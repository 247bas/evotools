// shielded — the Orchard pool on Platform: what is in it, how it moves, what
// the six shielded transitions cost, and whether an address is a shielded one.
// Every value from the chain or the index is rendered with textContent.
import { statistic, flows, apiHost, LAUNCH } from './api.js';
import { loadDataset, dailyRows, weekly, isIn, isOut } from './store.js';
import { analyse, eventStudy, byPrice } from './correlate.js';
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
      notes.textContent = d.notes == null ? '—' : `${num(d.notes)}${d.notesExact ? '' : '+'}`;
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

// Mainnet buckets the transitions this site stores; testnet has no such file
// and asks the index for its weekly series. Same shape either way.
async function loadFlows(net) {
  const box = $('chart');
  box.replaceChildren(el('div', 'sh-sub', `Reading ${net}…`));
  $('chartNote').textContent = '';
  try {
    const f = net === 'mainnet'
      ? weekly((await dataset()).events, { launch: LAUNCH })
      : await flows(net);
    if (net !== currentNet()) return;
    renderChart(box, f, net);
    $('chartNote').textContent = `${f.weeks} weeks since ${fmtDay(LAUNCH)}; the last bar is the week in progress, ${net === 'mainnet' ? 'bucketed from this site\u2019s own rows' : 'from the index'}`;
    const s = indexByNet[net] ?? await statistic(net);
    indexByNet[net] = s;
    renderTypes(s, net);
  } catch (e) {
    box.replaceChildren(el('div', 'error', `Could not read the series: ${e?.message || e}`));
  }
}

// ── the pool against the price ───────────────────────────────────────────────
// The pool's balance is a chain fact; the price is not, and nothing on Platform
// knows it. So this section is the only one that reads a source outside Dash,
// and it says so under the chart. Testnet has no price: tDASH is not traded,
// and pretending otherwise would be the one dishonest number on the page.
const money = (v) => {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`;
  return `$${v.toFixed(2)}`;
};
// Axis labels want the short form: $400k, not $400,000.00.
const compactUsd = (v) => {
  const abs = Math.abs(v);
  if (abs < 1) return '$0';
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
};
// Shield sizes span 0.00001 DASH to five thousand, so a fixed number of
// decimals prints the small end as zero.
const smallAmt = (v) => (v >= 1 ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v >= 0.001 ? v.toFixed(3) : v.toPrecision(2));
const signed = (r) => (Number.isFinite(r) ? `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}` : '—');
const pText = (p) => (!Number.isFinite(p) ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3));
// In a sentence the operator has to read right: "p < 0.001", not "p = <0.001".
const pPhrase = (p) => (!Number.isFinite(p) ? '' : p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);

// The file is read once and both charts draw from it. Asking twice would mean
// two top-up round trips for the same handful of new transitions.
let datasetPromise = null;
const dataset = () => (datasetPromise ??= loadDataset());

let priceState = null;      // { chartRows, a }, kept so the unit toggle and a resize can redraw
// DASH or moves. The two answer different questions and disagree, which is the
// point of being able to switch: weighted by DASH one large actor carries the
// table, counted as moves everyone gets one vote and a 0.003 DASH test weighs
// the same as a 5,199 DASH shield.
let responseUnit = 'dash';
let priceUnit = 'dash';

function poolAt(row, unit) { return unit === 'usd' ? row.balance * row.usd : row.balance; }

function renderPoolPrice(box, rows, unit) {
  const W = Math.max(320, Math.round(box.clientWidth || 640));
  const H = 240; const L = 58; const R = 54; const T = 14; const B = 28;
  if (rows.length < 2) { box.replaceChildren(el('div', 'sh-sub', 'Not enough days yet.')); return; }
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  const pool = rows.map((r) => poolAt(r, unit));
  const px = rows.map((r) => r.usd);
  const poolMax = niceMax(Math.max(...pool));
  const pxLo = Math.min(...px); const pxHi = Math.max(...px);
  const pad = (pxHi - pxLo) * 0.15 || 1;
  const pxMin = Math.max(0, pxLo - pad); const pxMax = pxHi + pad;
  const x = (i) => L + ((W - L - R) * i) / (rows.length - 1);
  const yPool = (v) => T + (H - T - B) * (1 - v / poolMax);
  const yPx = (v) => T + (H - T - B) * (1 - (v - pxMin) / (pxMax - pxMin));

  for (const v of [0, poolMax / 2, poolMax]) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: yPool(v), y2: yPool(v), class: 'axis' }));
    const t = svgEl('text', { x: L - 8, y: yPool(v) + 4, 'text-anchor': 'end', class: 'tick' });
    t.textContent = unit === 'usd' ? compactUsd(v) : num(Math.round(v));
    svg.append(t);
  }
  const span = pxMax - pxMin;
  const dec = span >= 20 ? 0 : span >= 2 ? 1 : 2;
  for (const v of [pxMin, (pxMin + pxMax) / 2, pxMax]) {
    const t = svgEl('text', { x: W - R + 8, y: yPx(v) + 4, class: 'tick right' });
    t.textContent = `$${v.toFixed(dec)}`;
    svg.append(t);
  }
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const poolPts = rows.map((r, i) => [x(i), yPool(pool[i])]);
  svg.append(svgEl('path', { class: 'area', d: `${path(poolPts)} L${x(rows.length - 1).toFixed(1)},${yPool(0).toFixed(1)} L${L},${yPool(0).toFixed(1)} Z` }));
  svg.append(svgEl('path', { class: 'line pool', d: path(poolPts) }));
  svg.append(svgEl('path', { class: 'line price', d: path(rows.map((r, i) => [x(i), yPx(r.usd)])) }));

  // Six dates need room the price axis has taken; on a phone, three.
  const every = Math.ceil(rows.length / (W < 520 ? 3 : 6));
  rows.forEach((r, i) => {
    if (i % every === 0) {
      const t = svgEl('text', { x: x(i), y: H - 9, class: 'tick', 'text-anchor': i === 0 ? 'start' : 'middle' });
      t.textContent = fmtDay(new Date(`${r.day}T00:00:00Z`));
      svg.append(t);
    }
    const w = (W - L - R) / rows.length;
    const hit = svgEl('rect', { x: x(i) - w / 2, y: T, width: w, height: H - T - B, class: 'hit' });
    const title = svgEl('title');
    title.textContent = `${r.day}: pool ${num(Math.round(r.balance))} DASH (${money(r.balance * r.usd)}) at $${r.usd.toFixed(2)}, net ${r.net >= 0 ? '+' : '−'}${Math.abs(r.net).toFixed(1)} DASH that day`;
    hit.append(title);
    svg.append(hit);
  });
  box.replaceChildren(svg);
}

function renderWorth(a, chainBalance, priceRow) {
  const balance = chainBalance != null ? Number(chainBalance) / Number(CREDITS_PER_DASH) : a.balance;
  const shown = chainBalance != null ? dash(chainBalance, 2) : dashN(balance, 2);
  const w = (k, v, n) => {
    const b = el('div', 'w');
    b.append(el('div', 'w-k', k), el('div', 'w-v', v));
    if (n) b.append(el('div', 'w-n', n));
    return b;
  };
  $('worth').replaceChildren(
    // Formatted by dash() off the credits, exactly as the card at the top of the
    // page does it, so the same balance cannot appear twice in two spellings.
    // It read 11,170 here against 11,169.64 up there.
    w('In the pool', `${shown} DASH`, chainBalance != null ? 'from the chain' : 'from the index'),
    w('DASH', `$${priceRow.usd.toFixed(2)}`, `close of ${priceRow.day}`),
    w('The pool is worth', money(balance * priceRow.usd), 'balance × price, nothing more'),
  );
}

function renderCorr(a) {
  const tb = $('corr').querySelector('tbody');
  const row = (label, why, s, weak) => {
    const tr = el('tr');
    const td = el('td');
    td.append(el('div', null, label), el('div', 'why', why));
    tr.append(td);
    tr.append(el('td', `num${weak ? ' weak' : ''}`, signed(s.r)));
    tr.append(el('td', `num${weak ? ' weak' : ''}`, pText(s.p)));
    tb.append(tr);
  };
  tb.replaceChildren();
  row('Pool balance against price', 'Both have only gone up since July. Any two rising lines score high here, so this number says almost nothing on its own.', a.level, true);
  row("A day's net flow against that day's price move", 'The question that can actually move: more in than out on a day the price rose?', a.daily, false);
  if (a.controlled) {
    row('The same, with trading volume held out', 'A busy market day lifts the volume and the traffic into the pool at once. What survives removing it is the honest figure.', a.controlled, false);
  }
}

function renderVerdict(a) {
  const c = a.controlled ?? a.daily;
  const held = a.controlled ? ' once trading volume is held out' : '';
  const lead = c.p < 0.05
    ? `Day to day the two do move together${held}: r = ${signed(c.r)}, p = ${pText(c.p)} over ${c.n} days. `
    : `Day to day the link does not survive${held}: r = ${signed(c.r)}, p = ${pText(c.p)} over ${c.n} days, which is what chance looks like. `;
  const also = c.p < 0.05
    ? 'It is a weak link, not a lever: the flow explains a small share of the day, and the causality could run either way.'
    : 'What is left is the plainer reading: days that are busy for the market are busy for the pool.';
  const conc = `${Math.round(a.concentration * 100)}% of everything that ever entered the pool arrived on its ${a.topN} busiest days, so the shape of that line is set by a handful of large moves, not by a crowd.`;
  $('corrVerdict').textContent = `${lead}${also} ${conc}`;
}

function renderLags(a) {
  const box = $('lagStrip');
  box.replaceChildren();
  if (!a.lags.length) return;
  const use = (l) => (l.partial ?? l);
  const top = Math.max(...a.lags.map((l) => Math.abs(use(l).r)), 0.05);
  box.append(el('div', 'sh-sub', a.controlled
    ? 'The same day-to-day figure at a shift, with volume held out: the pool against the price move a few days earlier or later.'
    : 'The same day-to-day figure at a shift: the pool against the price move a few days earlier or later.'));
  const bars = el('div', 'bars');
  const axis = el('div', 'axis');
  for (const l of a.lags) {
    const s = use(l);
    const cell = el('div');
    const i = el('i');
    i.style.height = `${Math.max(2, (Math.abs(s.r) / top) * 100)}%`;
    if (s.r < 0) i.className = 'neg';
    if (a.best && l.k === a.best.k) i.className = `${i.className} best`.trim();
    const t = l.k === 0 ? 'the same day' : l.k < 0 ? `the price moved ${-l.k} day${l.k === -1 ? '' : 's'} first` : `the pool moved ${l.k} day${l.k === 1 ? '' : 's'} first`;
    i.title = `${t}: r = ${signed(s.r)}, p = ${pText(s.p)}, ${s.n} days`;
    cell.append(i);
    bars.append(cell);
    axis.append(el('span', null, l.k === 0 ? '0' : `${l.k > 0 ? '+' : '−'}${Math.abs(l.k)}`));
  }
  box.append(bars, axis);
  // The shift lives on the sweep entry; r and p may come from its partial, which
  // carries neither. Read each from the one that has it.
  const k = a.best?.k;
  const best = a.best ? use(a.best) : null;
  const which = k == null ? '' : k < 0
    ? `the price leading by ${-k} day${k === -1 ? '' : 's'}`
    : `the pool leading by ${k} day${k === 1 ? '' : 's'}`;
  box.append(el('div', 'cap', `Price first on the left, pool first on the right.${best ? ` The tallest is ${which} at r = ${signed(best.r)}, p = ${pText(best.p)}.` : ''} Fifteen shifts are measured at once, so the tallest bar flatters itself; a bar has to stay tall for weeks before it means anything.`));
}

const priceSectionNote = (msg) => {
  $('worth').replaceChildren();
  $('priceChart').replaceChildren(el('div', 'sh-sub', msg));
  $('corr').querySelector('tbody').replaceChildren();
  $('corrVerdict').textContent = '';
  $('lagStrip').replaceChildren();
  $('priceChartNote').textContent = '';
};

async function loadPriceView(net) {
  if (net !== 'mainnet') {
    priceState = null;
    priceSectionNote('tDASH is not traded, so there is no price to hold the testnet pool against. Switch to mainnet.');
    $('priceSource').textContent = '';
    responseNote('Mainnet only, for the same reason.');
    return;
  }
  priceSectionNote('Reading the stored history…');
  try {
    const data = await dataset();
    if (currentNet() !== 'mainnet') return;
    const rows = dailyRows(data.events, data.hours);
    const chartRows = dailyRows(data.events, data.hours, { includeToday: true });
    const a = analyse(rows);
    priceState = { chartRows, a, data };
    const lastHour = data.hours[data.hours.length - 1];
    const latest = lastHour ? { usd: lastHour[4], day: new Date(lastHour[0] * 1000).toISOString().slice(0, 10) } : null;
    if (!a.enough) {
      priceSectionNote(`Only ${a.days} full days line up so far, too few to say anything.`);
    } else {
      renderWorth(a, chainByNet[net]?.balance, latest ?? { usd: a.price, day: a.to });
      renderPoolPrice($('priceChart'), chartRows, priceUnit);
      $('priceChartNote').textContent = `${a.days} full days, ${a.from} to ${a.to}`;
      renderCorr(a);
      renderVerdict(a);
      renderLags(a);
    }
    $('priceSource').textContent = `Both series come from this site's own file: every shielded transition with the price at the block it landed in, and hourly candles built from Kraken's trade tape. Correlations are computed in this page, on full days only.`;
    renderResponse(data);
  } catch (e) {
    priceSectionNote(`Could not put the two together: ${e?.message || e}`);
    $('priceSource').textContent = '';
    responseNote(`Could not read the stored history: ${e?.message || e}`);
  }
}

// ── what a price move does to the pool ───────────────────────────────────────
const responseNote = (msg) => {
  $('response').querySelector('tbody').replaceChildren();
  $('responseVerdict').textContent = msg;
  $('priceBuckets').replaceChildren();
  $('dataNote').textContent = '';
};

const dashN = (v, d = 0) => `${Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

function renderResponse(data) {
  const counting = responseUnit === 'count';
  // One vote each: the same events with every amount set to one.
  const events = counting ? data.events.map((e) => ({ ...e, dash: 1 })) : data.events;
  const amount = (v) => (counting ? v.toFixed(2) : dashN(v, 1));
  const study = eventStudy(events, data.hours, { isIn, isOut, window: 6 });
  const tb = $('response').querySelector('tbody');
  tb.replaceChildren();
  $('colIn').textContent = counting ? 'moves in' : 'DASH in';
  $('colOut').textContent = counting ? 'moves out' : 'DASH out';
  if (!study) { responseNote('Not enough hours yet.'); return; }

  const row = (label, cls, n, r) => {
    const tr = el('tr', cls);
    tr.append(el('td', null, label));
    tr.append(el('td', 'num', n == null ? '—' : num(n)));
    tr.append(el('td', 'num', amount(r.in)));
    tr.append(el('td', 'num', amount(r.out)));
    tr.append(el('td', 'num', r.out > 0 ? `${(r.in / r.out).toFixed(2)}` : '—'));
    tr.append(el('td', 'num', r.p == null ? '' : pText(r.p)));
    tb.append(tr);
  };
  row('any hour at all', 'base', null, { ...study.baseline, p: null });
  for (const r of study.rows) {
    const pct = `${r.threshold > 0 ? '+' : '−'}${Math.abs(r.threshold * 100).toFixed(0)}%`;
    row(`the price ${r.threshold > 0 ? 'up' : 'down'} ${pct} or more`, r.threshold > 0 ? 'up' : 'down', r.n, r);
  }

  const up = study.rows.filter((r) => r.threshold > 0).sort((x, y) => y.threshold - x.threshold)[0];
  const down = study.rows.filter((r) => r.threshold < 0).sort((x, y) => x.threshold - y.threshold)[0];
  const base = study.baseline.out > 0 ? study.baseline.in / study.baseline.out : NaN;
  const unitWord = counting ? 'moves' : 'DASH';
  const parts = [];
  if (up) {
    parts.push(up.p < 0.05
      ? `A rise pulls ${counting ? 'people' : 'credits'} in: after an hour up ${Math.abs(up.threshold * 100).toFixed(0)}% or more, ${amount(up.in)} ${unitWord} went into the pool over the next six hours against ${amount(study.baseline.in)} for an ordinary hour, and where an ordinary hour is followed by ${base.toFixed(1)} times as much going in as coming out, this one is followed by ${(up.in / up.out).toFixed(1)} times. That holds up against six-hour windows drawn at random (${pPhrase(up.p)}).`
      : `After a rise the pool is busier, but not beyond what a randomly chosen six hours does (${pPhrase(up.p)}).`);
  }
  if (down) {
    parts.push(down.p < 0.05
      ? `A fall pushes them out: the same window after an hour down ${Math.abs(down.threshold * 100).toFixed(0)}% or more nets ${amount(down.net)} ${unitWord} (${pPhrase(down.p)}).`
      : `A fall sets both directions going at once without tilting the pool either way: ${amount(down.in)} in against ${amount(down.out)} out, which the random windows match easily (${pPhrase(down.p)}). What leaves on a drop is what the daily figure was hiding, because it goes out alongside what is coming in, and a day-sized bucket adds the two to nothing.`);
  }

  // The two views answer different questions, and the gap between them is the
  // finding. Measured here rather than asserted, so it stays true as the pool
  // grows: the other unit's ratios, without the permutation it does not need.
  const otherEvents = counting ? data.events : data.events.map((e) => ({ ...e, dash: 1 }));
  const other = eventStudy(otherEvents, data.hours, { isIn, isOut, window: 6, draws: 0 });
  const pick = (s, sign) => s?.rows.filter((r) => (sign > 0 ? r.threshold > 0 : r.threshold < 0))
    .sort((x, y) => (sign > 0 ? y.threshold - x.threshold : x.threshold - y.threshold))[0];
  const oUp = pick(other, 1); const oDown = pick(other, -1);
  if (up && down && oUp && oDown) {
    const swing = (u, d) => (u.out > 0 && d.out > 0 ? (u.in / u.out) / (d.in / d.out) : NaN);
    const here = swing(up, down); const there = swing(oUp, oDown);
    if (Number.isFinite(here) && Number.isFinite(there)) {
      const sizes = data.events.filter((e) => isIn(e.type)).map((e) => e.dash).sort((x, y) => x - y);
      const small = sizes[0] ?? 0; const large = sizes[sizes.length - 1] ?? 0;
      parts.push(counting
        ? `Counted this way a rise tilts the pool inwards ${here.toFixed(1)}× as hard as a fall does; by DASH the same six hours tilt ${there.toFixed(1)}×. Everyone gets one vote here, so the smallest shield on record (${smallAmt(small)} DASH) weighs what the largest one does (${dashN(large, 0)}), and the gap between those two numbers is the size of what a few large actors are doing.`
        : `Weighted this way a rise tilts the pool inwards ${here.toFixed(1)}× as hard as a fall does; counted as moves, where everyone gets one vote, the same six hours tilt ${there.toFixed(1)}×. The gap between those two is what a handful of large actors are doing, because a crowd would move both numbers together.`);
    }
  }

  const inflow = data.events.filter((e) => isIn(e.type));
  if (counting) {
    const sizes = inflow.map((e) => e.dash).sort((x, y) => x - y);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    parts.push(`Half of the ${num(inflow.length)} shields on record are under ${smallAmt(median)} DASH, so this column counts intent, not money.`);
  } else {
    // One large transition lands in a handful of windows and moves every
    // average here. Say how heavy the heaviest is, since a mean will not.
    const biggest = inflow.reduce((a, e) => (e.dash > (a?.dash ?? 0) ? e : a), null);
    const total = inflow.reduce((a, e) => a + e.dash, 0);
    const share = biggest && total ? biggest.dash / total : 0;
    if (share > 0.1) {
      parts.push(`One transition carries ${Math.round(share * 100)}% of everything that has ever gone in (${dashN(biggest.dash, 0)} DASH on ${new Date(biggest.ts).toISOString().slice(0, 10)}), and it sits inside a handful of these windows, so it moves every average in the table by itself.`);
    }
  }
  parts.push('Six hours and these thresholds were fixed before looking, and the same run measures every threshold, so no one line is a discovery on its own.');
  $('responseVerdict').textContent = parts.join(' ');

  renderBuckets(data);
  const added = data.added ? `, plus ${data.added} read from the index since` : '';
  const behind = data.behind ? ` The file is ${data.behind} transitions behind; run npm run data:shielded.` : '';
  const err = data.topUpError ? ` The index did not answer for the newest ones: ${data.topUpError}` : '';
  $('dataNote').textContent = `${num(data.events.length)} transitions and ${num(data.hours.length)} hourly candles, stored on this site through block ${data.through?.height ?? 0} (built ${new Date(data.updated).toISOString().slice(0, 16).replace('T', ' ')} UTC)${added}.${behind}${err} The index is asked for nothing older than that block. Significance is a permutation test over ${num(study.draws)} draws, seeded, so the number does not wander between reloads.`;
}

function renderBuckets(data) {
  const box = $('priceBuckets');
  box.replaceChildren();
  const counting = responseUnit === 'count';
  const buckets = byPrice(data.events, { isIn, isOut, bucket: 5 })
    .map((b) => ({ ...b, shownIn: counting ? b.nIn : b.in, shownOut: counting ? b.nOut : b.out }));
  if (!buckets.length) return;
  const max = Math.max(...buckets.map((b) => Math.max(b.shownIn, b.shownOut)));
  const head = el('div', 'head');
  head.append(el('span', null, ''), el('span', 'l', `out of the pool${counting ? ', moves' : ', DASH'}`), el('span', 'r', `into the pool${counting ? ', moves' : ', DASH'}`));
  box.append(head);
  // Mark the band DASH is trading in right now, off the newest candle rather
  // than the newest transition: the pool can be quiet for a day.
  const now = data.hours[data.hours.length - 1]?.[4];
  for (const b of buckets) {
    const rowEl = el('div', `sh-bucket${now != null && now >= b.from && now < b.to ? ' now' : ''}`);
    rowEl.append(el('div', 'lbl', `$${b.from}–${b.to}`));
    const side = (cls, value) => {
      const d = el('div', `side ${cls}`);
      const bar = el('b');
      bar.style.width = `${Math.max(value > 0 ? 2 : 0, (value / max) * 100).toFixed(1)}%`;
      d.append(bar);
      d.append(el('span', null, value >= 1 ? dashN(value, 0) : value > 0 ? value.toFixed(1) : ''));
      return d;
    };
    rowEl.append(side('l', b.shownOut), side('r', b.shownIn));
    const title = `$${b.from}–${b.to}: ${dashN(b.in, 1)} DASH in over ${b.nIn} moves, ${dashN(b.out, 1)} out over ${b.nOut}`;
    rowEl.title = title;
    box.append(rowEl);
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
  loadPriceView(currentNet());
});

$('responseToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-unit]');
  if (!btn || btn.dataset.unit === responseUnit) return;
  responseUnit = btn.dataset.unit;
  for (const b of $('responseToggle').querySelectorAll('button')) b.classList.toggle('on', b.dataset.unit === responseUnit);
  if (priceState?.data) renderResponse(priceState.data);
});

$('unitToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-unit]');
  if (!btn || btn.dataset.unit === priceUnit) return;
  priceUnit = btn.dataset.unit;
  for (const b of $('unitToggle').querySelectorAll('button')) b.classList.toggle('on', b.dataset.unit === priceUnit);
  if (priceState?.a?.enough) renderPoolPrice($('priceChart'), priceState.chartRows, priceUnit);
});
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (lastFlows) renderChart($('chart'), lastFlows.f, lastFlows.net);
    if (priceState?.a?.enough) renderPoolPrice($('priceChart'), priceState.chartRows, priceUnit);
  }, 150);
});
$('addrBtn').addEventListener('click', runCheck);
$('addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') runCheck(); });

renderMoves();
renderDenoms(PROTOCOL_THESE_HOLD_FOR);
renderSnippet();
$('source').textContent = `Chain reads go through @dashevo/evo-sdk to the masternodes, proof-verified: the SDK fetches the quorum public keys up front and checks each answer's proof against the quorum-signed state root, so a node cannot make a number up. What a proof does not carry is completeness — it says the notes you were given are real, not that there are no more, which is why the note count is paged rather than read in one go. The history is this site's own: every mainnet shielded transition with the price at its block, in /shielded/data, rebuilt by tools/shielded-history.mjs. The public platform-explorer API (${apiHost('mainnet').replace('https://', '')}, testnet at ${apiHost('testnet').replace('https://', '')}) is asked for three things only — its own totals, so the two can be held against each other; the transitions newer than the file's last block; and testnet, which has no file.`;
Promise.all([
  loadPools().then(() => loadPriceView(currentNet())),
  loadFlows(currentNet()),
]).catch(showError);
