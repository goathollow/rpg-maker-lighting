# Contributing to GH_Lighting

Bug reports, fixes and ideas are welcome. Please open an issue first for
anything large, so we can agree on the approach before you put time in.

When reporting a bug, include your RPG Maker MZ version, the plugin version
(top of its help), your other plugins, and anything the console shows (F8
during a play-test).

How the plugin works inside (rendering, shadows, normal maps, flicker) is
in [docs/how-it-works.md](docs/how-it-works.md).

## Setup

Needs Node 22+ and RPG Maker MZ (Steam install is found automatically; set
`MZ_PATH` otherwise).

```sh
npm install
npx playwright install chromium
npm run setup        # copies engine + RTP assets from MZ into testproject/
npm run build
```

## Day-to-day

```sh
npm run dev          # rebuild on save, copies into testproject/js/plugins
```

Open `testproject/game.rmmzproject` in the MZ editor and play-test as usual.
Press F5 in the game window to reload after a rebuild.

## Tests

```sh
npm test                    # unit tests (Node, ~0.1 s)
npm run test:visual         # screenshot tests in Chromium (~4 min)
npm run test:visual:update  # accept intended visual changes
npm run test:nwjs           # smoke tests in MZ's own NW.js (open a window)
npm run test:all
```

- **Unit tests** cover everything under `src/core/`: pure logic with no MZ
  or PIXI globals.
- **Lighting model tests** (`tests/visual/lighting.spec.js`) rebuild the
  frame in Node the way the GPU does: the light buffer texel by texel at
  Light Quality resolution (ambient, each light's excess over it, flicker
  and shape falloff from `src/core/`, rounded to 8 bits), read with
  bilinear filtering, times the unlit pixel, capped at Max Brightness.
  Shadows are worked out by `src/core/shadows.js` over the same distance
  field the GPU samples (`src/core/field.js`, bilinear like the GPU). A
  grid of pixels across the screen must match within 3/255; the measured
  error is about 0.25 on average and under 2.5 at worst. If the shaders
  change, `src/core/shapes.js` and `src/core/shadows.js` must change with
  them. Deliberately broken shaders (marching too far, wider penumbrae,
  walls lit from the wrong side, ignoring scrolling, and so on) each fail
  several of these tests.
- **Surface tests** (`tests/visual/surfaces.spec.js`) read the surface
  buffer back from the GPU and check it, pixel by pixel, against the
  functions in `tools/make-test-maps.mjs` that drew the test maps (and
  against Normal Map Green and Strength). Then the same reference model,
  extended in `tests/visual/model.js`, rebuilds frames lit through those
  surfaces: light weights at Light Quality, shading at full resolution from
  the read-back normals (`surfaceShading()`), AO on the lights. Others
  cover loading: a map that fails to load, a browser without the map list,
  a map scene waiting for its maps, and a lost WebGL context.
- **Invariance tests** (`tests/visual/boot.spec.js`) compare against the
  same map with the plugin removed: a fully lit map whose lights are no
  brighter than daylight must hash the same, and with a brighter light every
  pixel out of its reach must be bit-identical.
- **Screenshot tests** run three projects: `desktop-webgl2`, `desktop-webgl1`
  and `mobile` (Pixel 7 emulation). WebGL is software-rendered (SwiftShader),
  so pixels are identical on any machine, and a pixel counts as changed when
  it is off by more than about 4 levels. After a failure, open
  `playwright-report/index.html` for side-by-side diffs. Playwright writes a
  missing baseline during any run, so regenerate goldens only from a clean
  build (`npm run test:visual:update`).
- **Machine load:** software WebGL is CPU-heavy, so visual tests run 3
  browsers at a time, at below-normal priority (Chrome's GPU process
  included), and the desktop stays responsive. `npx playwright test
  --workers=8` trades that for a slightly faster run; `--project=desktop-webgl2`
  runs a third of the suite for quick iteration.
- **The harness** (`testproject/js/plugins/LightingTestHarness.js`) only acts
  when the URL contains `?harness`. It skips the title, starts on a given map,
  runs exactly N frames (one update per frame) and freezes. `p.NAME=VALUE`
  overrides a plugin parameter for one test (e.g. `p.maxBrightness=1`),
  which is why the harness comes first in `plugins.js`, and `party=1,4,6,7`
  starts with those actors. See its header for all URL options.
- **The NW.js smoke test** catches APIs that work in modern Chromium but not
  in the Chromium 85 that desktop players run. It takes harness options
  too: `node tools/nwjs-smoke.mjs 3 9 8 dir=4 p.playerLight=Flashlight`.
  With `--surfaces` it play-tests and puts normal and AO maps on screen,
  failing unless the plugin read the image folders and saved the same map
  list the build writes, or on any console error. NW.js renders on the
  real GPU, so this is also the one test of the surface shaders on actual
  hardware.

### Test maps

| Map | Purpose |
|---|---|
| 1 Tavern | `<ambient: Evening>`, fireplace and wall lamps |
| 2 Water Temple | `<ambient: Dungeon>`, torches and crystals |
| 3 Lighting Lab | Tavern layout with no ambient tag (so it follows the global light), invisible lit events (a lamp at (4, 11), a crystal on top of a wall at (14, 11)), a villager with no tags at (13, 8), and region 5 painted at (11, 7) and (11, 8) for Shadow Regions tests. Tests set its lighting by command, and compare it with the plugin removed |
| 4-8 Showcase | Connected maps for showing the plugin off, where a new game starts (see below). No test uses them |

