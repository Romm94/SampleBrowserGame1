/* Feature test — drives the four new systems through the DOM, in separate
   browser instances so one scenario can't contaminate the next.
   Run: node test/features.js   */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const http = require("http");
const fs = require("fs");

const { sleep, waitForBoot, cellSize, posOf, readBoard, tap, playMove } = require("./bot");

const ROOT = path.resolve(__dirname, "..");
const isFontNoise = s => /fonts\.(googleapis|gstatic)\.com/.test(s);

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

let failures = 0;
function check(label, ok, detail){
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
  return ok;
}

/* boots the page with optional saved progress and an optional clock multiplier */
async function boot(origin, { progress, timeScale } = {}){
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => { const m = e.stack || e.message; if (!isFontNoise(m)) errors.push(m); });

  const dom = await JSDOM.fromURL(origin, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window){
      window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      try {
        window.localStorage.clear();
        if (progress) window.localStorage.setItem("runefall.progress.v1", JSON.stringify(progress));
      } catch (e){}
      if (timeScale){
        // makes the stage clock drain fast so a timeout is testable in seconds
        const real = window.performance.now.bind(window.performance);
        const t0 = real();
        window.performance.now = () => t0 + (real() - t0) * timeScale;
      }
    }
  });
  const ready = await waitForBoot(dom.window.document);
  if (!ready) errors.push("the game never finished booting");
  return { dom, window: dom.window, doc: dom.window.document, errors };
}


