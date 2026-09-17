/* Viewport test — boots the game at real device dimensions and checks the board
   is sized to fit.
 *
 * Honest about its limits: jsdom has no layout engine, so this cannot see
 * whether something is visually clipped. What it *can* verify is the arithmetic
 * in fit(), which is what decides whether the board overflows its container —
 * and a board wider than the screen is the usual cause of "cut off on mobile".
 * The stacking order and overflow behaviour still need a real device.
 *
 * Run: node test/viewport.js  */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const http = require("http");
const fs = require("fs");

const { sleep, waitForBoot } = require("./bot");
const ROOT = path.resolve(__dirname, "..");
const COLS = 8;

const BODY_PADDING = 16;   // css: body padding each side
const FRAME_NARROW = 12;   // css: .frame side padding on phones (vine gutter)
const FRAME_WIDE   = 16;   // css: .frame side padding on desktop

const DEVICES = [
  { name: "iPhone SE",        w: 375, h: 667 },
  { name: "iPhone 14 Pro",    w: 393, h: 852 },
  { name: "Galaxy S ordinary", w: 360, h: 640 },
  { name: "small Android",    w: 320, h: 568 },
  { name: "iPad portrait",    w: 768, h: 1024 },
  { name: "phone landscape",  w: 667, h: 375 },
  { name: "desktop",          w: 1440, h: 900 }
];

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
}

async function measure(origin, dev, useVisualViewport){
  const vc = new VirtualConsole();
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
      try { window.localStorage.clear(); } catch (e){}
      Object.defineProperty(window, "innerWidth",  { value: dev.w, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: dev.h, configurable: true });
      if (useVisualViewport){
        // the real thing is smaller than innerHeight while the address bar shows
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: { width: dev.w, height: dev.h - 90, addEventListener(){}, removeEventListener(){} }
        });
      }
    }
  });
  await waitForBoot(dom.window.document);
  const cell = parseFloat(dom.window.document.documentElement.style.getPropertyValue("--cell"));
  dom.window.close();
  return cell;
}

(async () => {
  const server = await serve();
  const origin = "http://localhost:" + server.address().port + "/";

  console.log("Board sizing by device (jsdom: arithmetic only, not visual layout)\n");
  console.log(`${"device".padEnd(18)} ${"screen".padEnd(11)} ${"cell".padEnd(6)} ${"board".padEnd(7)} needs`);

  for (const dev of DEVICES){
    const cell = await measure(origin, dev, false);
    const narrow = dev.w < 820;
    const frame = narrow ? FRAME_NARROW : FRAME_WIDE;
    const board = cell * COLS;
    const total = board + frame * 2 + BODY_PADDING * 2;

    console.log(`${dev.name.padEnd(18)} ${(dev.w + "x" + dev.h).padEnd(11)} ${String(cell).padEnd(6)} ${String(board).padEnd(7)} ${total}px of ${dev.w}px`);

    check(`  ${dev.name}: fits across the screen`, total <= dev.w,
          total + " <= " + dev.w);
    check(`  ${dev.name}: tiles stay tappable`, cell >= 30, cell + "px");
    if (narrow && dev.h > dev.w){          // portrait stacks the HUD above and below
      check(`  ${dev.name}: board leaves room for the HUD`, board <= dev.h * 0.55,
            board + "px of " + dev.h + "px tall");
    }
    if (narrow && dev.w > dev.h){          // landscape puts the HUD beside it
      check(`  ${dev.name}: board uses the available height`, board <= dev.h - 40,
            board + "px of " + dev.h + "px tall");
    }
  }

  console.log("\nwith visualViewport reporting a shorter screen (address bar visible)");
  for (const dev of DEVICES.slice(0, 3)){
    const plain = await measure(origin, dev, false);
    const vv    = await measure(origin, dev, true);
    check(`  ${dev.name}: board shrinks to the real viewport`, vv <= plain,
          plain + "px -> " + vv + "px");
  }

  console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
  process.exitCode = failures ? 1 : 0;
  server.close();
})();
