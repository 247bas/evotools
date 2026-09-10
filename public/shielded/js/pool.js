// What the chain says about the pool: its balance, how many notes it holds, the
// anchors a proof may point at, and the protocol version it runs. Reads only.
// Building a shielded transition needs the Orchard prover, which the WASM SDK
// leaves out on purpose (dashpay/platform#3235).

import { getSdkFor } from './sdk.js';
import { countNotes } from '../../shared/shielded-notes.js';

const hex = (u8) => (u8 ? Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('') : '');

export async function poolState(network) {
  const sdk = await getSdkFor(network);
  const [balance, anchors, latest, epoch, notes] = await Promise.all([
    sdk.shielded.poolState(),
    sdk.shielded.anchors().catch(() => []),
    sdk.shielded.mostRecentAnchor().catch(() => undefined),
    sdk.epoch.current().catch(() => null),
    countNotes(sdk).catch(() => null),
  ]);
  return {
    network,
    balance: balance ?? 0n,
    anchors: anchors.length,
    latestAnchor: hex(latest),
    notes: notes ? notes.count : undefined,
    notesExact: notes ? notes.exact : false,
    noteBytes: notes?.sample?.encryptedNote?.length,
    protocolVersion: epoch?.protocolVersion,
    epoch: epoch?.index,
  };
}
