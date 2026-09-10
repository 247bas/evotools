#!/usr/bin/env node
// Build and top up the stored shielded dataset.
//
// Why store it at all. The index will tell you what a shielded transition is,
// but the amount only comes from the per-transition endpoint: one call each.
// The first run makes about 1,100 of them and walks Kraken's trade tape from
// July, which takes minutes. Nobody should pay that on a page load, and the
// history does not change — a transition that happened in July will say the
// same thing forever. So it is fetched once, written into public/shielded/data,
// and served from there. Every later run only asks for what came after the last
// row it already has, and the page itself asks the index for nothing older than
// the file's last block.
//
// Resolution: a transition carries the timestamp of the block it landed in, and
// mainnet blocks are ~2.5 minutes apart, with 99% of shielded transitions alone
// in their block. So this is an event list, not a bucketed series — no interval
// has to be chosen, and any interval can be derived from it later.
//
// Price: Kraken's public trade tape, every trade, folded into minute candles
// while the run walks it. Each transition is stamped with the close of the last
// minute that actually traded at or before its block — the staleness of that
// match is stored with it, so a row priced from an hour-old trade can be told
// from one priced ten seconds after the fact. Hourly candles are written
// alongside for the charts.
//
// Run: npm run data:shielded
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'shielded', 'data');
const TRANSITIONS = path.join(DATA, 'transitions.json');
const PRICE = path.join(DATA, 'price-hourly.json');

const INDEX = 'https://platform-explorer.pshenmic.dev';
const LAUNCH = Date.parse('2026-07-01T00:00:00.000Z');
// The six shielded transition types, by the number Platform gives them.
const TYPES = { 15: 'SHIELD', 16: 'SHIELDED_TRANSFER', 17: 'UNSHIELD', 18: 'SHIELD_FROM_ASSET_LOCK', 19: 'SHIELDED_WITHDRAWAL', 20: 'IDENTITY_CREATE_FROM_SHIELDED_POOL' };
const PAGE = 100;          // the index's page size
const DETAIL_WORKERS = 5;  // polite concurrency on the per-transition endpoint
const KRAKEN_GAP_MS = 1000; // Kraken's public tier is about a call a second

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) throw new Error(`${res.status} ${res.statusText}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(600 * (i + 1));
    }
  }
  return null;
}

const readFileOr = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

// ── the transitions ──────────────────────────────────────────────────────────
// The list endpoint has no "since" of any kind — height and timestamp params are
// accepted and then ignored, which is worse than being refused. So a top-up
// walks it newest-first and stops at the first hash already stored. On a first
// run there is nothing to stop at and it reads every page.
async function newHashes(type, known) {
  const found = [];
  for (let page = 1; ; page++) {
    const d = await getJson(`${INDEX}/transactions?transaction_type=${type}&limit=${PAGE}&order=desc&page=${page}`);
    const rows = d?.resultSet ?? [];
    if (!rows.length) break;
    let hitKnown = false;
    for (const r of rows) {
      if (known.has(r.hash)) { hitKnown = true; break; }
      found.push(r.hash);
    }
    if (hitKnown) break;
    const total = d?.pagination?.total;
    if (total != null && page * PAGE >= total) break;
    await sleep(80);
  }
  return found;
}

// The amount lives here and nowhere else: `shielded: { amount, direction }`.
async function detail(hash) {
  const d = await getJson(`${INDEX}/transaction/${hash}`);
  if (!d) return null;
  return {
    hash,
    type: Number(Object.entries(TYPES).find(([, name]) => name === d.type)?.[0] ?? 0),
    ts: Date.parse(d.timestamp),
    height: d.blockHeight,
    credits: Number(d.shielded?.amount ?? 0),
    direction: d.shielded?.direction ?? null,
    status: d.status,
  };
}

async function fetchDetails(hashes) {
  const out = [];
  let done = 0;
  const lanes = Array.from({ length: DETAIL_WORKERS }, (_, i) => hashes.filter((_, j) => j % DETAIL_WORKERS === i));
  await Promise.all(lanes.map(async (lane) => {
    for (const h of lane) {
      const d = await detail(h);
      if (d) out.push(d);
      if (++done % 100 === 0) process.stdout.write(`${done} `);
    }
  }));
  return out;
}

// ── the trade tape ───────────────────────────────────────────────────────────
// Kraken hands back a thousand trades and a cursor. A quiet day fits in two
// calls, the day DASH moved 32% took nine. Folded straight into minute candles
// so the whole tape never has to be held.
// Kraken answers "too many requests" with HTTP 200 and the complaint in an
// error array, so it slips past any check on the status code. Its counter
// decays over time rather than resetting, which is why the answer is to wait
// and ask for the same page again, not to give up on the run.
async function krakenTrades(cursor) {
  for (let attempt = 0; ; attempt++) {
    const d = await getJson(`https://api.kraken.com/0/public/Trades?pair=DASHUSD&since=${cursor}`);
    if (!d?.error?.length) return d;
    const busy = d.error.some((e) => /Too many requests|Rate limit/i.test(e));
    if (!busy || attempt >= 8) throw new Error(`Kraken: ${d.error.join(', ')}`);
    const wait = Math.min(60_000, 4000 * 2 ** attempt);
    log(`    rate limited, waiting ${wait / 1000}s`);
    await sleep(wait);
  }
}

