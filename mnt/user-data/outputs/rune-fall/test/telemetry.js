/* Telemetry tests — the server's validation and privacy guarantees, the client
   recording a stage, the opt-out, and the report reading it all back.
   Run: node test/telemetry.js */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { sleep, waitForBoot } = require("./bot");

const ROOT = path.resolve(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "runefall-tel-"));
process.env.DATA_DIR = TMP;                                 // before requiring the server
const { server, clean, FILE } = require("../server/telemetry-server.example.js");

let failures = 0;
function check(label, ok, detail){
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail !== undefined ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript",
               ".svg":"image/svg+xml", ".png":"image/png", ".mp3":"audio/mpeg" };
const serveGame = () => new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)){ res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
    res.end(fs.readFileSync(file));
  });
  s.listen(0, () => resolve(s));
});

const post = (port, body, raw) => new Promise(resolve => {
  const data = raw !== undefined ? raw : JSON.stringify(body);
  const req = http.request({ host: "localhost", port, path: "/telemetry", method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
    res => { let b = ""; res.on("data", c => b += c); res.on("end", () => resolve({ code: res.statusCode, body: b })); });
  req.on("error", () => resolve({ code: 0, body: "" }));
  req.end(data);
});

const goodRecord = (over = {}) => Object.assign({
  v: 1, type: "stage_end", id: "a1b2c3d4e5f6a1b2c3d4e5f6", session: "0011223344556677",
  at: new Date().toISOString(), stage: 12, region: "Thorny Forest", lap: 1, kind: "collect",
  outcome: "moves", movesBudget: 25, movesLeft: 0, secondsBudget: 140, secondsLeft: 31,
  durationMs: 95000,
  goals: [{ kind: "collect", need: 17, have: 17 }, { kind: "blockers", need: 3, have: 1 }],
  blockers: { placed: 3, cleared: 1 },
  charges: { start: 1, earned: 0, placed: 1, bought: 0, swallowed: 0 },
  creeperPeak: 0, continues: 0, zeny: { start: 2000, end: 3900, earned: 1900 },
  shop: ["moves"], chainBest: 23, praiseBest: "Supreme", lives: 4,
  fps: { avg: 58, slow: 2 }, viewport: "390x844", touch: true
}, over);

async function boot(origin, { progress, timeScale, endpoint } = {}){
  const dom = await JSDOM.fromURL(origin, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(w){
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      w.HTMLMediaElement.prototype.load = () => {};
      // jsdom has neither fetch nor sendBeacon; bridge Node's fetch so the
      // real sending path runs
      w.fetch = (...a) => globalThis.fetch(...a);
      if (endpoint) w.RUNE_TELEMETRY_ENDPOINT = endpoint;
      try {
        w.localStorage.clear();
        if (progress) w.localStorage.setItem("runefall.progress.v1", JSON.stringify(progress));
      } catch (e){}
      if (timeScale){
        const real = w.performance.now.bind(w.performance), t0 = real();
        w.performance.now = () => t0 + (real() - t0) * timeScale;
      }
    }
  });
  await waitForBoot(dom.window.document);
  return dom;
}

