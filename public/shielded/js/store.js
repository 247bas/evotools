// The stored history, and the little that has happened since.
//
// public/shielded/data holds every shielded transition with the DASH price at
// the block it landed in, and hourly candles beside it. That file is built by
// tools/shielded-history.mjs, which pays the expensive part once: the amount of
// a transition comes only from the index's per-transition endpoint, one call
// each, and the price comes from walking Kraken's whole trade tape. Neither of
// those changes afterwards — July will always say what July said.
//
// So the page reads the file, and then asks the index for one thing only: the
// transitions newer than the last block the file knows. That is a handful,
// however often the file is rebuilt, and it is the only reason this page still
// talks to the index at all.

import { TYPES } from './fees.js';

const INDEX = 'https://platform-explorer.pshenmic.dev';
const BASE = new URL('../data/', import.meta.url);
const PAGE = 100;
// A page load should never turn into a backfill. If the file is further behind
// than this, the page says so and works with what it has.
export const MAX_TOP_UP = 250;

export const IN_TYPES = [15, 18];
export const OUT_TYPES = [17, 19, 20];
export const isIn = (type) => IN_TYPES.includes(type);
export const isOut = (type) => OUT_TYPES.includes(type);

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status} ${res.statusText}`);
  return res.json();
};

// A row is [ts, type, credits, height, usd, priceAgeMinutes, hash] in the file;
// it comes out of here as an object, because the columns are an encoding, not a
// vocabulary.
const toEvent = (r, stored = true) => ({
  ts: r[0], type: r[1], credits: r[2], dash: r[2] / 1e11, height: r[3],
  usd: r[4], priceAge: r[5], hash: r[6], stored,
});

export async function loadStored() {
  const [t, p] = await Promise.all([
    json(new URL('transitions.json', BASE)),
    json(new URL('price-hourly.json', BASE)),
  ]);
  return {
    events: t.rows.map((r) => toEvent(r)),
    hours: p.rows,
    through: t.through,
    updated: t.updated,
    priceThrough: p.through,
  };
}

// ── what has happened since ──────────────────────────────────────────────────
// The list endpoint takes no "since": height and timestamp params are accepted
// and ignored. Newest-first until a block the file already has is the only
// honest way to ask.
async function newerThan(type, height, stopHash) {
  const found = [];
  for (let page = 1; page <= 3; page++) {
    const d = await json(`${INDEX}/transactions?transaction_type=${type}&limit=${PAGE}&order=desc&page=${page}`);
    const rows = d?.resultSet ?? [];
    if (!rows.length) break;
    let done = false;
    for (const r of rows) {
      if (r.hash === stopHash || r.blockHeight <= height) { done = true; break; }
      found.push(r.hash);
    }
    if (done || rows.length < PAGE) break;
  }
  return found;
}

async function detail(hash) {
  const d = await json(`${INDEX}/transaction/${hash}`);
  const type = Number(TYPES.find((t) => t.key === d.type)?.n ?? 0);
  return {
    hash, type, ts: Date.parse(d.timestamp), height: d.blockHeight,
    credits: Number(d.shielded?.amount ?? 0), status: d.status,
  };
}

// Kraken's candles, finest first: a minute each for the last 12 hours, an hour
// each for the last 30 days. A top-up row is priced from the finest series that
// reaches it, which for anything the file is missing is the minute one.
async function recentCandles() {
  const get = async (interval) => {
    const d = await json(`https://api.kraken.com/0/public/OHLC?pair=DASHUSD&interval=${interval}`);
    if (d.error?.length) throw new Error(d.error.join(', '));
    const key = Object.keys(d.result || {}).find((k) => k !== 'last');
    return (d.result[key] ?? []).map((c) => [c[0], Number(c[1]), Number(c[2]), Number(c[3]), Number(c[4]), Number(c[6])]);
  };
  const [minutes, hours] = await Promise.all([get(1), get(60)]);
  return { minutes, hours };
}

function priceFrom(candles, ms) {
  const s = Math.floor(ms / 1000);
  let lo = 0; let hi = candles.length - 1; let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid][0] <= s) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return [null, null];
  return [candles[best][4], Math.round(((s - candles[best][0]) / 60) * 10) / 10];
}

