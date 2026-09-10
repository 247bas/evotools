// Smoke test for /shielded: the address rules, the fee arithmetic, the index's
// shape, and the chain's own numbers — with the two sources held against each
// other. Run: node public/shielded/test/smoke.mjs
import {
  classify, encodeShielded, encodeBech32m, decodeBech32m, toHex, SHIELDED_TYPE, P2PKH_TYPE, RAW_BYTES,
} from '../js/address.js';
import {
  FEES, POOL, DENOMINATIONS, TYPES, computeFee, minimumPoolFee, unshieldFee, withdrawalFee, minimumFor, dash,
  PROTOCOL_THESE_HOLD_FOR, CREDITS_PER_DASH,
} from '../js/fees.js';
import { statistic, history, flows, dailyFlows, dayBlocks, MAX_BUCKETS, LAUNCH } from '../js/api.js';
import { pearson, spearman, ranks, residuals, partial, pValue, analyse, eventStudy, byPrice } from '../js/correlate.js';
import { loadDataset, dailyRows, daily, weekly, isIn, isOut } from '../js/store.js';
import { readFileSync } from 'node:fs';
import { poolState } from '../js/pool.js';
import { countNotes, CHUNK as NOTE_CHUNK } from '../../shared/shielded-notes.js';
import { loadEvo, getSdkFor } from '../js/sdk.js';
import { l1FromHash } from '../../map/js/addresses.js';
import { looksLikeSecret } from '../../shared/secrets.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => (c ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));
const safe = async (l, fn) => {
  try { return await fn(); } catch (e) { failed++; console.log(`  ❌ ${l}: ${e?.message || e}`); }
};
// For corroboration from somebody else's server: their being down says nothing
// about our code, so it must not turn this suite red. Their disagreeing does.
const optional = async (l, fn) => {
  try { return await fn(); } catch (e) { console.log(`  ⚪ ${l} unreachable, skipped: ${e?.message || e}`); }
};

console.log('\n1. A shielded address: 43 bytes, a z after the 1, and back again');
const raw = Uint8Array.from({ length: RAW_BYTES }, (_, i) => (i * 37 + 11) & 255);
for (const net of ['mainnet', 'testnet']) {
  const addr = encodeShielded(raw, net);
  check(addr.startsWith(net === 'mainnet' ? 'dash1z' : 'tdash1z'), `${net}: ${addr.slice(0, 12)}… starts with ${net === 'mainnet' ? 'dash1z' : 'tdash1z'}`);
  const c = classify(addr);
  check(c.kind === 'shielded' && c.network === net, `classified as shielded on ${net}`);
  check(c.diversifier === toHex(raw.slice(0, 11)) && c.pkd === toHex(raw.slice(11)), 'diversifier and pk_d come back byte for byte');
  check(classify(addr.toUpperCase()).kind === 'shielded', 'upper case is the same address');
  const typo = addr.slice(0, -1) + (addr.endsWith('q') ? 'p' : 'q');
  check(classify(typo).kind === 'invalid' && /typo/.test(classify(typo).reason), 'one wrong character fails the checksum');
}
const short = encodeBech32m('dash', [SHIELDED_TYPE, ...raw.slice(0, 20)]);
check(classify(short).kind === 'invalid' && /43 bytes/.test(classify(short).reason), 'the right type byte with the wrong length is refused');
check(classify('dash1zzz').kind === 'invalid', 'too short to be anything is refused');
check(classify('hello').kind === 'other', 'a word is not a Platform address');
check(classify('').kind === 'empty', 'nothing pasted is nothing');