(async () => {
  const server = await serve();
  const origin = "http://localhost:" + server.address().port + "/";

  /* ---------------------------------------------------------------- */
  console.log("\n1. saved progress is restored");
  {
    const { dom, doc } = await boot(origin, { progress: { level: 7, zeny: 48000, charges: 2 } });
    check("resumes on the saved quest", doc.getElementById("questTitle").textContent === "Quest 7",
          doc.getElementById("questTitle").textContent);
    check("zeny wallet restored", doc.getElementById("score").textContent === "48,000",
          doc.getElementById("score").textContent);
    check("carried charges restored", /×2/.test(doc.getElementById("chargeBtn").textContent),
          doc.getElementById("chargeBtn").textContent.trim());
    check("offers a fresh start", !doc.getElementById("veilAlt").hidden);
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n2. blockers appear and can be chipped");
  {
    const { dom, window, doc } = await boot(origin, { progress: { level: 7, zeny: 0, charges: 0 } });
    doc.getElementById("veilBtn").click();
    await sleep(400);

    const blockers = [...doc.querySelectorAll(".blocker")];
    check("blockers placed on the board", blockers.length > 0, blockers.length + " blockers");
    check("both frost and bramble present",
          blockers.some(b => b.dataset.kind === "frost") &&
          blockers.some(b => b.dataset.kind === "bramble"),
          blockers.map(b => b.dataset.kind).join(","));

    const goalRows = [...doc.querySelectorAll("#goals .goal")];
    check("a blocker goal is listed", goalRows.length >= 2, goalRows.length + " goals");

    // a bramble cell must refuse selection
    const cell = cellSize(doc);
    const bramble = blockers.find(b => b.dataset.kind === "bramble");
    const pos = posOf(bramble, cell);
    const under = [...doc.querySelectorAll(".tile")].find(t => {
      const p = posOf(t, cell);
      return p && p.r === pos.r && p.c === pos.c;
    });
    check("found the slime under a bramble", !!under);
    if (under){
      tap(window, under);
      await sleep(80);
      check("bramble cell cannot be selected", doc.querySelectorAll(".tile.sel").length === 0,
            doc.querySelectorAll(".tile.sel").length + " selected");
    }

    const before = doc.querySelectorAll(".blocker").length;
    let after = before;
    // play until a blocker actually goes, rather than a fixed number of moves —
    // whether any given move can reach one depends on where they landed
    for (let i = 0; i < 24 && after >= before; i++){
      if (!await playMove(window, doc, { smart: true })) break;
      after = doc.querySelectorAll(".blocker").length;
    }
    check("blockers get cleared by play", after < before, before + " -> " + after);
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n3. score quests");
  {
    const { dom, doc } = await boot(origin, { progress: { level: 5, zeny: 0, charges: 0 } });
    doc.getElementById("veilBtn").click();
    await sleep(400);
    const labels = [...doc.querySelectorAll("#goals .goal b")].map(b => b.textContent);
    check("quest 5 asks for a score", labels.some(l => /\d,\d{3}/.test(l)), labels.join(" | "));
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n4. running out of time offers a continue");
  {
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 2, zeny: 9000, charges: 0 }, timeScale: 80 });
    doc.getElementById("veilBtn").click();
    await sleep(3000);          // scaled clock drains the stage

    const veil = doc.getElementById("veil");
    check("overlay appeared on timeout", !veil.hidden);
    check("it offers a paid continue", /zeny/i.test(doc.getElementById("veilBtn").textContent),
          doc.getElementById("veilBtn").textContent);
    check("give up is the alternative", !doc.getElementById("veilAlt").hidden,
          doc.getElementById("veilAlt").textContent);

    const zenyBefore = Number(doc.getElementById("score").textContent.replace(/,/g, ""));
    const livesBefore = window.RuneLives.get().lives;
    doc.getElementById("veilBtn").click();
    await sleep(300);

    const zenyAfter = Number(doc.getElementById("score").textContent.replace(/,/g, ""));
    check("continue charged zeny", zenyAfter === zenyBefore - 1200,
          zenyBefore + " -> " + zenyAfter);
    check("continue cost no life", window.RuneLives.get().lives === livesBefore,
          "lives=" + window.RuneLives.get().lives);
    check("back on the board", doc.getElementById("veil").hidden);
    check("clock has time on it again", doc.getElementById("clock").textContent !== "0:00",
          doc.getElementById("clock").textContent);
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n5. no zeny means no continue, and a life is spent");
  {
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 2, zeny: 0, charges: 0 }, timeScale: 80 });
    doc.getElementById("veilBtn").click();
    await sleep(3000);
    check("lost a life", window.RuneLives.get().lives === 4,
          "lives=" + window.RuneLives.get().lives);
    check("shown the retry overlay", !doc.getElementById("veil").hidden);
    check("no continue offered", !/zeny/i.test(doc.getElementById("veilBtn").textContent),
          doc.getElementById("veilBtn").textContent);
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n6. two runes combine when swapped together");
  {
    const { dom, window, doc } = await boot(origin, { progress: { level: 1, zeny: 0, charges: 2 } });
    doc.getElementById("veilBtn").click();
    await sleep(400);

    check("mute button is off the board", !doc.querySelector(".frame #muteBtn"));
    check("mute button sits with the tools", !!doc.querySelector(".tools #muteBtn"));

    const cell = cellSize(doc);
    const { grid } = readBoard(doc, cell);
    const a = grid[4][3], b = grid[4][4];
    check("found two adjacent tiles", !!a && !!b);

    // spend both carried charges to put a blast rune on each
    const isBlast = el => el.innerHTML.includes('stroke-width="5"');
    for (const t of [a, b]){
      doc.getElementById("chargeBtn").click();
      await sleep(70);
      tap(window, t.el);
      await sleep(150);
    }
    const blasts = [...doc.querySelectorAll(".tile")].filter(isBlast).length;
    check("two blast runes placed", blasts === 2, blasts + " on the board");

    const before = Number(doc.getElementById("score").textContent.replace(/,/g, ""));
    tap(window, a.el);
    await sleep(90);
    tap(window, b.el);

    // watch the banner while the blast resolves rather than checking one moment
    let announced = null;
    for (let i = 0; i < 30; i++){
      const text = doc.getElementById("combo").textContent;
      if (text && text !== "Combo ×2") announced = text;
      await sleep(70);
    }

    check("the combination is named on screen", announced === "Twin blast",
          announced || "(nothing shown)");
    const after = Number(doc.getElementById("score").textContent.replace(/,/g, ""));
    check("it scored far more than a plain match", after - before > 1500,
          before + " -> " + after);
    check("board refilled afterwards", doc.querySelectorAll(".tile").length === 64,
          doc.querySelectorAll(".tile").length + " tiles");
    dom.window.close();
  }

  console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
  process.exitCode = failures ? 1 : 0;
  server.close();
})();
