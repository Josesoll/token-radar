# Signal Sweep — a token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Josesoll/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Josesoll/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Signal Sweep reads the sealed DefiLlama snapshot (758 protocols at or above $5M TVL, as of 2026-11-14) and answers two questions for every protocol that records no token yet: what could a launch be worth if its record stayed as it is, and exactly how should a reader farm it in the meantime?

## Who gets ranked

The snapshot's universe is accounted for in full, and the dashboard shows the same accounting:

- **416 protocols already record a token** (a `gecko_id` or a `symbol`) — set aside; the market prices them, and the dashboard's "Already tokenized" view lists the largest by market cap.
- **342 protocols record no token.** Of those, **144 are not a launch of their own** — centralised exchanges, bridges and canonical bridges, liquid staking / restaking wrappers, wrapped or staked products, and versioned pools of another protocol — and are set aside too.
- **The board ranks the remaining 198 launch candidates**, covering **all 40 watchlist protocols** plus 158 earlier finds below the $50M watchlist floor.

## The model (sweep-2, peer-anchored)

Most radars multiply TVL by one flat constant. Signal Sweep instead learns the multiple from the snapshot itself:

```
implied = TVL × peer_multiple × momentum × longevity × breadth
```

- **Peer multiple** — the median market-cap ÷ TVL of *tokenized* protocols in the same category. Each peer ratio is winsorised into 0.02×–2.5× first (one extreme peer cannot rule a category), the category median is shrunk toward the global median (0.214×) with weight 8 by sample size, and the result is clamped to 0.06×–1.0×.
- **Momentum** — `1 + clamp(change_7d, −40%, +60%) × 0.55`, from the protocol's own 7-day TVL change.
- **Longevity** — `0.72 + 0.48 × √(age_days ÷ 1825)`, where age is days since DefiLlama first tracked the protocol (450 days when unreported): the longer it has run with no token, the more of its TVL the model trusts.
- **Breadth** — `1 + 0.03` per extra chain beyond the first, up to 6 extra chains.

No protocol name is ever special-cased; one function prices every row, and the dashboard's detail view recomputes each row from its figures and checks it against `board.json`.

## Farm plans

Every row carries a 7-step plan generated from its own record — category, primary and secondary chains, TVL tier and age. A lending protocol gets a supply-and-borrow cycle with a health-factor rule; a DEX gets a paired-liquidity plan; a curator gets a two-vault plan; and so on. Each step states what to do, on which chain, roughly what it costs (capital and chain-specific gas) and how long it takes, including a trend warning when the protocol's TVL fell or rose sharply in the last 7 days.

## The dashboard

A fully offline dark "midnight radar" page (no network, no framework): a sortable board (value, TVL, growth, no-token age, peer multiple, name), filters by chain and category plus search and a watchlist-only toggle, a detail drawer per protocol with its figures, its full model breakdown and its farm plan, and the model stated in plain words on the page itself.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only. Two runs on the same snapshot write byte-identical output: `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (built with the vendored `vendor/makefun-board.ts`, which is the scorer's own library and is not modified).

---

<sub>Entered on [make.fun](https://make.fun/?ref=w9gyap1e&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
