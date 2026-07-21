# Onboard ◈ (evotools)

**From nothing to a funded Dash Platform identity with a `.dash` username — in your browser.**

Creating an identity is the first wall every Dash Platform beginner hits: you
can't just "sign up", the identity has to be funded first. Onboard walks through
every step and hands you a ready `.env` for the
[evo-cookbook](https://github.com/247bas/evo-cookbook) at the end.

1. **Wallet** — a testnet mnemonic + platform address, generated locally.
2. **Fund** — request testnet credits from the [Dash Bridge](https://bridge.thepasta.org/); the balance updates live.
3. **Identity** — minted from the funded address with `sdk.addresses.createIdentity()`.
4. **Username** — claim a `.dash` name via DPNS, with live availability checks.
5. **Handoff** — copy or download a `.env` (`EVO_MNEMONIC`, `EVO_IDENTITY_ID`, `EVO_PRIVATE_WIF`) that drops straight into the cookbook.

Keys are generated in the browser and never leave the page. Testnet only.

## How it works

Pure static — no backend. It uses [`@dashevo/evo-sdk`](https://www.npmjs.com/package/@dashevo/evo-sdk) v4,
whose WASM core is inlined in the vendored module (shared at
`../shared/vendor/`), so the browser imports one file and runs everything
client-side. Identity creation uses the v4 **Platform Address** flow (no Dash
Core, no asset locks). Funding is a handoff to Pasta's Dash Bridge.

See [PLAN.md](PLAN.md) for the pinned v4 API details and known gotchas.

## Run

From the repo root (`evotools/`):

```bash
npm run serve          # http://localhost:8000/onboard/
npm run test:onboard   # node onboard/test/smoke.mjs — verifies the core flow
```

## License

MIT
