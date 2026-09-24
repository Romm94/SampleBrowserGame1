/* Telemetry report — reads data/telemetry.ndjson and answers the tuning
 * questions the test bot never could, because the bot never spends a rune.
 *
 *   node server/telemetry-report.js                  the report
 *   node server/telemetry-report.js --since 7        only the last 7 days
 *   node server/telemetry-report.js --prune 90       delete records older than 90 days
 *   node server/telemetry-report.js --file other.ndjson
 *
 * No dependencies.
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const FILE = flag("--file", path.join(__dirname, "..", "data", "telemetry.ndjson"));

function load(file){
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (e){ return null; }
  }).filter(Boolean);
}

/* ---------- --prune: the retention period, enforced ---------- */
if (args.includes("--prune")){
  const days = Number(flag("--prune", 90));
  const cutoff = Date.now() - days * 864e5;
  const all = load(FILE);
  const keep = all.filter(r => Date.parse(r.received || r.at) >= cutoff);
  fs.writeFileSync(FILE, keep.map(r => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : ""));
  console.log(`Pruned ${all.length - keep.length} records older than ${days} days; ${keep.length} kept.`);
  process.exit(0);
}

let rows = load(FILE);
const since = Number(flag("--since", 0));
if (since) rows = rows.filter(r => Date.parse(r.received || r.at) >= Date.now() - since * 864e5);

if (!rows.length){
  console.log(`No telemetry yet in ${FILE}.`);
  console.log("Set window.RUNE_TELEMETRY_ENDPOINT in index.html and play a few stages.");
  process.exit(0);
}

/* ---------- helpers ---------- */
const pct = (n, d) => d ? `${Math.round(n / d * 100)}%` : "—";
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const fmt = (v, d = 1) => v === null ? "—" : v.toFixed(d);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const goalDone = g => g.have >= g.need;
const blockerGoal = r => r.goals.find(g => g.kind === "blockers");
const otherGoals = r => r.goals.filter(g => g.kind !== "blockers");

const players = new Set(rows.map(r => r.id));
const cleared = rows.filter(r => r.outcome === "cleared");

console.log("");
console.log("RUNE FALL — telemetry report");
console.log("=".repeat(72));
console.log(`${rows.length} stages played by ${players.size} players` +
            (since ? ` in the last ${since} days` : "") + ".");
console.log(`Overall clear rate ${pct(cleared.length, rows.length)}.`);

/* ---------- 1. the blocker question ----------
   The one this whole thing was built for. A stage lost with every other goal
   done and only the blocker goal short is the clean signal that the blocker
   goal, specifically, is what's too hard. */
console.log("\n1. Is the blocker goal too hard?");
console.log("-".repeat(72));
const withBlockers = rows.filter(r => blockerGoal(r));
const failedWith = withBlockers.filter(r => r.outcome !== "cleared" && r.outcome !== "quit");
const onlyBlockersShort = failedWith.filter(r =>
  !goalDone(blockerGoal(r)) && otherGoals(r).every(goalDone));
const blockerMet = withBlockers.filter(r => goalDone(blockerGoal(r)));
const clearedShare = rows.filter(r => r.blockers && r.blockers.placed)
  .map(r => r.blockers.cleared / r.blockers.placed);

console.log(`Stages with a blocker goal:           ${withBlockers.length}`);
console.log(`Blocker goal met:                     ${pct(blockerMet.length, withBlockers.length)}`);
console.log(`Share of blockers cleared, on average: ${clearedShare.length ? pct(avg(clearedShare) * 100, 100) : "—"}`);
console.log(`Losses where ONLY the blocker goal was short: ${onlyBlockersShort.length} of ${failedWith.length}` +
            ` (${pct(onlyBlockersShort.length, failedWith.length)})`);
if (failedWith.length >= 10){
  const share = onlyBlockersShort.length / failedWith.length;
  console.log(share > 0.4
    ? "  → Verdict: the blocker goal is the bottleneck. Ease it."
    : share > 0.2
      ? "  → Verdict: a real factor, not the main one. Watch it."
      : "  → Verdict: not the problem. The bot was being pessimistic.");
} else {
  console.log("  → Not enough losses yet for a verdict (need at least 10).");
}

/* ---------- 2. by region ---------- */
console.log("\n2. By region");
console.log("-".repeat(72));
console.log(pad("region", 22) + lpad("played", 7) + lpad("clear", 7) +
            lpad("moves left", 11) + lpad("time left", 10) + lpad("continues", 10));
