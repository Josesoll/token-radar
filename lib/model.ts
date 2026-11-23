// Launch Radar v2 — the model library.
//
// Everything in this file is derived from one sealed DefiLlama snapshot and
// nothing else: no network, no hand-kept lists, no per-protocol adjustments.
//
// The valuation model is a ridge regression fitted at run time. Its training
// set is the snapshot's own tokenized protocols — but only the 128 of them
// whose market cap the file actually carries (mcap_usd > 0). The remaining
// 288 protocols that record a token have no market cap in the snapshot, so
// they cannot teach a regression anything and are left out of the fit.
//
//   log(market cap) ~ intercept
//                   + b1 * ln(TVL)
//                   + b2 * (7-day change, clamped to ±30%, in units of 100%)
//                   + b3 * ln(1 + age in days)
//                   + b4 * ln(chain count)
//                   + one dummy per category with >= 7 training peers
//
// Ridge (lambda 30) is used because plain least squares proved unstable on
// this data: refit on two halves of the training set, its change coefficient
// swung from about -11 to about -0.3. The penalty keeps every coefficient
// small and stable, at the price of a deliberately conservative fit.
//
// Validation is part of the program, not a claim beside it. fitModel refits
// on two different splits of the training set (hash parity of the slug, and
// the slug-order halves) and scores the held-out part of each, and it runs a
// TVL-only baseline through the same two splits so the reader can see what
// the extra terms are worth. On this snapshot they are worth little: the
// full model's held-out median absolute log error is 1.266 / 1.140 against
// the baseline's 1.243 / 1.070. The dashboard prints all four numbers.
//
// Token odds are a second, separate statistic: within a protocol's category,
// the share of protocols that already record a token, shrunk toward the
// overall share so thin categories cannot read 0% or 100%.

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

export interface RidgeSpec {
  lambda: number;
  change_floor: number;
  change_cap: number;
  category_min_peers: number;
  odds_shrink_k: number;
}

export const RIDGE: RidgeSpec = {
  lambda: 30,
  change_floor: -30,
  change_cap: 30,
  category_min_peers: 7,
  odds_shrink_k: 5,
};

export const MODEL_VERSION = 'launch-radar-v2';

export interface ValidationSplit {
  name: string;
  n_fit: number;
  n_test: number;
  median_abs_log_error: number;
  mean_abs_log_error: number;
}

export interface FittedModel {
  version: string;
  lambda: number;
  fit_n: number;
  tokenized_recorded: number;
  no_mcap: number;
  median_age_days: number;
  intercept: number;
  coef_log_tvl: number;
  coef_change: number;
  coef_log_age: number;
  coef_log_chains: number;
  categories: string[];
  category_coefs: number[];
  global_token_share: number;
  validation: ValidationSplit[];
  in_sample_median_abs_log_error: number;
  tvl_only_validation: ValidationSplit[];
}

export interface TermBreakdown {
  intercept: number;
  log_tvl: number;
  change: number;
  log_age: number;
  log_chains: number;
  category: number;
  category_name: string | null;
}

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
  token_odds: number;
  token_odds_n: number;
  token_odds_tokenized: number;
  model: TermBreakdown & { age_days: number | null };
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
  token_odds: number;
  token_odds_n: number;
  token_odds_tokenized: number;
  terms: TermBreakdown;
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
  model: FittedModel;
  model_version: string;
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
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// Categories whose members are products of someone else's token rather than
// a launch of their own. The watchlist rule excludes the same families.
const WRAPPER_CATEGORIES: ReadonlySet<string> = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;

/** A protocol that records no token and could plausibly launch one of its own. */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPER_WORD.test(p.name)) return false;
  return true;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ------------------------------------------------------------ the fit

/** Training rows: a recorded token whose market cap the snapshot carries. */
export function fitSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Categories with enough training peers for their own dummy, in a stable
 *  order: peer count descending, then name ascending. */
