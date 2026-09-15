/* Headless smoke test — boots the real index.html in jsdom and plays it.
   Run: node test/smoke.js     (needs jsdom: npm install jsdom)
   Catches runtime errors that a syntax check cannot, like calling a function
   before the data it reads exists. */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the Google Fonts <link> can't be reached offline; that's not a game error
const isFontNoise = s => /fonts\.(googleapis|gstatic)\.com/.test(s);

const vc = new VirtualConsole();
vc.on("jsdomError", e => {
  const msg = e.stack || e.message;
  if (!isFontNoise(msg)) errors.push("jsdomError: " + msg);
});
vc.on("error", (...a) => {
  const msg = a.join(" ");
  if (!isFontNoise(msg)) errors.push("console.error: " + msg);
});

function check(label, condition, detail){
  const ok = !!condition;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

// jsdom refuses localStorage on file:// origins, so serve the folder for the test
const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".svg":"image/svg+xml" };
function serve(){
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)){ res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
      res.end(fs.readFileSync(file));
    });
    s.listen(0, () => resolve(s));
  });
}

(async () => {
  const server = await serve();
  const origin = "http://localhost:" + server.address().port + "/";

  const dom = await JSDOM.fromURL(origin, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window){
      // jsdom has no canvas backend and no Web Audio; stub enough to run
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: () => () => {}
      });
      window.localStorage.clear();
    }
  });

  const { window } = dom;
  const doc = window.document;
  window.addEventListener("error", e => errors.push("window.onerror: " + e.message));
  window.addEventListener("unhandledrejection", e => errors.push("unhandled rejection: " + e.reason));

  await sleep(400);

  console.log("\nboot");
  check("no errors while loading", errors.length === 0, errors[0]);
  check("board rendered 64 tiles", doc.querySelectorAll(".tile").length === 64,
        doc.querySelectorAll(".tile").length + " tiles");
  check("lives module initialised", !!window.RuneLives);
  check("5 hearts drawn", doc.querySelectorAll("#hearts svg").length === 5);
  check("all 5 hearts full at start",
        doc.querySelectorAll("#hearts svg.on").length === 5);
  check("start overlay is showing", !doc.getElementById("veil").hidden);

  const begin = doc.getElementById("veilBtn");
  check("Begin button has a click handler", typeof begin.onclick === "function",
        begin.onclick ? "attached" : "MISSING — this is the reported bug");

  console.log("\nclicking Begin");
  begin.click();
  await sleep(300);

  check("overlay dismissed", doc.getElementById("veil").hidden);
  check("board still has 64 tiles", doc.querySelectorAll(".tile").length === 64);
  check("stage clock is counting", doc.getElementById("clock").textContent !== "0:00",
        "clock reads " + doc.getElementById("clock").textContent);
  check("goals rendered", doc.querySelectorAll("#goals .goal").length > 0);
  check("moves shown", Number(doc.getElementById("moves").textContent) > 0,
        doc.getElementById("moves").textContent + " moves");

  await sleep(1200);
  const later = doc.getElementById("clock").textContent;
  check("clock actually ticked down", later !== doc.getElementById("clock").dataset.first,
        "now " + later);

  console.log("\nplaying a turn");
  const before = Number(doc.getElementById("score").textContent.replace(/,/g, ""));
  // tap two tiles that the hint says form a valid match
  doc.getElementById("hintBtn").click();
  await sleep(100);
  const hinted = [...doc.querySelectorAll(".tile.hint")];
  check("hint found a legal move", hinted.length === 2, hinted.length + " tiles highlighted");

  if (hinted.length === 2){
    const tap = el => {
      const opts = { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 };
      el.dispatchEvent(new window.Event("pointerdown", opts));
      el.dispatchEvent(new window.Event("pointerup", opts));
    };
    // jsdom lacks PointerEvent; the game reads clientX/clientY off the event
    const fire = (el, type) => {
      const e = new window.Event(type, { bubbles: true });
      e.clientX = 0; e.clientY = 0; e.pointerId = 1;
      Object.defineProperty(e, "target", { value: el });
      el.dispatchEvent(e);
    };
    fire(hinted[0], "pointerdown"); fire(hinted[0], "pointerup");
    await sleep(50);
    fire(hinted[1], "pointerdown"); fire(hinted[1], "pointerup");
    await sleep(2500);

    const after = Number(doc.getElementById("score").textContent.replace(/,/g, ""));
    check("score went up after a match", after > before, before + " -> " + after);
    check("board refilled to 64", doc.querySelectorAll(".tile").length === 64,
          doc.querySelectorAll(".tile").length + " tiles");
  }

  console.log("\nlives");
  const snap = window.RuneLives.get();
  check("starts at 5 lives", snap.lives === 5, "lives=" + snap.lives);
  await window.RuneLives.spend();
  const spent = window.RuneLives.get();
  check("spending drops to 4", spent.lives === 4, "lives=" + spent.lives);
  check("regen countdown started", spent.msToNext > 0 && spent.msToNext <= 30*60*1000,
        Math.round(spent.msToNext/1000) + "s to next");
  check("persisted to storage", !!window.localStorage.getItem("runefall.lives.v1"));

  console.log("\nruntime errors: " + (errors.length || "none"));
  errors.forEach(e => console.log("   " + e));
  if (errors.length) process.exitCode = 1;

  dom.window.close();
  server.close();
})();
