/* Shared test bot.
 *
 * The game keeps its state inside a closure, so the tests can't reach in. This
 * reads the board back out of the DOM instead: tile positions come from their
 * translate3d(), and the colour and rune are published as data-type and
 * data-special on each tile element.
 *
 * Deliberately no smarter than a decent human: one move deep, no cascade
 * planning, and it never spends rune charges. So when the bot clears a goal,
 * a person certainly can. */
const ROWS = 8, COLS = 8;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The page boots asynchronously (it awaits Lives.init), and on a busy machine
   the scripts may not even have finished loading yet. Every test waits on this
   rather than guessing a sleep — guessing produced flaky failures. */
async function waitForBoot(doc, timeout = 6000){
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline){
    const cell = parseFloat(doc.documentElement.style.getPropertyValue("--cell"));
    const tiles = doc.querySelectorAll(".tile").length;
    if (cell > 0 && tiles === ROWS * COLS) return true;
    await sleep(50);
  }
  return false;
}

function cellSize(doc){
  return parseFloat(doc.documentElement.style.getPropertyValue("--cell")) || 56;
}

function posOf(el, cell){
  const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform || "");
  return m ? { c: Math.round(+m[1] / cell), r: Math.round(+m[2] / cell) } : null;
}

function readBoard(doc, cell){
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const el of doc.querySelectorAll(".tile")){
    const p = posOf(el, cell);
    if (!p || p.r < 0 || p.r >= ROWS || p.c < 0 || p.c >= COLS) continue;
    const type = el.dataset.type === undefined ? -1 : Number(el.dataset.type);
    grid[p.r][p.c] = { el, type: Number.isFinite(type) ? type : -1, special: el.dataset.special || "" };
  }
  const blockers = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const el of doc.querySelectorAll(".blocker")){
    const p = posOf(el, cell);
    if (p && p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS) blockers[p.r][p.c] = el.dataset.kind;
  }
  return { grid, blockers };
}

/* the game's own 3-in-a-row rule, applied to a hypothetical board */
function matchesOn(grid){
  const hit = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 2; c++){
    const a = grid[r][c], b = grid[r][c+1], d = grid[r][c+2];
    if (a && b && d && a.type >= 0 && a.type === b.type && b.type === d.type)
      hit.add(r+","+c).add(r+","+(c+1)).add(r+","+(c+2));
  }
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS - 2; r++){
    const a = grid[r][c], b = grid[r+1][c], d = grid[r+2][c];
    if (a && b && d && a.type >= 0 && a.type === b.type && b.type === d.type)
      hit.add(r+","+c).add((r+1)+","+c).add((r+2)+","+c);
  }
  return hit;
}

/* prefers the swap that chips the most blockers; ties go to the bigger match */
function chooseMove(doc, cell){
  const { grid, blockers } = readBoard(doc, cell);
  let best = null;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
    if (!grid[r][c] || blockers[r][c] === "bramble") continue;
    for (const [dr,dc] of [[0,1],[1,0]]){
      const r2 = r + dr, c2 = c + dc;
      if (r2 >= ROWS || c2 >= COLS) continue;
      if (!grid[r2][c2] || blockers[r2][c2] === "bramble") continue;

      let t = grid[r][c]; grid[r][c] = grid[r2][c2]; grid[r2][c2] = t;
      const hit = matchesOn(grid);
      t = grid[r][c]; grid[r][c] = grid[r2][c2]; grid[r2][c2] = t;
      if (!hit.size) continue;

      let chips = 0;
      for (const k of hit){
        const [hr,hc] = k.split(",").map(Number);
        if (blockers[hr][hc]) chips++;
      }
      const rank = chips * 100 + hit.size;
      if (!best || rank > best.rank) best = { rank, chips, a: grid[r][c].el, b: grid[r2][c2].el };
    }
  }
  return best;
}

function tap(window, el){
  for (const type of ["pointerdown", "pointerup"]){
    const e = new window.Event(type, { bubbles: true });
    e.clientX = 0; e.clientY = 0; e.pointerId = 1;
    Object.defineProperty(e, "target", { value: el });
    el.dispatchEvent(e);
  }
}

/* waits for the board to go idle, then plays one move. false when none is left. */
async function playMove(window, doc, { smart = true, settle = 900 } = {}){
  const cell = cellSize(doc);

  // the hint button only answers when the board isn't animating — use it as the idle signal
  let hinted = [];
  for (let attempt = 0; attempt < 20 && hinted.length !== 2; attempt++){
    doc.getElementById("hintBtn").click();
    await sleep(120);
    hinted = [...doc.querySelectorAll(".tile.hint")];
  }
  if (hinted.length !== 2) return false;

  let [a, b] = hinted;
  if (smart){
    const pick = chooseMove(doc, cell);
    if (pick){ a = pick.a; b = pick.b; }
  }
  tap(window, a);
  await sleep(40);
  tap(window, b);
  await sleep(settle);
  return true;
}

module.exports = { ROWS, COLS, sleep, waitForBoot, cellSize, posOf, readBoard,
                   matchesOn, chooseMove, tap, playMove };