console.log('\n2. The transparent kinds are told apart, not looked up');
const DONATION_PLATFORM = 'dash1kzlfww9p9qscm5dnfp3y2jn9hdnsex0u6vdhgsma';
const DONATION_L1 = 'Xt4bNjax7F6ynNL2r1LmEXTNPUSiPVtXpR';
const p = classify(DONATION_PLATFORM);
check(p.kind === 'platform' && p.network === 'mainnet', `${DONATION_PLATFORM.slice(0, 12)}… is a transparent platform address`);
// The same 20 bytes spelled the layer-1 way must be the site's donation address:
// that pins our bech32m decoder to the map's base58 derivation.
const twin = p.hashBytes && await safe('l1FromHash', () => l1FromHash(p.hashBytes, 'mainnet'));
check(twin === DONATION_L1, `its layer-1 twin is ${twin}`);
check(classify(DONATION_L1).kind === 'layer1' && classify(DONATION_L1).network === 'mainnet', `${DONATION_L1.slice(0, 8)}… is a layer-1 address`);
check(classify('yXo8Q1sYJf5F5ipXhN6HJ1fT1CrYKzH4Ex').network === 'testnet', 'a y… address is testnet');
check(looksLikeSecret('XK6c2X1iYb8w7f5rE3f7fJ5Y5Qz2wq6M9bCk3e8n2fN4mP3zJq1L'), 'a WIF is refused before it reaches the checker');

console.log('\n3. The encoder agrees with the SDK on a transparent address');
// The WASM only comes alive with a connected SDK, so connect before touching
// PlatformAddress — the same order the map keeps.
const Evo = await safe('loadEvo + connect', async () => { await getSdkFor('mainnet'); return loadEvo(); });
if (Evo) {
  const viaSdk = await safe('PlatformAddress.fromP2pkhHash', () => Evo.PlatformAddress.fromP2pkhHash(p.hashBytes).toBech32m('mainnet'));
  const ours = encodeBech32m('dash', [P2PKH_TYPE, ...p.hashBytes]);
  check(viaSdk === ours && ours === DONATION_PLATFORM, 'same bytes, same spelling, from both encoders');
  const sdkHash = await safe('PlatformAddress.fromBech32m', () => toHex(Evo.PlatformAddress.fromBech32m(DONATION_PLATFORM).hash()));
  check(sdkHash === p.hash, 'and the SDK decodes to the same hash we do');
}

console.log(`\n4. The fee arithmetic, at protocol ${PROTOCOL_THESE_HOLD_FOR}`);
check(computeFee(1) === 122_000_000n && computeFee(2) === 144_000_000n, `entering: ${dash(computeFee(2))} DASH of compute fee at two actions, storage on top`);
check(minimumPoolFee(2) === 162_851_200n, `a two-action transfer carves at least ${dash(minimumPoolFee(2))} DASH from the notes`);
check(unshieldFee(2) === 168_934_000n, `an unshield: ${dash(unshieldFee(2))} DASH`);
check(withdrawalFee(2) === 275_191_200n, `a withdrawal to layer 1: ${dash(withdrawalFee(2))} DASH`);
check(minimumPoolFee(2) < FEES.implicitFeeCap, `all under the 0.2 DASH cap a pool-paid fee may not exceed`);
check(TYPES.length === 6 && TYPES.every((t) => minimumFor(t.key).credits > 0n), 'every one of the six types has a minimum');
check(DENOMINATIONS[13].length === 5 && DENOMINATIONS[13][0] === 3_000_000_000n, `protocol 13 mints an identity for ${DENOMINATIONS[13].map((d) => dash(d)).join(', ')} DASH`);
check(DENOMINATIONS[12].length === 4 && DENOMINATIONS[12].includes(30_000_000_000n), 'protocol 12 had 0.3 instead of 0.03 and 0.25');
check(dash(CREDITS_PER_DASH) === '1' && dash(0n) === '0' && dash(364626261704578n, 2) === '3,646.26', 'credits format as DASH');
check(POOL.minimumNotesForOutgoing === 250 && POOL.anchorRetentionBlocks === 1000, 'pool rules pinned');

