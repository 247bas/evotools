<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/wordmark-dark.png">
    <img src=".github/wordmark-light.png" alt="evotools" width="186" height="48">
  </picture>
</h1>

**Tools that make building on the Dash Evolution chain approachable.**

Creating an identity, funding it, publishing a contract — the first steps on
Dash Platform trip up nearly everyone. evotools is a set of small, focused tools
that remove those hurdles one at a time, plus a hub that ties them together.
Every tool runs on testnet and mainnet, entirely in the browser: no server holds
your keys, because there is no server. Open source, by
[247bas](https://github.com/247bas).

Live at **[evotools.dev](https://evotools.dev)** · `evotools.dash` on Platform.

## Tools

| Tool | What it does | Status |
|------|--------------|--------|
| [Map](public/map/) | Where DASH, credits and identities sit, what each move costs, and where any identity's money came from | Live |
| [Onboard](public/onboard/) | Wallet → fund → identity → `.dash` name → ready `.env` | Live |
| [Keygen](public/keygen/) | One phrase → funding address + the five DIP-13 identity keys, fully offline, with a downloadable offline copy | Live |
| [Credits](public/credits/) | An identity's balance and every way to move it: top up, pay out, convert, withdraw to layer 1 | Live |
| [Playground](public/playground/) | Run the cookbook recipes live in the browser | Live |
| [Explorer](public/explorer/) | Identities, DPNS names, contracts, tokens, documents and the shielded pool, with proofs | Live |
| [dash-name](public/name/) | Check and claim a `.dash` username for your identity | Live |
| [Contests](public/contests/) | Every `.dash` name masternodes are voting on, and every one they decided | Live |
| [Cookbook](https://github.com/247bas/evo-cookbook) | Verified, runnable `@dashevo/evo-sdk` v4 recipes | Live (own repo) |
| [create-evo-app](https://github.com/247bas/create-evo-app) | Scaffold a Dash Platform app: `npm create evo-app` | Live (own repo) |

Getting onto Platform needs no other software: layer-1 funding, identity
creation, name registration and withdrawal all run here, each verified with real
money on mainnet.

## Structure

A pure static site — no build step. One folder per tool, a shared design system
and a shared vendored SDK.

```
evotools/
├─ public/               the deployed site (Cloudflare Workers static assets)
│  ├─ index.html         the hub homepage
│  ├─ shared/
│  │  ├─ theme.css       design tokens + shared components
│  │  ├─ nav.js          injects the top nav + footer on every page
│  │  ├─ secrets.js      one rule for "this is a key, refuse it"
│  │  ├─ assetlock.js    build a layer-1 asset lock in the browser
│  │  ├─ dpns-register.js   resumable .dash registration (derived salt)
│  │  └─ vendor/         @dashevo/evo-sdk v4 + dashcore-lib, shared by all tools
│  ├─ map/               → /map
│  ├─ onboard/           → /onboard
│  ├─ keygen/            → /keygen
│  ├─ credits/           → /credits
│  ├─ playground/        → /playground
│  ├─ explorer/          → /explorer
│  ├─ name/              → /name   (dash-name)
│  ├─ contests/          → /contests
│  └─ about/             → /about
├─ wrangler.jsonc        assets.directory = "public"
└─ package.json
```

Each web tool imports `/shared/theme.css`, `/shared/nav.js`, and the SDK from
`../../shared/vendor/`. Adding a tool is a new folder + a card on the hub.

## Keys never leave the browser

Every tool that signs does so client-side, and every box that takes an
identifier refuses a key before it goes anywhere. That guard is one shared rule
(`public/shared/secrets.js`), because the trap is not obvious: a WIF is 52
characters of base58, which DPNS accepts as a valid username — so an unguarded
name lookup would carry a pasted key to a Platform node. The map never asks for
a key at all.

## Run locally

```bash
npm install            # only to (re)vendor the SDK; the site itself has no deps
npm run serve          # serves public/ at http://localhost:8000

npm run test:map       # address arithmetic, the shareable link, live traces
npm run test:onboard   # onboard's core flow against testnet
npm run test:explorer  # the explorer lookups
npm run test:name      # dash-name check/register + the secret guards
npm run test:credits   # the credits guards and live reads
npm run test:contests  # the contests list and its indexer quirks
npm run test:keygen    # offline key derivation + builds the offline copy
npm run test:assetlock # builds a real signed asset lock
npm run test:dpns      # salt derivation for resumable registration

npm run vendor         # re-copy the SDK into public/shared/vendor after an update
npm run og             # regenerate the OG images
```

The tests read the live chain, so they need a connection and they report what is
actually there rather than a fixture.

## Deploy

Cloudflare Workers static assets, connected to this GitHub repo: pushing to
`main` deploys. No build command; `wrangler.jsonc` serves the `public/`
directory, so `.git`, `node_modules` and tooling stay out of the upload. Custom
domain: evotools.dev.

Adding a dependency without committing the updated `package-lock.json` makes the
build's `npm ci` fail, and the deploy then silently stalls on the previous
build — always commit the lockfile with a dependency change.

## Credit

Built on [PastaPastaPasta](https://github.com/PastaPastaPasta)'s public testnet
infrastructure (the Dash Bridge). Uses
[`@dashevo/evo-sdk`](https://www.npmjs.com/package/@dashevo/evo-sdk) v4.

## License

MIT
