// Smoke test for the tokens tool. Reads run live against testnet and the guards
// are exercised for real, since refusing to publish or move costs nothing.
// Publishing and transferring are proven in the session notes rather than on
// every run — each one costs credits and leaves a contract on the chain forever.
// Run: node public/tokens/test/smoke.mjs
import { randomBytes } from 'node:crypto';
import {
  lookupIdentity, tokenInfo, toBaseUnits, buildTokenContract, createToken,
  sendToken, mintToken, holdersOf, tokensHeldBy, formatAmount,
} from '../js/tokens.js';
import { tokensOfIdentity, setApiNetwork, apiHost } from '../js/api.js';
import { tokenHolders, TOKEN_HISTORY_CONTRACT } from '../../shared/token-holders.js';
import { setNetwork, loadEvo, getSdk } from '../js/sdk.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (cond, m) => (cond ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));
const refuses = async (fn, want, label) => {
  try { await fn(); failed++; console.log(`  ❌ ${label}: did not refuse`); }
  catch (e) { check(String(e.message).includes(want), `${label} — ${e.message.slice(0, 100)}`); }
};

setNetwork('testnet');
const sdk = await getSdk();
const Evo = await loadEvo();
const stranger = Evo.PrivateKey.fromBytes(new Uint8Array(randomBytes(32)), 'testnet').toWIF();

// A token published by this tool's ancestor, kept as the fixture: 21,000,000
// nekoT, no decimals, minting off forever, one transfer of 100 to alice.
const CONTRACT = 'EGcCV27PcJq5RoEVe3nPrh9ipsXw1VnppezrawQeYkvo';
const ISSUER = 'GLFyDxwzoKBC1dr9HQYtrYCJfoDeNjm3JA2EGKZyjgn7';

