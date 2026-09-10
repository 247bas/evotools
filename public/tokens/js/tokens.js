// Tokens on Dash Platform: making one, minting it, sending it, and seeing who
// has it.
//
// A token is not a document and not a contract of its own. It is a
// configuration attached to a data contract at a position, so making a token
// means publishing a contract, and the token's ID is derived from the contract
// ID and that position. One contract can carry several.
//
// Everything here is signed in the browser with a key you paste per action, the
// same way /credits does it. Which key matters more than it looks: see
// requireKey below.

import { getSdk, loadEvo, getNetwork } from './sdk.js';
import { tokensOfIdentity, setApiNetwork, apiHost } from './api.js';
import { looksLikeSecret } from '../../shared/secrets.js';
import { tokenHolders, nameHolders, formatAmount } from '../../shared/token-holders.js';

export { tokenHolders, nameHolders, formatAmount, apiHost };

const str = (v) => (v == null ? '' : String(v));

/* ------------------------------------------------------------------ *
 * Identity and keys
 * ------------------------------------------------------------------ */

export async function lookupIdentity(idOrName) {
  // A WIF is a valid DPNS label, so an unguarded lookup would carry a pasted
  // key to a node as a name. This box only wants public identifiers.
  if (looksLikeSecret(idOrName)) {
    throw new Error('That looks like a private key or a recovery phrase, not an identity ID or a name. Nothing was sent. Paste the identity ID or its .dash name — the key fields sit inside the actions below.');
  }
  const sdk = await getSdk();
  const input = (idOrName || '').trim();
  if (!input) throw new Error('Give an identity ID or a .dash name.');

  let identityId = input;
  let name;
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(input)) {
    const clean = input.replace(/\.dash$/i, '').toLowerCase();
    const owner = await sdk.dpns.resolveName(clean);
    if (!owner) throw new Error(`No identity found for "${input}".`);
    identityId = str(owner);
    name = `${clean}.dash`;
  }
  const identity = await sdk.identities.fetch(identityId);
  if (!identity) throw new Error(`Identity not found on this network: ${identityId}`);
  if (!name) { try { name = await sdk.dpns.username(identityId); } catch { /* no name */ } }

  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  return {
    identityId,
    name,
    balance: identity.balance ?? 0n,
    keys: keys.map((k) => ({ keyId: k.keyId, purpose: k.purpose, securityLevel: k.securityLevel, disabled: Boolean(k.disabledAt) })),
    // Everything on this page needs this one key, so say up front whether it exists.
    signingKeys: keys
      .filter((k) => k.purpose === 'AUTHENTICATION' && k.securityLevel === 'CRITICAL' && !k.disabledAt)
      .map((k) => k.keyId),
  };
}

// Publishing a contract and every token transition need the same thing: an
// AUTHENTICATION key at CRITICAL. Not HIGH — testnet refuses that outright with
// "Invalid public key security level HIGH. The state transition requires one of
// CRITICAL", which is worth knowing because document transitions do accept HIGH
// and the two read as the same kind of operation. And not the TRANSFER key,
// which is also CRITICAL and moves credits and nothing else: purpose and
// security level are separate things.
async function requireKey(identityId, wif) {
  const { PrivateKey, IdentitySigner } = await loadEvo();
  const sdk = await getSdk();

  if (!wif || !wif.trim()) throw new Error('Paste the key that should sign this.');

  let privateKeyBytes;
  try { privateKeyBytes = PrivateKey.fromWIF(wif.trim()).toBytes(); }
  catch { throw new Error('That is not a valid WIF private key.'); }

  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  const net = getNetwork();
  const matched = keys.find((k) => {
    try { return k.validatePrivateKey(privateKeyBytes, net); } catch { return false; }
  });

  if (!matched) throw new Error('That key does not belong to this identity.');
  if (matched.disabledAt) throw new Error(`Key #${matched.keyId} is disabled and cannot sign.`);
  if (matched.purpose !== 'AUTHENTICATION' || matched.securityLevel !== 'CRITICAL') {
    const critical = keys.filter((k) => k.purpose === 'AUTHENTICATION' && k.securityLevel === 'CRITICAL' && !k.disabledAt);
    throw new Error(
      `That is key #${matched.keyId}, ${matched.purpose}/${matched.securityLevel}. Tokens need an AUTHENTICATION key at CRITICAL — `
      + (critical.length
        ? `on this identity that is key #${critical.map((k) => k.keyId).join(' or #')}.`
        : 'this identity has none, so it cannot make or move tokens.'),
    );
  }

  const identity = await sdk.identities.fetch(identityId);
  const identityKey = identity.getPublicKeyById(matched.keyId);
  const signer = new IdentitySigner();
  signer.addKeyFromWif(wif.trim());
  return { identity, identityKey, signer, keyId: matched.keyId };
}

