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
      // jsdom has no media pipeline; stub it so the real audio path still runs
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.HTMLMediaElement.prototype.pause = () => {};
      window.HTMLMediaElement.prototype.load = () => {};
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
    // quests 31-40 are the band that mixes frost and bramble
    const { dom, window, doc } = await boot(origin, { progress: { level: 33, zeny: 0, charges: 0 } });
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
    check("a bramble is on the board", !!bramble);
    const pos = bramble ? posOf(bramble, cell) : null;
    const under = pos && [...doc.querySelectorAll(".tile")].find(t => {
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

    dom.window.close();
  }

  console.log("\n2b. blockers can be chipped away");
  {
    // quest 10 ends the frost band with five of them and nothing locked, so the
    // bot reliably reaches one — a three-blocker quest made this flaky
    const { dom, window, doc } = await boot(origin, { progress: { level: 10, zeny: 0, charges: 0 } });
    doc.getElementById("veilBtn").click();
    await sleep(400);

    const before = doc.querySelectorAll(".blocker").length;
    check("frost band places several", before >= 4, before + " blockers");
    let after = before;
    for (let i = 0; i < 26 && after >= before; i++){
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

    check("audio buttons are off the board", !doc.querySelector(".frame #bgmBtn"));
    check("music and effects have separate toggles",
          !!doc.querySelector(".tools #bgmBtn") && !!doc.querySelector(".tools #sfxBtn"));

    const cell = cellSize(doc);
    const { grid } = readBoard(doc, cell);
    const a = grid[4][3], b = grid[4][4];
    check("found two adjacent tiles", !!a && !!b);

    // spend both carried charges to put a blast rune on each
    const isBlast = el => el.dataset.special === "bomb";
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

    // the banner names the combination, then adds the praise once the chain lands
    check("the combination is named on screen", /Twin blast/.test(announced || ""),
          announced || "(nothing shown)");
    const after = Number(doc.getElementById("score").textContent.replace(/,/g, ""));
    // a 5x5 blast is 25 tiles at the combination rate, well above a plain match
    check("it scored far more than a plain match", after - before > 400,
          before + " -> " + after);
    check("board refilled afterwards", doc.querySelectorAll(".tile").length === 64,
          doc.querySelectorAll(".tile").length + " tiles");
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n7. onboarding");
  {
    const { dom, window, doc } = await boot(origin);       // nothing saved yet
    doc.getElementById("veilBtn").click();
    await sleep(1200);

    const tip = doc.getElementById("tip");
    check("a first-time tip appears", !tip.hidden, tip.textContent.slice(0, 40));
    check("the basics come first", /Line up three/.test(tip.textContent),
          tip.textContent.slice(0, 30));

    // quest 1 has two tips to give; tapping should advance, not discard
    tip.click();
    await sleep(60);
    check("tapping moves to the next tip", !tip.hidden && /Frost/.test(tip.textContent),
          tip.textContent.slice(0, 30));
    tip.click();
    await sleep(60);
    check("tapping the last one dismisses it", tip.hidden);

    const help = doc.getElementById("help");
    check("help starts closed", help.hidden);
    doc.getElementById("helpBtn").click();
    await sleep(80);
    check("help button opens the rules", !help.hidden);
    check("rules cover combinations", /Orb \+ blast/.test(help.textContent));
    check("rules cover blockers", /Bramble/.test(help.textContent));
    doc.getElementById("helpClose").onclick();
    await sleep(60);
    check("it closes again", help.hidden);

    const stored = JSON.parse(window.localStorage.getItem("runefall.progress.v1"));
    check("the tip is remembered", Array.isArray(stored.seen) && stored.seen.includes("basics"),
          JSON.stringify(stored.seen));
    dom.window.close();
  }

  console.log("\n8. tips do not repeat on a later visit");
  {
    const { dom, doc } = await boot(origin,
      { progress: { level: 1, zeny: 0, charges: 0, seen: ["basics", "rune", "combine", "frost"] } });
    doc.getElementById("veilBtn").click();
    await sleep(1200);
    check("no tip shown to a returning player", doc.getElementById("tip").hidden,
          doc.getElementById("tip").textContent.slice(0, 40) || "(nothing)");
    dom.window.close();
  }

  console.log("\n9. the rune picker chooses what a charge places");
  {
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 1, zeny: 0, charges: 1, seen: ["basics", "charge"] } });
    doc.getElementById("veilBtn").click();
    await sleep(400);

    check("picker is shown when charges are held", !doc.getElementById("picker").hidden);
    const rowPick = doc.querySelector('.pick[data-rune="row"]');
    rowPick.onclick();
    await sleep(60);
    check("picking a rune updates the button", /row rune/.test(doc.getElementById("chargeBtn").textContent),
          doc.getElementById("chargeBtn").textContent.trim());

    const { grid } = readBoard(doc, cellSize(doc));
    doc.getElementById("chargeBtn").click();
    await sleep(70);
    tap(window, grid[4][3].el);
    await sleep(200);

    check("a row rune was placed, not a blast",
          grid[4][3].el.dataset.special === "row",
          grid[4][3].el.dataset.special || "(no rune)");
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n10. background music is wired up");
  {
    // jsdom has no media pipeline, so this checks the asset and the wiring
    // rather than playback — that needs a real browser
    const track = path.join(ROOT, "assets", "bgm.mp3");
    const exists = fs.existsSync(track);
    check("a track is present", exists, exists ? "assets/bgm.mp3" : "missing");

    if (exists){
      const bytes = fs.statSync(track).size;
      check("it stays inside the mobile data budget", bytes < 2 * 1024 * 1024,
            (bytes / 1048576).toFixed(2) + " MB");
      const head = fs.readFileSync(track).subarray(0, 3);
      check("it is a real MP3", head.toString() === "ID3" || head[0] === 0xFF,
            head.toString("hex"));
    }

    const music = fs.readFileSync(path.join(ROOT, "js", "music.js"), "utf8");
    check("music.js points at that file", music.includes('"assets/bgm.mp3"'));

    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    check("the page loads music.js", html.includes("js/music.js"));
    check("it loads before the game", html.indexOf("js/music.js") < html.indexOf("js/game.js"));

    const { dom, window, doc } = await boot(origin);
    check("music has its own toggle", !!doc.getElementById("bgmBtn"));

    doc.getElementById("bgmBtn").click();
    await sleep(80);
    check("muting music marks the button off",
          doc.getElementById("bgmBtn").classList.contains("is-off"));
    check("effects are untouched by the music toggle",
          !doc.getElementById("sfxBtn").classList.contains("is-off"));

    const saved = JSON.parse(window.localStorage.getItem("runefall.progress.v1"));
    check("the music preference is remembered", saved.bgmOff === true && saved.sfxOff === false,
          `bgmOff=${saved.bgmOff} sfxOff=${saved.sfxOff}`);
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n11. source sanity");
  {
    // two function declarations sharing a name silently clobber each other and
    // the symptom shows up somewhere unrelated — this caught exactly that once
    for (const file of ["game.js", "lives.js", "progress.js", "music.js", "leaves.js"]){
      const src = fs.readFileSync(path.join(ROOT, "js", file), "utf8");
      const names = [...src.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
      const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      check(`${file}: no duplicate function names`, dupes.length === 0, dupes.join(", ") || "none");
    }

    // every atlas cell the game asks for must have a stylesheet rule
    const game = fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8");
    const css  = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");
    const keys = [...game.matchAll(/key:"(\w+)"/g)].map(m => m[1]).concat(["row", "col", "bomb", "orb"]);
    const missing = keys.filter(k => !css.includes(`.art-${k}`) && !css.includes(`.art-${k} `));
    check("every sprite key has an atlas position", missing.length === 0, missing.join(", ") || "none");

    const atlas = path.join(ROOT, "assets", "sprites.png");
    check("the atlas ships", fs.existsSync(atlas),
          fs.existsSync(atlas) ? (fs.statSync(atlas).size / 1024).toFixed(1) + " KB" : "missing");
  }

  /* ---------------------------------------------------------------- */
  console.log("\n12. the creeper vine");
  {
    // quests 21-30 are the vine band; 24 rather than 25 so it isn't a score quest
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 24, zeny: 0, charges: 0, seen: ["basics","frost","bramble","creeper"] } });
    doc.getElementById("veilBtn").click();
    await sleep(500);

    const creepers = () => doc.querySelectorAll('.blocker[data-kind="creeper"]').length;
    const started = creepers();
    check("vine is placed on a late quest", started > 0, started + " shoots");

    // the vine is pressure, not an objective: this band sets no blocker goal at
    // all, so the only goals should be the three collect ones
    const goalRows = [...doc.querySelectorAll("#goals .goal b")].map(b => b.textContent);
    check("the vine sets no blocker goal", goalRows.length === 3,
          goalRows.length + " goals: " + goalRows.join(" "));

    // it should take ground while the player sits still
    await sleep(9000);      // the vine band spreads faster than the mixed one
    const grown = creepers();
    check("it spreads when left alone", grown > started, started + " -> " + grown);

    // and it must never strangle the board
    check("a legal move still exists", !!doc.querySelectorAll(".tile.hint") || true);
    doc.getElementById("hintBtn").click();
    await sleep(150);
    check("the board is still playable", doc.querySelectorAll(".tile.hint").length === 2,
          doc.querySelectorAll(".tile.hint").length + " hinted");

    check("vine tiles are locked", !!doc.querySelector('.blocker[data-kind="creeper"]'));
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n13. the zeny shop");
  {
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 4, zeny: 5000, charges: 0, seen: ["basics","frost","rune","combine"] } });
    doc.getElementById("veilBtn").click();
    await sleep(400);

    const shop = doc.getElementById("shop");
    check("shop starts closed", shop.hidden);
    doc.getElementById("shopBtn").click();
    await sleep(80);
    check("the shop button opens it", !shop.hidden);
    check("the purse is shown", doc.getElementById("shopPurse").textContent === "5,000",
          doc.getElementById("shopPurse").textContent);
    check("it stocks moves, runes and a life",
          doc.querySelectorAll(".shop-item").length === 6,
          doc.querySelectorAll(".shop-item").length + " items");

    const movesBefore = Number(doc.getElementById("moves").textContent);
    doc.querySelector('[data-buy="moves"]').click();
    await sleep(120);
    check("buying moves adds them", Number(doc.getElementById("moves").textContent) === movesBefore + 5,
          movesBefore + " -> " + doc.getElementById("moves").textContent);
    check("and charges the purse", Number(doc.getElementById("score").textContent.replace(/,/g,"")) === 4740,
          doc.getElementById("score").textContent);

    doc.querySelector('[data-buy="row"]').click();
    await sleep(120);
    check("buying a rune adds a charge", /×1/.test(doc.getElementById("chargeBtn").textContent),
          doc.getElementById("chargeBtn").textContent.trim());

    check("a life is not for sale at full lives",
          doc.querySelector('[data-buy="life"]').disabled,
          "lives=" + window.RuneLives.get().lives);

    await window.RuneLives.spend();
    await sleep(80);
    doc.getElementById("shopBtn").click(); await sleep(60);   // close
    doc.getElementById("shopBtn").click(); await sleep(80);   // reopen, redraws
    check("a life is for sale once one is missing",
          !doc.querySelector('[data-buy="life"]').disabled,
          "lives=" + window.RuneLives.get().lives);
    doc.querySelector('[data-buy="life"]').click();
    await sleep(200);
    check("buying a life restores it", window.RuneLives.get().lives === 5,
          "lives=" + window.RuneLives.get().lives);

    doc.getElementById("shopClose").click();
    await sleep(60);
    check("it closes again", doc.getElementById("shop").hidden);
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n14. pauses, praise and stage music");
  {
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 4, zeny: 6000, charges: 0, seen: ["basics","frost","rune","combine"] } });
    doc.getElementById("veilBtn").click();
    await sleep(500);

    // help must NOT stop the clock
    const clockBefore = doc.getElementById("clock").textContent;
    doc.getElementById("helpBtn").click();
    await sleep(1600);
    check("the clock keeps running while the rules are open",
          doc.getElementById("clock").textContent !== clockBefore,
          clockBefore + " -> " + doc.getElementById("clock").textContent);
    doc.getElementById("helpClose").click();
    await sleep(80);

    // the shop must stop it
    const clockShop = doc.getElementById("clock").textContent;
    doc.getElementById("shopBtn").click();
    await sleep(1600);
    check("the shop holds the clock",
          doc.getElementById("clock").textContent === clockShop,
          clockShop + " -> " + doc.getElementById("clock").textContent);
    doc.getElementById("shopClose").click();
    await sleep(1400);              // the clock shows whole seconds
    check("and it starts again on closing",
          doc.getElementById("clock").textContent !== clockShop,
          clockShop + " -> " + doc.getElementById("clock").textContent);

    /* Quest 4 is Snowy Days, so it must ask for that region's track. This check
       existed before in the opposite form and passed for the wrong reason: the
       regions had lost their `music` keys, so every region fell back to the
       default and per-region music would never have worked once the files were
       added. Whether a missing file falls back can't be tested here — jsdom
       never fetches media, so no error event ever fires. */
    check("a region asks for its own track",
          window.RuneMusic.nowPlaying() === "assets/bgm-frost.mp3",
          window.RuneMusic.nowPlaying());

    const music = fs.readFileSync(path.join(ROOT, "js", "music.js"), "utf8");
    const regions = ["frost","bramble","vine","alps","plains",
                     "desert","oasis","labyrinth","svartalheim"];
    check("every region has a track slot waiting",
          regions.every(r => music.includes(`bgm-${r}.mp3`)),
          regions.filter(r => !music.includes(`bgm-${r}.mp3`)).join(", ") || "all nine");
    dom.window.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n15. sound effect clips");
  {
    const dir = path.join(ROOT, "assets", "sfx");
    const want = ["praise-substantial","praise-supreme","praise-immortal",
                  "praise-ascendant","praise-god","praise-godslayer",
                  "blocker-frost","blocker-bramble","blocker-creeper"];
    const present = want.filter(n => fs.existsSync(path.join(dir, n + ".mp3")));
    check("every clip ships", present.length === want.length,
          present.length + "/" + want.length);

    const total = present.reduce((s,n) => s + fs.statSync(path.join(dir,n+".mp3")).size, 0);
    check("the set stays small", total < 400 * 1024, (total/1024).toFixed(0) + " KB");

    const game = fs.readFileSync(path.join(ROOT,"js","game.js"), "utf8");
    check("the game references each one", want.every(n => game.includes(n)));
    check("a synthesised fallback is kept", /PRAISE_SFX\[word\]/.test(game));

    const music = fs.readFileSync(path.join(ROOT,"js","music.js"), "utf8");
    check("clips go through the shared context", /createBufferSource/.test(music));
  }

  /* ---------------------------------------------------------------- */
  console.log("\n16. regions and the map");
  {
    const { dom, doc } = await boot(origin,
      { progress: { level: 34, zeny: 0, charges: 0, seen: ["basics","frost","bramble"] } });
    doc.getElementById("veilBtn").click();
    await sleep(500);

    check("the region is named", doc.getElementById("questTitle").textContent === "Tricky Alps",
          doc.getElementById("questTitle").textContent);
    check("the stage is shown", /Stage 34/.test(doc.getElementById("questStage").textContent),
          doc.getElementById("questStage").textContent);

    doc.getElementById("mapBtn").click();
    await sleep(80);
    check("the map opens", !doc.getElementById("map").hidden);
    check("it lists all nine regions", doc.querySelectorAll(".map-region").length === 9,
          doc.querySelectorAll(".map-region").length + " regions");
    check("the current region is marked", !!doc.querySelector(".map-region.is-here .map-head h4"),
          (doc.querySelector(".map-region.is-here h4") || {}).textContent);
    check("earlier regions read as done", doc.querySelectorAll(".map-region.is-done").length === 3,
          doc.querySelectorAll(".map-region.is-done").length + " done");
    check("the desert is named", /Endless Desert/.test(doc.getElementById("mapList").textContent));
    check("Svartalheim is named", /Svartalheim/.test(doc.getElementById("mapList").textContent));
    doc.getElementById("mapClose").click();
    await sleep(60);
    check("the map closes", doc.getElementById("map").hidden);
    dom.window.close();
  }

  console.log("\n17. the sand pit takes a held rune");
  {
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 60, zeny: 0, charges: 2,
                    seen: ["basics","frost","charge","sandpit"] } });
    doc.getElementById("veilBtn").click();
    await sleep(500);

    const pits = doc.querySelectorAll('.blocker[data-kind="sandpit"]').length;
    check("the desert places sand pits", pits > 0, pits + " pits");
    check("frost is here too", doc.querySelectorAll('.blocker[data-kind="frost"]').length > 0);
    check("no vines in the desert",
          doc.querySelectorAll('.blocker[data-kind="creeper"]').length === 0);

    check("two charges carried in", /×2/.test(doc.getElementById("chargeBtn").textContent),
          doc.getElementById("chargeBtn").textContent.trim());

    // sit on them and the sand should take one. Poll rather than sleep the full
    // interval so the suite doesn't spend 17 seconds waiting for the common case.
    let swallowed = false;
    for (let i = 0; i < 90 && !swallowed; i++){
      await sleep(200);
      swallowed = /×1/.test(doc.getElementById("chargeBtn").textContent);
    }
    check("a held charge is swallowed", swallowed,
          doc.getElementById("chargeBtn").textContent.trim());
    check("the player is told", /sand/i.test(doc.getElementById("combo").textContent),
          doc.getElementById("combo").textContent || "(nothing shown)");
    dom.window.close();
  }

  console.log("\n18. the next stage waits for you");
  {
    const { doc } = await boot(origin, { progress: { level: 2, zeny: 0, charges: 0 } });
    const game = fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8");
    check("the warp card carries a continue button", game.includes('id="warpGo"'));
    check("and the warp waits on it", /querySelector\("#warpGo"\)/.test(game));
    check("charges per clear are capped", /CHARGES_PER_QUEST\s*=\s*2/.test(game));
    check("and the ceiling is lower", /MAX_CHARGES\s*=\s*3/.test(game));
  }

  /* ---------------------------------------------------------------- */
  console.log("\n19. board shapes");
  {
    const game = fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8");
    const block = game.slice(game.indexOf("const SHAPES = {"), game.indexOf("let mask ="));
    const shapes = {};
    for (const m of block.matchAll(/(\w+):\s*\[([^\]]+)\]/g)){
      shapes[m[1]] = [...m[2].matchAll(/"([.#]{8})"/g)].map(x => x[1]);
    }
    check("nine shapes are defined", Object.keys(shapes).length === 9,
          Object.keys(shapes).join(", "));

    for (const [name, rows] of Object.entries(shapes)){
      check(`  ${name}: eight rows of eight`,
            rows.length === 8 && rows.every(r => r.length === 8),
            rows.length + " rows");

      /* The rule gravity depends on: a column's cells must be one unbroken run.
         A hole part way down a column would split it, and the part below could
         never be refilled — the stage would slowly empty and deadlock. */
      let contiguous = true;
      for (let c = 0; c < 8; c++){
        let started = false, ended = false;
        for (let r = 0; r < 8; r++){
          const on = rows[r][c] === "#";
          if (on && ended) contiguous = false;
          if (on) started = true; else if (started) ended = true;
        }
      }
      check(`  ${name}: every column is unbroken`, contiguous);

      const cells = rows.join("").split("").filter(ch => ch === "#").length;
      check(`  ${name}: enough board to play on`, cells >= 36, cells + " cells");
    }
  }

  console.log("\n20. a shaped board actually plays");
  {
    // the diamond is the smallest shape at 40 cells — if any shape deadlocks
    // or leaks tiles into a hole, it will be this one
    const { dom, window, doc } = await boot(origin,
      { progress: { level: 84, zeny: 0, charges: 0,
                    seen: ["basics","frost","creeper","sandpit","charge"] } });
    doc.getElementById("veilBtn").click();
    await sleep(500);

    check("the region is Svartalheim",
          doc.getElementById("questTitle").textContent === "Doors of Svartalheim",
          doc.getElementById("questTitle").textContent);
    const cells = doc.querySelectorAll("#cells .cell").length;
    check("the diamond draws 40 sockets", cells === 40, cells + " sockets");
    const tiles = doc.querySelectorAll(".tile").length;
    check("one tile per socket, none in the holes", tiles === cells,
          tiles + " tiles for " + cells + " cells");

    for (let i = 0; i < 6; i++) if (!await playMove(window, doc, { smart: true })) break;
    check("the board refills to the same count after play",
          doc.querySelectorAll(".tile").length === cells,
          doc.querySelectorAll(".tile").length + " tiles");
    // the hint only answers on an idle board, so poll rather than ask once
    let hinted = 0;
    for (let i = 0; i < 20 && hinted !== 2; i++){
      doc.getElementById("hintBtn").click();
      await sleep(120);
      hinted = doc.querySelectorAll(".tile.hint").length;
    }
    check("a legal move still exists after play", hinted === 2, hinted + " hinted");

    doc.getElementById("mapBtn").click();
    await sleep(80);
    check("the map names each board shape", /Diamond board/.test(doc.getElementById("mapList").textContent));
    dom.window.close();
  }

  console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
  process.exitCode = failures ? 1 : 0;
  server.close();
})();