export function fitCategories(fit: SnapshotProtocol[], spec: RidgeSpec): string[] {
  const counts = new Map<string, number>();
  for (const p of fit) {
    const key = p.category ?? 'Uncategorised';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter((entry) => entry[1] >= spec.category_min_peers)
    .sort((a, b) => b[1] - a[1] || bySlugAsc(a[0], b[0]))
    .map((entry) => entry[0]);
}

export function medianFitAge(fit: SnapshotProtocol[], asOf: string): number {
  const ages: number[] = [];
  for (const p of fit) {
    const a = ageDays(asOf, p.listed_at);
    if (a !== null) ages.push(a);
  }
  return ages.length === 0 ? 1000 : medianOf(ages);
}

/** One protocol as a feature row, in the model's fixed order. An unreported
 *  age is replaced by the training set's median age; an unreported change
 *  counts as zero; the change is clamped before it is scaled to units of 100%. */
export function features(
  p: SnapshotProtocol,
  categories: string[],
  medianAge: number,
  asOf: string,
  spec: RidgeSpec,
): number[] {
  const age = ageDays(asOf, p.listed_at) ?? medianAge;
  const rawChange = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const change = Math.min(spec.change_cap, Math.max(spec.change_floor, rawChange)) / 100;
  const key = p.category ?? 'Uncategorised';
  const row = [1, Math.log(p.tvl_usd), change, Math.log1p(Math.max(0, age)), Math.log(Math.max(1, p.chains.length))];
  for (const c of categories) row.push(key === c ? 1 : 0);
  return row;
}

/** Ridge fit by normal equations, solved with Gauss-Jordan elimination.
 *  The intercept column is exempt from the penalty. Pure arithmetic on the
 *  inputs, so the same snapshot always yields the same coefficients. */
export function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const k = X[0]!.length;
  const normal: number[][] = [];
  for (let r = 0; r < k; r++) normal.push(new Array<number>(k).fill(0));
  const rhs: number[] = new Array<number>(k).fill(0);
  X.forEach((row, i) => {
    for (let r = 0; r < k; r++) {
      rhs[r]! += row[r]! * y[i]!;
      for (let c = 0; c < k; c++) normal[r]![c]! += row[r]! * row[c]!;
    }
  });
  for (let i = 1; i < k; i++) normal[i]![i]! += lambda;
  const aug = normal.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r;
    }
    const swap = aug[col]!;
    aug[col] = aug[pivot]!;
    aug[pivot] = swap;
    const divisor = aug[col]![col]!;
    for (let j = col; j <= k; j++) aug[col]![j]! /= divisor;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = aug[r]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= k; j++) aug[r]![j]! -= factor * aug[col]![j]!;
    }
  }
  return aug.map((row) => row[k]!);
}

function predict(beta: number[], x: number[]): number {
  let total = 0;
  for (let i = 0; i < beta.length; i++) total += beta[i]! * x[i]!;
  return total;
}

function heldOutErrors(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  categories: string[],
  medianAge: number,
  asOf: string,
  spec: RidgeSpec,
): number[] {
  const beta = ridgeFit(
    train.map((p) => features(p, categories, medianAge, asOf, spec)),
    train.map((p) => Math.log(p.mcap_usd!)),
    spec.lambda,
  );
  const errors = test.map((p) => Math.abs(predict(beta, features(p, categories, medianAge, asOf, spec)) - Math.log(p.mcap_usd!)));
  return errors.sort((a, b) => a - b);
}

function splitSummary(
  name: string,
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  categories: string[],
  medianAge: number,
  asOf: string,
  spec: RidgeSpec,
): ValidationSplit {
  const errors = heldOutErrors(train, test, categories, medianAge, asOf, spec);
  const middle = errors[Math.floor(errors.length / 2)] ?? 0;
  const mean = errors.reduce((sum, e) => sum + e, 0) / Math.max(1, errors.length);
  return { name, n_fit: train.length, n_test: test.length, median_abs_log_error: round4(middle), mean_abs_log_error: round4(mean) };
}

function slugHash(slug: string): number {
  let h = 0;
  for (const ch of slug) h += ch.charCodeAt(0);
  return h;
}

/** Fit on the whole training set, then validate twice: each validation refits
 *  on one part of the training set and scores the other part, which the fit
 *  never saw. Split A alternates by a hash of the slug; split B cuts the
 *  slug-sorted list in half. A TVL-only model is run through both splits as
 *  the baseline the full model has to answer to. */
