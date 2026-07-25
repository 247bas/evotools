// Smoke test for the asset lock path: builds a real, signed layer-1 transaction
// offline and checks it against the shape Platform actually produces, then hits
// the live testnet endpoints read-only. Nothing here spends anything.
// Run: node public/shared/test/assetlock.mjs
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  buildAssetLock, fetchUtxos, spendable, totalDuffs, waitForChainlock,
  INSIGHT, MIN_LOCK_DUFFS, FEE_DUFFS,
} from '../assetlock.js';
import { setNetwork, getSdk, loadEvo } from '../../name/js/sdk.js';

const ok = (m) => console.log(`  ✅ ${m}`);
let failed = 0;
const check = (cond, m) => (cond ? ok(m) : (failed++, console.log(`  ❌ ${m}`)));

// The vendored bundle is an IIFE for the browser; in Node we evaluate it the
// same way the page would load it.
globalThis.window = globalThis;
(0, eval)(readFileSync(new URL('../vendor/dashcore.bundle.js', import.meta.url), 'utf8'));
const dc = globalThis.dashcore.default || globalThis.dashcore;

setNetwork('testnet');
const sdk = await getSdk();
const Evo = await loadEvo();

console.log('\n1. The bundle carries what an asset lock needs');
check(typeof dc.Transaction === 'function', 'Transaction');
check(typeof dc.Transaction.Payload.AssetLockPayload === 'function', 'AssetLockPayload');
check(dc.Transaction.TYPES.TRANSACTION_ASSET_LOCK === 8, 'asset lock is transaction type 8');

console.log('\n2. Building a lock offline');
const priv = Evo.PrivateKey.fromBytes(new Uint8Array(randomBytes(32)), 'testnet');
const wif = priv.toWIF();
const address = new dc.PrivateKey(wif, 'testnet').toAddress('testnet').toString();
const utxos = [{ txid: 'b'.repeat(64), vout: 0, script: dc.Script.buildPublicKeyHashOut(address).toString(), satoshis: 100_000_000, confirmations: 3 }];
const lockDuffs = 1_000_000;
const { rawtx, txid } = buildAssetLock({ dc, wif, utxos, lockDuffs, network: 'testnet' });
const tx = new dc.Transaction(rawtx);
check(tx.version === 3 && tx.type === 8, `version ${tx.version}, type ${tx.type}`);
check(tx.outputs[0].script.toHex() === '6a00', 'output 0 is the OP_RETURN lock output');
check(tx.outputs[0].satoshis === lockDuffs, `it carries the locked ${lockDuffs} duffs`);
check(tx.outputs.length === 2 && tx.outputs[1].script.toAddress('testnet').toString() === address, 'output 1 returns the change');
check(tx.extraPayload.creditOutputs.length === 1, 'exactly one credit output');
check(tx.extraPayload.creditOutputs[0].script.toAddress('testnet').toString() === address, 'credits are assigned to the same key');
// A transaction parsed back from hex has no input amounts, so derive the fee
// from what went in versus what the outputs carry.
const outSum = tx.outputs.reduce((s, o) => s + o.satoshis, 0);
check(totalDuffs(utxos) - outSum === FEE_DUFFS, `layer-1 fee is ${FEE_DUFFS} duffs`);
check(/^[0-9a-f]{64}$/.test(txid), `txid ${txid.slice(0, 16)}…`);

console.log('\n3. The fee has to stay small');
// Public Insight nodes run a low -maxtxfee: 5,000 duffs is refused, 1,000 goes
// through. Raising this constant silently breaks broadcasting for everyone.
check(FEE_DUFFS <= 1_000, `FEE_DUFFS is ${FEE_DUFFS}, at or under the ceiling the public nodes accept`);

console.log('\n4. Guards refuse to build what the chain would reject');
const throws = (fn, want, label) => {
  try { fn(); failed++; console.log(`  ❌ ${label}: did not throw`); }
  catch (e) { check(String(e.message).includes(want), `${label} — ${e.message}`); }
};
throws(() => buildAssetLock({ dc, wif, utxos, lockDuffs: 1000, network: 'testnet' }), 'at least', 'below the protocol minimum');
throws(() => buildAssetLock({ dc, wif, utxos, lockDuffs: 200_000_000, network: 'testnet' }), 'Not enough', 'more than the address holds');
check(MIN_LOCK_DUFFS === 200_000, 'minimum lock is 200,000 duffs');

console.log('\n5. Live testnet endpoints (read-only)');
const fresh = await fetchUtxos(new dc.PrivateKey(undefined, 'testnet').toAddress('testnet').toString(), 'testnet');
check(Array.isArray(fresh) && fresh.length === 0, 'an unused address has no outputs');
check(INSIGHT.mainnet.startsWith('https://') && INSIGHT.testnet.startsWith('https://'), 'both networks have an endpoint');
const status = (await sdk.system.status()).toObject();
const locked = status.chain.coreChainLockedHeight;
check(Number.isInteger(locked) && locked > 0, `Platform reports core chain locked height ${locked}`);
// A few tries, not one: a node can answer badly, and surviving that is exactly
// what this function is now supposed to do.
const already = await waitForChainlock(sdk, locked - 10, { tries: 3, intervalMs: 2000 });
check(already >= locked - 10, 'waitForChainlock returns a height already locked, retrying past a bad answer');

console.log('\n6. Helpers');
check(spendable([{ confirmations: 1 }]).length === 1, 'a confirmed output is spendable');
check(spendable([{ confirmations: 0, txlock: true }]).length === 1, 'an InstantSend-locked output is spendable without a confirmation');
check(spendable([{ confirmations: 0, txlock: false }]).length === 0, 'a plain unconfirmed output is not');
check(totalDuffs([{ satoshis: 5 }, { satoshis: 7 }]) === 12, 'totalDuffs adds up');

console.log(`\n${failed === 0 ? '✅ ALL PASSED' : `❌ ${failed} FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
