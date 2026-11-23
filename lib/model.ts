// Launch Radar v2 — a token launch radar whose value model is FITTED on the
// snapshot's own tokenized protocols and VALIDATED held-out, twice.
//
// What the session's exploration found (2026-11-22, against the sealed snapshot):
//   - Only 128 of the 758 protocols carry a usable market cap (mcap_usd > 0).
//     The other 288 that record a token have no market cap in the file, so the
//     fit set is 128, not 416. Fitting on anything else would be fiction.
//   - log(market cap) is regressed on log(TVL), clamped 7-day change, log age,
//     log chain count and one dummy per category with >= 7 fit peers, by ridge
//     regression (lambda 30). Unpenalised OLS was tried first: its change and
//     category coefficients swung wildly between splits (change -10.9 in one
//     split, -0.3 in the other), so ridge is what keeps the model honest.
//   - Held-out, twice: split A (hash parity of the slug, 69 fit / 59 test)
//     median absolute log error 1.266; split B (slug-order halves, 64 / 64)
//     median 1.140. A TVL-only baseline scores 1.243 / 1.070 on the same
//     splits, so the extra terms do not beat TVL alone — they are kept small
//     by the ridge penalty and adjust the ranking modestly. Market caps are
//     noisy: a typical miss is about a factor of 3. The board is a ranking
//     device, not a price forecast, and the dashboard says so in plain words.
//   - Token odds come from the peer set too: the shrunk share of protocols in
//     the same category that already record a token, blended toward the
//     overall share (0.549). No name is ever special-cased.
//
// Universe accounting, always from the snapshot itself:
//   758 protocols = 416 that record a token (gecko_id or symbol present)
//                 + 342 that record no token
//   Of the 342, 144 are not a launch of their own — wrapped / staked / bridged
//   products, centralised exchanges, versioned pools of another protocol — and
//   are set aside too. The board ranks the remaining 198 launch candidates and
//   covers all 40 watchlist slugs, which all survive that filter.
//
// No protocol name is ever special-cased. One fitted function prices every row.

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

/** Ridge specification. Only the penalty, the clamps and the peer-count floor
 *  are chosen here; every coefficient is fitted from the snapshot at run time. */
export interface RidgeSpec {
  lambda: number; // ridge penalty on every term except the intercept
  change_floor: number; // clamp for change_7d, percent
  change_cap: number;
  category_min_peers: number; // a category needs this many fit peers for its own dummy
  odds_shrink_k: number; // pseudo-count blending a category's token share toward the overall share
}

export const RIDGE: RidgeSpec = {
  lambda: 30,
  change_floor: -30,
  change_cap: 30,
  category_min_peers: 7,
  odds_shrink_k: 5,
};

export const MODEL_VERSION = 'launch-radar-v2';

/** One held-out validation split, computed by fitting on its fit part only. */
export interface ValidationSplit {
  name: string;
  n_fit: number;
  n_test: number;
  median_abs_log_error: number;
  mean_abs_log_error: number;
}

/** The fitted model, as the dashboard's methodology view shows it. */
export interface FittedModel {
  version: string;
  lambda: number;
  fit_n: number; // tokenized protocols with a usable market cap (128 on this snapshot)
  tokenized_recorded: number; // protocols that record a token at all (416)
  no_mcap: number; // of those, how many carry no market cap
  median_age_days: number; // median age of the fit set; unknown ages are set to this
  intercept: number;
  coef_log_tvl: number;
  coef_change: number;
  coef_log_age: number;
  coef_log_chains: number;
  categories: string[]; // categories with their own dummy, in feature order
  category_coefs: number[];
  global_token_share: number; // share of all protocols that record a token
  validation: ValidationSplit[];
  in_sample_median_abs_log_error: number;
  tvl_only_validation: ValidationSplit[]; // the baseline the extra terms are judged against
}

/** Additive log-space breakdown of one protocol's implied value. Each term is
 *  the fitted coefficient times the protocol's feature; exp(term) is the
 *  multiplier the detail view shows, and the terms sum to log(implied). */
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
  token_odds: number; // shrunk share of same-category protocols that already record a token
  token_odds_n: number; // protocols in the category the odds are counted over
  token_odds_tokenized: number; // of those, how many record a token
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

/** The fit set: protocols whose token's market cap the snapshot actually
 *  carries (mcap_usd > 0). A recorded token with no market cap cannot teach
 *  the regression anything, so those 272 are excluded here, not imputed. */
export function fitSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Categories earning their own dummy: >= category_min_peers fit peers,
 *  ordered by peer count desc, then name — deterministic on any snapshot. */