/* ------------------------------------------------------------------ *
 * Amounts
 * ------------------------------------------------------------------ */

export function toBaseUnits(input, decimals) {
  const s = String(input ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('The amount has to be a positive number.');
  const [whole, frac = ''] = s.split('.');
  const d = Number(decimals);
  if (frac.length > d) {
    throw new Error(d === 0
      ? 'This token has no decimals, so whole numbers only.'
      : `This token has ${d} decimals, so no more than ${d} after the point.`);
  }
  const amount = BigInt(whole + frac.padEnd(d, '0'));
  if (amount === 0n) throw new Error('Nothing to move — the amount is zero.');
  return amount;
}

/* ------------------------------------------------------------------ *
 * Reading a token
 * ------------------------------------------------------------------ */

// The SDK renders this two ways depending on version — a bare "NoOne" in v4.0
// and a tagged { $type: "noOne" } later — so both are folded to one lowercase
// word rather than picking one and breaking on the other.
const ruleType = (rule) => {
  const v = rule?.authorizedToMakeChange;
  return String(typeof v === 'string' ? v : (v?.$type ?? '')).toLowerCase();
};

export async function tokenInfo(contractId, position = 0, holderId) {
  if (looksLikeSecret(contractId)) {
    throw new Error('That looks like a key, not a contract ID. Nothing was sent.');
  }
  const sdk = await getSdk();
  const wanted = String(contractId || '').trim();
  if (!wanted) throw new Error('Give a contract ID.');
  // A malformed ID comes back from the SDK as "byte length not 32 bytes", which
  // reads like an internal failure rather than a typo in the box.
  let contract;
  try { contract = await sdk.contracts.fetch(wanted); }
  catch { throw new Error('No contract with that ID — it is not a valid contract ID.'); }
  if (!contract) throw new Error('No contract with that ID on this network.');

  const json = contract.toJSON();
  const pos = Number(position);
  const cfg = json.tokens?.[String(pos)];
  if (!cfg) {
    const has = Object.keys(json.tokens ?? {});
    throw new Error(has.length
      ? `This contract has no token at position ${pos}. It has ${has.length} at position ${has.join(', ')}.`
      : 'This contract carries no tokens at all.');
  }

  const tokenId = await sdk.tokens.calculateId(json.id, pos);
  const loc = cfg.conventions?.localizations?.en ?? {};
  const ownerId = str(json.ownerId);

  let balance = 0n;
  if (holderId) {
    const balances = await sdk.tokens.identityBalances(holderId, [tokenId]);
    balance = balances.get(tokenId) ?? 0n;
  }

  const mintRule = ruleType(cfg.manualMintingRules);
  return {
    tokenId,
    contractId: str(json.id),
    position: pos,
    ownerId,
    name: loc.singularForm ?? 'token',
    plural: loc.pluralForm ?? '',
    decimals: cfg.conventions?.decimals ?? 0,
    baseSupply: cfg.baseSupply,
    maxSupply: cfg.maxSupply ?? null,
    description: cfg.description ?? '',
    balance,
    // What this identity may do, decided by the contract rather than by trying.
    canMint: mintRule === 'noone' ? false : mintRule !== 'contractowner' || ownerId === holderId,
    mintBlockedBy: mintRule === 'noone'
      ? 'This token was published with minting off, permanently. Its supply cannot grow.'
      : (mintRule === 'contractowner' && ownerId !== holderId
        ? 'Only the identity that published this contract can mint it.'
        : ''),
    canBurn: ruleType(cfg.manualBurningRules) !== 'noone',
  };
}

/* ------------------------------------------------------------------ *
 * Making a token
 * ------------------------------------------------------------------ */

// A contract needs at least one document type to get past the constructor, even
// when it carries a token — the tokens are not counted by that check. So it is
// built with a throwaway type and read back without it; `fromJSON` accepts what
// the constructor would not. The contract ID comes from owner and nonce, so it
// survives the round trip unchanged.
const PLACEHOLDER_SCHEMA = {
  placeholder: {
    type: 'object',
    properties: { n: { type: 'integer', position: 0, minimum: 0 } },
    additionalProperties: false,
  },
};

export async function buildTokenContract(Evo, form, ownerId, identityNonce) {
  const {
    DataContract, TokenConfiguration, TokenConfigurationConvention, TokenConfigurationLocalization,
    ChangeControlRules, AuthorizedActionTakers, TokenDistributionRules, TokenKeepsHistoryRules,
    TokenMarketplaceRules, TokenTradeMode,
  } = Evo;

  // A fresh rules object per field. wasm-bindgen takes ownership of what you
  // hand it, so one instance used twice is a use-after-free waiting to happen.
  const byOwner = () => new ChangeControlRules({
    authorizedToMakeChange: AuthorizedActionTakers.ContractOwner(),
    adminActionTakers: AuthorizedActionTakers.ContractOwner(),
    isChangingAuthorizedActionTakersToNoOneAllowed: true,
    isChangingAdminActionTakersToNoOneAllowed: true,
    isSelfChangingAdminActionTakersAllowed: true,
  });
  const locked = () => new ChangeControlRules({
    authorizedToMakeChange: AuthorizedActionTakers.NoOne(),
    adminActionTakers: AuthorizedActionTakers.NoOne(),
  });

  const name = (form.name || '').trim();
  if (!name) throw new Error('Give the token a name.');
  const decimals = Number(form.decimals ?? 0);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 16) {
    throw new Error('Decimals has to be a whole number from 0 to 16.');
  }

  const baseSupply = toBaseUnits(form.baseSupply, decimals);
  const maxSupply = form.maxSupply ? toBaseUnits(form.maxSupply, decimals) : undefined;
  if (maxSupply !== undefined && maxSupply < baseSupply) {
    throw new Error('The maximum supply cannot be below the starting supply.');
  }
  // With minting off nothing can ever be added, so the starting supply already
  // is the ceiling. Writing that in means a reader sees the supply is fixed
  // without having to work it out from the rules.
  const ceiling = maxSupply ?? (form.mintable ? undefined : baseSupply);

  const config = new TokenConfiguration({
    conventions: new TokenConfigurationConvention(
      { en: new TokenConfigurationLocalization(false, name, (form.plural || '').trim() || name) },
      decimals,
    ),
    conventionsChangeRules: byOwner(),

    baseSupply,
    maxSupply: ceiling,
    maxSupplyChangeRules: form.mintable ? byOwner() : locked(),

    // History is what makes the holder list possible at all. On by default,
    // and there is no reason to offer turning it off.
    keepsHistory: new TokenKeepsHistoryRules({
      isKeepingTransferHistory: true,
      isKeepingBurningHistory: true,
      isKeepingMintingHistory: true,
    }),

    distributionRules: new TokenDistributionRules({
      newTokensDestinationIdentity: ownerId,
      newTokensDestinationIdentityRules: byOwner(),
      mintingAllowChoosingDestination: true,
      mintingAllowChoosingDestinationRules: byOwner(),
      perpetualDistributionRules: locked(),
      changeDirectPurchasePricingRules: byOwner(),
    }),

    marketplaceRules: new TokenMarketplaceRules(TokenTradeMode.NotTradeable(), byOwner()),

    manualMintingRules: form.mintable ? byOwner() : locked(),
    manualBurningRules: form.burnable ? byOwner() : locked(),

    // Freezing a balance and destroying a frozen one are the two powers that
    // make a token not really its holder's. Off unless asked for, and
    // destroying stays off either way.
    freezeRules: form.freezable ? byOwner() : locked(),
    unfreezeRules: form.freezable ? byOwner() : locked(),
    destroyFrozenFundsRules: locked(),
    emergencyActionRules: locked(),
    mainControlGroupCanBeModified: AuthorizedActionTakers.NoOne(),

    description: (form.description || '').trim() || undefined,
  });

  const seeded = new DataContract({
    ownerId,
    identityNonce,
    schemas: PLACEHOLDER_SCHEMA,
    tokens: { 0: config },
  });
  const json = seeded.toJSON();
  json.documentSchemas = {};
  return DataContract.fromJSON(json, true);
}