console.log('\n5. The index: totals per type, in and out');
const s = await safe('statistic(mainnet)', () => statistic('mainnet'));
check(s?.transitions > 900, `${s?.transitions} shielded transitions on mainnet`);
check(s?.types.length === 6 && s.types.every((t) => Number.isFinite(t.count)), `all six types counted: ${s?.types.map((t) => `${t.name} ${t.count}`).join(' · ')}`);
check(s?.inCredits > s?.outCredits, `${dash(s?.inCredits, 2)} DASH went in, ${dash(s?.outCredits, 2)} came out`);
const summedIn = s?.types.filter((t) => t.from !== 'pool' && t.to === 'pool').reduce((a, t) => a + t.credits, 0n);
check(summedIn === s?.inCredits, 'the entering types add up to the in total');
const summedOut = s?.types.filter((t) => t.from === 'pool' && t.to !== 'pool').reduce((a, t) => a + t.credits, 0n);
check(summedOut === s?.outCredits, 'and the leaving types to the out total');

console.log('\n6. The series since launch');
const f = await safe('flows(mainnet)', () => flows('mainnet'));
check(f?.in.length === f?.weeks && f?.out.length === f?.weeks, `${f?.in.length} weekly buckets in, ${f?.out.length} out (${f?.weeks} weeks since ${LAUNCH.toISOString().slice(0, 10)})`);
check(f?.in.every((x) => x.at instanceof Date && typeof x.credits === 'bigint'), 'each point is a date and a bigint');
check(f?.in[0]?.at.getTime() === LAUNCH.getTime(), 'a point is stamped with the start of its bucket');
// Same table as the totals, so the buckets must hold everything — this is what
// an end timestamp off the week boundary silently breaks (see flows()).
const seriesIn = f?.in.reduce((a, x) => a + x.credits, 0n) ?? 0n;
const inTotal = s?.inCredits ?? 0n;
check(seriesIn >= inTotal * 95n / 100n && seriesIn <= inTotal * 105n / 100n, `the buckets sum to ${dash(seriesIn, 2)} DASH against ${dash(inTotal, 2)} in the totals`);
const seriesOut = f?.out.reduce((a, x) => a + x.credits, 0n) ?? 0n;
check(seriesOut >= (s?.outCredits ?? 0n) * 95n / 100n, `and the out buckets to ${dash(seriesOut, 2)}`);
const hour = await safe('history(1 bucket set)', () => history('mainnet', { start: new Date(Date.now() - 3600e3), intervals: 2 }));
check(Array.isArray(hour), 'a short range answers too');

console.log('\n7. The chain, and the index held against it');
const m = await safe('poolState(mainnet)', () => poolState('mainnet'));
check(m?.balance > 0n, `mainnet pool holds ${dash(m?.balance, 2)} DASH`);
check(m?.notes > 0 && m?.notesExact, `${m?.notes} notes, ${m?.anchors} anchors`);

// The note count is the one number on this page that cannot be read off an
// endpoint. It has to be counted by paging, and a node hands its per-request
// ceiling back looking exactly like a complete answer — which is how 2,048 got
// published while the pool held 2,301. So the count is checked three ways, and
// the first two need nobody's help.
//
// One: it must not depend on how much we asked for. That is precisely the bug.
const sdkM = await safe('sdk for the note count', () => getSdkFor('mainnet'));
if (sdkM) {
  const counts = [];
  for (const ask of [1 << 20, 8192, 4096]) counts.push(await countNotes(sdkM, { ask }));
  check(counts.every((c) => c.count === counts[0].count && c.exact),
    `counted ${counts[0].count} notes whether we ask for 1,048,576, 8,192 or 4,096 at a time`);
  check(counts[0].count === m.notes, 'and the page shows that same number');
  // Two: it ends on a part-chunk. A ceiling is always whole chunks, because a
  // node that stopped mid-chunk could not be resumed — startIndex has to be a
  // multiple of the chunk. So a part-chunk is the end of the pool and nothing
  // else, and this is the whole argument the count rests on.
  check(m.notes % NOTE_CHUNK !== 0, `${m.notes} is not a whole number of ${NOTE_CHUNK}-note chunks, so the last read was the end of the pool`);
  await safe('the alignment rule still holds', async () => {
    let refused = false;
    try { await sdkM.shielded.encryptedNotes(BigInt(m.notes), 4096); } catch (e) { refused = /chunk-aligned|multiple/i.test(e?.message || ''); }
    check(refused, 'and a read that starts off a chunk boundary is still refused, which is why that argument works');
  });
}

