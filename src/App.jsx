import { useMemo, useState } from "react";
import csvText from "../data/heart_rate_week.csv?raw";
import * as S from "./sampling.js";

// Every number on this page comes from src/sampling.js.
const BASE = S.parsePopulation(csvText);
const ORDER = ["sleep", "rest", "exercise"];
const STATE_COLOR = { sleep: "#2a78d6", rest: "#1baf7a", exercise: "#eb6834" }; // validated categorical slots 1-3
const DEFAULT_SEED = 20261105; // the seed planned in DECISIONS.md; change it in the app
const UNITS = "bpm";
const fmt = (v, d = 4) => (v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(d));
const signed = (v, d = 4) => (v >= 0 ? "+" : "") + v.toFixed(d);

// ---------------------------------------------------------------- small controls
function NumberInput({ label, value, onChange, min, max, step = 1, width = 7 }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) { setShown(value); setText(String(value)); }
  const commit = (t) => {
    const v = Number(t);
    if (t.trim() !== "" && Number.isFinite(v) && (step !== 1 || Number.isInteger(v)) && v >= min && v <= max) onChange(v);
  };
  const bad = text.trim() === "" || !Number.isFinite(Number(text)) || (step === 1 && !Number.isInteger(Number(text))) || Number(text) < min || Number(text) > max;
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={text} min={min} max={max} step={step} style={{ width: `${width}em` }}
        className={bad ? "bad" : ""} onChange={(e) => { setText(e.target.value); commit(e.target.value); }} />
      {bad && <small className="warn">Enter a {step === 1 ? "whole number" : "number"} from {min} to {max}</small>}
    </label>
  );
}

function Choice({ label, value, options, onChange }) {
  return (
    <fieldset className="choice">
      <legend>{label}</legend>
      {options.map(([v, text]) => (
        <label key={String(v)} className={v === value ? "on" : ""}>
          <input type="radio" checked={v === value} onChange={() => onChange(v)} />{text}
        </label>
      ))}
    </fieldset>
  );
}

const REPS_NOTE = "100 repetitions usually reveal the main pattern; 1,000 give smoother distributions and more stable bias, SD and RMSE. Neither guarantees stable results, and 100 repetitions cannot reliably separate small differences between methods. Rerun with different seeds to check whether your main conclusions hold.";

// ---------------------------------------------------------------- population timeline
// Stage 2 design B: week timeline on real timestamps, with aligned tracks for activity state,
// sampled minutes and missing (unrecorded) minutes. Gaps are minutes with no row, never drawn as data.
const WEEK = 7 * 24 * 60;
const dayLabel = (m) => new Date(Date.UTC(2016, 3, 25) + m * 60000)
  .toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