async function tradeTape(fromSeconds) {
  const minutes = new Map();
  let cursor = String(fromSeconds);
  let trades = 0; let calls = 0; let last = fromSeconds;
  for (;;) {
    const d = await krakenTrades(cursor);
    const key = Object.keys(d.result).find((k) => k !== 'last');
    const rows = d.result[key] ?? [];
    calls++;
    if (!rows.length) break;
    for (const [price, volume, ts] of rows) {
      const p = Number(price); const v = Number(volume);
      const m = Math.floor(ts / 60) * 60;
      const c = minutes.get(m);
      if (!c) minutes.set(m, [p, p, p, p, v]);
      else { c[1] = Math.max(c[1], p); c[2] = Math.min(c[2], p); c[3] = p; c[4] += v; }
      last = ts;
    }
    trades += rows.length;
    cursor = d.result.last;
    if (calls % 25 === 0) log(`    ${calls} calls, ${trades} trades, at ${new Date(last * 1000).toISOString()}`);
    if (last * 1000 > Date.now() - 60_000 || rows.length < 10) break;
    await sleep(KRAKEN_GAP_MS);
  }
  log(`    ${calls} calls, ${trades} trades, ${minutes.size} minutes that traded`);
  return [...minutes.entries()].sort((a, b) => a[0] - b[0]).map(([ts, c]) => [ts, ...c]);
}

const toHourly = (minutes) => {
  const hours = new Map();
  for (const [ts, o, h, l, c, v] of minutes) {
    const b = Math.floor(ts / 3600) * 3600;
    const x = hours.get(b);
    if (!x) hours.set(b, [o, h, l, c, v]);
    else { x[1] = Math.max(x[1], h); x[2] = Math.min(x[2], l); x[3] = c; x[4] += v; }
  }
  return [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([ts, c]) => [ts, ...c]);
};

// The price a transition met: the close of the last minute that traded at or
// before its block, plus how many minutes stale that was.
function priceAt(minutes, ms) {
  const s = Math.floor(ms / 1000);
  let lo = 0; let hi = minutes.length - 1; let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (minutes[mid][0] <= s) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return [null, null];
  return [minutes[best][4], Math.round(((s - minutes[best][0]) / 60) * 10) / 10];
}

// ── writing ──────────────────────────────────────────────────────────────────
const round = (v, n) => (v == null ? null : Number(v.toFixed(n)));

