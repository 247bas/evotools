// Smoke test for the map: the address arithmetic, what the input accepts
// and refuses, and the trace from an identity back to the coins that paid for it.
// Run: node public/test/map.mjs
//
// One shim: Insight answers 403 to Node's own user agent and 200 to a browser's,
// so the test asks as a browser would. The page itself needs nothing — a browser
// sends that header on its own, and cannot override it anyway.
const realFetch = globalThis.fetch;
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
globalThis.fetch = (url, opts = {}) => (
  /insight/.test(String(url?.url ?? url))
    ? realFetch(url, { ...opts, headers: { 'user-agent': BROWSER_UA, ...(opts.headers || {}) } })
    : realFetch(url, opts)
);

const P = new URL('../../', import.meta.url).pathname;
const Evo = await import(P + 'shared/vendor/evo-sdk.module.js');
await Evo.ensureInitialized?.();
const A = await import(P + 'map/js/addresses.js');
const { detect, resolve, traceFunding, fundingSource, dashFromCredits } = await import(P + 'map/js/map.js');
const { generateMnemonic, deriveAll } = await import(P + 'keygen/js/keys.js');

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => (c ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));

console.log('\n1. One key, two spellings (offline)');
for (const net of ['mainnet', 'testnet']) {
  const d = await deriveAll(await generateMnemonic(), net);
  const { hash, network } = await A.hashFromL1(d.coreAddress);
  check(network === net, `${net}: the version byte identifies the network`);
  check(A.platformFromHash(Evo, hash, net) === d.address, `${net}: layer-1 address → the same key's platform address`);
  check((await A.l1FromHash(A.hashFromPlatform(Evo, d.address).hash, net)) === d.coreAddress, `${net}: and back again`);
}
let typoCaught = false;
try { await A.hashFromL1('XyxBhQk1K8DRJZgLY3J9Hxr7b1Y7vLY7SY'); } catch (e) { typoCaught = /checksum/.test(e.message); }
check(typoCaught, 'a one-character typo fails its checksum instead of resolving to nothing');

console.log('\n2. What the box accepts');
const kinds = {
  'pizza247.dash': 'name',
  GxR2DKBZaprZPng9q8fDe5p8HFZStjNy4Umyvvnf66GN: 'identity',
  XyxBhQk1K8DRJZgLY3J9Hxr7b1Y7vLY7SX: 'l1-address',
  dash1krlnrdhc03st8krg9neshhjqjcr23nwl8vyhu4tp: 'platform-address',
  pizza247: 'name',
  PIZZA247: 'name',
  'XKEWvCA1Fxu4MWWzQM9oGApNPpUpQMCH5kwKMfhQducphcd9HHgt': 'secret',
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about': 'secret',
  'hello world': 'unknown',
};
for (const [input, want] of Object.entries(kinds)) {
  check(detect(input).kind === want, `${want.padEnd(16)} ← ${input.slice(0, 30)}${input.length > 30 ? '…' : ''}`);
}
let refused = '';
try { await resolve('XKEWvCA1Fxu4MWWzQM9oGApNPpUpQMCH5kwKMfhQducphcd9HHgt'); } catch (e) { refused = e.message; }
check(/never takes a recovery phrase or a private key/.test(refused), 'a secret is refused with a reason, not swallowed');

console.log('\n3. A name fills the whole map (mainnet, live)');
const byName = await resolve('pizza247.dash', { network: 'mainnet' });
check(byName.identities?.[0]?.names?.includes('pizza247.dash'), `identity ${byName.identities?.[0]?.id.slice(0, 10)}… holds ${byName.identities?.[0]?.names.length} names`);
check(byName.trace?.kind === 'from-addresses', `its creation transition is ${byName.trace?.kind}`);
const input = byName.trace?.inputs?.[0];
check(!!input?.platformAddress && !!input?.l1Address, `funded from ${input?.platformAddress?.slice(0, 16)}… = ${input?.l1Address?.slice(0, 12)}… on layer 1`);
check(dashFromCredits(input?.credits ?? 0n) > 0, `with ${dashFromCredits(input?.credits ?? 0n)} DASH`);
check(byName.l1?.address === input?.l1Address && byName.platform?.address === input?.platformAddress, 'and both of those boxes are filled in from it');

