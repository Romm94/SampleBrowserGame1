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

### Obstacle bands

Obstacles run in bands of ten quests, so each stretch of the game has its own character instead
of piling everything on at once. Within a band the count climbs with the quest number. Past
quest 50 the bands repeat.

| Quests | Obstacle | At the start of the band | At the end |
| --- | --- | --- | --- |
| 1–10 | Frost only | 2 frost | 5 frost |
| 11–20 | Bramble only | 1 bramble | 3 bramble |
| 21–30 | Creeper vine, fast | 1 shoot every 9 s | 3 shoots every 5.4 s |
| 31–40 | Frost + bramble | 2 frost, 1 bramble | 4 frost, 2 bramble |
| 41–50 | Frost + creeper, fast | 2 frost, 1 shoot every 9 s | 4 frost, 2 shoots every 5.4 s |

The mixed bands give each obstacle a smaller share so the two together aren't twice the work.
The vine bands spread noticeably faster than a mixed band would — that's `band.fast` in
`obstaclesFor()`.

Note that the vine bands set **no blocker goal at all**, since the vine doesn't count toward
one. Those quests are judged purely on their collect or score goal, with the vine as pressure.

Goal sizes are derived from what a board can actually produce, not picked by hand — see
[Balance](#balance).

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

The **?** button opens the full rules at any time, and pauses the stage clock while it's open.
This matters on phones, where the side legend is hidden for space: without it the combination
rules would be unreachable on mobile.

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
Every 3 unused moves is one rune charge, minimum one if you had any moves left at all, up to
a ceiling of 5 held at once. Charges carry forward across quests and accumulate.

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

Clearing a quest plays a transition rather than a dialog box. Tiles spiral out from the
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

## Balance

`test/balance.js` plays quests with a bot that reads the board out of the DOM, aims at
blockers, and never uses rune charges — one move deep, no cascade planning. It's deliberately
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
│   ├── progress.js         quest number, zeny, charges and seen tips
│   ├── music.js            optional background track, ducking and autoplay
│   └── leaves.js           falling-leaf background, independent of the game
├── server/
│   └── lives-server.example.js    optional IP-keyed lives, plain Node
├── test/
│   ├── smoke.js            headless boot-and-play check
│   ├── features.js         progress, blockers, score quests, continues
│   ├── balance.js          bot playthroughs for tuning goal sizes
│   ├── viewport.js         board sizing across device dimensions
│   └── bot.js              shared board reader and move chooser
├── assets/
│   ├── sprites.png         tile art atlas, 5x2 cells of 128px
│   ├── bgm.mp3             looping background track
│   └── favicon.svg         browser tab icon
├── package.json
├── README.md
└── .gitignore
```

Tile art comes from `assets/sprites.png`, a single 640×512 atlas of sixteen 128px cells: six
slimes, four full-colour rune sprites, three blockers (frozen, bramble, creeper) and three
white rune marks for the board. One file means one request and one decode.
The `.art-*` rules in the stylesheet map each name to its `background-position`; `TYPES` in
`js/game.js` holds the key and the debris colour for each slime.

Runes on the board are **not** the full rune sprites. A rune has to keep its slime's colour, or
you couldn't tell what it matches, so the board uses the white rune marks — `mrow`, `mcol`,
`mbomb` — laid over the slime at 76% of the cell with a glow, and the slime underneath is
dimmed slightly so both stay readable. At full bleed the mark crowded the slime and neither
read well. The full-colour rune sprites are used where colour doesn't matter: the legend, the
rune picker and the help overlay.

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

**Obstacle bands** — the `BANDS` table and `obstaclesFor()` in `js/game.js`. Each entry is a
starting quest and the kinds it uses; `fast` shortens the vine's spread timer.

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
