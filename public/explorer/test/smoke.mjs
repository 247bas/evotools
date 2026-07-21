// Smoke test for the explorer lookups (incl. proofs, aggregations, network).
// Run: node public/explorer/test/smoke.mjs
import {
  lookupIdentity, lookupName, lookupContract, queryDocuments,
  countDocuments, networkInfo, lookupToken, creditsToDash,
} from '../js/explorer.js';
import { setNetwork } from '../js/sdk.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => c ? ok(m) : (failed++, console.log(`  ❌ ${m}`));
const safe = async (label, fn) => {
  try { return await fn(); }
  catch (e) { console.log(`  ·  ${label}: ${e?.message || e}`); return null; }
};

const CONTRACT = '9VBe2fiVZDZz7B3JwT64TFUr52gGYTrq6vPSvzVfdb3y';
const IDENTITY = '3pdTAJ4oCVSYKSr2X3BLQR8pjuzUDdzUa5yB5HfREJhk';

console.log('\n1. networkInfo (epoch.current)');
const net = await safe('networkInfo', networkInfo);
check(net && typeof net.epoch === 'number', `epoch ${net?.epoch}, protocol v${net?.protocolVersion}, first block ${net?.firstBlockHeight}`);

console.log('\n2. Identity WITH PROOF + all names');
const id = await safe('lookupIdentity(proof)', () => lookupIdentity(IDENTITY, { proof: true }));
check(id !== null, 'identity found via fetchWithProof');
check(id?.proof && typeof id.proof.height === 'bigint', `proof: height ${id?.proof?.height}, epoch ${id?.proof?.epoch}, quorumType ${id?.proof?.quorumType}, sig ${id?.proof?.signatureBytes}B`);
check(id?.proof?.quorumHash?.length === 64, `quorum hash ${id?.proof?.quorumHash?.slice(0, 16)}…`);
check(Array.isArray(id?.names), `all names: ${JSON.stringify(id?.names)}`);
check(id?.balance !== undefined, `balance ${creditsToDash(id?.balance)} tDASH`);

console.log('\n3. Contract WITH PROOF');
const c = await safe('lookupContract(proof)', () => lookupContract(CONTRACT, { proof: true }));
check(c?.documentTypes?.includes('note'), `types: ${c?.documentTypes?.join(', ')}`);
check(c?.proof && typeof c.proof.height === 'bigint', `proof height ${c?.proof?.height}`);

console.log('\n4. Documents: richer query (where on indexed field) + proof');
const q = await safe('queryDocuments', () => queryDocuments(CONTRACT, 'note', { where: [['category', '==', 'demo']], limit: 3, proof: true }));
check(Array.isArray(q?.docs), `queried ${q?.docs?.length} note(s) where category==demo, proof height ${q?.proof?.height}`);
if (q?.docs?.[0]) console.log('     sample props:', JSON.stringify(q.docs[0].properties));

console.log('\n5. Count (expected to need a countable index)');
const cnt = await safe('countDocuments', () => countDocuments(CONTRACT, 'note'));
console.log(cnt === null ? '  ·  count unavailable (no countable index) — handled' : `  ✅ count = ${cnt}`);

console.log('\n6. DPNS: registered vs available + contest state');
const reg = await safe('lookupName(dash)', () => lookupName('dash'));
check(reg?.registered && reg.identityId, `dash -> ${reg?.identityId}`);
check(reg?.contest && Array.isArray(reg.contest.contenders), `dash is contested: ${reg?.contest?.contenders?.length} contender(s), abstain ${reg?.contest?.abstain}, lock ${reg?.contest?.lock}, winner ${reg?.contest?.winner ?? '—'}`);
const free = await safe('lookupName(random)', () => lookupName('evotools-free-' + Math.random().toString(36).slice(2, 8)));
check(free && free.registered === false, `random name: registered=${free?.registered} valid=${free?.valid} available=${free?.available} contested=${free?.contested}`);

console.log('\n7. Token lookup (graceful not-found — no live token after testnet reset)');
const tok = await safe('lookupToken', () => lookupToken('AxAYWyXV6mrm8Sq7vc7wEM18wtL8a8rgj64SM3SDmzsB'));
check(tok === null, 'non-existent token -> null (handled)');

console.log('\n8. Mainnet (read-only) — switch network');
setNetwork('mainnet');
const mnet = await safe('networkInfo@mainnet', networkInfo);
check(mnet && typeof mnet.epoch === 'number', `mainnet epoch ${mnet?.epoch}, protocol v${mnet?.protocolVersion}`);
const mn = await safe('lookupName(dash)@mainnet', () => lookupName('dash'));
check(mn?.registered && mn.identityId, `mainnet dash -> ${mn?.identityId}`);
const mi = mn?.identityId ? await safe('lookupIdentity@mainnet', () => lookupIdentity(mn.identityId)) : null;
check(typeof mi?.balance === 'bigint', `mainnet identity balance ${creditsToDash(mi?.balance)} DASH, ${mi?.keys?.length} keys`);

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
