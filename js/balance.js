/* Balance harness — plays a quest with a deliberately weak bot (it always takes
   the first legal move the hint finds, never plans a cascade) and reports what
   it managed. A score target a weak bot can reach is one a person can reach.

   Run: node test/balance.js [questNumber ...]    default: 5 10 15            */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const http = require("http");
const fs = require("fs");

const { sleep, waitForBoot, cellSize, chooseMove, tap, playMove } = require("./bot");

const ROOT = path.resolve(__dirname, "..");

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

async function runQuest(origin, level, smart){
  const vc = new VirtualConsole();          // silent
  const dom = await JSDOM.fromURL(origin, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window){
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      // jsdom has no media pipeline; stub it so the real audio path still runs
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.HTMLMediaElement.prototype.pause = () => {};
      window.HTMLMediaElement.prototype.load = () => {};
      try {
        window.localStorage.clear();
        window.localStorage.setItem("runefall.progress.v1",
          JSON.stringify({ level, zeny: 0, charges: 0 }));
      } catch (e){}
    }
  });
  const { window } = dom;
  const doc = window.document;
  await waitForBoot(doc);

  const goalText = () => [...doc.querySelectorAll("#goals .goal b")].map(b => b.textContent).join("  ");
  const zeny = () => Number(doc.getElementById("score").textContent.replace(/,/g, ""));
  const moves = () => Number(doc.getElementById("moves").textContent);

  doc.getElementById("veilBtn").click();
  await sleep(400);

  const startMoves = moves();
  const goalsAtStart = goalText();
  let played = 0, cleared = false;

  while (moves() > 0 && played < startMoves + 4){
    if (doc.getElementById("questTitle").textContent !== "Quest " + level){ cleared = true; break; }
    if (!doc.getElementById("veil").hidden) break;      // failed or offered a continue

    if (!await playMove(window, doc, { smart })) break;
    played++;
  }

  // read goals straight off the panel; the title lags behind during the warp
  const met = goalText().split("  ").filter(Boolean).every(label => {
    const [have, need] = label.split("/").map(v => Number(v.replace(/,/g, "")));
    return Number.isFinite(have) && Number.isFinite(need) && have >= need;
  });

  const result = {
    level,
    moves: startMoves,
    played,
    zeny: zeny(),
    perMove: Math.round(zeny() / Math.max(1, played)),
    goalsAtStart,
    goalsAtEnd: goalText(),
    cleared: cleared || met
  };
  dom.window.close();
  return result;
}

(async () => {
  const args = process.argv.slice(2);
  const smart = !args.includes("--blind");
  const levels = args.map(Number).filter(Boolean);
  const targets = levels.length ? levels : [5, 10, 15];
  const server = await serve();
  const origin = "http://localhost:" + server.address().port + "/";

  console.log(smart
    ? "Bot playthroughs — aims at blockers, one move deep, no cascade planning.\n"
    : "Bot playthroughs — first legal move every time, no aiming at all.\n");
  for (const lv of targets){
    const r = await runQuest(origin, lv, smart);
    console.log(`Quest ${r.level}`);
    console.log(`  move budget    ${r.moves}   played ${r.played}`);
    console.log(`  goals          ${r.goalsAtStart}  ->  ${r.goalsAtEnd}`);
    console.log(`  zeny earned    ${r.zeny.toLocaleString()}  (${r.perMove.toLocaleString()} per move)`);
    console.log(`  cleared        ${r.cleared ? "yes" : "no"}\n`);
  }
  server.close();
})();
