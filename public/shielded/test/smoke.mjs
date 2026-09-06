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
import { statistic, history, flows, LAUNCH } from '../js/api.js';
import { poolState } from '../js/pool.js';
import { loadEvo, getSdkFor } from '../js/sdk.js';
import { l1FromHash } from '../../map/js/addresses.js';
import { looksLikeSecret } from '../../shared/secrets.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => (c ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));
const safe = async (l, fn) => {
  try { return await fn(); } catch (e) { failed++; console.log(`  ❌ ${l}: ${e?.message || e}`); }
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
check(m?.notes > 0 && !m?.notesCapped, `${m?.notes} notes, ${m?.anchors} anchors`);
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

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
