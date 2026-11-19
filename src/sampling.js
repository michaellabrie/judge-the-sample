// The one shared sampling module. Every display in the app calls these functions, so a chart can
// never use a different estimator. Pure JavaScript with no browser or React code, so the automated
// checks (tests/check.mjs) run the exact same code in Node.
//
// Row numbers are 1-based and follow the file's row order (chronological for heart_rate_week.csv).

// ---------------------------------------------------------------- data
/** Parse heart_rate_week.csv text into the finite population: one object per row, in file order. */
export function parsePopulation(csvText) {
  const [header, ...lines] = csvText.trim().split(/\r?\n/);
  const cols = header.split(",");
  const at = (name) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`Column ${name} is missing from the CSV`);
    return i;
  };
  const iRow = at("row_id"), iTime = at("timestamp"), iHr = at("heart_rate_bpm"), iState = at("activity_state");
  return lines.map((line) => {
    const f = line.split(",");
    const value = Number(f[iHr]);
    if (!Number.isFinite(value)) throw new Error(`Row ${f[iRow]}: heart_rate_bpm is not a number`);
    return { row: Number(f[iRow]), timestamp: f[iTime], value, group: f[iState] };
  });
}

/** Minutes from `origin` to `ts` (both "YYYY-MM-DD HH:MM", device local time; read as clock time, no time zone). */
export function minuteOfWeek(ts, origin) {
  const toMin = (s) => {
    const [d, t] = s.split(" ");
    const [Y, M, D] = d.split("-").map(Number);
    const [h, mi] = t.split(":").map(Number);
    return Date.UTC(Y, M - 1, D, h, mi) / 60000;
  };
  return toMin(ts) - toMin(origin);
}

/** Recording gaps: runs of missing minutes between consecutive rows (timestamps more than 1 minute apart). */
export function recordingGaps(population) {
  const origin = population[0].timestamp;
  const gaps = [];
  for (let i = 1; i < population.length; i++) {
    const a = minuteOfWeek(population[i - 1].timestamp, origin), b = minuteOfWeek(population[i].timestamp, origin);
    if (b - a > 1) gaps.push({ afterRow: population[i - 1].row, startMinute: a + 1, minutes: b - a - 1 });
  }
  return gaps;
}

/**
 * A labelled modified copy: rows in `group` get `shift` added to their value. The original array is
 * never changed. Its true mean must be recomputed from its own rows (see trueMean).
 */
export function modifiedCopy(population, group, shift) {
  return population.map((r) => (r.group === group ? { ...r, value: r.value + shift } : { ...r }));
}

// ---------------------------------------------------------------- random numbers
/** Seedable generator (mulberry32): the same seed always gives the same sequence in [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  // uniform integer in lo..hi inclusive
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---------------------------------------------------------------- estimators
export function mean(values) {
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** True mean: the mean of the target over all N rows of this population. */
export function trueMean(population) {
  return mean(population.map((r) => r.value));
}

export function sampleMean(population, rows) {
  let s = 0;
  for (const i of rows) s += population[i - 1].value;
  return s / rows.length;
}

function checkSize(N, n) {
  if (!Number.isInteger(n) || n < 1 || n > N) throw new Error(`Sample size must be a whole number from 1 to ${N}`);
}

// ---------------------------------------------------------------- simple random sampling
/**
 * n distinct row numbers from 1..N, without replacement, every set of n rows equally likely
 * (Floyd's algorithm). Returned in row order.
 */
