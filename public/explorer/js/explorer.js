// Read-only lookups against Dash Platform testnet: identity, DPNS name, contract,
// documents, plus proofs, aggregations and network info. Each returns a plain
// object the UI renders + a raw JSON dump.

import { getSdk, getSdkFor, loadEvo } from './sdk.js';
import { contestState, contestEndsAt } from '../../shared/dpns-register.js';

const CREDITS_PER_DASH = 100_000_000_000n;
export const creditsToDash = (c) => (Number(c ?? 0n) / Number(CREDITS_PER_DASH)).toFixed(4);
const bytesToHex = (u8) => (u8 ? Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('') : '');
const str = (x) => (typeof x === 'string' ? x : x?.toString?.());
// DPNS system contract on testnet (stable across testnet resets).
const DPNS_CONTRACT = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';

// Pull the interesting bits out of a *WithProof response.
function proofMeta(resp) {
  const m = resp.metadata, p = resp.proof;
  return {
    height: m.height,
    epoch: m.epoch,
    timeMs: m.timeMs,
    protocolVersion: m.protocolVersion,
    quorumType: p.quorumType,
    round: p.round,
    quorumHash: bytesToHex(p.quorumHash),
    signatureBytes: p.signature?.length ?? 0,
  };
}

export async function lookupIdentity(id, { proof = false } = {}) {
  const sdk = await getSdk();
  let identity, pm;
  if (proof) {
    const resp = await sdk.identities.fetchWithProof(id);
    identity = resp.data;
    pm = proofMeta(resp);
  } else {
    identity = await sdk.identities.fetch(id);
  }
  if (!identity) return null;

  let name;
  let names = [];
  try { name = await sdk.dpns.username(id); } catch { /* none */ }
  // Default limit is 10; 100 is the max the query allows.
  try { names = await sdk.dpns.usernames({ identityId: id, limit: 100 }); } catch { /* none */ }
  names.sort((a, b) => a.localeCompare(b));

  const keys = identity.publicKeys.map((k) => ({
    id: k.keyId, purpose: k.purpose, securityLevel: k.securityLevel, type: k.keyType,
  }));

  return {
    id: identity.id.toString(),
    balance: identity.balance,
    revision: identity.revision,
    name,
    names,
    keys,
    raw: identity.toJSON(),
    proof: pm,
  };
}

export async function lookupName(label) {
  const sdk = await getSdk();
  const clean = label.replace(/\.dash$/i, '').trim().toLowerCase();
  const [owner, valid, contested] = await Promise.all([
    sdk.dpns.resolveName(clean),
    sdk.dpns.isValidUsername(clean).catch(() => false),
    sdk.dpns.isContestedUsername(clean).catch(() => false),
  ]);
  // Contested (short/premium) names are decided by masternode vote — pull the
  // contenders and tallies. Only contestable labels have a contested index.
  const contest = contested ? await getContest(clean).catch(() => undefined) : undefined;

  if (owner) {
    return { username: clean, registered: true, identityId: str(owner), valid: true, contested, contest };
  }
  const available = valid ? await sdk.dpns.isNameAvailable(clean).catch(() => undefined) : false;
  // A contest that ended in a lock leaves the name unowned, so isNameAvailable()
  // reports true even though nobody can ever claim it. The lock wins.
  const locked = contest?.outcome === 'Locked';
  return { username: clean, registered: false, valid, contested, available: locked ? false : available, locked, contest };
}

async function getContest(label) {
  const sdk = await getSdk();
  const norm = await sdk.dpns.convertToHomographSafe(label);
  // `outcome` only exists once the contest ended ('Locked' = nobody gets the
  // name, 'WonByIdentity' = awarded). While it is open the claims are real but
  // the name resolves to nobody, so an open contest has to be shown as such.
  const state = await contestState({ sdk, normalizedLabel: norm });
  const pending = !state.outcome && state.contenders.length > 0;
  return {
    normalizedLabel: norm,
    contenders: state.contenders.map((identityId, i) => ({ identityId, votes: state.votes[i] ?? 0 })),
    abstain: state.abstain,
    lock: state.lock,
    outcome: state.outcome,
    winner: state.winner,
    pending,
    endsAt: pending ? await contestEndsAt({ sdk, normalizedLabel: norm }).catch(() => undefined) : undefined,
  };
}

export async function lookupToken(tokenId) {
  const sdk = await getSdk();
  const info = await sdk.tokens.contractInfo(tokenId);
  if (!info) return null; // token does not exist
  const contractId = str(info.contractId);
  const position = info.tokenContractPosition;

  let config, supply, paused;
  try { const c = await sdk.contracts.fetch(contractId); config = c?.tokens?.[position]; } catch { /* ignore */ }
  try { const s = await sdk.tokens.totalSupply(tokenId); supply = s?.toObject ? s.toObject() : { totalSupply: s?.totalSupply }; } catch { /* ignore */ }
  try { const st = await sdk.tokens.statuses([tokenId]); paused = [...st.values()][0]?.isPaused; } catch { /* ignore */ }

  // Defensive extraction — token config shape may vary by contract version.
  const loc = config?.conventions?.localizations?.en || config?.localizations?.en;
  return {
    id: str(tokenId),
    contractId,
    position,
    name: loc?.singularForm || loc?.pluralForm,
    decimals: config?.conventions?.decimals ?? config?.decimals,
    paused,
    supply,
    config,
  };
}