// Three: somebody else's count, arrived at by their own code against their own
// node. Corroboration, not the basis — if MNOwatch is down that says nothing
// about us, so it is allowed to be absent but not to disagree.
const mno = await optional('mnowatch.org', async () => {
  const r = await fetch('https://mnowatch.org/evonodes/shieldedBalance.php');
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
});
if (mno && m) {
  const theirs = Number(mno.totalshieldednotescount);
  check(Math.abs(theirs - m.notes) <= 3, `MNOwatch counts ${theirs} notes against our ${m.notes}`);
  const theirBalance = Math.round(Number(mno.totalshieldedbalance) * 1e5);
  const ours = Math.round((Number(m.balance) / Number(CREDITS_PER_DASH)) * 1e5);
  check(Math.abs(theirBalance - ours) <= 100, `and ${Number(mno.totalshieldedbalance).toFixed(5)} DASH against our ${(Number(m.balance) / Number(CREDITS_PER_DASH)).toFixed(5)}`);
}
check(m?.noteBytes === POOL.noteBytes, `a note is ${m?.noteBytes} bytes`);
check(m?.protocolVersion === PROTOCOL_THESE_HOLD_FOR, `mainnet runs protocol ${m?.protocolVersion} — the fee constants above were read at ${PROTOCOL_THESE_HOLD_FOR}; re-check them if this fails`);
if (m && s) {
  const diff = s.indexPool - m.balance;
  const abs = diff < 0n ? -diff : diff;
  check(abs < 5n * CREDITS_PER_DASH, `index in−out is ${dash(s.indexPool, 2)}, chain says ${dash(m.balance, 2)}: ${dash(diff, 4)} apart (fees carved from the pool, or index lag)`);
}
const t = await safe('poolState(testnet)', () => poolState('testnet'));
check(t?.balance > 0n && t?.protocolVersion >= 12, `testnet pool holds ${dash(t?.balance, 2)} tDASH at protocol ${t?.protocolVersion}`);
const ts = await safe('statistic(testnet)', () => statistic('testnet'));
check(ts?.transitions > 0, `testnet index knows ${ts?.transitions} transitions`);

console.log('\n8. The pool against the price: the arithmetic, then the two series');
// Pinned against scipy (stats.pearsonr / spearmanr / t.sf), so a rewrite of the
// hand-rolled incomplete beta below fails here instead of on the page.
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) < tol;
const A = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const B = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9];
check(near(pearson(A, B), 0.9393939394, 1e-9) && near(spearman(A, B), 0.9393939394, 1e-9), 'pearson and spearman agree with scipy to nine places');
check(ranks([3, 1, 4, 1, 5]).join(',') === '3,1.5,4,1.5,5', 'tied values share the average rank');
check(near(pValue(0.5, 30), 0.0048999337, 1e-9), 'p for r=+0.50 over 30 days is 0.0049, as Student says');
check(near(pValue(0.3, 70), 0.0116293697, 1e-9) && near(pValue(-0.42, 25), 0.0365936209, 1e-9), 'and for +0.30 over 70 and −0.42 over 25');
check(pValue(0.877, 71) < 1e-20, 'a level correlation of +0.88 over 71 days is not chance — which is the point: trend, not link');
// Two series driven by the same third one correlate at +0.98 and share nothing
// once it is removed. This is the shape of the volume confound on the page.
const conf = Array.from({ length: 60 }, (_, i) => Math.sin(i * 1.7) * 3 + i * 0.1);
const cx = conf.map((c, i) => c * 2 + Math.sin(i * 0.9));
const cy = conf.map((c, i) => c * 1.5 + Math.cos(i * 1.3));
check(near(pearson(cx, cy), 0.9758258151, 1e-9), `two series off one driver correlate at ${pearson(cx, cy).toFixed(3)}`);
check(near(partial(cx, cy, conf), -0.0334197811, 1e-9), `with the driver held out, ${partial(cx, cy, conf).toFixed(3)} is left`);
check(residuals([1, 2, 3], [1, 2, 3]).every((v) => Math.abs(v) < 1e-12), 'a perfect line leaves no residual');

