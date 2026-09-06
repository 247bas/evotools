// What a shielded move costs, from the constants Platform runs on.
//
// Two kinds of transition pay two different ways. The ones that enter the pool
// (Shield, Shield from asset lock) have a transparent side, so GroveDB meters
// their storage against it and the shielded part only adds the compute fee: one
// Halo 2 proof check per bundle plus a per-action share. The ones that leave or
// stay inside the pool (Shielded transfer, Unshield, Shielded withdrawal) have no
// balance to meter against, so their fee is carved out of the notes themselves
// and prices a flat storage estimate per action on top of the compute fee.
//
// Numbers read off dashpay/platform v4.1.1: `rs-dpp/src/shielded/mod.rs`,
// `compute_minimum_shielded_fee/v0/mod.rs`, validation constants v9 and fee
// storage v1. That is protocol 13, which both networks run at the time of
// writing. Protocol 14 rebalances the constants (#4467); the smoke test reads
// the live protocol version and shouts when it is no longer 13.

export const CREDITS_PER_DASH = 100_000_000_000n;
export const PROTOCOL_THESE_HOLD_FOR = 13;

export const FEES = {
  proofVerification: 100_000_000n,   // per bundle: the one Halo 2 proof
  perAction: 22_000_000n,            // per action: the marginal verification work
  storageBytesPerAction: 344n,       // a 216-byte note + its nullifier and tree writes
  withdrawalDocumentBytes: 4100n,    // the withdrawal document a Core payout inserts
  unshieldAddressBytes: 222n,        // the platform-address balance write
  creditsPerByte: 27_000n + 400n,    // disk + processing, fee storage v1
  implicitFeeCap: 20_000_000_000n,   // 0.2 DASH: a pool-paid fee may not exceed this
};

export const POOL = {
  anchorRetentionBlocks: 1000, // a proof must use an anchor from this window
  anchorPruningInterval: 100,  // old anchors are dropped every 100 blocks
  minimumNotesForOutgoing: 250, // no spend leaves the pool before it holds this many notes
  noteBytes: 216,              // Zcash Orchard's is ~692; the memo is 36 bytes here, not 512
  memoBytes: 36,               // a 4-byte type tag + a 32-byte payload
};

// Identity Create from Shielded Pool takes an exact denomination, per protocol.
export const DENOMINATIONS = {
  12: [10_000_000_000n, 30_000_000_000n, 50_000_000_000n, 100_000_000_000n],
  13: [3_000_000_000n, 10_000_000_000n, 25_000_000_000n, 50_000_000_000n, 100_000_000_000n],
};

// The Zcash-style state transition types, in the order the pool sees them.
export const TYPES = [
  { n: 15, key: 'SHIELD', name: 'Shield', from: 'platform address', to: 'pool', pays: 'address' },
  { n: 18, key: 'SHIELD_FROM_ASSET_LOCK', name: 'Shield from asset lock', from: 'layer 1', to: 'pool', pays: 'asset lock' },
  { n: 16, key: 'SHIELDED_TRANSFER', name: 'Shielded transfer', from: 'pool', to: 'pool', pays: 'pool' },
  { n: 17, key: 'UNSHIELD', name: 'Unshield', from: 'pool', to: 'platform address', pays: 'pool' },
  { n: 19, key: 'SHIELDED_WITHDRAWAL', name: 'Shielded withdrawal', from: 'pool', to: 'layer 1', pays: 'pool' },
  { n: 20, key: 'IDENTITY_CREATE_FROM_SHIELDED_POOL', name: 'Identity create from shielded pool', from: 'pool', to: 'new identity', pays: 'pool' },
];

const n = (x) => BigInt(x);

// compute_fee = proof_verification_fee + actions × processing_fee
export const computeFee = (actions) => FEES.proofVerification + n(actions) * FEES.perAction;
// min_fee = compute_fee + actions × 344 × (disk + processing)
export const minimumPoolFee = (actions) => computeFee(actions) + n(actions) * FEES.storageBytesPerAction * FEES.creditsPerByte;
export const unshieldFee = (actions) => minimumPoolFee(actions) + FEES.unshieldAddressBytes * FEES.creditsPerByte;
export const withdrawalFee = (actions) => minimumPoolFee(actions) + FEES.withdrawalDocumentBytes * FEES.creditsPerByte;

// The minimum for each type, at the action count a typical move needs: one
// output when entering (the note), two actions when spending (the spend and
// the change note).
export function minimumFor(key, actions) {
  switch (key) {
    case 'SHIELD':
    case 'SHIELD_FROM_ASSET_LOCK': return { credits: computeFee(actions ?? 1), plusStorage: true };
    case 'SHIELDED_TRANSFER':
    case 'IDENTITY_CREATE_FROM_SHIELDED_POOL': return { credits: minimumPoolFee(actions ?? 2), plusStorage: false };
    case 'UNSHIELD': return { credits: unshieldFee(actions ?? 2), plusStorage: false };
    case 'SHIELDED_WITHDRAWAL': return { credits: withdrawalFee(actions ?? 2), plusStorage: false };
    default: throw new Error(`unknown shielded type ${key}`);
  }
}

// Credits → DASH as a string, trimmed to what matters: "0.00163", "3646.26".
export function dash(credits, digits = 5) {
  const c = BigInt(credits ?? 0n);
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const whole = abs / CREDITS_PER_DASH;
  const frac = (abs % CREDITS_PER_DASH).toString().padStart(11, '0').slice(0, digits).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}
