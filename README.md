# evotools ◈

**Tools that make building on the Dash Evolution chain approachable.**

Creating an identity, funding it, publishing a contract — the first steps on
Dash Platform trip up nearly everyone. evotools is a growing set of small,
focused tools that remove those hurdles one at a time, plus a hub that ties them
together. Testnet-first, open source, by [247bas](https://github.com/247bas).

## Tools

| Tool | What it does | Status |
|------|--------------|--------|
| [Onboard](onboard/) | Wallet → fund → identity → `.dash` name → ready `.env` | Live |
| [Cookbook](https://github.com/247bas/evo-cookbook) | Verified, runnable `@dashevo/evo-sdk` v4 recipes | Live (own repo) |
| create-evo-app | Scaffold a working Dash Platform app in one command | Planned |
| Playground | Run the cookbook recipes live in the browser | Planned |
| Explorer | Browse identities, contracts, documents, DPNS names | Planned |
| dash-name | Claim your `.dash` username with a clean UI | Planned |

## Structure

A pure static site — no build step. One folder per tool, a shared design system
and a shared vendored SDK.

```
evotools/
├─ index.html            the hub homepage
├─ shared/
│  ├─ theme.css          design tokens + shared components
│  ├─ nav.js             injects the top nav + footer on every page
│  └─ vendor/evo-sdk.module.js   @dashevo/evo-sdk v4, shared by all tools
├─ onboard/              → /onboard
└─ (playground, explorer, name … as they ship)
```

Each web tool imports `/shared/theme.css`, `/shared/nav.js`, and the SDK from
`../../shared/vendor/`. Adding a tool is a new folder + a card on the hub.

## Run locally

```bash
npm install            # only to (re)vendor the SDK; the site itself has no deps
npm run serve          # python3 -m http.server 8000  → http://localhost:8000
npm run vendor         # re-copy the SDK into shared/vendor after an SDK update
npm run test:onboard   # headless check of onboard's core flow against testnet
```

## Deploy

Cloudflare Pages, no build command — publish the folder. Root = `evotools/`, so
`/onboard/` and `/shared/…` resolve as-is.

## Credit

Built on [PastaPastaPasta](https://github.com/PastaPastaPasta)'s public testnet
infrastructure (the Dash Bridge). Uses
[`@dashevo/evo-sdk`](https://www.npmjs.com/package/@dashevo/evo-sdk) v4.

## License

MIT
