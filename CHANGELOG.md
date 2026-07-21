# Changelog

evotools is a continuously deployed static site, so versions mark milestones
rather than installable releases.

## Unreleased

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
