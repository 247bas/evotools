// Reading the contest list from the public platform-explorer indexer.
//
// Every other tool here talks to the chain directly, but a list is exactly what
// the SDK cannot answer: `contestedResourceVoteState` needs a name you already
// know, and `votePollsByEndDate` only knows about contests that are still open.
// Finished ones, their timestamps and who claimed what are indexer territory, so
// this page uses pshenmic's public API — the same data platform-explorer.com
// shows. Nothing here is trusted blindly: every row links into our own explorer,
// which re-reads that name from the chain with a proof.

const HOSTS = {
  mainnet: 'https://platform-explorer.pshenmic.dev',
  testnet: 'https://testnet.platform-explorer.pshenmic.dev',
};

let network = 'mainnet';
export const setNetwork = (n) => { network = n; };
export const getNetwork = () => network;
export const apiHost = () => HOSTS[network];

async function get(path) {
  const res = await fetch(`${HOSTS[network]}${path}`);
  if (!res.ok) throw new Error(`the explorer API answered ${res.status} ${res.statusText}`);
  return res.json();
}

// How many contests exist, how many are open, and which one ends next.
export const stats = () => get('/contestedResources/stats');

// One page of contests. `finished` splits the two lists the page shows.
export async function contests({ finished, page = 1, limit = 25 }) {
  const data = await get(`/contestedResources?voting_finished=${finished}&page=${page}&limit=${limit}&order=desc`);
  return {
    total: data.pagination?.total ?? data.resultSet.length,
    page: data.pagination?.page ?? page,
    rows: data.resultSet.map(toContest),
  };
}

// A single contest, with its contenders. The API addresses one by the base64 of
// its index values, and that base64 can contain a slash — which would split the
// path if it were not escaped.
export async function contestDetail(indexValues) {
  const id = encodeURIComponent(btoa(JSON.stringify(indexValues)));
  const data = await get(`/contestedResource/${id}`);
  return {
    ...toContest(data),
    contenders: (data.contenders ?? []).map((c) => ({
      identityId: c.identifier,
      // DPNS stores the homograph-safe label, so the readable spelling only
      // exists as an alias on whoever claimed it — but the aliases are every
      // name that identity owns, not this one. Only the alias that normalises
      // back to this contest is the readable form of it.
      name: (c.aliases ?? []).map((a) => a.alias).find((a) => homographSafe(a.replace(/\.dash$/i, '')) === data.resourceValue?.[1]),
      claimedAt: c.timestamp ? new Date(c.timestamp) : undefined,
      votesFor: c.towardsIdentityVotes ?? 0,
      votesLock: c.lockVotes ?? 0,
      votesAbstain: c.abstainVotes ?? 0,
    })),
  };
}

// DPNS does not lowercase a label, it substitutes the characters that can be
// confused for each other — o becomes 0, i and l become 1. Doing it here rather
// than through the SDK keeps this page free of the 10 MB WASM bundle; a label
// that fails to match simply keeps its stored form on screen.
const homographSafe = (s) => s.toLowerCase().replace(/[il]/g, '1').replace(/o/g, '0');

// The chain's own tally for one contest, fetched when a row is opened.
//
// Measured on 2026-07-28 across twelve contests: for every open one the index and
// the chain agree exactly, so the list is safe to render from the index. Finished
// ones can drift — thedesert1ynx reads 61 votes in the index against 51 on the
// chain, sega 13 against 6 — always with the index counting higher, and the lock
// tallies always matching. The chain is the one that decided the outcome, so that
// is the number shown once somebody looks closely.
export async function chainTally(normalizedLabel) {
  const { setNetwork: setSdkNetwork, getSdk } = await import('./sdk.js');
  const { contestState } = await import('../../shared/dpns-register.js');
  setSdkNetwork(network);
  const sdk = await getSdk();
  const state = await contestState({ sdk, normalizedLabel });
  return {
    votesFor: state.votes.reduce((a, b) => a + b, 0),
    votesLock: state.lock,
    votesAbstain: state.abstain,
    perContender: Object.fromEntries(state.contenders.map((id, i) => [id, state.votes[i] ?? 0])),
    outcome: state.outcome,
    winner: state.winner,
  };
}

function toContest(r) {
  const label = r.resourceValue?.[1];
  const lock = r.totalCountLock ?? 0;
  const towards = r.totalCountTowardsIdentity ?? 0;
  return {
    label,
    indexValues: r.resourceValue,
    startedAt: r.timestamp ? new Date(r.timestamp) : undefined,
    endsAt: r.endTimestamp ? new Date(r.endTimestamp) : undefined,
    votes: r.totalCountVotes ?? 0,
    votesFor: towards,
    votesLock: lock,
    votesAbstain: r.totalCountAbstain ?? 0,
    finished: !!r.finished,
    // Only the detail response names the identity that won; the list leaves it
    // out. So the outcome comes from the tallies, which the list does carry:
    // lock votes beating every contender is what locks a name away for good,
    // and otherwise the votes went to whoever claimed it.
    winner: r.towardsIdentity ?? undefined,
    outcome: outcomeOf({ finished: !!r.finished, winner: r.towardsIdentity, lock, towards }),
  };
}

function outcomeOf({ finished, winner, lock, towards }) {
  if (!finished) return 'open';
  if (winner) return 'won';
  if (lock > towards) return 'locked';
  if (towards > 0) return 'won';
  return 'undecided'; // finished without a single vote — rare, and not ours to guess
}
