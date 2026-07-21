// The recipe catalogue. Source is fetched live from the evo-cookbook repo, so
// the playground always runs the current, verified recipes.

export const REPO = 'https://github.com/247bas/evo-cookbook';
const RAW = 'https://raw.githubusercontent.com/247bas/evo-cookbook/main/recipes/';

export const RECIPES = [
  { id: '01', file: '01-connect.mjs', title: 'Connect', blurb: 'Factory methods, trusted vs proof mode.', funds: false },
  { id: '02', file: '02-identities.mjs', title: 'Identities', blurb: 'Fetch identities, balances (credits are bigint), public keys.', funds: false },
  { id: '03', file: '03-dpns.mjs', title: 'DPNS', blurb: 'Resolve names, reverse lookup, availability, contested names, homograph safety.', funds: false },
  { id: '04', file: '04-documents-query.mjs', title: 'Document queries', blurb: 'where / orderBy, startsWith, single fetch, properties vs data.', funds: false },
  { id: '05', file: '05-proofs.mjs', title: 'Proofs', blurb: 'The *WithProof variants and their metadata (height, timestamp).', funds: false },
  { id: '06', file: '06-wallet-utils.mjs', title: 'Wallet utils', blurb: 'Mnemonics, BIP44/DIP9 derivation, key pairs, message signing — all offline.', funds: false },
  { id: '07', file: '07-aggregations.mjs', title: 'Aggregations', blurb: 'count / sum / average and the countable index flags they need.', funds: false },
  { id: '08', file: '08-error-handling.mjs', title: 'Error handling', blurb: 'Turning an opaque WasmSdkError into a readable diagnostic.', funds: false },
  { id: '09', file: '09-write-path.mjs', title: 'Write path', blurb: 'Publish a contract + create a document. Shows the flow read-only; add a funded identity in Environment to broadcast.', funds: true },
  { id: '10', file: '10-identity-from-address.mjs', title: 'Identity from address', blurb: 'Wallet → faucet → identity via Platform Addresses. Runs the wallet-generation step; add a funded mnemonic to mint.', funds: true },
];

export const githubUrl = (file) => `${REPO}/blob/main/recipes/${file}`;

export async function fetchRecipe(file) {
  const res = await fetch(RAW + file);
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status})`);
  return res.text();
}
