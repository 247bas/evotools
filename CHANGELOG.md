# Changelog

evotools is a continuously deployed static site, so versions mark milestones
rather than installable releases.

## Unreleased

- **A claimed contested name no longer looks like a failed one.** Registering a
  short name puts it into a two-week masternode vote, and until that ends the
  name resolves to nobody — so the check for "did it work?" said no, and pressing
  Register again ran into the network refusing a second claim ("already present
  in a contest"). A claim that reached the chain is now reported as what it is:
  in a contest, with the date the vote ends and how many identities are competing
  for it. Onboard, dash-name and the explorer all say so, including when you look
  up somebody else's open contest — every availability check calls those names
  free, because technically nobody owns them yet.
- **The last onboard screen proves its own keys.** The phrase it hands you is
  useless if it is not the one the identity carries, and it could quietly become
  that: coming back through the first screen regenerated the identity phrase,
  even one you had supplied yourself, leaving a `.env` that looks normal and
  opens nothing. A phrase you brought stays put now, and the final screen checks
  both halves against the network — that the phrase derives the keys shown, and
  that those keys are the ones the identity actually has.
- **The site fits a phone screen.** Tapping a field in mobile Safari zoomed the
  page in and left it zoomed, which is what put text against the edge of the
  screen; controls are 16px below 760px now, the size iOS needs to leave the zoom
  alone. The name field could also push the layout wider than the screen, cards
  hand some of their padding back to the text on narrow screens, and a recovery
  phrase wraps between words instead of halfway through one.
- **Credits can be topped up from DASH without leaving the page.** Needing more
  credits meant walking through the onboard wizard — a flow about creating an
  identity, which you already have. The conversion lives in the credits tool now,
  including the recovery for one that was interrupted. Onboard keeps its own copy
  for people arriving with nothing.
- **The round trip is closed.** DASH goes in through an asset lock and comes
  back out through an asset unlock, both verified on mainnet — so credits are no
  longer a one-way door.
- **A credits tool.** Topping up an identity was buried at the end of the onboard
  wizard and inside dash-name's claim panel — reachable only if you were already
  doing something else. It has its own page now: look an identity up by id or
  name, see what it holds and which keys it has, then top it up from a platform
  address, pay out to one, move credits between addresses, or withdraw back to
  layer 1. The in-flow versions stay where they are; this is the front door.

- **Credits can go into an identity, not just out of it.** Minting keeps a
  reserve back on the funding address, and until now it stayed there — under a
  key you probably wanted to throw away. Onboard offers to move the remainder in
  when you are done, and dash-name can top up any identity from a platform
  address, which is what you need when a run of name registrations empties one
  halfway.

- **A name registration can be picked up where it left off.** DPNS is two steps,
  and the salt tying them together used to be invented inside the SDK and thrown
  away — so a failure in between stranded the preorder along with its fee, which
  for a contested name is 0.2 DASH. The salt is now derived from your key, so
  running the registration again recomputes it and finishes against the preorder
  you already paid for. Both onboard and dash-name register this way.

- **The second funding route works too.** Moving credits from an identity you
  already own onto a platform address was code-complete but untried; it turned
  out the SDK wants the fetched identity rather than its id, and said so with an
  error that names neither. Fixed and verified on testnet, guard included.
- **A closed tab no longer loses a conversion.** Coins that reached the chain as
  an asset lock stay claimable until Platform is handed a proof, so the funding
  step can now look for unfinished conversions and complete them. Nothing is
  stored for this — the chain is asked, and the key is enough to recognise which
  locks pay you. Locks that were already credited say so instead of erroring.
- **InstantSend counts.** A payment that is locked but not yet mined is already
  final on Dash, so the funding step converts it straight away instead of waiting
  out a block first. That is the difference between a few seconds and a few
  minutes before anything can start.
- **Getting onto Platform no longer needs Dash Evo Tool.** The funding key's
  ordinary Dash address can now be paid from any wallet, and onboard turns those
  coins into Platform credits itself: it builds and signs the asset lock with a
  vendored dashcore-lib bundle, broadcasts through a public Insight instance,
  waits for the block to be chain-locked and hands Platform a chain proof. Same
  code on both networks, so the walk-through you do on testnet with free coins is
  the one that runs on mainnet with real ones. Verified end to end on both:
  testnet in the browser, mainnet headless (200,000 duffs → 186,374,760 credits).
  A node that answers badly mid-wait no longer aborts a conversion that is nearly
  done — the lock is on chain and keeps.
- **keygen shows the Dash address too.** One key, two encodings: the `X…`/`y…`
  address any wallet can pay (that is the one in the QR now) and the `dash1…`
  platform address where the credits land.
- **onboard says how many things you have to keep.** Supply your own funding key
  and the phrase on screen only covers the identity — so the page now derives
  what the phrase would produce, compares it with the key in use, and every line
  in that step follows the answer instead of the network.
- **keygen — a sixth tool.** Derives the funding address and the five DIP-13
  identity keys from one phrase, with no network at all: no `EvoSDK` instance, no
  `connect()`. "Download offline copy" packs the whole tool, SDK included, into
  one ~10 MB HTML file whose own policy carries `connect-src 'none'`, so it can
  be opened on a machine that never goes online. The address comes with a QR
  (self-written encoder — a CDN is not an option under that policy, and it is
  cross-checked against a reference library and read back with a decoder), the
  private keys sit behind a fold but always print, and an SDK snippet shows the
  exact calls. The smoke test derives, compares against onboard key for key, and
  runs the snippet it shows to prove it is not fiction.
- **Onboard takes a phrase you made elsewhere.** On mainnet the identity keys no
  longer have to come from the browser tab: paste the phrase from keygen and the
  identity carries exactly those five keys. The funding address now derives while
  you type, and a disabled "Continue" says which of the two things is missing.

- **"Verify with proof" is on by default** in the explorer. Measured across
  identity, contract, document and shielded-pool queries on both networks, the
  proven path costs nothing worth saving: on mainnet 135 vs 185 ms for an
  identity, 146 vs 151 ms for ten documents, and on testnet the difference is
  inside the noise. So every lookup now comes back verified against a
  quorum-signed state root unless you turn it off. Permalinks carry `proof=0` as
  well as `proof=1`, so a link made with proofs off stays off.
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
