# Changelog

evotools is a continuously deployed static site, so versions mark milestones
rather than installable releases.

## Unreleased

- **A page for the shielded pool.** `/shielded` reads the Orchard pool on both
  networks: balance, notes, anchors and protocol from the chain through the SDK,
  and from pshenmic's index the count and amount per transition type and a
  week-by-week series of credits in and out, drawn as bars. It lays out the six
  shielded transitions with the minimum each costs, computed from the constants
  Platform runs on (proof check, per-action fee, storage per action, the 0.2
  DASH cap), says what is public and what is not, and checks whether a pasted
  address is a shielded one (`dash1z…`, type byte `0x10`, 43 bytes) without
  looking anything up, since a shielded address never appears on chain. The
  bech32m lives in `js/address.js` in forty lines rather than the 10 MB SDK, and
  the smoke test pins it to the SDK's own encoder through the donation address.
  Two things learned building it: the index's history endpoint drops its last
  bucket when the range does not divide evenly by the bucket count, silently
  losing a third of the credits on a "since launch" chart, so the series ends on
  a whole week; and in minus out on the index runs a shade above the chain's
  balance because pool-paid fees are carved from the notes and never counted as
  an out. `npm run test:shielded` reads the live protocol version and fails the
  moment it is no longer 13, which is when the fee constants need re-reading.
  The map's legend stopped claiming that no software ships shielded moves;
  Dash Evo Tool and Dash Desktop do.

- **A donation address, and an about page that had stopped being true.** The
  page listed three tools and filed a scaffolder, an explorer and a username
  claim under "next up" — all shipped months ago — and credited none of the
  infrastructure it runs on. Both fixed. The donation block states one key in
  both spellings: the layer-1 address any wallet can pay, and the `dash1…` the
  same key has on Platform, which is not a second address but offline
  arithmetic, with a link to the map that shows it. The addresses live in the
  markup, so the page still shows something payable with JavaScript off; the
  script only draws the QR and copies. `npm run test:about` checks the pair in
  both directions against the map's own derivation.

- **The suite eats its own cooking on the front page.** The hub now shows
  `evotools.dash` and the identity behind it, each linking into the tools on
  this site that read them off mainnet — the map for the name, the explorer
  (with proof on) for the identity. The readmes carry the real mark instead of
  the `◈` that stood in for it, and the main one carries the full wordmark with
  "evo" in Dash blue — GitHub strips style out of markdown, so the only way to
  colour it is to render it, which `npm run og` now does in a light and a dark
  variant that `<picture>` switches between.
- **The credit section names what the site actually runs on.** It thanked
  PastaPastaPasta for "public testnet infrastructure" and listed the SDK, which
  was both vague and incomplete: onboard links to the Dash Bridge rather than
  building on it, and pshenmic's Platform Explorer API — which `/contests` and
  `/map` genuinely depend on, because Platform can prove a named thing but
  cannot list things — went unmentioned, as did the Insight API and the
  masternodes answering every call. Each entry now says what it is used for.

## 2.1.0 — 2026-08-13

A key pasted into the wrong box is now refused by the box, and a map worth
reading is a map worth sending.

- **The map can be handed to somebody.** It now offers a worked example per
  network (`evotools.dash` on mainnet, `247bas.dash` on testnet — both fill every
  box, including the funding trace), and it keeps the query in the URL, so
  `?q=evotools.dash&net=mainnet` opens the same map for the person you send it
  to. The link is built by `linkFor()` in `map.js` rather than in the DOM layer,
  which is what lets the smoke test hold it to its rules: a secret is never
  written into the address bar, the network comes out of a fixed list of two
  instead of the URL, nothing over 120 characters is carried, and every character
  is percent-encoded. A link that arrives carrying a key is refused and stripped
  from the address bar. The page builds every node with `textContent`, so a query
  is text on the way in and on the way out.
- **The map is a diagram again, not a menu.** The asset lock, the withdrawal and
  the fee row used to be links to `/onboard/`, `/credits/` and `/name/`. A reader
  following the money does not want to leave the page mid-thought, so the arrows
  are arrows now. The invisible click targets and their hover styling went with
  them.
