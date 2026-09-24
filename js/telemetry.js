/* Telemetry — one record per stage, so tuning can come from real players
 * instead of a test bot that never spends its rune charges.
 *
 * What is recorded: how a stage went. Stage and region, how it ended, moves and
 * seconds left, each goal's progress, blockers placed and cleared, charges
 * earned and lost, continues and shop spending, the biggest chain, frame rate,
 * and screen size. Nothing else.
 *
 * What is not: no name, no account, no IP address, no device fingerprint. The
 * player is a random id generated in their own browser; clearing storage makes
 * a new one. See the README for the privacy position and the opt-out.
 *
 * Off unless configured. Set window.RUNE_TELEMETRY_ENDPOINT before this script
 * and run server/telemetry-server.example.js. Without an endpoint, records are
 * still kept locally (the last 50) so you can read your own sessions with
 * RuneTelemetry.dump() in the console while developing.
 *
 * It must never cost the player anything: every public call is wrapped so an
 * error here can't reach the game, sending uses sendBeacon so it survives the
 * tab closing, and failed sends wait in a small local queue for next time.
 */
window.RuneTelemetry = (() => {
  "use strict";

  const VERSION  = 1;
  const ENDPOINT = (window.RUNE_TELEMETRY_ENDPOINT || "").replace(/\/$/, "");
  const K_ID     = "runefall.tid";
  const K_OPTOUT = "runefall.telemetry.off";
  const K_QUEUE  = "runefall.telemetry.queue";
  const K_LOG    = "runefall.telemetry.log";
  const QUEUE_MAX = 50;              // unsent records kept for a retry
  const LOG_MAX   = 50;              // recent records kept for dump()

  const session = randomId(8);       // one per page load
  let stage = null;                  // the record being built
  let frames = null;                 // frame-rate sampler for the current stage

  /* ---------- storage, always guarded ---------- */
  function read(key, fallback){
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e){ return fallback; }
  }
  function write(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e){}
  }

  function randomId(bytes){
    try {
      const a = new Uint8Array(bytes);
      crypto.getRandomValues(a);
      return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
    } catch (e){
      return Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
  }

  function playerId(){
    let id = read(K_ID, null);
    if (!id){ id = randomId(12); write(K_ID, id); }
    return id;
  }

  const optedOut = () => read(K_OPTOUT, false) === true;

  /* ---------- frame rate ----------
     Counts frames with requestAnimationFrame while a stage runs. A frame over
     50ms is a visible hitch. This is the cheap-phone performance check: it
     reports what real devices actually manage rather than what we hope. */
  function startFrames(){
    stopFrames();
    const f = { count: 0, slow: 0, last: performance.now(), start: performance.now(), raf: 0 };
    const tick = now => {
      const gap = now - f.last;
      f.last = now;
      if (!document.hidden){
        f.count++;
        if (gap > 50) f.slow++;
      }
      f.raf = requestAnimationFrame(tick);
    };
    f.raf = requestAnimationFrame(tick);
    frames = f;
  }
  function stopFrames(){
    if (!frames) return null;
    cancelAnimationFrame(frames.raf);
    const secs = Math.max(0.001, (performance.now() - frames.start) / 1000);
    const out = { avg: Math.round(frames.count / secs), slow: frames.slow };
    frames = null;
    return out;
  }

  /* ---------- sending ---------- */
  function send(batch){
    if (!ENDPOINT || !batch.length) return false;
    const body = JSON.stringify(batch);
    try {
      if (navigator.sendBeacon){
        const ok = navigator.sendBeacon(ENDPOINT + "/telemetry",
          new Blob([body], { type: "application/json" }));
        if (ok) return true;
      }
    } catch (e){}
    try {
      fetch(ENDPOINT + "/telemetry", {
        method: "POST", body, keepalive: true,
        headers: { "Content-Type": "application/json" }
      }).catch(() => {});
      return true;
    } catch (e){ return false; }
  }

  function flush(){
    if (optedOut() || !ENDPOINT) return;
    const queue = read(K_QUEUE, []);
    if (!queue.length) return;
    if (send(queue)) write(K_QUEUE, []);
  }

  function enqueue(record){
    const log = read(K_LOG, []);
    log.push(record);
    write(K_LOG, log.slice(-LOG_MAX));

    if (!ENDPOINT) return;
    const queue = read(K_QUEUE, []);
    queue.push(record);
    write(K_QUEUE, queue.slice(-QUEUE_MAX));
    flush();
  }

  /* every public call is wrapped: telemetry must never break a game */
  const safe = fn => (...args) => { try { return fn(...args); } catch (e){ return undefined; } };

  window.addEventListener("pagehide", safe(flush));
  document.addEventListener("visibilitychange", safe(() => { if (document.hidden) flush(); }));

  return {
    /* a stage has started */
    begin: safe(info => {
      if (optedOut()) { stage = null; return; }
      stage = {
        v: VERSION, type: "stage_end",
        id: playerId(), session,
        stage: info.stage, region: info.region, lap: info.lap || 1,
        kind: info.kind,
        movesBudget: info.moves, secondsBudget: info.seconds,
        blockersPlaced: info.blockers || 0,
        chargesStart: info.charges || 0, zenyStart: info.zeny || 0,
        startedAt: Date.now(),
        counts: { cleared: 0, earned: 0, placed: 0, bought: 0, swallowed: 0,
                  continues: 0, creeperPeak: 0 },
        shop: [], chainBest: 0, praiseBest: null
      };
      startFrames();
    }),

    /* add to a counter on the open record */
    count: safe((field, n = 1) => {
      if (stage && field in stage.counts) stage.counts[field] += n;
    }),

    /* keep the highest value seen */
    peak: safe((field, value) => {
      if (!stage) return;
      if (field === "chain" && value > stage.chainBest) stage.chainBest = value;
      if (field === "creeper" && value > stage.counts.creeperPeak) stage.counts.creeperPeak = value;
    }),

    praise: safe(word => { if (stage) stage.praiseBest = word; }),
    bought: safe(item => { if (stage) stage.shop.push(item); }),

    /* the stage is over; outcome is "cleared", "time", "moves" or "quit" */
    end: safe((outcome, info) => {
      if (!stage) return;
      const s = stage;
      stage = null;
      const fps = stopFrames();
      const record = {
        v: s.v, type: s.type, id: s.id, session: s.session,
        at: new Date().toISOString(),
        stage: s.stage, region: s.region, lap: s.lap, kind: s.kind,
        outcome,
        movesBudget: s.movesBudget, movesLeft: info.movesLeft,
        secondsBudget: s.secondsBudget, secondsLeft: Math.max(0, Math.round(info.secondsLeft)),
        durationMs: Date.now() - s.startedAt,
        goals: (info.goals || []).map(g => ({ kind: g.kind, need: g.need, have: Math.min(g.have, g.need) })),
        blockers: { placed: s.blockersPlaced, cleared: s.counts.cleared },
        charges: { start: s.chargesStart, earned: s.counts.earned, placed: s.counts.placed,
                   bought: s.counts.bought, swallowed: s.counts.swallowed },
        creeperPeak: s.counts.creeperPeak,
        continues: s.counts.continues,
        zeny: { start: s.zenyStart, end: info.zeny, earned: Math.max(0, info.zeny - s.zenyStart) },
        shop: s.shop,
        chainBest: s.chainBest, praiseBest: s.praiseBest,
        lives: info.lives,
        fps,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        touch: "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0
      };
      enqueue(record);
    }),

    optOut: safe(value => {
      write(K_OPTOUT, !!value);
      if (value){ write(K_QUEUE, []); stage = null; stopFrames(); }
    }),
    isOptedOut: () => { try { return optedOut(); } catch (e){ return true; } },
    isEnabled: () => !!ENDPOINT,

    /* the last 50 records from this browser, for reading in the console */
    dump: () => read(K_LOG, []),
    flush: safe(flush)
  };
})();