export async function createToken({ identityId, wif, ...form }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  // The key first: a wrong one should come back before a round trip, not after.
  const { identityKey, signer, keyId } = await requireKey(identityId, wif);

  const nonce = (await sdk.identities.nonce(identityId)) ?? 0n;
  const dataContract = await buildTokenContract(Evo, form, identityId, nonce + 1n);
  const published = await sdk.contracts.publish({ dataContract, identityKey, signer });

  const contractId = str(published.id);
  return { contractId, position: 0, tokenId: await sdk.tokens.calculateId(contractId, 0), keyId };
}

/* ------------------------------------------------------------------ *
 * Moving a token
 * ------------------------------------------------------------------ */

async function resolveRecipient(input) {
  const raw = (input || '').trim();
  if (!raw) throw new Error('Give a recipient.');
  if (looksLikeSecret(raw)) {
    throw new Error('That looks like a key, not a recipient. Nothing was sent.');
  }
  const clean = raw.replace(/\.dash$/i, '');
  if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(clean)) return clean;
  const sdk = await getSdk();
  const owner = await sdk.dpns.resolveName(clean.toLowerCase());
  if (!owner) throw new Error(`Nobody owns the name "${raw}".`);
  return str(owner);
}

export async function mintToken({ identityId, wif, contractId, position = 0, amount, recipient }) {
  const sdk = await getSdk();
  const info = await tokenInfo(contractId, position, identityId);
  if (!info.canMint) throw new Error(info.mintBlockedBy);

  const { identityKey, signer, keyId } = await requireKey(identityId, wif);
  const recipientId = recipient ? await resolveRecipient(recipient) : undefined;

  await sdk.tokens.mint({
    dataContractId: info.contractId,
    tokenPosition: info.position,
    amount: toBaseUnits(amount, info.decimals),
    identityId,
    recipientId,
    identityKey,
    signer,
  });
  return { keyId, recipientId: recipientId ?? identityId, tokenId: info.tokenId };
}

