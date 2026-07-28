// The map's data side: one public thing pasted in, every place your money can
// sit filled in.
//
// Nothing secret is ever asked for. It turned out not to be needed: a Dash
// address already contains the public key hash, so it finds the identities that
// key opens just as well as the key itself would, and an identity carries the
// address that funded it inside its own creation transition. A recovery phrase
// would add nothing here except a reason to be careful, so this page refuses it.
//
// Three sources, each doing what only it can:
//   the SDK        — balances, identities, names, and decoding a transition
//   Insight        — layer-1 balances and the transactions behind them
//   the indexer    — which transition created an identity (nothing else knows)

import { setNetwork, getNetwork, getSdk, loadEvo } from './sdk.js';
import { fetchUtxos, spendable, totalDuffs } from '../../shared/assetlock.js';
import { hashFromL1, l1FromHash, hashFromPlatform, platformFromHash, toHex } from './addresses.js';
import { contestState, contestEndsAt } from '../../shared/dpns-register.js';

export const CREDITS_PER_DASH = 100_000_000_000n;
export const DUFFS_PER_DASH = 100_000_000;

export const dashFromCredits = (c) => (Number(c) / Number(CREDITS_PER_DASH)).toFixed(8);
export const dashFromDuffs = (d) => (d / DUFFS_PER_DASH).toFixed(8);

// Which transition created an identity is not a question the SDK can answer, so
// the trace leans on the public indexer for that one hash.
const INDEXER = {
  mainnet: 'https://platform-explorer.pshenmic.dev',
  testnet: 'https://testnet.platform-explorer.pshenmic.dev',
};
const INSIGHT = {
  mainnet: 'https://insight.dash.org/insight-api',
  testnet: 'https://insight.testnet.networks.dash.org/insight-api',
};

const words = (s) => s.trim().split(/\s+/).filter(Boolean);

// What did somebody just paste? Length separates the two things that both start
// with an X on mainnet: an address is 34 characters, a private key is 52.
export function detect(raw) {
  const s = (raw || '').trim();
  if (!s) return { kind: 'empty' };
  if (words(s).length >= 12) return { kind: 'secret' };
  if (/^[X7c][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s)) return { kind: 'secret' };
  // A raw key or a fragment of one is hex and long. Without this a 62-character
  // hex string reads as a DPNS label and gets sent to a node as a name lookup —
  // which is exactly what this page promises never to do.
  if (/^[0-9a-f]{32,}$/i.test(s)) return { kind: 'secret' };
  if (/^([xt]prv|[xt]pub)[1-9A-HJ-NP-Za-km-z]{50,}$/.test(s)) return { kind: 'secret' };
  if (/\.dash$/i.test(s)) return { kind: 'name' };
  if (/^dash1[0-9a-z]{20,}$/i.test(s)) return { kind: 'platform-address', network: 'mainnet' };
  if (/^tdash1[0-9a-z]{20,}$/i.test(s)) return { kind: 'platform-address', network: 'testnet' };
  if (/^X[1-9A-HJ-NP-Za-km-z]{32,33}$/.test(s)) return { kind: 'l1-address', network: 'mainnet' };
  if (/^y[1-9A-HJ-NP-Za-km-z]{32,33}$/.test(s)) return { kind: 'l1-address', network: 'testnet' };
  if (/^[1-9A-HJ-NP-Za-km-z]{42,45}$/.test(s)) return { kind: 'identity' };
  // Anything else that could be a DPNS label is one. Typing `.dash` after a name
  // you already know is a name is busywork.
  if (/^[a-z0-9-]{3,63}$/i.test(s)) return { kind: 'name' };
  return { kind: 'unknown' };
}

// ── the three sources ────────────────────────────────────────────────────────
async function l1Balance(address, network) {
  const utxos = await fetchUtxos(address, network).catch(() => []);
  const confirmed = spendable(utxos);
  return {
    address,
    duffs: totalDuffs(confirmed),
    unconfirmedDuffs: totalDuffs(utxos) - totalDuffs(confirmed),
    utxos: utxos.length,
  };
}

async function platformBalance(address) {
  const sdk = await getSdk();
  const info = await sdk.addresses.get(address).catch(() => undefined);
  return { address, credits: info?.balance ?? 0n, exists: !!info };
}

