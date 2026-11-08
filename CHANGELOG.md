# Changelog

## 0.9.1

- US spellings throughout the plugin's help and the documentation: color,
  center, license, gray.
- Light notetags accept only `color:`. The British spelling is now
  reported in the console as an unknown setting, like any other typo.

## 0.9.0

The first public release.

- **Day and night:** a global light shared by every map, faded by plugin
  command and kept in saves, and `<ambient>` for maps with their own light
  (interiors, caves). Presets: Day, Evening, Night, Dungeon, Cave, Darkness.
- **Lights** on events (note or page comment) and the player: point, cone
  (flashlights) and beam (sunbeams through windows) shapes, any color,
  with presets such as Torch, Lantern, Candle, Lamp and Flashlight. Lights
  fade out by day on their own, and can brighten the map up to Max
  Brightness.
- **Flicker** in two layers (slow breathing and fast crackle), with Fire,
  Candle, Pulse and Faulty styles, the same on every machine.
- **Soft shadows** with no setup: from walls and roofs, from tiles marked
  with Shadow Regions or Terrain Tags, and from characters, in the shape of
  the frame each one shows. Higher lights cast shorter shadows.
- **Normal and ambient occlusion maps** for characters, tilesets and
  parallaxes, found by file name (`Actor1_normal.png`, `Actor1_ao.png`),
  and Auto Normal Maps for images without them. Works in deployed games,
  including with encrypted images.
- Desktop, browsers and phones (WebGL 1 and 2), with Light Quality for
  slower devices.
