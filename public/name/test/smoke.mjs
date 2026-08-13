// Smoke test for dash-name's check flow (testnet + mainnet). Registration mirrors
// onboard's verified registerName and needs a funded identity + key, so it's not
// exercised here. Run: node public/name/test/smoke.mjs
import { randomBytes } from 'node:crypto';
import { checkName, registerName, topUpIdentity } from '../js/name.js';
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

// A claimed contested name resolves to nobody until the vote ends, so every
// availability check calls it available. Reporting that as free is how a claim
// that worked ends up looking like a claim that failed.
console.log('\n7. mainnet: a name with an open contest is not simply "available"');
const sdk = await getSdk();
const polls = (await sdk.voting.votePollsByEndDate().catch(() => []))
  .flatMap((e) => (e.votePolls || []).map((p) => ({ endsAt: new Date(Number(e.timestampMs)), poll: p })));
if (!polls.length) {
  console.log('  ⏭  no contest open on mainnet right now');
} else {
  const { poll, endsAt } = polls[0];
  const label = String.fromCharCode(...Array.from(poll.indexValues?.[1] ?? []).slice(2));
  const c = await safe(`checkName(${label})@mainnet`, () => checkName(label));
  check(c?.contest?.pending === true, `${label}.dash has an open contest (${c?.contest?.contenders?.length} contender(s))`);
  check(c?.contest?.endsAt?.getTime() === endsAt.getTime(), `it ends ${endsAt.toISOString().slice(0, 16)}, which the tool reports`);
  check(c?.registered === false, 'and it does not resolve to an owner yet');
}

// The identity ID and the key sit one field apart, and the key ends up in the
// wrong one sooner or later. Two different things go wrong per field, so both are
// pinned here.
console.log('\n8. a pasted secret is refused before it goes anywhere');
const { looksLikeSecret } = await import('../../shared/secrets.js');
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
for (const [what, value] of [
  ['a WIF', stranger],
  ['a recovery phrase', phrase],
  ['a raw hex key', '7'.repeat(64)],
  ['an xprv', 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'],
]) check(looksLikeSecret(value), `${what} is recognised as a secret`);
check(!looksLikeSecret(BAS), 'a real identity ID is not — 44 characters, no false positive');

// The ID field: nothing leaves the browser (the SDK rejects the length locally),
// but the SDK's complaint is about bytes and reads like a typo.
await rejects('a WIF pasted into the identity ID field', 'zqxtestname7788', stranger, stranger, 'not an identity ID');
await rejects('a phrase pasted into the identity ID field', 'zqxtestname7788', phrase, stranger, 'not an identity ID');
let topUpRefused = '';
try { await topUpIdentity({ identityId: stranger, addressWif: stranger }); } catch (e) { topUpRefused = e.message; }
check(/not an identity ID/.test(topUpRefused), 'top-up refuses it too — same field, same slip');

// The name field is the dangerous one: a WIF is a valid DPNS label, so without a
// guard the live check sends it to a node as a name lookup. Lowercasing does not
// save it — a WIF carries its own checksum, so the casing is recoverable offline.
check(await sdk.dpns.isValidUsername(stranger.toLowerCase()),
  'a lowercased WIF is a valid DPNS label — which is why the name field is guarded, not sanitised');

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
