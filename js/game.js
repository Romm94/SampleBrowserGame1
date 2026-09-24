(() => {
  "use strict";

  const ROWS = 8, COLS = 8;

  /* ---- tuning ---------------------------------------------------------- */
  /* Unused moves become carried runes, but sparingly. At 3 moves per charge
     with a ceiling of 5, a quick clear handed over enough firepower to coast
     through the next quest — the speed bonus already pays for finishing fast,
     and paying twice made the game easier the better you played. */
  const MOVES_PER_CHARGE = 6;    // unused moves needed for one carried rune charge
  const CHARGES_PER_QUEST = 2;   // most a single clear can hand over
  const MAX_CHARGES      = 3;    // ceiling on charges held at once
  const TIME_FLOOR       = 80;   // seconds, shortest a stage can be
  const TIME_CEIL        = 300;  // seconds, longest a stage can be
  const CONTINUE_BASE    = 1200; // zeny for the first continue in a quest
  const CONTINUE_MOVES   = 5;    // what a "more moves" continue buys
  const CONTINUE_SECONDS = 30;   // what a "more time" continue buys
  const CREEPER_CAP      = 14;   // the vine never takes more of the board than this

  /* Zeny is scarce on purpose: a quest pays enough to matter but not enough to
     buy freely, which is what gives the shop and the continue price weight.
     Everything earned runs through these four numbers. */
  const PAY_TILE   = 12;   // per tile in an ordinary match, times the cascade
  const PAY_ORB    = 16;   // per tile when an orb detonates a colour
  const PAY_COMBO  = 20;   // per tile in a rune combination
  const PAY_CHIP   = 8;    // per blocker chipped
  /* ---------------------------------------------------------------------- */

  /* key matches the cell name in assets/sprites.png; spark is the colour used
     for that slime's debris when it pops */
  const TYPES = [
    { name:"Ember",  key:"ember",  spark:"#ff8b5c" },
    { name:"Amber",  key:"amber",  spark:"#ffd76a" },
    { name:"Moss",   key:"moss",   spark:"#8ff08a" },
    { name:"Frost",  key:"frost",  spark:"#7fd2ff" },
    { name:"Wraith", key:"wraith", spark:"#c39bff" },
    { name:"Bone",   key:"bone",   spark:"#e6edf5" }
  ];

  const Lives = window.RuneLives;
  // telemetry is optional; every call goes through this so its absence is harmless
  const tel = (method, ...args) => {
    try { const t = window.RuneTelemetry; if (t && t[method]) t[method](...args); } catch (e){}
  };
  const Progress = window.RuneProgress;

  const boardEl  = document.getElementById("board");
  const blockEl  = document.getElementById("blockers");
  const scoreEl  = document.getElementById("score");
  const movesEl  = document.getElementById("moves");
  const goalsEl  = document.getElementById("goals");
  const questEl  = document.getElementById("questTitle");
  const stageEl  = document.getElementById("questStage");
  const cellsEl  = document.getElementById("cells");
  const mapEl    = document.getElementById("map");
  const mapList  = document.getElementById("mapList");
  const comboEl  = document.getElementById("combo");
  const timerEl  = document.getElementById("timer");
  const clockEl  = document.getElementById("clock");
  const barEl    = document.getElementById("timeBar");
  const heartsEl = document.getElementById("hearts");
  const regenEl  = document.getElementById("regen");
  const chargeBtn= document.getElementById("chargeBtn");
  const pickerEl = document.getElementById("picker");
  const tipEl    = document.getElementById("tip");
  const helpEl   = document.getElementById("help");
  const shopEl   = document.getElementById("shop");
  const shopList = document.getElementById("shopList");
  const shopPurse= document.getElementById("shopPurse");
  const frameEl  = document.querySelector(".frame");
  const warpEl   = document.getElementById("warp");
  const warpBody = document.getElementById("warpBody");
  const veil     = document.getElementById("veil");
  const veilTitle= document.getElementById("veilTitle");
  const veilText = document.getElementById("veilText");
  const veilTally= document.getElementById("veilTally");
  const veilBtn  = document.getElementById("veilBtn");
  const veilAlt  = document.getElementById("veilAlt");

  let board = [];
  let blockers = [];                 // blockers[r][c] = {kind, hp} | null — belongs to the cell, not the slime
  const blockEls = new Map();        // "r,c" -> element
  const tiles = new Map();
  let nextId = 1;
  let busy = true, started = false, locked = false;
  let score = 0, movesLeft = 0, level = 1;
  let goals = [];
  let questKind = "collect", scoreTarget = 0, scoreAtStart = 0, blockerTotal = 0;
  let continues = 0;
  let stagePlan = { frost: 0, bramble: 0 };
  let charges = 0, armed = false, chargeRune = "bomb";
  let seenTips = [];
  let musicOff = false;
  let selected = null, hintTimer = null;

  // timer
  let timeTotal = 0, timeLeft = 0, deadline = 0, ticker = null;

  const T = id => tiles.get(id);
  const K = (r,c) => r + "," + c;
  const parse = k => k.split(",").map(Number);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const inBounds = (r,c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const rnd = n => Math.floor(Math.random() * n);
  const clock = s => Math.floor(s/60) + ":" + String(Math.floor(s%60)).padStart(2,"0");

  /* ---------------- artwork ---------------- */
  const art = key => `<i class="art art-${key}"></i>`;

  function slimeMarkup(type, special){
    const rune = (special === "row" || special === "col" || special === "bomb")
      ? `<b class="rune">${art(special)}</b>` : "";
    return art(TYPES[type].key) + rune;
  }
  const tileMarkup = t => t.special === "rainbow" ? art("orb") : slimeMarkup(t.type, t.special);
  const heartMarkup = full =>
    `<svg viewBox="0 0 24 24" class="${full ? "on" : "off"}" aria-hidden="true">
       <path d="M12 21s-7.4-4.6-9.3-8.9A5.2 5.2 0 0 1 12 6.7a5.2 5.2 0 0 1 9.3 5.4C19.4 16.4 12 21 12 21z"/></svg>`;

  document.querySelectorAll("[data-art]").forEach(el => {
    el.className = (el.className + " art art-" + el.dataset.art).trim();
  });

  /* ---------------- sound ---------------- */
  let muted = false;
  // one context for the whole game; iOS caps how many you may open and starts
  // them suspended, so effects and music both go through RuneAudio
  const actx = () => (window.RuneAudio ? RuneAudio.context() : null);

  function blip(freq, dur = .09, type = "triangle", vol = .16){
    if (muted) return;
    try {
      const audio = actx(); if (!audio) return;
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch(e){}
  }
  function sweep(from, to, dur){
    if (muted) return;
    try {
      const audio = actx(); if (!audio) return;
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(from, audio.currentTime);
      o.frequency.exponentialRampToValueAtTime(to, audio.currentTime + dur);
      g.gain.setValueAtTime(.18, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch(e){}
  }
  function chord(freqs, dur = .5, type = "triangle", vol = .13){
    freqs.forEach((f, i) => setTimeout(() => blip(f, dur, type, vol), i * 55));
  }
  function boom(){
    if (muted) return;
    try {
      const audio = actx(); if (!audio) return;
      const len = Math.floor(audio.sampleRate * 0.5);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i/len, 3);
      const src = audio.createBufferSource(); src.buffer = buf;
      const lp = audio.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
      const g = audio.createGain(); g.gain.value = .5;
      src.connect(lp).connect(g).connect(audio.destination);
      src.start();
    } catch (e){}
  }

  const sfxBtn = document.getElementById("sfxBtn");
  const bgmBtn = document.getElementById("bgmBtn");

  function dressToggle(btn, off, onIcon, offIcon){
    btn.textContent = off ? offIcon : onIcon;
    btn.classList.toggle("is-off", off);
    btn.setAttribute("aria-pressed", String(!off));
  }

  sfxBtn.onclick = () => {
    muted = !muted;                       // effects only
    dressToggle(sfxBtn, muted, "🔊", "🔇");
    if (!muted) blip(680, .08, "sine", .12);
    saveSettings();
  };

  bgmBtn.onclick = () => {
    musicOff = !musicOff;
    if (window.RuneMusic) RuneMusic.setMuted(musicOff);
    dressToggle(bgmBtn, musicOff, "♪", "♪");
    saveSettings();
  };

  /* Recorded clips, with the synthesised versions kept as a fallback. Nothing
     is fetched until the first tap, and a file that won't load just means the
     synth plays instead. */
  const SFX_FILES = {
    "praise-substantial": "assets/sfx/praise-substantial.mp3",
    "praise-supreme":     "assets/sfx/praise-supreme.mp3",
    "praise-immortal":    "assets/sfx/praise-immortal.mp3",
    "praise-ascendant":   "assets/sfx/praise-ascendant.mp3",
    "praise-god":         "assets/sfx/praise-god.mp3",
    "praise-godslayer":   "assets/sfx/praise-godslayer.mp3",
    "blocker-frost":      "assets/sfx/blocker-frost.mp3",
    "blocker-bramble":    "assets/sfx/blocker-bramble.mp3",
    "blocker-creeper":    "assets/sfx/blocker-creeper.mp3"
  };
  const PRAISE_SAMPLE = {
    "Substantial":"praise-substantial", "Supreme":"praise-supreme",
    "Immortal":"praise-immortal",       "Ascendant":"praise-ascendant",
    "God!":"praise-god",                "God-slayer!":"praise-godslayer"
  };
  const sample = (name, vol = 1) =>
    !muted && window.RuneAudio && RuneAudio.play(name, vol);

  if (window.RuneAudio) RuneAudio.samples(SFX_FILES);
  if (window.RuneMusic) RuneMusic.init();

  /* ---------------- sizing ---------------- */
  function fit(){
    // visualViewport reflects the area actually on screen once the mobile
    // address bar and on-screen keyboard are accounted for; innerHeight doesn't
    const vv = window.visualViewport;
    const vw = Math.round((vv && vv.width)  || window.innerWidth);
    const vh = Math.round((vv && vv.height) || window.innerHeight);
    const narrow = vw < 820;
    // a phone on its side has the HUD beside the board, not above it, so the
    // board gets the height instead of sharing it
    const sideBySide = narrow && vh < 560 && vw > vh;

    // gutter covers the body padding (16 each side) plus the board frame, which
    // is wider at the sides now to make room for the vines
    const widthCap  = vw - (narrow ? 58 : 70);
    const heightCap = sideBySide ? vh - 56
                    : narrow     ? vh * 0.48      // shares the screen with the HUD
                    :              vh - 260;

    const cell = Math.max(30, Math.floor(Math.min(widthCap, heightCap, 480) / COLS));
    document.documentElement.style.setProperty("--cell", cell + "px");
    syncPositions(false);
    syncBlockers();
    drawCells();
  }
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", () => setTimeout(fit, 120));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
  const cellPx = () => {
    const el = document.documentElement;
    const v = getComputedStyle(el).getPropertyValue("--cell") || el.style.getPropertyValue("--cell");
    return parseFloat(v) || 56;
  };

  /* ---------------- tiles ---------------- */
  function makeTile(type, special = null){
    const t = { id: nextId++, type, special, r: 0, c: 0, el: null };
    tiles.set(t.id, t);
    const el = document.createElement("div");
    el.className = "tile";
    el.dataset.id = t.id;
    dressTile(el, t);
    boardEl.appendChild(el);
    t.el = el;
    return t;
  }
  /* named dressTile, not paint — paint() further down is the rune flash effect,
     and two function declarations with one name silently clobber each other */
  function dressTile(el, t){
    el.dataset.type = t.type;
    if (t.special) el.dataset.special = t.special;
    else delete el.dataset.special;     // an empty value still matches [data-special]
    el.innerHTML = tileMarkup(t);
  }
  const repaint = t => dressTile(t.el, t);

  function place(t, animate = true){
    const s = cellPx();
    const tf = `translate3d(${t.c * s}px, ${t.r * s}px, 0)`;
    if (!animate) t.el.style.transition = "none";
    t.el.style.transform = tf;
    t.el.style.setProperty("--tf", tf);
    if (!animate){ void t.el.offsetWidth; t.el.style.transition = ""; }
  }
  function syncPositions(animate = true){
    if (!board.length) return;          // fit() can fire before the first board exists
    for (let r = 0; r < ROWS; r++){
      const row = board[r]; if (!row) continue;
      for (let c = 0; c < COLS; c++){
        const id = row[c]; if (!id) continue;
        const t = T(id); t.r = r; t.c = c; place(t, animate);
      }
    }
  }
  function destroy(t){ t.el.remove(); tiles.delete(t.id); }

  /* ---------------- blockers ----------------
     Blockers belong to the cell, not to the slime sitting on it. Slimes fall
     through them normally, which keeps gravity untouched — the alternative,
     blockers that occupy a cell, needs column-segment refill logic and can
     strand a pocket of board with no way for new slimes to reach it. */
  const BLOCKER_ART = { frost:"frozen", bramble:"bramble", creeper:"creeper" };

  function blockerMarkup(b){
    const chipped = b.hp < (b.max || b.hp) ? " is-chipped" : "";
    // the sand pit has no atlas cell; it's drawn in CSS as a turning funnel
    if (b.kind === "sandpit") return `<i class="sandpit${chipped}"></i>`;
    return `<i class="art art-${BLOCKER_ART[b.kind]}${chipped}"></i>`;
  }

  function resetBlockers(){
    blockEl.innerHTML = "";
    blockEls.clear();
    blockers = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    blockerTotal = 0;
  }

  function drawBlocker(r, c){
    const k = K(r,c);
    const b = blockers[r][c];
    const existing = blockEls.get(k);
    if (!b){
      if (existing){
        existing.classList.add("shatter");
        setTimeout(() => existing.remove(), 360);
        blockEls.delete(k);
      }
      return;
    }
    const el = existing || (() => {
      const d = document.createElement("div");
      d.className = "blocker";
      blockEl.appendChild(d);
      blockEls.set(k, d);
      return d;
    })();
    el.dataset.kind = b.kind;
    el.innerHTML = blockerMarkup(b);
    const s = cellPx();
    el.style.transform = `translate3d(${c * s}px, ${r * s}px, 0)`;
  }

  function syncBlockers(){
    const s = cellPx();
    blockEls.forEach((el, k) => {
      const [r,c] = parse(k);
      el.style.transform = `translate3d(${c * s}px, ${r * s}px, 0)`;
    });
  }

  // creeper is left out: it spreads, so counting it would make the goal move
  const blockersLeft = () =>
    blockers.flat().filter(b => b && b.kind !== "creeper").length;
  const creepersLeft = () => blockers.flat().filter(b => b && b.kind === "creeper").length;
  const isLocked = (r,c) => {
    const b = blockers[r] && blockers[r][c];
    return !!b && (b.kind === "bramble" || b.kind === "creeper" || b.kind === "sandpit");
  };
  const sandpitsLeft = () => blockers.flat().filter(b => b && b.kind === "sandpit").length;

  // a cleared cell chips whatever is under it
  function chipBlocker(r, c){
    const b = blockers[r] && blockers[r][c];
    if (!b) return false;
    b.hp--;
    if (b.hp <= 0) blockers[r][c] = null;
    drawBlocker(r,c);
    if (!sample("blocker-" + b.kind, b.hp <= 0 ? 1 : .7))
      blip(b.hp <= 0 ? 620 : 380, .1, "square", .13);
    if (b.kind === "creeper") creeperCleared();
    if (b.kind === "sandpit" && b.hp <= 0 && !sandpitsLeft()) stopSand();
    if (b.kind !== "creeper" && b.hp <= 0) tel("count", "cleared");
    return b.kind !== "creeper";
  }

  /* ---------------- creeper vine ----------------
     An old vine that takes the board back while you're not looking. It spreads
     to a neighbouring cell on a timer, and the timer only resets when you cut
     some of it — so ignoring it costs you the board, and clearing the last of
     it ends the threat for the rest of the quest. */
  let creeperTimer = null, creeperEvery = 0;

  function creeperCleared(){
    // cutting any of it buys time; cutting all of it ends the threat
    clearTimeout(creeperTimer);
    creeperTimer = null;
    if (creepersLeft() > 0) armCreeper();
    else if (creeperEvery) announce("Vine cut back", 900);
  }

  function armCreeper(){
    clearTimeout(creeperTimer);
    if (!creeperEvery || !started || locked) return;
    creeperTimer = setTimeout(growCreeper, creeperEvery);
  }

  function growCreeper(){
    creeperTimer = null;
    if (busy || locked || !started || !veil.hidden){ armCreeper(); return; }
    if (!creepersLeft()) return;                      // beaten for this quest
    if (creepersLeft() >= Math.round(CREEPER_CAP * cellCount / (ROWS * COLS))){ armCreeper(); return; }

    // grow into a free cell beside existing vine
    const spots = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
      if (!blockers[r][c] || blockers[r][c].kind !== "creeper") continue;
      for (const [dr,dc] of [[0,1],[0,-1],[1,0],[-1,0]]){
        const nr = r+dr, nc = c+dc;
        if (playable(nr,nc) && !blockers[nr][nc]) spots.push([nr,nc]);
      }
    }
    if (!spots.length){ armCreeper(); return; }

    const [r,c] = spots[rnd(spots.length)];
    blockers[r][c] = { kind:"creeper", hp:1, max:1 };
    drawBlocker(r,c);
    sparks(r, c, 8, "#7fc96f");
    tel("peak", "creeper", creepersLeft());
    blip(220, .22, "sawtooth", .1);

    // never let it strangle the board completely
    let guard = 0;
    while (!findMove() && guard++ < 30){
      blockers[r][c] = null;
      drawBlocker(r,c);
      break;
    }
    armCreeper();
  }

  function placeBlockers(plan){
    resetBlockers();
    const cells = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (mask[r][c]) cells.push([r,c]);          // never on a hole

    const put = (kind, hp, n) => {
      for (let i = 0; i < n && cells.length; i++){
        const idx = rnd(cells.length);
        const [r,c] = cells.splice(idx,1)[0];
        blockers[r][c] = { kind, hp, max: hp };
        blockerTotal++;
        drawBlocker(r,c);
      }
    };
    put("frost", plan.frostHp || 1, plan.frost || 0);
    put("bramble", 1, plan.bramble || 0);
    put("creeper", 1, plan.creeper || 0);
    put("sandpit", 1, plan.sandpit || 0);

    creeperEvery = plan.creeperEvery || 0;
    sandEvery = plan.sandEvery || 0;
    armCreeper();
    armSand();

    // bramble and creeper freeze their cells, so make sure a legal move survives
    let guard = 0;
    while (!findMove() && guard++ < 40){
      let freed = false;
      for (let r = 0; r < ROWS && !freed; r++) for (let c = 0; c < COLS && !freed; c++){
        if (!isLocked(r,c)) continue;
        if (blockers[r][c].kind !== "creeper") blockerTotal--;
        blockers[r][c] = null;
        drawBlocker(r,c);
        freed = true;
      }
      if (!freed) break;                  // nothing left to remove
    }
  }

  /* ---------------- board setup ---------------- */
  function buildBoard(entrance){
    tiles.forEach(t => t.el.remove());
    tiles.clear();
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
      if (!mask[r][c]) continue;                    // a hole in the shape
      const bad = new Set();
      // only look back through cells that exist; a hole breaks the run anyway
      if (c >= 2 && board[r][c-1] && board[r][c-2] &&
          T(board[r][c-1]).type === T(board[r][c-2]).type) bad.add(T(board[r][c-1]).type);
      if (r >= 2 && board[r-1][c] && board[r-2][c] &&
          T(board[r-1][c]).type === T(board[r-2][c]).type) bad.add(T(board[r-1][c]).type);
      let ty; do { ty = rnd(TYPES.length); } while (bad.has(ty));
      board[r][c] = makeTile(ty).id;
    }
    syncPositions(false);
    resetBlockers();
    if (!findMove()) return buildBoard(entrance);
    placeBlockers(stagePlan);
    if (entrance){
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
        if (!board[r][c]) continue;
        const t = T(board[r][c]);
        t.el.style.animationDelay = ((r + c) * 22) + "ms";
        t.el.classList.add("warp-in");
      }
      setTimeout(() => tiles.forEach(t => {
        t.el.classList.remove("warp-in");
        t.el.style.animationDelay = "";
      }), 900);
    }
  }

  /* ---------------- matching ---------------- */
  function findRuns(){
    const runs = [];
    for (let r = 0; r < ROWS; r++){
      let c = 0;
      while (c < COLS){
        const id = board[r][c];
        if (!id || T(id).type < 0){ c++; continue; }
        const ty = T(id).type;
        let e = c + 1;
        while (e < COLS && board[r][e] && T(board[r][e]).type === ty) e++;
        if (e - c >= 3){
          const cells = []; for (let k = c; k < e; k++) cells.push(K(r,k));
          runs.push({ cells, dir:"h", len:e - c, type:ty });
        }
        c = e;
      }
    }
    for (let c = 0; c < COLS; c++){
      let r = 0;
      while (r < ROWS){
        const id = board[r][c];
        if (!id || T(id).type < 0){ r++; continue; }
        const ty = T(id).type;
        let e = r + 1;
        while (e < ROWS && board[e][c] && T(board[e][c]).type === ty) e++;
        if (e - r >= 3){
          const cells = []; for (let k = r; k < e; k++) cells.push(K(k,c));
          runs.push({ cells, dir:"v", len:e - r, type:ty });
        }
        r = e;
      }
    }
    return runs;
  }

  function findGroups(){
    const groups = [];
    for (const run of findRuns()){
      const hits = groups.filter(g => run.cells.some(c => g.cells.has(c)));
      if (!hits.length){ groups.push({ cells:new Set(run.cells), runs:[run] }); continue; }
      const g = hits[0];
      run.cells.forEach(c => g.cells.add(c));
      g.runs.push(run);
      for (let i = 1; i < hits.length; i++){
        hits[i].cells.forEach(c => g.cells.add(c));
        g.runs.push(...hits[i].runs);
        groups.splice(groups.indexOf(hits[i]), 1);
      }
    }
    return groups;
  }

  function decideSpecial(g, prefer){
    const best = g.runs.reduce((a,b) => b.len > a.len ? b : a);
    const hasH = g.runs.some(r => r.dir === "h"), hasV = g.runs.some(r => r.dir === "v");
    let sp = null;
    if (best.len >= 5) sp = "rainbow";
    else if (hasH && hasV) sp = "bomb";
    else if (best.len === 4) sp = best.dir === "h" ? "row" : "col";
    if (!sp) return null;
    const pos = (prefer || []).find(p => g.cells.has(p)) || best.cells[Math.floor(best.len / 2)];
    return { pos, sp, type: g.runs[0].type };
  }

  function expandSpecials(clear){
    const queue = [...clear], seen = new Set();
    while (queue.length){
      const k = queue.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      const [r,c] = parse(k);
      const id = board[r] && board[r][c];
      if (!id) continue;
      const t = T(id);
      if (!t.special) continue;
      const add = [];
      if (t.special === "row"){ for (let cc = 0; cc < COLS; cc++) add.push(K(r,cc)); paint(r,c,"row"); }
      if (t.special === "col"){ for (let rr = 0; rr < ROWS; rr++) add.push(K(rr,c)); paint(r,c,"col"); }
      if (t.special === "bomb"){
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
          if (inBounds(r+dr, c+dc)) add.push(K(r+dr, c+dc));
        paint(r,c,"bomb");
      }
      if (t.special === "rainbow"){
        const ty = rnd(TYPES.length);
        for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++){
          const o = board[rr][cc]; if (o && T(o).type === ty) add.push(K(rr,cc));
        }
      }
      for (const a of add) if (!clear.has(a)){ clear.add(a); queue.push(a); }
    }
  }

  function paint(r, c, kind){
    const s = cellPx(), f = document.createElement("div");
    f.className = "flash";
    if (kind === "row"){ f.style.cssText += `left:0;top:${r*s + s*0.3}px;width:${COLS*s}px;height:${s*0.4}px`; }
    else if (kind === "col"){ f.style.cssText += `top:0;left:${c*s + s*0.3}px;height:${ROWS*s}px;width:${s*0.4}px`; }
    else { f.style.cssText += `left:${(c-1)*s}px;top:${(r-1)*s}px;width:${s*3}px;height:${s*3}px;border-radius:50%`; }
    boardEl.appendChild(f);
    setTimeout(() => f.remove(), 400);
  }

  const calmMotion = () => window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function shake(hard){
    if (calmMotion() || !frameEl) return;
    frameEl.classList.remove("shake", "shake-hard");
    void frameEl.offsetWidth;
    frameEl.classList.add("shake");
    if (hard) frameEl.classList.add("shake-hard");
    setTimeout(() => frameEl.classList.remove("shake", "shake-hard"), 1300);
  }

  function sparks(r, c, count, colour){
    if (calmMotion()) return;
    const s = cellPx();
    for (let i = 0; i < count; i++){
      const p = document.createElement("div");
      p.className = "spark";
      const angle = Math.random() * Math.PI * 2;
      const dist = s * (0.7 + Math.random() * 2.4);
      p.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      p.style.setProperty("--dy", Math.sin(angle) * dist + "px");
      p.style.left = (c * s + s / 2) + "px";
      p.style.top  = (r * s + s / 2) + "px";
      p.style.color = colour;
      p.style.background = colour;
      p.style.animationDelay = Math.round(Math.random() * 110) + "ms";
      boardEl.appendChild(p);
      setTimeout(() => p.remove(), 950);
    }
  }

  function shockwave(r, c, reach){
    if (calmMotion()) return;
    const s = cellPx();
    const w = document.createElement("div");
    w.className = "shockwave";
    w.style.setProperty("--reach", reach * s + "px");
    w.style.left = (c * s + s / 2) + "px";
    w.style.top  = (r * s + s / 2) + "px";
    boardEl.appendChild(w);
    setTimeout(() => w.remove(), 620);
  }

  /* every combination gets its own sound and its own shape of blast, so the
     good ones feel different rather than just scoring more */
  const sparkColour = type => (TYPES[type] && TYPES[type].spark) || "#ffe9a8";

  function comboFx(kind, t){
    const gold = "#ffe9a8", teal = "#8ff0e4", rose = "#ffb4b4";
    if (kind === "cross"){
      chord([520, 780], .3, "triangle", .15);
      shockwave(t.r, t.c, 6); sparks(t.r, t.c, 16, gold); shake(false);
    } else if (kind === "band"){
      chord([440, 660, 880], .32, "triangle", .15);
      shockwave(t.r, t.c, 8); sparks(t.r, t.c, 26, teal); shake(false);
    } else if (kind === "mega"){
      boom(); chord([180, 240], .5, "sawtooth", .12);
      shockwave(t.r, t.c, 9); sparks(t.r, t.c, 34, rose); shake(true);
    } else if (kind === "orb-line" || kind === "orb-bomb"){
      sweep(400, 1800, .7); chord([660, 880, 1170], .45, "sine", .13);
      shockwave(t.r, t.c, 12); sparks(t.r, t.c, 30, gold); shake(true);
    } else if (kind === "board"){
      boom(); chord([262, 392, 523, 784], .8, "sine", .16);
      shockwave(t.r, t.c, 16); sparks(t.r, t.c, 46, gold); shake(true);
    }
    if (window.RuneMusic) RuneMusic.duck(kind === "board" ? 2200 : 1300);
  }

  function floatPts(r, c, text){
    const s = cellPx(), p = document.createElement("div");
    p.className = "pts"; p.textContent = text;
    p.style.left = (c * s + s / 2) + "px";
    p.style.top  = (r * s + s / 2) + "px";
    boardEl.appendChild(p);
    setTimeout(() => p.remove(), 850);
  }

  /* ---------------- gravity ---------------- */
  function collapse(){
    for (let c = 0; c < COLS; c++){
      // the column's cells, top and bottom. Guaranteed unbroken by the mask rule.
      let top = -1, bottom = -1;
      for (let r = 0; r < ROWS; r++) if (mask[r][c]){ if (top < 0) top = r; bottom = r; }
      if (top < 0) continue;                       // column is entirely hole

      let write = bottom;
      for (let r = bottom; r >= top; r--){
        if (board[r][c]){
          if (write !== r){ board[write][c] = board[r][c]; board[r][c] = null; }
          write--;
        }
      }
      let above = top - 1;
      for (let r = write; r >= top; r--){
        const t = makeTile(rnd(TYPES.length));
        t.r = above--; t.c = c;
        place(t, false);
        board[r][c] = t.id;
      }
    }
    syncPositions(true);
  }

  /* ---------------- resolving ---------------- */
  async function resolve(prefer){
    let combo = 0;
    while (true){
      const groups = findGroups();
      if (!groups.length) break;
      combo++;

      const clear = new Set(), spawns = [];
      for (const g of groups){
        g.cells.forEach(c => clear.add(c));
        const s = decideSpecial(g, prefer);
        if (s) spawns.push(s);
      }
      prefer = null;
      expandSpecials(clear);
      for (const s of spawns) clear.delete(s.pos);
      if (!clear.size && !spawns.length) break;

      const gained = clear.size * PAY_TILE * combo;
      addScore(gained);
      blip(420 + combo * 90, .1, "triangle");
      noteChain(clear.size, combo);
      if (clear.size){
        const first = parse([...clear][0]);
        floatPts(first[0], first[1], "+" + gained);
      }

      let chipped = 0;
      for (const k of clear){
        const [r,c] = parse(k);
        if (chipBlocker(r,c)) chipped++;
        const id = board[r][c]; if (!id) continue;
        const t = T(id);
        const goal = goals.find(g => g.kind === "collect" && g.type === t.type);
        if (goal && goal.have < goal.need) goal.have++;
        t.el.classList.add("pop");
      }
      if (chipped) addScore(chipped * PAY_CHIP);
      refreshGoals();

      await sleep(250);
      for (const k of clear){
        const [r,c] = parse(k);
        const id = board[r][c]; if (!id) continue;
        destroy(T(id));
        board[r][c] = null;
      }
      for (const s of spawns){
        const [r,c] = parse(s.pos);
        const id = board[r][c];
        if (!id) continue;
        const t = T(id);
        t.special = s.sp;
        if (s.sp === "rainbow") t.type = -1;
        repaint(t);
        blip(880, .16, "sine", .2);
        tip("rune");
      }

      collapse();
      await sleep(290);
      if (runesOnBoard() >= 2) tip("combine");
    }
    return combo;
  }

  function runesOnBoard(){
    let n = 0;
    tiles.forEach(t => { if (t.special) n++; });
    return n;
  }

  /* ---------------- moves ---------------- */
  function findMove(){
    const swap = (a,b) => { const t = board[a[0]][a[1]]; board[a[0]][a[1]] = board[b[0]][b[1]]; board[b[0]][b[1]] = t; };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
      const id = board[r][c];
      if (!id || isLocked(r,c)) continue;
      if (id && T(id).special === "rainbow"){
        const nc = c < COLS-1 ? c+1 : c-1;
        if (!isLocked(r,nc)) return [K(r,c), K(r,nc)];
      }
      for (const [dr,dc] of [[0,1],[1,0]]){
        const r2 = r + dr, c2 = c + dc;
        if (!playable(r2,c2) || isLocked(r2,c2)) continue;
        // two runes side by side always combine, match or no match
        if (id && board[r2][c2] && T(id).special && T(board[r2][c2]).special)
          return [K(r,c), K(r2,c2)];
        swap([r,c],[r2,c2]);
        const ok = findRuns().length > 0;
        swap([r,c],[r2,c2]);
        if (ok) return [K(r,c), K(r2,c2)];
      }
    }
    return null;
  }

  async function shuffleBoard(){
    // redeal into the cells that already hold tiles; holes must stay holes or
    // gravity loses the unbroken column runs it depends on
    const spots = [], list = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
      if (!mask[r][c] || !board[r][c]) continue;
      spots.push([r,c]); list.push(board[r][c]);
    }
    let guard = 0;
    do {
      for (let i = list.length - 1; i > 0; i--){ const j = rnd(i+1); [list[i],list[j]] = [list[j],list[i]]; }
      spots.forEach(([r,c], i) => { board[r][c] = list[i]; });
    } while ((findRuns().length || !findMove()) && ++guard < 200);
    syncPositions(true);
    await sleep(320);
  }

  /* ---------------- quests ---------------- */
  /* Obstacles run in bands of ten, so each stretch of the game has its own
     character rather than piling everything on at once. Within a band the
     count climbs with the quest number; past quest 50 the bands repeat with
     the intensity of the last one. */
  /* ---------------- board shapes ----------------
     A shape is a mask over the 8x8 grid: # is a cell, . is a hole.

     One rule governs every mask: each column's cells must be one unbroken run.
     Gravity drops tiles down a column and refills from the top, so a hole part
     way down a column would cut it in two and the lower half could never be
     refilled — it would empty out and the stage would die. test/features.js
     checks this for every shape. */
  const SHAPES = {
    square: [
      "########","########","########","########",
      "########","########","########","########"],
    pentagon: [
      "...##...","..####..",".######.","########",
      "########","########","########","########"],
    octagon: [
      "..####..",".######.","########","########",
      "########","########",".######.","..####.."],
    trapezoid: [
      "..####..","..####..",".######.",".######.",
      "########","########","########","########"],
    hexagon: [
      ".######.","########","########","########",
      "########","########","########",".######."],
    rhombus: [
      "...#####","...#####","..#####.","..#####.",
      ".#####..",".#####..","#####...","#####..."],
    decagon: [
      "...##...",".######.","########","########",
      "########","########",".######.","...##..."],
    cross: [
      "..####..","..####..","########","########",
      "########","########","..####..","..####.."],
    diamond: [
      "...##...","..####..",".######.","########",
      "########",".######.","..####..","...##..."]
  };

  let mask = SHAPES.square.map(row => row.split("").map(ch => ch === "#"));
  let cellCount = 64;
  const playable = (r,c) => inBounds(r,c) && mask[r][c];

  function setShape(name){
    const rows = SHAPES[name] || SHAPES.square;
    mask = rows.map(row => row.split("").map(ch => ch === "#"));
    cellCount = mask.flat().filter(Boolean).length;
    boardEl.dataset.shape = name;
    drawCells();
  }

  /* one socket per playable cell — also what makes the holes visible */
  function drawCells(){
    const s = cellPx();
    cellsEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
      if (!mask[r][c]) continue;
      const d = document.createElement("i");
      d.className = "cell" + ((r + c) % 2 ? " alt" : "");
      d.style.transform = `translate3d(${c*s}px, ${r*s}px, 0)`;
      cellsEl.appendChild(d);
    }
  }

  const REGIONS = [
    { from:  1, name:"Snowy Days",          kinds:["frost"],                      music:"frost",       shape:"square",    art:0 },
    { from: 11, name:"Thorny Forest",       kinds:["bramble"],                    music:"bramble",     shape:"pentagon",  art:1 },
    { from: 21, name:"Moving Jungle",       kinds:["creeper"], fast:true,         music:"vine",        shape:"octagon",   art:2 },
    { from: 31, name:"Tricky Alps",         kinds:["frost","bramble"],            music:"alps",        shape:"trapezoid", art:3 },
    { from: 41, name:"Deadly White Plains", kinds:["frost","creeper"], fast:true, music:"plains",      shape:"hexagon",   art:4 },
    { from: 51, name:"Endless Desert",      kinds:["frost","sandpit"],            music:"desert",      shape:"rhombus",   art:5 },
    { from: 61, name:"Drunken Oasis",       kinds:["bramble","sandpit"],          music:"oasis",       shape:"decagon",   art:6 },
    { from: 71, name:"The Labyrinth",       kinds:["sandpit","creeper"], fast:true, music:"labyrinth", shape:"cross",     art:7 },
    { from: 81, name:"Doors of Svartalheim",kinds:["frost","creeper","sandpit"], fast:true, music:"svartalheim", shape:"diamond", art:8 }
  ];
  const LAST_STAGE = 90;                       // past here the regions repeat

  function bandFor(n){
    const wrapped = n > LAST_STAGE ? ((n - 1) % LAST_STAGE) + 1 : n;
    let band = REGIONS[0];
    for (const b of REGIONS) if (wrapped >= b.from) band = b;
    return { band, step: wrapped - band.from, wrapped };   // step is 0..9
  }
  const regionOf = n => bandFor(n).band;

  function obstaclesFor(n){
    const { band, step } = bandFor(n);
    const has = k => band.kinds.includes(k);
    const many = band.kinds.length;                  // share the load when mixed
    const ramp = (base, per, cap) => Math.min(cap, base + Math.floor(step / per));

    const plan = { frost:0, frostHp:1, bramble:0, creeper:0, creeperEvery:0,
                   sandpit:0, sandEvery:0 };

    const fit = k => Math.max(1, Math.round(k * boardShare(n)));
    if (has("frost"))   plan.frost   = fit(ramp(2, many > 1 ? 4 : 3, many > 2 ? 3 : many > 1 ? 4 : 5));
    if (has("bramble")) plan.bramble = fit(ramp(1, many > 1 ? 5 : 4, many > 1 ? 2 : 3));
    if (has("creeper")){
      plan.creeper = fit(ramp(1, 4, many > 2 ? 2 : many > 1 ? 2 : 3));
      const base = band.fast ? 9000 : 15000;
      plan.creeperEvery = Math.max(band.fast ? 5000 : 8000, base - step * 400);
    }
    if (has("sandpit")){
      plan.sandpit = fit(ramp(1, 4, many > 2 ? 2 : 3));
      // how long a held rune charge survives before the sand takes it
      plan.sandEvery = Math.max(9000, 20000 - step * 900);
    }
    return plan;
  }

  /* Quest shapes by number:
       1–2    collect one colour on a clean board
       3+     frost appears — two chips each, clear it by matching on top of it
       5,10…  a score quest replaces the collect goal
       6+     bramble appears — locks its cell until something clears it        */
  function questFor(n){
    const pool = [...TYPES.keys()];
    for (let i = pool.length - 1; i > 0; i--){ const j = (n * 7 + i * 13) % (i + 1); [pool[i],pool[j]] = [pool[j],pool[i]]; }

    /* Counts are set from test/balance.js runs: a bot that always takes the
       first legal move should come close to clearing them, so a person who
       actually aims at the blockers clears them with room to spare. */
    const plan = obstaclesFor(n);
    // creeper is the only obstacle left out: it spreads, so counting it would
    // make the target move while you chase it
    const blockerCount = plan.frost + plan.bramble + plan.sandpit;
    const isScoreQuest = n >= 5 && n % 5 === 0;
    const moves = Math.max(18, 30 - Math.floor((n - 1) / 2));

    const goals = [];
    if (isScoreQuest){
      goals.push({ kind:"score", need: scoreTargetFor(moves, n), have: 0 });
    } else {
      const count = Math.min(3, 1 + Math.floor((n - 1) / 2));
      /* With six colours, only about one cleared tile in six matches any given
         goal, and a move clears ~4.5 tiles. So one colour yields roughly
         moves × 0.75 over a whole quest — asking for more than that is asking
         for something the board cannot produce. Difficulty comes from the
         colour count, the shrinking clock and the blockers, not from a number
         that outgrows the board. See test/balance.js. */
      const pressure = Math.min(0.95, 0.72 + (n - 1) * 0.015);
      // a smaller board yields fewer tiles per move, so the goal follows it down
      const need = Math.max(8, Math.round(moves * 0.75 * pressure * boardShare(n)));
      pool.slice(0, count).forEach(t => goals.push({ kind:"collect", type:t, need, have:0 }));
    }
    if (blockerCount) goals.push({ kind:"blockers", need: blockerCount, have: 0 });

    const q = { kind: isScoreQuest ? "score" : "collect", moves, plan, goals };
    q.seconds = timeFor(q, n);
    return q;
  }

  /* Derived from the move budget rather than the quest number: test/balance.js
     shows a bot that aims at objectives but plans no cascades averages roughly
     300 zeny a move, so 220 leaves headroom for an unlucky board. */
  function scoreTargetFor(moves, n){
    return Math.round(moves * 45 * boardShare(n) / 10) * 10;
  }

  /* How much a region's shape should soften its goals.
     Not the plain cell ratio: measured play shows a narrower board cascades
     more than its cell count suggests, because short columns refill into each
     other. Scaling goals straight down by cells made the small shapes clear in
     a third of their move budget. The square root sits between "no adjustment"
     and "proportional" and matches what the bot actually manages. */
  function boardShare(n){
    const rows = SHAPES[regionOf(n).shape] || SHAPES.square;
    const cells = rows.join("").split("").filter(ch => ch === "#").length;
    return Math.sqrt(cells / (ROWS * COLS));
  }

  // more to do means more time, but every quest tightens the belt a little
  function timeFor(q, n){
    const collect = q.goals.filter(g => g.kind === "collect").reduce((s,g) => s + g.need, 0);
    const chips   = q.plan.frost * q.plan.frostHp + q.plan.bramble + q.plan.creeper * 2;
    const points  = q.goals.filter(g => g.kind === "score").reduce((s,g) => s + g.need, 0);
    const work = collect + chips * 3 + points / 150;
    const base = 45 + work * 1.9;
    const squeeze = Math.max(0.72, 1 - (n - 1) * 0.018);
    const raw = Math.min(TIME_CEIL, Math.max(TIME_FLOOR, base * squeeze));
    return Math.round(raw / 5) * 5;
  }

  const GOAL_ICON = {
    blockers: `<svg viewBox="0 0 100 100" aria-hidden="true">
      <rect x="8" y="8" width="84" height="84" rx="13" fill="rgba(150,215,255,.34)"
            stroke="rgba(205,242,255,.85)" stroke-width="5"/>
      <path d="M28 34 L54 58 L38 78" stroke="rgba(235,250,255,.95)" stroke-width="6"
            fill="none" stroke-linecap="round"/></svg>`,
    score: `<span class="goal-art">${art("amber")}</span>`
  };

  function goalRow(g, plain){
    const done = !plain && g.have >= g.need;
    const icon = g.kind === "collect"
      ? `<span class="goal-art">${art(TYPES[g.type].key)}</span>`
      : GOAL_ICON[g.kind];
    const num = v => g.kind === "score" ? v.toLocaleString() : v;
    const label = plain ? num(g.need) : num(Math.min(g.have, g.need)) + "/" + num(g.need);
    return `<div class="goal${done ? " done" : ""}">
      ${icon}
      <div class="bar"><i style="width:${plain ? 0 : Math.min(100, g.have / g.need * 100)}%"></i></div>
      <b>${label}</b>
    </div>`;
  }

  // blockers and score are read off the board rather than tallied as they happen
  function refreshGoals(){
    for (const g of goals){
      if (g.kind === "blockers") g.have = g.need - blockersLeft();
      if (g.kind === "score")    g.have = Math.max(0, score - scoreAtStart);
    }
    drawGoals();
  }
  function drawGoals(){ goalsEl.innerHTML = goals.map(g => goalRow(g)).join(""); }

  function addScore(n){
    score = Math.max(0, score + n);
    scoreEl.textContent = score.toLocaleString();
  }

  /* ---------------- timer ---------------- */
  function renderTimer(){
    clockEl.textContent = clock(Math.ceil(timeLeft));
    barEl.style.width = (timeTotal ? Math.max(0, timeLeft / timeTotal * 100) : 0) + "%";
    timerEl.classList.toggle("warn", timeTotal > 0 && timeLeft / timeTotal <= 0.2);
  }
  function startTimer(sec){
    timeTotal = sec; timeLeft = sec;
    renderTimer();
    resumeTimer();
  }
  function pauseTimer(){
    if (!ticker) return;
    clearInterval(ticker); ticker = null;
    timeLeft = Math.max(0, (deadline - performance.now()) / 1000);
  }
  function resumeTimer(){
    if (ticker || !started || locked || timeLeft <= 0) return;
    deadline = performance.now() + timeLeft * 1000;
    ticker = setInterval(() => {
      timeLeft = Math.max(0, (deadline - performance.now()) / 1000);
      renderTimer();
      if (timeLeft <= 0){ pauseTimer(); onTimeout(); }
      else if (timeLeft <= 5.2 && Math.ceil(timeLeft) !== Math.ceil(timeLeft + 0.2)) blip(300, .07, "square", .1);
    }, 200);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseTimer();
    else if (!busy && started && !locked) resumeTimer();
  });

  /* ---------------- charges ---------------- */
  const RUNE_LABEL = { row: "row rune", col: "column rune", bomb: "blast rune" };

  function renderCharges(){
    chargeBtn.innerHTML = `Place ${RUNE_LABEL[chargeRune]} <b>×${charges}</b>`;
    chargeBtn.disabled = charges <= 0;
    pickerEl.hidden = charges <= 0;
    if (charges <= 0 && armed) disarm();
  }

  pickerEl.querySelectorAll(".pick").forEach(btn => {
    btn.onclick = () => {
      chargeRune = btn.dataset.rune;
      pickerEl.querySelectorAll(".pick").forEach(b => b.classList.toggle("is-on", b === btn));
      renderCharges();
      blip(620, .06, "sine", .1);
    };
  });
  function disarm(){
    armed = false;
    chargeBtn.classList.remove("armed");
    boardEl.classList.remove("arming");
  }
  chargeBtn.onclick = () => {
    if (busy || !started || locked || charges <= 0) return;
    armed = !armed;
    chargeBtn.classList.toggle("armed", armed);
    boardEl.classList.toggle("arming", armed);
    blip(armed ? 760 : 380, .07, "sine", .12);
  };
  function placeCharge(k){
    const t = tileAt(k);
    if (!t || t.special === "rainbow") return;
    if (isLocked(t.r, t.c)){ blip(150, .1, "sawtooth", .07); return; }
    charges--;
    tel("count", "placed");
    t.special = chargeRune;
    repaint(t);
    sparks(t.r, t.c, 10, "#ffe9a8");
    t.el.classList.remove("forge"); void t.el.offsetWidth;
    t.el.classList.add("forge");
    disarm();
    renderCharges();
    blip(980, .2, "sine", .2);
  }

  /* ---------------- lives ---------------- */
  function renderLives(snap){
    heartsEl.innerHTML = Array.from({ length: snap.max }, (_, i) => heartMarkup(i < snap.lives)).join("");
    regenEl.textContent = snap.lives >= snap.max
      ? "Full"
      : "+1 in " + clock(snap.msToNext / 1000);
    if (locked) updateLockout(snap);
  }
  Lives.subscribe(renderLives);

  function updateLockout(snap){
    if (snap.lives > 0){
      veilTitle.textContent = "A life returned";
      veilText.textContent = "You're back in. The quest starts over from the beginning.";
      veilTally.innerHTML = `Zeny <b>${score.toLocaleString()}</b>`;
      veilTally.hidden = false;
      veilBtn.hidden = false;
      veilBtn.textContent = "Back to the field";
      veilBtn.onclick = () => { locked = false; veil.hidden = true; restartQuest(); };
      return;
    }
    veilTally.innerHTML = `Next life in <b>${clock(snap.msToNext / 1000)}</b>`;
  }

  function showLockout(){
    locked = true;
    busy = true;
    pauseTimer();
    const snap = Lives.get();
    veilTitle.textContent = "Out of lives";
    veilText.textContent = "The slimes hold the field until your strength returns. One life comes back every 30 minutes.";
    veilTally.hidden = false;
    veilTally.innerHTML = `Next life in <b>${clock(snap.msToNext / 1000)}</b>`;
    veilBtn.hidden = true;
    veil.hidden = false;
    blip(180, .5, "sawtooth", .12);
  }

  /* ---------------- warp ---------------- */
  async function warp(summaryHTML, questHTML){
    sweep(220, 1400, .9);
    if (window.RuneMusic) RuneMusic.duck(2500);
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    tiles.forEach(t => {
      const d = Math.hypot(t.c - cx, t.r - cy);
      t.el.style.animationDelay = Math.round(d * 34) + "ms";
      t.el.classList.add("warp-out");
    });
    await sleep(760);

    warpBody.innerHTML = summaryHTML;
    warpEl.hidden = false;
    await sleep(2000);

    warpBody.classList.add("swap");
    await sleep(160);
    warpBody.innerHTML = questHTML;
    warpBody.classList.remove("swap");
    sweep(600, 180, .5);

    /* Wait for the player rather than pushing them into the next stage. The
       clock is stopped here, so there is no cost to taking a breath. */
    const go = warpBody.querySelector("#warpGo");
    if (go){
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done){ done = true; resolve(); } };
        go.onclick = finish;
        document.addEventListener("keydown", function once(e){
          if (e.key === "Enter" || e.key === " "){
            document.removeEventListener("keydown", once);
            finish();
          }
        });
      });
    } else {
      await sleep(1900);
    }

    warpEl.hidden = true;
  }

  /* ---------------- stage flow ---------------- */
  /* ---------------- sand pit ----------------
     It doesn't spread and it doesn't block much on its own. What it does is
     eat a rune charge you are sitting on: hold one too long with a pit open
     and the sand takes it. Spend your charges or lose them. */
  let sandTimer = null, sandEvery = 0;

  function stopSand(){
    clearTimeout(sandTimer);
    sandTimer = null;
  }

  function armSand(){
    stopSand();
    if (!sandEvery || !started || locked || !sandpitsLeft()) return;
    sandTimer = setTimeout(swallowCharge, sandEvery);
  }

  function swallowCharge(){
    sandTimer = null;
    if (busy || locked || !started || !veil.hidden || !shopEl.hidden){ armSand(); return; }
    if (!sandpitsLeft()) return;

    if (charges > 0){
      charges--;
      renderCharges();
      announce("The sand takes a rune", 1200, true);
      tel("count", "swallowed");
      const pit = firstSandpit();
      if (pit){ sparks(pit[0], pit[1], 16, "#e8c07a"); shake(false); }
      if (!sample("blocker-sandpit", 1)) blip(160, .4, "sawtooth", .13);
    }
    armSand();
  }

  function firstSandpit(){
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (blockers[r][c] && blockers[r][c].kind === "sandpit") return [r,c];
    return null;
  }

  function stopCreeper(){
    clearTimeout(creeperTimer);
    creeperTimer = null;
    creeperEvery = 0;
  }
  function stopHazards(){ stopCreeper(); stopSand(); sandEvery = 0; }

  function startLevel(n, entrance){
    stopHazards();
    hideTip();
    level = n;
    const q = questFor(n);
    goals = q.goals;
    questKind = q.kind;
    stagePlan = q.plan;
    movesLeft = q.moves;
    scoreAtStart = score;          // score goals measure this quest, not the wallet
    continues = 0;
    const { band, step, wrapped } = bandFor(n);
    setShape(band.shape || "square");
    frameEl.dataset.art = band.art === undefined ? "" : band.art;
    questEl.textContent = band.name;
    stageEl.textContent = wrapped === n
      ? `Stage ${n} · ${step + 1} of 10`
      : `Stage ${n} · ${band.name} again`;
    movesEl.textContent = movesLeft;
    movesEl.classList.remove("low");
    renderCharges();
    buildBoard(entrance);
    refreshGoals();
    fit();
    selected = null;
    disarm();
    startTimer(q.seconds);
    if (window.RuneMusic){
      RuneMusic.setStage(band.music || "");
    }
    tel("begin", {
      stage: n, region: band.name, lap: Math.floor((n - 1) / LAST_STAGE) + 1,
      kind: q.kind, moves: q.moves, seconds: q.seconds,
      blockers: blockerTotal, charges, zeny: score
    });
    busy = false;
    saveProgress();
    scheduleHint();

    // introduce whatever this quest is the first to contain
    setTimeout(() => {
      tip("basics");
      if (q.plan.frost)   tip("frost");
      if (q.plan.bramble) tip("bramble");
      if (q.plan.creeper) tip("creeper");
      if (q.plan.sandpit) tip("sandpit");
      if (q.kind === "score") tip("score");
      if (charges > 0)    tip("charge");
    }, 700);
  }

  /* what the telemetry record needs at the moment a stage ends */
  function stageSnapshot(){
    return {
      movesLeft, secondsLeft: timeLeft, zeny: score,
      goals: goals.map(g => ({ kind: g.kind, need: g.need, have: g.have })),
      lives: (() => { try { return Lives.get().lives; } catch (e){ return null; } })()
    };
  }

  function saveProgress(){
    try {
      Progress.save({ level, zeny: score, charges, seen: seenTips,
                      sfxOff: muted, bgmOff: musicOff });
    } catch (e){}
  }
  const saveSettings = saveProgress;
  window.addEventListener("pagehide", saveProgress);
  window.addEventListener("beforeunload", saveProgress);

  function restartQuest(){
    clearHint();
    veil.hidden = true;
    veilBtn.hidden = false;
    veilAlt.hidden = true;
    startLevel(level, false);
  }

  const questDone = () => goals.every(g => g.have >= g.need);

  function speedTier(ratio){
    if (ratio >= 0.5) return { name:"Swift", mult: 2 };
    if (ratio >= 0.25) return { name:"Steady", mult: 1.5 };
    return { name:"Narrow", mult: 1.15 };
  }

  async function completeQuest(){
    busy = true;
    hideTip();
    pauseTimer();
    stopHazards();
    clearHint();
    disarm();
    markSelected(null);

    const remain = Math.floor(timeLeft);
    const ratio = timeTotal ? timeLeft / timeTotal : 0;
    const tier = speedTier(ratio);
    const timeBonus = Math.round(remain * (4 + level) * tier.mult);

    const earned = movesLeft > 0
      ? Math.min(CHARGES_PER_QUEST, Math.max(1, Math.floor(movesLeft / MOVES_PER_CHARGE)))
      : 0;
    const before = charges;
    charges = Math.min(MAX_CHARGES, charges + earned);
    const kept = charges - before;

    addScore(timeBonus);
    tel("count", "earned", kept);
    tel("end", "cleared", stageSnapshot());
    blip(660, .12, "sine", .2); setTimeout(() => blip(880, .2, "sine", .2), 130);

    const summary = `
      <p class="kicker">Quest ${level} cleared</p>
      <h3>${tier.name} clear</h3>
      <dl class="ledger">
        <div><dt>Time left</dt><dd>${clock(remain)}</dd></div>
        <div><dt>Speed bonus ×${tier.mult}</dt><dd>+${timeBonus.toLocaleString()}</dd></div>
        <div><dt>${movesLeft} unused ${movesLeft === 1 ? "move" : "moves"}</dt><dd>${kept ? "+" + kept + " rune charge" + (kept === 1 ? "" : "s") : "no charge"}</dd></div>
      </dl>`;

    const next = questFor(level + 1);
    const nextBand = bandFor(level + 1);
    const arriving = nextBand.band !== bandFor(level).band;
    const quest = `
      <p class="kicker">${arriving ? "Now entering" : "Warping to"}</p>
      <h3>${arriving ? nextBand.band.name : "Stage " + (level + 1)}</h3>
      ${arriving ? `<p class="warp-meta">Stage ${level + 1} · first of ten</p>` : ""}
      <div class="warp-goals">${next.goals.map(g => goalRow(g, true)).join("")}</div>
      <p class="warp-meta">${next.moves} moves · ${clock(next.seconds)} on the clock${
        next.plan.frost + next.plan.bramble + next.plan.sandpit
          ? ` · ${next.plan.frost + next.plan.bramble + next.plan.sandpit} blockers` : ""}${
        charges ? ` · ${charges} rune charge${charges === 1 ? "" : "s"} carried` : ""}</p>
      <button class="btn gold warp-go" id="warpGo">Continue</button>`;

    await warp(summary, quest);
    startLevel(level + 1, true);
  }

  const continueCost = () => CONTINUE_BASE * Math.pow(2, continues);

  const FAIL_COPY = {
    time:  ["The hourglass ran out", "Quest " + "%L" + " beat the clock."],
    moves: ["Out of moves", "The slimes held the field."],
    quit:  ["Quest abandoned", "Walking away costs a life, same as losing."]
  };

  /* Failure funnels through here. If the player can afford a continue they get
     the choice first; a life is only spent once they decline or can't pay. */
  function stageFailed(reason){
    if (locked) return;
    busy = true;
    pauseTimer();
    clearHint();
    disarm();
    markSelected(null);

    if (reason !== "quit" && score >= continueCost()) return offerContinue(reason);
    return loseLife(reason);
  }

  function offerContinue(reason){
    const cost = continueCost();
    const buys = reason === "time"
      ? "+" + CONTINUE_SECONDS + " seconds"
      : "+" + CONTINUE_MOVES + " moves";
    const [title] = FAIL_COPY[reason];
    veilTitle.textContent = title;
    veilText.textContent = "You can spend zeny to stay in quest " + level + ", or give up and lose a life.";
    veilTally.hidden = false;
    veilTally.innerHTML = `Zeny <b>${score.toLocaleString()}</b>`;
    veilBtn.hidden = false;
    veilBtn.className = "btn gold";
    veilBtn.textContent = `${buys} for ${cost.toLocaleString()} zeny`;
    veilBtn.onclick = () => buyContinue(reason);
    veilAlt.hidden = false;
    veilAlt.textContent = "Give up (costs a life)";
    veilAlt.onclick = () => loseLife("quit");
    veil.hidden = false;
    blip(520, .12, "sine", .14);
  }

  function buyContinue(reason){
    const cost = continueCost();
    if (score < cost) return;
    addScore(-cost);
    continues++;                    // each continue in the same quest costs double
    tel("count", "continues");
    veil.hidden = true;
    veilAlt.hidden = true;
    if (reason === "time"){
      timeLeft += CONTINUE_SECONDS;
      timeTotal += CONTINUE_SECONDS;
      renderTimer();
    } else {
      movesLeft += CONTINUE_MOVES;
      movesEl.textContent = movesLeft;
      movesEl.classList.remove("low");
    }
    refreshGoals();
    saveProgress();
    busy = false;
    resumeTimer();
    scheduleHint();
    blip(900, .22, "sine", .2);
  }

  async function loseLife(reason){
    busy = true;
    pauseTimer();
    stopHazards();
    tel("end", reason, stageSnapshot());    // "time", "moves" or "quit"
    charges = 0;
    renderCharges();

    const snap = await Lives.spend();
    saveProgress();
    if (snap.lives <= 0){ showLockout(); return; }

    const [title, body] = FAIL_COPY[reason] || FAIL_COPY.quit;
    veilTitle.textContent = title;
    veilText.textContent = body.replace("%L", level) + " The quest restarts from the top — your zeny is safe.";
    veilTally.hidden = false;
    veilTally.innerHTML = `Zeny <b>${score.toLocaleString()}</b> · ${snap.lives} ${snap.lives === 1 ? "life" : "lives"} left`;
    veilAlt.hidden = true;
    veilBtn.hidden = false;
    veilBtn.className = "btn gold";
    veilBtn.textContent = "Try again";
    veilBtn.onclick = () => restartQuest();
    veil.hidden = false;
  }

  function onTimeout(){
    if (busy || locked) return;
    blip(200, .4, "sawtooth", .12);
    stageFailed("time");
  }

  function showVeil(title, text, tally, btn){
    veilTitle.textContent = title;
    veilText.textContent = text;
    veilTally.hidden = !tally;
    veilTally.innerHTML = tally || "";
    veilBtn.hidden = false;
    veilBtn.textContent = btn;
    veil.hidden = false;
  }

  /* ---------------- interaction ---------------- */
  function tileAt(k){ const [r,c] = parse(k); return board[r][c] ? T(board[r][c]) : null; }
  function markSelected(k){
    document.querySelectorAll(".tile.sel").forEach(e => e.classList.remove("sel"));
    selected = k;
    if (k){ const t = tileAt(k); if (t) t.el.classList.add("sel"); }
  }
  const adjacent = (a,b) => {
    const [r1,c1] = parse(a), [r2,c2] = parse(b);
    return Math.abs(r1-r2) + Math.abs(c1-c2) === 1;
  };
  function swapCells(a,b){
    const [r1,c1] = parse(a), [r2,c2] = parse(b);
    const t = board[r1][c1]; board[r1][c1] = board[r2][c2]; board[r2][c2] = t;
  }

  /* ---------------- onboarding ----------------
     Each system is explained the first time the player actually meets it,
     once ever, and the explanation is stored with their progress. The help
     overlay repeats all of it on demand, because the legend is hidden on
     phones and a tip you missed is otherwise gone for good. */
  const TIPS = {
    basics:  ["Line up three", "Tap a slime, then tap a neighbour to swap them. Three or more of a colour pops."],
    rune:    ["You made a rune", "Bigger matches leave runes. Match one to set it off."],
    combine: ["Two runes, one blast", "Swap two runes into each other and they combine into something much bigger."],
    frost:   ["Frost", "The pale tiles are frost. Clear a match on top of one to chip it away."],
    bramble: ["Bramble", "A bramble tile can't be swapped. Work a match into it from around the side."],
    sandpit: ["Sand pit", "It locks its tile, and it eats rune charges you hold on to. Spend them before the sand takes one — or clear every pit to stop it."],
    creeper: ["The vine is growing", "It spreads to a new tile every few seconds and locks whatever it covers. Cut it back by matching on it — clear it all and it stops for good."],
    score:   ["A different quest", "This one wants zeny, not colours. Big cascades and rune combinations pay best."],
    charge:  ["Carried runes", "Spare moves became rune charges. Pick a rune below, then tap any slime to place it."]
  };

  /* Tips queue rather than overwrite. Quest 1 introduces both the basics and
     frost, and without a queue the second would replace the first before it
     could be read — and both would be marked as seen. */
  let tipTimer = null, tipQueue = [];

  function tip(id){
    if (!TIPS[id] || seenTips.includes(id) || tipQueue.includes(id) || locked) return;
    tipQueue.push(id);
    if (tipEl.hidden) nextTip();
  }

  function nextTip(){
    clearTimeout(tipTimer);
    const id = tipQueue.shift();
    if (!id){ tipEl.hidden = true; return; }
    seenTips.push(id);                  // only marked once it is actually shown
    saveProgress();
    const [title, body] = TIPS[id];
    const more = tipQueue.length ? `<small>Tap for the next one</small>`
                                 : `<small>Tap to dismiss</small>`;
    tipEl.innerHTML = `<b>${title}</b>${body}${more}`;
    tipEl.hidden = false;
    tipTimer = setTimeout(nextTip, 7000);
  }

  function hideTip(){
    clearTimeout(tipTimer);
    tipQueue = [];
    tipEl.hidden = true;
  }
  tipEl.onclick = nextTip;              // tap moves on rather than losing the rest

  /* ---------------- zeny shop ----------------
     The sink that makes a scarce currency mean something. Everything here is
     bought mid-quest and applied immediately; nothing carries a subscription
     or a timer of its own. */
  const SHOP = [
    { id:"moves", name:"Five more moves", cost:260, art:null, coin:"+5",
      blurb:"Added to the quest you're on.",
      can: () => started && !locked,
      buy: () => { movesLeft += 5; movesEl.textContent = movesLeft; movesEl.classList.remove("low"); } },

    { id:"time", name:"Thirty more seconds", cost:300, art:null, coin:"+30",
      blurb:"Added to the clock straight away.",
      can: () => started && !locked && timeTotal > 0,
      buy: () => { timeLeft += 30; timeTotal += 30; renderTimer(); } },

    { id:"row", name:"Row rune", cost:420, art:"row",
      blurb:"A charge you place on any slime.",
      can: () => charges < MAX_CHARGES,
      buy: () => { charges++; renderCharges(); } },

    { id:"col", name:"Column rune", cost:420, art:"col",
      blurb:"A charge you place on any slime.",
      can: () => charges < MAX_CHARGES,
      buy: () => { charges++; renderCharges(); } },

    { id:"bomb", name:"Blast rune", cost:520, art:"bomb",
      blurb:"A charge you place on any slime.",
      can: () => charges < MAX_CHARGES,
      buy: () => { charges++; renderCharges(); } },

    { id:"life", name:"One life", cost:1400, art:null, coin:"♥",
      blurb:"Only when you're below five.",
      can: () => Lives.get().lives < Lives.MAX,
      buy: () => { Lives.grant(1); } }
  ];

  function drawShop(){
    shopPurse.textContent = score.toLocaleString();
    shopList.innerHTML = SHOP.map(item => {
      const afford = score >= item.cost;
      const allowed = item.can();
      const icon = item.art ? `<i class="art art-${item.art}"></i>`
                            : `<span class="coin">${item.coin}</span>`;
      const why = !allowed ? "Not now" : !afford ? "Too dear" : item.cost.toLocaleString();
      return `<div class="shop-item" data-id="${item.id}">
        ${icon}
        <div><h4>${item.name}</h4><p>${item.blurb}</p></div>
        <button class="shop-buy" data-buy="${item.id}" ${afford && allowed ? "" : "disabled"}>${why}</button>
      </div>`;
    }).join("");
  }

  shopList.addEventListener("click", e => {
    const btn = e.target.closest("[data-buy]");
    if (!btn || btn.disabled) return;
    const item = SHOP.find(i => i.id === btn.dataset.buy);
    if (!item || score < item.cost || !item.can()) return;
    addScore(-item.cost);
    item.buy();
    tel("bought", item.id);
    if (item.id === "row" || item.id === "col" || item.id === "bomb") tel("count", "bought");
    saveProgress();
    refreshGoals();
    blip(880, .18, "sine", .2);
    const card = shopList.querySelector(`.shop-item[data-id="${item.id}"]`);
    if (card){ card.classList.remove("bought"); void card.offsetWidth; card.classList.add("bought"); }
    drawShop();
  });

  /* ---------------- the map ----------------
     Nine regions, what lives in each, and how far along you are. */
  const SHAPE_LABEL = { square:"Square", pentagon:"Pentagon", octagon:"Octagon",
    trapezoid:"Trapezoid", hexagon:"Hexagon", rhombus:"Rhombus", decagon:"Decagon",
    cross:"Cross", diamond:"Diamond" };
  const HAZARD_LABEL = { frost:"Frost", bramble:"Bramble", creeper:"Creeper vine", sandpit:"Sand pit" };

  function drawMap(){
    const here = bandFor(level);
    const lap = Math.floor((level - 1) / LAST_STAGE);
    mapList.innerHTML = REGIONS.map(reg => {
      const last = reg.from + 9;
      const current = reg === here.band;
      const done = here.wrapped > last;
      const state = current ? "here" : done ? "done" : "ahead";
      const pips = Array.from({ length: 10 }, (_, i) => {
        const stage = reg.from + i;
        const filled = here.wrapped > stage || (current && here.wrapped === stage);
        const now = current && here.wrapped === stage;
        return `<i class="pip${filled ? " on" : ""}${now ? " now" : ""}"></i>`;
      }).join("");
      return `<div class="map-region is-${state}" data-art="${reg.art}">
        <div class="map-head">
          <h4>${reg.name}</h4>
          <span>${reg.from}–${last}</span>
        </div>
        <p>${reg.kinds.map(k => HAZARD_LABEL[k]).join(" · ")}</p>
        <p class="map-shape">${SHAPE_LABEL[reg.shape] || reg.shape} board</p>
        <div class="pips">${pips}</div>
      </div>`;
    }).join("") + (lap > 0
      ? `<p class="map-lap">You are on lap ${lap + 1}. The regions repeat, the clock keeps tightening.</p>`
      : "");
  }

  function openMap(){
    hideTip();
    drawMap();
    mapEl.hidden = false;
  }
  function closeMap(){ mapEl.hidden = true; }
  document.getElementById("mapBtn").onclick = () => mapEl.hidden ? openMap() : closeMap();
  document.getElementById("mapClose").onclick = closeMap;

  function openShop(){
    hideTip();
    drawShop();
    shopEl.hidden = false;
    pauseTimer();
    clearTimeout(creeperTimer); creeperTimer = null;
    stopSand();
  }
  function closeShop(){
    shopEl.hidden = true;
    if (started && !locked && !busy && veil.hidden){ resumeTimer(); armCreeper(); armSand(); }
  }
  document.getElementById("shopBtn").onclick = () => shopEl.hidden ? openShop() : closeShop();
  document.getElementById("shopClose").onclick = closeShop;

  /* The clock keeps running while the rules are open — checking the FAQ mid-quest
     costs you time, which is the point. The vine stops, because losing board to a
     spreading obstacle while reading is a punishment out of proportion. */
  function openHelp(){
    hideTip();
    helpEl.hidden = false;
    clearTimeout(creeperTimer);
    creeperTimer = null;
  }
  function closeHelp(){
    helpEl.hidden = true;
    if (started && !locked && !busy && veil.hidden) armCreeper();
  }
  document.getElementById("helpBtn").onclick = () => helpEl.hidden ? openHelp() : closeHelp();
  document.getElementById("helpClose").onclick = closeHelp;

  // the opt-out is only shown when there's somewhere for the data to go
  (() => {
    const t = window.RuneTelemetry;
    const box = document.getElementById("privacy");
    const share = document.getElementById("shareData");
    if (!t || !box || !share || !t.isEnabled()) return;
    box.hidden = false;
    share.checked = !t.isOptedOut();
    share.onchange = () => t.optOut(!share.checked);
  })();
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!helpEl.hidden) closeHelp();
    else if (!shopEl.hidden) closeShop();
    else if (!mapEl.hidden) closeMap();
  });

  /* ---------------- rune combinations ----------------
     Swapping two runes together does something bigger than either alone,
     following the conventions players already know from other match-3 games:
     two lines cross, a line plus a blast widens into a band, two blasts go
     wide, and the orb converts an entire colour into copies of its partner. */
  const isLine = sp => sp === "row" || sp === "col";

  const COMBO_NAME = {
    cross:      "Crossed runes",
    band:       "Rune storm",
    mega:       "Twin blast",
    "orb-line": "Orb of lines",
    "orb-bomb": "Orb of blasts",
    board:      "Ragnarök"
  };

  function comboOf(ta, tb){
    if (!ta || !tb || !ta.special || !tb.special) return null;
    const sa = ta.special, sb = tb.special;
    if (sa === "rainbow" && sb === "rainbow") return "board";
    if (sa === "rainbow" || sb === "rainbow"){
      const other = sa === "rainbow" ? sb : sa;
      if (isLine(other)) return "orb-line";
      if (other === "bomb") return "orb-bomb";
      return null;                       // orb + plain slime is not a combo
    }
    if (isLine(sa) && isLine(sb)) return "cross";
    if (sa === "bomb" && sb === "bomb") return "mega";
    if (isLine(sa) && sb === "bomb") return "band";
    if (sa === "bomb" && isLine(sb)) return "band";
    return null;
  }

  function comboCells(kind, ta, tb){
    const clear = new Set([K(ta.r, ta.c), K(tb.r, tb.c)]);
    const r = tb.r, c = tb.c;
    const addRow = rr => { for (let cc = 0; cc < COLS; cc++) clear.add(K(rr,cc)); };
    const addCol = cc => { for (let rr = 0; rr < ROWS; rr++) clear.add(K(rr,cc)); };

    if (kind === "cross"){ addRow(r); addCol(c); }

    if (kind === "band"){                // three rows and three columns
      for (let d = -1; d <= 1; d++){
        if (r + d >= 0 && r + d < ROWS) addRow(r + d);
        if (c + d >= 0 && c + d < COLS) addCol(c + d);
      }
    }

    if (kind === "mega"){                // 5x5
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        if (inBounds(r+dr, c+dc)) clear.add(K(r+dr, c+dc));
    }

    if (kind === "board"){
      for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) clear.add(K(rr,cc));
    }

    if (kind === "orb-line" || kind === "orb-bomb"){
      // the orb takes its partner's colour, turns every slime of that colour
      // into a copy of the partner rune, and sets them all off together
      const other = ta.special === "rainbow" ? tb : ta;
      const ty = other.type;
      let flip = 0;
      for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++){
        const id = board[rr][cc]; if (!id) continue;
        const t = T(id);
        if (t.type !== ty || t.special === "rainbow") continue;
        t.special = kind === "orb-bomb" ? "bomb" : (flip++ % 2 ? "col" : "row");
        repaint(t);
        clear.add(K(rr,cc));
      }
    }
    return clear;
  }

  /* A combo name is worth reading, and the cascade it sets off would otherwise
     overwrite it within a few hundred milliseconds. hold keeps the banner until
     it has had its moment; anything arriving inside that window is dropped. */
  let announceUntil = 0;
  /* Praise thresholds, as specified.
     PRAISE_ON decides what is being counted:
       "cascade" — how many times the board refilled into another match. This is
                   what "Combo x2" has always meant here, but measured play tops
                   out around 2-3, so only the first tiers ever fire.
       "tiles"   — how many slimes the whole chain destroyed. Reaches into the
                   hundreds with orb combinations, so the full ladder is usable.
     See the README for the measurements behind this. */
  const PRAISE_ON = "tiles";

  const PRAISE = [
    { at: 100, word: "God-slayer!" },
    { at:  76, word: "God!" },
    { at:  51, word: "Ascendant" },
    { at:  31, word: "Immortal" },
    { at:  16, word: "Supreme" },
    { at:  12, word: "Substantial" }
  ];
  const praiseFor = n => (PRAISE.find(p => n >= p.at) || {}).word || null;

  /* Each tier has to sound bigger than the one below it, and the ladder has to
     survive being heard hundreds of times. So it climbs one musical step at a
     time rather than getting louder: a bare fifth, then a triad, then the triad
     an octave up, then the octave stack, then drums under it. Same key
     throughout (C), so consecutive tiers in one chain don't clash. */
  const PRAISE_SFX = {
    "Substantial": () => chord([523, 784], .26, "triangle", .13),
    "Supreme":     () => chord([523, 659, 784], .3, "triangle", .14),
    "Immortal":    () => { chord([659, 784, 1047], .34, "sine", .14);
                           sweep(700, 1500, .35); },
    "Ascendant":   () => { chord([523, 659, 784, 1047], .42, "sine", .15);
                           sweep(500, 2000, .5); },
    "God!":        () => { boom();
                           chord([262, 392, 523, 659, 784], .6, "sine", .16); },
    "God-slayer!": () => { boom();
                           setTimeout(boom, 160);
                           chord([131, 262, 392, 523, 659, 784, 1047], .9, "sine", .17);
                           sweep(300, 2600, .8); }
  };

  function praiseFx(word){
    // recorded clip first; the synthesised ladder covers a missing file
    if (!sample(PRAISE_SAMPLE[word])){
      const play = PRAISE_SFX[word];
      if (play) play();
    }
    if (window.RuneMusic) RuneMusic.duck(word === "God-slayer!" ? 2400 : 1300);
    // the two top tiers earn a shake and a burst of their own
    if (word === "God!" || word === "God-slayer!"){
      shake(true);
      const c = (COLS - 1) / 2, r = (ROWS - 1) / 2;
      sparks(Math.round(r), Math.round(c), word === "God-slayer!" ? 52 : 34, "#ffe9a8");
      shockwave(Math.round(r), Math.round(c), word === "God-slayer!" ? 16 : 11);
    } else if (word === "Ascendant"){
      shake(false);
    }
  }

  function announce(text, hold = 700, force = false){
    const now = performance.now();
    if (now < announceUntil && !force) return;   // force: the praise went up a tier
    announceUntil = now + hold;
    comboEl.textContent = text;
    comboEl.classList.remove("show"); void comboEl.offsetWidth;
    comboEl.classList.add("show");
  }

  /* A "combo" is everything one move destroys: the blast that starts it plus
     every cascade it sets off. Tracked here rather than inside resolve() so a
     rune combination, which never enters the cascade loop, still counts. */
  let chainTiles = 0, chainWord = null, chainCombo = null;

  function resetChain(){ chainTiles = 0; chainWord = null; chainCombo = null; }

  function noteChain(tiles, combo){
    chainTiles += tiles;
    tel("peak", "chain", chainTiles);
    const measure = PRAISE_ON === "tiles" ? chainTiles : combo;
    const word = praiseFor(measure);
    if (word && word !== chainWord){
      chainWord = word;
      comboEl.dataset.praise = word;
      // keep the combination's name if one started this chain — it says what you
      // did, where the praise only says how big it got
      const lead = chainCombo ? `${chainCombo} · ` : "";
      announce(`${lead}${word} ×${chainTiles}`, 1600, true);
      praiseFx(word);
      tel("praise", word);
    } else if (!word && combo > 1){
      delete comboEl.dataset.praise;
      announce("Combo ×" + combo, 700);
    }
  }

  /* pop, score, chip blockers, drop — shared by every detonation */
  async function detonate(clear, pointsPer, origin){
    expandSpecials(clear);
    const gained = clear.size * pointsPer;
    addScore(gained);
    if (origin) floatPts(origin.r, origin.c, "+" + gained);

    let chipped = 0;
    for (const k of clear){
      const [r,c] = parse(k);
      if (chipBlocker(r,c)) chipped++;
      const id = board[r][c]; if (!id) continue;
      const t = T(id);
      const goal = goals.find(g => g.kind === "collect" && g.type === t.type);
      if (goal && goal.have < goal.need) goal.have++;
      t.el.classList.add("pop");
    }
    if (chipped) addScore(chipped * PAY_CHIP);
    noteChain(clear.size, 1);
    refreshGoals();

    await sleep(260);
    for (const k of clear){
      const [r,c] = parse(k);
      const id = board[r][c]; if (!id) continue;
      destroy(T(id)); board[r][c] = null;
    }
    collapse();
    await sleep(290);
  }

  async function trySwap(a,b){
    if (busy || !started || locked) return;
    const [ar,ac] = parse(a), [br,bc] = parse(b);
    if (isLocked(ar,ac) || isLocked(br,bc)){ blip(150, .12, "sawtooth", .08); return; }
    busy = true; clearHint();
    markSelected(null);
    blip(300, .06, "square", .1);

    resetChain();
    swapCells(a,b);
    syncPositions(true);
    await sleep(230);

    const ta = tileAt(a), tb = tileAt(b);
    const kind = comboOf(ta, tb);
    const rainbow = [ta,tb].find(t => t && t.special === "rainbow");

    if (kind){
      chainCombo = COMBO_NAME[kind];
      announce(chainCombo, 1800);
      const clear = comboCells(kind, ta, tb);
      // the two runes' own effects are already folded into the combo area, so
      // clear them to stop expandSpecials firing them a second time
      if (kind === "orb-line" || kind === "orb-bomb"){
        (ta.special === "rainbow" ? ta : tb).special = null;
      } else {
        ta.special = null; tb.special = null;
      }
      spendMove();
      comboFx(kind, tb);
      await detonate(clear, PAY_COMBO, tb);
      await resolve(null);

    } else if (rainbow){
      const other = rainbow === ta ? tb : ta;
      const clear = new Set([K(rainbow.r, rainbow.c)]);
      if (other){
        const ty = other.type;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
          const id = board[r][c]; if (id && T(id).type === ty) clear.add(K(r,c));
        }
      }
      rainbow.special = null;
      spendMove();
      blip(1100, .3, "sine", .22);
      await detonate(clear, PAY_ORB, rainbow);
      await resolve(null);

    } else if (findRuns().length){
      spendMove();
      await resolve([a,b]);
    } else {
      swapCells(a,b);
      syncPositions(true);
      blip(160, .12, "sawtooth", .08);
      await sleep(230);
      busy = false;
      scheduleHint();
      return;
    }

    while (!findMove()) await shuffleBoard();
    endOfTurn();
  }

  function spendMove(){
    movesLeft--;
    movesEl.textContent = movesLeft;
    movesEl.classList.toggle("low", movesLeft <= 5);
  }

  function endOfTurn(){
    if (questDone()) return completeQuest();
    if (movesLeft <= 0) return stageFailed("moves");
    busy = false;
    scheduleHint();
  }

  /* pointer: tap-tap or drag */
  let drag = null;
  boardEl.addEventListener("pointerdown", e => {
    if (window.RuneAudio) RuneAudio.unlock();   // iOS keeps it suspended otherwise
    if (busy || !started || locked) return;
    const el = e.target.closest(".tile"); if (!el) return;
    const t = T(Number(el.dataset.id)); if (!t) return;
    if (isLocked(t.r, t.c) && !armed){ blip(150, .1, "sawtooth", .07); return; }
    drag = { from: K(t.r, t.c), x: e.clientX, y: e.clientY, moved: false };
    if (boardEl.setPointerCapture) { try { boardEl.setPointerCapture(e.pointerId); } catch (err){} }
  });
  boardEl.addEventListener("pointermove", e => {
    if (!drag || drag.moved || busy || armed) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const s = cellPx();
    if (Math.hypot(dx,dy) < s * 0.45) return;
    drag.moved = true;
    const [r,c] = parse(drag.from);
    const to = Math.abs(dx) > Math.abs(dy) ? K(r, c + Math.sign(dx)) : K(r + Math.sign(dy), c);
    const [r2,c2] = parse(to);
    if (inBounds(r2,c2)) trySwap(drag.from, to);
    drag = null;
  });
  boardEl.addEventListener("pointerup", () => {
    if (!drag || drag.moved){ drag = null; return; }
    const k = drag.from; drag = null;
    if (busy || locked) return;
    if (armed){ placeCharge(k); return; }
    if (!selected){ markSelected(k); blip(520, .05, "sine", .08); return; }
    if (selected === k){ markSelected(null); return; }
    if (adjacent(selected, k)) trySwap(selected, k);
    else markSelected(k);
  });
  boardEl.addEventListener("pointercancel", () => { drag = null; });

  /* ---------------- hint ---------------- */
  function clearHint(){
    clearTimeout(hintTimer);
    document.querySelectorAll(".tile.hint").forEach(e => e.classList.remove("hint"));
  }
  function showHint(){
    clearHint();
    const mv = findMove(); if (!mv) return;
    mv.forEach(k => { const t = tileAt(k); if (t) t.el.classList.add("hint"); });
    setTimeout(clearHint, 2200);
  }
  function scheduleHint(){ clearHint(); hintTimer = setTimeout(showHint, 8000); }
  document.getElementById("hintBtn").onclick = () => { if (!busy && started && !locked) showHint(); };
  document.getElementById("restartBtn").onclick = () => {
    if (!started || locked || busy) return;
    stageFailed("quit");
  };

  /* ---------------- boot ---------------- */
  (async () => {
    const saved = Progress.load();
    const resuming = saved.level > 1 || saved.zeny > 0;
    level = saved.level;
    score = saved.zeny;
    charges = Math.min(MAX_CHARGES, saved.charges);
    seenTips = saved.seen || [];
    muted = !!saved.sfxOff;
    musicOff = !!saved.bgmOff;
    dressToggle(sfxBtn, muted, "🔊", "🔇");
    dressToggle(bgmBtn, musicOff, "♪", "♪");
    if (window.RuneMusic && musicOff) RuneMusic.setMuted(true);
    scoreAtStart = score;

    const preview = questFor(level);
    stagePlan = preview.plan;
    goals = preview.goals;

    fit();              // sets --cell; harmless now that syncPositions tolerates an empty board
    buildBoard(false);
    fit();              // re-run so the freshly built tiles get placed
    questEl.textContent = "Quest " + level;
    movesEl.textContent = preview.moves;
    timeTotal = preview.seconds; timeLeft = preview.seconds;
    renderTimer();
    renderCharges();
    addScore(0);        // paints the wallet
    refreshGoals();

    const snap = await Lives.init();

    const begin = () => {
      if (Lives.get().lives <= 0){ showLockout(); return; }
      veil.hidden = true;
      veilAlt.hidden = true;
      started = true;
      startLevel(level, false);
    };

    if (resuming){
      veilTitle.textContent = "Welcome back";
      veilText.textContent = "You left off on quest " + level + ". Your zeny is where you left it.";
      veilTally.hidden = false;
      veilTally.innerHTML = `Zeny <b>${score.toLocaleString()}</b>`;
      veilBtn.textContent = "Continue quest " + level;
      veilAlt.hidden = false;
      veilAlt.textContent = "Start over from quest 1";
      veilAlt.onclick = () => {
        Progress.clear();
        level = 1; score = 0; charges = 0; scoreAtStart = 0; seenTips = [];
        addScore(0);
        renderCharges();
        begin();
      };
    } else {
      veilBtn.textContent = "Begin";
    }
    veilBtn.onclick = begin;

    if (snap.lives <= 0){ started = true; showLockout(); }
  })();
})();
