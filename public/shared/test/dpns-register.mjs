// Smoke test for the resumable DPNS registration. The derivation is offline and
// deterministic, which is the whole point: the same key and name always give the
// same salt, so an interrupted registration can be finished without paying for a
// second preorder. Registering itself costs credits, so it is not repeated here
// — see the session notes in _reference/LESSONS.md §G3 for the live proof.
// Run: node public/shared/test/dpns-register.mjs
import { randomBytes } from 'node:crypto';
import {
  deriveSaltAndEntropy, saltedDomainHash, registerName, contestState, contestEndsAt, DPNS_CONTRACT,
} from '../dpns-register.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (cond, m) => (cond ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));
const hex = (u8) => Buffer.from(u8).toString('hex');

const key = new Uint8Array(randomBytes(32));
const other = new Uint8Array(randomBytes(32));
const base = { privateKeyBytes: key, network: 'testnet', normalizedLabel: 'a11ce' };

console.log('\n1. The same key and name always give the same salt');
const a = await deriveSaltAndEntropy(base);
const b = await deriveSaltAndEntropy(base);
check(hex(a.salt) === hex(b.salt), `salt is reproducible (${hex(a.salt).slice(0, 16)}…)`);
check(hex(a.entropy) === hex(b.entropy), 'so is the entropy that fixes the document ids');
check(a.salt.length === 32 && a.entropy.length === 32, 'both are 32 bytes');
check(hex(a.salt) !== hex(a.entropy), 'salt and entropy are not the same value');

console.log('\n2. Anything else gives a different one');
const vary = async (over, what) => {
  const v = await deriveSaltAndEntropy({ ...base, ...over });
  check(hex(v.salt) !== hex(a.salt), what);
};
await vary({ privateKeyBytes: other }, 'another key');
await vary({ network: 'mainnet' }, 'the other network — testnet and mainnet never collide');
await vary({ normalizedLabel: 'b0b' }, 'another name');
await vary({ attempt: 1 }, 'a deliberate second attempt, for a fresh preorder');

console.log('\n3. The salted hash commits to the full name');
const h1 = await saltedDomainHash(a.salt, 'a11ce');
const h2 = await saltedDomainHash(a.salt, 'a11ce');
const h3 = await saltedDomainHash(a.salt, 'b0b');
const h4 = await saltedDomainHash(b.salt.map((x) => x ^ 1), 'a11ce');
check(hex(h1) === hex(h2), 'same salt and name, same hash');
check(hex(h1) !== hex(h3), 'a different name changes it');
check(hex(h1) !== hex(h4), 'a different salt changes it');
check(h1.length === 32, 'the hash is 32 bytes');

console.log('\n4. Nothing about the key is recoverable from what goes public');
// The salt ends up in the domain document. It is an HMAC output, so it should
// look nothing like the key it came from, and two names under the same key
// should share no structure.
const s2 = await deriveSaltAndEntropy({ ...base, normalizedLabel: 'car0l' });
check(!hex(a.salt).includes(hex(key).slice(0, 8)), 'the salt does not carry the key');
check(hex(a.salt).slice(0, 8) !== hex(s2.salt).slice(0, 8), 'two names under one key share no visible prefix');

