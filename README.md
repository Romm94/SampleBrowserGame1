# Rune Fall — Slimes of Midgard

A match-3 puzzle game in the browser. Norse fantasy field, cute slime creatures, rune
power-ups, timed quests and a regenerating pool of lives. No build step, no framework, no
npm install — plain HTML, CSS and JavaScript.

![The six slimes and the four runes](assets/sprites.png)

## Run it

Double-click `index.html`. That's the whole setup.

Once you start editing, serve it instead so the browser stops caching your CSS and JS:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To publish, upload the folder anywhere that serves static files — GitHub Pages, Netlify,
Cloudflare Pages, Vercel, or ordinary shared hosting. Nothing to compile.

The optional lives server in `server/` is separate and only needed if you want IP-keyed
lives. See [Lives](#lives) below.

## How to play

Swap two neighbouring slimes by tapping one then the other, or by swiping. Line up three or
more of the same colour and they pop. Bigger matches leave a rune behind:

| Match | Leaves | What it does |
| --- | --- | --- |
| 4 in a row | Row rune | Clears its entire row |
| 4 in a column | Column rune | Clears its entire column |
| 5 in an L or T | Bomb rune | Blasts the surrounding 3×3 |
| 5 in a straight line | Rainbow orb | Swap it with any slime to erase every slime of that colour |

### Combining runes

Swap two runes into each other and they combine into something bigger. The combinations
follow the conventions players already know from other match-3 games:

| Swap | Result |
| --- | --- |
| Line + line | Clears the full row **and** column through that cell |
| Line + blast | Sweeps three rows and three columns |
| Blast + blast | Levels a 5×5 area |
| Orb + line | Every slime of the line rune's colour becomes a line rune, then they all fire |
| Orb + blast | Every slime of that colour becomes a blast rune, then they all fire |
| Orb + orb | Clears the entire board |

### Combo praise

A combo is everything one move destroys — the match or blast that starts it, plus every
cascade it sets off. Counted in tiles, not in cascade depth.

| Tiles | Word |
| --- | --- |
| 12–15 | Substantial |
| 16–30 | Supreme |
| 31–50 | Immortal |
| 51–75 | Ascendant |
| 76–99 | God! |
| 100+ | God-slayer! |

Cascade depth was the obvious metric and the wrong one: measured over 120 bot moves, the
deepest cascade was **2**, so thresholds in the tens could never be reached. Tiles cleared
climbs into the hundreds once orb combinations are involved, which makes the whole ladder
usable. `PRAISE_ON` in `js/game.js` still switches back if you want the old behaviour.

Each tier has its own recorded clip in `assets/sfx/`, played through the shared audio context
as a decoded buffer so clips can overlap with no latency. If a file won't load, the
synthesised ladder in `PRAISE_SFX` plays instead — the game never goes quiet because an asset
is missing.

The clips were processed before use: leading silence trimmed (some had up to 1.2 s of it,
which would have fired the sound noticeably after the event), tails capped and faded, and each
one normalised to a deliberate ladder so the tiers escalate. The raw set arrived spanning
15 dB with "God!" as the *quietest* of the six.

The synthesised fallback ladder climbs one musical step at a time
rather than simply getting louder — a bare fifth, a triad, the triad an octave up, the full
octave stack, then drums underneath — all in the same key so two tiers firing in one chain
don't clash. The top two tiers also shake the board and throw sparks.

When a rune combination starts the chain, the banner keeps its name and adds the praise to it:
*Twin blast · Immortal ×34*. The name says what you did, the praise says how big it got.

Each combination is named on screen as it fires. Two runes sitting next to each other always
count as a legal move even when they'd make no match, so the board won't declare itself stuck
while a combination is available, and the hint will point one out.

Runes caught in another match set each other off, so chains are worth building. Each quest
asks you to collect a set number of specific slimes before **both** the move budget and the
clock run out. The board reshuffles itself if no valid move is left. There's a hint button,
and an idle nudge fires after eight seconds if you stall.

## Objectives

Quests ask for one of three things, and often a blocker goal alongside it:

| Goal | What it wants | Appears |
| --- | --- | --- |
| Collect | A number of slimes of one to three colours | Most quests |
| Score | A zeny total earned within the quest | Every 5th quest |
| Blockers | Every frost and bramble cleared off the board | Quest 3 onward |

**Frost** sits on a cell and chips away when you clear a match on top of it. **Bramble** locks
its cell — you can't swap that slime until something clears it, so you have to work a match
into it from around the outside. All blockers belong to the cell rather than the slime, so
slimes fall through them normally and gravity is untouched.

**The creeper vine** is different: it's pressure, not an objective. It spreads to a
neighbouring cell on a timer, locking whatever it covers. Cutting any of it resets the timer;
cutting all of it stops the spread for the rest of the quest, so it rewards dealing with it
early. It is deliberately excluded from the blocker goal — counting something that grows would
make the target move while you chase it. It can never take the last legal move either: a shoot
that would strangle the board is withdrawn, and it stops at 14 cells.

### Reading an obstacle at a glance

An obstacle is information, not decoration: it has to be identifiable at 40px, over a bright
slime, on a patterned board. Three things carry that, in order of importance:

1. **A coloured border** — icy white-blue for frost, red for bramble, green for creeper. The
   border does the identifying, which is why the fill behind it is kept light (around 38%).
   An opaque plate reads beautifully and breaks the game: you have to see the slime under a
   frost to know what will clear it, and a match can form through a locked cell.
2. **A strike through locked cells** — bramble and creeper get a diagonal bar, so "you can't
   swap this" is legible without recognising the artwork at all.
3. **Motion** — the creeper breathes, because it's the only one that spreads. Frost and
   bramble sit still. Disabled under `prefers-reduced-motion`.

The board's own tree vine was the main thing making these hard to spot: at half opacity and
full saturation, brown-and-green scenery looks exactly like a bramble or a creeper. It now
sits at 17% opacity and 35% saturation. The checkerboard was also nearly flat (`#191338`
against `#1e1740`) and has been opened up, which helps every piece on the board read.

The weakest remaining pairing is a moss slime under a creeper — green on green. If that proves
a problem in play, the creeper border is the thing to push further, not the fill.

### Regions

The road runs through nine regions of ten stages each. Every region has its own obstacles, its
own name and its own music slot, so a stretch of the game has a character rather than a
difficulty number. Past stage 90 the regions repeat with the clock still tightening.

| Stages | Region | Obstacles | Board | Cells |
| --- | --- | --- | --- | --- |
| 1–10 | Snowy Days | Frost | Square | 64 |
| 11–20 | Thorny Forest | Bramble | Pentagon | 52 |
| 21–30 | Moving Jungle | Creeper vine (fast) | Octagon | 52 |
| 31–40 | Tricky Alps | Frost + bramble | Trapezoid | 52 |
| 41–50 | Deadly White Plains | Frost + creeper (fast) | Hexagon | 60 |
| 51–60 | Endless Desert | Frost + sand pit | Rhombus | 40 |
| 61–70 | Drunken Oasis | Bramble + sand pit | Decagon | 48 |
| 71–80 | The Labyrinth | Sand pit + creeper (fast) | Cross | 48 |
| 81–90 | Doors of Svartalheim | Frost + creeper + sand pit (fast) | Diamond | 40 |

Each region also has its own artwork, shown faintly behind the board and as a thumbnail on the
map.

Counts climb within a region, and a region with two or three obstacles gives each a smaller
share so they don't simply add up. The **Map** button shows the whole road, which region you're
in and how far through it you are.

The heading above the goals names the region; the line under it gives the stage and your
position in it — *Stage 34 · 4 of 10*.

### Board shapes

The grid stays 8×8; a region's shape is a mask over it, and only the cells inside the shape are
drawn. A hole is genuinely absent — no socket, no tile, no match can run through it.

**One rule governs every mask: each column's cells must be one unbroken run.** Gravity drops
tiles down a column and refills from the top, so a hole part way down would cut a column in
two and the part below could never be refilled — it would slowly empty and the stage would
deadlock. `test/features.js` checks this for all nine shapes, and any new shape must pass it.

Everything that touches the board honours the mask: building, gravity, refills, legal moves,
blocker placement, where the vine can spread, and the reshuffle, which redeals into the cells
that already hold tiles rather than across the whole grid.

Goals soften on a smaller board, but **not in proportion to its cell count**. Scaling straight
down by cells made the 40-cell shapes clear in a third of their move budget: a narrow board
cascades more than its size suggests, because short columns refill into each other. The
adjustment is the square root of the cell ratio, which measured out in line with the full-size
boards — 11 and 12 moves of an 18-move budget, against 11 to 16 on the big shapes. Obstacle
counts scale the same way, as does the creeper's cap.

*Rhombus and diamond are the same figure geometrically, so they're drawn differently here: the
rhombus leans as a parallelogram, the diamond sits point-up. The decagon is an approximation —
ten true edges don't fit an 8×8 grid.*

### The sand pit

From the Endless Desert onwards, sand pits open on the board. A pit locks its cell like a
bramble, but that isn't the threat. **A pit swallows a rune charge you are holding.** Sit on
your charges with a pit open and the sand takes one, every 9 to 20 seconds depending on how
deep into the region you are. Spend them or lose them.

Clearing every pit stops it for the rest of the stage. Pits count toward the blocker goal —
they're static and clearable, unlike the creeper.

## The stage clock

Every quest is timed, and the clock is derived from the quest itself rather than set by hand:
more slimes to collect means more time, but each quest tightens the belt slightly. The bar
turns red at 20% remaining.

Clearing fast pays. Time left is multiplied by a speed tier:

| Time remaining | Tier | Bonus multiplier |
| --- | --- | --- |
| 50% or more | Swift | ×2 |
| 25–50% | Steady | ×1.5 |
| under 25% | Narrow | ×1.15 |

The bonus is `secondsLeft × (18 + questNumber × 4) × multiplier`, so the same speed is worth
progressively more as quests get harder.

**If the clock hits zero, the quest fails and it costs one life.** Running out of moves does
the same, as does pressing "Give up" — all three are failures and all three cost a life. If
you'd rather only the timer cost a life, remove the `failStage` calls from `endOfTurn()` and
the restart button in `js/game.js`.

## Learning the game

The first time a player meets each system — the basics, their first rune, two runes on the
board at once, frost, bramble, a score quest, carried charges — a short tip appears over the
board and never appears again. Which tips have been seen is stored with progress, so it
survives a refresh and resets with "start over".

The **?** button opens the full rules at any time. This matters on phones, where the side
legend is hidden for space: without it the combination rules would be unreachable on mobile.

**The clock keeps running while the rules are open.** Checking the FAQ mid-quest costs you
time, which is the point — the rules are there to be read before you need them. The creeper
does stop spreading, though: losing board to an obstacle while reading is a punishment out of
proportion to the mistake.

The shop is the opposite: it pauses both the clock and the vine, because deciding what to buy
shouldn't be a race. That does mean a player can pause indefinitely by opening the shop. It's a
deliberate trade — if it gets abused, restricting the shop to between quests is the fix.

## Zeny

Zeny is deliberately scarce. A quest pays roughly 2,500 — measured, not guessed — against shop
prices from 260 to 1,400, so a run buys one or two things rather than everything. Four
constants at the top of `js/game.js` set the whole economy: `PAY_TILE`, `PAY_ORB`, `PAY_COMBO`
and `PAY_CHIP`, plus the speed bonus in `completeQuest()`. Raise them together or the balance
between ordinary matches and combinations shifts.

### The shop

The **Shop** button opens mid-quest and pauses both the clock and the creeper while it's open.

| Item | Cost | Notes |
| --- | --- | --- |
| Five more moves | 260 | Added to the quest you're on |
| Thirty more seconds | 300 | Added to the clock |
| Row rune | 420 | A charge you place on any slime |
| Column rune | 420 | A charge you place on any slime |
| Blast rune | 520 | A charge you place on any slime |
| One life | 1,400 | Only offered below five lives |

Everything is applied immediately; nothing carries a timer of its own. Items you can't use
right now — a life at full lives, a rune at five charges — show as unavailable rather than
disappearing, so the shop reads the same every time.

A warning about the life: in server mode `RuneLives.grant()` posts to `/lives/grant`, and the
example server hands one out to anyone who asks. That's fine for a local demo and useless in
production. **The server has to hold the zeny balance and do the deduction itself**, or a
player can mint lives with a single `curl`. It's commented at the route.

## Zeny, and buying your way out

Zeny is a wallet, not a run score. It survives failing a quest, because otherwise you could
never save enough to spend it.

When you run out of moves or time, you're offered a continue before a life is taken:
`+5 moves` or `+30 seconds` for zeny. The first costs 1,200, and each further continue in the
same quest doubles. Decline it, or fail to afford it, and you lose a life instead and the
quest restarts. Giving up deliberately always costs a life — no continue offered.

Continues are the reason the score bonus matters. Clearing fast earns the zeny that buys you
out of a bad board later.

## Music and sound

Every sound effect is generated at runtime with the Web Audio API. Combinations get their own
sounds: a two-note chord for a cross, a rising arpeggio for a rune storm, filtered noise for
the big blasts.

Music and effects have separate toggles in the tools row, and both preferences are saved with
your progress.

### Why mobile audio is fiddly

Phones, iOS in particular, impose three rules that between them stop a naive implementation
from ever making a sound, and an earlier version of `js/music.js` broke on all three:

1. `play()` must be called **inside** a user gesture. Calling it from a `canplaythrough`
   handler that happens to fire later does not count.
2. iOS refuses to preload media, so `canplaythrough` may never fire. Gating playback on it
   means the track never starts — which is exactly why the music button did nothing on a phone.
3. iOS **ignores `HTMLMediaElement.volume`**. Assigning to it does nothing, so fading and
   ducking have to run through a Web Audio `GainNode`.

The fix routes the audio element through a gain node, calls `play()` straight from the button
handler, and never waits on a load event. Effects and music now share a single `AudioContext`
via `window.RuneAudio`, because browsers cap how many you may open and iOS starts them
suspended until a gesture resumes one.

### Obstacle sounds

`blocker-frost`, `blocker-bramble` and `blocker-creeper` fire when one is chipped, quieter
when it survives the hit than when it breaks. They sit at −20 LUFS, below the praise ladder,
because they fire many times a quest and anything louder becomes wearing.

### Music per band

Each obstacle band can have its own track. Drop any of these in and it's used; leave it out and
that band keeps the default. Nothing breaks either way, and only `bgm.mp3` is required.

| File | Bands |
| --- | --- |
| `assets/bgm.mp3` | required; the fallback for everything |
| `assets/bgm-frost.mp3` | Snowy Days |
| `assets/bgm-bramble.mp3` | Thorny Forest |
| `assets/bgm-vine.mp3` | Moving Jungle |
| `assets/bgm-alps.mp3` | Tricky Alps |
| `assets/bgm-plains.mp3` | Deadly White Plains |
| `assets/bgm-desert.mp3` | Endless Desert |
| `assets/bgm-oasis.mp3` | Drunken Oasis |
| `assets/bgm-labyrinth.mp3` | The Labyrinth |
| `assets/bgm-svartalheim.mp3` | Doors of Svartalheim |

Tracks change at the start of a quest with a short fade down and back up. A file that 404s is
noted once and never requested again, so a half-finished set costs nothing.

Background music plays from `assets/bgm.mp3`. `js/music.js` waits for both the track to load
and the first tap before playing, since browsers block audio until the user interacts, and it
ducks to a third of its volume during combinations and the warp so the effects still land. The
`♪` button mutes music and effects together. Remove the file and the game runs silently with
no errors — the module handles its absence.

### The included loop

The shipped track was prepared from a supplied recording:

| | |
| --- | --- |
| Length | 82.5 s, seamless loop |
| Loudness | −16.5 LUFS integrated, −1.5 dBTP ceiling |
| Format | MP3, 128 kbps stereo, 44.1 kHz |
| Size | 1.26 MB |

The source was two minutes with a ten-second fade in and a fade to silence at the end. Looped
as-is that would drop to near-silence for several seconds every two minutes, so the fades were
trimmed to the sustained section (18 s to 106.5 s) and the tail was crossfaded over the head
with a six-second equal-power curve. The seam sits within 2.2 dB, which is inaudible for
ambient material. It was then normalised from −24.7 LUFS up to −16.5.

To replace it, drop in a new `assets/bgm.mp3`. The same recipe, if you want to prepare one the
same way, is in the git history of this README and amounts to: trim to the sustained part,
overlap-add the tail onto the head, two-pass `loudnorm` to −16 LUFS, encode at 128 kbps.

**Licensing:** whatever track ships here needs to be one you have the right to distribute.
Nothing else in this project carries a third-party licence — the art is original and the
setting is generic Norse rather than any particular game's world — so the audio is the one file
that could create an obligation. If the track is under CC-BY, credit belongs in the help
overlay.

### Choosing a track

What suits this game: a calm, loopable instrumental at **70–90 BPM**, no vocals, no strong
melodic hook. Players will hear it for twenty minutes at a stretch while concentrating, so
anything with a memorable tune becomes irritating fast — you want texture, not a song. For the
Norse setting, try nyckelharpa, frame drum, low strings, or soft synth pads. Aim for a **60–120
second seamless loop** at around −16 LUFS so it sits under the effects, exported as a mono or
low-bitrate stereo MP3 kept **under 2 MB** — mobile players in the Philippines are often on
metered data, and a 12 MB track is a real cost to them.

Where to get one, in the order I'd try:

| Source | Terms | Notes |
| --- | --- | --- |
| [Kevin MacLeod / Incompetech](https://incompetech.com) | CC-BY, or paid to skip attribution | Large catalogue, several Nordic and folk pieces |
| [Free Music Archive](https://freemusicarchive.org) | Per-track, mostly CC | Check each licence individually |
| [OpenGameArt](https://opengameart.org) | CC0 / CC-BY | Written for games, so loops are usually clean |
| [Pixabay Music](https://pixabay.com/music/) | Free for commercial use | Quality varies; audition carefully |
| [Epidemic Sound](https://www.epidemicsound.com) or [Artlist](https://artlist.io) | Paid subscription | Worth it if the game is ever monetised |

Two warnings. **YouTube's audio library is not a general licence** — those tracks are cleared
for YouTube videos, not for embedding in a game. And under CC-BY you must credit the composer
somewhere the player can see it; a line in the help overlay is the natural spot, and leaving it
out is a licence breach even though nobody is likely to notice.

If you'd rather ship nothing, the game is complete without music. The effects carry it.

## Progress

Your quest number, zeny and carried rune charges are saved as you play, so closing the tab
mid-run loses nothing. Returning shows a "welcome back" screen with the option to continue or
start over from quest 1.

This is stored in `localStorage` via `js/progress.js`, deliberately separate from lives: lives
are a rate limit a player has reason to cheat, so they belong on a server, while progress
exists for the player's benefit and there's nothing to protect.

## Unused moves become rune charges

Finishing a quest early converts what's left of your move budget into carried power-ups.
Every 6 unused moves is one rune charge, at most 2 from a single clear, up to a ceiling of 3
held at once.

Those numbers used to be 3, unlimited and 5, which made the game easier the better you played:
a fast clear already earns a speed bonus in zeny, and handing over five runes on top of it
meant the next stage could be coasted. Paying twice for the same skill flattened the
difficulty curve just as it was supposed to bite. Charges carry forward across quests and accumulate.

Spend one by pressing the rune charge button and then tapping any slime on the board: it
becomes a bomb rune, no move consumed. It sits there until you match it, so you choose when
it goes off. Failing a quest forfeits all held charges.

Both ratios are constants at the top of `js/game.js`:

```js
const MOVES_PER_CHARGE = 3;    // unused moves per charge
const MAX_CHARGES      = 5;    // ceiling on charges held
```

A 1:1 conversion is tempting but breaks the game — 20 spare moves would mean 20 free bombs.

## The warp

Clearing a quest plays a transition rather than a dialog box, and it **waits for you** at the
end — the next stage starts when you press Continue, not on a timer. The clock is stopped
there, so there is no cost to taking a breath, checking the map or visiting the shop between
stages. Arriving in a new region is announced by name on that card. Tiles spiral out from the
centre in a ring-shaped stagger, a portal opens, and two cards pass through it: your clear
summary — time left, speed bonus, charges earned — then the next quest's objective, showing
what you'll be collecting, the move budget, the clock and any charges you're carrying in.
The new board falls in through the portal on a diagonal stagger.

The whole sequence runs about 4.5 seconds. Timings are the `sleep()` calls in `warp()` in
`js/game.js`; the visuals are the `.warp` rules in `css/styles.css`.

## Lives

Five lives. Losing a quest costs one. A life comes back every 30 minutes, and the timer keeps
running whether or not the page is open, so closing the tab and coming back later works as
you'd expect. Lives are restored one at a time, and multiple lives owed are all credited on
return. At zero lives the board locks and a live countdown to the next life replaces the
board; when one lands, the overlay switches to a button and you're back in.

The countdown also resists a common trick: if the system clock jumps backwards, the wait is
capped at 30 minutes rather than becoming permanent.

### About keying lives to an IP address

You asked for lives tied to the visitor's IP so a refresh can't reset them. Worth being
straight about how far a browser can go here:

**A web page cannot read the visitor's IP address.** There's no browser API for it, by
design. Anything stored client-side is scoped to a browser profile, not a connection. So the
game ships in **local mode**: lives persist in `localStorage`, which survives refreshes,
tab closes and reboots, but not a cleared cache, a private window or a different browser.

For real IP-keyed lives you need a server, so one is included: `server/lives-server.example.js`.
It's plain Node with no dependencies, keeps the pool keyed by IP, and does the regeneration
server-side where a player can't touch it.

```bash
node server/lives-server.example.js
```

Then uncomment this line in `index.html`, above the other script tags:

```html
<script>window.RUNE_LIVES_ENDPOINT = "http://localhost:8787";</script>
```

`js/lives.js` will use the server when that's set and fall back to local storage if the
server is unreachable, so the game never hard-fails on a bad connection.

Four things to know before putting that server on the public internet — all of them are also
written at the top of the file:

1. **State is in a `Map`**, so restarting the server refills everyone. Swap the `store`
   object for Redis, SQLite or Postgres; it's two methods.
2. **Behind a proxy or CDN**, `remoteAddress` is the proxy's IP and every player shares one
   pool. Set `TRUST_PROXY=true` to read `X-Forwarded-For` — but only when a proxy you
   control sets that header, since clients can otherwise forge it.
3. **IP is a blunt key.** Households, offices, schools and most mobile carriers put many
   people behind one address via NAT. In the Philippines, mobile CGNAT means a large number
   of players can look like a single IP and share one pool of 5. If accurate per-player
   lives matter, an account login is the real answer; IP is the approximation.
4. **The `/lives/restore` route refills on demand.** Delete it before deploying.

## Telemetry

The balance work so far has leaned on a test bot that plays one move deep and never spends a
rune charge — so its numbers are a floor, and some questions (above all, whether the blocker
goal is too hard) it could never settle. Telemetry replaces that guessing with what real
players did.

**One record per stage**, written when the stage ends. It holds: stage and region, how it
ended (cleared, out of time, out of moves, gave up), moves and seconds budgeted and left, each
goal's progress, blockers placed and cleared, rune charges earned, placed, bought and lost to
sand, continues and shop spending, the biggest chain and praise reached, lives left, frame rate,
and screen size.

It is **off unless you turn it on**:

```bash
npm run telemetry-server        # listens on :8788, writes data/telemetry.ndjson
```

then uncomment `window.RUNE_TELEMETRY_ENDPOINT` in `index.html`. Without it, records are still
kept in the browser (the last 50) so you can read your own sessions while developing:

```js
RuneTelemetry.dump()            // in the browser console
```

### Reading it

```bash
npm run report                  # everything collected
npm run report -- --since 7     # the last week
```

The report is built around the questions this project couldn't answer:

1. **Is the blocker goal too hard?** It counts losses where *every other goal was done and only
   the blocker goal was short* — the clean signal. With at least ten losses it gives a verdict.
2. **By region** — clear rate, moves and seconds left on a clear, continues bought.
3. **How stages end**, and the five hardest stages.
4. **How far players reach** — where people stop.
5. **Economy** — zeny per cleared stage, continues, what gets bought, runes lost to sand.
6. **Praise** — how often each tier is reached, and the biggest chain seen.
7. **Performance** — average frame rate on touch and desktop, the share of stages below
   30 fps, and hitches per stage. This is the cheap-phone check, answered by real phones.

### Privacy

Collection is designed to hold as little as possible, which is also the simplest way to stay on
the right side of the Philippine Data Privacy Act:

- **No IP address is stored.** The lives server keys on IP because it has to; the telemetry
  server has no reason to and never writes one.
- **No name, account, or device fingerprint.** The player is a random id generated in their
  own browser. Clearing storage makes a new one.
- **The server keeps only known fields.** Every record is rebuilt from a whitelist, so a
  modified client can't use the endpoint to store anything else. Oversized or malformed
  batches are refused, and each id is rate-limited.
- **Players can switch it off.** When collection is on, the help overlay says what's sent and
  offers a toggle. Opting out also clears anything waiting to be sent.
- **Collected data stays out of the repo** — `data/` is in `.gitignore`.

Before going public, you still need to publish a short privacy notice saying what's collected
and why, and pick a retention period. `npm run report -- --prune 90` deletes anything older than
90 days; run it on a schedule. This isn't legal advice — if the game grows, have someone
qualified look it over.

### Sending

Records go out with `navigator.sendBeacon`, so a stage that ends as the tab closes still gets
through, falling back to `fetch` with `keepalive`. A failed send waits in a local queue (up to
50) and goes with the next one. Every call into the module is wrapped, so a problem in
telemetry can never reach the game.

## Balance

`test/balance.js` plays quests with a bot that reads the board out of the DOM, aims at
blockers, respects every locked cell kind (`LOCKED` in `test/bot.js` — keep it in step when a
new obstacle locks its cell, or the bot proposes illegal swaps all quest and the numbers look
catastrophic), and never uses rune charges — one move deep, no cascade planning. It's deliberately
worse than a competent person, so a goal the bot reaches is one a player reaches comfortably.

```bash
npm run balance          # quests 5, 10 and 15
npm run balance 3 7 12   # specific quests
node test/balance.js --blind 7   # the naive bot, for comparison
```

This harness caught a real bug. The original goal curve asked for 42 slimes of each of three
colours by quest 7 — but with six colours only about one cleared tile in six matches a given
goal, and a move clears roughly 4.5 tiles. The quest was asking for 126 tiles when the board
could yield about 61. **Every quest past the second was mathematically unwinnable**, and no
amount of playtesting the first two levels would have shown it.

Goal sizes now come from that arithmetic: `moves × 0.75` per colour, scaled by a pressure
factor. Difficulty rises through the colour count, the shrinking clock and the blockers rather
than through a number the board can't produce.

| Quest | Colours | Each | Total asked | Board can yield | Blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 16 | 16 | 22 | — |
| 5 | 3 | 16 | 48 | 63 | 2 |
| 10 | 3 | 17 | 51 | 58 | 5 |
| 20 | 3 | 15 | 45 | 47 | 8 |

Score targets are derived the same way, at 220 zeny per move of budget against a measured bot
average near 300.

## Testing

`test/smoke.js` boots the real `index.html` in jsdom, clicks Begin, plays a turn via the
hint system, and spends a life. It catches runtime errors that a syntax check can't — a
function called before the data it reads exists, a handler that never gets attached because
an exception killed the script above it.

```bash
npm install     # jsdom, the only dev dependency
npm test        # smoke + features
```

`test/features.js` covers the newer systems in separate browser instances: saved progress
restoring, blockers placing and chipping, bramble cells refusing selection, score quests, the
continue offer and its zeny charge, and the no-zeny path that spends a life instead. It speeds
up `performance.now` to drain a stage clock in seconds so timeouts are testable.

`test/viewport.js` boots at real device dimensions and checks the board fits across the
screen, stays tappable, and leaves room for the HUD. It's honest about its limit: jsdom has no
layout engine, so it verifies the sizing arithmetic — the usual cause of "cut off on mobile" —
but cannot see visual clipping. Stacking order still needs a real device.

`test/bot.js` is shared by the harnesses.

It serves the folder on a random port during the run, because jsdom refuses `localStorage`
on `file://` origins. Exit code is non-zero if anything fails. Worth running before you
deploy, since a thrown error during boot leaves the Begin button dead with nothing on screen
to explain why.

## Project structure

```
rune-fall/
├── index.html              markup, HUD, overlays, shared SVG gradient defs
├── css/
│   └── styles.css          palette tokens, board, timer, warp, animations
├── js/
│   ├── game.js             board, matching, quests, timer, warp, charges, blockers
│   ├── lives.js            5 lives, 30-minute regen, local or server-backed
│   ├── telemetry.js        one anonymous record per stage, opt-out, local log
│   ├── progress.js         quest number, zeny, charges and seen tips
│   ├── music.js            optional background track, ducking and autoplay
│   └── leaves.js           falling-leaf background, independent of the game
├── server/
│   ├── lives-server.example.js      optional IP-keyed lives, plain Node
│   ├── telemetry-server.example.js  collects stage records, stores no IP
│   └── telemetry-report.js          turns them into tuning answers
├── test/
│   ├── smoke.js            headless boot-and-play check
│   ├── features.js         progress, blockers, score quests, continues
│   ├── balance.js          bot playthroughs for tuning goal sizes
│   ├── viewport.js         board sizing across device dimensions
│   ├── telemetry.js        server validation, privacy, client recording, report
│   └── bot.js              shared board reader and move chooser
├── assets/
│   ├── sprites.png         tile art atlas, 5x3 cells of 128px
│   ├── regions.jpg         nine region illustrations, 3x3 atlas
│   ├── bgm.mp3             looping background track
│   └── favicon.svg         browser tab icon
├── package.json
├── README.md
└── .gitignore
```

Tile art comes from `assets/sprites.png`, a single 640×384 atlas of thirteen 128px cells: six
slimes, the orb, three blockers (frozen, bramble, creeper) and the three power-up logos. One
file means one request and one decode.

There is now **one set of power-up logos**, used everywhere — on the board as a mark over the
slime, in the picker, in the legend and in the shop. The earlier full-colour rune sprites were
dropped, which also took the atlas from 640×512 down to 640×384.
The `.art-*` rules in the stylesheet map each name to its `background-position`; `TYPES` in
`js/game.js` holds the key and the debris colour for each slime.

A rune has to keep its slime's colour, or you couldn't tell what it matches, so the logo is
laid over the slime at 76% of the cell with a glow and the slime underneath is dimmed slightly.
At full bleed the mark crowded the slime and neither read well.

The orb is the rarest thing on the board — roughly one appears every sixty moves — so it
carries a slow pulse and a glow to make it obvious when one does show up.

The board's own surface carries an old brown tree vine, drawn as an inline SVG behind the
slimes at half opacity so it reads as part of the board rather than as something in the way.

Each tile publishes `data-type` and `data-special`, which is how the test bot reads the board
without reaching into the game's closure.

## Tuning

**Tile art** — replace `assets/sprites.png`, keeping the 5×2 layout and the order
ember, amber, moss, frost, wraith, bone, row, col, bomb, orb. `TYPES` in `js/game.js` maps each
slime to its atlas key and its spark colour; the `.art-*` rules set the positions.

**Board vine** — the `.board::before` rule. It's an inline SVG data URI stretched to the board,
so redrawing it means editing that one path set.

**The creeper** — `creeper` and `creeperEvery` in `questFor()`'s plan, `CREEPER_CAP` at the top
of `js/game.js`. Growth logic is `growCreeper()`. Change any of it and re-run
`npm run balance 12 20`; a spreading obstacle is the easiest way to make a quest quietly
unwinnable.

**Board size** — `ROWS` and `COLS` in `js/game.js`. The CSS is driven by a `--cell` variable
that `fit()` recalculates, so an odd board like 7×9 works without touching the stylesheet.

**Board shapes** — the `SHAPES` table in `js/game.js`. Add one as eight strings of eight
characters, `#` for a cell and `.` for a hole, then name it on a region. Run `npm test` — the
column-contiguity check will tell you straight away if gravity can't handle it.

**Regions** — the `REGIONS` table and `obstaclesFor()` in `js/game.js`. Each entry is a
starting stage, a name, the obstacle kinds it uses, its music slot, its board shape and which
cell of `regions.jpg` illustrates it; `fast` shortens the
creeper's spread timer. Add a region by adding a row — the map, the heading and the music
lookup all read from it.

**The sand pit** — `sandpit` and `sandEvery` in the plan, `swallowCharge()` for the behaviour.

**Difficulty curve** — `questFor(n)` returns the colours, goal sizes, blocker plan and move
budget; `timeFor(q, n)` derives the clock from all of it. Change anything here and re-run
`npm run balance` — the numbers are tied to measured clearing rates, not intuition.

**Continues** — `CONTINUE_BASE`, `CONTINUE_MOVES` and `CONTINUE_SECONDS` at the top of
`js/game.js`. The cost doubles per continue within a quest.

**Blockers** — the `plan` object in `questFor()`. `frostHp` above 1 makes frost take several
matches; balance runs showed 2 made the blocker goal the only thing that mattered, so it's 1.

**Lives and regeneration** — `MAX` and `REGEN_MS` at the top of `js/lives.js`, mirrored in
`server/lives-server.example.js`. Change both or they'll disagree.

**Scoring** — `clear.size * 60 * combo` in `resolve()`, 80 per tile for a plain orb
detonation, 100 for a rune combination, and the speed bonus in `completeQuest()`.

**Combination effects** — `comboFx()` in `js/game.js` maps each combination to its sound,
shockwave reach, spark count and screen shake. All of it is skipped under
`prefers-reduced-motion`.

**Onboarding tips** — the `TIPS` object in `js/game.js`. Add an entry, then call `tip("id")`
wherever the player first meets that thing.

**Combinations** — `comboOf()` decides which pairing was swapped and `comboCells()` builds the
area it destroys. Both are near the bottom of `js/game.js`, next to the shared `detonate()`
that every explosion routes through.

**Falling leaves** — `js/leaves.js`. `COLORS` sets the palette, `count()` sets density per
viewport width, `spawn()` controls fall speed, sway, spin and opacity. Shares nothing with
the game, so you can delete the file and its `<script>` tag for a bare field.

**Theme palette** — the `:root` block in `css/styles.css`.

## Phones and tablets

The layout has three modes, and the board is sized by `fit()` in `js/game.js` to suit each:

| Screen | Layout | Board gets |
| --- | --- | --- |
| 820px and wider | HUD column beside the board | Whatever height is left, capped at 480px |
| Narrower, portrait | Title, zeny/moves, clock and lives above; goals and buttons below | 48% of the viewport height |
| Narrower, landscape under 560px tall | HUD back beside the board, title and legend hidden | Nearly the full height |

Sizing reads `window.visualViewport` where available, so the board shrinks to what's genuinely
on screen rather than to `innerHeight`, which on mobile includes the area behind the address
bar. It re-fits on resize, on orientation change, and on visual-viewport changes.

Portrait puts the clock, moves and lives *above* the board and the goals directly below it, so
everything you need mid-quest is visible at once. The legend is hidden on phones — it's
reference text, not something you read during a quest.

Two layout details worth knowing if you restyle:

- `body` uses `align-items:safe center`, with a plain `center` before it as a fallback.
  Ordinary `center` on a flex container pushes overflow off the **top** of the page, where no
  amount of scrolling reaches it. That was a real bug here.
- On phones `.panel` becomes `display:contents` so its children are grid items of `.game` and
  can be ordered individually. Without that, the HUD moves as one block and lands below the
  board, off screen.

`viewport-fit=cover` plus `env(safe-area-inset-*)` padding keeps things clear of notches and
home indicators. Pinch zoom is deliberately left enabled — the board sets `touch-action:none`
so its own gestures aren't affected, and blocking zoom page-wide is an accessibility problem.

## Browser support

Any current browser. Uses pointer events, CSS custom properties, `conic-gradient`, `dvh` units
and a 2D canvas. Swipe input is handled, and leaf density drops on small screens.

`prefers-reduced-motion` is respected throughout: CSS animations collapse to near-instant and
the leaves render as a still scatter with no loop running. The leaf loop and the stage clock
both pause while the tab is in the background, so nobody loses a life to a phone call.

If `localStorage` is blocked — private mode, a sandboxed frame — `js/lives.js` falls back to
in-memory storage rather than throwing. Lives then reset on refresh, which is the graceful
failure rather than a broken game.

## Notes

The slime and rune artwork is original, drawn as inline SVG. The setting is generic Norse
fantasy rather than any particular game's world, so the art and naming are yours to ship.

Sound is generated at runtime with the Web Audio API, so there are no audio files to load.
The `♪` button in the board corner mutes it.

Local mode trusts the player's own clock, so someone determined can edit `localStorage` or
roll their system clock forward to refill lives. This is not fixable client-side — the server
mode exists precisely because regeneration has to run somewhere the player can't reach.

## Ideas not built yet

- Colourblind support: the six slimes differ only by hue, which is a real accessibility gap
- Accounts, so lives follow the player instead of the browser or the connection
- Obstacle tiles (stone blocks, frozen slimes) so later quests differ in kind, not just number
- A quest map screen instead of a straight run of numbered levels
- Hand-authored levels in place of the procedural `questFor()` curve
- Spending zeny on extra moves or a life refill