(async () => {
  /* ------------------------------------------------------------ */
  console.log("\n1. the server keeps only what it expects");
  {
    const r = clean(goodRecord({ email: "someone@example.com", ip: "1.2.3.4", extra: { a: 1 } }));
    check("a valid record is accepted", !!r);
    check("unknown fields are dropped", r && !("email" in r) && !("ip" in r) && !("extra" in r),
          r ? Object.keys(r).filter(k => ["email","ip","extra"].includes(k)).join(",") || "none leaked" : "");
    check("a bad outcome is refused", clean(goodRecord({ outcome: "hacked" })) === null);
    check("a non-hex id is refused", clean(goodRecord({ id: "<script>" })) === null);
    check("the wrong record type is refused", clean(goodRecord({ type: "anything" })) === null);
    check("numbers are clamped", clean(goodRecord({ movesLeft: 99999 })).movesLeft === 500);
    check("a malformed viewport is nulled", clean(goodRecord({ viewport: "<b>x</b>" })).viewport === null);
  }

  /* ------------------------------------------------------------ */
  console.log("\n2. the server stores, refuses, and never writes an IP");
  await new Promise(r => server.listen(0, r));
  const telPort = server.address().port;
  {
    const ok = await post(telPort, [goodRecord(), goodRecord({ stage: 13, outcome: "cleared" })]);
    check("a valid batch is stored", ok.code === 200 && /"stored":2/.test(ok.body), ok.code + " " + ok.body);

    const text = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";
    check("records land in the file, one per line", text.trim().split("\n").length === 2);
    check("no IP address is written", !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text) && !/::1|::ffff/.test(text));

    const junk = await post(telPort, null, "this is not json");
    check("junk is refused", junk.code === 400, junk.code);
    const empty = await post(telPort, [{ type: "stage_end", outcome: "nope" }]);
    check("a batch of invalid records is refused", empty.code === 400, empty.code);
    const huge = await post(telPort, null, JSON.stringify([goodRecord({ region: "x".repeat(80000) })]));
    check("an oversized body is refused", huge.code === 413 || huge.code === 0, huge.code);
  }

  /* ------------------------------------------------------------ */
  const gameServer = await serveGame();
  const origin = "http://localhost:" + gameServer.address().port + "/";

  console.log("\n3. a stage is recorded when it ends");
  {
    const dom = await boot(origin, { progress: { level: 2, zeny: 0, charges: 0,
      seen: ["basics","frost"] }, timeScale: 80 });
    const w = dom.window, doc = w.document;
    doc.getElementById("veilBtn").click();
    await sleep(3200);                          // the scaled clock runs the stage out

    const log = w.RuneTelemetry.dump();
    check("one record was written", log.length === 1, log.length);
    const r = log[0] || {};
    check("it says how the stage ended", r.outcome === "time", r.outcome);
    check("it names the stage and region", r.stage === 2 && r.region === "Snowy Days",
          `${r.stage} ${r.region}`);
    check("it carries each goal's progress", Array.isArray(r.goals) && r.goals.length > 0,
          (r.goals || []).map(g => `${g.kind} ${g.have}/${g.need}`).join(", "));
    check("it records the budget and what was left",
          r.movesBudget > 0 && typeof r.movesLeft === "number" && r.secondsBudget > 0,
          `${r.movesLeft}/${r.movesBudget} moves`);
    check("it carries a frame-rate sample", r.fps && typeof r.fps.avg === "number",
          r.fps ? `${r.fps.avg} fps` : "none");
    check("the player is an anonymous random id", /^[0-9a-f]{24}$/.test(r.id || ""), r.id);
    check("nothing personal is in the record",
          !Object.keys(r).some(k => /ip|email|name|agent|address/i.test(k)));
    check("with no endpoint, nothing is queued to send",
          (JSON.parse(w.localStorage.getItem("runefall.telemetry.queue") || "[]")).length === 0);
    dom.window.close();
  }

  console.log("\n4. with an endpoint, the record reaches the server");
  {
    const before = fs.readFileSync(FILE, "utf8").trim().split("\n").length;
    const dom = await boot(origin, { progress: { level: 3, zeny: 0, charges: 0,
      seen: ["basics","frost"] }, timeScale: 80,
      endpoint: "http://localhost:" + telPort });
    const doc = dom.window.document;
    check("the opt-out is offered when collection is on", !doc.getElementById("privacy").hidden);
    doc.getElementById("veilBtn").click();
    await sleep(3600);
    const after = fs.readFileSync(FILE, "utf8").trim().split("\n");
    check("the server received it", after.length === before + 1, `${before} -> ${after.length}`);
    const last = JSON.parse(after[after.length - 1]);
    check("and stored the stage it came from", last.stage === 3 && last.region === "Snowy Days",
          `${last.stage} ${last.region}`);
    dom.window.close();
  }

  console.log("\n5. opting out stops it");
  {
    const dom = await boot(origin, { progress: { level: 2, zeny: 0, charges: 0,
      seen: ["basics","frost"] }, timeScale: 80 });
    const w = dom.window, doc = w.document;
    check("the opt-out stays hidden with nowhere to send", doc.getElementById("privacy").hidden);
    w.RuneTelemetry.optOut(true);
    doc.getElementById("veilBtn").click();
    await sleep(3200);
    check("no record is written once opted out", w.RuneTelemetry.dump().length === 0,
          w.RuneTelemetry.dump().length);
    check("the choice is remembered", w.RuneTelemetry.isOptedOut());
    dom.window.close();
  }

  /* ------------------------------------------------------------ */
  console.log("\n6. the report reads it back");
  {
    // a spread of stages so the report has something to say
    const batch = [];
    for (let i = 0; i < 14; i++){
      const lostOnBlockers = i < 9;
      batch.push(goodRecord({ id: "c0ffee" + String(i % 4).padStart(18, "0"), stage: 11 + (i % 5),
        outcome: lostOnBlockers ? "moves" : "cleared",
        goals: [{ kind: "collect", need: 17, have: 17 },
                { kind: "blockers", need: 3, have: lostOnBlockers ? 1 : 3 }],
        fps: { avg: i % 3 ? 58 : 24, slow: i % 3 ? 1 : 30 } }));
    }
    await post(telPort, batch);
    const out = execFileSync("node", [path.join(ROOT, "server", "telemetry-report.js"), "--file", FILE],
                             { encoding: "utf8" });
    check("it answers the blocker question", /Is the blocker goal too hard\?/.test(out));
    check("it reaches a verdict with enough losses", /Verdict: the blocker goal is the bottleneck/.test(out),
          (out.match(/Verdict:[^\n]*/) || ["no verdict"])[0].trim());
    check("it breaks results down by region", /Thorny Forest/.test(out));
    check("it reports frame rate", /fps/.test(out) && /touch/.test(out));
    check("it flags a slow device share", /below 30 fps/.test(out));

    const pruned = execFileSync("node", [path.join(ROOT, "server", "telemetry-report.js"),
                                "--file", FILE, "--prune", "0"], { encoding: "utf8" });
    check("--prune enforces a retention period", /Pruned \d+ records/.test(pruned), pruned.trim());
  }

  console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
  process.exitCode = failures ? 1 : 0;
  server.close();
  gameServer.close();
  fs.rmSync(TMP, { recursive: true, force: true });
})();