// Daily buckets: at most 100 per call, every block a whole number of UTC days,
// and no gap between them. The API drops a bucket that does not divide evenly.
const blocks = dayBlocks(new Date('2026-01-01T00:00:00Z'), new Date('2026-09-10T13:00:00Z'));
check(blocks.every((b) => b.days <= MAX_BUCKETS) && blocks.reduce((a, b) => a + b.days, 0) === 252, `252 days split into ${blocks.map((b) => b.days).join(' + ')} buckets`);
check(blocks.every((b) => b.start.getTime() % 86400000 === 0 && b.end.getTime() % 86400000 === 0), 'every block starts and ends on a UTC midnight');
check(blocks.every((b, i) => i === 0 || b.start.getTime() === blocks[i - 1].end.getTime()), 'and the blocks touch, so no day falls between them');

const df = await safe('dailyFlows(mainnet)', () => dailyFlows('mainnet'));
check(df?.in.length === df?.days && df?.out.length === df?.days, `${df?.days} daily buckets in and out`);
// The same guard as the weekly series, one resolution finer: if a bucket is
// lost the daily total stops matching the index's own total.
const dIn = df?.in.reduce((a, x) => a + x.credits, 0n) ?? 0n;
check(dIn === s?.inCredits, `the daily buckets sum to ${dash(dIn, 2)} DASH, exactly the index total`);
const dOut = df?.out.reduce((a, x) => a + x.credits, 0n) ?? 0n;
check(dOut === s?.outCredits, `and out to ${dash(dOut, 2)} DASH`);

console.log('\n9. The stored history: this site\'s own file, and the index held against it');
// The page reads a file, not the index. Node has no fetch for file:// URLs, so
// serve them off disk and let store.js run exactly as it does in a browser,
// live top-up and all.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input?.url ?? input);
  if (!url.startsWith('file://')) return realFetch(input, init);
  const body = readFileSync(new URL(url), 'utf8');
  return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
};
const data = await safe('loadDataset()', () => loadDataset());
globalThis.fetch = realFetch;

check(data?.events.length > 900, `${data?.events.length} transitions, ${data?.hours.length} hourly candles, stored through block ${data?.through?.height}`);
check(!data?.behind, data?.behind ? `the file is ${data.behind} transitions behind — run npm run data:shielded` : `${data?.added} added live from the index on top of the file`);
check(!data?.topUpError, data?.topUpError ? `top-up failed: ${data.topUpError}` : 'the live top-up answered');
const ev = data?.events ?? [];
check(ev.every((e, i) => i === 0 || e.ts >= ev[i - 1].ts), 'the rows are in time order');
check(new Set(ev.map((e) => e.hash)).size === ev.length, 'no transition appears twice');
check(ev.every((e) => /^[0-9A-F]{64}$/.test(e.hash) && e.height > 0 && e.credits >= 0), 'every row carries a hash, a height and an amount');
check(ev.every((e) => TYPES.some((t) => t.n === e.type)), 'every row is one of the six types');
const stored = ev.filter((e) => e.stored);
check(stored.every((e) => e.usd > 0), 'every stored row carries the price at its block');
const ages = stored.map((e) => e.priceAge).filter((v) => v != null).sort((a, b) => a - b);
check(ages.length > 0 && ages[Math.floor(ages.length / 2)] < 5, `the price on a row is a real trade from ${ages[Math.floor(ages.length / 2)]} minutes earlier at the median, ${ages[ages.length - 1]} at worst`);