export async function sendToken({ identityId, wif, contractId, position = 0, amount, recipient, note }) {
  const sdk = await getSdk();
  const info = await tokenInfo(contractId, position, identityId);

  const recipientId = await resolveRecipient(recipient);
  if (recipientId === identityId) {
    throw new Error(`"${(recipient || '').trim()}" is this identity itself, so this would send the tokens to their own holder.`);
  }

  const value = toBaseUnits(amount, info.decimals);
  if (value > info.balance) {
    throw new Error(`This identity holds ${formatAmount(info.balance, info.decimals)} ${info.name}, which is less than that.`);
  }

  const { identityKey, signer, keyId } = await requireKey(identityId, wif);
  await sdk.tokens.transfer({
    dataContractId: info.contractId,
    tokenPosition: info.position,
    amount: value,
    senderId: identityId,
    recipientId,
    publicNote: (note || '').trim() || undefined,
    identityKey,
    signer,
  });
  return { keyId, recipientId, tokenId: info.tokenId, sent: value, decimals: info.decimals };
}

/* ------------------------------------------------------------------ *
 * What an identity holds
 * ------------------------------------------------------------------ */

/**
 * Every token this identity has, with the balance read from the chain.
 *
 * Which tokens exist comes from the indexer, because Platform cannot list them.
 * The numbers do not: one `identityBalances` call covers the whole list, so the
 * indexer is only ever trusted to name things, never to say how much.
 */
export async function tokensHeldBy(identityId) {
  setApiNetwork(getNetwork());
  const found = await tokensOfIdentity(identityId);
  if (!found.length) return [];

  const sdk = await getSdk();
  const balances = await sdk.tokens.identityBalances(identityId, found.map((t) => t.tokenId));

  return found
    .map((t) => ({ ...t, balance: balances.get(t.tokenId) ?? 0n }))
    // A token the indexer still lists but that has since been sent away in full
    // would otherwise sit in the list at zero and read like a bug.
    .filter((t) => t.balance > 0n)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/* ------------------------------------------------------------------ *
 * Holders
 * ------------------------------------------------------------------ */

export async function holdersOf(contractId, position = 0, onProgress) {
  const sdk = await getSdk();
  const result = await tokenHolders(sdk, { contractId, position }, onProgress);
  await nameHolders(sdk, result.holders);
  return result;
}
