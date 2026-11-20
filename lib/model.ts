// Signal Sweep — a token launch radar built from one sealed DefiLlama snapshot.
//
// The idea is different from a flat TVL multiple. Tokenized protocols in the same
// snapshot tell us what the market actually pays per dollar of TVL, category by
// category. A pre-token protocol is therefore priced first from its own category's
// peer evidence, then adjusted for the three things its own record shows:
// momentum (7-day TVL change), longevity (days tracked with no token) and breadth
// (how many chains its TVL already spans).
//
// Universe accounting, always from the snapshot itself:
//   758 protocols = 416 that already record a token (set aside, market priced)
//                 + 342 that record no token (gecko_id and symbol both null)
//   Of the 342, 144 are not a launch of their own — wrapped / staked / bridged
//   products, centralised exchanges, versioned pools of another protocol — and
//   are set aside too. The board ranks the remaining 198 launch candidates and
//   covers all 40 watchlist slugs, which all survive that filter.
//
// Revision (sweep-2): peer ratios are winsorised before any median is taken — a
// single tokenized peer whose market cap dwarfs its TVL (a prediction market at
// 400x) would otherwise drag a whole category to the cap on one observation.
// Category medians are also shrunk harder toward the global median (k = 8), so
// thin categories borrow strength from the whole market instead of shouting.
//
// No protocol name is ever special-cased. One function prices every row.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  shrink_k: number;        // peer-evidence shrinkage weight toward the global median
  peer_floor: number;      // lowest peer multiple the model will use
  peer_cap: number;        // highest peer multiple the model will use
  ratio_winsor_low: number;  // each peer's mcap/TVL is held at or above this before medians
  ratio_winsor_high: number; // ... and at or below this, so one outlier peer cannot rule a category
  momentum_gain: number;   // weight of clamped 7d change
  momentum_floor: number;  // clamp for change_7d, percent
  momentum_cap: number;
  longevity_floor: number; // multiplier for a brand-new protocol
  longevity_range: number; // extra multiplier earned over longevity_days
  longevity_days: number;  // days of no-token history for the full range
  unknown_age_days: number;
  breadth_step: number;    // multiplier added per extra chain
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 8,
  peer_floor: 0.06,
  peer_cap: 1.0,
  ratio_winsor_low: 0.02,
  ratio_winsor_high: 2.5,
  momentum_gain: 0.55,
  momentum_floor: -40,
  momentum_cap: 60,
  longevity_floor: 0.72,
  longevity_range: 0.48,
  longevity_days: 1825,
  unknown_age_days: 450,
  breadth_step: 0.03,
  breadth_max_extra: 6,
};

export const MODEL_VERSION = 'sweep-2';

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_samples: number;
    momentum_multiplier: number;
    longevity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  tier: string;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  peer_samples: number;
  momentum_multiplier: number;
  longevity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_peer_multiple: number;
  counts: {
    protocols: number;
    tokenized: number;
    pre_token: number;
    not_own_launch: number;
    board: number;
    watchlist: number;
    early: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const NOT_OWN_LAUNCH = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Pre-token, and a plausible launch of its own rather than a wrapper of someone else's asset. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && NOT_OWN_LAUNCH.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Peer evidence: median market-cap / TVL for tokenized protocols, global and per category.
 *  Each peer's ratio is winsorised into the model's band first, so a single extreme
 *  peer (a market cap hundreds of times its TVL) counts as a strong peer, not a ruler. */
export function peerEvidence(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, { median: number; samples: number }> } {
  const ratios: number[] = [];
  const perCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const raw = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const ratio = Math.min(model.ratio_winsor_high, Math.max(model.ratio_winsor_low, raw));
    ratios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = perCat.get(key) ?? [];
    list.push(ratio);
    perCat.set(key, list);
  }
  const byCategory = new Map<string, { median: number; samples: number }>();
  for (const [key, list] of perCat) byCategory.set(key, { median: median(list), samples: list.length });
  return { global: median(ratios), byCategory };
}