async function identityCard(id) {
  const sdk = await getSdk();
  const identity = await sdk.identities.fetch(id).catch(() => undefined);
  if (!identity) return undefined;
  const [names, keys] = await Promise.all([
    // 100 is what the query itself caps at, so a name count above that is
    // reported as "100+" rather than guessed at.
    sdk.dpns.usernames({ identityId: id, limit: 100 }).catch(() => []),
    sdk.identities.getKeys({ identityId: id, request: { type: 'all' } }).catch(() => []),
  ]);
  return {
    id,
    credits: identity.balance ?? 0n,
    names: names ?? [],
    hasTransferKey: keys.some((k) => k.purpose === 'TRANSFER' && !k.disabledAt),
  };
}

// Does any identity carry this key? An address is enough to ask: it holds the
// public key hash, which is exactly what the question takes.
async function identityForHash(hashHex) {
  const sdk = await getSdk();
  const identity = await sdk.identities.byPublicKeyHash(hashHex).catch(() => undefined);
  return identity?.id?.toString?.();
}

// ── the trace: an identity back to the money that paid for it ────────────────
// An identity created from platform addresses names them in its own creation
// transition, and a platform address is the same key as a layer-1 address. So
// the way back is: identity → that transition → the address that paid → the
// coins behind it. Identities made straight from an asset lock, or topped up by
// another identity, have a different story, and this says so rather than guessing.
export async function indexerIdentity(identityId, network) {
  const res = await fetch(`${INDEXER[network]}/identity/${identityId}`);
  if (!res.ok) throw new Error(`the indexer answered ${res.status}`);
  return res.json();
}

// A contested name is claimed but not owned until the masternodes have voted, so
// it is in no list of usernames — while 0.2 DASH of this identity's money sits on
// its preorder. Leaving it off the map would hide both. The indexer lists the
// claim; the chain says how the vote stands.
export async function pendingClaims(record, network) {
  const claims = (record?.aliases ?? []).filter((a) => a.status !== 'ok');
  if (!claims.length) return [];
  const sdk = await getSdk();
  return Promise.all(claims.map(async (a) => {
    const label = a.alias.replace(/\.dash$/i, '');
    const normalizedLabel = await sdk.dpns.convertToHomographSafe(label).catch(() => label);
    const [state, endsAt] = await Promise.all([
      contestState({ sdk, normalizedLabel }).catch(() => undefined),
      contestEndsAt({ sdk, normalizedLabel }).catch(() => undefined),
    ]);
    // The tallies come back in contender order, so the votes for this identity
    // are the ones at its own position — not the first entry, which belongs to
    // whoever happens to be listed first.
    const seat = state?.contenders?.indexOf(record.identifier) ?? -1;
    const votes = seat >= 0 ? (state?.votes?.[seat] ?? 0) : 0;
    return {
      name: a.alias,
      claimedAt: a.timestamp ? new Date(a.timestamp) : undefined,
      endsAt,
      contenders: state?.contenders?.length ?? 0,
      isContender: seat >= 0,
      votes,
      ahead: seat >= 0 && votes > 0 && votes === Math.max(...(state?.votes ?? [0])),
      lock: state?.lock ?? 0,
      decided: !!state?.outcome,
    };
  }));
}

// Which transition actually minted this identity. The indexer's own `txHash`
// field cannot be trusted for it: on an identity that has been updated since, it
// points at the update instead — thedesertlynx.dash reads as created in 2026
// that way, two years after it won its name. Walking its transactions from the
// oldest end and taking the first mint is the answer that stays true.
async function creationTransition(identityId, network, record) {
  const list = await fetch(`${INDEXER[network]}/identity/${identityId}/transactions?limit=10&order=asc`)
    .then((r) => (r.ok ? r.json() : undefined))
    .catch(() => undefined);
  const first = (list?.resultSet ?? []).find((t) => /^IDENTITY_CREATE/.test(t.type));
  if (first) return { hash: first.hash, timestamp: first.timestamp };
  if (record?.txHash) return { hash: record.txHash, timestamp: record.timestamp };
  throw new Error('no creation transaction found for this identity');
}

