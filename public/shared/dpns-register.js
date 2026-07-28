// Registering a .dash name in a way that survives being interrupted.
//
// DPNS registration is two state transitions: a preorder carrying a salted hash
// of the name, then the domain document carrying the name and that same salt.
// The SDK's own `dpns.registerName` invents the salt internally and never hands
// it over, so a failure between the two steps strands the preorder forever — the
// salt is the only thing that ties it to your name. That costs a fee for an
// ordinary name and 0.2 DASH for a contested one, since the prefunded voting
// balance is attached to the preorder.
//
// So the salt is derived here instead of drawn at random: same key, same name,
// same salt, every time. An interrupted registration is finished by simply
// running it again — the preorder that was already paid for is picked back up.
// Verified on testnet 2026-07-25: preorder (23,470,440 credits), process gone,
// then the domain in a fresh run (33,715,900) — together exactly what an
// uninterrupted registration costs.
//
// The salt becomes public in the domain document, so it must not give away the
// key it came from. HMAC-SHA256 is a pseudorandom function: input/output pairs
// say nothing about the secret. The signing key is never used directly either —
// a dedicated secret is derived from it first, so the two uses stay separate.

export const DPNS_CONTRACT = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';
const SALT_DOMAIN = 'evotools/dpns-salt/v1';

const enc = new TextEncoder();
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const doubleSha256 = async (bytes) => sha256(await sha256(bytes));

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

// One secret for salts, derived once from the signing key and used for nothing
// else. `attempt` only moves when you deliberately want a fresh preorder.
export async function deriveSaltAndEntropy({ privateKeyBytes, network, normalizedLabel, attempt = 0 }) {
  const secret = await hmac(privateKeyBytes, SALT_DOMAIN);
  const suffix = `${network}/${normalizedLabel}/${attempt}`;
  return {
    salt: await hmac(secret, suffix),
    entropy: await hmac(secret, `entropy/${suffix}`),
  };
}

// What the preorder commits to: doubleSHA256(salt ++ "name.dash").
export async function saltedDomainHash(salt, normalizedLabel) {
  const name = enc.encode(`${normalizedLabel}.dash`);
  const buf = new Uint8Array(salt.length + name.length);
  buf.set(salt);
  buf.set(name, salt.length);
  return doubleSha256(buf);
}

// The SDK verifies its own proof after a write and sometimes reports a mismatch
// for a document that was in fact created (dashpay/platform#3095). Treat it as
// "probably landed" and let the caller confirm by resolving the name.
const isProofGlitch = (err) => /did not contain expected document|incorrect proof/i.test(String(err?.message || err));

// A node can report a failure for a transition it has in fact accepted — the
// next attempt then meets its own submission sitting in the mempool. That is
// the preorder existing, not a problem.
const isAlreadySubmitted = (err) => /already exists in cache|already in mempool|already exists/i.test(String(err?.message || err));

// The network refuses a second domain document for a name that is already in a
// contest. The wording blames reused entropy, which is exactly what a rerun with
// the derived salt does on purpose — so this means the earlier claim is standing,
// not that anything went wrong.
const isAlreadyInContest = (err) => /already present in a contest/i.test(String(err?.message || err));

// Contested names are not handed over on submission: the domain document joins a
// masternode vote poll that runs for two weeks, and the name stays unresolvable
// until that ends. Resolving the name therefore proves nothing here; being among
// the contenders does.
const CONTEST_DAYS = 14;

export async function contestState({ sdk, normalizedLabel }) {
  const state = await sdk.voting.contestedResourceVoteState({
    dataContractId: DPNS_CONTRACT,
    documentTypeName: 'domain',
    indexName: 'parentNameAndLabel',
    indexValues: ['dash', normalizedLabel],
    resultType: 'documentsAndVoteTally',
    allowIncludeLockedAndAbstainingVoteTally: true,
  });
  const winner = state.winner; // only set once the vote has ended
  return {
    contenders: (state.contenders || []).map((c) => c.identityId?.toString?.()).filter(Boolean),
    votes: (state.contenders || []).map((c) => Number(c.voteTally ?? 0)),
    abstain: Number(state.abstainVoteTally ?? 0),
    lock: Number(state.lockVoteTally ?? 0),
    outcome: winner ? winner.kind : undefined,
    winner: winner?.identityId?.toString?.(),
  };
}

// Index values in a vote poll are `[0x12, length, ...ascii]`.
function decodeIndexValue(raw) {
  const bytes = Array.from(raw ?? []);
  if (bytes.length < 2 || bytes[1] !== bytes.length - 2) return undefined;
  return String.fromCharCode(...bytes.slice(2));
}

// When the vote ends. The vote state does not carry it, so it comes from the open
// polls. `startTimeMs` is rejected there (the SDK wants an f64 and a whole number
// of milliseconds arrives as an integer), so the handful of open polls are
// fetched whole and filtered here. Undefined when the poll cannot be found.
export async function contestEndsAt({ sdk, normalizedLabel }) {
  const entries = await sdk.voting.votePollsByEndDate().catch(() => []);
  for (const entry of entries) {
    for (const poll of entry.votePolls || []) {
      const values = (poll?.indexValues ?? []).map(decodeIndexValue);
      if (values[0] === 'dash' && values[1] === normalizedLabel) {
        return new Date(Number(entry.timestampMs));
      }
    }
  }
  return undefined;
}

