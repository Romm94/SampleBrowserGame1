/* Falling leaves — ambient background layer.
   Independent of the game: no shared state, safe to delete this file and its
   <script> tag if you ever want the field bare. */
(() => {
  "use strict";

  const canvas = document.getElementById("leaves");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const COLORS = ["#d9a441", "#c2703c", "#e9c46a", "#a8443a", "#8a8f4a", "#b5622f"];
  // matchMedia is missing in some embedded webviews and test environments
  const calm = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false, addEventListener(){} };

  let leaves = [], w = 0, h = 0, dpr = 1, raf = null, last = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function count(){
    if (w < 560) return 14;        // phone
    if (w < 1000) return 24;
    return 34;
  }

  function spawn(seeded){
    // depth 0 = far (small, slow, faint), 1 = near (large, quick, solid)
    const depth = Math.random();
    return {
      x: rand(-40, w + 40),
      y: seeded ? rand(-40, h) : rand(-140, -20),
      size: 6 + depth * 12,
      alpha: 0.22 + depth * 0.4,
      fall: 12 + depth * 30,          // px per second
      swayAmp: rand(14, 46),
      swayRate: rand(0.25, 0.7),
      swayPhase: rand(0, Math.PI * 2),
      spin: rand(0, Math.PI * 2),
      spinRate: rand(-1.4, 1.4),
      tilt: rand(-0.5, 0.5),
      color: COLORS[(Math.random() * COLORS.length) | 0],
      drift: rand(-8, 8)              // slight lateral wind
    };
  }

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const target = count();
    while (leaves.length < target) leaves.push(spawn(true));
    leaves.length = target;
    if (calm.matches) draw();          // static scatter, no loop
  }

  function drawLeaf(l){
    const s = l.size;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.tilt + Math.sin(l.spin) * 0.5);
    // flattening on the horizontal axis reads as the leaf turning over mid-air
    ctx.scale(Math.cos(l.spin) * 0.85 + 0.15, 1);
    ctx.globalAlpha = l.alpha;

    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.92, -s * 0.45, s * 0.72, s * 0.62, 0, s);
    ctx.bezierCurveTo(-s * 0.72, s * 0.62, -s * 0.92, -s * 0.45, 0, -s);
    ctx.closePath();
    ctx.fill();

    // midrib and stem
    ctx.globalAlpha = l.alpha * 0.55;
    ctx.strokeStyle = "rgba(60,32,12,.9)";
    ctx.lineWidth = Math.max(0.6, s * 0.07);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.8);
    ctx.lineTo(0, s * 1.25);
    ctx.stroke();

    ctx.restore();
  }

  function draw(){
    ctx.clearRect(0, 0, w, h);
    for (const l of leaves) drawLeaf(l);
  }

  function step(now){
    const dt = Math.min((now - last) / 1000, 0.05);   // clamp after a tab switch
    last = now;

    for (const l of leaves){
      l.y += l.fall * dt;
      l.swayPhase += l.swayRate * dt;
      l.x += (Math.sin(l.swayPhase) * l.swayAmp * l.swayRate + l.drift) * dt;
      l.spin += l.spinRate * dt;

      if (l.y - l.size > h){
        Object.assign(l, spawn(false));
      } else if (l.x < -60){
        l.x = w + 50;
      } else if (l.x > w + 60){
        l.x = -50;
      }
    }

    draw();
    raf = requestAnimationFrame(step);
  }

  function start(){
    if (raf || calm.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }
  function stop(){
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = null;
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  calm.addEventListener("change", () => { stop(); resize(); start(); });

  resize();
  start();
})();
