// Smoke test for the credits tool. Reads are live against testnet; the guards
// are exercised for real, since refusing to move credits costs nothing. Actual
// transfers are proven in the session notes rather than on every run.
// Run: node public/credits/test/smoke.mjs
import { randomBytes } from 'node:crypto';
import {
  lookupIdentity, addressFromWif, topUpIdentity, sendFromIdentity,
  sendBetweenAddresses, withdrawToCore, MIN_WITHDRAW_CREDITS, SWEEP_MARGIN,
  fundingAddresses, convertDash, unfinishedConversions, MIN_LOCK_DUFFS,
} from '../js/credits.js';
import { readFileSync } from 'node:fs';
import { setNetwork, loadEvo, getSdk } from '../js/sdk.js';

// The page loads the transaction builder with a script tag; in Node we evaluate
// the same bundle so the conversion paths can be exercised.
globalThis.window = globalThis;
(0, eval)(readFileSync(new URL('../../shared/vendor/dashcore.bundle.js', import.meta.url), 'utf8'));

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (cond, m) => (cond ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));
const refuses = async (fn, want, label) => {
  try { await fn(); failed++; console.log(`  ❌ ${label}: did not refuse`); }
  catch (e) { check(String(e.message).includes(want), `${label} — ${e.message.slice(0, 90)}`); }
};

setNetwork('testnet');
const sdk = await getSdk();
const Evo = await loadEvo();
const stranger = Evo.PrivateKey.fromBytes(new Uint8Array(randomBytes(32)), 'testnet').toWIF();
const elsewhere = Evo.PrivateKey.fromBytes(new Uint8Array(randomBytes(32)), 'testnet').toWIF();

console.log('\n1. Looking an identity up');
const byName = await lookupIdentity('dash');
check(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(byName.identityId), `dash.dash -> ${byName.identityId.slice(0, 12)}…`);
check(typeof byName.balance === 'bigint', `balance is a bigint (${byName.balance})`);
check(Array.isArray(byName.keys) && byName.keys.length > 0, `${byName.keys.length} keys listed`);
const byId = await lookupIdentity(byName.identityId);
check(byId.identityId === byName.identityId, 'the id gives the same identity as the name');
await refuses(() => lookupIdentity('this-name-does-not-exist-9273'), 'No identity found', 'an unknown name');

console.log('\n2. A key and what it holds');
const info = await addressFromWif(stranger);
check(info.address.startsWith('tdash1'), `WIF -> ${info.address}`);
check(info.balance === 0n, 'a fresh address holds nothing');
await refuses(() => addressFromWif('not-a-wif'), 'not a valid WIF', 'a broken key');

console.log('\n3. Guards, before anything moves');
await refuses(
  () => topUpIdentity({ identityId: byName.identityId, addressWif: stranger }),
  'nothing to move', 'topping up from an empty address',
);
await refuses(
  () => sendFromIdentity({ identityId: byName.identityId, transferWif: stranger, toAddress: info.address, amount: 1000n }),
  'not the TRANSFER key', 'paying out with a key that is not the identity\'s',
);
const other = await addressFromWif(elsewhere);
await refuses(
  () => sendBetweenAddresses({ fromWif: stranger, toAddress: other.address }),
  'nothing to move', 'moving from an empty address',
);
await refuses(
  () => sendBetweenAddresses({ fromWif: stranger, toAddress: info.address }),
  'same address', 'moving credits to the address they are already on',
);
await refuses(
  () => withdrawToCore({ fromWif: stranger, coreAddress: 'yT5sYD3Pz7vC34kdJaSUdVqLf6DufcefXf', amount: 1000n }),
  'at least', 'withdrawing under the protocol minimum',
);
await refuses(
  () => withdrawToCore({ fromWif: stranger, coreAddress: 'not-an-address', amount: MIN_WITHDRAW_CREDITS }),
  'not a Dash address', 'withdrawing to something that is not an address',
);

console.log('\n4. Getting credits in, from layer 1');
const funding = await fundingAddresses(stranger);
check(funding.platform.startsWith('tdash1'), `platform address ${funding.platform}`);
check(/^y[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(funding.core), `and its Dash address ${funding.core}`);
check(funding.credits === 0n && funding.duffs === 0, 'a fresh key holds nothing on either side');
await refuses(() => convertDash({ wif: stranger }), 'Nothing confirmed', 'converting from an address nobody paid');
// Duffs are numbers, credits are bigints. Passing a bigint amount used to throw
// "Cannot mix BigInt and other types" halfway through, after the UI had already
// promised to convert.
await refuses(() => convertDash({ wif: stranger, lockDuffs: 250_000 }), 'Nothing confirmed', 'an explicit amount is taken as a plain number');
check((await unfinishedConversions(stranger)).length === 0, 'and it has no unfinished conversions waiting');
check(MIN_LOCK_DUFFS === 200_000, 'an asset lock needs 0.002 DASH');

console.log('\n5. Constants match the protocol');
check(MIN_WITHDRAW_CREDITS === 400_000_000n, 'withdrawal minimum is 0.004 DASH');
check(SWEEP_MARGIN > 0n && SWEEP_MARGIN < MIN_WITHDRAW_CREDITS, `sweeps leave ${SWEEP_MARGIN} credits for the fee`);

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