// Only touched when the rows actually moved. `updated` alone would make every
// run a change, and then a scheduled top-up commits four times a day to say
// nothing happened — and each commit here is a deploy.
function write(file, body, previous) {
  const name = path.relative(process.cwd(), file);
  const rows = body.rows.map((r) => JSON.stringify(r)).join(',\n    ');
  if (previous && JSON.stringify(previous.rows) === JSON.stringify(body.rows)) {
    log(`  ${name}: unchanged, left alone (${body.rows.length} rows)`);
    return false;
  }
  fs.mkdirSync(DATA, { recursive: true });
  // One row per line: a diff shows the rows that were added, not one endless line.
  const head = { ...body, rows: '@@ROWS@@' };
  fs.writeFileSync(file, JSON.stringify(head, null, 2).replace('"@@ROWS@@"', `[\n    ${rows}\n  ]`) + '\n');
  log(`  wrote ${name}: ${body.rows.length} rows, ${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
  return true;
}

async function main() {
  const stored = readFileOr(TRANSITIONS, null);
  const storedPrice = readFileOr(PRICE, null);
  const rows = stored?.rows ?? [];
  const known = new Set(rows.map((r) => r[6]));
  log(`stored: ${rows.length} transitions${stored?.through ? `, through block ${stored.through.height}` : ' (nothing yet)'}`);

  log('asking the index what is new…');
  const hashes = [];
  for (const type of Object.keys(TYPES)) {
    const found = await newHashes(type, known);
    if (found.length) log(`  ${TYPES[type]}: ${found.length} new`);
    hashes.push(...found);
  }
  log(`${hashes.length} new transitions`);

  // Walk the tape from the last hour already stored, so a top-up costs a call
  // or two and a first run costs the whole history.
  const priceRows = storedPrice?.rows ?? [];
  const fromSeconds = priceRows.length ? priceRows[priceRows.length - 1][0] : Math.floor(LAUNCH / 1000);
  log(`walking Kraken's tape from ${new Date(fromSeconds * 1000).toISOString()}…`);
  const minutes = await tradeTape(fromSeconds);

  const details = hashes.length ? await fetchDetails(hashes) : [];
  if (hashes.length) log('');
  const failed = hashes.length - details.length;
  if (failed) log(`  ${failed} could not be read and were left for the next run`);

  const added = details
    .filter((d) => d.status === 'SUCCESS' && d.type)
    .map((d) => {
      const [usd, stale] = priceAt(minutes, d.ts);
      return [d.ts, d.type, d.credits, d.height, round(usd, 4), stale, d.hash];
    });
  const all = [...rows, ...added].sort((a, b) => a[0] - b[0] || a[3] - b[3]);
  // A hash can only be in here once, however often the script is run.
  const seen = new Set();
  const unique = all.filter((r) => (seen.has(r[6]) ? false : seen.add(r[6])));
  const last = unique[unique.length - 1];

  const wroteT = write(TRANSITIONS, {
    network: 'mainnet',
    what: 'Every shielded state transition on Dash Platform, one row each, with the DASH price at the block it landed in.',
    source: {
      transitions: `${INDEX}/transactions and /transaction/{hash} (pshenmic's public index)`,
      price: 'Kraken public trade tape, DASHUSD, folded into minute candles',
    },
    updated: new Date().toISOString(),
    through: last ? { height: last[3], ts: new Date(last[0]).toISOString(), hash: last[6] } : null,
    types: TYPES,
    columns: ['ts', 'type', 'credits', 'height', 'usd', 'priceAgeMinutes', 'hash'],
    rows: unique,
  }, stored);

  const hourly = toHourly(minutes);
  const mergedHours = new Map(priceRows.map((r) => [r[0], r]));
  for (const h of hourly) mergedHours.set(h[0], h);   // a re-read hour replaces the old one
  const hours = [...mergedHours.values()].sort((a, b) => a[0] - b[0])
    .map(([ts, o, h, l, c, v]) => [ts, round(o, 4), round(h, 4), round(l, 4), round(c, 4), round(v, 3)]);
  const wroteP = write(PRICE, {
    pair: 'DASHUSD',
    what: 'Hourly candles built from every Kraken trade since the pool opened.',
    source: 'Kraken public trade tape (api.kraken.com/0/public/Trades)',
    updated: new Date().toISOString(),
    through: hours.length ? hours[hours.length - 1][0] : null,
    columns: ['ts', 'open', 'high', 'low', 'close', 'volume'],
    rows: hours,
  }, storedPrice);

  log(`\n${unique.length} transitions, ${hours.length} hourly candles.${wroteT || wroteP ? '' : ' Nothing changed.'}`);
  if (unique.length) {
    const dash = (c) => (c / 1e11).toFixed(2);
    const inC = unique.filter((r) => [15, 18].includes(r[1])).reduce((s, r) => s + r[2], 0);
    const outC = unique.filter((r) => [17, 19, 20].includes(r[1])).reduce((s, r) => s + r[2], 0);
    log(`in ${dash(inC)} DASH, out ${dash(outC)}, pool ${dash(inC - outC)} — hold that against the chain.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
