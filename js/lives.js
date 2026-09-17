/* Lives — 5 maximum, one regenerates every 30 minutes, survives a refresh.
 *
 * Two modes:
 *   local   (default) persists to localStorage, keyed to this browser profile.
 *   remote  persists on your server, keyed to the visitor's IP address.
 *
 * To switch to remote, set window.RUNE_LIVES_ENDPOINT in index.html before this
 * script loads, and run server/lives-server.example.js. A browser cannot read its
 * own IP, so remote mode is the only way to key lives to an IP. If the server is
 * unreachable, this falls back to local so the game still plays.
 */
window.RuneLives = (() => {
  "use strict";

  const MAX = 5;
  const REGEN_MS = 30 * 60 * 1000;
  const KEY = "runefall.lives.v1";
  const ENDPOINT = (window.RUNE_LIVES_ENDPOINT || "").replace(/\/$/, "");

  let state = { lives: MAX, nextAt: null };   // nextAt: ms timestamp of next refill
  let mode = ENDPOINT ? "remote" : "local";
  let memoryOnly = false;                     // set when localStorage is unavailable
  let fallback = null;                        // in-memory store when storage is blocked
  const listeners = new Set();

  /* ---------- storage ---------- */
  function readLocal(){
    if (memoryOnly) return fallback;
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e){
      memoryOnly = true;                      // private mode, sandboxed frame, disabled storage
      return fallback;
    }
  }
  function writeLocal(s){
    fallback = { ...s };
    if (memoryOnly) return;
    try { localStorage.setItem(KEY, JSON.stringify(s)); }
    catch (e){ memoryOnly = true; }
  }

  /* ---------- regeneration ---------- */
  function normalize(){
    const now = Date.now();
    if (state.lives >= MAX){ state.lives = MAX; state.nextAt = null; return; }
    if (!state.nextAt){ state.nextAt = now + REGEN_MS; return; }
    // a clock moved backwards shouldn't grant an endless wait
    if (state.nextAt - now > REGEN_MS) state.nextAt = now + REGEN_MS;
    while (state.lives < MAX && now >= state.nextAt){
      state.lives++;
      state.nextAt += REGEN_MS;
    }
    if (state.lives >= MAX) state.nextAt = null;
  }

  function emit(){ listeners.forEach(fn => fn(snapshot())); }
  function snapshot(){
    normalize();
    return {
      lives: state.lives,
      max: MAX,
      msToNext: state.nextAt ? Math.max(0, state.nextAt - Date.now()) : 0,
      mode
    };
  }

  /* ---------- remote ---------- */
  async function remote(path, opts){
    const res = await fetch(ENDPOINT + path, {
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      ...opts
    });
    if (!res.ok) throw new Error("lives server said " + res.status);
    return res.json();
  }
  function adopt(data){
    state.lives = Math.max(0, Math.min(MAX, data.lives));
    state.nextAt = data.msToNext > 0 ? Date.now() + data.msToNext : null;
  }

  /* ---------- api ---------- */
  async function init(){
    if (mode === "remote"){
      try { adopt(await remote("/lives")); emit(); return snapshot(); }
      catch (e){
        console.warn("Lives server unreachable, using this browser's storage instead.", e);
        mode = "local";
      }
    }
    const saved = readLocal();
    if (saved && typeof saved.lives === "number") state = saved;
    normalize();
    writeLocal(state);
    emit();
    return snapshot();
  }

  async function spend(){
    if (mode === "remote"){
      try {
        adopt(await remote("/lives/spend", { method: "POST" }));
        emit();
        return snapshot();
      } catch (e){
        console.warn("Lives server unreachable, spending locally.", e);
        mode = "local";
      }
    }
    normalize();
    if (state.lives <= 0){ emit(); return snapshot(); }
    if (state.lives === MAX) state.nextAt = Date.now() + REGEN_MS;   // clock starts on the first loss
    state.lives--;
    writeLocal(state);
    emit();
    return snapshot();
  }

  /* refills everything — wired to nothing, handy while testing:
     RuneLives.restore() in the console */
  async function restore(){
    if (mode === "remote"){
      try { adopt(await remote("/lives/restore", { method: "POST" })); emit(); return snapshot(); }
      catch (e){ mode = "local"; }
    }
    state = { lives: MAX, nextAt: null };
    writeLocal(state);
    emit();
    return snapshot();
  }

  /* Buying a life in the shop. In remote mode this has to be a server call —
     a client that can mint its own lives makes the whole limit decorative. */
  async function grant(n = 1){
    if (mode === "remote"){
      try { adopt(await remote("/lives/grant", { method: "POST" })); emit(); return snapshot(); }
      catch (e){
        console.warn("Lives server unreachable; granting locally.", e);
        mode = "local";
      }
    }
    normalize();
    state.lives = Math.min(MAX, state.lives + n);
    if (state.lives >= MAX) state.nextAt = null;
    writeLocal(state);
    emit();
    return snapshot();
  }

  function subscribe(fn){ listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); }

  // keeps countdowns honest and lands regenerated lives while the page is open
  setInterval(() => {
    const before = state.lives;
    normalize();
    if (state.lives !== before) writeLocal(state);
    emit();
  }, 1000);

  // another tab in the same browser may have spent or regained a life
  window.addEventListener("storage", e => {
    if (e.key !== KEY || mode !== "local" || !e.newValue) return;
    try { state = JSON.parse(e.newValue); normalize(); emit(); } catch (err){}
  });

  // coming back from a backgrounded tab: resync against the server
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || mode !== "remote") return;
    try { adopt(await remote("/lives")); emit(); } catch (e){}
  });

  return { MAX, REGEN_MS, init, spend, grant, restore, subscribe, get: snapshot };
})();