export function srsRows(N, n, rng) {
  checkSize(N, n);
  const chosen = new Set();
  for (let j = N - n + 1; j <= N; j++) {
    const t = randInt(rng, 1, j);
    chosen.add(chosen.has(t) ? j : t);
  }
  return [...chosen].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- systematic sampling
/** Which systematic design applies for this N and n. */
export function systematicDesign(N, n) {
  checkSize(N, n);
  const whole = N % n === 0;
  return { N, n, whole, k: N / n, design: whole ? "whole-number interval" : "fractional interval" };
}

/** The rows for one start. Whole-number design: start r in 1..k. Fractional design: start u in (0, k]. */
export function systematicRowsFromStart(N, n, start) {
  const { whole, k } = systematicDesign(N, n);
  const rows = new Array(n);
  for (let j = 0; j < n; j++) {
    if (whole) rows[j] = start + j * k;
    else {
      // ceil(u + j*k), computed as u + j*N/n; guard against rounding pushing past N
      rows[j] = Math.min(N, Math.max(1, Math.ceil(start + (j * N) / n)));
    }
  }
  return rows;
}

/** One systematic sample with a random start, in file row order. */
export function systematicSample(N, n, rng) {
  const d = systematicDesign(N, n);
  const start = d.whole ? randInt(rng, 1, d.k) : d.k * (1 - rng()); // 1 - rng() is in (0, 1]
  return { ...d, start, rows: systematicRowsFromStart(N, n, start) };
}

/** Exact enumeration for the whole-number design: every start 1..k exactly once. */
export function systematicAllStarts(N, n) {
  const d = systematicDesign(N, n);
  if (!d.whole) throw new Error("Exact enumeration applies only to the whole-number interval design");
  return Array.from({ length: d.k }, (_, i) => ({ start: i + 1, rows: systematicRowsFromStart(N, n, i + 1) }));
}

// ---------------------------------------------------------------- stratified sampling
/** Stratum sizes N_h, in a fixed order (order of first appearance unless `order` is given). */
export function strata(population, order) {
  const sizes = new Map();
  for (const r of population) sizes.set(r.group, (sizes.get(r.group) || 0) + 1);
  const names = order ? order.filter((g) => sizes.has(g)) : [...sizes.keys()];
  for (const g of sizes.keys()) if (!names.includes(g)) names.push(g);
  const N = population.length;
  return names.map((name) => ({ name, size: sizes.get(name), weight: sizes.get(name) / N }));
}

/**
 * Proportional allocation with largest-remainder rounding: whole numbers, at least 1 per stratum,
 * never more than the stratum size, total exactly n. If n is smaller than the number of strata the
 * rule cannot be met: returns { ok: false } and the app asks the user what to do.
 */
export function proportionalAllocation(stratumList, n) {
  const N = stratumList.reduce((s, h) => s + h.size, 0);
  checkSize(N, n);
  if (n < stratumList.length) {
    return { ok: false, reason: `n = ${n} is smaller than the ${stratumList.length} strata, so at least 1 row per stratum is impossible.` };
  }
  const rows = stratumList.map((h) => {
    const quota = (n * h.size) / N;
    return { ...h, quota, alloc: Math.min(h.size, Math.max(1, Math.floor(quota))) };
  });
  let diff = n - rows.reduce((s, h) => s + h.alloc, 0);
  while (diff !== 0) {
    if (diff > 0) {
      // give the next row to the stratum with the largest remaining quota that still has room
      const open = rows.filter((h) => h.alloc < h.size);
      open.sort((a, b) => (b.quota - b.alloc) - (a.quota - a.alloc) || b.size - a.size);
      open[0].alloc += 1;
      diff -= 1;
    } else {
      // take a row back from the stratum most above its quota that keeps at least 1
      const over = rows.filter((h) => h.alloc > 1);
      over.sort((a, b) => (a.quota - a.alloc) - (b.quota - b.alloc) || a.size - b.size);
      over[0].alloc -= 1;
      diff += 1;
    }
  }
  return { ok: true, rule: "proportional, largest-remainder rounding, at least 1 per stratum", strata: rows };
}

/** Row numbers (1-based) of each stratum, in row order. */
export function rowsByStratum(population) {
  const map = new Map();
  population.forEach((r, i) => {
    if (!map.has(r.group)) map.set(r.group, []);
    map.get(r.group).push(i + 1);
  });
  return map;
}

/** One stratified sample: SRS without replacement inside each stratum, sizes from the allocation. */
export function stratifiedSample(population, allocation, rng, byStratum = rowsByStratum(population)) {
  if (!allocation.ok) throw new Error(allocation.reason);
  const parts = allocation.strata.map((h) => {
    const members = byStratum.get(h.name);
    const picks = srsRows(members.length, h.alloc, rng).map((i) => members[i - 1]);
    return { ...h, rows: picks };
  });
  return { parts, rows: parts.flatMap((p) => p.rows).sort((a, b) => a - b) };
}

/** Population-weighted stratified estimate: sum over strata of (N_h / N) x (sample mean in stratum h). */
export function stratifiedEstimate(population, parts) {
  const N = population.length;
  return parts.reduce((s, p) => s + (p.size / N) * sampleMean(population, p.rows), 0);
}

// ---------------------------------------------------------------- one sample, any method
export const METHODS = {
  srs: "Simple random",
  systematic: "Systematic (random start)",
  stratified: "Stratified by activity state",
};

/** Draw one sample and its estimate. Returns everything a display needs to explain it. */
export function drawSample(method, population, n, rng, ctx = {}) {
  const N = population.length;
  if (method === "srs") {
    const rows = srsRows(N, n, rng);
    return { method, rows, estimate: sampleMean(population, rows) };
  }
  if (method === "systematic") {
    const s = systematicSample(N, n, rng);
    return { method, ...s, estimate: sampleMean(population, s.rows) };
  }
  if (method === "stratified") {
    const allocation = ctx.allocation || proportionalAllocation(strata(population, ctx.order), n);
    const s = stratifiedSample(population, allocation, rng, ctx.byStratum);
    return { method, allocation, ...s, estimate: stratifiedEstimate(population, s.parts) };
  }
  throw new Error(`Unknown method ${method}`);
}

// ---------------------------------------------------------------- repeated sampling
/**
 * Bias, SD and RMSE of a set of estimates against a true mean, in the target's units.
 * SD divides by the number of estimates, so RMSE^2 = bias^2 + SD^2 exactly.
 */
export function summarize(estimates, truth) {
  const R = estimates.length;
  const m = mean(estimates);
  let ss = 0, se = 0;
  for (const e of estimates) {
    ss += (e - m) ** 2;
    se += (e - truth) ** 2;
  }
  return { count: R, meanEstimate: m, trueMean: truth, bias: m - truth, sd: Math.sqrt(ss / R), rmse: Math.sqrt(se / R) };
}

/**
 * Repeated sampling for one method, one population, one n. Systematic with a whole-number interval
 * is exact enumeration (every start once, no seed). Everything else is Monte Carlo: `reps` separate
 * samples of n rows drawn from one generator seeded with `seed`.
 */
export function repeatedSampling({ method, population, n, reps, seed, order }) {
  const N = population.length;
  const truth = trueMean(population);
  if (method === "systematic" && systematicDesign(N, n).whole) {
    const estimates = systematicAllStarts(N, n).map((s) => sampleMean(population, s.rows));
    return { method, n, type: "exact", seed: null, reps: estimates.length, design: systematicDesign(N, n), estimates, ...summarize(estimates, truth) };
  }
  if (!Number.isInteger(reps) || reps < 1) throw new Error("Repetitions must be a whole number of at least 1");
  const rng = makeRng(seed);
  const ctx = {};
  if (method === "stratified") {
    ctx.allocation = proportionalAllocation(strata(population, order), n);
    if (!ctx.allocation.ok) return { method, n, type: "Monte Carlo", seed, reps, error: ctx.allocation.reason };
    ctx.byStratum = rowsByStratum(population);
  }
  const estimates = new Array(reps);
  for (let i = 0; i < reps; i++) estimates[i] = drawSample(method, population, n, rng, ctx).estimate;
  const extra = method === "systematic" ? { design: systematicDesign(N, n) } : method === "stratified" ? { allocation: ctx.allocation } : {};
  return { method, n, type: "Monte Carlo", seed, reps, estimates, ...extra, ...summarize(estimates, truth) };
}
