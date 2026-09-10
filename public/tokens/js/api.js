// Which tokens an identity holds, from the public platform-explorer indexer.
//
// This is the one thing on the page the chain cannot answer. Balances live in a
// tree keyed by identity and there is no call that walks it, so every SDK method
// wants the token IDs you are trying to discover: `identityBalances` takes a
// list, `contractInfo` takes one token. The history route that finds a token's
// holders does not work in reverse either — the history contract's indices all
// start with tokenId, so "every document naming this identity" is not a query
// it can serve.
//
// So discovery comes from pshenmic's public API, the same data
// platform-explorer.com shows, exactly as /contests and /map already do. What
// comes back is treated as a list of names to look up and nothing more: the
// balances underneath are read from the chain, so a wrong or stale answer from
// the indexer can hide a token or show one that is empty, but it can never make
// this page show a balance that is not really there.
//
// If the indexer is unreachable the page says so and the contract-id field still
// works — every action here can be driven without this list.

const HOSTS = {
  mainnet: 'https://platform-explorer.pshenmic.dev',
  testnet: 'https://testnet.platform-explorer.pshenmic.dev',
};

let network = 'testnet';
export const setApiNetwork = (n) => { if (HOSTS[n]) network = n; };
export const apiHost = () => HOSTS[network];

async function get(path) {
  let res;
  try {
    res = await fetch(`${HOSTS[network]}${path}`);
  } catch {
    throw new Error(`Could not reach the explorer API at ${HOSTS[network].replace('https://', '')}. `
      + 'The token list needs it; everything else on this page does not — paste a contract id instead.');
  }
  if (!res.ok) throw new Error(`The explorer API answered ${res.status} ${res.statusText}.`);
  return res.json();
}

/**
 * The tokens an identity holds — not the ones it issued. Both come back from
 * the same endpoint and the `owner` field is what separates them, which is why
 * `isIssuer` is worth carrying through: on a list of ten, the two you minted
 * yourself are the ones you can still mint more of.
 */
export async function tokensOfIdentity(identityId, { limit = 100 } = {}) {
  const data = await get(`/identity/${identityId}/tokens?limit=${limit}`);
  return (data.resultSet ?? []).map((t) => {
    const loc = t.localizations?.en ?? {};
    const ownerId = t.owner?.identifier ?? '';
    // `owner.aliases` is deliberately not read. On mainnet the indexer lists
    // thedesertlynx.dash against 3sL6q6e…, the identity that owns the DUSD and
    // SANS contracts, while the chain says that name belongs to BC6nzq4i… and
    // that 3sL6q6e… has no name at all. Repeating that here would put a name
    // on a token's issuer that DPNS does not agree with. The owner's ID is a
    // fact; its name is looked up from the chain by the caller.
    return {
      tokenId: t.identifier,
      contractId: t.dataContractIdentifier,
      position: t.position ?? 0,
      name: loc.singularForm ?? 'token',
      plural: loc.pluralForm ?? '',
      decimals: t.decimals ?? 0,
      description: t.description ?? '',
      totalSupply: t.totalSupply,
      ownerId,
      isIssuer: ownerId === identityId,
      mintable: Boolean(t.mintable),
    };
  });
}