The showcase starts in **Sunstone Village** (4), by day. It follows the
global light: the Sunstone on the statue at the top is very bright
(intensity 3, which is why the project's Max Brightness is 2; tests use
1.25), the street lamps and door lanterns barely show by day, and the sign
by the square (12, 15) turns the time of day to evening or night. From
there (walk into a door or the gate to go through; press OK at the well):

- the top-left door: **The Study** (5), dim, with two fireplaces, braziers
  and candelabras
- the bottom-left door: **Chapel at Dusk** (8), candles, a glowing relic and
  colored sunbeams through the stained glass
- the well in the square: **Old Mine** (6), `<ambient: Cave>`. Take a torch
  from the wall by the way in; crystals glow in the dark, and an old
  lantern is on the fritz
- the gateway at the bottom of the village: **Night Woods** (7),
  `<ambient: Night>`. A chest by the path holds a flashlight; there's a
  campfire, lit cabin windows, glowing mushrooms and fireflies

The Torch and Flashlight are key items (31, 32); using one from the menu
switches it on or off (common events 1 and 2, switches 1 and 2).

### Test images

Test images with normal and AO maps (`tools/make-test-maps.mjs`, run by
`npm run setup` and every build, which also writes the project's
`data/GH_LightingMaps.json`): `Lab_People` (People1, domes and AO per
frame), `Lab_Inside_A5` (beveled tiles), `Lab_Inside_B` (domes and AO per
tile), `Lab_Ocean` (a parallax), and the tileset "[Test] Inside, normal maps"
that uses the two sheets. No map uses them, so existing screenshots don't
change; tests switch to them.

The showcase party, actors 9-16, are Actor1's eight on `Showcase_Party`, a
copy of that sheet whose normal and AO maps are worked out from its sprites
(`spriteMaps()`): rounded off at their outlines, with their detail raised
or sunk by lightness, as normal map tools do. Like the other test images,
they are made from the RTP in your own MZ install and never committed. Tests
start with MZ's default party (actors 1, 4, 6 and 7) and Max Brightness
1.25, so no screenshot depends on them; one test checks the party draws its
maps.

RTP images, and maps made from them, can't go in the repository: MZ's
license lets its assets be shared only in games, or, modified, for free
with other MZ owners.

Add more maps with `node tools/import-sample-map.mjs <sampleNumber> <mapId> <name>`,
and screenshot any map without the editor using
`node tools/shoot.mjs out.png map=2 x=11 y=20` (add `p.maxBrightness=2` and
similar to try parameters).

## Layout

```
src/core/     pure logic (colors, notetags, lights, shapes, ambient, flicker,
              distance field, shadows, outlines, surface maps), unit-tested
src/mz/       engine integration (game state, commands, shaders, shadow map,
              outline atlas, surface maps and buffer, lighting layer)
src/presets.js  built-in presets; the build writes them into the header
src/header.txt  Plugin Manager header and user guide; {{...}} filled by the build
tests/        unit/ (node:test) and visual/ (Playwright)
tools/        build, static server, test-project setup and test maps, NW.js
              smoke test, release notes
testproject/  MZ project; only data/, plugins.js and the harness are tracked
docs/         how it works, and the README's screenshots
```

## Constraints

- **Runtime APIs:** stay within Chromium 85 (NW.js 0.48) and Safari 14.1.
  esbuild lowers syntax, but newer APIs such as `Array.prototype.at` or
  `structuredClone` must be avoided by hand.
- **WebGL 1 is the main target, not a fallback.** PIXI 5 picks WebGL 1 on
  every mobile device. So: GLSL ES 1.00 shaders, no multiple render targets,
  and a light buffer that can drop to half or quarter resolution.
- **Bad input must never crash a game.** Plugin parameters and notetags are
  typed in by non-programmers, so they fall back to defaults and are
  reported once in the console.
- **Saved state is plain text and numbers** on `$gameSystem`, `$gameMap`,
  events and `$gamePlayer` (`_ghGlobalLight`, `_ghAmbient`,
  `_ghLightCommand`). Resolved lights are
  cached in a WeakMap, which is never saved, so saves stay small and preset
  edits apply to old saves. Games can add the plugin to, or remove it from,
  a project with existing saves.
- **Only aliases.** Core methods are wrapped, calling the original, never
  replaced, so the plugin chains with others.
- **The user guide is the plugin's help** (`src/header.txt`). Every
  parameter, command and argument needs a name and a description; a unit
  test checks.
- **Nothing third-party in the repository** except what its license allows:
  RTP assets and engine files are copied from the local MZ install.

## Releasing

1. Update `version` in `package.json` (and run `npm install` so
   `package-lock.json` follows).
2. Add a `## <version>` section at the top of `CHANGELOG.md`.
3. Run `npm run test:all`.
4. Commit, then tag and push: `git tag v<version> && git push origin v<version>`.

The release workflow (`.github/workflows/release.yml`) checks the tag
matches `package.json`, runs the unit tests, builds `GH_Lighting.js` and
publishes it as a GitHub release, with that version's `CHANGELOG.md`
section as its notes.