// A contested claim is in no list of usernames until its vote ends, so it can
// only appear here if it is looked for on purpose — and 0.2 DASH of that
// identity's money is sitting on it meanwhile.
console.log('\n3b. A claim still in a vote shows up too');
const pending = byName.identities?.[0]?.pending ?? [];
if (!pending.length) {
  console.log('  ⏭  this identity has no claim in a vote right now');
} else {
  const p = pending[0];
  check(!!p.name && !byName.identities[0].names.includes(p.name), `${p.name} is claimed but not among the names it owns`);
  check(p.endsAt instanceof Date, `its vote is decided ${p.endsAt?.toISOString().slice(0, 16)}`);
  check(p.contenders >= 1, `${p.contenders} contender(s) in that contest`);
}

// Typing .dash after something that is obviously a name is busywork, so a bare
// label works — and a string that looks like an id but is not one falls back to
// being read as a name.
console.log('\n3c. A name without the suffix');
const bare = await resolve('pizza247', { network: 'mainnet' });
check(bare.identities?.[0]?.id === byName.identities?.[0]?.id, 'pizza247 lands on the same identity as pizza247.dash');
const shouty = await resolve('PIZZA247', { network: 'mainnet' });
check(shouty.identities?.[0]?.id === byName.identities?.[0]?.id, 'and so does PIZZA247');

// The other minting route, and the more common one on mainnet: straight from an
// asset lock. That half of the map has a different shape, not a missing one.
console.log('\n3d. An identity minted straight from an asset lock');
const old = await resolve('bas.dash', { network: 'mainnet' });
check(old.trace?.kind === 'from-asset-lock', `bas.dash was minted ${old.trace?.kind}`);
check(!!old.trace?.lock?.txid, `its asset lock is ${old.trace?.lock?.txid?.slice(0, 16)}…:${old.trace?.lock?.vout}`);
check(old.trace?.origin?.from?.length > 0, `paid by ${old.trace?.origin?.from?.[0]?.slice(0, 14)}…, ${old.trace?.origin?.lockedDash} DASH locked`);
check(!!old.platformUnused && !old.platform, 'and the platform box says why it is empty rather than showing nothing');

// The third route mainnet actually uses: the coins come out of the shielded
// pool, so there is no address to point at — only the amount that left it.
console.log('\n3e. An identity minted from the shielded pool');
const shielded = await resolve('57GMayPtYsZpZnorxfggb2KubWgScze77RHWUyFUhQy2', { network: 'mainnet' });
check(shielded.trace?.kind === 'from-shielded', `minted ${shielded.trace?.kind}`);
check((shielded.trace?.shieldedCredits ?? 0n) > 0n, `${dashFromCredits(shielded.trace?.shieldedCredits ?? 0n)} DASH left the pool for it`);
check(!shielded.l1 && !shielded.platform, 'and no address is invented for a route that deliberately has none');

// An identity that has been updated since it was minted used to read as created
// on the day of its last update — thedesertlynx.dash won its name in 2024 and
// reported 2026. The creation is found by walking its transactions, not by
// trusting one field.
console.log('\n3f. An identity that has been updated since');
const lynx = await resolve('thedesertlynx', { network: 'mainnet' });
check(lynx.trace?.kind === 'from-asset-lock', `minted ${lynx.trace?.kind}`);
check(new Date(lynx.trace?.createdAt).getFullYear() === 2024, `created ${String(lynx.trace?.createdAt).slice(0, 10)}, not the date of its latest update`);

console.log('\n4. An address fills its own two boxes');
const byAddress = await resolve(input.l1Address, { network: 'mainnet' });
check(byAddress.platform?.address === input.platformAddress, 'a layer-1 address knows its platform address without asking anyone');
check(typeof byAddress.l1?.duffs === 'number', `layer 1 holds ${byAddress.l1.duffs} duffs`);
check(Array.isArray(byAddress.identities), 'the identity lookup ran (a funding key usually carries none)');

console.log('\n5. The hop back to layer 1');
const hops = await fundingSource(input.l1Address, 'mainnet');
check(hops.length > 0, `${hops.length} layer-1 transaction(s) behind that address`);
check(hops.some((h) => h.isLock), 'one of them is the asset lock — an output no address can be read from');
check(hops.some((h) => h.from.length), `and the coins came from ${hops.find((h) => h.from.length)?.from.length} address(es)`);

console.log('\n6. An identity that does not exist says so');
let missing = '';
try { await resolve('GxR2DKBZaprZPng9q8fDe5p8HFZStjNy4Umyvvnf66GN', { network: 'testnet' }); } catch (e) { missing = e.message; }
check(/No identity/.test(missing), `refused on the wrong network — ${missing.slice(0, 60)}…`);

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