// The file has to reproduce the index's own totals. It is minutes older than
// the index, so it may be short — never over, and never by much.
const sumOf = (types) => ev.filter((e) => types.includes(e.type)).reduce((a, e) => a + e.credits, 0);
const ourIn = sumOf([15, 18]); const ourOut = sumOf([17, 19, 20]);
check(ourIn <= Number(s?.inCredits) && Number(s?.inCredits) - ourIn < 200e11, `in: ours ${dash(BigInt(ourIn), 2)} against the index's ${dash(s?.inCredits, 2)} DASH`);
check(ourOut <= Number(s?.outCredits) && Number(s?.outCredits) - ourOut < 200e11, `out: ours ${dash(BigInt(ourOut), 2)} against ${dash(s?.outCredits, 2)}`);
for (const t of TYPES) {
  const n = ev.filter((e) => e.type === t.n).length;
  const idx = s?.types.find((x) => x.key === t.key)?.count ?? 0;
  check(n <= idx && idx - n <= 5, `${t.name}: ${n} stored, ${idx} in the index`);
}
// And the pool it adds up to has to be the pool the chain reports.
const days = daily(ev, { includeToday: true });
const chainDash = m ? Number(m.balance) / Number(CREDITS_PER_DASH) : null;
check(chainDash == null || Math.abs(days[days.length - 1].balance - chainDash) < 25, `the rows add up to ${days[days.length - 1].balance.toFixed(2)} DASH against the chain's ${chainDash?.toFixed(2)}`);

// Every Orchard bundle carries at least two actions and every action writes one
// output note, so the pool cannot hold fewer notes than twice the transitions
// we store. A count that ever falls under this floor is a truncated read, and
// this needs nothing outside our own file and the chain.
if (m?.notes && ev.length) {
  check(m.notes >= 2 * ev.length, `${m.notes} notes against ${ev.length} transitions: at or above the two-per-bundle floor of ${2 * ev.length}`);
  check(m.notes < 6 * ev.length, `and ${(m.notes / ev.length).toFixed(2)} notes per transition, in the range a bundle of two to a few actions gives`);
}

// The strongest check there is: our per-transition rows, bucketed by day, must
// equal the index's own daily buckets, which section 8 already read — a
// different endpoint of a different service doing its own sums.
if (df && ev.length) {
  const ours = new Map(days.map((d) => [d.day, d]));
  let worst = 0; let worstDay = '';
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < df.in.length; i++) {
    const day = df.in[i].at.toISOString().slice(0, 10);
    if (day >= today) continue;
    const theirs = Number(df.in[i].credits) / 1e11;
    const gap = Math.abs((ours.get(day)?.in ?? 0) - theirs);
    if (gap > worst) { worst = gap; worstDay = day; }
  }
  check(worst < 0.01, `every daily bucket matches the index's own to the credit${worst ? ` (worst ${worstDay}: ${worst.toFixed(4)} DASH)` : ''}`);
}

// The weekly chart is bucketed from the same rows now, so it has to land on the
// index's own weekly series as well.
const f2 = f && ev.length ? weekly(ev, { launch: LAUNCH }) : null;
if (f2 && f) {
  check(f2.weeks === f.weeks, `${f2.weeks} weekly buckets, the same count the index returns`);
  let worstW = 0n;
  for (let i = 0; i < f.in.length; i++) {
    const gap = f2.in[i].credits > f.in[i].credits ? f2.in[i].credits - f.in[i].credits : f.in[i].credits - f2.in[i].credits;
    if (gap > worstW) worstW = gap;
  }
  check(worstW < CREDITS_PER_DASH / 100n, `every weekly bucket matches the index's to within ${dash(worstW, 4)} DASH`);
}

