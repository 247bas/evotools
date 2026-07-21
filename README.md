# evotools ◈

**Tools that make building on the Dash Evolution chain approachable.**

Creating an identity, funding it, publishing a contract — the first steps on
Dash Platform trip up nearly everyone. evotools is a growing set of small,
focused tools that remove those hurdles one at a time, plus a hub that ties them
together. Testnet-first, open source, by [247bas](https://github.com/247bas).

## Tools

| Tool | What it does | Status |
|------|--------------|--------|
| [Onboard](public/onboard/) | Wallet → fund → identity → `.dash` name → ready `.env` | Live |
| [Playground](public/playground/) | Run the cookbook recipes live in the browser | Live |
| [Explorer](public/explorer/) | Look up identities, DPNS names, contracts and documents, with proofs | Live |
| [Cookbook](https://github.com/247bas/evo-cookbook) | Verified, runnable `@dashevo/evo-sdk` v4 recipes | Live (own repo) |
| [create-evo-app](https://github.com/247bas/create-evo-app) | Scaffold a Dash Platform app: `npm create evo-app` | Live (own repo) |
| dash-name | Claim your `.dash` username with a clean UI | Planned |

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
│  │  └─ vendor/evo-sdk.module.js   @dashevo/evo-sdk v4, shared by all tools
│  └─ onboard/           → /onboard   (playground, explorer, name … as they ship)
├─ wrangler.jsonc        assets.directory = "public"
└─ package.json
```

Each web tool imports `/shared/theme.css`, `/shared/nav.js`, and the SDK from
`../../shared/vendor/`. Adding a tool is a new folder + a card on the hub.

## Run locally

```bash
npm install            # only to (re)vendor the SDK; the site itself has no deps
npm run serve          # serves public/ at http://localhost:8000  (try /onboard/)
npm run vendor         # re-copy the SDK into public/shared/vendor after an update
npm run test:onboard   # headless check of onboard's core flow against testnet
```

## Deploy

Cloudflare Workers static assets, connected to this GitHub repo. No build
command; `wrangler.jsonc` serves the `public/` directory, so `.git`,
`node_modules` and tooling stay out of the upload. Deploy command:
`npx wrangler deploy`. Custom domain: evotools.dev.

## Credit

Built on [PastaPastaPasta](https://github.com/PastaPastaPasta)'s public testnet
infrastructure (the Dash Bridge). Uses
[`@dashevo/evo-sdk`](https://www.npmjs.com/package/@dashevo/evo-sdk) v4.

## License

MIT
