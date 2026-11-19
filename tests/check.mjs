// Automated correctness checks for src/sampling.js:  npm test
// Software verification only: invariants, known answers on small synthetic populations,
// reproducibility, and that the real CSV parses. It reports no experiment results.
import { readFileSync } from "node:fs";
import * as S from "../src/sampling.js";

let passed = 0, failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ""}`); }
}
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const distinctInRange = (rows, N) => new Set(rows).size === rows.length && rows.every((r) => Number.isInteger(r) && r >= 1 && r <= N);
const pop = (values, groups) => values.map((v, i) => ({ row: i + 1, timestamp: "", value: v, group: groups ? groups[i] : "a" }));

console.log("Real data parses");
const real = S.parsePopulation(readFileSync(new URL("../data/heart_rate_week.csv", import.meta.url), "utf8"));
check("N = 9,864 rows", real.length === 9864, String(real.length));
check("every heart_rate_bpm is a number", real.every((r) => Number.isFinite(r.value)));
check("rows are numbered 1..N in file order", real.every((r, i) => r.row === i + 1));
const realStrata = S.strata(real, ["sleep", "rest", "exercise"]);
check("activity_state sizes 2,929 / 5,886 / 1,049", realStrata.map((h) => h.size).join() === "2929,5886,1049");
const gaps = S.recordingGaps(real);
check("recording gaps total 216 missing minutes; longest step between rows is 135 minutes (134 missing), as documented",
  gaps.reduce((s, g) => s + g.minutes, 0) === 216 && Math.max(...gaps.map((g) => g.minutes)) + 1 === 135);
check("recorded minutes + missing minutes = 7 x 1,440", real.length + gaps.reduce((s, g) => s + g.minutes, 0) === 10080 && S.minuteOfWeek(real[real.length - 1].timestamp, real[0].timestamp) === 10079);
check("the student's true mean 66.4110503 matches to 7 decimals", close(S.trueMean(real), 66.4110503, 5e-8), S.trueMean(real).toFixed(8));

console.log("Simple random sampling");
const rngA = S.makeRng(1);
for (const n of [1, 10, 100, 9863, 9864]) {
  const rows = S.srsRows(9864, n, rngA);
  check(`n = ${n}: exactly n distinct rows within 1..N`, rows.length === n && distinctInRange(rows, 9864));
}
{ // every set of 2 rows from 5 equally likely (10 subsets)
  const counts = new Map(), rng = S.makeRng(7), R = 200000;
  for (let i = 0; i < R; i++) { const k = S.srsRows(5, 2, rng).join("-"); counts.set(k, (counts.get(k) || 0) + 1); }
  const freqs = [...counts.values()].map((c) => c / R);
  check("N=5, n=2: all 10 subsets occur, each about 1/10", counts.size === 10 && freqs.every((f) => Math.abs(f - 0.1) < 0.005), freqs.map((f) => f.toFixed(3)).join(" "));
}
check("n = 0 and n = N+1 are refused", (() => { try { S.srsRows(5, 0, rngA); return false; } catch { try { S.srsRows(5, 6, rngA); return false; } catch { return true; } } })());

console.log("Systematic sampling");
{
  const d = S.systematicDesign(100, 10);
  check("N=100, n=10 uses the whole-number interval k=10", d.whole && d.k === 10);
  const rows = S.systematicRowsFromStart(100, 10, 3);
  check("start 3 gives rows 3, 13, ..., 93", rows.join() === "3,13,23,33,43,53,63,73,83,93");
  const all = S.systematicAllStarts(100, 10);
  check("exact enumeration lists each start 1..k once", all.length === 10 && all.every((s, i) => s.start === i + 1));
  const covered = all.flatMap((s) => s.rows).sort((a, b) => a - b);
  check("the k starts together cover every row exactly once", covered.every((r, i) => r === i + 1));
  const p = pop(Array.from({ length: 100 }, (_, i) => (i * 37) % 101));
  const ex = S.repeatedSampling({ method: "systematic", population: p, n: 10 });
  check("exact enumeration: type exact, no seed, k results", ex.type === "exact" && ex.seed === null && ex.reps === 10);
  check("exact enumeration: mean of the k estimates equals the true mean (bias 0)", close(ex.bias, 0, 1e-9));
}
for (const [N, n] of [[9864, 1], [9864, 10], [9864, 100], [9864, 9863], [7, 3], [10, 4], [9864, 9864]]) {
  const d = S.systematicDesign(N, n), rng = S.makeRng(N + n);
  let ok = true;
  for (let i = 0; i < 2000; i++) {
    const s = S.systematicSample(N, n, rng);
    if (s.rows.length !== n || !distinctInRange(s.rows, N)) { ok = false; break; }
    if (!d.whole && !(s.start > 0 && s.start <= d.k)) { ok = false; break; }
    if (d.whole) { for (let j = 0; j < n; j++) if (s.rows[j] !== s.start + j * d.k) ok = false; }
    else { for (let j = 0; j < n; j++) if (s.rows[j] !== Math.min(N, Math.ceil(s.start + (j * N) / n))) ok = false; }
  }
  check(`N=${N}, n=${n} (${d.design}): n distinct rows, following the interval from the start, none past N`, ok);
}
{ // fractional design: every row has inclusion probability n/N
  const N = 7, n = 3, R = 210000, rng = S.makeRng(11), hits = new Array(N + 1).fill(0);
  for (let i = 0; i < R; i++) for (const r of S.systematicSample(N, n, rng).rows) hits[r]++;
  const probs = hits.slice(1).map((h) => h / R);
  check("N=7, n=3 fractional: every row included with probability n/N = 3/7", probs.every((q) => Math.abs(q - 3 / 7) < 0.006), probs.map((q) => q.toFixed(3)).join(" "));
}
{ // floating-point guard at the very edge of the fractional design
  const rows = S.systematicRowsFromStart(9864, 9863, 9864 / 9863);
  check("start u = k exactly: last row is N, not N+1", rows[rows.length - 1] === 9864 && distinctInRange(rows, 9864));
}

console.log("Stratified allocation");
for (const n of [3, 10, 100, 1000, 9864]) {
  const a = S.proportionalAllocation(realStrata, n);
  const ok = a.ok && a.strata.reduce((s, h) => s + h.alloc, 0) === n && a.strata.every((h) => Number.isInteger(h.alloc) && h.alloc >= 1 && h.alloc <= h.size);
  check(`n = ${n}: whole numbers, at least 1 each, none above its stratum, total exactly n`, ok, a.ok ? a.strata.map((h) => h.alloc).join("/") : a.reason);
}
check("n smaller than the number of strata is reported, not silently changed", !S.proportionalAllocation(realStrata, 2).ok);
check("stratum weights N_h/N sum to 1", close(realStrata.reduce((s, h) => s + h.weight, 0), 1, 1e-12));
{
  const st = [{ name: "a", size: 50, weight: .5 }, { name: "b", size: 30, weight: .3 }, { name: "c", size: 20, weight: .2 }];
  check("exact proportional case N=100, n=10 gives 5/3/2", S.proportionalAllocation(st, 10).strata.map((h) => h.alloc).join() === "5,3,2");
  const tiny = [{ name: "a", size: 97, weight: .97 }, { name: "b", size: 2, weight: .02 }, { name: "c", size: 1, weight: .01 }];
  const a = S.proportionalAllocation(tiny, 5);
  check("minimum of 1 per stratum is kept and the total is still n (97/2/1, n=5)", a.strata.map((h) => h.alloc).join() === "3,1,1");
}

console.log("Stratified estimator");
{ // known answer: unequal allocation, so the weighted mean differs from the plain mean of the sampled rows
  const p = pop([10, 10, 10, 10, 10, 10, 10, 10, 50, 50], ["a", "a", "a", "a", "a", "a", "a", "a", "b", "b"]);
  const parts = [{ name: "a", size: 8, rows: [1, 2] }, { name: "b", size: 2, rows: [9, 10] }];
  check("weighted estimate = 0.8 x 10 + 0.2 x 50 = 18 (plain mean of sampled rows would be 30)", close(S.stratifiedEstimate(p, parts), 18));
  check("true mean of that population is 18", close(S.trueMean(p), 18));
  const full = S.drawSample("stratified", p, 10, S.makeRng(3));
  check("sampling every row (n = N) gives the true mean exactly", close(full.estimate, 18));
  const s = S.drawSample("stratified", real, 100, S.makeRng(5), { order: ["sleep", "rest", "exercise"] });
  const okParts = s.parts.every((h) => h.rows.length === h.alloc && h.rows.every((r) => real[r - 1].group === h.name)) && distinctInRange(s.rows, 9864) && s.rows.length === 100;
  check("real data, n = 100: each stratum gets its allocation, from its own rows, 100 distinct rows", okParts);
}

console.log("Bias, SD and RMSE");
{
  const sum = S.summarize([1, 2, 3, 6], 2);
  check("known answer: estimates 1,2,3,6 vs truth 2 -> bias 1, SD sqrt(3.5), RMSE sqrt(4.5)", close(sum.bias, 1) && close(sum.sd, Math.sqrt(3.5)) && close(sum.rmse, Math.sqrt(4.5)));
  let ok = true;
  for (const method of ["srs", "systematic", "stratified"]) for (const n of [1, 10, 100]) {
    if (method === "stratified" && n < 3) continue;
    const r = S.repeatedSampling({ method, population: real, n, reps: 100, seed: 42, order: ["sleep", "rest", "exercise"] });
    if (!close(r.rmse ** 2, r.bias ** 2 + r.sd ** 2, 1e-9)) ok = false;
  }
  check("RMSE^2 = bias^2 + SD^2 for every method and n checked", ok);
}

console.log("Monte Carlo and unbiasedness on a synthetic population");
{
  const groups = Array.from({ length: 60 }, (_, i) => (i < 30 ? "x" : i < 50 ? "y" : "z"));
  const p = pop(Array.from({ length: 60 }, (_, i) => (i < 30 ? 5 : i < 50 ? 20 : 80) + (i % 7)), groups);
  for (const method of ["srs", "systematic", "stratified"]) {
    const r = S.repeatedSampling({ method, population: p, n: 7, reps: 40000, seed: 9 });
    check(`${method}, n=7 of 60, 40,000 reps: average estimate within simulation error of the true mean`, Math.abs(r.bias) < 4 * r.sd / Math.sqrt(r.reps), r.bias.toFixed(4));
  }
  const r = S.repeatedSampling({ method: "srs", population: p, n: 10, reps: 100, seed: 1 });
  check("100 repetitions give 100 estimates", r.estimates.length === 100 && r.type === "Monte Carlo");
  const r2 = S.repeatedSampling({ method: "srs", population: p, n: 10, reps: 1000, seed: 1 });
  check("1,000 repetitions give 1,000 estimates", r2.estimates.length === 1000);
}

console.log("Reproducibility");
{
  const a = S.repeatedSampling({ method: "stratified", population: real, n: 100, reps: 100, seed: 2026, order: ["sleep", "rest", "exercise"] });
  const b = S.repeatedSampling({ method: "stratified", population: real, n: 100, reps: 100, seed: 2026, order: ["sleep", "rest", "exercise"] });
  check("same seed and settings: identical estimates and summaries", a.estimates.join() === b.estimates.join() && a.rmse === b.rmse);
  const s1 = S.drawSample("srs", real, 100, S.makeRng(77)), s2 = S.drawSample("srs", real, 100, S.makeRng(77));
  check("same seed: identical single sample", s1.rows.join() === s2.rows.join());
  const f1 = S.systematicSample(9864, 100, S.makeRng(3)), f2 = S.systematicSample(9864, 100, S.makeRng(3));
  check("same seed: identical systematic start (fractional design)", f1.start === f2.start);
}

console.log("Modified copy");
{
  const before = real.map((r) => r.value).join();
  const mod = S.modifiedCopy(real, "exercise", 20);
  check("original population is unchanged", real.map((r) => r.value).join() === before);
  check("only exercise rows change, each by exactly +20", mod.every((r, i) => close(r.value - real[i].value, real[i].group === "exercise" ? 20 : 0, 1e-9)));
  check("modified true mean recomputed from its own rows = baseline + 20 x 1,049/9,864", close(S.trueMean(mod), S.trueMean(real) + 20 * 1049 / 9864, 1e-9));
  check("modified copy keeps N, so the systematic design is the same", mod.length === real.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
