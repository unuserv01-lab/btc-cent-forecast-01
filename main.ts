// btc-cent-forecast-01 entry (Node 22, standard library only): a single-point forecast of Bitcoin's
// US-dollar price 240 minutes after each checkpoint.
//
// Method — an honest median of the price at the horizon, built only from the case's own 4,320 closes:
//   1. Drift: the mean log-return over the last 1h and the last 4h, averaged, then shrunk by 0.4 toward
//      zero. Short-horizon drift in BTC carries a little signal but is mostly noise, so the shrink keeps
//      the forecast from chasing the last few minutes.
//   2. Mean reversion: a 0.25 pull of the log-price toward its own 240-minute moving average. Over a
//      4-hour horizon a price stretched far from its recent average tends to come part-way back.
//   3. Clamp: the total log-move is limited to 1.25 x the realised 4-hour volatility (the standard
//      deviation of 1-minute log-returns over the last 240 minutes, scaled by sqrt(240)), so a freak
//      minute cannot throw the guess far from the checkpoint.
//   forecast = last * exp(clamped(240 * drift + pull)), rounded to the grid's 5 decimals and kept in
//   (0, 10,000,000). No look-ahead (only closes up to the checkpoint), no hard-coded prices, no network,
//   no randomness: fully deterministic.
//
// What an entry must do (RULES.txt):
//   - read every <id>.in in the input directory (the grader runs one case at a time, with only that
//     case's file there), canonical JSON {"schema":"makefun/btc-cent-case/v1","competition","case","at",
//     "horizon_minutes","markets":[{"id","name","start","prices"}]}, where `prices` holds one close a
//     minute in US dollars per whole BTC from `start` to `at` inclusive, so the last one is the close
//     at the checkpoint;
//   - write <id>.out to the output directory: {"forecasts":[{"case":"<the case's id>","price":<number>}]},
//     exactly one row naming the case and no other key, its price a finite number greater than 0 and
//     less than 10,000,000, at most 1 MiB. Anything else is an invalid case, scored as if the guess
//     were the checkpoint's own close, and an entry with any invalid case ranks below every valid one
//     and takes no prize.
// It runs offline, with no network, under the case's time cap: everything it knows is in the case's prices.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Shrinkage applied to the recent-drift estimate (toward zero / persistence). */
const DRIFT_SHRINK = 0.4;
/** Fraction of the gap to the 240-minute moving average closed by mean reversion. */
const REVERSION_PULL = 0.25;
/** Cap on the total forecast log-move, in units of the 4-hour realised volatility. */
const MOVE_CLAMP_SIGMAS = 1.25;
/** Windows (minutes) for the drift estimate and the mean-reversion anchor. */
const DRIFT_SHORT_WINDOW = 60;
const DRIFT_LONG_WINDOW = 240;
const ANCHOR_WINDOW = 240;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
  horizon_minutes?: number;
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Forecast of one market's price `horizon` minutes after its last close. */
function forecast(m: CaseMarket, horizon: number): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  // A bad tick (non-finite or non-positive close) would poison every log-return, so drop it and
  // forecast from the clean series; the checkpoint close itself must still be a real price.
  const prices = m.prices.filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0);
  if (prices.length === 0) throw new Error(`market ${m.id} has no usable prices`);
  const last = prices[prices.length - 1] as number;
  if (prices.length < 2) return price5(last);

  // One-minute log-returns, causal: only closes up to the checkpoint.
  const logReturns: number[] = new Array<number>(prices.length - 1);
  for (let i = 1; i < prices.length; i++) {
    logReturns[i - 1] = Math.log((prices[i] as number) / (prices[i - 1] as number));
  }

  // 1. Drift: average of the 1h and 4h mean log-returns, shrunk toward zero.
  const drift =
    0.5 * (mean(logReturns.slice(-DRIFT_SHORT_WINDOW)) + mean(logReturns.slice(-DRIFT_LONG_WINDOW))) *
    DRIFT_SHRINK;

  // 2. Mean reversion: pull toward the 240-minute moving average of the price.
  const anchor = mean(prices.slice(-ANCHOR_WINDOW));
  const pull = REVERSION_PULL * Math.log(anchor / last);

  // 3. Clamp the total log-move to a sane multiple of realised 4h volatility.
  const recent = logReturns.slice(-DRIFT_LONG_WINDOW);
  const mu = mean(recent);
  const variance = mean(recent.map((r) => (r - mu) * (r - mu)));
  const sigmaHorizon = Math.sqrt(variance * horizon);
  let move = horizon * drift + pull;
  const cap = MOVE_CLAMP_SIGMAS * sigmaHorizon;
  if (move > cap) move = cap;
  else if (move < -cap) move = -cap;

  return price5(last * Math.exp(move));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  const horizon = typeof c.horizon_minutes === 'number' && Number.isFinite(c.horizon_minutes) && c.horizon_minutes > 0
    ? c.horizon_minutes
    : 240;
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket, horizon) }] })}\n`);
}
