# Pushover: development notes

A daily push-'em-off puzzle for Reddit on Devvit Web. You're a slime on a floating island with a handful of other slimes. Every slime's next move is shown as an arrow. You aim yours, push, and everyone slides at once. Over a few turns, push as many off the edge as you can. Your score is how many fell. If you fall off yourself, your run ends there and you keep what you had pushed off.

## The foes

Each foe is one of four kinds, and its kind decides its move every turn (`movesAt` in `src/shared/sim.ts`):

- **Chaser** (scowl) charges at you. If a hole or an edge is in the way it comes round.
- **Dodger** (worried) moves to the spot with the most grass around it that is also far from you, so it never backs up against an edge.
- **Mirror** (paper crown) makes the opposite of your move at the same moment. It is the only kind that reacts to your aim; the others decide from where everyone stands as the turn starts.
- **Sleeper** never moves.

No foe ever slides itself off the island or over a hole. They only leave when pushed. The "?" button on the play screen lists the kinds on the island, one line each.

Aim is free: drag anywhere from your slime for any of 72 directions and 6 strengths.

## How a day works

- **One island a day**, the same island for every community, changing at midnight UTC. Difficulty follows the week: Monday has 2 foes in 4 turns, Sunday has 5 foes in 5 turns.
- **Twist days.** Wednesday has **boulders**: they never move and everything bounces off them. Friday is **frozen**: on ice the same push carries about 1.75 times as far. Sunday has both. The title card names the twist and gives its rule in one line.
- **The goal is always every foe.** Each daily island is kept only if a beam-search solver can push every foe off, so the top score is always within reach.
- **Unlimited runs.** Your best run counts, with fewer runs to reach it as the tiebreak. Your first finished run is kept separately ("first try"), and the results sheet shows how everyone's first try went. There is no undo and no restart: every push is final, and a run counts once it's finished. To make that fair, nothing is hidden: each foe's arrow shows this turn's move, and its later moves follow from its kind.
- **Replay.** The results sheet can play your best run back.
- **Streaks and flair.** Finishing a run on the day's island extends your streak, shown as "Pushover · N-day streak" user flair. Flair is only set over no flair or flair Pushover set itself.

## Player-made islands

From the results sheet, anyone can build an island and post it as a new post in the community.

1. **Build** (`src/client/build.tsx`): paint grass or cut it away, drag your slime, tap to add foes and boulders, tap a foe to change its kind, switch between grass and ice, pick 2 to 4 turns, or shuffle for a new random island. The foes' arrows show what each would do on turn 1 as things stand. Every tool refuses a change that would leave something off the grass or overlapping, so a draft is always a valid layout.
2. **Play it through.** The maker plays the island like anyone else. Their moves are the proof that it can be beaten, and players then try to push every foe off.
3. **Post.** The server checks the island again with the same shared rules (`src/shared/validate.ts`) before it creates the post: the layout is valid, every foe has a kind, the maker's line replays to a finished run, the maker didn't fall, at least one foe was pushed off, and standing still all game scores less than the maker did. Five islands per player per day.

The newest player-made islands are listed on every results sheet.

## Layout

| Path | What it is |
| --- | --- |
| `src/shared/sim.ts` | The physics: launch, slide, friction, bounces (your slime is a little heavier than the foes), boulders, ice, falls, and the island's pixel mask. Deterministic (see below). |
| `src/shared/dirs.ts` | 72 aim directions stored as literal numbers. |
| `src/shared/gen.ts` | Seeded island, boulder and cast generator. |
| `src/shared/solve.ts` | Beam-search solver that checks every foe can be pushed off. |
| `src/shared/levels.json` | The daily pool: 7 weekday tiers × 52 islands, built by `npm run levels`. |
| `src/shared/pool.ts` | Which island plays on which day. |
| `src/shared/twist.ts` | The name and one-line rule for boulders and ice. |
| `src/shared/validate.ts` | The rules a player-made island must pass. |
| `src/server/core/game.ts` | Redis schema (documented at the top), replaying and recording runs, streaks, leaderboard, player-made islands. |
| `src/server/routes/api.ts` | `/api/init`, `/api/turn`, `/api/run`, `/api/replay`, `/api/leaderboard`, `/api/share`, `/api/follow`, `/api/levels`, `/api/islands` |
| `src/client/scene.ts`, `island.ts`, `sky.ts`, `sprites.ts`, `uiart.ts` | The pixel renderer: scene layers and effects, the island, the sky, the hand-drawn sprites, and the pixel-art UI pieces. |
| `src/client/play.tsx` | One run: drag to aim, push, the turn loop, the who's-who sheet. Also plays replays and the editor's play-through. |
| `src/client/build.tsx`, `draft.ts`, `kinds.ts` | The editor, the draft island, and the one-line description of each kind. |
| `src/client/sound.ts`, `speed.ts` | Synthesised sound effects with mute, and the playback speed setting. |
| `src/client/game.tsx`, `splash.tsx` | Title card, results sheet, leaderboard and the editor's flow; the inline feed card. |

## Deterministic physics

The server never trusts a score. The client sends its moves (aim 0–71, power 0–6 per turn), and the server replays them with the same `sim.ts` to score the run. For the replay to match the browser exactly, the simulation uses a fixed timestep and a fixed iteration order. It does all its maths with `+ - * /` and `Math.sqrt`, which IEEE 754 requires to give identical results in every engine. Aim directions are stored as literal numbers rather than computed with `Math.cos`/`Math.sin`, whose results can differ slightly between engines. `npm run test:unit` checks that every pool island's stored solution pushes every foe off, and covers boulders, ice, the twist days and the island checker.

