// DPNS operations for dash-name: check availability + contest state, and claim a
// name for an existing identity (reuses onboard's registration + explorer's
// contest query).
import { getSdk, loadEvo, getNetwork } from './sdk.js';
import {
  registerName as registerNameResumable, contestState, contestEndsAt,
} from '../../shared/dpns-register.js';

// Document state transitions may be signed by an AUTHENTICATION key at CRITICAL,
// HIGH or MEDIUM level. A MASTER key cannot sign documents, and a TRANSFER key
// has the wrong purpose — same rule Dash Evo Tool applies for DPNS.
const DOC_SIGNING_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM'];

const str = (x) => (typeof x === 'string' ? x : x?.toString?.());
// DPNS system contract — identical on testnet and mainnet.
export const DPNS_CONTRACT = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';

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
  // A contest that ended in a lock has no owner, so isNameAvailable() still says
  // true — but nobody can ever claim it. Lock state overrides availability.
  const locked = contest?.outcome === 'Locked';

  return {
    label: clean,
    valid: true,
    registered,
    ownerId: registered ? str(owner) : undefined,
    available: locked ? false : available,
    locked,
    contested,
    contest,
  };
}

async function getContest(label) {
  const sdk = await getSdk();
  const norm = await sdk.dpns.convertToHomographSafe(label);
  // `outcome` is only set once the contest has ended: 'Locked' (nobody gets the
  // name) or 'WonByIdentity'. Until then the claims stand and the name does not
  // resolve, which is why an open contest needs saying out loud — it reads as
  // "available" everywhere else.
  const state = await contestState({ sdk, normalizedLabel: norm });
  const pending = !state.outcome && state.contenders.length > 0;
  const endsAt = pending ? await contestEndsAt({ sdk, normalizedLabel: norm }).catch(() => undefined) : undefined;
  return {
    contenders: state.contenders.map((identityId, i) => ({ identityId, votes: state.votes[i] ?? 0 })),
    abstain: state.abstain,
    lock: state.lock,
    outcome: state.outcome,
    winner: state.winner,
    pending,
    endsAt,
  };
}

// Claim a name for an existing identity, signed with whichever authentication key
// the supplied WIF belongs to.
export async function registerName(label, identityId, wif) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { IdentitySigner, PrivateKey } = Evo;
  const clean = label.replace(/\.dash$/i, '').trim().toLowerCase();

  // Never spend the 0.2 DASH contested-name fee on a name masternodes already locked.
  if (await sdk.dpns.isContestedUsername(clean).catch(() => false)) {
    const contest = await getContest(clean).catch(() => undefined);
    if (contest?.outcome === 'Locked') {
      throw new Error(`${clean}.dash is locked by masternode vote — it cannot be registered.`);
    }
  }

  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`Identity not found on this network: ${identityId}`);

  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  const usable = keys.filter(
    (k) => k.purpose === 'AUTHENTICATION' && DOC_SIGNING_LEVELS.includes(k.securityLevel) && !k.disabledAt,
  );
  if (!usable.length) {
    throw new Error('This identity has no authentication key that can sign documents (needs CRITICAL, HIGH or MEDIUM — a MASTER key cannot).');
  }

  // Match the pasted key against the identity's keys instead of assuming one, so
  // it works whichever of the usable keys you happen to hold.
  let privateKeyBytes;
  try { privateKeyBytes = PrivateKey.fromWIF(wif).toBytes(); }
  catch { throw new Error('That private key is not a valid WIF.'); }
  const net = getNetwork();
  const identityKey = usable.find((k) => {
    try { return k.validatePrivateKey(privateKeyBytes, net); } catch { return false; }
  });
  if (!identityKey) {
    const list = usable.map((k) => `#${k.keyId} ${k.securityLevel}`).join(', ');
    throw new Error(`That key does not match any signing key on this identity (${list}).`);
  }

  const signer = new IdentitySigner();
  signer.addKeyFromWif(wif);

  // The resumable path rather than sdk.dpns.registerName: that one invents the
  // salt internally, so a failure between the preorder and the domain document
  // strands the preorder and its fee — 0.2 DASH for a contested name.
  return registerNameResumable({
    sdk, Evo, label: clean, identity, identityKey, signer,
    privateKeyBytes,
    network: getNetwork(),
  });
}

// Move credits from a platform address into this identity. Registering names
// eats credits faster than people expect, and an identity that runs dry mid-way
// is a dead end without this.
export async function topUpIdentity({ identityId, addressWif, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { PlatformAddressSigner, PrivateKey } = Evo;

  let key;
  try { key = PrivateKey.fromWIF(addressWif); }
  catch { throw new Error('That is not a valid WIF private key.'); }
  const address = new PlatformAddressSigner().addKey(key).toBech32m(getNetwork());

  const info = await sdk.addresses.get(address);
  const available = info?.balance ?? 0n;
  if (available <= 0n) throw new Error(`That key's platform address (${address}) holds no credits.`);
  // Leave a little behind for the transition fee, which comes off the address.
  const margin = 10_000_000n;
  const send = amount ?? (available > margin ? available - margin : 0n);
  if (send <= 0n) throw new Error(`Only ${available} credits there — not enough to move.`);
  if (send > available) throw new Error(`That address holds ${available} credits, less than you asked to move.`);

  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`Identity not found on this network: ${identityId}`);

  const signer = new PlatformAddressSigner();
  signer.addKey(key);
  const result = await sdk.addresses.topUpIdentity({
    identity,
    inputs: [{ address, amount: send }],
    signer,
  });
  return { address, moved: send, newBalance: result?.newBalance };
}
