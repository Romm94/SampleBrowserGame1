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

  return {
    context,
    /* call from inside a user gesture */
    unlock(){
      const c = context();
      if (c && c.state === "suspended") c.resume().catch(() => {});
      return c;
    }
  };
})();

window.RuneMusic = (() => {
  "use strict";

  const TRACK   = "assets/bgm.mp3";
  const VOLUME  = 0.32;
  const FADE_MS = 900;

  let el = null, gain = null, routed = false;
  let muted = false, playing = false, duckTimer = null, failed = false;

  function init(){
    el = new Audio();
    el.src = TRACK;
    el.loop = true;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.setAttribute("playsinline", "");      // iOS: don't hand it to the video player
    el.volume = 1;                           // real level is set on the gain node

    el.addEventListener("error", () => { failed = true; });

    // first touch anywhere is our chance to start
    const wake = () => {
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("keydown", wake);
      start();
    };
    document.addEventListener("pointerdown", wake, { once: true });
    document.addEventListener("keydown", wake, { once: true });
  }

  /* Route the element through a gain node so volume works on iOS. Must happen
     while a context exists; if it fails we fall back to el.volume, which is
     fine everywhere except iOS. */
  function route(){
    if (routed || !el) return;
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
             .catch(() => { playing = false; });   // still blocked, try again next tap
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

    duck(ms = 1200){
      if (!el || muted || !playing) return;
      clearTimeout(duckTimer);
      setLevel(VOLUME * 0.33, 140);
      duckTimer = setTimeout(() => setLevel(VOLUME, 600), ms);
    }
  };
})();