function buildDocument({ Evo, typeName, ownerId, properties, entropy }) {
  // The document id is derived from the entropy, so it has to be supplied at
  // construction — setting it afterwards leaves a stale id the network rejects.
  return new Evo.Document({
    dataContractId: DPNS_CONTRACT,
    documentTypeName: typeName,
    ownerId,
    properties,
    entropy,
  });
}

// Register `label` for an identity. Safe to call again after any failure: the
// preorder is only paid for once.
export async function registerName({
  sdk, Evo, label, identity, identityKey, signer, privateKeyBytes, network,
  attempt = 0, onProgress = () => {},
}) {
  const clean = label.replace(/\.dash$/i, '').trim().toLowerCase();
  const normalizedLabel = await sdk.dpns.convertToHomographSafe(clean);
  const ownerId = identity.id.toString();
  const { salt, entropy } = await deriveSaltAndEntropy({ privateKeyBytes, network, normalizedLabel, attempt });
  const hash = await saltedDomainHash(salt, normalizedLabel);

  // Already done? Then this is a retry of something that finished.
  const existing = await sdk.dpns.resolveName(clean).catch(() => undefined);
  if (existing) {
    onProgress({ step: 'done', already: true });
    return { name: `${clean}.dash`, identityId: ownerId, alreadyRegistered: true };
  }

  const contested = await sdk.dpns.isContestedUsername(clean).catch(() => false);

  // A contested claim of our own that is still waiting for the vote looks exactly
  // like an unregistered name. Standing among the contenders means the work is
  // done — rebuilding the same documents is what gets refused for reused entropy.
  if (contested) {
    const state = await contestState({ sdk, normalizedLabel }).catch(() => undefined);
    // Never spend the 0.2 DASH voting fee on a name the masternodes already
    // locked: that contest has no owner and cannot be reopened.
    if (state?.outcome === 'Locked') {
      throw new Error(`${clean}.dash is locked by masternode vote — it cannot be registered.`);
    }
    const pending = await contestPending({ sdk, clean, normalizedLabel, ownerId, state });
    if (pending) {
      onProgress({ step: 'done', contestPending: true });
      return pending;
    }
  }

  const preorder = buildDocument({ Evo, typeName: 'preorder', ownerId, entropy, properties: { saltedDomainHash: hash } });
  const preorderId = preorder.id.toString();
  const paid = await sdk.documents.get(DPNS_CONTRACT, 'preorder', preorderId).catch(() => undefined);

  if (paid) {
    onProgress({ step: 'preorder', reused: true, preorderId });
  } else {
    onProgress({ step: 'preorder', preorderId });
    try {
      await sdk.documents.create({ document: preorder, identityKey, signer });
    } catch (e) {
      if (!isProofGlitch(e) && !isAlreadySubmitted(e)) throw e;
      if (isAlreadySubmitted(e)) onProgress({ step: 'preorder', reused: true, preorderId });
    }
  }

  onProgress({ step: 'domain' });
  const domain = buildDocument({
    Evo,
    typeName: 'domain',
    ownerId,
    entropy,
    properties: {
      label: clean,
      normalizedLabel,
      parentDomainName: 'dash',
      normalizedParentDomainName: 'dash',
      preorderSalt: salt,
      records: { identity: identity.id.toBytes() }, // the schema wants 32 bytes, not base58
      subdomainRules: { allowSubdomains: false },
    },
  });
  try {
    await sdk.documents.create({ document: domain, identityKey, signer });
  } catch (e) {
    if (!isProofGlitch(e) && !isAlreadySubmitted(e) && !isAlreadyInContest(e)) throw e;
  }

  const owner = await sdk.dpns.resolveName(clean).catch(() => undefined);
  if (owner) {
    onProgress({ step: 'done' });
    return { name: `${clean}.dash`, identityId: owner.toString(), preorderId };
  }

  // Not resolvable is the normal outcome for a contested name: the claim is in,
  // the masternodes have two weeks to vote on it.
  if (contested) {
    const pending = await contestPending({ sdk, clean, normalizedLabel, ownerId, preorderId });
    if (pending) {
      onProgress({ step: 'done', contestPending: true });
      return pending;
    }
  }

  throw new Error(`${clean}.dash did not register. Running this again picks up the preorder that was already paid for.`);
}

// The result for a contested claim that is waiting on the vote — undefined when
// this identity is not (yet) a contender, or when the vote has already ended,
// because then "not resolvable" really is a failure.
async function contestPending({ sdk, clean, normalizedLabel, ownerId, preorderId, state: known }) {
  const state = known ?? (await contestState({ sdk, normalizedLabel }).catch(() => undefined));
  if (state?.outcome) return undefined;
  if (!state?.contenders?.includes(ownerId)) return undefined;
  const endsAt = await contestEndsAt({ sdk, normalizedLabel }).catch(() => undefined);
  return {
    name: `${clean}.dash`,
    identityId: ownerId,
    preorderId,
    contestPending: true,
    contest: {
      contenders: state.contenders.length,
      endsAt: endsAt ?? new Date(Date.now() + CONTEST_DAYS * 86400000),
      endsAtExact: !!endsAt,
      lock: state.lock,
      abstain: state.abstain,
    },
  };
}
