# How GH_Lighting works

How the plugin draws its lights, shadows and normal maps, for anyone working
on it. Using the plugin needs none of this: see the [README](../README.md)
and the plugin's help in the Plugin Manager. To build and test it, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Rendering

`LightingLayer` is the last child of the spriteset's base sprite. Each
frame, in `refresh()` (after the spriteset's update, outside PIXI's render
pass), it fills a light buffer
with the ambient color and adds one quad per on-screen light. The buffer is
48 px larger than the screen on each side, for screen shake, and runs at
"Light Quality" resolution.

Every light uses one vertex shader that places a quad in light space (x
along the light's direction, y across it) and one fragment shader per
shape. `lightBox()` fits the quad to the shape, so a narrow cone or a beam
covers a fraction of the pixels its circle would, which matters for fill
rate on phones.

| Shape | Lights | Quad |
|---|---|---|
| point | a circle, `(1 − d²)²` falloff | the circle's square |
| cone | the circle within `spread` degrees, sides fading over the outer 30% of the half-angle | the slice's bounding box |
| beam | a strip `width` wide, `radius` long, starting at the light; full across its middle half | the strip |

Directions are degrees clockwise from up. `facing` follows the
character's direction and turns 15 degrees a frame toward a new one, so a
flashlight sweeps round instead of snapping.

A plain multiply blend can only darken (a pixel times at most 1.0), so the
buffer stores light divided by `lightBufferScale(maxBrightness)` and is
applied in two passes with custom blend modes:

| Pass | Blend | Effect | Skipped when |
|---|---|---|---|
| darken | `ZERO, SRC_COLOR` | map × min(light, 1) | ambient is white |
| brighten | `DST_COLOR, ONE` | map × (1 + min(light, cap) − 1) | Max Brightness is 1, or no light on screen |

The scale is 255/n for a whole number n, so white (1.0) is stored exactly and
each pass outputs exactly 1.0 or 0.0 where it has nothing to do. A single
"2× multiply" pass would store white as 127.5, round it to 128, and brighten
the whole screen by 0.4%. With both passes skipped the layer is hidden and
costs nothing.

Each light adds only its excess over the ambient, per channel:
`max(0, color × intensity − ambient)` (`lightOverAmbient()`). So a light
fades out as the ambient rises to its brightness: an intensity-1 torch is
gone in full daylight and back at dusk, with no switches. Lights that add
nothing are skipped, which keeps daytime maps free.

The ambient comes from the map: its `<ambient>` tag if it has one,
otherwise the global light on `$gameSystem`, followed every frame (see
`src/core/ambient.js`). Set Map Ambient overrides either until Reset Map
Ambient or leaving the map.

## Shadows

Shadows are worked out per pixel, inside each light's own fragment shader:
from the lit point, look along the way to the light for anything in
between. There are no extra passes. A light uses the shadowed version of
its shader only when a casting tile is within its reach (a summed-area
table answers that in constant time) or a character is near it. Otherwise
it costs what it did before.

**What casts.** The tops of walls (A4) and roofs (A3) on the lower two tile
layers, plus any Shadow Regions and Shadow Terrain Tags. Wall fronts don't
cast, so lamps hung on them shine out into the room. Casting tiles are
infinitely tall. Characters cast the outline of the frame they are
showing, standing up at their feet. The player, followers and events with
character images (not `!` objects or tile images) cast by default.
Followers gathered on the player are hidden behind it and cast nothing.

**Distance field.** `src/core/field.js` builds, once per map, the exact
signed distance to the nearest casting tile edge. It is sampled up to 8
times a tile (fewer on big maps, to fit 2048 px), clamped to [-1, 2]
tiles, and stored as an 8-bit LUMINANCE texture with LINEAR filtering.
Looping maps wrap: the texture has a two-tile margin of wrapped tiles, and
the shader takes the map position modulo the map size. MZ reloads
`$dataMap` whenever the menu closes, so the cache is keyed on the map's
tiles, not the object.

**Visibility** (`shadowVisibility()`):

- *Tiles.* March from the point toward the light, at most 24 steps, each
  as long as the field says is clear (at least 1/24 of the way, at most 2
  tiles). The march stops short of the light by its clear zone: the
  light's softness, or a whole tile for a light inside a casting tile.
  Soft edges use the cone trick: the least clearance divided by the
  light's cone width there (`softness × t / D`), mapped through
  `smoothstep(-1, 1, ·)`. So penumbrae widen with distance behind the
  caster. Beams shine in parallel from their start line.
- *Characters.* Up to 8 per light (nearest first, fewer if the device has
  few uniforms). Each is its sprite's outline standing upright at its feet
  (a quarter of its width above the bottom of the sprite), turned to face
  the light. The ray from a point crosses that upright `along` from the
  point, `across` from the character's middle and, for light at height
  `Hl`, at height `Hl × along / D`. The outline's distance there, over the
  cone width, gives a soft edge as for tiles. So shadows end, at
  `d × Hc / (Hl − Hc)`, and the higher the light, the shorter they are.
  The outline isn't mirrored for lights behind a character, so shadows
  keep the sprite's left and right; it flips only as a light passes
  exactly beside it. A character never shadows its own sprite as drawn
  (its outline, not its frame), nor the light it carries. Followers
  standing on the player don't shadow the player's lantern either. Nor
  does a character shadow points inside casting tiles: those stand far
  above it, so roofs and wall tops (and Shadow Regions and Terrain Tags)
  just south of a character never catch its shadow.
- *Outlines* (`src/core/outlines.js`, `src/mz/OutlineAtlas.js`). The
  first time a light needs a character's current frame, it is drawn into
  a 64-texel slot, its longer side filling it. The frame's alpha is read
  back and turned into an exact signed distance field (Felzenszwalb and
  Huttenlocher), clamped to [-16, 48] texels and stored in 8 bits. The
  atlas holds 64 slots in one 512 × 512 LUMINANCE texture (256 KB). When
  it fills up, the least recently used slot is reused. Like the tile
  field, it outlasts the scene. An image that can't be read (from another
  site) gets a post half its frame's width instead.