export async function lookupContract(id, { proof = false } = {}) {
  const sdk = await getSdk();
  let contract, pm;
  if (proof) {
    const resp = await sdk.contracts.fetchWithProof(id);
    contract = resp.data;
    pm = proofMeta(resp);
  } else {
    contract = await sdk.contracts.fetch(id);
  }
  if (!contract) return null;
  const schemas = contract.schemas;
  return {
    id: contract.id.toString(),
    ownerId: contract.ownerId.toString(),
    documentTypes: Object.keys(schemas),
    schemas,
    proof: pm,
  };
}

export async function queryDocuments(contractId, typeName, { where, orderBy, limit = 10, proof = false } = {}) {
  const sdk = await getSdk();
  const query = { dataContractId: contractId, documentTypeName: typeName, limit };
  if (where && where.length) query.where = where;
  if (orderBy && orderBy.length) query.orderBy = orderBy;

  let map, pm;
  if (proof) {
    const resp = await sdk.documents.queryWithProof(query);
    map = resp.data;
    pm = proofMeta(resp);
  } else {
    map = await sdk.documents.query(query);
  }
  const docs = [...map.values()].filter(Boolean).map((d) => ({
    id: d.id?.toString(),
    ownerId: d.ownerId?.toString(),
    revision: d.revision,
    createdAt: d.createdAt,
    properties: d.properties,
  }));
  return { docs, proof: pm };
}

// count needs a countable index on the document type; surfaces the SDK error otherwise.
export async function countDocuments(contractId, typeName, where) {
  const sdk = await getSdk();
  const query = { dataContractId: contractId, documentTypeName: typeName };
  if (where && where.length) query.where = where;
  const res = await sdk.documents.count(query);
  const vals = [...res.values()];
  return vals.length ? vals[0] : 0n;
}

export async function networkInfo() {
  const sdk = await getSdk();
  const e = await sdk.epoch.current();
  return {
    epoch: e.index,
    protocolVersion: e.protocolVersion,
    firstBlockHeight: e.firstBlockHeight,
    firstBlockTime: e.firstBlockTime,
  };
}

// ── shielded (Orchard) pool ──────────────────────────────────────────────────
// Platform runs an Orchard shielded credit pool. Its total balance, the note
// set and the commitment-tree anchors are public; who owns a note and what it
// holds is not. Reads only — building shielded transitions needs the Orchard
// prover, which the WASM SDK deliberately leaves out.

// The note query has no count endpoint, so the note total comes from fetching
// the set. It only accepts startIndex 0 (ranges must be MMR-aligned), so this
// is one request with a ceiling rather than real paging.
const NOTE_FETCH_CAP = 8192;

export async function shieldedPool(network, { proof = false, notes = true } = {}) {
  const sdk = await getSdkFor(network);

  let balance, pm;
  if (proof) {
    const resp = await sdk.shielded.poolStateWithProof();
    balance = resp.data;
    pm = proofMeta(resp);
  } else {
    balance = await sdk.shielded.poolState();
  }

  const [anchors, latest, noteList] = await Promise.all([
    sdk.shielded.anchors().catch(() => []),
    sdk.shielded.mostRecentAnchor().catch(() => undefined),
    notes ? sdk.shielded.encryptedNotes(0n, NOTE_FETCH_CAP).catch(() => null) : null,
  ]);

  return {
    network,
    balance: balance ?? 0n,
    anchors: anchors.length,
    latestAnchor: bytesToHex(latest),
    notes: noteList ? noteList.length : undefined,
    notesCapped: noteList ? noteList.length >= NOTE_FETCH_CAP : false,
    noteBytes: noteList?.[0]?.encryptedNote?.length,
    proof: pm,
  };
}

// Has a nullifier been spent? Takes the 32-byte value as 64 hex characters.
export async function checkNullifier(network, input) {
  const clean = input.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('A nullifier is 32 bytes — 64 hex characters.');
  const sdk = await getSdkFor(network);
  const bytes = Uint8Array.from(clean.match(/../g).map((b) => parseInt(b, 16)));
  const status = (await sdk.shielded.nullifiers([bytes]))?.[0];
  return { nullifier: clean, isSpent: !!status?.isSpent, known: !!status };
}

// ── developer tools: decode / broadcast a state transition ───────────────────
function parseStateTransition(Evo, input) {
  const s = input.trim();
  const isHex = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
  return isHex ? Evo.StateTransition.fromHex(s) : Evo.StateTransition.fromBase64(s);
}

export async function decodeStateTransition(input) {
  const Evo = await loadEvo();
  const st = parseStateTransition(Evo, input);
  return {
    actionType: st.actionType,
    actionTypeNumber: st.actionTypeNumber,
    ownerId: st.ownerId?.toString?.(),
    identityNonce: st.identityNonce,
    identityContractNonce: st.identityContractNonce,
    signaturePublicKeyId: st.signaturePublicKeyId,
    userFeeIncrease: st.userFeeIncrease,
    hash: st.hash(false),
  };
}

export async function broadcastStateTransition(input) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const st = parseStateTransition(Evo, input);
  const result = await sdk.stateTransitions.broadcastAndWait(st);
  return result?.toJSON ? result.toJSON() : { ok: true };
}
