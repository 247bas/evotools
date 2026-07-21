# evo-onboard — plan & architecture

A guided web onboarding for Dash Platform (Evolution). It takes someone from
"I have nothing" to a funded testnet identity with a `.dash` username, and hands
off a ready-to-use `.env` for the [evo-cookbook](https://github.com/247bas/evo-cookbook).

Goal: remove the first wall every Dash Platform beginner hits — funding and
identity creation — and make it feel obvious. Lead by example.

## Why the Platform Address flow (not asset locks)

Since Jan 2026 the v4 SDK can create an identity **without** Dash Core or
asset-lock transactions. You derive a platform address (bech32m, `tdash1…`),
fund it, and call `sdk.addresses.createIdentity()`. This is what evo-cookbook
recipe 10 uses, so evo-onboard produces exactly what the cookbook consumes.

Pasta's older asset-lock faucet (`faucet.thepasta.org`, evo-sdk 2.1.3) is the
previous route — studied in `../../_reference/dash-faucet`, kept for reference only.

## Architecture — pure static site, no backend

`evo-sdk.module.js` (v4) is a self-contained webpack bundle with the WASM
inlined as base64 (verified: no bare imports, no runtime `.wasm` fetch). So we
serve that one file and import it directly in the browser. No bundler, no WASM
plugin. Deploy = upload the folder to Cloudflare Pages, no build command.

Funding is a handoff to Pasta's **Dash Bridge** (`bridge.thepasta.org`), a
client-side app on GitHub Pages. It takes `?address=` to prefill. We open it in a
new tab and poll the balance live via the SDK. Everything else runs client-side;
private keys never leave the browser.

This tool lives in the `evotools` monorepo, served at `/onboard`. Shared theme,
nav and the vendored SDK live one level up in `evotools/shared/`.

```
evotools/
  shared/
    theme.css                 # design tokens + shared components
    nav.js                    # shared top nav + footer
    vendor/evo-sdk.module.js  # the SDK, shared by all tools
  onboard/
    index.html                # the wizard
    css/onboard.css           # onboard-specific styles
    js/sdk.js                 # lazy-load shared SDK, connect, helpers
    js/wallet.js              # mnemonic + address + DIP-13 key derivation (recipe 10)
    js/platform.js            # createIdentity / registerName / balance
    js/app.js                 # step orchestration + UI wiring
    test/smoke.mjs  PLAN.md  README.md
```

`sdk.js` imports `../../shared/vendor/evo-sdk.module.js`. From the repo root,
`npm run vendor` re-copies the SDK into `shared/vendor` after an SDK update.

## The five steps

1. **Wallet** — `wallet.generateMnemonic()`, derive the funding address
   (BIP44 m/44'/1'/0'/0/0), show it as bech32m. Mnemonic shown once with a
   testnet-only warning.
2. **Fund** — open `bridge.thepasta.org/?address=<addr>`, poll
   `sdk.addresses.get(addr).balance` until it clears the minimum.
3. **Identity** — derive the 5 DIP-13 keys, build the `Identity` shell +
   `IdentitySigner` + `PlatformAddressSigner`, call
   `sdk.addresses.createIdentity({ identity, inputs, identitySigner, addressSigner })`.
4. **Username** — validate + check availability live, then
   `sdk.dpns.registerName({ label, identity, identityKey, signer })`.
5. **Handoff** — emit `.env` (`EVO_MNEMONIC`, `EVO_IDENTITY_ID`,
   `EVO_PRIVATE_WIF`) matching cookbook recipes 09/10, plus explorer links and
   the "clone the cookbook, drop this in, run recipe 09" next step.

## Exact v4 API (pinned from the installed SDK, @dashevo/evo-sdk 4.0.0)

Named exports used: `EvoSDK, wallet, PrivateKey, PlatformAddressSigner,
Identity, Identifier, IdentityPublicKeyInCreation, IdentitySigner, KeyType,
Purpose, SecurityLevel`.

Standard 5-key DIP-13 layout (`m/9'/1'/5'/0'/0'/{identity}'/{key}'`):

| keyId | purpose | securityLevel |
|-------|---------|---------------|
| 0 | AUTHENTICATION | MASTER |
| 1 | AUTHENTICATION | HIGH |
| 2 | AUTHENTICATION | CRITICAL |
| 3 | TRANSFER | CRITICAL |
| 4 | ENCRYPTION | MEDIUM |

`createIdentity` options: `{ identity, inputs: [{ address, amount }],
identitySigner, addressSigner, changeOutput?, settings? }`.
Recipe 10 passes plain `{ address, amount }` inputs (nonces fetched
automatically) — mirror that.

`dpns.registerName` options: `{ label, identity, identityKey, signer,
preorderCallback? }`. `identity` must be an `Identity` object (use the one
`createIdentity` returns, or `sdk.identities.get(id)`). `identityKey` must be one
of that identity's public keys and match the WIF in `signer`. We use the CRITICAL
auth key (keyId 2) — the same key recipe 09 uses to create documents, and the
one the handoff `.env` exports.

## Known gotchas (from the cookbook, keep in mind)

- `createIdentity` can throw a proof-verification error even though the identity
  WAS created (dashpay/platform#3095). Parse the id from
  `/proof returned identity (\w+) but/` and continue.
- Key getters return enum **names** as strings (`'AUTHENTICATION'`, `'CRITICAL'`),
  not numbers. Compare strings.
- `identities.getKeys` needs `request: { type: 'all' }`.
- Credits are bigint. 1 tDASH = 100,000,000,000 credits. A contract publish
  costs ~13,000,100,000 (~0.13 tDASH) — fund generously.

## Units & amounts (tweak in js/app.js)

- `MIN_FUND` — minimum address balance before "Create identity" enables.
- `RESERVE` — credits left on the input for fees; identity is funded with
  `balance - RESERVE`.
- `RECOMMENDED` — 0.5 tDASH, shown as the target for an identity that can also
  publish contracts from the cookbook.

## Credit

Built on Pasta's public testnet infrastructure (Dash Bridge + faucet). The
asset-lock faucet source in `../../_reference/` is MIT-licensed by PastaPastaPasta.

## Status

- [x] Research: faucet, bridge, v4 SDK APIs, browser WASM
- [x] Static site: wallet → fund → identity → username → handoff
- [x] Verify core flow in Node — `node test/smoke.mjs` passes against testnet:
      wallet + address, DIP-13 keys, identity-shell + signer construction,
      connect + balance read, DPNS valid/available/contested checks
- [x] Restructured into the `evotools` monorepo (served at `/onboard`); smoke
      test still green from the new layout, all assets serve over HTTP
- [ ] Verify page loads + SDK inits in a browser (Chrome extension wasn't
      available in the build session — needs a manual check)
- [ ] Funded path (createIdentity + registerName) — needs real testnet credits
      from the Bridge; only testable interactively
- [ ] Deploy to Cloudflare Pages (no build command; publish the `evotools` folder)

## Run locally

From the repo root (`evotools/`):

```bash
npm install            # only to (re)vendor the SDK; the site itself has no deps
npm run serve          # python3 -m http.server 8000  → open /onboard/
npm run test:onboard   # node onboard/test/smoke.mjs — verifies the core flow
```
