import { buildAmbientPresets } from "./core/ambient.js";
import { buildFlickerPresets } from "./core/flicker.js";
import { buildLightPresets } from "./core/lights.js";
import { readBoolean, readChoice, readNumber, readNumberList, readString, readStructList } from "./core/params.js";
import { AUTO_NORMALS } from "./core/surfaces.js";
import { DEFAULT_AMBIENT_PRESETS, DEFAULT_FLICKER_PRESETS, DEFAULT_LIGHT_PRESETS } from "./presets.js";

// Converts raw Plugin Manager parameters into the settings the plugin uses.
// Never throws: a broken value falls back to its default. A missing preset
// list (a project set up before it existed) gets the built-in presets.
export function parseSettings(raw = {}, warn = () => {}) {
    const flickerPresets = buildFlickerPresets(readStructList(raw.flickerPresets, DEFAULT_FLICKER_PRESETS), warn);
    return {
        lightResolution: readNumber(raw.lightResolution, 0.5, { min: 0.25, max: 1 }),
        maxBrightness: readNumber(raw.maxBrightness, 1.25, { min: 1, max: 2 }),
        globalLight: readString(raw.globalLight, ""),
        playerLight: readString(raw.playerLight, ""),
        shadows: readBoolean(raw.shadows, true),
        wallShadows: readBoolean(raw.wallShadows, true),
        shadowRegions: readNumberList(raw.shadowRegions, [], { min: 1, max: 255 }),
        shadowTerrainTags: readNumberList(raw.shadowTerrainTags, [], { min: 1, max: 7 }),
        characterShadows: readBoolean(raw.characterShadows, true),
        surfaceMaps: readBoolean(raw.surfaceMaps, true),
        normalStrength: readNumber(raw.normalStrength, 1, { min: 0, max: 3 }),
        normalGreen: readChoice(raw.normalGreen, "up", ["up", "down"]),
        aoStrength: readNumber(raw.aoStrength, 1, { min: 0, max: 1 }),
        autoNormals: readChoice(raw.autoNormals, "off", Object.keys(AUTO_NORMALS)),
        autoNormalStrength: readNumber(raw.autoNormalStrength, 1, { min: 0, max: 3 }),
        flickerPresets,
        lightPresets: buildLightPresets(
            readStructList(raw.lightPresets, DEFAULT_LIGHT_PRESETS),
            warn,
            flickerPresets
        ),
        ambientPresets: buildAmbientPresets(readStructList(raw.ambientPresets, DEFAULT_AMBIENT_PRESETS), warn),
    };
}
