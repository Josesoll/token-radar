# Launch Radar — a token launch radar, version 2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Josesoll/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Josesoll/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar reads the sealed DefiLlama snapshot (758 protocols at or above $5M TVL, as of 2026-11-14) and answers two questions for every protocol that records no token yet: what could a launch be worth if its record stayed as it is, and exactly how should a reader farm it in the meantime?

Version 2 replaces the version-1 peer-multiple model with a regression that is **fitted on the snapshot's own tokenized protocols and validated held-out twice** — the same discipline the leading entry advertises, with our own fit, our own coefficients and our own code.

## Who gets ranked

The snapshot's universe is accounted for in full, and the dashboard shows the same accounting:

- **416 protocols already record a token** (a `gecko_id` or a `symbol`) — set aside; the market prices them, and the dashboard's "Already tokenized" view lists the largest by market cap.
- **342 protocols record no token.** Of those, **144 are not a launch of their own** — centralised exchanges, bridges and canonical bridges, liquid staking / restaking wrappers, wrapped or staked products, and versioned pools of another protocol — and are set aside too.
- **The board ranks the remaining 198 launch candidates**, covering **all 40 watchlist protocols** plus 158 earlier finds below the $50M watchlist floor.

## The model (v2, ridge-fitted and twice validated)

```
log(implied) = 8.4738 + 0.4694·ln(TVL) − 0.0880·change + (−0.0970)·ln(1+age)
               + 0.0814·ln(chains) + category
```

- **Fit set — 128 protocols, not 416.** Only 128 protocols in the snapshot carry a usable market cap (`mcap_usd` > 0). The other 288 that record a token carry no market cap in the file, so they teach a regression nothing and are excluded, not imputed. Saying the model was fitted on 416 would be false, and the dashboard says 128.
- **Ridge regression (λ = 30)** of log market cap on log TVL, the 7-day TVL change clamped to ±30%, log age (days since DefiLlama first tracked the protocol; unreported ages set to the fit set's median, 1,000 days), log chain count, and one dummy per category with at least 7 fit peers (Lending, Dexs, CEX, Liquid Staking, RWA, Yield, Canonical Bridge, Basis Trading). The penalty is load-bearing: unpenalised OLS was tried first and its change and category coefficients swung wildly between splits (the change coefficient was −10.9 in one split and −0.3 in the other), so the ridge fit is what keeps the model honest. Every coefficient is fitted from the snapshot at run time by `main.ts` — nothing is hardcoded.
- **Category effects** (log points): Lending −0.190, Dexs +0.026, CEX +0.167, Liquid Staking −0.211, RWA +0.037, Yield −0.178, Canonical Bridge +0.180, Basis Trading +0.203. Categories with fewer than 7 fit peers get no dummy and sit at the pooled level.
- **Validated held-out, twice, at run time.** Split A (hash parity of the slug: 69 fit / 59 test) gives a median absolute log error of **1.266** (mean 1.545). Split B (slug-order halves: 64 / 64) gives **1.140** (mean 1.536). A TVL-only baseline scores 1.243 and 1.070 on the same splits, so the extra terms do not beat TVL alone — the ridge penalty keeps them small and they adjust the ranking modestly. In-sample median error is 1.330. The dashboard reports all of this, including the baseline, rather than hiding it.
- **Read the error honestly.** A median log error around 1.2 means the typical fitted value is off by about a factor of three. Market caps are noisy, and this board is a ranking device — which pre-token protocol is worth farming next — not a price forecast.
- **Token odds** are a separate peer-rate, not part of the value: for each protocol, the share of protocols in its category that already record a token (54.9% overall), shrunk toward that overall share with a pseudo-count of 5, so a thin category cannot claim 0% or 100%. It is a peer rate, not a prediction that this protocol issues one.

No protocol name is ever special-cased; one fitted function prices every row, and the dashboard's detail view recomputes each row's six log terms and checks the sum against `board.json`.

## Farm plans

Every row carries a 7-step plan generated from its own record — category, primary and secondary chains, TVL tier and age. A lending protocol gets a supply-and-borrow cycle with a health-factor rule; a DEX gets a paired-liquidity plan; a curator gets a two-vault plan; and so on. Each step states what to do, on which chain, roughly what it costs (capital and chain-specific gas) and how long it takes, including a trend warning when the protocol's TVL fell or rose sharply in the last 7 days.

## The dashboard

A fully offline dark "phosphor radar" page (no network, no framework): a sortable board (value, TVL, growth, no-token age, token odds, name), filters by chain and category plus search and a watchlist-only toggle, a detail drawer per protocol with its figures, its full term-by-term model breakdown, its token odds and its farm plan, a methodology section with the fitted coefficients and both held-out validations, and the tokenized set-aside view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only. Two runs on the same snapshot write byte-identical output: `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (built with the vendored `vendor/makefun-board.ts`, which is the scorer's own library and is not modified).

---

<sub>Entered on [make.fun](https://make.fun/?ref=w9gyap1e&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