// The stored file plus everything after it, in one list. `added` says how many
// came from the index, `behind` when the file is too far back to catch up here.
export async function loadDataset() {
  const stored = await loadStored();
  const result = { ...stored, added: 0, behind: false, topUpError: null };
  if (!stored.through) return result;

  try {
    const lists = await Promise.all(TYPES.map((t) => newerThan(t.n, stored.through.height, stored.through.hash)));
    const hashes = lists.flat();
    if (!hashes.length) return result;
    if (hashes.length > MAX_TOP_UP) return { ...result, behind: hashes.length };

    const [details, candles] = await Promise.all([
      Promise.all(hashes.map(detail)),
      recentCandles().catch(() => ({ minutes: [], hours: [] })),
    ]);
    const fresh = details
      .filter((d) => d.status === 'SUCCESS' && d.type && d.height > stored.through.height)
      .map((d) => {
        const [usd, age] = priceFrom(candles.minutes, d.ts)[0] != null
          ? priceFrom(candles.minutes, d.ts)
          : priceFrom(candles.hours, d.ts);
        return { ...d, dash: d.credits / 1e11, usd, priceAge: age, stored: false };
      });
    const events = [...stored.events, ...fresh].sort((a, b) => a.ts - b.ts || a.height - b.height);

    // Extend the hourly candles to now as well, or the newest events would sit
    // beyond the end of the price series every chart is drawn from.
    const seen = new Set(stored.hours.map((h) => h[0]));
    const hours = [...stored.hours, ...candles.hours.filter((h) => !seen.has(h[0]))].sort((a, b) => a[0] - b[0]);
    return { ...result, events, hours, added: fresh.length };
  } catch (e) {
    return { ...result, topUpError: e?.message || String(e) };
  }
}

// ── shapes the page wants ────────────────────────────────────────────────────
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// One row a day: what went in, what went out, and the pool as those add up.
export function daily(events, { includeToday = false } = {}) {
  const today = dayKey(Date.now());
  const by = new Map();
  for (const e of events) {
    const d = dayKey(e.ts);
    const row = by.get(d) ?? { day: d, in: 0, out: 0, net: 0, balance: 0, count: 0 };
    if (isIn(e.type)) row.in += e.dash;
    else if (isOut(e.type)) row.out += e.dash;
    row.count++;
    by.set(d, row);
  }
  const rows = [...by.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  let balance = 0;
  // Days with no transition still exist; the balance carries across them.
  const out = [];
  if (!rows.length) return out;
  const first = new Date(`${rows[0].day}T00:00:00Z`).getTime();
  const last = new Date(`${rows[rows.length - 1].day}T00:00:00Z`).getTime();
  const filled = new Map(rows.map((r) => [r.day, r]));
  for (let t = first; t <= last; t += 86400000) {
    const d = dayKey(t);
    const r = filled.get(d) ?? { day: d, in: 0, out: 0, count: 0 };
    balance += r.in - r.out;
    if (!includeToday && d >= today) continue;
    out.push({ ...r, net: r.in - r.out, balance });
  }
  return out;
}

// The close of each hourly candle, and the log return against the hour before.
export function hourlyReturns(hours) {
  const out = [];
  for (let i = 1; i < hours.length; i++) {
    const gap = hours[i][0] - hours[i - 1][0];
    if (gap !== 3600) continue;            // a gap in the tape is not a return
    out.push({ ts: hours[i][0], close: hours[i][4], ret: Math.log(hours[i][4] / hours[i - 1][4]) });
  }
  return out;
}

// The daily close and the day's traded volume, off the hourly candles.
export function dailyPrice(hours) {
  const by = new Map();
  for (const [ts, , , , close, volume] of hours) {
    const day = dayKey(ts * 1000);
    const row = by.get(day) ?? { day, usd: close, volumeUsd: 0 };
    row.usd = close;                       // the last hour of the day wins
    row.volumeUsd += volume * close;
    by.set(day, row);
  }
  return [...by.values()];
}

// One row a day carrying both sides, which is what the correlations are fed.
// A day the exchange did not trade is dropped rather than carried forward: a
// missing price is not a flat one.
export function dailyRows(events, hours, { includeToday = false } = {}) {
  const price = new Map(dailyPrice(hours).map((p) => [p.day, p]));
  return daily(events, { includeToday })
    .map((d) => {
      const p = price.get(d.day);
      return p ? { ...d, usd: p.usd, volumeUsd: p.volumeUsd } : null;
    })
    .filter(Boolean);
}

// The same rows in weekly buckets, shaped like the index's history endpoint so
// the chart above does not care which of the two it was handed. Credits come
// back as BigInt for the same reason: that is what the index gives.
export function weekly(events, { launch, now = new Date() } = {}) {
  const WEEK = 7 * 86400000;
  const start = launch.getTime();
  const weeks = Math.max(2, Math.ceil((now.getTime() - start) / WEEK));
  const inn = Array.from({ length: weeks }, (_, i) => ({ at: new Date(start + i * WEEK), credits: 0n }));
  const out = inn.map((p) => ({ at: p.at, credits: 0n }));
  for (const e of events) {
    const i = Math.floor((e.ts - start) / WEEK);
    if (i < 0 || i >= weeks) continue;
    if (isIn(e.type)) inn[i].credits += BigInt(e.credits);
    else if (isOut(e.type)) out[i].credits += BigInt(e.credits);
  }
  return { in: inn, out, weeks, end: new Date(start + weeks * WEEK) };
}