- **A pasted key is refused by the field, not by the SDK.** Every tool that takes
  an identifier now runs its input past `shared/secrets.js` first. The reason is
  narrower than "be careful with keys": a WIF is 52 characters of base58, which
  DPNS accepts as a valid label, so an unguarded name lookup would carry a pasted
  key to a Platform node — and in the explorer, `syncUrl` would write it into the
  address bar and the browser's history on the way there. dash-name's Identity ID
  field, its name field, the explorer's search box and credits' identity box all
  empty themselves now and say which box the key belongs in. `/map` keeps its own
  wording and shares the detector. The identity ID field was already safe by
  accident (the SDK rejects the length locally, in about 1 ms, before any
  connection opens) but reported it as "byte length not 32 bytes", which reads
  like a typo rather than a warning.
- **The homepage credits are links.** "open source" points at the repo, "247bas"
  at X.

## 2.0.0 — 2026-07-28

Getting onto Dash Platform no longer needs any other software, and the suite now
explains the chain instead of only operating on it. Four tools joined the four
from 1.0: **keygen** (cold keys, with an offline copy you can download and run
disconnected), **credits** (an identity's balance and every way to move it),
**contests** (every `.dash` name masternodes are voting on, and every one they
decided) and **map** (where DASH, credits and identities sit, what each move
costs, and where any identity's money came from). Layer-1 funding, name
registration and withdrawal all run in the browser now, each verified with real
money on mainnet.


- **A map of where the money is.** Two chains carry the same money under
  different rules, and nothing showed that: you cannot send DASH to a `dash1…`
  address, an identity holds no coins, and credits only leave through a
  withdrawal. `/map` draws the places value can sit and what every move between
  them costs, and fills them in from anything public you paste — a name, an
  address, an identity ID. It never asks for a phrase or a key and does not need
  one: an address already carries the key hash that finds the identity it opens.
  Given an identity it also walks backwards to the money that paid for it,
  covering all three routes mainnet uses (a platform address, an asset lock, or
  the shielded pool), and one click further to the layer-1 transaction behind
  that. A claim still in a masternode vote is listed too, with the 0.2 DASH
  parked on its preorder that no balance counts.
- **Contest tallies now come from the chain when you look closely.** The list is
  the index's word, which is fast and, for open contests, exactly right. Finished
  ones can drift — thedesert1ynx reads 61 votes there against 51 on chain — so
  opening a row asks the chain and says plainly when the two disagree.

- **The chain has the last word on whether a name registered.** A node that
  cannot answer ("Tenderdash is not available") has usually still accepted the
  transition, and the tool called that a failure — `pizza247.dash` was registered
  and reported as broken in the same breath. Both steps now ask the chain what
  actually happened before believing an error, with a moment's patience for the
  block to land. A real failure keeps the node's own words and says plainly that
  running it again costs nothing extra.
- **A contests page.** Which `.dash` names are being voted on, and which ones the
  masternodes already settled — the two questions the other tools can only answer
  one name at a time. Open contests are sorted by which ends soonest; decided ones
  are paginated back through 700-odd names, each showing votes for, lock and
  abstain, when it was claimed and when it was settled. Expanding a row lists the
  contenders with their own tallies and marks the winner, or the one leading while
  the vote runs. This is the first page here that leans on an index rather than
  the chain — a list is exactly what the SDK cannot produce — so every row links
  back into our explorer, which re-reads that name from the chain with a proof.
- **The `.env` says which key it hands you.** `EVO_PRIVATE_WIF` is the identity's
  CRITICAL key — the one that signs — but the name reads like the funding key,
  which is a different key on a different path that only pays. Comparing the two
  and finding them different made a correct handover look wrong. The file now
  names the key and its path, and the key list marks the one that ends up in the
  `.env`.
- **The funding address can be scanned.** Money for a new identity comes off a
  phone or an exchange withdrawal page, and both of those scan rather than type.
  Onboard's funding step shows the key's Dash address as a QR next to it — the
  plain address, since exchange forms tend to choke on a `dash:` URI. The QR
  encoder moved to `shared/` now that two tools use it; keygen still inlines it
  into its offline copy. Its copy button also did nothing at all until now, and
  copying falls back to a selection when the clipboard API refuses — which is
  what it does after a detour to a wallet, because the page lost focus.
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
