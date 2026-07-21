// Read-only lookups against Dash Platform testnet: identity, DPNS name, contract,
// and documents. Each returns a plain object the UI renders + a raw JSON dump.

import { getSdk } from './sdk.js';

const CREDITS_PER_DASH = 100_000_000_000n;
export const creditsToDash = (c) => (Number(c ?? 0n) / Number(CREDITS_PER_DASH)).toFixed(4);

export async function lookupIdentity(id) {
  const sdk = await getSdk();
  const identity = await sdk.identities.fetch(id);
  if (!identity) return null;

  let name;
  try { name = await sdk.dpns.username(id); } catch { /* no name */ }

  const keys = identity.publicKeys.map((k) => ({
    id: k.keyId,
    purpose: k.purpose,
    securityLevel: k.securityLevel,
    type: k.keyType,
  }));

  return {
    id: identity.id.toString(),
    balance: identity.balance,
    revision: identity.revision,
    name,
    keys,
    raw: identity.toJSON(),
  };
}

export async function lookupName(label) {
  const sdk = await getSdk();
  const clean = label.replace(/\.dash$/i, '').trim().toLowerCase();
  const owner = await sdk.dpns.resolveName(clean);
  if (!owner) return null;
  return {
    username: clean,
    identityId: typeof owner === 'string' ? owner : owner.toString(),
  };
}

export async function lookupContract(id) {
  const sdk = await getSdk();
  const contract = await sdk.contracts.fetch(id);
  if (!contract) return null;
  const schemas = contract.schemas;
  return {
    id: contract.id.toString(),
    ownerId: contract.ownerId.toString(),
    documentTypes: Object.keys(schemas),
    schemas,
  };
}

export async function queryDocuments(contractId, typeName, limit = 10) {
  const sdk = await getSdk();
  const res = await sdk.documents.query({ dataContractId: contractId, documentTypeName: typeName, limit });
  // Use the typed getters (identifiers as base58, data on `.properties`) rather
  // than toObject(), which returns raw byte arrays for identifiers.
  return [...res.values()].filter(Boolean).map((d) => ({
    id: d.id?.toString(),
    ownerId: d.ownerId?.toString(),
    revision: d.revision,
    createdAt: d.createdAt,
    properties: d.properties,
  }));
}