const regions = [...new Set(rows.map(r => r.region))];
const order = r => Math.min(...rows.filter(x => x.region === r).map(x => x.stage));
regions.sort((a, b) => order(a) - order(b));
for (const reg of regions){
  const rs = rows.filter(r => r.region === reg);
  const cl = rs.filter(r => r.outcome === "cleared");
  console.log(pad(reg || "?", 22) + lpad(rs.length, 7) + lpad(pct(cl.length, rs.length), 7) +
    lpad(fmt(avg(cl.map(r => r.movesLeft)), 1), 11) +
    lpad(fmt(avg(cl.map(r => r.secondsLeft)), 0) + "s", 10) +
    lpad(fmt(avg(rs.map(r => r.continues)), 2), 10));
}

/* ---------- 3. where people fail ---------- */
console.log("\n3. How stages end");
console.log("-".repeat(72));
for (const o of ["cleared", "time", "moves", "quit"]){
  const n = rows.filter(r => r.outcome === o).length;
  const label = { cleared:"cleared", time:"ran out of time", moves:"ran out of moves", quit:"gave up" }[o];
  console.log(pad(label, 20) + lpad(n, 6) + lpad(pct(n, rows.length), 7));
}
const hardest = [...new Set(rows.map(r => r.stage))]
  .map(st => {
    const rs = rows.filter(r => r.stage === st);
    return { st, n: rs.length, rate: rs.filter(r => r.outcome === "cleared").length / rs.length };
  })
  .filter(x => x.n >= 3)
  .sort((a, b) => a.rate - b.rate)
  .slice(0, 5);
if (hardest.length){
  console.log("\nHardest stages (at least 3 attempts):");
  for (const h of hardest) console.log(`  stage ${lpad(h.st, 3)}   cleared ${lpad(pct(h.rate * 100, 100), 4)} of ${h.n}`);
}

/* ---------- 4. how far people get ---------- */
console.log("\n4. How far players reach");
console.log("-".repeat(72));
const furthest = [...players].map(id => Math.max(...rows.filter(r => r.id === id).map(r => r.stage)));
for (const [lo, hi] of [[1,10],[11,20],[21,30],[31,40],[41,50],[51,60],[61,70],[71,80],[81,90],[91,1e9]]){
  const n = furthest.filter(f => f >= lo && f <= hi).length;
  if (!n) continue;
  const label = hi > 1e8 ? `${lo}+` : `${lo}-${hi}`;
  console.log(pad(`stopped in ${label}`, 22) + lpad(n, 5) + "  " + "█".repeat(Math.round(n / players.size * 40)));
}

/* ---------- 5. economy ---------- */
console.log("\n5. Economy");
console.log("-".repeat(72));
console.log(`Zeny earned per cleared stage:  ${fmt(avg(cleared.map(r => r.zeny.earned)), 0)}`);
console.log(`Continues bought per stage:     ${fmt(avg(rows.map(r => r.continues)), 2)}`);
const buys = rows.flatMap(r => r.shop);
const byItem = {};
buys.forEach(b => { byItem[b] = (byItem[b] || 0) + 1; });
console.log(`Shop purchases:                 ${buys.length}` +
  (buys.length ? "  (" + Object.entries(byItem).sort((a,b) => b[1]-a[1]).map(([k,v]) => `${k} ${v}`).join(", ") + ")" : ""));
const swallowed = rows.reduce((a, r) => a + (r.charges.swallowed || 0), 0);
const earnedCh  = rows.reduce((a, r) => a + (r.charges.earned || 0), 0);
console.log(`Rune charges earned:            ${earnedCh}   lost to sand: ${swallowed}`);

/* ---------- 6. praise ---------- */
console.log("\n6. Praise reached");
console.log("-".repeat(72));
const tiers = ["Substantial","Supreme","Immortal","Ascendant","God!","God-slayer!"];
for (const t of tiers){
  const n = rows.filter(r => r.praiseBest === t).length;
  console.log(pad(t, 14) + lpad(n, 6) + lpad(pct(n, rows.length), 7));
}
console.log(`Biggest single chain: ${Math.max(0, ...rows.map(r => r.chainBest || 0))} tiles`);

/* ---------- 7. performance ---------- */
console.log("\n7. Performance");
console.log("-".repeat(72));
const withFps = rows.filter(r => r.fps && r.fps.avg);
if (withFps.length){
  const phone = withFps.filter(r => r.touch), desk = withFps.filter(r => !r.touch);
  const line = (label, rs) => rs.length && console.log(pad(label, 12) +
    `avg ${lpad(fmt(avg(rs.map(r => r.fps.avg)), 0), 3)} fps   ` +
    `below 30 fps: ${lpad(pct(rs.filter(r => r.fps.avg < 30).length, rs.length), 4)}   ` +
    `hitches per stage: ${fmt(avg(rs.map(r => r.fps.slow)), 1)}`);
  line("touch", phone);
  line("desktop", desk);
  const struggling = withFps.filter(r => r.fps.avg < 30).length;
  if (struggling / withFps.length > 0.15)
    console.log("  → More than 1 in 7 stages ran below 30 fps. Cut effects before adding more.");
} else {
  console.log("No frame-rate data yet.");
}
console.log("");
