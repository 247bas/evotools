// The credit side of an identity: what it holds, and how to move it.
//
// Credits only exist inside Platform. They sit in two kinds of place — an
// identity, which owns names and documents and pays their fees, and a platform
// address, which is a balance with a key and nothing else. Everything below
// moves credits between those two, or back out to layer 1.
//
// Worth knowing: there is no identity-to-identity transfer. An identity can only
// pay out to a platform address, so reaching another identity means two steps
// and the other side has to top itself up. Withdrawals leave from an address as
// well, never from an identity directly.

import { getSdk, loadEvo, getNetwork } from './sdk.js';
import {
  loadDashcore, fetchUtxos, spendable, totalDuffs, convertToCredits as runConversion,
  findAssetLocks, resumeAssetLock, MIN_LOCK_DUFFS, FEE_DUFFS,
} from '../../shared/assetlock.js';

export { MIN_LOCK_DUFFS, FEE_DUFFS };

// Protocol minimum for a withdrawal, 0.004 DASH. The SDK does not publish its
// limits — the protocol facade only carries version state — so this is copied
// from the reference implementation (dash-evo-tool, see LESSONS §A1) and cannot
// be derived at runtime. If the protocol ever moves it, the chain refuses and
// says so; nothing is lost, but this number would need updating.
export const MIN_WITHDRAW_CREDITS = 400_000_000n;
// A sweep has to leave the fee behind on the address, and that fee is not fixed
// — 13,355,560 credits for a top-up on mainnet, less elsewhere. This is the
// opening guess; when it is too small the network says exactly what it needed
// and the call is retried with that number.
export const SWEEP_MARGIN = 20_000_000n;

// "Insufficient combined address balances: total available is less than required N"
const requiredFrom = (err) => {
  const m = /less than required (\d+)/.exec(String(err?.message || err));
  return m ? BigInt(m[1]) : null;
};

const str = (x) => (typeof x === 'string' ? x : x?.toString?.());

