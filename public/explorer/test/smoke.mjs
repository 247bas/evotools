// Smoke test for the explorer lookups (incl. proofs, aggregations, network).
// Run: node public/explorer/test/smoke.mjs
import {
  lookupIdentity, lookupName, lookupContract, queryDocuments,
  countDocuments, networkInfo, lookupToken, decodeStateTransition, creditsToDash,
  shieldedPool, checkNullifier,
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

console.log('\n7b. Decode a state transition (offline)');
const blob = await safe('fetch a ST blob', async () => {
  const list = await (await fetch('https://platform-explorer.pshenmic.dev/transactions?limit=1')).json();
  const tx = await (await fetch('https://platform-explorer.pshenmic.dev/transaction/' + list.resultSet[0].hash)).json();
  return tx.data;
});
if (blob) {
  const dec = await safe('decodeStateTransition', () => decodeStateTransition(blob));
  check(dec && typeof dec.actionType === 'string' && dec.actionType.length > 0, `decoded: ${dec?.actionType} · owner ${dec?.ownerId?.slice(0, 10)}… · hash ${dec?.hash?.slice(0, 12)}…`);
}

console.log('\n8. Mainnet (read-only) — switch network');
setNetwork('mainnet');
const mnet = await safe('networkInfo@mainnet', networkInfo);
check(mnet && typeof mnet.epoch === 'number', `mainnet epoch ${mnet?.epoch}, protocol v${mnet?.protocolVersion}`);
const mn = await safe('lookupName(dash)@mainnet', () => lookupName('dash'));
check(mn?.registered && mn.identityId, `mainnet dash -> ${mn?.identityId}`);
const mi = mn?.identityId ? await safe('lookupIdentity@mainnet', () => lookupIdentity(mn.identityId)) : null;
check(typeof mi?.balance === 'bigint', `mainnet identity balance ${creditsToDash(mi?.balance)} DASH, ${mi?.keys?.length} keys`);

console.log('\n9. Shielded pool — both networks, with and without proof');
for (const net of ['testnet', 'mainnet']) {
  const unit = net === 'mainnet' ? 'DASH' : 'tDASH';
  const pool = await safe(`shieldedPool(${net})`, () => shieldedPool(net));
  check(typeof pool?.balance === 'bigint', `${net}: ${creditsToDash(pool?.balance)} ${unit} · ${pool?.notes} notes · ${pool?.anchors} anchors`);
  check(pool?.latestAnchor?.length === 64, `${net}: anchor ${pool?.latestAnchor?.slice(0, 16)}…`);
  check(pool?.noteBytes === 216, `${net}: note ciphertext ${pool?.noteBytes} bytes`);
}
const proven = await safe('shieldedPool(mainnet, proof)', () => shieldedPool('mainnet', { proof: true, notes: false }));
check(proven?.proof && typeof proven.proof.height === 'bigint', `proven pool state at height ${proven?.proof?.height}, quorumType ${proven?.proof?.quorumType}`);
const nul = await safe('checkNullifier', () => checkNullifier('mainnet', '00'.repeat(32)));
check(nul && typeof nul.isSpent === 'boolean', `all-zero nullifier spent: ${nul?.isSpent}`);
const bad = await checkNullifier('mainnet', 'nope').then(() => null, (e) => e);
check(bad instanceof Error, 'malformed nullifier is rejected client-side');

// A WIF is 52 characters of base58, which DPNS accepts as a label — so an
// unguarded search would carry a pasted key to a node, and syncUrl would put it
// in the address bar on the way. The page catches it before either happens; this
// pins the module-level backstop.
console.log('\nA pasted secret never becomes a name lookup');
const { looksLikeSecret } = await import('../../shared/secrets.js');
const wif = 'XKEWvCA1Fxu4MWWzQM9oGApNPpUpQMCH5kwKMfhQducphcd9HHgt';
check(looksLikeSecret(wif), 'a WIF is recognised as a secret');
check(!looksLikeSecret('Bt5vvxCx1bHJgmSJRHLPGvJMYcNTvJUEeqNvSWCTkVfr'), 'an identity ID is not');
const leaked = await lookupName(wif).then(() => null, (e) => e);
check(leaked instanceof Error && /not a name/.test(leaked.message), `refused — ${leaked?.message?.slice(0, 60)}…`);

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
