# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Josesoll/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Josesoll/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. The program reads a sealed snapshot of 758 DeFi protocols (DefiLlama data, every protocol at or above $5,000,000 of TVL), derives an implied value for each protocol that records no token yet — from its TVL, its seven-day growth and how long it has run without one — and writes a ranked board plus a fully offline dashboard: a sortable, filterable board, a detail view per protocol, and a concrete farm plan (steps, cost and time) for every row. The 40-protocol watchlist is covered in full, and the radar reaches below it to the earlier protocols a launch radar exists to find.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=w9gyap1e&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