/** The peer multiple one protocol gets: its category median shrunk toward the global median. */
export function peerMultiple(
  p: SnapshotProtocol,
  evidence: { global: number; byCategory: Map<string, { median: number; samples: number }> },
  model: ModelConstants,
): { multiple: number; samples: number } {
  const cat = evidence.byCategory.get(p.category ?? 'Uncategorised');
  const samples = cat?.samples ?? 0;
  const catMedian = cat?.median ?? evidence.global;
  const shrunk = (samples * catMedian + model.shrink_k * evidence.global) / (samples + model.shrink_k);
  const multiple = Math.min(model.peer_cap, Math.max(model.peer_floor, shrunk));
  return { multiple, samples };
}

export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  evidence: { global: number; byCategory: Map<string, { median: number; samples: number }> },
  model: ModelConstants,
): { implied: number; peer: number; peerSamples: number; momentumMult: number; longevityMult: number; breadthMult: number; age: number | null } {
  const { multiple: peer, samples: peerSamples } = peerMultiple(p, evidence, model);
  const rawChange = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const change = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawChange));
  const momentumMult = 1 + (change / 100) * model.momentum_gain;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const longevityMult =
    model.longevity_floor + model.longevity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.longevity_days) / model.longevity_days);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const breadthMult = 1 + model.breadth_step * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * peer * momentumMult * longevityMult * breadthMult));
  return { implied, peer, peerSamples, momentumMult, longevityMult, breadthMult, age };
}

// ---------------------------------------------------------------- farm plans

const GAS_BY_CHAIN: Record<string, { asset: string; setup: string; weekly: string }> = {
  Ethereum: { asset: 'ETH', setup: '$9-16', weekly: '$4-7' },
  Solana: { asset: 'SOL', setup: 'under $1', weekly: 'under $1' },
  Base: { asset: 'ETH', setup: 'under $1', weekly: 'under $1' },
  Arbitrum: { asset: 'ETH', setup: '$1-2', weekly: 'under $1' },
  Binance: { asset: 'BNB', setup: '$1-2', weekly: 'under $1' },
  Optimism: { asset: 'ETH', setup: '$1-2', weekly: 'under $1' },
  Polygon: { asset: 'POL', setup: 'under $1', weekly: 'under $1' },
  Avalanche: { asset: 'AVAX', setup: '$1-3', weekly: '$1' },
  Sui: { asset: 'SUI', setup: 'under $1', weekly: 'under $1' },
  Tron: { asset: 'TRX', setup: '$1-2', weekly: '$1' },
  Bitcoin: { asset: 'BTC', setup: '$2-5', weekly: '$1-2' },
};

function gasFor(chain: string): { asset: string; setup: string; weekly: string } {
  return GAS_BY_CHAIN[chain] ?? { asset: 'the native gas token', setup: '$1-4', weekly: '$1' };
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 120;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 40;
}

function holdDaysFor(age: number | null, change: number | null): number {
  let days = age === null ? 45 : age < 180 ? 75 : age < 540 ? 60 : 40;
  if (change !== null && change < -10) days += 15;
  return days;
}

interface CategoryPlay { open: string; follow: string; weekly: string }

