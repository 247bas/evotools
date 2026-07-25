// Smoke test for dash-name's check flow (testnet + mainnet). Registration mirrors
// onboard's verified registerName and needs a funded identity + key, so it's not
// exercised here. Run: node public/name/test/smoke.mjs
import { randomBytes } from 'node:crypto';
import { checkName, registerName } from '../js/name.js';
import { setNetwork, loadEvo, getSdk } from '../js/sdk.js';

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

console.log('\n5. mainnet: a locked name (pay) — unowned, yet unclaimable');
const l = await safe('checkName(pay)@mainnet', () => checkName('pay'));
check(l?.locked === true && l.contest?.outcome === 'Locked', `pay.dash locked (${l?.contest?.lock} lock votes)`);
check(l?.registered === false && l?.available === false, 'locked name is not reported as available');

console.log('\n6. mainnet: registerName rejects before signing (no funds spent)');
// bas.dash's identity signs documents with a HIGH key, not a CRITICAL one — the
// point of this case is that such an identity is accepted as usable at all.
const BAS = 'CkKwW6VVEvo1EEps7NERZADE13ZWUwwz7kkuZentxVuj';
await getSdk(); // the WASM key helpers need an initialised SDK
const Evo = await loadEvo();
const stranger = Evo.PrivateKey.fromBytes(new Uint8Array(randomBytes(32)), 'mainnet').toWIF();
const rejects = async (l, label, id, wif, want) => {
  try { await registerName(label, id, wif); failed++; console.log(`  ❌ ${l}: did not throw`); }
  catch (e) { check(String(e?.message).includes(want), `${l} — ${e?.message}`); }
};
await rejects('locked name', 'pay', BAS, stranger, 'locked by masternode vote');
await rejects('key that is not on the identity', 'zqxtestname7788', BAS, stranger, 'does not match any signing key');
await rejects('malformed WIF', 'zqxtestname7788', BAS, 'not-a-wif', 'not a valid WIF');

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
