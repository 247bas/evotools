// Turning layer-1 DASH into Platform credits, from the browser.
//
// The evo-sdk can hold an asset lock proof but cannot build the layer-1
// transaction that creates one, and it has no way to reach Dash Core. This
// module fills that gap with a public Insight instance for the chain data and
// the vendored dashcore-lib bundle for the transaction itself, so nobody needs
// a desktop tool to get onto Platform.
//
// Verified end to end on testnet 2026-07-25; see _reference/LESSONS.md §G.

export const INSIGHT = {
  mainnet: 'https://insight.dash.org/insight-api',
  testnet: 'https://insight.testnet.networks.dash.org/insight-api',
};

// Protocol minimum for an asset lock that can create an identity.
export const MIN_LOCK_DUFFS = 200_000;

// Deliberately small. The public Insight nodes run a low `-maxtxfee`: 5,000
// duffs is refused ("Fee exceeds maximum configured by user"), 1,000 goes
// through, and that is still well above the 1 duff/byte relay minimum for a
// transaction of this size. Raising this will break broadcasting, not speed it.
export const FEE_DUFFS = 1_000;

const api = (network) => INSIGHT[network] || INSIGHT.testnet;
const coreNetwork = (network) => (network === 'mainnet' ? 'livenet' : 'testnet');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split('/').pop()} failed (${res.status})`);
  return res.json();
}

// Load the vendored dashcore-lib bundle once. It is an IIFE that assigns to
// window.dashcore — see tools/vendor-dashcore.mjs for why it is not an ES module.
let _dashcorePromise = null;
export function loadDashcore() {
  if (globalThis.dashcore) return Promise.resolve(globalThis.dashcore.default || globalThis.dashcore);
  if (!_dashcorePromise) {
    _dashcorePromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/shared/vendor/dashcore.bundle.js';
      s.onload = () => resolve(globalThis.dashcore.default || globalThis.dashcore);
      s.onerror = () => reject(new Error('Could not load the transaction builder.'));
      document.head.append(s);
    });
  }
  return _dashcorePromise;
}

// Outputs of a layer-1 address. InstantSend settles a payment in seconds, which
// is the point of Dash, so an unconfirmed output whose transaction is locked is
// as final as a confirmed one — but the listing does not say whether it is, so
// each unconfirmed entry costs one extra lookup.
export async function fetchUtxos(address, network) {
  const utxos = await getJson(`${api(network)}/addr/${address}/utxo`);
  const mapped = utxos.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    script: u.scriptPubKey,
    satoshis: u.satoshis ?? Math.round((u.amount ?? 0) * 1e8),
    confirmations: u.confirmations ?? 0,
    txlock: false,
  }));
  await Promise.all(mapped
    .filter((u) => u.confirmations < 1)
    .map(async (u) => {
      const tx = await getJson(`${api(network)}/tx/${u.txid}`).catch(() => null);
      u.txlock = tx?.txlock === true;
    }));
  return mapped;
}

// Confirmed, or locked by InstantSend — either way the coins cannot move again.
export const spendable = (utxos) => utxos.filter((u) => u.confirmations >= 1 || u.txlock);
export const totalDuffs = (utxos) => utxos.reduce((sum, u) => sum + u.satoshis, 0);

// Build and sign the asset lock. Shape is byte-identical to the locks Platform
// itself produces: version 3, type 8, output 0 = OP_RETURN carrying the locked
// value, output 1 = change, and a payload whose single credit output is the
// P2PKH of the key that will own the credits.
export function buildAssetLock({ dc, wif, utxos, lockDuffs, network }) {
  if (lockDuffs < MIN_LOCK_DUFFS) {
    throw new Error(`An asset lock has to be at least ${MIN_LOCK_DUFFS / 1e8} DASH.`);
  }
  const net = coreNetwork(network);
  const key = new dc.PrivateKey(wif, net);
  const address = key.toAddress(net);
  const available = totalDuffs(utxos);
  if (available < lockDuffs + FEE_DUFFS) {
    throw new Error(`Not enough on this address: ${available / 1e8} DASH, need ${(lockDuffs + FEE_DUFFS) / 1e8}.`);
  }

  const tx = new dc.Transaction()
    .from(utxos.map((u) => new dc.Transaction.UnspentOutput({
      txId: u.txid, outputIndex: u.vout, address: address.toString(), script: u.script, satoshis: u.satoshis,
    })))
    .addOutput(new dc.Transaction.Output({
      satoshis: lockDuffs,
      script: new dc.Script().add('OP_RETURN').add(dc.Opcode.OP_0),
    }))
    .change(address)
    .fee(FEE_DUFFS);
  tx.version = 3;
  tx.type = 8;

  const payload = new dc.Transaction.Payload.AssetLockPayload();
  payload.creditOutputs = [new dc.Transaction.Output({
    satoshis: lockDuffs,
    script: dc.Script.buildPublicKeyHashOut(address),
  })];
  tx.setExtraPayload(payload);
  tx.sign(key);

  if (!tx.isFullySigned()) throw new Error('The transaction could not be signed with this key.');
  return { rawtx: tx.serialize(true), txid: tx.id };
}

export async function broadcast(rawtx, network) {
  const res = await fetch(`${api(network)}/tx/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawtx }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`The network refused the transaction: ${text.slice(0, 200)}`);
  try { return JSON.parse(text).txid; } catch { return text.trim(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Height of the block the transaction landed in.
export async function waitForBlock(txid, network, { onTick, intervalMs = 15000, tries = 120 } = {}) {
  for (let i = 0; i < tries; i++) {
    const tx = await getJson(`${api(network)}/tx/${txid}`).catch(() => null);
    const height = tx?.blockheight ?? -1;
    if (height > 0) return height;
    onTick?.(i);
    await sleep(intervalMs);
  }
  throw new Error('The transaction has not been mined yet. It is safe to come back to it later.');
}

// Platform only accepts a chain proof once it considers that height locked, and
// it publishes the height it trusts — no InstantSend bytes to chase.
export async function waitForChainlock(sdk, height, { onTick, intervalMs = 15000, tries = 120 } = {}) {
  for (let i = 0; i < tries; i++) {
    // A node that answers badly ("invalid content type: application/grpc") is a
    // hiccup, not a verdict — the lock is already on chain and keeps. Retrying
    // costs a poll; giving up would strand a conversion that is nearly done.
    let locked = null;
    try {
      locked = (await sdk.system.status()).toObject().chain.coreChainLockedHeight;
    } catch { /* keep polling */ }
    if (locked !== null && locked >= height) return locked;
    onTick?.(locked ?? 0, height);
    await sleep(intervalMs);
  }
  throw new Error('Platform has not chain-locked that block yet. It is safe to come back to it later.');
}

// Hand the lock to Platform. The option shapes here are not obvious: outputs are
// plain objects and exactly one must omit `amount` — that one absorbs whatever
// is left after fees — and the fee strategy is a plain object too. Passing WASM
// instances fails with "missing field `type`".
export async function fundFromAssetLock({ sdk, Evo, wif, txid, chainlockedHeight, platformAddress }) {
  const proof = Evo.AssetLockProof.createChainAssetLockProof(
    chainlockedHeight,
    new Evo.OutPoint(txid, 0),
  );
  const signer = new Evo.PlatformAddressSigner();
  signer.addKey(Evo.PrivateKey.fromWIF(wif));
  return sdk.addresses.fundFromAssetLock({
    assetLockProof: proof,
    assetLockPrivateKey: Evo.PrivateKey.fromWIF(wif),
    outputs: [{ address: platformAddress }],
    feeStrategy: [{ type: 'reduceOutput', index: 0 }],
    signer,
  });
}

// The whole path, with progress. Each step is separately retryable: a lock that
// is already on chain stays there until it is consumed, so a failure after the
// broadcast costs nothing to pick up again.
export async function convertToCredits({
  sdk, Evo, dc, wif, utxos, lockDuffs, network, platformAddress, onProgress = () => {},
}) {
  onProgress({ step: 'build' });
  const { rawtx, txid } = buildAssetLock({ dc, wif, utxos, lockDuffs, network });

  onProgress({ step: 'broadcast', txid });
  await broadcast(rawtx, network);

  onProgress({ step: 'mining', txid });
  const height = await waitForBlock(txid, network, { onTick: () => onProgress({ step: 'mining', txid }) });

  onProgress({ step: 'chainlock', txid, height });
  const locked = await waitForChainlock(sdk, height, {
    onTick: (at) => onProgress({ step: 'chainlock', txid, height, at }),
  });

  onProgress({ step: 'crediting', txid, height });
  await fundFromAssetLock({ sdk, Evo, wif, txid, chainlockedHeight: locked, platformAddress });

  onProgress({ step: 'done', txid });
  return { txid, height };
}

// ── picking up an interrupted conversion ────────────────────────────────────
// A lock that reached the chain stays claimable until someone hands Platform a
// proof, so a closed tab never loses the coins — it only loses the note of
// where they went. Nothing has to be stored for this: the chain remembers, and
// the key is enough to find them back.

// Platform's answer when a lock has already been turned into credits.
const CONSUMED = 'already completely used';
export const isAlreadyUsed = (err) => String(err?.message || err).includes(CONSUMED);

// Asset locks on this address whose credits belong to this key.
export async function findAssetLocks({ dc, address, network, limit = 25 }) {
  const info = await getJson(`${api(network)}/addr/${address}`);
  const net = coreNetwork(network);
  const mine = dc.Address.fromString(address, net).hashBuffer.toString('hex');
  const locks = [];
  for (const txid of (info.transactions || []).slice(0, limit)) {
    let tx;
    try {
      const { rawtx } = await getJson(`${api(network)}/rawtx/${txid}`);
      tx = new dc.Transaction(rawtx);
    } catch { continue; }
    if (tx.type !== 8) continue; // not an asset lock
    const credit = tx.extraPayload?.creditOutputs?.[0];
    if (!credit) continue;
    let creditHash;
    try { creditHash = credit.script.toAddress(net).hashBuffer.toString('hex'); } catch { continue; }
    if (creditHash !== mine) continue;
    const meta = await getJson(`${api(network)}/tx/${txid}`).catch(() => null);
    locks.push({
      txid,
      duffs: credit.satoshis,
      height: meta?.blockheight ?? -1,
      confirmations: meta?.confirmations ?? 0,
    });
  }
  return locks;
}

// Finish one. Returns why it could not be finished rather than throwing, since
// "this one was already done" is a perfectly good outcome when sweeping.
export async function resumeAssetLock({ sdk, Evo, wif, lock, platformAddress, onProgress = () => {} }) {
  if (lock.height <= 0) return { txid: lock.txid, state: 'not-mined' };
  onProgress({ step: 'chainlock', ...lock });
  const locked = await waitForChainlock(sdk, lock.height, {
    onTick: (at) => onProgress({ step: 'chainlock', at, ...lock }),
  });
  onProgress({ step: 'crediting', ...lock });
  try {
    await fundFromAssetLock({ sdk, Evo, wif, txid: lock.txid, chainlockedHeight: locked, platformAddress });
    return { txid: lock.txid, state: 'credited', duffs: lock.duffs };
  } catch (e) {
    if (isAlreadyUsed(e)) return { txid: lock.txid, state: 'already-done', duffs: lock.duffs };
    throw e;
  }
}
