// Who holds a token, worked out from its history.
//
// Platform cannot answer this directly. Balances live in a tree keyed by
// identity and nothing walks that tree: `system.pathElements` wants the keys
// you are trying to discover, and there is no "list holders" call.
//
// The way in is the token history. A token published with history on writes a
// document for every mint, transfer, burn and purchase into one system
// contract, and tokens cannot move any other way — so every identity that ever
// touched the token is named in there. Collect those, add the contract owner
// (the base supply lands there at publish time and no document records it),
// then read what each one holds now and drop the zeros.
//
// Two limits worth stating rather than hiding:
//   - a token published without history leaves no trail, and then this cannot
//     work at all. The caller gets `complete: false` and should say so.
//   - the balances are read now, the events are the whole past. That is the
//     point, but it means the list is a snapshot and the total is what is held,
//     not what was ever issued.
//
// The sdk is passed in rather than imported, so each tool keeps its own
// network-aware instance.

// Same ID on testnet and mainnet, checked against both. It is not a string
// anywhere in the SDK bundle — the system contracts sit next to each other as
// raw bytes, and this one was found by locating the DPNS contract's bytes and
// testing its neighbours against the network.
export const TOKEN_HISTORY_CONTRACT = '43gujrzZgXqcKBiScLa4T8XTDnRhenR9BLx8GWVHjPxF';

// Per history document type, the fields that name somebody. `$ownerId` is
// whoever signed the transition; the rest are the other side of it.
const PARTICIPANTS = {
  transfer: ['$ownerId', 'toIdentityId'],
  mint: ['$ownerId', 'recipientId'],
  burn: ['$ownerId', 'burnFromId'],
  directPurchase: ['$ownerId'],
  claim: ['$ownerId', 'recipientId'],
  freeze: ['frozenIdentityId'],
  unfreeze: ['frozenIdentityId'],
  destroyFrozenFunds: ['frozenIdentityId'],
};

const PAGE = 100;
const str = (v) => (v == null ? '' : String(v));

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const isBase58Id = (s) => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(s);

function toBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}`; }
  return out;
}

// A document's own identifier fields do not come back in one encoding. In the
// SDK vendored here, `$ownerId` renders as base58 while a contract-defined
// field like `toIdentityId` renders as base64 — and both are 44 characters, so
// the length says nothing. Reading `toObject()` instead gives raw bytes for
// every identifier, which is the one shape that does not move between versions.
// The string branches are there for the versions that do hand back a string.
function asIdentityId(value) {
  if (value instanceof Uint8Array) return value.length === 32 ? toBase58(value) : '';
  const s = str(value);
  if (!s) return '';
  if (isBase58Id(s)) return s;
  try {
    const bin = atob(s);
    if (bin.length !== 32) return '';
    return toBase58(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return ''; }
}

// A token keeps history if any one of the flags is on. Transfer history alone
// is enough to find everyone: tokens can only reach a new holder by moving.
const keepsHistory = (cfg) =>
  Boolean(cfg?.keepsHistory && Object.values(cfg.keepsHistory).some((v) => v === true));

// Accepts either a token ID or a contract ID with a position, because the
// explorer searches by token ID and the tokens tool works from a contract.
async function resolveToken(sdk, { tokenId, contractId, position }) {
  if (tokenId && !contractId) {
    const info = await sdk.tokens.contractInfo(tokenId);
    if (!info) throw new Error('No token with that ID on this network.');
    return {
      tokenId: str(tokenId),
      contractId: str(info.contractId),
      position: info.tokenContractPosition,
    };
  }
  if (!contractId) throw new Error('Give a token ID, or a contract ID and a position.');
  const pos = Number(position ?? 0);
  return {
    tokenId: tokenId ? str(tokenId) : await sdk.tokens.calculateId(contractId, pos),
    contractId: str(contractId),
    position: pos,
  };
}

/**
 * Everyone holding a token now, largest first.
 *
 * @param sdk        a connected EvoSDK
 * @param target     { tokenId } or { contractId, position }
 * @param onProgress optional (documentType, eventsSoFar) => void
 */
export async function tokenHolders(sdk, target, onProgress) {
  const { tokenId, contractId, position } = await resolveToken(sdk, target);

  const contract = await sdk.contracts.fetch(contractId);
  if (!contract) throw new Error(`Contract not found on this network: ${contractId}`);
  const json = contract.toJSON();
  const cfg = json.tokens?.[String(position)];
  if (!cfg) throw new Error(`This contract has no token at position ${position}.`);

  const candidates = new Set();
  // The base supply is created at publish time and goes to the contract owner.
  // No history document records that, so without this line the issuer — usually
  // the largest holder by far — is missing from the list.
  if (json.ownerId) candidates.add(str(json.ownerId));

  let events = 0;
  for (const [documentTypeName, fields] of Object.entries(PARTICIPANTS)) {
    let startAfter;
    for (;;) {
      onProgress?.(documentTypeName, events);
      // A token that never had, say, a freeze simply has no documents of that
      // type; an empty page ends this type and moves on to the next.
      const page = await sdk.documents
        .query({
          dataContractId: TOKEN_HISTORY_CONTRACT,
          documentTypeName,
          where: [['tokenId', '==', tokenId]],
          orderBy: [['$createdAt', 'asc']],
          limit: PAGE,
          startAfter,
        })
        .catch(() => new Map());

      if (!page.size) break;
      let last;
      for (const [docId, doc] of page) {
        last = docId;
        const d = doc?.toObject?.() ?? {};
        for (const field of fields) {
          const id = asIdentityId(d[field]);
          if (id) candidates.add(id);
        }
        events++;
      }
      if (page.size < PAGE) break;
      startAfter = last;
    }
  }

  // Balances in batches: a holder set can outgrow a single request.
  const ids = [...candidates];
  const holders = [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const balances = await sdk.tokens.balances(batch, tokenId);
    for (const id of batch) {
      const balance = balances.get(id) ?? 0n;
      if (balance > 0n) holders.push({ identityId: id, balance });
    }
  }
  holders.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));

  const loc = cfg?.conventions?.localizations?.en ?? {};
  return {
    tokenId,
    contractId,
    position,
    ownerId: json.ownerId ? str(json.ownerId) : '',
    name: loc.singularForm ?? '',
    plural: loc.pluralForm ?? '',
    decimals: cfg?.conventions?.decimals ?? 0,
    holders,
    events,
    held: holders.reduce((sum, h) => sum + h.balance, 0n),
    complete: keepsHistory(cfg),
  };
}

/**
 * `.dash` names for a list of holders, filled in place. One lookup each, so it
 * is capped and separate from the balances — a holder list is useful without
 * names, and a long one should not sit waiting on a hundred round trips.
 */
export async function nameHolders(sdk, holders, limit = 50) {
  for (const holder of holders.slice(0, limit)) {
    const names = await sdk.dpns.usernames({ identityId: holder.identityId }).catch(() => []);
    // The SDK has returned these both with and without the suffix across
    // versions. Normalise here so callers can print them as they come.
    holder.names = names.map((n) => (String(n).endsWith('.dash') ? String(n) : `${n}.dash`));
  }
  return holders;
}

// Whole units from base units: a token with 8 decimals stores 1.5 as 150000000.
export function formatAmount(amount, decimals) {
  const s = String(amount).padStart(Number(decimals) + 1, '0');
  if (!Number(decimals)) return s;
  const cut = s.length - Number(decimals);
  return `${s.slice(0, cut)}.${s.slice(cut)}`.replace(/\.?0+$/, '');
}

// Whole-number percentages. BigInt has no fractions, and the exact amount is
// always shown next to this anyway.
export function shareOf(balance, total) {
  if (!total) return '';
  return `${(Number((balance * 10000n) / total) / 100).toFixed(2)}%`;
}
