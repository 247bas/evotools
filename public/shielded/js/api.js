// How the pool moves, from the public platform-explorer indexer.
//
// The chain will tell you the pool's balance, note count and anchors, and prove
// each of them. It will not tell you how many Shield transitions happened last
// week: a list needs an index. So the totals per type and the in/out series
// come from pshenmic's public API, the same data platform-explorer.com shows,
// and the cards next to them read the chain through the SDK so the two can be
// compared on the page.

import { TYPES } from './fees.js';

const HOSTS = {
  mainnet: 'https://platform-explorer.pshenmic.dev',
  testnet: 'https://testnet.platform-explorer.pshenmic.dev',
};
export const apiHost = (network) => HOSTS[network];

// The pool went live with protocol 12 in July 2026; the first mainnet Shield
// the index knows about is from the 12th.
export const LAUNCH = new Date('2026-07-01T00:00:00.000Z');

async function get(network, path) {
  const res = await fetch(`${HOSTS[network]}${path}`);
  if (!res.ok) throw new Error(`the explorer API answered ${res.status} ${res.statusText}`);
  return res.json();
}

// Totals per transition type, plus in and out. `indexPool` is in − out as the
// index sums it, which ignores the fees carved out of pool-paid transitions, so
// it runs a little above what the chain reports.
export async function statistic(network) {
  const d = await get(network, '/transactions/shielded/statistic');
  const byKey = Object.fromEntries((d.types ?? []).map((t) => [t.transactionType, t]));
  return {
    transitions: d.transitionsCount ?? 0,
    inCredits: BigInt(d.totalShieldedIn ?? 0),
    outCredits: BigInt(d.totalShieldedOut ?? 0),
    indexPool: BigInt(d.totalShieldedIn ?? 0) - BigInt(d.totalShieldedOut ?? 0),
    types: TYPES.map((t) => ({
      ...t,
      count: byKey[t.key]?.count ?? 0,
      credits: BigInt(byKey[t.key]?.amount ?? 0),
    })),
  };
}

// One series: credits entering ('in') or leaving ('out') the pool per bucket.
// The API wants ISO timestamps and a bucket count between 2 and 100; each point
// is the sum for the interval that ends at its timestamp.
export async function history(network, { direction = 'in', start = LAUNCH, end = new Date(), intervals = 10 } = {}) {
  const q = new URLSearchParams({
    timestamp_start: start.toISOString(),
    timestamp_end: end.toISOString(),
    intervalsCount: String(Math.min(100, Math.max(2, intervals))),
  });
  const rows = await get(network, `/transactions/${direction === 'out' ? 'unshield' : 'shield'}/history?${q}`);
  return rows.map((r) => ({
    at: new Date(r.timestamp),
    credits: BigInt(Math.round(r.data?.amount ?? 0)),
    height: r.data?.blockHeight,
  }));
}

// One bucket a day, since launch, in and out on the same days.
//
// The page does not draw from this any more — it has every transition in its
// own file and buckets them itself. It stays because the smoke test holds the
// two against each other: if our stored rows and the index's own daily sums
// ever disagree, one of them is wrong, and this is how that shows up.
//
// Two limits shape this. The API takes at most 100 buckets per call, and it
// sizes a bucket as ceil(range / count) and then walks from the start — so a
// range that is not a whole multiple of the bucket loses its last bucket (the
// trap flows() documents above). Both are handled the same way: ask in blocks
// of whole days, at most 100 at a time, each block starting and ending on a UTC
// midnight. A block of n days with n intervals makes the bucket exactly one day
// and the walk cover the whole block.
export const MAX_BUCKETS = 100;
const DAY = 86400000;
const midnight = (d) => Math.floor(d / DAY) * DAY;

export function dayBlocks(start, end, max = MAX_BUCKETS) {
  const from = midnight(start.getTime());
  const to = midnight(end.getTime());
  const blocks = [];
  for (let t = from; t < to; t += max * DAY) {
    const stop = Math.min(to, t + max * DAY);
    blocks.push({ start: new Date(t), end: new Date(stop), days: Math.round((stop - t) / DAY) });
  }
  return blocks;
}

// `now` counts as a whole day: the bucket for today is included and comes back
// with the day so far in it. What is done with a half-written day is the
// caller's business (the correlation drops it, the chart draws it).
export async function dailyFlows(network, { now = new Date() } = {}) {
  const end = new Date(midnight(now.getTime()) + DAY);
  const blocks = dayBlocks(LAUNCH, end);
  const per = await Promise.all(blocks.map((b) => Promise.all([
    history(network, { direction: 'in', start: b.start, end: b.end, intervals: b.days }),
    history(network, { direction: 'out', start: b.start, end: b.end, intervals: b.days }),
  ])));
  return {
    in: per.flatMap(([i]) => i),
    out: per.flatMap(([, o]) => o),
    days: blocks.reduce((s, b) => s + b.days, 0),
    end,
  };
}

// In and out on the same buckets, since launch, one bucket a week.
//
// The end is pushed out to a whole number of weeks on purpose. The API sizes a
// bucket as (end − start) / count rounded up to the second, then walks buckets
// from the start; when the range does not divide evenly the last bucket falls
// off the end and its transitions vanish from the series. Measured 2026-09-06:
// an end of "now" with 10 buckets returned 9 of them and 4,751 DASH of the
// 7,073 the index holds; an end on the week boundary returned all 10 and every
// credit. A point's timestamp is the start of its bucket, so the final one is
// the week in progress.
const WEEK = 7 * 86400000;
export async function flows(network, { now = new Date() } = {}) {
  const weeks = Math.max(2, Math.ceil((now - LAUNCH) / WEEK));
  const end = new Date(LAUNCH.getTime() + weeks * WEEK);
  const [inn, out] = await Promise.all([
    history(network, { direction: 'in', end, intervals: weeks }),
    history(network, { direction: 'out', end, intervals: weeks }),
  ]);
  return { in: inn, out, weeks, end };
}