console.log('\n5. Contract');
check(DPNS_CONTRACT === 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec', 'DPNS contract id is the system one');

// Measured on mainnet 2026-07-28: pizza247.dash registered fine while the tool
// showed "state transition broadcast error: Tenderdash is not available". The
// node failing to answer says nothing about whether the transition landed, so
// the chain is asked before anything is called a failure. Both halves of that
// are exercised here against a stand-in SDK — the real one costs credits.
console.log('\n5b. A broadcast that fails on a transition that landed');
const fakeEvo = {
  Document: class { constructor(o) { Object.assign(this, o); this.id = { toString: () => `doc-${o.documentTypeName}` }; } },
};
const identity = { id: { toString: () => 'OWNER1', toBytes: () => new Uint8Array(32) } };

function stubSdk({ failOn, resolvesAfter, preorderExists = false }) {
  let creates = 0;
  let resolves = 0;
  return {
    calls: () => ({ creates, resolves }),
    dpns: {
      convertToHomographSafe: async (s) => s,
      isContestedUsername: async () => false,
      resolveName: async () => (++resolves >= resolvesAfter ? 'OWNER1' : undefined),
    },
    documents: {
      get: async () => (preorderExists ? { id: 'preorder' } : undefined),
      create: async ({ document }) => {
        creates++;
        if (document.documentTypeName === failOn) throw new Error('state transition broadcast error: Tenderdash is not available');
      },
    },
  };
}

const registered = await (async () => {
  const sdk = stubSdk({ failOn: 'domain', resolvesAfter: 3 });
  const res = await registerName({
    sdk, Evo: fakeEvo, label: 'pizza247', identity, identityKey: {}, signer: {},
    privateKeyBytes: key, network: 'mainnet', settleMs: 0,
  });
  return res;
})().catch((e) => ({ threw: e.message }));
check(registered?.name === 'pizza247.dash', `a name that landed is reported as registered (${registered?.name ?? registered?.threw})`);
check(registered?.identityId === 'OWNER1', 'and it names the owner the chain returned');

// The other direction: a broadcast that failed and left nothing behind must
// still fail, with the node's own words and the reassurance that a rerun is safe.
const reallyFailed = await (async () => {
  const sdk = stubSdk({ failOn: 'domain', resolvesAfter: 99 });
  await registerName({
    sdk, Evo: fakeEvo, label: 'pizza247', identity, identityKey: {}, signer: {},
    privateKeyBytes: key, network: 'mainnet', settleMs: 0,
  });
  return undefined;
})().catch((e) => e.message);
check(/Tenderdash is not available/.test(reallyFailed ?? ''), 'a real failure keeps the node\'s own message');
check(/picks up the preorder/.test(reallyFailed ?? ''), 'and says a rerun costs nothing extra');

// A preorder that landed under a failed broadcast must not be paid for twice.
const preorderKept = await (async () => {
  const sdk = stubSdk({ failOn: 'preorder', resolvesAfter: 2, preorderExists: true });
  const res = await registerName({
    sdk, Evo: fakeEvo, label: 'pizza247', identity, identityKey: {}, signer: {},
    privateKeyBytes: key, network: 'mainnet', settleMs: 0,
  });
  return res;
})().catch((e) => ({ threw: e.message }));
check(preorderKept?.name === 'pizza247.dash', 'a failed preorder broadcast that landed still finishes the registration');

// A contested claim only shows up as a contender in a vote poll — the name stays
// unresolvable for two weeks. Reading that back is what keeps a successful claim
// from being reported as a failure, so it is checked against whatever contest
// happens to be running on mainnet.
console.log('\n6. Live: a running contest reads back (mainnet)');
const { setNetwork, getSdk } = await import('../../name/js/sdk.js');
setNetwork('mainnet');
const sdk = await getSdk();
const polls = await sdk.voting.votePollsByEndDate().catch(() => []);
const open = polls.flatMap((e) => (e.votePolls || []).map((p) => ({ endsAt: new Date(Number(e.timestampMs)), poll: p })));
if (!open.length) {
  console.log('  ⏭  no contest open on mainnet right now');
} else {
  const { poll, endsAt } = open[0];
  const label = String.fromCharCode(...Array.from(poll.indexValues?.[1] ?? []).slice(2));
  check(!!label, `open contest found: ${label}.dash, ends ${endsAt.toISOString().slice(0, 16)}`);
  const found = await contestEndsAt({ sdk, normalizedLabel: label });
  check(found?.getTime() === endsAt.getTime(), 'contestEndsAt finds that poll by name');
  const state = await contestState({ sdk, normalizedLabel: label });
  check(Array.isArray(state.contenders) && state.contenders.length > 0, `${state.contenders.length} contender(s), outcome ${state.outcome ?? 'still open'}`);
  check(state.outcome === undefined, 'an open contest has no winner yet');
  const missing = await contestEndsAt({ sdk, normalizedLabel: 'n0tac0ntest' });
  check(missing === undefined, 'a name without a contest gets no end date');
}

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
