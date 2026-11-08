import { parseColor } from "./color.js";
import { FLICKER_KEYS, FLICKER_LIMITS, NO_FLICKER } from "./flicker.js";
import { parseTagArgs } from "./notetags.js";
import { readString } from "./params.js";
import { SHAPES } from "./shapes.js";

// A resolved light, as the renderer uses it: color in 0..1, sizes, offsets
// and heights in pixels, angles in degrees clockwise from up.
export const DEFAULT_LIGHT = Object.freeze({
    color: Object.freeze([1, 1, 1]),
    radius: 144,
    intensity: 1,
    offsetX: 0,
    offsetY: 0,
    shape: "point",
    direction: "facing", // or a fixed angle
    spread: 60, // cone width
    width: 48, // beam width
    flicker: NO_FLICKER,
    seed: null, // null: each light gets its own, from its event
    shadows: true, // whether walls and characters block it
    softness: 8, // the light's size: how soft its shadows' edges are
    height: 72, // how high it hangs: how long characters' shadows are
});

const LIMITS = {
    radius: [1, 2000],
    intensity: [0, 4],
    offsetX: [-1000, 1000],
    offsetY: [-1000, 1000],
    spread: [1, 360],
    width: [1, 2000],
    seed: [-1e9, 1e9],
    softness: [0, 48],
    height: [0, 2000],
    ...FLICKER_LIMITS,
};

// Every word accepted for each light setting, in notetags and preset fields.
const ALIASES = {
    color: "color",
    radius: "radius",
    size: "radius",
    length: "radius",
    intensity: "intensity",
    brightness: "intensity",
    x: "offsetX",
    offsetx: "offsetX",
    y: "offsetY",
    offsety: "offsetY",
    shape: "shape",
    type: "shape",
    direction: "direction",
    dir: "direction",
    spread: "spread",
    width: "width",
    flicker: "flicker",
    seed: "seed",
    shadows: "shadows",
    shadow: "shadows",
    softness: "softness",
    height: "height",
    ...FLICKER_KEYS,
};

const DIRECTION_WORDS = { facing: "facing", up: 0, right: 90, down: 180, left: 270 };

// What a light adds over the ambient around it, per channel: its color
// times its intensity, less the ambient, never below 0. So a light fades out
// as the ambient rises to its brightness (torches vanish by day) and shows
// more the brighter it is. Writes into and returns `out`.
export function lightOverAmbient(light, ambient, out = [0, 0, 0]) {
    for (let i = 0; i < 3; i++) {
        out[i] = Math.max(0, light.color[i] * light.intensity - ambient[i]);
    }
    return out;
}

// The light buffer has 8 bits per channel, so to hold light up to Max
// Brightness it stores light divided by this scale. The scale is 255 / n for
// a whole number n, so light 1.0 (white ambient) is stored as exactly n and
// reads back as exactly 1.0. Max Brightness 1 gives 1, 1.5 gives 1.5, and
// 2 gives 255 / 127.
export function lightBufferScale(maxBrightness) {
    return 255 / Math.floor(255 / Math.max(1, maxBrightness) + 1e-9);
}

function readSwitch(text) {
    if (/^(on|yes|true)$/i.test(text)) return true;
    if (/^(off|no|none|false)$/i.test(text)) return false;
    return null;
}

function readDirection(text) {
    const word = DIRECTION_WORDS[text.toLowerCase()];
    if (word !== undefined) return word;
    const n = Number(text);
    return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null;
}

// Copies `base` with each recognized value from `values` applied. Empty
// values keep the base; unreadable ones are reported and skipped. A named
// flicker is applied before any single flicker setting, whatever the order
// they were written in, so "flicker: Fire, fast: 0.3" tweaks Fire.
function applyValues(base, values, flickerPresets, warn) {
    const light = { ...base };
    const entries = Object.entries(values).sort(([a], [b]) => (b === "flicker") - (a === "flicker"));
    for (const [key, raw] of entries) {
        const text = String(raw).trim();
        if (text === "") continue;
        const prop = ALIASES[key.toLowerCase()];
        if (!prop) {
            warn(`unknown light setting "${key}"`);
        } else if (prop === "color") {
            const color = parseColor(text);
            if (color) light.color = color;
            else warn(`can't read color "${text}"; use #rrggbb or red,green,blue`);
        } else if (prop === "shape") {
            const shape = text.toLowerCase();
            if (SHAPES.includes(shape)) light.shape = shape;
            else warn(`unknown shape "${text}"; use ${SHAPES.join(", ")}`);
        } else if (prop === "direction") {
            const direction = readDirection(text);
            if (direction !== null) light.direction = direction;
            else warn(`can't read direction "${text}"; use facing, up, down, left, right or an angle`);
        } else if (prop === "shadows") {
            const on = readSwitch(text);
            if (on !== null) light.shadows = on;
            else warn(`can't read shadows "${text}"; use on or off`);
        } else if (prop === "flicker") {
            const flicker = /^(off|none)$/i.test(text) ? NO_FLICKER : flickerPresets.get(text.toLowerCase());
            if (flicker) {
                light.flicker = flicker;
            } else {
                const known = flickerPresets.size ? ` Known: ${[...flickerPresets.keys()].join(", ")}, off.` : "";
                warn(`unknown flicker "${text}".${known}`);
            }
        } else {
            const n = Number(text);
            if (!Number.isFinite(n)) {
                warn(`can't read ${key} "${text}"; it should be a number`);
                continue;
            }
            const [min, max] = LIMITS[prop];
            const value = Math.min(max, Math.max(min, n));
            if (prop in FLICKER_LIMITS) light.flicker = { ...light.flicker, [prop]: value };
            else light[prop] = prop === "seed" ? Math.round(value) : value;
        }
    }
    return light;
}

// Plugin Manager preset structs -> Map of lower-cased name to light.
export function buildLightPresets(structs, warn = () => {}, flickerPresets = new Map()) {
    const presets = new Map();
    for (const struct of structs) {
        const { name: rawName, ...values } = struct;
        const name = readString(rawName, "");
        if (!name) {
            warn("a light preset has no name and was skipped");
            continue;
        }
        if (presets.has(name.toLowerCase())) {
            warn(`light preset "${name}" is defined twice; using the first`);
            continue;
        }
        const light = applyValues(DEFAULT_LIGHT, values, flickerPresets, (msg) => warn(`preset "${name}": ${msg}`));
        presets.set(name.toLowerCase(), light);
    }
    return presets;
}

// Text of a <light> tag or command -> a light, or null for "off" / "none".
// A typo still gives a light, plus a warning, so mistakes are visible.
export function resolveLight(text, presets, warn = () => {}, flickerPresets = new Map()) {
    const { name, values } = parseTagArgs(text);
    if (/^(off|none)$/i.test(name)) return null;
    let base = DEFAULT_LIGHT;
    if (name) {
        const preset = presets.get(name.toLowerCase());
        if (preset) {
            base = preset;
        } else {
            const known = presets.size ? ` Known presets: ${[...presets.keys()].join(", ")}.` : "";
            warn(`unknown light preset "${name}", using a plain white light.${known}`);
        }
    }
    return applyValues(base, values, flickerPresets, warn);
}