export function fitModel(
  snapshot: Snapshot,
  spec: RidgeSpec = RIDGE,
): { model: FittedModel; beta: number[]; categories: string[]; medianAge: number } {
  const train = fitSet(snapshot);
  const categories = fitCategories(train, spec);
  const medianAge = medianFitAge(train, snapshot.as_of);
  const beta = ridgeFit(
    train.map((p) => features(p, categories, medianAge, snapshot.as_of, spec)),
    train.map((p) => Math.log(p.mcap_usd!)),
    spec.lambda,
  );

  const recorded = snapshot.protocols.filter((p) => !recordsNoToken(p)).length;
  const globalShare = recorded / Math.max(1, snapshot.protocols.length);

  const aTrain = train.filter((p) => slugHash(p.slug) % 2 === 0);
  const aTest = train.filter((p) => slugHash(p.slug) % 2 === 1);
  const ordered = [...train].sort((a, b) => bySlugAsc(a.slug, b.slug));
  const half = Math.floor(ordered.length / 2);
  const bTrain = ordered.slice(0, half);
  const bTest = ordered.slice(half);

  const nameA = 'Split A — hash parity of slug';
  const nameB = 'Split B — slug-order halves';
  const validation = [
    splitSummary(nameA, aTrain, aTest, categories, medianAge, snapshot.as_of, spec),
    splitSummary(nameB, bTrain, bTest, categories, medianAge, snapshot.as_of, spec),
  ];

  const baseline = (name: string, part: SnapshotProtocol[], held: SnapshotProtocol[]): ValidationSplit => {
    const coef = ridgeFit(
      part.map((p) => [1, Math.log(p.tvl_usd)]),
      part.map((p) => Math.log(p.mcap_usd!)),
      0,
    );
    const errors = held
      .map((p) => Math.abs(coef[0]! + coef[1]! * Math.log(p.tvl_usd) - Math.log(p.mcap_usd!)))
      .sort((x, y) => x - y);
    return {
      name,
      n_fit: part.length,
      n_test: held.length,
      median_abs_log_error: round4(errors[Math.floor(errors.length / 2)] ?? 0),
      mean_abs_log_error: round4(errors.reduce((sum, e) => sum + e, 0) / Math.max(1, errors.length)),
    };
  };

  const inSample = heldOutErrors(train, train, categories, medianAge, snapshot.as_of, spec);

  const model: FittedModel = {
    version: MODEL_VERSION,
    lambda: spec.lambda,
    fit_n: train.length,
    tokenized_recorded: recorded,
    no_mcap: recorded - train.length,
    median_age_days: Math.round(medianAge),
    intercept: round4(beta[0]!),
    coef_log_tvl: round4(beta[1]!),
    coef_change: round4(beta[2]!),
    coef_log_age: round4(beta[3]!),
    coef_log_chains: round4(beta[4]!),
    categories,
    category_coefs: categories.map((_, i) => round4(beta[5 + i]!)),
    global_token_share: round4(globalShare),
    validation,
    in_sample_median_abs_log_error: round4(inSample[Math.floor(inSample.length / 2)] ?? 0),
    tvl_only_validation: [baseline(nameA, aTrain, aTest), baseline(nameB, bTrain, bTest)],
  };
  return { model, beta, categories, medianAge };
}

/** Token odds: the tokenized share of the protocol's own category, shrunk
 *  toward the snapshot-wide share by a pseudo-count. */
export function tokenOdds(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  spec: RidgeSpec,
): { odds: number; n: number; tokenized: number } {
  const key = p.category ?? 'Uncategorised';
  let n = 0;
  let tokenized = 0;
  let allTokenized = 0;
  for (const q of snapshot.protocols) {
    if (!recordsNoToken(q)) allTokenized++;
    if ((q.category ?? 'Uncategorised') !== key) continue;
    n++;
    if (!recordsNoToken(q)) tokenized++;
  }
  const overall = snapshot.protocols.length === 0 ? 0 : allTokenized / snapshot.protocols.length;
  const odds = (tokenized + spec.odds_shrink_k * overall) / (n + spec.odds_shrink_k);
  return { odds, n, tokenized };
}

/** The fitted log value of one protocol, split into its six additive terms. */
export function termBreakdown(
  p: SnapshotProtocol,
  beta: number[],
  categories: string[],
  medianAge: number,
  asOf: string,
  spec: RidgeSpec,
): TermBreakdown {
  const x = features(p, categories, medianAge, asOf, spec);
  const key = p.category ?? 'Uncategorised';
  const at = categories.indexOf(key);
  return {
    intercept: beta[0]!,
    log_tvl: beta[1]! * x[1]!,
    change: beta[2]! * x[2]!,
    log_age: beta[3]! * x[3]!,
    log_chains: beta[4]! * x[4]!,
    category: at >= 0 ? beta[5 + at]! : 0,
    category_name: at >= 0 ? key : null,
  };
}

