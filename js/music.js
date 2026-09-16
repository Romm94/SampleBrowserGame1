/* Background music — optional.
 *
 * Drop a looping track at assets/bgm.mp3 and it plays. If the file isn't there,
 * this does nothing at all and the game is unaffected, so the repo ships without
 * a large binary and without a licence obligation you didn't choose.
 *
 * Handles the two things that trip people up with game music on the web:
 *
 *  1. Autoplay is blocked. Every browser refuses audio until the user has
 *     interacted with the page, so this waits for the first tap or key rather
 *     than calling play() on load and logging an error.
 *  2. Music drowns the effects. The track ducks to a third of its volume for a
 *     moment whenever something loud happens, so combinations still land.
 *
 * See the README for what kind of track suits this game and where to license one.
 */
window.RuneMusic = (() => {
  "use strict";

  const TRACK   = "assets/bgm.mp3";
  const VOLUME  = 0.32;          // music sits well under the effects
  const FADE_MS = 900;

  /* Two things have to be true before a note can play: the track has finished
     loading, and the user has interacted with the page. Either can happen
     first, so both routes call maybeStart() rather than play() directly. */
  let el = null, available = false, userReady = false;
  let muted = false, started = false, duckTimer = null;

  function init(){
    el = new Audio();
    el.src = TRACK;
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;

    el.addEventListener("canplaythrough", () => { available = true; maybeStart(); }, { once: true });
    el.addEventListener("error", () => {
      available = false;          // no track shipped, or it failed to load
      el = null;
    });

    // browsers won't let audio start until the user has touched the page
    const wake = () => {
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("keydown", wake);
      userReady = true;
      maybeStart();
    };
    document.addEventListener("pointerdown", wake, { once: true });
    document.addEventListener("keydown", wake, { once: true });
  }

  function fadeTo(target, ms){
    if (!el) return;
    const from = el.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    const step = () => {
      if (!el) return;
      i++;
      el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
      if (i < steps) setTimeout(step, 50);
    };
    step();
  }

  /* never call play() on a track that hasn't loaded — in a browser that's a
     rejected promise, and in some environments it throws outright */
  function play(){
    if (!el) return false;
    try {
      const attempt = el.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
      return true;
    } catch (e){
      return false;
    }
  }

  function maybeStart(){
    if (!el || !available || !userReady || started || muted) return;
    if (!play()) return;
    started = true;
    fadeTo(VOLUME, FADE_MS);
  }

  return {
    init,
    isAvailable: () => available,

    setMuted(value){
      muted = !!value;
      if (!el) return;
      if (muted){
        fadeTo(0, 300);
        setTimeout(() => { if (el && muted){ try { el.pause(); } catch (e){} } }, 320);
      } else if (available && userReady){
        if (play()){ started = true; fadeTo(VOLUME, 500); }
      }
    },

    /* pull the music down briefly so a big moment can be heard over it */
    duck(ms = 1200){
      if (!el || muted || !started) return;
      clearTimeout(duckTimer);
      fadeTo(VOLUME * 0.33, 140);
      duckTimer = setTimeout(() => fadeTo(VOLUME, 600), ms);
    }
  };
})();