function Timeline({ population, sampleRows, estimate, truth, estimateLabel }) {
  const W = 1100, L = 46, R = 175, T = 14, PB = 290, TH = 16, TG = 7;
  const trackY = [PB + 14, PB + 14 + TH + TG, PB + 14 + 2 * (TH + TG)];
  const H = trackY[2] + TH + 26;
  const origin = population[0].timestamp;
  const minutes = useMemo(() => population.map((r) => S.minuteOfWeek(r.timestamp, origin)), [population, origin]);
  const gaps = useMemo(() => S.recordingGaps(population), [population]);
  const sampledSet = useMemo(() => new Set(sampleRows), [sampleRows]);
  const lo = 40, hi = 190;
  const x = (m) => L + (m / WEEK) * (W - L - R);
  const y = (v) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (PB - T);
  const paths = useMemo(() => {
    const out = {};
    population.forEach((r, i) => { out[r.group] = (out[r.group] || "") + `M${x(minutes[i]).toFixed(1)} ${y(r.value).toFixed(1)}h0`; });
    return out;
  }, [population, minutes]);
  // runs of consecutive recorded minutes in the same state (a gap ends a run)
  const runs = useMemo(() => {
    const out = [];
    let cur = null;
    population.forEach((r, i) => {
      if (cur && cur.group === r.group && minutes[i] === cur.end + 1) cur.end = minutes[i];
      else { cur = { group: r.group, start: minutes[i], end: minutes[i] }; out.push(cur); }
    });
    return out;
  }, [population, minutes]);
  const sampled = sampleRows.map((row) => `M${x(minutes[row - 1]).toFixed(1)} ${y(population[row - 1].value).toFixed(1)}h0`).join("");
  const ticks = sampleRows.map((row) => `M${x(minutes[row - 1] + 0.5).toFixed(1)} ${trackY[1]}v${TH}`).join("");
  const days = Array.from({ length: 8 }, (_, d) => d * 1440);
  const yt = [50, 75, 100, 125, 150, 175];
  const yT = y(truth), yE = y(estimate);
  const near = Math.abs(yT - yE) < 14;

  // hover: nearest recorded minute to the pointer
  const [hover, setHover] = useState(null);
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const m = (((e.clientX - box.left) / box.width) * W - L) / (W - L - R) * WEEK;
    if (m < 0 || m > WEEK) return setHover(null);
    let a = 0, b = minutes.length - 1;
    while (b - a > 1) { const c = (a + b) >> 1; if (minutes[c] <= m) a = c; else b = c; }
    const i = Math.abs(minutes[a] - m) <= Math.abs(minutes[b] - m) ? a : b;
    const gap = gaps.find((g) => m >= g.startMinute && m < g.startMinute + g.minutes);
    setHover({ i, gap });
  };
  const h = hover && population[hover.i];

  return (
    <>
      <p className="hover" aria-live="polite">
        {h ? <>{hover.gap ? <b>No reading here ({hover.gap.minutes} missing minutes in a row). Nearest recorded minute: </b> : <b>Pointer: </b>}
          row {h.row} · {h.timestamp} · {h.value.toFixed(1)} bpm · {h.group} · {sampledSet.has(h.row) ? "SAMPLED" : "not sampled"}</>
          : "Move the pointer over the chart to read one recorded minute."}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="timeline" role="img" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        aria-label={`All ${population.length} recorded minutes in time order, with the ${sampleRows.length} sampled minutes highlighted and ${gaps.length} recording gaps marked`}>
        {yt.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {days.map((m, d) => <g key={m}><line x1={x(m)} x2={x(m)} y1={T} y2={trackY[2] + TH} className="grid" />
          {d < 7 && <text x={x(m + 720)} y={H - 6} textAnchor="middle">{dayLabel(m)}</text>}</g>)}
        {ORDER.map((g) => paths[g] && <path key={g} d={paths[g]} stroke={STATE_COLOR[g]} strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />)}
        <path d={sampled} stroke="#ffffff" strokeWidth="9" strokeLinecap="round" />
        <path d={sampled} stroke="#1f2328" strokeWidth="6" strokeLinecap="round" />
        <line x1={L} x2={W - R} y1={yT} y2={yT} className="truth" />
        <text x={W - R + 6} y={yT + (near && yT >= yE ? 14 : -2)} className="lbl">True mean {fmt(truth)}</text>
        <line x1={L} x2={W - R} y1={yE} y2={yE} className="est" />
        <text x={W - R + 6} y={yE + (near && yE > yT ? 14 : -2)} className="lbl">{estimateLabel} {fmt(estimate)}</text>
        <text x={12} y={PB / 2} transform={`rotate(-90 12 ${PB / 2})`} textAnchor="middle">Heart rate (bpm)</text>

        {/* track 1: activity state */}
        {runs.map((r, i) => <rect key={i} x={x(r.start)} width={Math.max(0.6, x(r.end + 1) - x(r.start))} y={trackY[0]} height={TH} fill={STATE_COLOR[r.group]} />)}
        {/* track 2: sampled minutes */}
        <rect x={L} width={W - L - R} y={trackY[1]} height={TH} className="trackbg" />
        <path d={ticks} stroke="#1f2328" strokeWidth="1.5" />
        {/* track 3: missing minutes (min width 2px so one-minute gaps stay visible) */}
        <rect x={L} width={W - L - R} y={trackY[2]} height={TH} className="trackbg" />
        {gaps.map((g) => <rect key={g.afterRow} x={x(g.startMinute)} width={Math.max(2, x(g.startMinute + g.minutes) - x(g.startMinute))} y={trackY[2]} height={TH} className="gap" />)}
        {["Activity state", `Sampled (${sampleRows.length})`, `Missing (${gaps.reduce((s, g) => s + g.minutes, 0)} min)`].map((t, i) =>
          <text key={t} x={W - R + 6} y={trackY[i] + TH - 4} className="tracklbl">{t}</text>)}
        {hover && <line x1={x(minutes[hover.i] + 0.5)} x2={x(minutes[hover.i] + 0.5)} y1={T} y2={trackY[2] + TH} className="cross" />}
      </svg>
    </>
  );
}

