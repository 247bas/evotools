// Counting the notes in the shielded pool, which is harder than it sounds.
//
// There is no endpoint that counts them, so counting means fetching them, and
// the fetch has a ceiling. Two rules, both learned the hard way:
//
//   1. A node returns at most so many notes per request, whatever you ask for.
//      Mainnet stops at 2,048; testnet goes past that, so it is a node setting
//      and not a constant to hard-code. Ask for more than a node will give and
//      it hands back the ceiling, which reads exactly like a complete answer —
//      that is how evotools published "2,048 notes" while the pool held 2,301,
//      on both /shielded and the explorer's pool panel.
//   2. `startIndex` must be a multiple of the count asked for, or the request
//      is refused: "start_index is not chunk-aligned; must be a multiple of
//      max_elements". So paging works, in chunks of one size.
//
// Hence: take a chunk. Short chunk, that is the lot. Full chunk, ask for the
// next one. Where paging is refused, ask once for twice as much and see whether
// the answer grows; an answer shorter than the request is everything, an answer
// that did not grow is the ceiling again. If neither settles it, say so instead
// of printing a ceiling as a total — `exact: false` is what the pages render as
// a trailing "+".
export const NOTE_CHUNK = 2048;

export async function countNotes(sdk, { chunk = NOTE_CHUNK, maxChunks = 16 } = {}) {
  const first = await sdk.shielded.encryptedNotes(0n, chunk);
  if (first.length < chunk) return { count: first.length, exact: true, sample: first[0] };

  let total = first.length;
  for (let i = 1; i < maxChunks; i++) {
    let page;
    try {
      page = await sdk.shielded.encryptedNotes(BigInt(i * chunk), chunk);
    } catch {
      const wider = chunk * 2;
      try {
        const big = await sdk.shielded.encryptedNotes(0n, wider);
        if (big.length > total && big.length < wider) return { count: big.length, exact: true, sample: big[0] };
        return { count: Math.max(total, big.length), exact: false, sample: big[0] ?? first[0] };
      } catch {
        return { count: total, exact: false, sample: first[0] };
      }
    }
    total += page.length;
    if (page.length < chunk) return { count: total, exact: true, sample: first[0] };
  }
  return { count: total, exact: false, sample: first[0] };
}
