/* Audio — one shared context, plus the optional background track.
 *
 * Mobile browsers, iOS especially, impose three rules that between them stop
 * naive implementations from ever making a sound:
 *
 *  1. play() must be called *inside* a user gesture. Calling it from a
 *     'canplaythrough' handler that happens to fire later does not count.
 *  2. iOS refuses to preload media, so 'canplaythrough' may never fire at all.
 *     Gating playback on it means the track never starts.
 *  3. iOS ignores HTMLMediaElement.volume entirely — assigning to it does
 *     nothing. Fading and ducking have to go through a Web Audio GainNode.
 *
 * An earlier version of this file broke on all three at once, which is why the
 * music button did nothing on a phone.
 */

/* One AudioContext for the whole game. Browsers cap how many you may create,
   and iOS starts them suspended until a gesture resumes one. */
window.RuneAudio = (() => {
  "use strict";
  let ctx = null;

  function context(){
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e){ return null; }
    return ctx;
  }

  /* A tiny sampler for one-shot sound effects. Decoded buffers rather than
     <audio> elements: they can overlap, they fire with no latency, and they go
     through the same context as everything else. A file that won't load is
     remembered as absent so the game falls back to its synthesised sound. */
  const buffers = new Map();     // name -> AudioBuffer, or null when unavailable
  const sources = new Map();     // name -> url, pending decode

  async function decode(name){
    const c = context();
    const url = sources.get(name);
    if (!c || !url) return null;
    sources.delete(name);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const buf = await c.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, buf);
      return buf;
    } catch (e){
      buffers.set(name, null);   // absent; never asked for again
      return null;
    }
  }

  return {
    context,

    /* call from inside a user gesture */
    unlock(){
      const c = context();
      if (c && c.state === "suspended") c.resume().catch(() => {});
      if (c) sources.forEach((_, name) => decode(name));   // warm them once
      return c;
    },

    /* register clips; nothing is fetched until the first gesture */
    samples(map){ Object.keys(map).forEach(k => { if (!buffers.has(k)) sources.set(k, map[k]); }); },

    /* returns false if the clip isn't ready, so the caller can fall back */
    play(name, volume = 1){
      const c = context();
      if (!c) return false;
      const buf = buffers.get(name);
      if (buf === undefined){ decode(name); return false; }
      if (!buf) return false;
      try {
        const src = c.createBufferSource(), g = c.createGain();
        src.buffer = buf;
        g.gain.value = volume;
        src.connect(g).connect(c.destination);
        src.start();
        return true;
      } catch (e){ return false; }
    }
  };
})();

