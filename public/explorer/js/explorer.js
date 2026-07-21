// Read-only lookups against Dash Platform testnet: identity, DPNS name, contract,
// documents, plus proofs, aggregations and network info. Each returns a plain
// object the UI renders + a raw JSON dump.

import { getSdk } from './sdk.js';

const CREDITS_PER_DASH = 100_000_000_000n;
export const creditsToDash = (c) => (Number(c ?? 0n) / Number(CREDITS_PER_DASH)).toFixed(4);
const bytesToHex = (u8) => (u8 ? Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('') : '');

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
  try { names = await sdk.dpns.usernames({ identityId: id }); } catch { /* none */ }

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
  const owner = await sdk.dpns.resolveName(clean);
  if (owner) {
    return { username: clean, registered: true, identityId: typeof owner === 'string' ? owner : owner.toString() };
  }
  // Not registered — report validity / availability / contested instead.
  const valid = await sdk.dpns.isValidUsername(clean).catch(() => false);
  const [contested, available] = valid
    ? await Promise.all([
        sdk.dpns.isContestedUsername(clean).catch(() => false),
        sdk.dpns.isNameAvailable(clean).catch(() => undefined),
      ])
    : [false, false];
  return { username: clean, registered: false, valid, contested, available };
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
