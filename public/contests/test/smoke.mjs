// Smoke test for the contests page: the indexer is somebody else's service, so
// what this checks is that its answers still have the shape the page renders —
// the fields, the two lists, and the outcome the page derives from them.
// Run: node public/contests/test/smoke.mjs
import { stats, contests, contestDetail, setNetwork } from '../js/api.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (c, m) => (c ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));
const safe = async (l, fn) => {
  try { return await fn(); } catch (e) { failed++; console.log(`  ❌ ${l}: ${e?.message || e}`); }
};

console.log('\n1. mainnet: the summary');
setNetwork('mainnet');
const s = await safe('stats()', () => stats());
check(Number.isFinite(s?.totalContestedResources) && s.totalContestedResources > 0, `${s?.totalContestedResources} contests indexed`);
check(Number.isFinite(s?.totalPendingContestedResources), `${s?.totalPendingContestedResources} open`);
check(Number.isFinite(s?.totalVotesCount) && s.totalVotesCount > 0, `${s?.totalVotesCount} votes cast`);

console.log('\n2. The open list');
const open = await safe('contests(open)', () => contests({ finished: false, limit: 100 }));
check(Array.isArray(open?.rows), `${open?.rows.length} open contest(s), total ${open?.total}`);
if (open?.rows.length) {
  const c = open.rows[0];
  check(typeof c.label === 'string' && c.label.length > 0, `first is ${c.label}.dash`);
  check(c.startedAt instanceof Date && c.endsAt instanceof Date, `claimed ${c.startedAt?.toISOString().slice(0, 10)}, ends ${c.endsAt?.toISOString().slice(0, 10)}`);
  // Two weeks to the day is what the protocol gives a contest.
  const days = (c.endsAt - c.startedAt) / 86400000;
  check(Math.abs(days - 14) < 0.01, `it runs ${days.toFixed(2)} days`);
  check(c.outcome === 'open' && c.finished === false, 'and it counts as open');
  check(c.endsAt.getTime() > Date.now(), 'an open contest ends in the future');
}

console.log('\n3. The decided list, paginated');
const done = await safe('contests(finished)', () => contests({ finished: true, page: 1, limit: 5 }));
check(done?.rows.length === 5 && done.total > 5, `${done?.total} decided, 5 on this page`);
check(done?.rows.every((c) => c.finished === true), 'every row is finished');
check(done?.rows.every((c) => ['won', 'locked', 'undecided'].includes(c.outcome)), `outcomes: ${[...new Set(done?.rows.map((c) => c.outcome))].join(', ')}`);
const page2 = await safe('contests(finished, page 2)', () => contests({ finished: true, page: 2, limit: 5 }));
check(page2?.rows[0]?.label !== done?.rows[0]?.label, 'page 2 holds different contests');

// The list leaves out the winner, so the row derives its outcome from the vote
// counts. That shortcut has to agree with the detail, which knows.
console.log('\n3b. The outcome a row shows matches the one the detail proves');
for (const c of done?.rows.slice(0, 3) ?? []) {
  const full = await safe(`contestDetail(${c.label})`, () => contestDetail(c.indexValues));
  check(full?.outcome === c.outcome, `${c.label}.dash — list says ${c.outcome}, detail says ${full?.outcome}`);
}

console.log('\n4. One contest in full');
const first = done?.rows[0];
const detail = first && await safe('contestDetail()', () => contestDetail(first.indexValues));
check(detail?.label === first?.label, `${detail?.label}.dash fetched by its index values`);
check(Array.isArray(detail?.contenders) && detail.contenders.length > 0, `${detail?.contenders.length} contender(s)`);
check(detail?.contenders.every((c) => typeof c.identityId === 'string'), 'each contender has an identity');
check(detail?.contenders.every((c) => c.claimedAt instanceof Date), 'and the moment it claimed the name');
const summed = detail?.contenders.reduce((t, c) => t + c.votesFor, 0);
check(summed === detail?.votesFor, `per-contender votes add up to the total (${summed})`);
if (detail?.outcome === 'won') {
  check(detail.contenders.some((c) => c.identityId === detail.winner), 'the winner is one of the contenders');
}

console.log('\n5. A locked contest (pay.dash) — decided, but nobody owns it');
const pay = await safe('contestDetail(pay)', () => contestDetail(['dash', 'pay']));
check(pay?.outcome === 'locked', `pay.dash is ${pay?.outcome} with ${pay?.votesLock} lock votes`);
check(!pay?.winner, 'a locked contest has no winner');
check(pay?.finished === true, 'and it is finished');

console.log('\n6. testnet answers too');
setNetwork('testnet');
const t = await safe('stats()@testnet', () => stats());
check(Number.isFinite(t?.totalContestedResources), `testnet has ${t?.totalContestedResources} contests indexed`);

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