window.RuneMusic = (() => {
  "use strict";

  const TRACK   = "assets/bgm.mp3";      // always present; the fallback for everything
  const VOLUME  = 0.32;
  const FADE_MS = 900;
  const SWAP_MS = 700;                   // fade out, change track, fade back in

  /* Optional per-band tracks. Drop any of these in and they're used; leave them
     out and that band simply keeps the default. Nothing breaks either way. */
  const STAGE_TRACKS = {
    frost:       "assets/bgm-frost.mp3",
    bramble:     "assets/bgm-bramble.mp3",
    vine:        "assets/bgm-vine.mp3",
    alps:        "assets/bgm-alps.mp3",
    plains:      "assets/bgm-plains.mp3",
    desert:      "assets/bgm-desert.mp3",
    oasis:       "assets/bgm-oasis.mp3",
    labyrinth:   "assets/bgm-labyrinth.mp3",
    svartalheim: "assets/bgm-svartalheim.mp3"
  };

  let el = null, gain = null, routed = false;
  let muted = false, playing = false, duckTimer = null, failed = false;
  let current = TRACK, swapping = false;
  const missing = new Set();             // tracks we already know aren't there

  function init(){
    el = new Audio();
    el.src = TRACK;
    el.loop = true;
    el.preload = "auto";
    /* No crossOrigin. The track is same-origin, and setting it to "anonymous"
       forces the browser to fetch in CORS mode — a plain static server sends no
       Access-Control-Allow-Origin header, the load fails, and the music never
       plays. It is only needed for genuinely cross-origin audio. */
    el.setAttribute("playsinline", "");      // iOS: don't hand it to the video player
    el.volume = 1;                           // real level is set on the gain node

    el.addEventListener("error", () => {
      // a missing per-band track falls back to the default rather than dying
      if (current !== TRACK){
        missing.add(current);
        current = TRACK;
        el.src = TRACK;
        if (playing) play();
        return;
      }
      failed = true;
    });

    /* Every gesture is another chance to start, not just the first. The opening
       attempt can fail for reasons that clear up a moment later — the track
       still loading, the context not yet resumed — and a single shot meant the
       music stayed silent for the whole session when it did. */
    const wake = () => {
      if (playing || muted || failed) return;
      start();
      if (playing){
        document.removeEventListener("pointerdown", wake);
        document.removeEventListener("keydown", wake);
      }
    };
    document.addEventListener("pointerdown", wake);
    document.addEventListener("keydown", wake);
  }

  /* Route the element through a gain node so volume works on iOS. Must happen
     while a context exists; if it fails we fall back to el.volume, which is
     fine everywhere except iOS. */
  function route(){
    if (routed || !el) return;
    /* On a file:// page a media element routed through Web Audio is treated as
       cross-origin and the graph outputs silence. Stay on el.volume there —
       it costs iOS fading, but iOS doesn't open file:// pages anyway. */
    if (location.protocol === "file:"){ routed = true; gain = null; return; }
    const c = window.RuneAudio && RuneAudio.unlock();
    if (!c) return;
    try {
      const src = c.createMediaElementSource(el);
      gain = c.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(c.destination);
      routed = true;
    } catch (e){
      routed = true;          // only ever works once; don't retry every tap
      gain = null;
    }
  }

  function setLevel(target, ms){
    if (gain){
      const c = RuneAudio.context();
      const now = c ? c.currentTime : 0;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(target, now + ms / 1000);
        return;
      } catch (e){}
    }
    if (el){ try { el.volume = target; } catch (e){} }
  }

  /* Only ever called from inside a gesture, directly — never from a callback. */
  function start(){
    if (!el || muted || failed) return;
    if (window.RuneAudio) RuneAudio.unlock();
    route();
    const attempt = el.play();
    if (attempt && attempt.then){
      attempt.then(() => { playing = true; setLevel(VOLUME, FADE_MS); })
             .catch(() => { playing = false; });   // still blocked; the next gesture retries
    } else {
      playing = true;
      setLevel(VOLUME, FADE_MS);
    }
  }

  return {
    init,
    isPlaying: () => playing,

    /* the music button calls this, so we are inside a gesture here */
    setMuted(value){
      muted = !!value;
      if (!el) return;
      if (muted){
        setLevel(0, 260);
        setTimeout(() => { if (muted){ try { el.pause(); } catch (e){} playing = false; } }, 300);
      } else {
        start();
      }
    },

    /* Called when a quest starts. name is a key of STAGE_TRACKS, or anything
       else for the default. Silent no-op if that track is already playing or
       has already been found missing. */
    setStage(name){
      if (!el || failed || swapping) return;
      const wanted = STAGE_TRACKS[name] && !missing.has(STAGE_TRACKS[name])
        ? STAGE_TRACKS[name] : TRACK;
      if (wanted === current) return;

      swapping = true;
      const resume = playing && !muted;
      setLevel(0, SWAP_MS * 0.45);
      setTimeout(() => {
        current = wanted;
        try { el.src = wanted; el.load(); } catch (e){}
        if (resume){ if (play()) setLevel(VOLUME, SWAP_MS * 0.55); }
        swapping = false;
      }, SWAP_MS * 0.45);
    },

    nowPlaying: () => current,

    duck(ms = 1200){
      if (!el || muted || !playing) return;
      clearTimeout(duckTimer);
      setLevel(VOLUME * 0.33, 140);
      duckTimer = setTimeout(() => setLevel(VOLUME, 600), ms);
    }
  };
})();