export async function traceFunding(identityId, network, known) {
  const Evo = await loadEvo();
  const record = known ?? (await indexerIdentity(identityId, network));
  const creation = await creationTransition(identityId, network, record);

  const txRes = await fetch(`${INDEXER[network]}/transaction/${creation.hash}`);
  const tx = await txRes.json();
  const base = { createdAt: creation.timestamp, txHash: creation.hash, inputs: [] };
  // The stored bytes carry the transition type in front; both body parsers
  // expect to start after it.
  const bytes = Uint8Array.from(atob(tx.data), (c) => c.charCodeAt(0));

  // The other way to mint an identity: straight from an asset lock, no platform
  // address in between. Still the more common of the two on mainnet. The lock's
  // outpoint is in the transition, so this half of the map has a different shape
  // rather than no answer.
  if (tx.type === 'IDENTITY_CREATE') {
    const body = Evo.IdentityCreateTransition.fromBytes(bytes.slice(1));
    const outPoint = body.assetLockProof?.outPoint;
    return {
      ...base,
      kind: 'from-asset-lock',
      lock: outPoint ? { txid: outPoint.txid, vout: outPoint.vout } : undefined,
    };
  }
  // The third route, and as common as platform addresses on mainnet: the coins
  // come out of the shielded pool. There is no address to point at, which is the
  // whole point of that pool — but the amount is public.
  if (tx.type === 'IDENTITY_CREATE_FROM_SHIELDED_POOL') {
    return { ...base, kind: 'from-shielded', shieldedCredits: BigInt(tx.shielded?.amount ?? 0) };
  }
  if (tx.type !== 'IDENTITY_CREATE_FROM_ADDRESSES') return { ...base, kind: tx.type };

  const body = Evo.IdentityCreateFromAddressesTransition.fromBytes(bytes.slice(1));

  const inputs = [];
  for (const input of body.inputs) {
    const platformAddress = input.address.toBech32m(network);
    const { hash } = hashFromPlatform(Evo, platformAddress);
    inputs.push({
      platformAddress,
      l1Address: await l1FromHash(hash, network),
      credits: input.amount,
    });
  }
  return { kind: 'from-addresses', createdAt: record.timestamp, txHash: record.txHash, inputs };
}

// The layer-1 transaction an asset lock lives in: who paid it, and how much was
// locked away. This is the older route's equivalent of a funding address.
export async function assetLockOrigin(txid, vout, network) {
  const tx = await (await fetch(`${INSIGHT[network]}/tx/${txid}`)).json();
  const locked = (tx.vout || [])[vout ?? 0];
  return {
    txid,
    when: tx.time ? new Date(tx.time * 1000) : undefined,
    from: [...new Set((tx.vin || []).map((v) => v.addr).filter(Boolean))],
    lockedDash: Number(locked?.value ?? 0),
  };
}

// One hop further back: which layer-1 transaction put coins on that address, and
// which addresses paid it. Public data, but a step beyond "where is my money", so
// the page only asks when told to.
export async function fundingSource(l1Address, network) {
  const res = await fetch(`${INSIGHT[network]}/addr/${l1Address}`);
  if (!res.ok) throw new Error(`Insight answered ${res.status}`);
  const info = await res.json();
  const txids = info.transactions || [];
  const out = [];
  // Oldest first: the funding comes before the asset lock that spent it.
  for (const txid of txids.slice(-3).reverse()) {
    const tx = await (await fetch(`${INSIGHT[network]}/tx/${txid}`)).json();
    const paidIn = (tx.vout || []).some((o) => (o.scriptPubKey?.addresses || []).includes(l1Address));
    // An asset lock output carries no address Insight can name — that absence is
    // how you recognise it from layer 1.
    const isLock = (tx.vout || []).some((o) => !(o.scriptPubKey?.addresses || []).length);
    out.push({
      txid,
      when: tx.time ? new Date(tx.time * 1000) : undefined,
      from: [...new Set((tx.vin || []).map((v) => v.addr).filter(Boolean))],
      paidIn,
      isLock,
    });
  }
  return out;
}

