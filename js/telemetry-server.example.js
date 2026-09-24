/* Telemetry server — collects one record per stage from js/telemetry.js.
 *
 * Run:   node server/telemetry-server.example.js
 * Then in index.html, before the other scripts:
 *        <script>window.RUNE_TELEMETRY_ENDPOINT = "http://localhost:8788";</script>
 * Read:  node server/telemetry-report.js
 *
 * No dependencies — plain Node. Records are appended, one JSON object per line,
 * to data/telemetry.ndjson. That format can be opened in a spreadsheet, fed to
 * any analytics tool, or read line by line without loading the whole file.
 *
 * ---------------------------------------------------------------------------
 * Privacy, deliberately:
 *
 *  - No IP address is stored. The lives server keys on IP because it has to;
 *    this one has no reason to, so it never writes one down. Under the
 *    Philippine Data Privacy Act an IP address can count as personal
 *    information, and the cheapest way to handle personal data is not to hold
 *    it.
 *  - Every record is rebuilt from a whitelist of fields. Anything the client
 *    sends that isn't on the list is dropped, so a modified client can't use
 *    this endpoint to store arbitrary data.
 *  - The player id is a random value made in their own browser. It links one
 *    person's stages together and nothing else.
 *
 * Before this goes public: say what you collect in a privacy notice, keep the
 * in-game opt-out (it's in the help overlay), and pick a retention period —
 * `node server/telemetry-report.js --prune 90` deletes records older than 90
 * days. That is not legal advice; if the game grows, have someone qualified
 * look at it.
 * ---------------------------------------------------------------------------
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT     = process.env.PORT || 8788;
const ORIGIN   = process.env.ORIGIN || "*";          // set to "https://yourdomain.com"
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE     = path.join(DATA_DIR, "telemetry.ndjson");

const MAX_BODY    = 64 * 1024;   // a batch is a few KB; anything bigger is refused
const MAX_BATCH   = 60;          // records per request
const RATE_WINDOW = 60 * 1000;
const RATE_LIMIT  = 120;         // records per player id per minute

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- validation: rebuild every record from known fields ---------- */
const OUTCOMES = new Set(["cleared", "time", "moves", "quit"]);
const GOAL_KINDS = new Set(["collect", "score", "blockers"]);

const int = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const str = (v, max) => typeof v === "string" ? v.slice(0, max) : null;
const hex = (v, max) => typeof v === "string" && /^[0-9a-f]+$/i.test(v) ? v.slice(0, max) : null;

function clean(r){
  if (!r || typeof r !== "object" || r.type !== "stage_end") return null;
  if (!OUTCOMES.has(r.outcome)) return null;
  const id = hex(r.id, 48);
  if (!id) return null;

  const goals = Array.isArray(r.goals) ? r.goals.slice(0, 6)
    .filter(g => g && GOAL_KINDS.has(g.kind))
    .map(g => ({ kind: g.kind, need: int(g.need, 0, 1e6), have: int(g.have, 0, 1e6) })) : [];

  const obj = (o, keys) => {
    const out = {};
    for (const k of keys) out[k] = int(o && o[k], 0, 1e7);
    return out;
  };

  return {
    v: int(r.v, 0, 100),
    received: new Date().toISOString(),
    at: str(r.at, 40),
    id, session: hex(r.session, 32),
    stage: int(r.stage, 1, 100000),
    region: str(r.region, 40),
    lap: int(r.lap, 1, 1000),
    kind: str(r.kind, 12),
    outcome: r.outcome,
    movesBudget: int(r.movesBudget, 0, 500), movesLeft: int(r.movesLeft, -50, 500),
    secondsBudget: int(r.secondsBudget, 0, 3600), secondsLeft: int(r.secondsLeft, 0, 3600),
    durationMs: int(r.durationMs, 0, 36e5),
    goals,
    blockers: obj(r.blockers, ["placed", "cleared"]),
    charges: obj(r.charges, ["start", "earned", "placed", "bought", "swallowed"]),
    creeperPeak: int(r.creeperPeak, 0, 64),
    continues: int(r.continues, 0, 50),
    zeny: obj(r.zeny, ["start", "end", "earned"]),
    shop: Array.isArray(r.shop)
      ? r.shop.slice(0, 20).map(x => str(x, 12)).filter(Boolean) : [],
    chainBest: int(r.chainBest, 0, 10000),
    praiseBest: str(r.praiseBest, 20),
    lives: int(r.lives, 0, 10),
    fps: r.fps ? { avg: int(r.fps.avg, 0, 1000), slow: int(r.fps.slow, 0, 1e6) } : null,
    viewport: typeof r.viewport === "string" && /^\d{2,5}x\d{2,5}$/.test(r.viewport) ? r.viewport : null,
    touch: r.touch === true
  };
}

/* ---------- a simple per-player rate limit ---------- */
const recent = new Map();
function allowed(id, n){
  const now = Date.now();
  const list = (recent.get(id) || []).filter(t => now - t < RATE_WINDOW);
  if (list.length + n > RATE_LIMIT) { recent.set(id, list); return false; }
  for (let i = 0; i < n; i++) list.push(now);
  recent.set(id, list);
  return true;
}
setInterval(() => {                       // forget idle players
  const now = Date.now();
  for (const [id, list] of recent) if (!list.some(t => now - t < RATE_WINDOW)) recent.delete(id);
}, RATE_WINDOW).unref();

/* ---------- http ---------- */
const server = http.createServer((req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
  const reply = (code, body) => {
    res.writeHead(code, { ...headers, "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS"){ res.writeHead(204, headers); return res.end(); }
  const route = (req.url || "").split("?")[0].replace(/\/$/, "");
  if (route !== "/telemetry" || req.method !== "POST") return reply(404, { error: "not found" });

  let size = 0, chunks = [];
  req.on("data", c => {
    size += c.length;
    if (size > MAX_BODY){ reply(413, { error: "too large" }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let batch;
    try { batch = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch (e){ return reply(400, { error: "not json" }); }
    if (!Array.isArray(batch)) batch = [batch];
    batch = batch.slice(0, MAX_BATCH);

    const records = batch.map(clean).filter(Boolean);
    if (!records.length) return reply(400, { error: "no valid records" });
    if (!allowed(records[0].id, records.length)) return reply(429, { error: "slow down" });

    fs.appendFile(FILE, records.map(r => JSON.stringify(r)).join("\n") + "\n", err => {
      if (err) return reply(500, { error: "write failed" });
      reply(200, { stored: records.length, dropped: batch.length - records.length });
    });
  });
});

if (require.main === module){
  server.listen(PORT, () => {
    console.log(`Rune Fall telemetry on http://localhost:${PORT}/telemetry`);
    console.log(`Writing to ${FILE}`);
  });
}

module.exports = { server, clean, FILE };