export function fitCategories(fit: SnapshotProtocol[], spec: RidgeSpec): string[] {
  const counts = new Map<string, number>();
  for (const p of fit) counts.set(p.category ?? 'Uncategorised', (counts.get(p.category ?? 'Uncategorised') ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= spec.category_min_peers)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name]) => name);
}

export function medianFitAge(fit: SnapshotProtocol[], asOf: string): number {
  const ages = fit.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  return ages.length === 0 ? 1000 : median(ages);
}

/** Feature vector for one protocol, in the fitted model's order:
 *  [1, ln TVL, clamped change/100, ln(1+age), ln(chains), category dummies]. */
export function features(
  p: SnapshotProtocol,
  categories: string[],
  medianAge: number,
  asOf: string,
  spec: RidgeSpec,
): number[] {
  const age = ageDays(asOf, p.listed_at) ?? medianAge;
  const change = Math.min(spec.change_cap, Math.max(spec.change_floor, typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0)) / 100;
  const key = p.category ?? 'Uncategorised';
  return [1, Math.log(p.tvl_usd), change, Math.log1p(Math.max(0, age)), Math.log(Math.max(1, p.chains.length)), ...categories.map((c) => (key === c ? 1 : 0))];
}

/** Ridge regression by normal equations + Gauss-Jordan. The intercept is
 *  never penalised. Deterministic: same inputs, same coefficients. */
export function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < k; r++) {
      b[r]! += X[i]![r]! * y[i]!;
      for (let c = 0; c < k; c++) A[r]![c]! += X[i]![r]! * X[i]![c]!;
    }
  }
  for (let i = 1; i < k; i++) A[i]![i]! += lambda;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    for (let j = col; j <= k; j++) M[col]![j]! /= d;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      for (let j = col; j <= k; j++) M[r]![j]! -= f * M[col]![j]!;
    }
  }
  return M.map((row) => row[k]!);
}

function absLogErrors(fit: SnapshotProtocol[], test: SnapshotProtocol[], categories: string[], medianAge: number, asOf: string, spec: RidgeSpec): number[] {
  const beta = ridgeFit(
    fit.map((p) => features(p, categories, medianAge, asOf, spec)),
    fit.map((p) => Math.log(p.mcap_usd!)),
    spec.lambda,
  );
  return test
    .map((p) => {
      const x = features(p, categories, medianAge, asOf, spec);
      const pred = beta.reduce((s, v, i) => s + v * x[i]!, 0);
      return Math.abs(pred - Math.log(p.mcap_usd!));
    })
    .sort((a, b) => a - b);
}

function summariseErrors(name: string, fit: SnapshotProtocol[], test: SnapshotProtocol[], categories: string[], medianAge: number, asOf: string, spec: RidgeSpec): ValidationSplit {
  const errs = absLogErrors(fit, test, categories, medianAge, asOf, spec);
  return {
    name,
    n_fit: fit.length,
    n_test: test.length,
    median_abs_log_error: round4(errs[Math.floor(errs.length / 2)] ?? 0),
    mean_abs_log_error: round4(errs.reduce((s, e) => s + e, 0) / Math.max(1, errs.length)),
  };
}

const slugHash = (slug: string): number => [...slug].reduce((s, c) => s + c.charCodeAt(0), 0);

/** Fit the model on the whole fit set and validate it twice, each time by
 *  fitting on one part only and scoring the held-out part. Split A is hash
 *  parity of the slug; split B is the slug-order halves. The same two splits
 *  are also run for a TVL-only baseline, so the dashboard can say honestly
 *  whether the extra terms earned their keep. */