An arrow shows where its slime goes if no other slime gets in the way, using the same steps as the simulation (`lonePath`). On a boulder day the arrow bends where the slime will bounce.

## Building the island pool

```sh
npm run levels   # about 3 minutes
```

For each weekday tier, the script generates islands from seeds. It solves each one and keeps it only if all of these hold:

- Left alone, no foe leaves the island.
- The solver can push every foe off with turns to spare: two fewer turns than the player gets early in the week, one fewer later, none on Sunday.
- A full clear can't be reached on turn 1 alone.
- On Saturday and Sunday only: a greedy player, who each turn takes the push that knocks the most off right away, can't clear the island, and neither can a simple habit (always ramming the nearest foe, or never moving).

## Look

One picture, one pixel size. The scene canvas fills the screen and is scaled by a whole number, and the UI is laid out in the same art pixels (`--px` in `src/client/index.css`), so a pixel in a button is the same size as a pixel in a slime.

- **Island** (`src/client/island.ts`): the top is drawn from the same pixel mask the physics uses (`groundMask` in `src/shared/sim.ts`), so the edge you see is the edge slimes fall off. The mask is the level's cell grid smoothed: straight edges stay put, corners round off and stair-steps become clean diagonals. The rock underneath is one solid mass seen from the south. Every point of the island hangs lower the deeper inside the island it is, which gives thin turf at the rims and a deep keel under the middle. A hole shows the far rim's rock at its top and sky below. Top and underside never share colours. There are two looks: grass over warm stone, and snow with icicles over cold stone for frozen days.
- **Sprites** (`src/client/sprites.ts`): slimes are hand-drawn as rows of palette keys, with four body frames (idle, breath, squash, stretch) and a face drawn on top so the eyes can look around, blink and sleep. Each foe has its own colour ramp, and its arrow and trail use the same colour. Yours is cream with a gold crown. Boulders, tufts, flowers, pebbles, vines, clouds and far islands are hand-drawn the same way.
- **Sky** (`src/client/sky.ts`): a dithered sunset, a low sun, and three layers of scalloped cloud that slimes fall into.
- **Arrows** are drawn as vector shapes and snapped to hard pixels, so every angle is a clean line.
- **UI** (`src/client/uiart.ts`): panels and buttons are 12×12 pixel sprites used as nine-slice border images: paper in a wooden frame, wood, gold and grass buttons, each with a pressed version. The HUD shows the foes as the same slime sprites.
- **Type**: Tiny5 for text and Silkscreen for headings (both SIL OFL, bundled through `@fontsource`). Both are bitmap faces drawn 8 pixels to the em, so at 8 art pixels per em every font pixel is one art pixel.

## First play

There are no tutorial screens. The title card states the goal in one sentence. The first time anyone plays, a hand drags out from their slime and the arrow grows after it, on a loop, until they touch anything. After that it never appears again in that browser. One line of hint text sits under the island and changes with what's happening.

## Pacing

The simulation always runs at its own fixed tick, so results never depend on the device. What changes is how a turn is shown (`src/client/play.tsx`):

- **Speed button** (next to Push): one, two or three chevrons for slow, normal and fast (`src/client/speed.ts`). The choice is remembered per browser. Falls, popups and sparks follow the chosen speed too, so a fast turn really is about half as long.
- At normal speed, turns play back at 0.42 simulation ticks per frame, with positions eased between ticks. A full-power push takes about two seconds to come to rest.
- Before launch there is a short wind-up: everyone about to move crouches, with the arrows still showing.
- A solid hit freezes the action for a few frames, with a burst at the point of contact.
- Each slime leaves a dotted trail in its colour, which fades after the turn.
- Holding the island during a slide fast-forwards, whatever the speed setting.
- Game logic runs at a steady 60 frames a second whatever the screen's refresh rate.

## Sound

Every effect is synthesised with Web Audio (`src/client/sound.ts`): bumps, knocks off boulders, the falling whistle and the poof into the clouds, a chime that climbs with each foe pushed off, and button clicks. There are no audio files. The button on the other side of Push mutes it, and the choice is remembered per browser. Sound starts only after the first tap, as browsers require.

## Run it

Requires **Node 24+**.

```sh
npm install
npm run login     # devvit login
npm run dev       # devvit playtest in r/PushoverGame
```

The app is `pushover-game` on Reddit (https://developers.reddit.com/apps/pushover-game) and is installed on r/PushoverGame. In the subreddit, use the subreddit menu and pick **Pushover: post a test island**.

After changing code, `npx devvit upload` stores a new version but doesn't update the subreddit. Follow it with `npx devvit install PushoverGame`.

**Keep every `@devvit/*` package on one version.** `package.json` pins them all to 0.15.3, with `overrides` for the ones that are only pulled in indirectly. Devvit keeps each request's context inside `@devvit/server`; if two versions of it are installed, Redis and Reddit calls fail at runtime with "No context found", even though everything builds and passes locally. When upgrading Devvit, move all of them together and check with `npm ls @devvit/server` that only one version is listed.

```sh
npm run deploy    # type-check + lint + devvit upload  (hackathon: upload only, don't publish)
```

## Recordings (review without Reddit)

```sh
npm run record              # build the demo with a mock backend and record every scenario
node scripts/look.mjs Sun   # quick stills for one weekday tier (after building the demo)
node scripts/islands.mjs    # close-ups of eight different islands
node scripts/walk.mjs       # walks the replay and the island editor, checking each step
node scripts/brand.mjs      # renders the subreddit icon and banner into docs/brand
```

The demo builds the real client against an in-memory backend (`demo/mock.ts`) that scores runs and checks posted islands with the real shared code. Players and crowd stats are fake. Videos and stills go to `recordings/`; open `recordings/index.html`.
