/* Progress — remembers which quest you're on, your zeny and your carried charges.
 *
 * Deliberately separate from js/lives.js. Lives are a spend-limiter that a player
 * has a reason to cheat, so they can live on a server. Progress is just
 * convenience: if someone edits it, they've only spoiled their own game.
 *
 * Zeny is a currency, not a run score — it survives failing a quest, because
 * otherwise you could never save up enough to spend it on a continue.
 */
window.RuneProgress = (() => {
  "use strict";

  const KEY = "runefall.progress.v1";
  const EMPTY = { level: 1, zeny: 0, charges: 0, seen: [] };

  let memoryOnly = false;
  let fallback = null;

  function load(){
    let raw = null;
    if (memoryOnly){
      raw = fallback;
    } else {
      try {
        const s = localStorage.getItem(KEY);
        raw = s ? JSON.parse(s) : null;
      } catch (e){
        memoryOnly = true;          // private mode or a sandboxed frame
        raw = fallback;
      }
    }
    if (!raw || typeof raw !== "object") return { ...EMPTY };
    return {
      level:   Math.max(1, Math.floor(Number(raw.level)   || 1)),
      zeny:    Math.max(0, Math.floor(Number(raw.zeny)    || 0)),
      charges: Math.max(0, Math.floor(Number(raw.charges) || 0)),
      seen:    Array.isArray(raw.seen) ? raw.seen.filter(v => typeof v === "string") : []
    };
  }

  function save(state){
    const clean = {
      level:   Math.max(1, Math.floor(state.level   || 1)),
      zeny:    Math.max(0, Math.floor(state.zeny    || 0)),
      charges: Math.max(0, Math.floor(state.charges || 0)),
      seen:    Array.isArray(state.seen) ? state.seen.slice(0, 40) : []
    };
    fallback = clean;
    if (memoryOnly) return clean;
    try { localStorage.setItem(KEY, JSON.stringify(clean)); }
    catch (e){ memoryOnly = true; }
    return clean;
  }

  function clear(){
    fallback = null;
    try { localStorage.removeItem(KEY); } catch (e){}
    return { ...EMPTY };
  }

  return { load, save, clear };
})();