// ── entry points ─────────────────────────────────────────────────────────────
async function fromKeyHash(hash, network, known = {}) {
  const Evo = await loadEvo();
  const platformAddress = known.platform ?? platformFromHash(Evo, hash, network);
  const l1Address = known.l1 ?? (await l1FromHash(hash, network));
  const [l1, platform, identityId] = await Promise.all([
    l1Balance(l1Address, network),
    platformBalance(platformAddress),
    identityForHash(toHex(hash)),
  ]);
  const identities = identityId ? [await identityCard(identityId)].filter(Boolean) : [];
  return { network, l1, platform, identities, keyHash: toHex(hash) };
}

async function fromL1Address(address, network) {
  const { hash } = await hashFromL1(address);
  return { ...(await fromKeyHash(hash, network, { l1: address })), source: 'l1-address' };
}

async function fromPlatformAddress(address, network) {
  const Evo = await loadEvo();
  const { hash } = hashFromPlatform(Evo, address);
  return { ...(await fromKeyHash(hash, network, { platform: address })), source: 'platform-address' };
}

async function fromIdentity(id, network) {
  const card = await identityCard(id);
  if (!card) throw new Error(`No identity ${id} on ${network}. Try the other network.`);

  // One indexer read serves both the trace and the claims still in a vote.
  const record = await indexerIdentity(id, network).catch(() => undefined);
  card.pending = record ? await pendingClaims(record, network).catch(() => []) : [];
  const trace = record
    ? await traceFunding(id, network, record).catch((e) => ({ error: e?.message || String(e) }))
    : { error: 'the indexer did not answer, so the funding could not be traced' };

  const state = { source: 'identity', network, identities: [card], trace };
  // The address that funded it is a real place on the map, so fill those boxes.
  const first = trace?.inputs?.[0];
  if (first) {
    const [l1, platform] = await Promise.all([
      l1Balance(first.l1Address, network),
      platformBalance(first.platformAddress),
    ]);
    state.l1 = l1;
    state.platform = platform;
  } else if (trace?.kind === 'from-asset-lock' && trace.lock?.txid) {
    // No platform address was involved at all. The layer-1 side still has an
    // answer: whoever paid the transaction the lock sits in.
    const origin = await assetLockOrigin(trace.lock.txid, trace.lock.vout, network).catch(() => undefined);
    if (origin) {
      state.trace = { ...trace, origin };
      if (origin.from[0]) state.l1 = await l1Balance(origin.from[0], network);
    }
    state.platformUnused = 'No platform address was involved: this identity was minted straight from an asset lock. Both routes are in daily use — evotools mints through a platform address, other software locks coins on layer 1 and mints from the lock.';
  }
  return state;
}

async function fromName(name, network) {
  const sdk = await getSdk();
  const label = name.replace(/\.dash$/i, '').toLowerCase();
  const owner = await sdk.dpns.resolveName(label).catch(() => undefined);
  if (!owner) throw new Error(`${label}.dash does not resolve on ${network}. A contested name resolves only once its vote ends.`);
  return { ...(await fromIdentity(owner.toString(), network)), source: 'name' };
}

// Resolve whatever was pasted. An input that names its own network switches the
// map to it; the rest follows the toggle.
export async function resolve(raw, { network } = {}) {
  const d = detect(raw);
  if (d.kind === 'empty') throw new Error('Paste an address, an identity ID or a .dash name.');
  if (d.kind === 'secret') {
    throw new Error('This page never takes a recovery phrase or a private key — and does not need one. Paste your Dash address, your platform address, your identity ID or your .dash name instead: every one of them opens the same map.');
  }
  if (d.kind === 'unknown') throw new Error('That is not something this map recognises. Try a Dash address, a dash1… platform address, an identity ID or a .dash name.');
  if (d.network) setNetwork(d.network);
  else if (network) setNetwork(network);
  const net = getNetwork();
  const s = raw.trim();
  switch (d.kind) {
    case 'l1-address': return fromL1Address(s, net);
    case 'platform-address': return fromPlatformAddress(s, net);
    case 'name': return fromName(s, net);
    case 'identity':
      // An identity ID and a long name are both base58 text, so a string that
      // looks like an id but is not one gets a second chance as a name — the
      // same order the explorer's search uses.
      try { return await fromIdentity(s, net); }
      catch (e) {
        if (!/^[a-z0-9-]{3,63}$/i.test(s)) throw e;
        return fromName(s, net).catch(() => { throw e; });
      }
    default: throw new Error('Unsupported input.');
  }
}