function playFor(p: SnapshotProtocol, capital: number, chain: string, secondChain: string | null): CategoryPlay {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('uncollateral')) {
    return {
      open: `Supply $${capital} in USDC as collateral in ${n} on ${chain}, then borrow no more than $${Math.round(capital * 0.4)} against it so the health factor stays comfortably above 2`,
      follow: `Repay and re-borrow once in the second week on ${n}; two separate borrow cycles read as real credit use, not a one-off deposit`,
      weekly: `Check the health factor and top up collateral if it drifts; one small supply top-up of $10-20 counts as the weekly touch`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return {
      open: `Swap $${Math.round(capital / 2)} into the pool's second asset and add $${capital} of paired liquidity to ${n}'s busiest pool on ${chain}`,
      follow: `Collect the accrued fees once after 10-14 days and re-add them to the same ${n} position instead of withdrawing to a wallet`,
      weekly: `Make one ordinary swap of $15-30 through ${n} each week, sized like a user trade, and keep the LP position open throughout`,
    };
  }
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('collateral')) {
    return {
      open: `Deposit $${capital} in USDC into one curated vault inside ${n} on ${chain} and keep the vault shares in the same wallet`,
      follow: `After two weeks move $${Math.round(capital * 0.25)} into a second ${n} vault; using two vaults shows allocator-level activity, not parking`,
      weekly: `Open the vault page weekly, confirm the share value and allocation, and add $10-25 when the vault rebalances`,
    };
  }
  if (c.includes('cdp') || c.includes('stable') || c.includes('basis')) {
    return {
      open: `Deposit $${capital} in collateral with ${n} on ${chain} and mint or hold the protocol's dollar asset at no more than half the maximum allowed`,
      follow: `Hold the minted dollar asset for at least two weeks and provide $${Math.round(capital * 0.3)} of it to the protocol's own stability or liquidity pool if one is offered`,
      weekly: `Check the collateral ratio weekly and add $10-20 of collateral before it can drift toward any liquidation line`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('interest rate')) {
    return {
      open: `Deposit $${capital} in USDC margin on ${n} (${chain}) and open one small hedged position, long and short legs near equal, so volume is real but risk stays flat`,
      follow: `Close and reopen the hedge once in week two on ${n}; aim for steady modest volume across days, never one outsized trade`,
      weekly: `Trade two or three small sessions a week on ${n}, $20-40 of notional each, and leave margin parked between sessions`,
    };
  }
  if (c.includes('prediction')) {
    return {
      open: `Fund $${capital} on ${n} and split it across at least four open markets, $10-25 a position, favouring markets that resolve within 30 days`,
      follow: `Settle the first resolved market and roll the proceeds into a new ${n} market the same week, keeping a continuous trading record`,
      weekly: `Place two or three considered trades a week on ${n}; a steady record across many markets matters more than one large bet`,
    };
  }
  if (c.includes('rwa') || c.includes('payment') || c.includes('card')) {
    return {
      open: `Complete ${n}'s onboarding or KYC if it asks, then deposit or mint $${capital} of its yield-bearing asset on ${chain}`,
      follow: `Hold the asset through one full distribution or interest cycle on ${n} so the wallet appears in a payout snapshot`,
      weekly: `Check the distribution record weekly and add $10-25 in one of the weeks so the balance is not perfectly static`,
    };
  }
  if (c.includes('staking') || c.includes('restak') || c.includes('anchor') || c.includes('decentralized btc') || c.includes('farm')) {
    return {
      open: `Stake $${capital} worth of the underlying asset through ${n} on ${chain} and keep the receipt or restaking position untouched`,
      follow: secondChain
        ? `Add a second, smaller stake of $${Math.round(capital * 0.3)} through ${n} on ${secondChain} so the wallet is active on two of its chains`
        : `After three weeks delegate or restake the rewards inside ${n} instead of selling them, compounding the position once`,
      weekly: `Claim or compound rewards weekly inside ${n}; each claim is a cheap, regular on-chain touch`,
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      open: `Bridge $${capital} in USDC from ${chain} to ${secondChain ?? 'a second supported chain'} through ${n}, then use the bridged funds in a DeFi app on the far side`,
      follow: `Bridge $${Math.round(capital * 0.4)} back through ${n} after at least two weeks; a round trip counts far more than a one-way transfer`,
      weekly: `Make one small $15-25 bridge or far-side transaction a week so both chains show continuing activity`,
    };
  }
  if (c.includes('insurance')) {
    return {
      open: `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold elsewhere, with a term of at least 60 days`,
      follow: `Renew or extend the ${n} cover once before it lapses so coverage is continuous across two periods`,
      weekly: `Review the cover and the covered position weekly; no transaction is needed in weeks where nothing changed`,
    };
  }
  if (c.includes('chain')) {
    return {
      open: `Bridge $${Math.round(capital * 0.5)} to ${n}'s chain (${chain}) and make the wallet a regular user: swaps, one lending deposit and one NFT or naming action`,
      follow: `Use two native ${n} applications in week two so the wallet's activity is not a single bridge-and-leave footprint`,
      weekly: `Transact on the chain two or three times a week with ordinary $10-30 actions; consistency is the whole play for a chain`,
    };
  }
  if (c.includes('index') || c.includes('governance')) {
    return {
      open: `Buy or mint $${capital} of the ${n} basket or position on ${chain} and hold it in the farming wallet`,
      follow: `Take part in one ${n} governance vote or rebalance window if one opens during the hold; screenshot the participation for your log`,
      weekly: `Check the basket composition weekly and add $10-20 in one week so the position grows at least once`,
    };
  }
  return {
    open: `Deposit $${capital} in USDC into ${n}'s main product on ${chain} and keep the position open and untouched by other farms`,
    follow: `Repeat the core ${n} action once in week three with $15-25 so the wallet shows a returning user, not a single visit`,
    weekly: `Make one small qualifying action a week inside ${n}, such as a deposit, claim or vote, and never two farms from the same wallet`,
  };
}

