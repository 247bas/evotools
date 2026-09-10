// Does the pool follow the price? The arithmetic behind that question.
//
// Nothing here touches the network. It takes two daily series — what the pool
// did and what DASH cost — and returns correlations honest enough to print.
//
// Three of them, because the obvious one is the one that misleads. The pool has
// grown from nothing since July and DASH has risen over the same weeks, so a
// correlation of their *levels* is near +1 for the same reason any two rising
// lines are: it measures the shared trend, not a relationship. The number that
// can actually move is the day-to-day one: on a day when more went into the
// pool than came out, did the price move with it? And that one has a confounder
// of its own — a busy market day lifts both trading volume and the traffic into
// the pool — so the third figure removes volume first and reports what is left.

// Pearson's r on two equal-length arrays.
export function pearson(a, b) {
  const n = a.length;
  if (n < 3 || b.length !== n) return NaN;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0; let saa = 0; let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma; const db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return NaN;
  return sab / Math.sqrt(saa * sbb);
}

// Ranks with ties averaged, so Spearman handles the many zero-flow days.
export function ranks(a) {
  const order = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const out = new Array(a.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}
export const spearman = (a, b) => pearson(ranks(a), ranks(b));

// What is left of y once a straight line in x has been subtracted.
export function residuals(y, x) {
  const n = y.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0; let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return y.map((v, i) => v - (my + slope * (x[i] - mx)));
}

// a against b with c held out: correlate what neither of them owes to c.
export const partial = (a, b, c) => pearson(residuals(a, c), residuals(b, c));

// ── how likely is a correlation this large from nothing at all ───────────────
// Two-sided p for r under the null, out of Student's t on n−2 degrees of
// freedom: t = r·√(df/(1−r²)), and the tail from the regularised incomplete
// beta. Continued fraction after Numerical Recipes §6.4 — the same shape every
// stats package uses, written out because this page ships no libraries.
function betacf(a, b, x) {
  const TINY = 1e-30;
  let qab = a + b; let qap = a + 1; let qam = a - 1;
  let c = 1; let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}
function lnGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z; let y = z; let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export function pValue(r, n, controls = 0) {
  const df = n - 2 - controls;
  if (!Number.isFinite(r) || df < 1) return NaN;
  if (Math.abs(r) >= 1) return 0;
  const t2 = (r * r * df) / (1 - r * r);
  return betai(df / 2, 0.5, df / (df + t2));
}

// A correlation with everything needed to print it, and to argue with it.
const stat = (r, n, controls = 0) => ({ r, n, p: pValue(r, n, controls), controls });

// corr( net flow(t), return(t+k) ). k < 0 puts the price move first: the flow
// answers a move that already happened. k > 0 puts the flow first, which is the
// only direction that would be worth anything to a trader.
export function lagSweep(net, ret, { maxLag = 7, control = null } = {}) {
  const out = [];
  for (let k = -maxLag; k <= maxLag; k++) {
    const a = []; const b = []; const c = [];
    for (let i = 0; i < net.length; i++) {
      const j = i + k;
      if (j < 0 || j >= ret.length) continue;
      a.push(net[i]); b.push(ret[j]);
      if (control) c.push(control[i]);
    }
    if (a.length < 12) continue;
    out.push({
      k,
      ...stat(pearson(a, b), a.length),
      partial: control ? stat(partial(a, b, c), a.length, 1) : null,
    });
  }
  return out;
}

// Everything the page prints, from one table of days. The rows come from
// store.js: one a day, carrying what the pool did and what DASH cost, with the
// day in progress and any day the exchange did not trade already dropped.
export function analyse(rows) {
  const n = rows.length;
  if (n < 12) return { enough: false, days: n };
  const bal = rows.map((r) => r.balance);
  const usd = rows.map((r) => r.usd);
  const level = stat(pearson(bal, usd), n);
  level.rho = spearman(bal, usd);

  // Day-to-day: the day's net flow against the day's log return. Both start at
  // the second row, because the first day has no day before it.
  const net = []; const ret = []; const vol = [];
  for (let i = 1; i < n; i++) {
    net.push(rows[i].net);
    ret.push(Math.log(rows[i].usd / rows[i - 1].usd));
    vol.push(Math.log(Math.max(1, rows[i].volumeUsd || 1)));
  }
  const hasVolume = rows.some((r) => r.volumeUsd > 0);
  const daily = stat(pearson(net, ret), net.length);
  daily.rho = spearman(net, ret);
  const controlled = hasVolume ? stat(partial(net, ret, vol), net.length, 1) : null;

  // How much of the pool arrived on how few days. A handful of large moves and
  // a steady stream of small ones give the same correlation and mean different
  // things, so the page says which it is.
  const ins = rows.map((r) => r.in).sort((a, b) => b - a);
  const total = ins.reduce((s, v) => s + v, 0);
  const topN = Math.min(10, ins.length);
  const concentration = total > 0 ? ins.slice(0, topN).reduce((s, v) => s + v, 0) / total : 0;

  const lags = lagSweep(net, ret, { maxLag: 7, control: hasVolume ? vol : null });
  const best = lags.filter((l) => l.k !== 0)
    .reduce((a, l) => (Math.abs(l.r) > Math.abs(a?.r ?? 0) ? l : a), null);

  return {
    enough: true,
    days: n,
    from: rows[0].day,
    to: rows[n - 1].day,
    level,
    daily,
    controlled,
    lags,
    best,
    concentration,
    topN,
    balance: bal[n - 1],
    price: usd[n - 1],
  };
}

// ── what a price move does to the pool, hour by hour ─────────────────────────
// The daily figures above ask whether the pool and the price move together and
// answer "not once volume is out". That is the right answer to the wrong
// question. A day holds both a rise and the selling into it, so the two
// directions cancel inside the bucket; the pool's answer to a move takes hours,
// not days, and it is asymmetric. Splitting the flow into what entered and what
// left, and conditioning on the sign of the hour that came before, is what the
// per-transition data makes possible.
//
// Significance here is a permutation test, not a t-test: the flow is bursty and
// zero most hours, so nothing about it is normal. An event is compared against
// the same measurement taken from an equal number of hours drawn at random.

// A deterministic generator, so the p-value on the page is the same on every
// reload. mulberry32.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Credits in and out per hour of the price series, as prefix sums, so the total
// over any window is two subtractions.
export function hourlyFlow(events, hours, { isIn, isOut }) {
  const index = new Map(hours.map((h, i) => [h[0], i]));
  const inn = new Float64Array(hours.length + 1);
  const out = new Float64Array(hours.length + 1);
  for (const e of events) {
    const i = index.get(Math.floor(e.ts / 3600000) * 3600);
    if (i == null) continue;
    if (isIn(e.type)) inn[i] += e.dash;
    else if (isOut(e.type)) out[i] += e.dash;
  }
  const cumIn = new Float64Array(hours.length + 1);
  const cumOut = new Float64Array(hours.length + 1);
  for (let i = 0; i < hours.length; i++) {
    cumIn[i + 1] = cumIn[i] + inn[i];
    cumOut[i + 1] = cumOut[i] + out[i];
  }
  return { index, cumIn, cumOut, n: hours.length };
}

const windowSum = (cum, from, span, n) => cum[Math.min(n, from + span)] - cum[Math.min(n, from)];

// For each threshold: after an hour that moved the price that far, how much went
// in and out over the next `window` hours, against the same window measured from
// hours picked at random.
export function eventStudy(events, hours, { isIn, isOut, window = 6, thresholds = [0.02, 0.01, -0.01, -0.02], draws = 2000, minEvents = 8 } = {}) {
  if (hours.length < 48) return null;
  const flow = hourlyFlow(events, hours, { isIn, isOut });
  const rets = [];
  for (let i = 1; i < hours.length; i++) {
    if (hours[i][0] - hours[i - 1][0] !== 3600) continue;   // a gap is not a return
    rets.push({ i, ret: Math.log(hours[i][4] / hours[i - 1][4]) });
  }
  if (rets.length < 48) return null;
  const measure = (idx) => {
    let a = 0; let b = 0;
    for (const i of idx) {
      a += windowSum(flow.cumIn, i + 1, window, flow.n);
      b += windowSum(flow.cumOut, i + 1, window, flow.n);
    }
    return { in: a / idx.length, out: b / idx.length, net: (a - b) / idx.length };
  };
  const all = rets.map((r) => r.i);
  const baseline = measure(all);

  const random = rng(0x5eed);
  const rows = [];
  for (const th of thresholds) {
    const idx = rets.filter((r) => (th > 0 ? r.ret >= th : r.ret <= th)).map((r) => r.i);
    if (idx.length < minEvents) continue;
    const obs = measure(idx);
    let hits = 0;
    for (let d = 0; d < draws; d++) {
      const pick = [];
      const used = new Set();
      while (pick.length < idx.length) {
        const j = all[Math.floor(random() * all.length)];
        if (used.has(j)) continue;
        used.add(j); pick.push(j);
      }
      const m = measure(pick);
      if (th > 0 ? m.net >= obs.net : m.net <= obs.net) hits++;
    }
    rows.push({ threshold: th, n: idx.length, ...obs, p: (hits + 1) / (draws + 1) });
  }
  return { window, baseline, rows, hours: hours.length, events: events.length, draws };
}

// Where the price stood when credits moved. Descriptive on purpose: over a
// stretch this short DASH visits a level once, so a level and a date are the
// same fact and this cannot separate them.
export function byPrice(events, { isIn, isOut, bucket = 5 } = {}) {
  const by = new Map();
  for (const e of events) {
    if (e.usd == null) continue;
    const b = Math.floor(e.usd / bucket) * bucket;
    const row = by.get(b) ?? { from: b, to: b + bucket, in: 0, out: 0, nIn: 0, nOut: 0 };
    if (isIn(e.type)) { row.in += e.dash; row.nIn++; } else if (isOut(e.type)) { row.out += e.dash; row.nOut++; }
    by.set(b, row);
  }
  return [...by.values()].sort((a, b) => a.from - b.from).map((r) => ({ ...r, net: r.in - r.out }));
}
