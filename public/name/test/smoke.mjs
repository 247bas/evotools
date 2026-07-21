// Smoke test for dash-name's check flow (testnet + mainnet). Registration mirrors
// onboard's verified registerName and needs a funded identity + key, so it's not
// exercised here. Run: node public/name/test/smoke.mjs
import { checkName } from '../js/name.js';
import { setNetwork } from '../js/sdk.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => c ? ok(m) : (failed++, console.log(`  ❌ ${m}`));
const safe = async (l, fn) => { try { return await fn(); } catch (e) { failed++; console.log(`  ❌ ${l}: ${e?.message || e}`); } };

console.log('\n1. testnet: a taken + contested name (dash)');
const d = await safe('checkName(dash)', () => checkName('dash'));
check(d?.valid && d.registered, `dash.dash registered, owner ${d?.ownerId?.slice(0, 12)}…`);
check(d?.contested && d.contest?.contenders?.length >= 1, `contested: ${d?.contest?.contenders?.length} contender(s)`);

console.log('\n2. testnet: a random available name');
const rnd = 'dashname-' + Math.random().toString(36).slice(2, 9);
const a = await safe('checkName(random)', () => checkName(rnd));
check(a?.valid && a.available === true && !a.registered, `${rnd}.dash available`);

console.log('\n3. testnet: an invalid name');
const bad = await safe('checkName(-bad-)', () => checkName('-bad-'));
check(bad?.valid === false, 'invalid name rejected');

console.log('\n4. mainnet: a taken name (dash)');
setNetwork('mainnet');
const m = await safe('checkName(dash)@mainnet', () => checkName('dash'));
check(m?.registered && m.ownerId, `mainnet dash.dash -> ${m?.ownerId?.slice(0, 12)}…`);

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
