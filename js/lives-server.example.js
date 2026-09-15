/* Optional lives server — keys the 5-lives pool to the visitor's IP address.
 *
 * The browser cannot read its own IP, so this is the only way to make lives
 * survive a cleared cache, a private window, or a second browser on the same
 * connection. Without it the game still works; lives just live in localStorage.
 *
 * Run:   node server/lives-server.example.js
 * Then in index.html, before the other scripts:
 *        <script>window.RUNE_LIVES_ENDPOINT = "http://localhost:8787";</script>
 *
 * No dependencies — plain Node, http module only.
 *
 * ---------------------------------------------------------------------------
 * Before you put this on the public internet, read this:
 *
 * 1. State is in a Map, so a restart refills everyone. Swap `store` for Redis,
 *    SQLite or Postgres. The interface is two methods, so it's a small change.
 * 2. Behind a proxy, CDN or load balancer, req.socket.remoteAddress is the
 *    proxy's IP and everyone shares one pool. Set TRUST_PROXY to true so it
 *    reads X-Forwarded-For instead — but only do that when a proxy you control
 *    sets that header, since clients can forge it otherwise.
 * 3. IP is a blunt key. Households, offices, schools, campus wifi and most
 *    mobile carriers share one address behind NAT, so those players share a
 *    pool of 5. In the Philippines especially, mobile CGNAT means a lot of
 *    players look like one IP. An account login is the accurate way to do
 *    this; IP is the approximation you asked for.
 * 4. Lock down ORIGIN below to your own domain before deploying.
 * ---------------------------------------------------------------------------
 */

const http = require("http");

const PORT        = process.env.PORT || 8787;
const ORIGIN      = process.env.ORIGIN || "*";      // set to "https://yourdomain.com"
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

const MAX = 5;
const REGEN_MS = 30 * 60 * 1000;

/* ---------- store (swap this for a real database) ---------- */
const map = new Map();
const store = {
  get: key => map.get(key) || null,
  set: (key, value) => map.set(key, value)
};

/* ---------- ip ---------- */
function clientIp(req){
  if (TRUST_PROXY){
    const fwd = req.headers["x-forwarded-for"];
    if (fwd) return String(fwd).split(",")[0].trim();
  }
  const raw = req.socket.remoteAddress || "unknown";
  return raw.replace(/^::ffff:/, "");            // unwrap IPv4-mapped IPv6
}

/* ---------- lives ---------- */
function load(key){
  const now = Date.now();
  let s = store.get(key) || { lives: MAX, nextAt: null };

  if (s.lives >= MAX){
    s = { lives: MAX, nextAt: null };
  } else if (s.nextAt){
    while (s.lives < MAX && now >= s.nextAt){
      s.lives++;
      s.nextAt += REGEN_MS;
    }
    if (s.lives >= MAX) s.nextAt = null;
  } else {
    s.nextAt = now + REGEN_MS;
  }

  store.set(key, s);
  return s;
}

function shape(s){
  return {
    lives: s.lives,
    max: MAX,
    msToNext: s.nextAt ? Math.max(0, s.nextAt - Date.now()) : 0
  };
}

function spend(key){
  const s = load(key);
  if (s.lives <= 0) return shape(s);
  if (s.lives === MAX) s.nextAt = Date.now() + REGEN_MS;
  s.lives--;
  store.set(key, s);
  return shape(s);
}

/* ---------- http ---------- */
const server = http.createServer((req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  if (req.method === "OPTIONS"){ res.writeHead(204, headers); return res.end(); }

  const key = clientIp(req);
  const path = (req.url || "").split("?")[0].replace(/\/$/, "") || "/";
  const send = body => { res.writeHead(200, headers); res.end(JSON.stringify(body)); };

  if (path === "/lives" && req.method === "GET")          return send(shape(load(key)));
  if (path === "/lives/spend" && req.method === "POST")   return send(spend(key));

  // Remove this route before deploying, or anyone can refill their own lives.
  if (path === "/lives/restore" && req.method === "POST"){
    store.set(key, { lives: MAX, nextAt: null });
    return send(shape(load(key)));
  }

  res.writeHead(404, headers);
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`Rune Fall lives server on http://localhost:${PORT}`);
  console.log(`Trusting proxy headers: ${TRUST_PROXY}`);
  console.log(`Allowed origin: ${ORIGIN}`);
});