/** Seven concrete steps per protocol, assembled from its category, chains, TVL tier and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age, p.change_7d);
  const play = playFor(p, capital, chain, secondChain);
  const trendNote =
    p.change_7d !== null && p.change_7d < -10
      ? ` TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in 7 days, so start at half size and only add if the trend flattens.`
      : p.change_7d !== null && p.change_7d > 10
        ? ` TVL rose ${p.change_7d.toFixed(1)}% in 7 days, so expect busy contracts and check gas before the main deposit.`
        : '';
  const steps = [
    `Set up a fresh wallet for ${p.name} only, fund it on ${chain} with ${gas.asset} for gas plus $${capital + 30} in working capital, and store the seed phrase offline. Cost: ${gas.setup} of gas to fund and bridge in. Time: 20 minutes.${trendNote}`,
    `${play.open}. Cost: $${capital} of capital plus ${gas.setup} of gas on ${chain}. Time: 15-25 minutes to set up carefully.`,
    `${play.follow}. Cost: ${gas.weekly} in gas. Time: 10 minutes, in week two or three of the hold.`,
    `${play.weekly}. Cost: ${gas.weekly} in gas a week. Time: 10 minutes a week for the length of the farm.`,
    `Hold the ${p.name} position for at least ${hold} days without emptying it, so the wallet appears in several weekly snapshots rather than one. Cost: the $${capital} stays deployed and cannot be reused elsewhere. Time: ${hold} days.`,
    `Keep a farm log for ${p.name}: wallet address, ${chain} transaction hashes, dates and amounts, and check the protocol's official announcements weekly for points, seasons or snapshot news. Cost: nothing. Time: 5 minutes a week.`,
    `When you finish, exit in two steps a few days apart, and claim any reward only through a link ${p.name} itself publishes; never pay a fee to claim and never sign a claim on a search-result site. Cost: ${gas.setup} of gas to unwind. Time: 20 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------- board

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const evidence = peerEvidence(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isLaunchCandidate);
  const scored = candidates.map((p) => {
    const v = impliedValue(p, snapshot.as_of, evidence, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peer),
      peer_samples: s.peerSamples,
      momentum_multiplier: round4(s.momentumMult),
      longevity_multiplier: round4(s.longevityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 36)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const evidence = peerEvidence(snapshot, model);
  // The dashboard recomputes each row to prove the arithmetic, so its copy of the
  // peer multiple keeps full precision; board.json's model block rounds to 4dp.
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rawPeer = (slug: string): number => {
    const p = bySlug.get(slug);
    return p === undefined ? 0 : peerMultiple(p, evidence, model).multiple;
  };
  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_peer_multiple: round4(evidence.global),
    counts: {
      protocols: snapshot.protocols.length,
      tokenized: snapshot.protocols.length - preToken,
      pre_token: preToken,
      not_own_launch: preToken - board.length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      early: board.filter((r) => !r.watchlist).length,
    },
    rows: board.map((r) => ({
      rank: r.rank,
      tier: r.rank <= 25 ? 'Prime signal' : r.rank <= 90 ? 'Tracked' : 'Early find',
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: rawPeer(r.slug),
      peer_samples: r.model.peer_samples,
      momentum_multiplier: r.model.momentum_multiplier,
      longevity_multiplier: r.model.longevity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'board has a duplicate slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} implied value out of range`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} trimmed characters`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