console.log('\n10. The price file, and an outsider asked the same question');
const hours = data?.hours ?? [];
check(hours.every((h, i) => i === 0 || h[0] > hours[i - 1][0]), 'the candles are sorted with no repeated hour');
check(hours.every((h) => h[1] > 0 && h[2] >= h[3] && h[4] > 0), 'each candle has a high above its low and a positive close');
check(hours.length > 24 * 40, `${hours.length} hours, ${new Date(hours[0][0] * 1000).toISOString().slice(0, 10)} to ${new Date(hours[hours.length - 1][0] * 1000).toISOString().slice(0, 10)}`);
// Our history is built from Kraken's tape. CoinGecko has never heard of that
// file, so if the two agree the tape was walked correctly.
const cg = await safe('CoinGecko', async () => {
  const r = await fetch('https://api.coingecko.com/api/v3/coins/dash/market_chart?vs_currency=usd&days=30');
  const d = await r.json();
  const by = new Map();
  for (const [t, usd] of d.prices ?? []) by.set(new Date(t).toISOString().slice(0, 10), usd);
  return by;
});
if (cg && hours.length) {
  const mine = new Map();
  for (const h of hours) mine.set(new Date(h[0] * 1000).toISOString().slice(0, 10), h[4]);
  const both = [...mine.keys()].filter((d) => cg.has(d));
  const diffs = both.map((d) => Math.abs(mine.get(d) - cg.get(d)) / cg.get(d));
  const worst = Math.max(...diffs);
  check(both.length > 20 && worst < 0.06, `${both.length} days overlap with CoinGecko, worst disagreement ${(worst * 100).toFixed(1)}%`);
}

console.log('\n11. What the page computes off it');
const rows = dailyRows(ev, hours);
check(rows.length > 40 && rows.every((r) => r.usd > 0), `${rows.length} full days carry both a pool and a price`);
const a = analyse(rows);
check(a.enough, `level r = ${a.level.r.toFixed(3)}, day to day r = ${a.daily.r.toFixed(3)} (p = ${a.daily.p.toFixed(3)}), volume held out r = ${a.controlled?.r.toFixed(3)} (p = ${a.controlled?.p.toFixed(3)})`);
check(a.lags.length === 15 && Number.isInteger(a.best?.k), `the lag sweep runs ±7 days, strongest at ${a.best?.k}`);

const study = eventStudy(ev, hours, { isIn, isOut, window: 6 });
check(study && study.rows.length >= 2, `the event study covers ${study?.rows.length} thresholds over ${study?.hours} hours`);
check(study.baseline.in > 0 && study.baseline.out > 0, `an ordinary six hours: ${study.baseline.in.toFixed(1)} DASH in, ${study.baseline.out.toFixed(1)} out`);
for (const r of study.rows) {
  check(r.n >= 8 && r.p > 0 && r.p <= 1, `${r.threshold > 0 ? '+' : '−'}${Math.abs(r.threshold * 100).toFixed(0)}% (${r.n}×): ${r.in.toFixed(1)} in, ${r.out.toFixed(1)} out, p = ${r.p.toFixed(3)}`);
}
// Seeded on purpose: a p-value that wanders between reloads is not a p-value.
const again = eventStudy(ev, hours, { isIn, isOut, window: 6 });
check(study.rows.every((r, i) => r.p === again.rows[i].p), 'the permutation test is seeded, so it answers the same twice');
const buckets = byPrice(ev, { isIn, isOut, bucket: 5 });
const bIn = buckets.reduce((x, b) => x + b.in, 0);
check(Math.abs(bIn - ourIn / 1e11) < 0.01, `the price buckets hold every credit that went in (${bIn.toFixed(2)} DASH over ${buckets.length} bands)`);

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
