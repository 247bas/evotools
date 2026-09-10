// Counting the notes in the shielded pool, which is harder than it sounds.
//
// There is no endpoint that counts them, so counting means fetching them, and
// the fetch has a ceiling. Two rules, both learned the hard way:
//
//   1. A node returns at most so many notes per request, whatever you ask for,
//      and hands that ceiling back looking exactly like a complete answer.
//      Mainnet stops at 2,048; testnet returns more. It is a node setting, so
//      it must be discovered, never assumed — evotools published "2,048 notes"
//      on /shielded and in the explorer while the pool held 2,301, because the
//      guard asked whether the answer had reached a number we had picked.
//   2. `startIndex` must be a multiple of 2048: "start_index N is not
//      chunk-aligned; must be a multiple of 2048". Not a multiple of the count
//      asked for — of that constant. Resuming at 2048 works whether you ask for
//      2,048 notes or 65,536.
//
// Which gives the count away without knowing any node's ceiling. Ask for far
// more than the pool could hold; whatever comes back, a ceiling can only be a
// whole number of chunks, because a node that stopped mid-chunk could not be
// resumed at all. So an answer that is not a multiple of 2048 is the end of the
// pool, and an answer that is one might be a ceiling — resume at it and ask
// again. Mainnet settles in two calls, testnet in one.
export const CHUNK = 2048;          // the alignment the node enforces
const ASK = 1 << 20;                // more than any pool will hold, so the answer is the node's own limit

export async function countNotes(sdk, { ask = ASK, maxPages = 64 } = {}) {
  let total = 0;
  let first;
  for (let page = 0; page < maxPages; page++) {
    let batch;
    try {
      batch = await sdk.shielded.encryptedNotes(BigInt(total), ask);
    } catch (e) {
      // Only reachable after a full chunk, so the pool holds at least what has
      // been counted; some nodes refuse a read that starts past the last note
      // instead of answering with none.
      return { count: total, exact: false, sample: first, reason: e?.message || String(e) };
    }
    if (page === 0) first = batch[0];
    total += batch.length;
    // Nothing left, or a part-chunk that no ceiling could have produced.
    if (batch.length === 0 || batch.length % CHUNK !== 0) {
      return { count: total, exact: true, sample: first, pages: page + 1 };
    }
  }
  return { count: total, exact: false, sample: first, reason: `stopped after ${maxPages} pages` };
}
