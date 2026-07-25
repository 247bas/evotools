# Changelog

evotools is a continuously deployed static site, so versions mark milestones
rather than installable releases.

## Unreleased

- **Shielded pool panel in the explorer** — Platform runs an Orchard shielded
  credit pool, and it is live on both networks. The panel shows testnet and
  mainnet side by side: total balance, note count, anchors and the latest
  commitment-tree anchor, plus a nullifier spent-check. "Verify with proof"
  applies here too, via `poolStateWithProof`. Reads only — building a shielded
  transition needs the Orchard prover, which the WASM SDK leaves out. Note that
  `encryptedNotes` only accepts startIndex 0 (ranges must be MMR-aligned), so the
  note count is one capped request rather than real paging.
- **Onboard runs on mainnet** — with a different shape than testnet, because the
  risk is different. Testnet still generates a wallet and points at the Dash
  Bridge. Mainnet asks for the WIF of a key you already control, derives its
  platform address (`dash1…`), and only generates the keys of the identity being
  created. There is no faucet on mainnet, so the funding step can move credits
  onto that address from an identity you already own (`transferFromIdentity`,
  signed with its TRANSFER key), with Dash Evo Tool's asset lock as the other
  route. Amounts, units, explorer links and the contested-name warning follow the
  selected network.
- **dash-name claims any identity** — registration no longer insists on a
  CRITICAL authentication key. DPNS documents may be signed by an AUTHENTICATION
  key at CRITICAL, HIGH or MEDIUM level (a MASTER key never signs documents), and
  the tool now picks the key your WIF actually belongs to via
  `validatePrivateKey`, instead of guessing one. Identities made outside Onboard
  (Dash Evo Tool, mobile wallets) typically carry a HIGH key and were rejected
  before this.
- **Locked names** — dash-name and the explorer no longer call a name available
  when its contest ended in a lock. A lock leaves the name without an owner, so
  `isNameAvailable()` says true while nobody can ever claim it (on mainnet: pay,
  bank, cash, money, wallet, usd, usa, app, mail). Both tools now read
  `winner.kind` from the vote state, show the lock and its tallies, and
  `registerName()` refuses a locked name before it can cost you the 0.2 DASH
  contested-name fee.
- **Playground** — a testnet / mainnet toggle. It re-points the recipe's `EvoSDK`
  factory calls to the chosen network (comments, log strings and example data are
  left as-is), with a real-funds warning when mainnet is selected.
- **Mobile** — the top nav collapses into a hamburger menu below 760px instead of
  overflowing. The fixed "testnet" badge is hidden on the playground (it has its
  own network toggle now).
- **Visual polish** — a distinct line icon per tool on the hub (inline SVG, Dash
  blue), a soft blue hero glow and a faint dot-grid texture site-wide, a "Built
  on" pill in the hero, and richer card hover (accent border + glow).
- **Logo** — a real mark: an outline diamond holding a `>` prompt, with the
  wordmark's "evo" in Dash blue. Rolled through the nav, hub hero, `favicon.svg`,
  the apple-touch icon and the social cards.
- **dash-name** — an "SDK snippet" dropdown (like the explorer) under the name
  check and in the claim panel, showing the exact evo-sdk calls with a copy button.

## 1.0.0 — 2026-07-21

The first complete release. The full suite is live at **evotools.dev**.

- **Onboard** — wallet → fund via the Dash Bridge → identity → `.dash` name → a ready `.env` (testnet).
- **Playground** — run the evo-cookbook recipes live in the browser against testnet, no install.
- **Explorer** — look up identities, `.dash` names, data contracts, tokens and documents on **testnet and mainnet**; "verify with proof", auto-detect search, document queries + count, a DPNS contest viewer, permalinks, and a state-transition decoder/broadcast.
- **dash-name** — check a `.dash` name (valid / available / taken / contested + vote state) and claim it for an existing identity, on testnet or mainnet.
- Hub homepage, shared design system + top nav, a shared vendored `@dashevo/evo-sdk` v4 (WASM inlined), SVG favicon, OG/Twitter social cards, and security headers.

Companion repos: [evo-cookbook](https://github.com/247bas/evo-cookbook) (verified v4 SDK recipes) and [create-evo-app](https://github.com/247bas/create-evo-app) (`npm create evo-app`).
