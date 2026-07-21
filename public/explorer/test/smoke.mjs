// Smoke test for the explorer lookups against real testnet data.
// Run: node public/explorer/test/smoke.mjs
import { lookupIdentity, lookupName, lookupContract, queryDocuments, creditsToDash } from '../js/explorer.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => c ? ok(m) : (failed++, console.log(`  ❌ ${m}`));
const safe = async (label, fn) => {
  try { return await fn(); }
  catch (e) { failed++; console.log(`  ❌ ${label} threw: ${e?.message || e}`); return null; }
};

const COOKBOOK_CONTRACT = '9VBe2fiVZDZz7B3JwT64TFUr52gGYTrq6vPSvzVfdb3y'; // recipe 09
const EVOTOOLS_IDENTITY = '3pdTAJ4oCVSYKSr2X3BLQR8pjuzUDdzUa5yB5HfREJhk';   // onboard run

console.log('\n1. DPNS name lookup');
const dash = await safe('lookupName', () => lookupName('dash'));
check(dash && /^[0-9A-Za-z]{40,50}$/.test(dash.identityId), `resolveName('dash') -> owner ${dash?.identityId}`);

console.log('\n2. Identity lookup (the evotools onboard identity)');
const id = await safe('lookupIdentity', () => lookupIdentity(EVOTOOLS_IDENTITY));
check(id !== null, 'identity found');
check(typeof id?.balance === 'bigint', `balance = ${creditsToDash(id?.balance)} tDASH`);
check(Array.isArray(id?.keys) && id.keys.length >= 1, `${id?.keys.length} public keys, first: ${JSON.stringify(id?.keys[0])}`);
check(id?.name?.startsWith('evotools200'), `primary DPNS name = ${id?.name}`);

console.log('\n3. Contract lookup (the cookbook contract)');
const c = await safe('lookupContract', () => lookupContract(COOKBOOK_CONTRACT));
check(c !== null, 'contract found');
check((c?.ownerId?.length ?? 0) >= 40, `owner ${c?.ownerId}`);
check(Array.isArray(c?.documentTypes) && c.documentTypes.includes('note'), `document types: ${c?.documentTypes?.join(', ')}`);

console.log('\n4. Document query (notes in that contract)');
const docs = await safe('queryDocuments', () => queryDocuments(COOKBOOK_CONTRACT, 'note', 5));
check(Array.isArray(docs), `queried ${docs?.length} document(s)`);
if (docs?.[0]) console.log('     sample:', JSON.stringify(docs[0], (k, v) => (typeof v === 'bigint' ? `${v}` : v)).slice(0, 160));

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