- *Points inside a casting tile* (the tops of walls) take the light of
  their tile's side facing the light, as the ground just outside it does.
  So walls are lit a tile deep along their edges facing a light, evenly at
  any angle. With no open side facing the light, an open corner between
  them is used; with none of those, the point is dark. A light that is
  itself inside a casting tile (a lamp on top of a wall) also lights the
  casting tiles it sees through, followed tile by tile (up to 12).

## Normal and AO maps

**Finding them.** A map is a PNG named after its image plus a suffix:
`_normal`, `_norm` or `_n`; `_ao`, `_occlusion` or `_o` (`_specular`,
`_spec` and `_s` are listed too, for stage 6), in `img/characters`,
`img/tilesets` or `img/parallaxes`. On NW.js the plugin reads those folders
at boot, and a play-test saves what it found to `data/GH_LightingMaps.json`
(only when that changed). Browsers and phones can't list folders, so they
read that file. Each image's maps load along with it, and a map scene waits
for them, so nothing pops in.

**Packing.** An image's maps are drawn once into one texture, as (normal x,
normal y on screen, AO), undoing the image's premultiplied alpha and
flipping green for Normal Map Green "up". Tilesets' maps go into
2048-pixel textures laid out exactly like MZ's tilemap textures, so the tile
shader finds a tile's maps where it finds its colors.

**The frame**, when anything on screen has maps (otherwise the plain path
above, unchanged):

1. The surface buffer, at full resolution: the tilemap's layers, the
   parallax and the characters drawn again from MZ's own vertex data, as
   their packed maps. Images without maps are flat, open ground, or with
   Auto Normal Maps get normals from a Sobel filter over their brightness.
   Only their opaque pixels count.
2. The light buffer, at Light Quality: per texel, red is the sum of weight
   × falloff × shadow visibility over the lights, green the same without
   visibility. A light's weight is its excess's brightest channel over the
   frame's weight range.
3. The shading buffer, at full resolution: each light without shadows,
   times `surfaceShading()`, the surface's N·L over flat ground's:
   `n.z + (n.xy · toLight) / height`, capped at 2.
4. Darken and brighten as before, by `ambient + shading × min(red /
   green, 1) × AO`.

Shadows are the costly part and stay at Light Quality, while normals stay
sharp at full resolution. Red over green is the share of light that gets
past shadows: exact where one light reaches, and where overlapping lights
are shadowed alike. Flat ground shades to exactly 1, so it looks as it
would without maps. The ambient (global or the map's) ignores the maps:
it lights everything evenly, so by day, with no lights, nothing changes.
AO only holds back what lights add, in creases.

**Precision.** The share comes from two 8-bit sums, in steps of 1/(255 ×
green). The weight range is the total weight of the lights on screen (at
most 4), so the sums are as large as they can be without overflowing even
where every light overlaps: with one light, its full strength uses all 255
levels.

**Known MZ issues**, with or without the plugin: after a lost WebGL context
comes back, MZ 1.10's tilemap stays blank on WebGL 2 (it never refills its
tileset textures), and on WebGL 1 nothing is drawn at all.

## Flicker model

`src/core/flicker.js` returns a brightness multiplier around 1.0, built from
two layers of deterministic value noise:

| Parameter | Meaning |
|---|---|
| `slowStrength`, `slowSpeed` | Overall level and flow: eases to a new level `slowSpeed` times a second, the long "breathing" of a fire |
| `fastStrength`, `fastSpeed` | Short-lived pops and crackle on top |
| `fastSharpness` | 0 = soft shimmer, 1 = instant snaps |

It depends only on time and a per-light seed. That makes it frame-rate
independent, identical across machines, and lets lights flicker in sync by
sharing a seed. The time is map time (`$gameMap.ghLightTime()`, counted in
map updates) rather than `Graphics.frameCount`, which includes loading
screens and would make every run, and every screenshot test, flicker
differently. Events default to a seed from their map and event IDs.

The multiplier scales what a light adds over the ambient, not its
intensity, so a torch that has faded out by day does not flicker into view.
Named styles live in the Flicker Presets parameter (Fire, Candle, Pulse,
Faulty), and tags can override any of the five values: `slow`,
`slowSpeed`, `fast`, `fastSpeed`, `sharpness`.
