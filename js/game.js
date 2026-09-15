(() => {
  "use strict";

  const ROWS = 8, COLS = 8;

  /* ---- tuning ---------------------------------------------------------- */
  const MOVES_PER_CHARGE = 3;    // unused moves needed for one carried rune charge
  const MAX_CHARGES      = 5;    // ceiling on charges held at once
  const TIME_FLOOR       = 80;   // seconds, shortest a stage can be
  const TIME_CEIL        = 300;  // seconds, longest a stage can be
  /* ---------------------------------------------------------------------- */

  const TYPES = [
    { name:"Ember",  g:"url(#g0)", ink:"#5c0f0f" },
    { name:"Amber",  g:"url(#g1)", ink:"#6b3400" },
    { name:"Moss",   g:"url(#g2)", ink:"#12461f" },
    { name:"Frost",  g:"url(#g3)", ink:"#0b3057" },
    { name:"Wraith", g:"url(#g4)", ink:"#2c1a64" },
    { name:"Bone",   g:"url(#g5)", ink:"#3b4149" }
  ];

  const Lives = window.RuneLives;

  const boardEl  = document.getElementById("board");
  const scoreEl  = document.getElementById("score");
  const movesEl  = document.getElementById("moves");
  const goalsEl  = document.getElementById("goals");
  const questEl  = document.getElementById("questTitle");
  const comboEl  = document.getElementById("combo");
  const timerEl  = document.getElementById("timer");
  const clockEl  = document.getElementById("clock");
  const barEl    = document.getElementById("timeBar");
  const heartsEl = document.getElementById("hearts");
  const regenEl  = document.getElementById("regen");
  const chargeBtn= document.getElementById("chargeBtn");
  const warpEl   = document.getElementById("warp");
  const warpBody = document.getElementById("warpBody");
  const veil     = document.getElementById("veil");
  const veilTitle= document.getElementById("veilTitle");
  const veilText = document.getElementById("veilText");
  const veilTally= document.getElementById("veilTally");
  const veilBtn  = document.getElementById("veilBtn");

  let board = [];
  const tiles = new Map();
  let nextId = 1;
  let busy = true, started = false, locked = false;
  let score = 0, movesLeft = 0, level = 1;
  let goals = [];
  let charges = 0, armed = false;
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
  function slimeMarkup(type, special){
    const t = TYPES[type];
    let rune = "";
    if (special === "row")
      rune = `<g fill="#fff5d6" stroke="${t.ink}" stroke-width="2.5">
                <rect x="6" y="44" width="88" height="6" rx="3"/>
                <rect x="6" y="56" width="88" height="6" rx="3"/></g>`;
    if (special === "col")
      rune = `<g fill="#fff5d6" stroke="${t.ink}" stroke-width="2.5">
                <rect x="38" y="14" width="6" height="76" rx="3"/>
                <rect x="56" y="14" width="6" height="76" rx="3"/></g>`;
    if (special === "bomb")
      rune = `<g fill="none" stroke="#fff5d6" stroke-width="5" stroke-linecap="round">
                <circle cx="50" cy="54" r="18"/>
                <path d="M50 26v8M50 74v8M22 54h8M70 54h8"/></g>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
      <ellipse cx="50" cy="90" rx="30" ry="6" fill="rgba(0,0,0,.35)"/>
      <path d="M50 13c-21 0-37 20-37 44 0 18 16 31 37 31s37-13 37-31c0-24-16-44-37-44z"
            fill="${t.g}" stroke="rgba(0,0,0,.4)" stroke-width="3"/>
      <ellipse cx="35" cy="30" rx="11" ry="6.5" fill="rgba(255,255,255,.55)" transform="rotate(-25 35 30)"/>
      <ellipse cx="37" cy="50" rx="5.5" ry="7.5" fill="#181418"/>
      <ellipse cx="63" cy="50" rx="5.5" ry="7.5" fill="#181418"/>
      <circle cx="39" cy="47" r="2.1" fill="#fff"/><circle cx="65" cy="47" r="2.1" fill="#fff"/>
      <path d="M42 66q8 7 16 0" stroke="${t.ink}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      ${rune}
    </svg>`;
  }
  const tileMarkup = t => t.special === "rainbow" ? `<div class="orb"></div>` : slimeMarkup(t.type, t.special);
  const heartMarkup = full =>
    `<svg viewBox="0 0 24 24" class="${full ? "on" : "off"}" aria-hidden="true">
       <path d="M12 21s-7.4-4.6-9.3-8.9A5.2 5.2 0 0 1 12 6.7a5.2 5.2 0 0 1 9.3 5.4C19.4 16.4 12 21 12 21z"/></svg>`;

  document.getElementById("lg1").outerHTML = slimeMarkup(3, "row").replace("<svg", `<svg style="width:26px;height:26px;flex:none"`);
  document.getElementById("lg2").outerHTML = slimeMarkup(0, "bomb").replace("<svg", `<svg style="width:26px;height:26px;flex:none"`);

  /* ---------------- sound ---------------- */
  let audio = null, muted = false;
  function blip(freq, dur = .09, type = "triangle", vol = .16){
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
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
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
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
  document.getElementById("muteBtn").onclick = e => {
    muted = !muted;
    e.currentTarget.textContent = muted ? "✕" : "♪";
    e.currentTarget.style.opacity = muted ? .5 : 1;
  };

  /* ---------------- sizing ---------------- */
  function fit(){
    const avail = Math.min(window.innerWidth - 60, window.innerHeight - 260, 480);
    const cell = Math.max(34, Math.floor(avail / COLS));
    document.documentElement.style.setProperty("--cell", cell + "px");
    syncPositions(false);
  }
  window.addEventListener("resize", fit);
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
    el.innerHTML = tileMarkup(t);
    boardEl.appendChild(el);
    t.el = el;
    return t;
  }
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

  /* ---------------- board setup ---------------- */
  function buildBoard(entrance){
    tiles.forEach(t => t.el.remove());
    tiles.clear();
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
      const bad = new Set();
      if (c >= 2 && T(board[r][c-1]).type === T(board[r][c-2]).type) bad.add(T(board[r][c-1]).type);
      if (r >= 2 && T(board[r-1][c]).type === T(board[r-2][c]).type) bad.add(T(board[r-1][c]).type);
      let ty; do { ty = rnd(TYPES.length); } while (bad.has(ty));
      board[r][c] = makeTile(ty).id;
    }
    syncPositions(false);
    if (!findMove()) return buildBoard(entrance);
    if (entrance){
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
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
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--){
        if (board[r][c]){
          if (write !== r){ board[write][c] = board[r][c]; board[r][c] = null; }
          write--;
        }
      }
      let above = -1;
      for (let r = write; r >= 0; r--){
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

      const gained = clear.size * 60 * combo;
      score += gained;
      scoreEl.textContent = score.toLocaleString();
      blip(420 + combo * 90, .1, "triangle");
      if (combo > 1){
        comboEl.textContent = "Combo ×" + combo;
        comboEl.classList.remove("show"); void comboEl.offsetWidth;
        comboEl.classList.add("show");
      }
      if (clear.size){
        const first = parse([...clear][0]);
        floatPts(first[0], first[1], "+" + gained);
      }

      for (const k of clear){
        const [r,c] = parse(k);
        const id = board[r][c]; if (!id) continue;
        const t = T(id);
        const goal = goals.find(g => g.type === t.type);
        if (goal && goal.have < goal.need) goal.have++;
        t.el.classList.add("pop");
      }
      drawGoals();

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
        t.el.innerHTML = tileMarkup(t);
        blip(880, .16, "sine", .2);
      }

      collapse();
      await sleep(290);
    }
    return combo;
  }

  /* ---------------- moves ---------------- */
  function findMove(){
    const swap = (a,b) => { const t = board[a[0]][a[1]]; board[a[0]][a[1]] = board[b[0]][b[1]]; board[b[0]][b[1]] = t; };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
      const id = board[r][c];
      if (id && T(id).special === "rainbow") return [K(r,c), K(r, c < COLS-1 ? c+1 : c-1)];
      for (const [dr,dc] of [[0,1],[1,0]]){
        const r2 = r + dr, c2 = c + dc;
        if (!inBounds(r2,c2)) continue;
        swap([r,c],[r2,c2]);
        const ok = findRuns().length > 0;
        swap([r,c],[r2,c2]);
        if (ok) return [K(r,c), K(r2,c2)];
      }
    }
    return null;
  }

  async function shuffleBoard(){
    const list = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) list.push(board[r][c]);
    let guard = 0;
    do {
      for (let i = list.length - 1; i > 0; i--){ const j = rnd(i+1); [list[i],list[j]] = [list[j],list[i]]; }
      let i = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) board[r][c] = list[i++];
    } while ((findRuns().length || !findMove()) && ++guard < 200);
    syncPositions(true);
    await sleep(320);
  }

  /* ---------------- quests ---------------- */
  function questFor(n){
    const pool = [...TYPES.keys()];
    for (let i = pool.length - 1; i > 0; i--){ const j = (n * 7 + i * 13) % (i + 1); [pool[i],pool[j]] = [pool[j],pool[i]]; }
    const count = Math.min(3, 1 + Math.floor((n - 1) / 2));
    // capped: past this, the goal outgrows what the move budget can physically clear
    const need = Math.min(42, 18 + (n - 1) * 5);
    const q = {
      moves: Math.max(18, 30 - Math.floor((n - 1) / 2)),
      goals: pool.slice(0, count).map(t => ({ type:t, need, have:0 }))
    };
    q.seconds = timeFor(q, n);
    return q;
  }

  // more slimes to collect means more time, but every quest tightens the belt a little
  function timeFor(q, n){
    const need = q.goals.reduce((s,g) => s + g.need, 0);
    const base = 45 + need * 1.9;
    const squeeze = Math.max(0.72, 1 - (n - 1) * 0.018);
    const raw = Math.min(TIME_CEIL, Math.max(TIME_FLOOR, base * squeeze));
    return Math.round(raw / 5) * 5;
  }

  function goalRow(g, plain){
    const done = !plain && g.have >= g.need;
    return `<div class="goal${done ? " done" : ""}">
      ${slimeMarkup(g.type, null)}
      <div class="bar"><i style="width:${plain ? 0 : Math.min(100, g.have / g.need * 100)}%"></i></div>
      <b>${plain ? g.need : Math.min(g.have, g.need) + "/" + g.need}</b>
    </div>`;
  }
  function drawGoals(){ goalsEl.innerHTML = goals.map(g => goalRow(g)).join(""); }

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
  function renderCharges(){
    chargeBtn.innerHTML = `Rune charge <b>×${charges}</b>`;
    chargeBtn.disabled = charges <= 0;
    if (charges <= 0 && armed) disarm();
  }
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
    charges--;
    t.special = "bomb";
    t.el.innerHTML = tileMarkup(t);
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
    await sleep(1900);

    warpEl.hidden = true;
  }

  /* ---------------- stage flow ---------------- */
  function startLevel(n, entrance){
    level = n;
    const q = questFor(n);
    goals = q.goals;
    movesLeft = q.moves;
    questEl.textContent = "Quest " + n;
    movesEl.textContent = movesLeft;
    movesEl.classList.remove("low");
    drawGoals();
    renderCharges();
    buildBoard(entrance);
    fit();
    selected = null;
    disarm();
    startTimer(q.seconds);
    busy = false;
    scheduleHint();
  }

  function restartQuest(){
    clearHint();
    veil.hidden = true;
    veilBtn.hidden = false;
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
    pauseTimer();
    clearHint();
    disarm();
    markSelected(null);

    const remain = Math.floor(timeLeft);
    const ratio = timeTotal ? timeLeft / timeTotal : 0;
    const tier = speedTier(ratio);
    const timeBonus = Math.round(remain * (18 + level * 4) * tier.mult);

    const earned = movesLeft > 0
      ? Math.max(1, Math.floor(movesLeft / MOVES_PER_CHARGE))
      : 0;
    const before = charges;
    charges = Math.min(MAX_CHARGES, charges + earned);
    const kept = charges - before;

    score += timeBonus;
    scoreEl.textContent = score.toLocaleString();
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
    const quest = `
      <p class="kicker">Warping to</p>
      <h3>Quest ${level + 1}</h3>
      <div class="warp-goals">${next.goals.map(g => goalRow(g, true)).join("")}</div>
      <p class="warp-meta">${next.moves} moves · ${clock(next.seconds)} on the clock${charges ? ` · ${charges} rune charge${charges === 1 ? "" : "s"} carried` : ""}</p>`;

    await warp(summary, quest);
    startLevel(level + 1, true);
  }

  async function failStage(title, text){
    busy = true;
    pauseTimer();
    clearHint();
    disarm();
    markSelected(null);
    charges = 0;
    renderCharges();

    const snap = await Lives.spend();
    if (snap.lives <= 0){ showLockout(); return; }

    veilTitle.textContent = title;
    veilText.textContent = text;
    veilTally.hidden = false;
    veilTally.innerHTML = `Zeny <b>${score.toLocaleString()}</b> · ${snap.lives} ${snap.lives === 1 ? "life" : "lives"} left`;
    veilBtn.hidden = false;
    veilBtn.textContent = "Try again";
    veilBtn.onclick = () => { score = 0; scoreEl.textContent = "0"; restartQuest(); };
    veil.hidden = false;
  }

  function onTimeout(){
    if (busy || locked) return;
    blip(200, .4, "sawtooth", .12);
    failStage("The hourglass ran out",
      "Quest " + level + " beat the clock. That costs one life — the quest restarts from the top.");
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

  async function trySwap(a,b){
    if (busy || !started || locked) return;
    busy = true; clearHint();
    markSelected(null);
    blip(300, .06, "square", .1);

    swapCells(a,b);
    syncPositions(true);
    await sleep(230);

    const ta = tileAt(a), tb = tileAt(b);
    const rainbow = [ta,tb].find(t => t && t.special === "rainbow");

    if (rainbow){
      const other = rainbow === ta ? tb : ta;
      const clear = new Set([K(rainbow.r, rainbow.c)]);
      if (other && other.special === "rainbow"){
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) clear.add(K(r,c));
      } else if (other){
        const ty = other.type;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++){
          const id = board[r][c]; if (id && T(id).type === ty) clear.add(K(r,c));
        }
      }
      rainbow.special = null;
      expandSpecials(clear);
      spendMove();
      const gained = clear.size * 80;
      score += gained; scoreEl.textContent = score.toLocaleString();
      floatPts(rainbow.r, rainbow.c, "+" + gained);
      blip(1100, .3, "sine", .22);
      for (const k of clear){
        const [r,c] = parse(k); const id = board[r][c]; if (!id) continue;
        const t = T(id);
        const goal = goals.find(g => g.type === t.type);
        if (goal && goal.have < goal.need) goal.have++;
        t.el.classList.add("pop");
      }
      drawGoals();
      await sleep(260);
      for (const k of clear){
        const [r,c] = parse(k); const id = board[r][c]; if (!id) continue;
        destroy(T(id)); board[r][c] = null;
      }
      collapse();
      await sleep(290);
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
    if (movesLeft <= 0){
      return failStage("Out of moves",
        "The slimes held the field. That costs one life — the quest restarts from the top.");
    }
    busy = false;
    scheduleHint();
  }

  /* pointer: tap-tap or drag */
  let drag = null;
  boardEl.addEventListener("pointerdown", e => {
    if (busy || !started || locked) return;
    const el = e.target.closest(".tile"); if (!el) return;
    const t = T(Number(el.dataset.id)); if (!t) return;
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
  document.getElementById("restartBtn").onclick = async () => {
    if (!started || locked || busy) return;
    await failStage("Quest abandoned",
      "Walking away from a quest costs one life, same as losing it.");
  };

  /* ---------------- boot ---------------- */
  (async () => {
    fit();              // sets --cell; harmless now that syncPositions tolerates an empty board
    buildBoard(false);
    fit();              // re-run so the freshly built tiles get placed
    const preview = questFor(1);
    goals = preview.goals;
    drawGoals();
    movesEl.textContent = preview.moves;
    timeTotal = preview.seconds; timeLeft = preview.seconds;
    renderTimer();
    renderCharges();

    const snap = await Lives.init();

    veilBtn.onclick = () => {
      if (Lives.get().lives <= 0){ showLockout(); return; }
      veil.hidden = true;
      started = true;
      startLevel(1, false);
    };

    if (snap.lives <= 0){ started = true; showLockout(); }
  })();
})();
