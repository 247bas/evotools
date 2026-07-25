// Smoke test for the resumable DPNS registration. The derivation is offline and
// deterministic, which is the whole point: the same key and name always give the
// same salt, so an interrupted registration can be finished without paying for a
// second preorder. Registering itself costs credits, so it is not repeated here
// — see the session notes in _reference/LESSONS.md §G3 for the live proof.
// Run: node public/shared/test/dpns-register.mjs
import { randomBytes } from 'node:crypto';
import {
  deriveSaltAndEntropy, saltedDomainHash, DPNS_CONTRACT,
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

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