// A node can answer "not found" for something that plainly exists — seen on
// testnet for an identity that had just been topped up. Saying it is gone would
// be a lie, so ask a few times before believing it.
async function fetchIdentity(sdk, identityId, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const identity = await sdk.identities.fetch(identityId);
      if (identity) return identity;
    } catch { /* try again */ }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Identity not found on this network: ${identityId}`);
}

// Accepts an identity id or a .dash name.
export async function lookupIdentity(idOrName) {
  const sdk = await getSdk();
  const input = idOrName.trim();
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
    keys: keys.map((k) => ({ keyId: k.keyId, purpose: k.purpose, securityLevel: k.securityLevel })),
    hasTransferKey: keys.some((k) => k.purpose === 'TRANSFER' && !k.disabledAt),
  };
}

// The platform address a key controls, and what is on it.
export async function addressFromWif(wif) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { PrivateKey, PlatformAddressSigner } = Evo;
  let key;
  try { key = PrivateKey.fromWIF(wif); }
  catch { throw new Error('That is not a valid WIF private key.'); }
  const address = new PlatformAddressSigner().addKey(key).toBech32m(getNetwork());
  const info = await sdk.addresses.get(address);
  return { address, balance: info?.balance ?? 0n };
}

async function addressSigner(Evo, wif) {
  const signer = new Evo.PlatformAddressSigner();
  signer.addKey(Evo.PrivateKey.fromWIF(wif));
  return signer;
}

// Address → identity. The options want the fetched Identity, not an id.
export async function topUpIdentity({ identityId, addressWif, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { address, balance } = await addressFromWif(addressWif);
  let send = amount ?? (balance > SWEEP_MARGIN ? balance - SWEEP_MARGIN : 0n);
  if (send <= 0n) throw new Error(`${address} holds ${balance} credits — nothing to move.`);
  if (send > balance) throw new Error(`${address} holds ${balance} credits, less than you asked to move.`);

  const identity = await fetchIdentity(sdk, identityId);
  const move = async (value) => sdk.addresses.topUpIdentity({
    identity,
    inputs: [{ address, amount: value }],
    signer: await addressSigner(Evo, addressWif),
  });

  let result;
  try {
    result = await move(send);
  } catch (e) {
    // Only a sweep can be adjusted: an explicit amount is what the user asked
    // for, and quietly sending less would be worse than failing.
    const fee = requiredFrom(e);
    if (amount !== undefined || fee === null) throw e;
    send = balance - fee;
    if (send <= 0n) {
      throw new Error(`${address} holds ${balance} credits, which does not cover the ${fee} fee.`);
    }
    result = await move(send);
  }
  return { from: address, moved: send, newBalance: result?.newBalance };
}

// Identity → address, signed with the identity's TRANSFER key.
export async function sendFromIdentity({ identityId, transferWif, toAddress, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { IdentitySigner, PrivateKey } = Evo;

  const keys = await sdk.identities.getKeys({ identityId, request: { type: 'all' } });
  const transferKeys = keys.filter((k) => k.purpose === 'TRANSFER' && !k.disabledAt);
  if (!transferKeys.length) throw new Error('This identity has no TRANSFER key, so it cannot send credits.');

  let privateKeyBytes;
  try { privateKeyBytes = PrivateKey.fromWIF(transferWif).toBytes(); }
  catch { throw new Error('That is not a valid WIF private key.'); }
  const net = getNetwork();
  const matches = transferKeys.some((k) => {
    try { return k.validatePrivateKey(privateKeyBytes, net); } catch { return false; }
  });
  if (!matches) throw new Error('That key is not the TRANSFER key of this identity.');

  const identity = await fetchIdentity(sdk, identityId);
  const signer = new IdentitySigner();
  signer.addKeyFromWif(transferWif);
  const result = await sdk.addresses.transferFromIdentity({
    identity,
    outputs: [{ address: toAddress, amount }],
    signer,
  });
  return { to: toAddress, moved: amount, newBalance: result?.newBalance };
}

// Address → address. Four rules the protocol enforces, learned the hard way:
// inputs and outputs must be equal, the fee comes off an output rather than the
// difference, an output may not be the address paying, and there is a floor on
// what an output may carry. So this moves everything except a margin, and the
// margin is what stays behind to cover the fee.
export async function sendBetweenAddresses({ fromWif, toAddress, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { address, balance } = await addressFromWif(fromWif);
  if (toAddress === address) throw new Error('That is the same address the credits are already on.');
  let send = amount ?? (balance > SWEEP_MARGIN ? balance - SWEEP_MARGIN : 0n);
  if (send <= 0n) throw new Error(`${address} holds ${balance} credits — nothing to move.`);
  if (send + SWEEP_MARGIN > balance) {
    throw new Error(`${address} holds ${balance} credits; leave at least ${SWEEP_MARGIN} behind for the fee.`);
  }

  const move = async (value) => sdk.addresses.transfer({
    inputs: [{ address, amount: value }],
    outputs: [{ address: toAddress, amount: value }],
    feeStrategy: [{ type: 'reduceOutput', index: 0 }],
    signer: await addressSigner(Evo, fromWif),
  });

  try {
    await move(send);
  } catch (e) {
    const fee = requiredFrom(e);
    if (amount !== undefined || fee === null) throw e;
    send = balance - fee;
    if (send <= 0n) {
      throw new Error(`${address} holds ${balance} credits, which does not cover the ${fee} fee.`);
    }
    await move(send);
  }
  return { from: address, to: toAddress, moved: send };
}

// Address → layer 1. Leaves Platform for good: the credits become DASH again at
// the Dash address you name, and the minimum is the protocol's, not ours.
export async function withdrawToCore({ fromWif, coreAddress, amount }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { CoreScript, PoolingWasm } = Evo;
  // Check the destination first: a mistyped address is worth saying so about
  // whether or not there is enough to send. If the script does not lead back to
  // the address, it was not a plain one — cheaper to learn here than after
  // broadcasting to nowhere.
  const outputScript = CoreScript.fromP2PKH(publicKeyHashOf(coreAddress));
  if (outputScript.toAddress(getNetwork()) !== coreAddress) {
    throw new Error(`${coreAddress} is not a plain Dash address on ${getNetwork()}.`);
  }

  const { address, balance } = await addressFromWif(fromWif);
  // Same rule as the other sweeps: the fee comes off the address, so emptying it
  // completely leaves nothing to pay with. Leaving the margin was missing here.
  let send = amount ?? (balance > SWEEP_MARGIN ? balance - SWEEP_MARGIN : 0n);
  if (send < MIN_WITHDRAW_CREDITS) {
    throw new Error(`A withdrawal has to be at least ${Number(MIN_WITHDRAW_CREDITS) / 1e11} DASH.`);
  }
  if (send > balance) throw new Error(`${address} holds ${balance} credits, less than you asked to withdraw.`);

  const leave = async (value) => sdk.addresses.withdraw({
    inputs: [{ address, amount: value }],
    outputScript,
    coreFeePerByte: 1,
    // Only "never pool" is implemented: anything else is refused with
    // "pooling 2 should be equal to 0. Other pooling mechanism are not
    // implemented yet". Pooling would have batched withdrawals for privacy.
    pooling: PoolingWasm.Never,
    signer: await addressSigner(Evo, fromWif),
  });

  try {
    await leave(send);
  } catch (e) {
    const needed = requiredFrom(e);
    if (amount !== undefined || needed === null) throw e;
    send = balance - needed;
    if (send < MIN_WITHDRAW_CREDITS) {
      throw new Error(`${address} holds ${balance} credits — not enough to withdraw ${Number(MIN_WITHDRAW_CREDITS) / 1e11} DASH and cover the ${needed} it asks for.`);
    }
    await leave(send);
  }
  return { from: address, to: coreAddress, moved: send };
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// A Dash address is base58check over a version byte and 20 bytes of public key
// hash. Only the hash goes into the script.
function publicKeyHashOf(coreAddress) {
  let num = 0n;
  for (const c of coreAddress) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) throw new Error(`${coreAddress} is not a Dash address.`);
    num = num * 58n + BigInt(digit);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num % 256n)); num /= 256n; }
  for (const c of coreAddress) { if (c === '1') bytes.unshift(0); else break; }
  if (bytes.length !== 25) throw new Error(`${coreAddress} is not a Dash address.`);
  return Uint8Array.from(bytes.slice(1, 21));
}

// ── getting credits in the first place ──────────────────────────────────────
// Credits have to come from somewhere, and for most people that somewhere is
// plain DASH. The funding key's ordinary Dash address can be paid from any
// wallet; this turns what lands there into credits with an asset lock. Same
// module onboard uses — this is just the door for people who already have an
// identity and only need more credits.

// Both faces of one key, with what sits on each.
export async function fundingAddresses(wif) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { PrivateKey, PlatformAddressSigner, wallet } = Evo;
  let key;
  try { key = PrivateKey.fromWIF(wif); }
  catch { throw new Error('That is not a valid WIF private key.'); }
  const network = getNetwork();
  const platform = new PlatformAddressSigner().addKey(key).toBech32m(network);
  const publicKeyHex = Array.from(key.getPublicKey().toBytes(), (b) => b.toString(16).padStart(2, '0')).join('');
  const core = await wallet.pubkeyToAddress(publicKeyHex, network);

  const info = await sdk.addresses.get(platform);
  const utxos = spendable(await fetchUtxos(core, network).catch(() => []));
  return {
    platform,
    core,
    credits: info?.balance ?? 0n,
    duffs: totalDuffs(utxos),
    utxos,
  };
}

// Layer-1 DASH → credits on this key's platform address.
export async function convertDash({ wif, lockDuffs, onProgress }) {
  // Check there is something to convert before pulling in the transaction
  // builder — it is 1.7MB, and refusing early costs nothing.
  const { platform, utxos, duffs } = await fundingAddresses(wif);
  if (!utxos.length) throw new Error('Nothing confirmed on that key\'s Dash address yet.');
  const lock = lockDuffs ?? duffs - FEE_DUFFS;
  if (lock < MIN_LOCK_DUFFS) {
    throw new Error(`An asset lock needs at least ${MIN_LOCK_DUFFS / 1e8} DASH; that address holds ${duffs / 1e8}.`);
  }

  const Evo = await loadEvo();
  const sdk = await getSdk();
  const dc = await loadDashcore();
  return runConversion({
    sdk, Evo, dc, wif, utxos, lockDuffs: lock,
    network: getNetwork(), platformAddress: platform, onProgress,
  });
}

// Conversions that reached the chain but never became credits.
export async function unfinishedConversions(wif) {
  const { core } = await fundingAddresses(wif);
  const dc = await loadDashcore();
  return findAssetLocks({ dc, address: core, network: getNetwork() });
}

export async function finishConversion({ wif, lock, onProgress }) {
  const Evo = await loadEvo();
  const sdk = await getSdk();
  const { platform } = await fundingAddresses(wif);
  return resumeAssetLock({ sdk, Evo, wif, lock, platformAddress: platform, onProgress });
}