export function fitModel(snapshot: Snapshot, spec: RidgeSpec = RIDGE): { model: FittedModel; beta: number[]; categories: string[]; medianAge: number } {
  const fit = fitSet(snapshot);
  const categories = fitCategories(fit, spec);
  const medianAge = medianFitAge(fit, snapshot.as_of);
  const beta = ridgeFit(
    fit.map((p) => features(p, categories, medianAge, snapshot.as_of, spec)),
    fit.map((p) => Math.log(p.mcap_usd!)),
    spec.lambda,
  );
  const tokenizedRecorded = snapshot.protocols.filter((p) => !recordsNoToken(p)).length;
  const globalShare = tokenizedRecorded / Math.max(1, snapshot.protocols.length);

  const splitA_fit = fit.filter((p) => slugHash(p.slug) % 2 === 0);
  const splitA_test = fit.filter((p) => slugHash(p.slug) % 2 === 1);
  const sorted = [...fit].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const splitB_fit = sorted.slice(0, Math.floor(sorted.length / 2));
  const splitB_test = sorted.slice(Math.floor(sorted.length / 2));
  const validation = [
    summariseErrors('Split A — hash parity of slug', splitA_fit, splitA_test, categories, medianAge, snapshot.as_of, spec),
    summariseErrors('Split B — slug-order halves', splitB_fit, splitB_test, categories, medianAge, snapshot.as_of, spec),
  ];
  // TVL-only baseline on the same splits: intercept + ln TVL, no other terms.
  const tvlOnly = (fitPart: SnapshotProtocol[], testPart: SnapshotProtocol[]): ValidationSplit => {
    const b = ridgeFit(
      fitPart.map((p) => [1, Math.log(p.tvl_usd)]),
      fitPart.map((p) => Math.log(p.mcap_usd!)),
      0,
    );
    const errs = testPart.map((p) => Math.abs(b[0]! + b[1]! * Math.log(p.tvl_usd) - Math.log(p.mcap_usd!))).sort((a, b) => a - b);
    return {
      name: '',
      n_fit: fitPart.length,
      n_test: testPart.length,
      median_abs_log_error: round4(errs[Math.floor(errs.length / 2)] ?? 0),
      mean_abs_log_error: round4(errs.reduce((s, e) => s + e, 0) / Math.max(1, errs.length)),
    };
  };
  const tvlOnlyA = tvlOnly(splitA_fit, splitA_test);
  tvlOnlyA.name = validation[0]!.name;
  const tvlOnlyB = tvlOnly(splitB_fit, splitB_test);
  tvlOnlyB.name = validation[1]!.name;
  const inSample = absLogErrors(fit, fit, categories, medianAge, snapshot.as_of, spec);

  const model: FittedModel = {
    version: MODEL_VERSION,
    lambda: spec.lambda,
    fit_n: fit.length,
    tokenized_recorded: tokenizedRecorded,
    no_mcap: tokenizedRecorded - fit.length,
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
    tvl_only_validation: [tvlOnlyA, tvlOnlyB],
  };
  return { model, beta, categories, medianAge };
}

/** Token odds for one protocol, from the peer set: the share of protocols in
 *  its category that already record a token, shrunk toward the overall share
 *  with a pseudo-count, so a thin category cannot claim 0% or 100%. */
export function tokenOdds(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  spec: RidgeSpec,
): { odds: number; n: number; tokenized: number } {
  const key = p.category ?? 'Uncategorised';
  let n = 0;
  let tokenized = 0;
  let all = 0;
  let allTokenized = 0;
  for (const q of snapshot.protocols) {
    if (!recordsNoToken(q)) allTokenized++;
    all++;
    if ((q.category ?? 'Uncategorised') !== key) continue;
    n++;
    if (!recordsNoToken(q)) tokenized++;
  }
  const overall = all === 0 ? 0 : allTokenized / all;
  const odds = (tokenized + spec.odds_shrink_k * overall) / (n + spec.odds_shrink_k);
  return { odds, n, tokenized };
}

/** Additive log-space breakdown of one protocol's fitted value. */
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
  const catIdx = categories.indexOf(key);
  return {
    intercept: beta[0]!,
    log_tvl: beta[1]! * x[1]!,
    change: beta[2]! * x[2]!,
    log_age: beta[3]! * x[3]!,
    log_chains: beta[4]! * x[4]!,
    category: catIdx >= 0 ? beta[5 + catIdx]! : 0,
    category_name: catIdx >= 0 ? key : null,
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
  const age = ageDays(asOf, p.listed_at);
  const implied = Math.max(1, Math.round(Math.exp(logValue)));
  return { implied, terms, age };
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

export function buildBoard(snapshot: Snapshot, spec: RidgeSpec = RIDGE): BoardRow[] {
  const { beta, categories, medianAge } = fitModel(snapshot, spec);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(isLaunchCandidate);
  const scored = candidates.map((p) => {
    const v = impliedValue(p, beta, categories, medianAge, snapshot.as_of, spec);
    const odds = tokenOdds(p, snapshot, spec);
    return { p, ...v, odds };
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
    token_odds: round4(s.odds.odds),
    token_odds_n: s.odds.n,
    token_odds_tokenized: s.odds.tokenized,
    model: {
      intercept: round4(s.terms.intercept),
      log_tvl: round4(s.terms.log_tvl),
      change: round4(s.terms.change),
      log_age: round4(s.terms.log_age),
      log_chains: round4(s.terms.log_chains),
      category: round4(s.terms.category),
      category_name: s.terms.category_name,
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

export function buildRadar(snapshot: Snapshot, spec: RidgeSpec = RIDGE): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, spec);
  const live = liveRows(snapshot);
  const { model } = fitModel(snapshot, spec);
  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
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