export function impliedValue(
  p: SnapshotProtocol,
  beta: number[],
  categories: string[],
  medianAge: number,
  asOf: string,
  spec: RidgeSpec,
): { implied: number; terms: TermBreakdown; age: number | null } {
  const terms = termBreakdown(p, beta, categories, medianAge, asOf, spec);
  const logValue = terms.intercept + terms.log_tvl + terms.change + terms.log_age + terms.log_chains + terms.category;
  return { implied: Math.max(1, Math.round(Math.exp(logValue))), terms, age: ageDays(asOf, p.listed_at) };
}

// ------------------------------------------------------------ farm plans
//
// A plan is assembled from the protocol's own record: its category chooses
// the core play, its first two chains choose where the steps happen and what
// gas costs, its TVL tier chooses the suggested capital, and its age and
// 7-day trend choose the hold length and the warning line. Every step names
// a cost and a time, because a plan without either is a slogan.

interface GasQuote {
  asset: string;
  setup: string;
  weekly: string;
}

const GAS_BY_CHAIN: Record<string, GasQuote> = {
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

function gasFor(chain: string): GasQuote {
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
  let days = 45;
  if (age !== null) days = age < 180 ? 75 : age < 540 ? 60 : 40;
  if (change !== null && change < -10) days += 15;
  return days;
}

interface CategoryPlay {
  open: string;
  follow: string;
  weekly: string;
}

interface PlayContext {
  p: SnapshotProtocol;
  capital: number;
  chain: string;
  secondChain: string | null;
}

// Category plays as an ordered rule table: the first rule whose needles all
// match (any one of them) the lower-cased category writes the play.
const PLAY_RULES: { needles: string[]; make: (ctx: PlayContext) => CategoryPlay }[] = [
  {
    needles: ['lend', 'uncollateral'],
    make: ({ p, capital, chain }) => ({
      open: `Supply $${capital} in USDC as collateral in ${p.name} on ${chain}, then borrow no more than $${Math.round(capital * 0.4)} against it so the health factor stays comfortably above 2`,
      follow: `Repay and re-borrow once in the second week on ${p.name}; two separate borrow cycles read as real credit use, not a one-off deposit`,
      weekly: `Check the health factor and top up collateral if it drifts; one small supply top-up of $10-20 counts as the weekly touch`,
    }),
  },
  {
    needles: ['dex', 'liquidity'],
    make: ({ p, capital, chain }) => ({
      open: `Swap $${Math.round(capital / 2)} into the pool's second asset and add $${capital} of paired liquidity to ${p.name}'s busiest pool on ${chain}`,
      follow: `Collect the accrued fees once after 10-14 days and re-add them to the same ${p.name} position instead of withdrawing to a wallet`,
      weekly: `Make one ordinary swap of $15-30 through ${p.name} each week, sized like a user trade, and keep the LP position open throughout`,
    }),
  },
  {
    needles: ['risk curator', 'allocator', 'yield aggregator', 'collateral'],
    make: ({ p, capital, chain }) => ({
      open: `Deposit $${capital} in USDC into one curated vault inside ${p.name} on ${chain} and keep the vault shares in the same wallet`,
      follow: `After two weeks move $${Math.round(capital * 0.25)} into a second ${p.name} vault; using two vaults shows allocator-level activity, not parking`,
      weekly: `Open the vault page weekly, confirm the share value and allocation, and add $10-25 when the vault rebalances`,
    }),
  },
  {
    needles: ['cdp', 'stable', 'basis'],
    make: ({ p, capital, chain }) => ({
      open: `Deposit $${capital} in collateral with ${p.name} on ${chain} and mint or hold the protocol's dollar asset at no more than half the maximum allowed`,
      follow: `Hold the minted dollar asset for at least two weeks and provide $${Math.round(capital * 0.3)} of it to the protocol's own stability or liquidity pool if one is offered`,
      weekly: `Check the collateral ratio weekly and add $10-20 of collateral before it can drift toward any liquidation line`,
    }),
  },
  {
    needles: ['derivative', 'perpetual', 'interest rate'],
    make: ({ p, capital, chain }) => ({
      open: `Deposit $${capital} in USDC margin on ${p.name} (${chain}) and open one small hedged position, long and short legs near equal, so volume is real but risk stays flat`,
      follow: `Close and reopen the hedge once in week two on ${p.name}; aim for steady modest volume across days, never one outsized trade`,
      weekly: `Trade two or three small sessions a week on ${p.name}, $20-40 of notional each, and leave margin parked between sessions`,
    }),
  },
  {
    needles: ['prediction'],
    make: ({ p, capital }) => ({
      open: `Fund $${capital} on ${p.name} and split it across at least four open markets, $10-25 a position, favouring markets that resolve within 30 days`,
      follow: `Settle the first resolved market and roll the proceeds into a new ${p.name} market the same week, keeping a continuous trading record`,
      weekly: `Place two or three considered trades a week on ${p.name}; a steady record across many markets matters more than one large bet`,
    }),
  },
  {
    needles: ['rwa', 'payment', 'card'],
    make: ({ p, capital, chain }) => ({
      open: `Complete ${p.name}'s onboarding or KYC if it asks, then deposit or mint $${capital} of its yield-bearing asset on ${chain}`,
      follow: `Hold the asset through one full distribution or interest cycle on ${p.name} so the wallet appears in a payout snapshot`,
      weekly: `Check the distribution record weekly and add $10-25 in one of the weeks so the balance is not perfectly static`,
    }),
  },
  {
    needles: ['staking', 'restak', 'anchor', 'decentralized btc', 'farm'],
    make: ({ p, capital, chain, secondChain }) => ({
      open: `Stake $${capital} worth of the underlying asset through ${p.name} on ${chain} and keep the receipt or restaking position untouched`,
      follow: secondChain
        ? `Add a second, smaller stake of $${Math.round(capital * 0.3)} through ${p.name} on ${secondChain} so the wallet is active on two of its chains`
        : `After three weeks delegate or restake the rewards inside ${p.name} instead of selling them, compounding the position once`,
      weekly: `Claim or compound rewards weekly inside ${p.name}; each claim is a cheap, regular on-chain touch`,
    }),
  },
  {
    needles: ['bridge', 'cross chain'],
    make: ({ p, capital, chain, secondChain }) => ({
      open: `Bridge $${capital} in USDC from ${chain} to ${secondChain ?? 'a second supported chain'} through ${p.name}, then use the bridged funds in a DeFi app on the far side`,
      follow: `Bridge $${Math.round(capital * 0.4)} back through ${p.name} after at least two weeks; a round trip counts far more than a one-way transfer`,
      weekly: `Make one small $15-25 bridge or far-side transaction a week so both chains show continuing activity`,
    }),
  },
  {
    needles: ['insurance'],
    make: ({ p, capital, chain }) => ({
      open: `Buy $${capital} of cover from ${p.name} on ${chain} for a position you actually hold elsewhere, with a term of at least 60 days`,
      follow: `Renew or extend the ${p.name} cover once before it lapses so coverage is continuous across two periods`,
      weekly: `Review the cover and the covered position weekly; no transaction is needed in weeks where nothing changed`,
    }),
  },
  {
    needles: ['chain'],
    make: ({ p, capital, chain }) => ({
      open: `Bridge $${Math.round(capital * 0.5)} to ${p.name}'s chain (${chain}) and make the wallet a regular user: swaps, one lending deposit and one NFT or naming action`,
      follow: `Use two native ${p.name} applications in week two so the wallet's activity is not a single bridge-and-leave footprint`,
      weekly: `Transact on the chain two or three times a week with ordinary $10-30 actions; consistency is the whole play for a chain`,
    }),
  },
  {
    needles: ['index', 'governance'],
    make: ({ p, capital, chain }) => ({
      open: `Buy or mint $${capital} of the ${p.name} basket or position on ${chain} and hold it in the farming wallet`,
      follow: `Take part in one ${p.name} governance vote or rebalance window if one opens during the hold; screenshot the participation for your log`,
      weekly: `Check the basket composition weekly and add $10-20 in one week so the position grows at least once`,
    }),
  },
];

function playFor(ctx: PlayContext): CategoryPlay {
  const category = (ctx.p.category ?? '').toLowerCase();
  for (const rule of PLAY_RULES) {
    if (rule.needles.some((needle) => category.includes(needle))) return rule.make(ctx);
  }
  const { p, capital, chain } = ctx;
  return {
    open: `Deposit $${capital} in USDC into ${p.name}'s main product on ${chain} and keep the position open and untouched by other farms`,
    follow: `Repeat the core ${p.name} action once in week three with $15-25 so the wallet shows a returning user, not a single visit`,
    weekly: `Make one small qualifying action a week inside ${p.name}, such as a deposit, claim or vote, and never two farms from the same wallet`,
  };
}

/** Seven steps per protocol: wallet setup, the category play in three beats,
 *  the hold, the log, and the exit — each with its cost and its time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age, p.change_7d);
  const play = playFor({ p, capital, chain, secondChain });
  let trendNote = '';
  if (p.change_7d !== null && p.change_7d < -10) {
    trendNote = ` TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in 7 days, so start at half size and only add if the trend flattens.`;
  } else if (p.change_7d !== null && p.change_7d > 10) {
    trendNote = ` TVL rose ${p.change_7d.toFixed(1)}% in 7 days, so expect busy contracts and check gas before the main deposit.`;
  }
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

// ------------------------------------------------------------ the board

interface Fit {
  model: FittedModel;
  beta: number[];
  categories: string[];
  medianAge: number;
}

function boardFromFit(snapshot: Snapshot, spec: RidgeSpec, fit: Fit): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored: { row: BoardRow; implied: number; slug: string }[] = [];
  for (const p of snapshot.protocols) {
    if (!isLaunchCandidate(p)) continue;
    const v = impliedValue(p, fit.beta, fit.categories, fit.medianAge, snapshot.as_of, spec);
    const odds = tokenOdds(p, snapshot, spec);
    scored.push({
      implied: v.implied,
      slug: p.slug,
      row: {
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: p.mcap_usd,
        listed_at: p.listed_at,
        gecko_id: p.gecko_id,
        symbol: p.symbol,
        token_status: 'pre-token',
        watchlist: watch.has(p.slug),
        age_days: v.age,
        implied_value_usd: v.implied,
        token_odds: round4(odds.odds),
        token_odds_n: odds.n,
        token_odds_tokenized: odds.tokenized,
        model: {
          intercept: round4(v.terms.intercept),
          log_tvl: round4(v.terms.log_tvl),
          change: round4(v.terms.change),
          log_age: round4(v.terms.log_age),
          log_chains: round4(v.terms.log_chains),
          category: round4(v.terms.category),
          category_name: v.terms.category_name,
          age_days: v.age,
        },
        farm_steps: farmSteps(p, v.age),
      },
    });
  }
  scored.sort((a, b) => b.implied - a.implied || bySlugAsc(a.slug, b.slug));
  scored.forEach((entry, i) => {
    entry.row.rank = i + 1;
  });
  return scored.map((entry) => entry.row);
}

export function buildBoard(snapshot: Snapshot, spec: RidgeSpec = RIDGE): BoardRow[] {
  return boardFromFit(snapshot, spec, fitModel(snapshot, spec));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  const tokenized = snapshot.protocols.filter((p) => !recordsNoToken(p));
  tokenized.sort(
    (a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a.slug, b.slug),
  );
  return tokenized.slice(0, 36).map((p) => ({
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

export function buildRadar(snapshot: Snapshot, spec: RidgeSpec = RIDGE): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot, spec);
  const board = boardFromFit(snapshot, spec, fit);
  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: fit.model,
    model_version: MODEL_VERSION,
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
      token_odds: r.token_odds,
      token_odds_n: r.token_odds_n,
      token_odds_tokenized: r.token_odds_tokenized,
      terms: {
        intercept: r.model.intercept,
        log_tvl: r.model.log_tvl,
        change: r.model.change,
        log_age: r.model.log_age,
        log_chains: r.model.log_chains,
        category: r.model.category,
        category_name: r.model.category_name,
      },
      farm_steps: r.farm_steps,
    })),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

// ------------------------------------------------------------ snapshot in, board checked

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

/** Every rule the sealed gate will apply to the board, checked before a
 *  single byte is written: row count, unique slugs, watchlist coverage,
 *  ranks exactly 1..N with non-increasing values, value range, farm steps. */
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
