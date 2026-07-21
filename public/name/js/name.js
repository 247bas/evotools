// DPNS operations for dash-name: check availability + contest state, and claim a
// name for an existing identity (reuses onboard's registration + explorer's
// contest query).
import { getSdk, loadEvo } from './sdk.js';

const str = (x) => (typeof x === 'string' ? x : x?.toString?.());
// DPNS system contract — identical on testnet and mainnet.
const DPNS_CONTRACT = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';

export async function checkName(label) {
  const sdk = await getSdk();
  const clean = label.replace(/\.dash$/i, '').trim().toLowerCase();
  const [valid, contested] = await Promise.all([
    sdk.dpns.isValidUsername(clean).catch(() => false),
    sdk.dpns.isContestedUsername(clean).catch(() => false),
  ]);
  if (!valid) return { label: clean, valid: false };

  const owner = await sdk.dpns.resolveName(clean);
  const registered = !!owner;
  const available = registered ? false : await sdk.dpns.isNameAvailable(clean).catch(() => undefined);
  const contest = contested ? await getContest(clean).catch(() => undefined) : undefined;

  return {
    label: clean,
    valid: true,
    registered,
    ownerId: registered ? str(owner) : undefined,
    available,
    contested,
    contest,
  };
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
  return {
    contenders: (state.contenders || []).map((c) => ({ identityId: c.identityId?.toString?.(), votes: c.voteTally ?? 0 })),
    abstain: state.abstainVoteTally ?? 0,
    lock: state.lockVoteTally ?? 0,
    winner: state.winner?.identityId?.toString?.(),
  };
}

// Claim a name for an existing identity, signed with its CRITICAL auth key.
export async function registerName(label, identityId, wif) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { IdentitySigner } = Evo;
  const clean = label.replace(/\.dash$/i, '').trim().toLowerCase();

  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`Identity not found on this network: ${identityId}`);

  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  const identityKey = keys.find((k) => k.purpose === 'AUTHENTICATION' && k.securityLevel === 'CRITICAL');
  if (!identityKey) throw new Error('This identity has no CRITICAL authentication key.');

  const signer = new IdentitySigner();
  signer.addKeyFromWif(wif);

  await sdk.dpns.registerName({ label: clean, identity, identityKey, signer });
  return { name: `${clean}.dash`, identityId };
}