console.log('\n1. Looking an identity up');
const issuer = await lookupIdentity(ISSUER);
check(issuer.identityId === ISSUER, `id -> ${issuer.identityId.slice(0, 12)}…`);
check(typeof issuer.balance === 'bigint', `balance is a bigint (${issuer.balance})`);
check(issuer.criticalKeys.length > 0, `AUTHENTICATION/CRITICAL: #${issuer.criticalKeys.join(', #')}`);
check(issuer.signingKeys.length > 0, `could sign at all: ${issuer.signingKeys.map((k) => `#${k.keyId} (${k.securityLevel})`).join(', ')}`);
const byName = await lookupIdentity('247bas.dash');
check(byName.identityId === ISSUER, '247bas.dash gives the same identity as the id');
await refuses(() => lookupIdentity('this-name-does-not-exist-9273'), 'No identity found', 'an unknown name');
await refuses(() => lookupIdentity(stranger), 'looks like a private key', 'a WIF pasted in the identity box');
await refuses(
  () => lookupIdentity('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
  'looks like a private key', 'a recovery phrase pasted in the identity box',
);

console.log('\n2. Reading a token');
const info = await tokenInfo(CONTRACT, 0, ISSUER);
check(info.name === 'nekoT', `name ${info.name}, ${info.decimals} decimals`);
check(info.tokenId === '3rfGsSmv38Af1iDg1c9LaDedWkC1TaveiTYmCHoRYLjw', `token id ${info.tokenId.slice(0, 12)}…`);
check(info.ownerId === ISSUER, 'the issuer owns the contract');
check(info.balance > 0n, `the issuer holds ${formatAmount(info.balance, info.decimals)}`);
check(info.canMint === false, `minting is off — "${info.mintBlockedBy.slice(0, 48)}…"`);
await refuses(() => tokenInfo('GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec', 0), 'no tokens at all', 'the DPNS contract, which carries no token');
await refuses(() => tokenInfo(CONTRACT, 3), 'no token at position 3', 'a position that does not exist');
await refuses(() => tokenInfo('nonsense'), 'not a valid contract ID', 'a contract id that is not one');
await refuses(() => tokenInfo(stranger), 'looks like a key', 'a WIF pasted in the contract box');

console.log('\n3. Amounts');
check(toBaseUnits('1.5', 8) === 150000000n, '1.5 at 8 decimals -> 150000000');
check(toBaseUnits('21000000', 0) === 21000000n, '21000000 at 0 decimals unchanged');
check(formatAmount(150000000n, 8) === '1.5', 'and back again');
for (const [amount, decimals, want, label] of [
  ['1.5', 0, 'no decimals', 'a fraction on a whole-number token'],
  ['-5', 0, 'positive number', 'a negative amount'],
  ['0', 0, 'zero', 'zero'],
  ['lots', 0, 'positive number', 'a word'],
]) await refuses(async () => toBaseUnits(amount, decimals), want, label);

console.log('\n4. Building a contract — no network, no keys');
const shapes = [
  ['mintable, no ceiling', { name: 'Waffle', plural: 'Waffles', decimals: 0, baseSupply: '1000', maxSupply: '', mintable: true, burnable: true, freezable: false }],
  ['fixed supply', { name: 'Pass', plural: 'Passes', decimals: 0, baseSupply: '512', maxSupply: '', mintable: false, burnable: false, freezable: false }],
  ['8 decimals with a ceiling', { name: 'Coin', plural: 'Coins', decimals: 8, baseSupply: '21.5', maxSupply: '100', mintable: true, burnable: true, freezable: true }],
];
for (const [label, form] of shapes) {
  const contract = await buildTokenContract(Evo, form, ISSUER, 1n);
  const t = contract.toJSON().tokens['0'];
  const noDocs = Object.keys(contract.toJSON().documentSchemas).length === 0;
  check(noDocs && t.conventions.localizations.en.singularForm === form.name,
    `${label} — ${t.baseSupply} base, ${t.maxSupply ?? 'no'} max, minting ${JSON.stringify(t.manualMintingRules.authorizedToMakeChange)}`);
}
check(
  (await buildTokenContract(Evo, shapes[1][1], ISSUER, 1n)).toJSON().tokens['0'].maxSupply === 512,
  'a token nobody can mint gets its starting supply as the ceiling',
);
check(
  (await buildTokenContract(Evo, shapes[0][1], ISSUER, 1n)).toJSON().tokens['0'].keepsHistory.keepsTransferHistory === true,
  'transfer history is on, which is what makes the holder list possible',
);
await refuses(
  () => buildTokenContract(Evo, { ...shapes[0][1], maxSupply: '10' }, ISSUER, 1n),
  'below the starting supply', 'a ceiling under the starting supply',
);
await refuses(() => buildTokenContract(Evo, { ...shapes[0][1], name: '' }, ISSUER, 1n), 'a name', 'a token with no name');
await refuses(() => buildTokenContract(Evo, { ...shapes[0][1], decimals: 99 }, ISSUER, 1n), '0 to 16', '99 decimals');

console.log('\n5. Guards, before anything is signed');
// What is refused here is what cannot work: a key off another identity, or one
// whose purpose is something else. The security level is the chain's call —
// guessing it wrong locally would block an identity whose only authentication
// key is HIGH, which is unusual but real (mainnet: thedesertlynx.dash).
await refuses(
  () => createToken({ identityId: ISSUER, wif: stranger, ...shapes[0][1] }),
  'does not belong to this identity', 'publishing with a key that is not this identity\'s',
);
await refuses(
  () => sendToken({ identityId: ISSUER, wif: stranger, contractId: CONTRACT, amount: '1', recipient: 'alice' }),
  'does not belong to this identity', 'sending with a stranger\'s key',
);
await refuses(
  () => sendToken({ identityId: ISSUER, wif: stranger, contractId: CONTRACT, amount: '1', recipient: '247bas' }),
  'this identity itself', 'sending to itself',
);
await refuses(
  () => sendToken({ identityId: ISSUER, wif: stranger, contractId: CONTRACT, amount: '99999999999', recipient: 'alice' }),
  'less than that', 'sending more than it holds',
);
await refuses(
  () => sendToken({ identityId: ISSUER, wif: stranger, contractId: CONTRACT, amount: '1', recipient: 'no-such-name-2947' }),
  'Nobody owns the name', 'sending to a name nobody owns',
);
await refuses(
  () => mintToken({ identityId: ISSUER, wif: stranger, contractId: CONTRACT, amount: '1' }),
  'minting off', 'minting a token that was published without minting',
);

console.log('\n6. Who holds it');
const t0 = Date.now();
const held = await holdersOf(CONTRACT, 0);
check(held.complete, 'the token keeps history, so the list can be complete');
check(held.holders.length >= 2, `${held.holders.length} holders from ${held.events} history event(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
check(held.holders[0].balance >= held.holders[1].balance, 'sorted, largest first');
check(held.holders.some((h) => h.identityId === ISSUER), 'the issuer is in the list, which no history document names');
check(held.holders.some((h) => (h.names ?? []).includes('alice.dash')), 'alice is in it, by name');
const supply = await sdk.tokens.totalSupply(held.tokenId);
check(held.held === (supply?.totalSupply ?? supply?.toObject?.().totalSupply),
  `what the holders have adds up to the total supply (${formatAmount(held.held, held.decimals)})`);
await refuses(() => holdersOf('GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec', 0), 'no token at position', 'holders of a contract with no token');

console.log('\n7. The history contract itself');
const historyContract = await sdk.contracts.fetch(TOKEN_HISTORY_CONTRACT);
check(Boolean(historyContract), `${TOKEN_HISTORY_CONTRACT.slice(0, 12)}… exists on testnet`);
const types = Object.keys(historyContract.toJSON().documentSchemas);
check(types.includes('transfer') && types.includes('mint') && types.includes('burn'),
  `${types.length} document types: ${types.slice(0, 5).join(', ')}…`);
// The same ID on both networks is what lets one constant serve the whole suite.
const { EvoSDK } = Evo;
const main = EvoSDK.mainnetTrusted();
await main.connect();
check(Boolean(await main.contracts.fetch(TOKEN_HISTORY_CONTRACT)), 'and the same ID on mainnet');

console.log('\n7b. An identity whose keys do not fit the usual shape');
// mainnet thedesertlynx.dash has master + high authentication and a transfer
// key, and no AUTHENTICATION/CRITICAL. It holds DUSD and SANS but issued
// neither: the contracts belong to 3sL6q6e…, which does have a CRITICAL key and
// no DPNS name. The indexer files that identity under thedesertlynx.dash
// anyway, so the issuer's name has to come from the chain.
{
  const { EvoSDK } = Evo;
  const mainnet = EvoSDK.mainnetTrusted();
  await mainnet.connect();
  const LYNX = 'BC6nzq4iDzknwaUQEei3HSNfVQ9FQgFRDGvUPRCyGEfA';
  const OWNER = '3sL6q6eVCR6y8Ld6Gr14cedhJWNBPmBp3S5VtRcckxzE';
  check(String(await mainnet.dpns.resolveName('thedesertlynx')) === LYNX, 'thedesertlynx.dash resolves to the identity holding the tokens');
  const lynxKeys = await mainnet.identities.getKeys({ identityId: LYNX, request: { type: 'all' } });
  check(!lynxKeys.some((k) => k.purpose === 'AUTHENTICATION' && k.securityLevel === 'CRITICAL'),
    'it has no AUTHENTICATION/CRITICAL key, which is what made this look like a bug');
  const ownerKeys = await mainnet.identities.getKeys({ identityId: OWNER, request: { type: 'all' } });
  check(ownerKeys.some((k) => k.purpose === 'AUTHENTICATION' && k.securityLevel === 'CRITICAL'),
    'the identity that actually owns those contracts does have one');
  const ownerNames = await mainnet.dpns.usernames({ identityId: OWNER }).catch(() => []);
  check(ownerNames.length === 0, 'and DPNS gives it no name, whatever the indexer says');
}

console.log('\n8. What an identity holds');
// The one thing here that leans on an indexer: Platform cannot list the tokens
// an identity has, and the history route does not reverse (every index on the
// history contract starts with tokenId). Balances still come off the chain.
setApiNetwork('testnet');
const listed = await tokensOfIdentity(ISSUER);
check(listed.some((t) => t.tokenId === held.tokenId), `${apiHost().replace('https://', '')} lists ${listed.length} token(s) for the issuer`);
const mine = await tokensHeldBy(ISSUER);
const nekot = mine.find((t) => t.tokenId === held.tokenId);
check(Boolean(nekot), `tokensHeldBy finds it: ${nekot && formatAmount(nekot.balance, nekot.decimals)} ${nekot?.plural}`);
check(nekot?.isIssuer === true, 'and marks the issuer as the issuer');
check(typeof nekot?.balance === 'bigint' && nekot.balance > 0n, 'the balance is a bigint read from the chain, not from the API');
check(nekot?.contractId === CONTRACT, 'the contract id matches the one we published');

// alice holds it and did not issue it — the two must not be confused, since
// only the issuer can mint.
const hers = await tokensHeldBy('FKZZFDTfGdSWUmL2g7H9e46pMJMPQp9DHQcvjrsS6884');
const alicesNekot = hers.find((t) => t.tokenId === held.tokenId);
check(Boolean(alicesNekot), `alice holds ${alicesNekot && formatAmount(alicesNekot.balance, alicesNekot.decimals)} of it`);
check(alicesNekot?.isIssuer === false, 'and is not marked as the issuer');

// An identity with nothing gets an empty list, not an error.
const nobody = await tokensHeldBy('11111111111111111111111111111111111111111111'.slice(0, 44));
check(Array.isArray(nobody), 'an identity with no tokens gives an empty list rather than throwing');

console.log(failed ? `\n${failed} failed\n` : '\nAll good\n');
process.exit(failed ? 1 : 0);
