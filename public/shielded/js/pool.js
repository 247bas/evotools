// What the chain says about the pool: its balance, how many notes it holds, the
// anchors a proof may point at, and the protocol version it runs. Reads only.
// Building a shielded transition needs the Orchard prover, which the WASM SDK
// leaves out on purpose (dashpay/platform#3235).

import { getSdkFor } from './sdk.js';

// The note query only accepts startIndex 0 and has no count endpoint, so the
// total comes from fetching the set with a ceiling.
export const NOTE_CAP = 8192;

const hex = (u8) => (u8 ? Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('') : '');

export async function poolState(network) {
  const sdk = await getSdkFor(network);
  const [balance, anchors, latest, epoch, notes] = await Promise.all([
    sdk.shielded.poolState(),
    sdk.shielded.anchors().catch(() => []),
    sdk.shielded.mostRecentAnchor().catch(() => undefined),
    sdk.epoch.current().catch(() => null),
    sdk.shielded.encryptedNotes(0n, NOTE_CAP).catch(() => null),
  ]);
  return {
    network,
    balance: balance ?? 0n,
    anchors: anchors.length,
    latestAnchor: hex(latest),
    notes: notes ? notes.length : undefined,
    notesCapped: notes ? notes.length >= NOTE_CAP : false,
    noteBytes: notes?.[0]?.encryptedNote?.length,
    protocolVersion: epoch?.protocolVersion,
    epoch: epoch?.index,
  };
}