// State mix of one sample beside the population's (counts only; not a judgement of any method)
function StateMix({ population, rows, strataList }) {
  const counts = Object.fromEntries(strataList.map((h) => [h.name, 0]));
  for (const r of rows) counts[population[r - 1].group]++;
  return (
    <table className="alloc">
      <caption>Activity-state mix: this single sample beside the whole population</caption>
      <thead><tr><th>State</th><th>Population rows</th><th>Population share</th><th>Sampled rows</th><th>Sample share</th></tr></thead>
      <tbody>{strataList.map((h) => (
        <tr key={h.name}><td><i className="sw" style={{ background: STATE_COLOR[h.name] }} />{h.name}</td><td>{h.size.toLocaleString()}</td>
          <td>{(100 * h.weight).toFixed(1)}%</td><td>{counts[h.name]}</td><td>{(100 * counts[h.name] / rows.length).toFixed(1)}%</td></tr>
      ))}</tbody>
    </table>
  );
}

// ---------------------------------------------------------------- distribution of estimates
function Histogram({ result, domain, title, height = 190 }) {
  const W = 520, H = height, L = 40, R = 12, T = 30, B = 46, bins = 40;
  const [lo, hi] = domain;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const counts = new Array(bins).fill(0);
  for (const e of result.estimates) counts[Math.min(bins - 1, Math.max(0, Math.floor(((e - lo) / (hi - lo)) * bins)))]++;
  const top = Math.max(...counts);
  const bw = (W - L - R) / bins;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  return (
    <figure className="hist">
      <figcaption>{title}. Solid line: true mean; dashed line: mean of the estimates.</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: distribution of ${result.reps} estimates`}>
        {counts.map((c, i) => c > 0 && <rect key={i} x={L + i * bw + 0.5} width={bw - 1} y={H - B - (c / top) * (H - T - B)} height={(c / top) * (H - T - B)} className="bar" />)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
        {ticks.map((t, i) => <text key={t} x={x(t)} y={H - B + 18} textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}>{t.toFixed(1)}</text>)}
        <text x={W - R} y={H - 3} textAnchor="end">estimate (bpm)</text>
        <line x1={x(result.trueMean)} x2={x(result.trueMean)} y1={T - 4} y2={H - B} className="truth" />
        <text x={x(result.trueMean)} y={T - 8} textAnchor="middle" className="lbl truthlbl">true mean {fmt(result.trueMean, 2)}</text>
        <line x1={x(result.meanEstimate)} x2={x(result.meanEstimate)} y1={T + 6} y2={H - B} className="est" />
      </svg>
    </figure>
  );
}

function ResultCard({ result, title, domain, condition, settings }) {
  if (result.error) return <div className="card"><h4>{title}</h4><p className="warn">{result.error}</p></div>;
  return (
    <div className="card">
      <h4>{title}</h4>
      <p className="tags">
        <span className={`tag ${result.type === "exact" ? "exact" : "mc"}`}>{result.type}</span>
        <span className="tag">{condition}</span>
        <span className="tag">n = {result.n}</span>
        <span className="tag">{result.type === "exact" ? `all ${result.reps.toLocaleString()} starts (no seed)` : `${result.reps.toLocaleString()} repetitions · seed ${result.seed}`}</span>
      </p>
      <p className="settings">{settings}</p>
      <Histogram result={result} domain={domain} title="Distribution of estimates (repeated sampling)" />
      <table className="stats">
        <tbody>
          <tr><th>True mean of this population</th><td>{fmt(result.trueMean)} {UNITS}</td></tr>
          <tr><th>Mean of the estimates</th><td>{fmt(result.meanEstimate)} {UNITS}</td></tr>
          <tr><th>Bias (mean of estimates − true mean)</th><td>{signed(result.bias)} {UNITS}</td></tr>
          <tr><th>SD of estimates</th><td>{fmt(result.sd)} {UNITS}</td></tr>
          <tr><th>RMSE</th><td>{fmt(result.rmse)} {UNITS}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

const sharedDomain = (results) => {
  const all = results.filter((r) => !r.error).flatMap((r) => [Math.min(...r.estimates), Math.max(...r.estimates), r.trueMean]);
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.04 || 1;
  return [lo - pad, hi + pad];
};

function settingsText(result, population) {
  if (result.method === "srs") return "Without replacement; every set of n rows equally likely.";
  if (result.method === "systematic") {
    const d = result.design;
    return `File row order (time order); ${d.design}, k = N/n = ${d.N.toLocaleString()}/${d.n} = ${Number.isInteger(d.k) ? d.k : d.k.toFixed(4)}${d.whole ? "; every start 1..k listed once" : "; random start u in (0, k]"}.`;
  }
  const a = result.allocation;
  return `Stratified by activity_state; ${a.rule}: ${a.strata.map((h) => `${h.name} ${h.alloc}`).join(", ")}; population-weighted estimate.`;
}

// ---------------------------------------------------------------- results table (markdown)
function tableRow(experiment, condition, result, settings) {
  return [experiment, condition, S.METHODS[result.method], settings, result.type === "exact" ? "exact" : String(result.seed), result.n,
    result.reps, result.type, fmt(result.trueMean), result.error ? "—" : signed(result.bias), result.error ? "—" : fmt(result.sd), result.error ? "—" : fmt(result.rmse)];
}
function Markdown({ rows }) {
  const head = "| Experiment | Population or condition | Method | Settings | Seed (or exact) | n | Repetitions or starts | Type | True mean | Bias | SD | RMSE |\n|---|---|---|---|---|---|---|---|---|---|---|---|";
  const text = head + "\n" + rows.map((r) => "| " + r.map((c) => String(c).replace(/\|/g, "/")).join(" | ") + " |").join("\n");
  const csv = [["Experiment", "Population or condition", "Method", "Settings", "Seed (or exact)", "n", "Repetitions or starts", "Type", "True mean", "Bias", "SD", "RMSE"], ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const download = (content, ext, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = `judge-the-sample-results.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const [copied, setCopied] = useState(false);
  return (
    <div className="md">
      <button onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
        {copied ? "Copied" : "Copy as Markdown table"}
      </button>{" "}
      <button onClick={() => download(text, "md", "text/markdown")}>Download .md</button>{" "}
      <button onClick={() => download(csv, "csv", "text/csv")}>Download .csv</button>
      <textarea readOnly value={text} rows={rows.length + 3} onFocus={(e) => e.target.select()} />
    </div>
  );
}

// ---------------------------------------------------------------- the page
export default function App() {
  const N = BASE.length;
  const baseTruth = useMemo(() => S.trueMean(BASE), []);
  const baseStrata = useMemo(() => S.strata(BASE, ORDER), []);

  // Stage 2-3: one sample
  const [method, setMethod] = useState("srs");
  const [n, setN] = useState(100);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const one = useMemo(() => {
    if (method === "stratified") {
      const allocation = S.proportionalAllocation(baseStrata, n);
      if (!allocation.ok) return { error: allocation.reason };
      return S.drawSample("stratified", BASE, n, S.makeRng(seed), { allocation, order: ORDER });
    }
    return S.drawSample(method, BASE, n, S.makeRng(seed));
  }, [method, n, seed, baseStrata]);

  // Stage 4: experiments
  const [expSeed, setExpSeed] = useState(DEFAULT_SEED);
  const [expReps, setExpReps] = useState(100);
  const expA = useMemo(() => ["srs", "systematic", "stratified"].map((m) =>
    S.repeatedSampling({ method: m, population: BASE, n: 100, reps: expReps, seed: expSeed, order: ORDER })), [expSeed, expReps]);
  const expB = useMemo(() => [1, 10, 100].map((size) =>
    S.repeatedSampling({ method: "srs", population: BASE, n: size, reps: expReps, seed: expSeed })), [expSeed, expReps]);

  // Stage 5: challenge on a labelled modified copy
  const [chGroup, setChGroup] = useState("exercise");
  const [chShift, setChShift] = useState(20);
  const [chN, setChN] = useState(100);
  const [chSeed, setChSeed] = useState(DEFAULT_SEED);
  const [chReps, setChReps] = useState(100);
  const modified = useMemo(() => S.modifiedCopy(BASE, chGroup, chShift), [chGroup, chShift]);
  const modTruth = useMemo(() => S.trueMean(modified), [modified]);
  const challenge = useMemo(() => {
    const run = (m, population) => S.repeatedSampling({ method: m, population, n: chN, reps: chReps, seed: chSeed, order: ORDER });
    return { srsBase: run("srs", BASE), srsMod: run("srs", modified), strBase: run("stratified", BASE), strMod: run("stratified", modified) };
  }, [modified, chN, chSeed, chReps]);
  const modLabel = `modified: ${chGroup} rows ${chShift >= 0 ? "+" : ""}${chShift} bpm`;

  const domA = sharedDomain(expA), domB = sharedDomain(expB);
  const domC = sharedDomain(Object.values(challenge));

  const mdRows = [
    ...expA.map((r) => tableRow("Methods at n = 100", "baseline", r, settingsText(r, BASE))),
    ...expB.map((r) => tableRow("Sample size", "baseline", r, settingsText(r, BASE))),
    tableRow("Challenge", "baseline", challenge.srsBase, settingsText(challenge.srsBase)),
    tableRow("Challenge", modLabel, challenge.srsMod, settingsText(challenge.srsMod)),
    tableRow("Challenge", "baseline", challenge.strBase, challenge.strBase.error ? "" : settingsText(challenge.strBase)),
    tableRow("Challenge", modLabel, challenge.strMod, challenge.strMod.error ? "" : settingsText(challenge.strMod)),
  ];

  const sys = method === "systematic" && !one.error ? one : null;
  const rule = {
    srs: "Simple random: n different minutes are drawn without replacement, and every set of n minutes is equally likely. Estimate = the sample mean.",
    systematic: "Systematic with a random start: rows are taken at a fixed interval k = N/n through the file's row order, starting from a random point. Estimate = the sample mean.",
    stratified: "Stratified by activity_state: the n rows are shared out across sleep, rest and exercise in proportion to their sizes, then each group is sampled at random without replacement. Estimate = the population-weighted mean, Σ (N_h/N) × (group sample mean).",
  }[method];

  return (
    <main>
      <header>
        <h1>Judge the Sample</h1>
        <p className="question">Which sampling method would you trust for this population, at what sample size, and with what limits?</p>
        <p className="popinfo">
          <b>Finite population:</b> all {N.toLocaleString()} recorded minutes in <code>data/heart_rate_week.csv</code>: one wearer's week,
          25 April – 1 May 2016 (Crowd-sourced Fitbit datasets, Zenodo, CC BY 4.0). It is not every minute of that week and not other people.
          Target: <code>heart_rate_bpm</code> (beats per minute). <b>True population mean: {fmt(baseTruth, 7)} bpm</b> (mean of all {N.toLocaleString()} rows).
        </p>
      </header>

      {/* ---------------------------------------------------------- stage 2-3 */}
      <section>
        <h2>1. The population and one sample</h2>
        <div className="controls">
          <Choice label="Sampling method" value={method} onChange={setMethod}
            options={[["srs", "Simple random"], ["systematic", "Systematic"], ["stratified", "Stratified (activity state)"]]} />
          <div className="field">
            <NumberInput label={`Sample size n (1 to ${N.toLocaleString()})`} value={n} onChange={setN} min={1} max={N} />
            <span className="quick">{[1, 10, 100].map((v) => <button key={v} className={v === n ? "on" : ""} onClick={() => setN(v)}>n = {v}</button>)}</span>
          </div>
          <div className="field">
            <NumberInput label="Seed" value={seed} onChange={setSeed} min={0} max={4294967295} width={9} />
            <button onClick={() => setSeed((s) => (s + 1) % 4294967296)}>Use next seed (seed + 1)</button>
          </div>
        </div>
        <p className="rule">{rule}</p>
        <p className="note">Row order: the file is in time order, one row per recorded minute. 216 minutes of the week have no reading (the
          longest step between consecutive rows is 135 minutes, i.e. 134 missing minutes), so consecutive rows are not always one minute apart: row number is not time. Systematic sampling
          steps through row numbers.</p>

        {one.error ? (
          <p className="warn"><b>Stratified sampling cannot run at n = {n}:</b> {one.error} Choose what to do: pick n ≥ {baseStrata.length}, or tell your agent which rule you want.</p>
        ) : (
          <>
            <div className="readout">
              <span><b>Single sample</b> · {S.METHODS[method]} · n = {n} · seed {seed}</span>
              <span className="estv">Sample estimate: {fmt(one.estimate)} bpm</span>
              <span className="truev">True mean: {fmt(baseTruth)} bpm</span>
            </div>
            {sys && (
              <p className="design">
                Systematic design for N = {N.toLocaleString()}, n = {n}: <b>{sys.design}</b>, k = N/n = {Number.isInteger(sys.k) ? sys.k : sys.k.toFixed(4)}.{" "}
                {sys.whole ? <>Random start r = {sys.start} (from 1..{sys.k}); rows r, r + k, r + 2k, …</>
                  : <>Random start u = {sys.start.toFixed(4)} (uniform on (0, k]); rows ⌈u + j·k⌉ for j = 0..{n - 1}.</>}
              </p>
            )}
            {method === "stratified" && (
              <table className="alloc">
                <thead><tr><th>Stratum</th><th>N_h (rows)</th><th>Weight N_h/N</th><th>Allocation</th><th>Stratum sample mean</th><th>Weighted contribution</th></tr></thead>
                <tbody>{one.parts.map((h) => {
                  const m = S.sampleMean(BASE, h.rows);
                  return <tr key={h.name}><td><i className="sw" style={{ background: STATE_COLOR[h.name] }} />{h.name}</td><td>{h.size.toLocaleString()}</td>
                    <td>{h.weight.toFixed(4)}</td><td>{h.alloc}</td><td>{fmt(m)}</td><td>{fmt(h.weight * m)}</td></tr>;
                })}</tbody>
                <tfoot><tr><td colSpan={3}>{one.allocation.rule}</td><td>{one.rows.length}</td><td>Population-weighted estimate</td><td>{fmt(one.estimate)}</td></tr></tfoot>
              </table>
            )}
            <Timeline population={BASE} sampleRows={one.rows} estimate={one.estimate} truth={baseTruth} estimateLabel="Sample estimate" />
            <p className="legend">
              {ORDER.map((g) => <span key={g}><i className="sw" style={{ background: STATE_COLOR[g] }} />{g} ({baseStrata.find((h) => h.name === g).size.toLocaleString()} rows)</span>)}
              <span><i className="sw samp" />sampled minute</span>
              <span><i className="sw gapsw" />missing minutes (no reading)</span>
              <span><i className="ln truthln" />true mean</span><span><i className="ln estln" />sample estimate</span>
            </p>
            <StateMix population={BASE} rows={one.rows} strataList={baseStrata} />
            <details><summary>Selected rows ({one.rows.length})</summary><p className="rows">{one.rows.join(", ")}</p></details>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------- stage 4 */}
      <section>
        <h2>2. Experiments on the baseline population</h2>
        <div className="controls">
          <Choice label="Repetitions (Monte Carlo)" value={expReps} onChange={setExpReps} options={[[100, "100"], [1000, "1,000"]]} />
          <NumberInput label="Seed" value={expSeed} onChange={setExpSeed} min={0} max={4294967295} width={9} />
        </div>
        <p className="note">Sample size and repetitions are separate settings: n is the number of rows in one sample; repetitions is how many
          separate samples are drawn. Each sample is drawn without replacement; a row can appear again in a later repetition. {REPS_NOTE}{" "}
          Systematic sampling with a whole-number interval is <b>exact</b>: every start is listed once, with no random draws and no seed.</p>

        <h3>Experiment A: three methods at n = 100 (baseline)</h3>
        <div className="cards">{expA.map((r) => <ResultCard key={r.method} result={r} title={S.METHODS[r.method]} domain={domA} condition="baseline" settings={settingsText(r, BASE)} />)}</div>

        <h3>Experiment B: simple random sampling at n = 1, 10 and 100 (baseline)</h3>
        <p className="note">Population and method held fixed. The n = 100 result uses the same seed and repetitions as Experiment A, so it is
          the same result as the simple random card above.</p>
        <div className="cards">{expB.map((r) => <ResultCard key={r.n} result={r} title={`Simple random, n = ${r.n}`} domain={domB} condition="baseline" settings={settingsText(r, BASE)} />)}</div>
      </section>

      {/* ---------------------------------------------------------- stage 5 */}
      <section>
        <h2>3. Challenge: baseline vs. a modified copy</h2>
        <div className="controls">
          <Choice label="Change this group" value={chGroup} onChange={setChGroup} options={ORDER.map((g) => [g, g])} />
          <NumberInput label="Add to its heart rate (bpm)" value={chShift} onChange={setChShift} min={-100} max={100} step={0.1} />
          <NumberInput label="n (same for all four)" value={chN} onChange={setChN} min={1} max={N} />
          <Choice label="Repetitions" value={chReps} onChange={setChReps} options={[[100, "100"], [1000, "1,000"]]} />
          <NumberInput label="Seed" value={chSeed} onChange={setChSeed} min={0} max={4294967295} width={9} />
        </div>
        <p className="note">The modified population is a labelled copy made in the browser; <code>data/heart_rate_week.csv</code> is never changed.
          It has the same {N.toLocaleString()} rows (so the same systematic design and stratum sizes), and its true mean is recomputed from its own rows.
          Each result's bias is measured against the true mean of the population it was drawn from. Results are never pooled.</p>
        <div className="truths">
          <span><b>Baseline</b> true mean: {fmt(baseTruth, 7)} bpm</span>
          <span><b>Modified</b> ({chGroup} rows {chShift >= 0 ? "+" : ""}{chShift} bpm) true mean: {fmt(modTruth, 7)} bpm</span>
        </div>
        <div className="cards two">
          <ResultCard result={challenge.srsBase} title="Simple random · baseline" domain={domC} condition="baseline" settings={settingsText(challenge.srsBase)} />
          <ResultCard result={challenge.srsMod} title={`Simple random · ${modLabel}`} domain={domC} condition="modified" settings={settingsText(challenge.srsMod)} />
          <ResultCard result={challenge.strBase} title="Stratified · baseline" domain={domC} condition="baseline" settings={challenge.strBase.error ? "" : settingsText(challenge.strBase)} />
          <ResultCard result={challenge.strMod} title={`Stratified · ${modLabel}`} domain={domC} condition="modified" settings={challenge.strMod.error ? "" : settingsText(challenge.strMod)} />
        </div>
      </section>

      {/* ---------------------------------------------------------- results table */}
      <section>
        <h2>4. Current results, ready to copy into DECISIONS.md</h2>
        <p className="note">These are the current settings above. Rerunning with new settings replaces them; the app keeps no history. Copy
          what you need into the results table in section 3 of DECISIONS.md.</p>
        <Markdown rows={mdRows} />
      </section>
    </main>
  );
}
