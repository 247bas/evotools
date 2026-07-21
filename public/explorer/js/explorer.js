// Read-only lookups against Dash Platform testnet: identity, DPNS name, contract,
// documents, plus proofs, aggregations and network info. Each returns a plain
// object the UI renders + a raw JSON dump.

import { getSdk } from './sdk.js';

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
  return { username: clean, registered: false, valid, contested, available, contest };
}

async function getContest(label) {
  const sdk = await getSdk();
  const norm = await sdk.dpns.convertToHomographSafe(label);
  const state = await sdk.voting.contestedResourceVoteState({
    dataContractId: DPNS_CONTRACT,
    documentTypeName: 'domain',
    indexName: 'parentNameAndLabel',
    indexValues: ['dash', norm],
    resultType: 'documentsAndVoteTally',
  });
  const contenders = (state.contenders || []).map((c) => ({
    identityId: c.identityId?.toString?.(),
    votes: c.voteTally ?? 0,
  }));
  return {
    normalizedLabel: norm,
    contenders,
    abstain: state.abstainVoteTally ?? 0,
    lock: state.lockVoteTally ?? 0,
    winner: state.winner?.identityId?.toString?.(),
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
