import { valueNoise } from "./noise.js";
import { readNumber } from "./params.js";

// Two-layer light flicker.
//
//   slow  The overall level and flow of the light: it eases to a new level a
//         few times a second or less, giving fire its long, almost rhythmic
//         breathing.
//   fast  Short-lived changes on top: the pops and crackle of new fuel
//         catching. Sharpness turns it from a soft shimmer into hard snaps.
//
// The result is a brightness multiplier centered on 1, so a light's average
// brightness stays where the developer set it. It depends only on time and
// seed: frame-rate independent, identical on every machine and cheap enough
// to evaluate per light per frame.

export const FLICKER_DEFAULTS = Object.freeze({
    slowStrength: 0, // 0..1, how far the slow layer moves brightness
    slowSpeed: 0.5, // new levels per second
    fastStrength: 0, // 0..1
    fastSpeed: 10, // new levels per second
    fastSharpness: 0.5, // 0 = smooth shimmer, 1 = instant snaps
});

// Speeds above half of 60 fps would alias into a different, slower pattern.
const MAX_SPEED = 30;

// Decorrelates the fast layer from the slow one when both use the same seed.
const FAST_SALT = 0x5bd1e995;

export function normalizeFlicker(raw = {}) {
    const d = FLICKER_DEFAULTS;
    const speed = { min: 0, max: MAX_SPEED };
    const unit = { min: 0, max: 1 };
    return {
        slowStrength: readNumber(raw.slowStrength, d.slowStrength, unit),
        slowSpeed: readNumber(raw.slowSpeed, d.slowSpeed, speed),
        fastStrength: readNumber(raw.fastStrength, d.fastStrength, unit),
        fastSpeed: readNumber(raw.fastSpeed, d.fastSpeed, speed),
        fastSharpness: readNumber(raw.fastSharpness, d.fastSharpness, unit),
    };
}

// `options` must come from normalizeFlicker(); time is in seconds.
export function flicker(time, seed, options) {
    let m = 1;
    if (options.slowStrength > 0) {
        m += options.slowStrength * valueNoise(time * options.slowSpeed, seed, 2);
    }
    if (options.fastStrength > 0) {
        // Sharpness 0 -> 1 maps to an ease exponent of 2 -> 32.
        const k = 2 * 16 ** options.fastSharpness;
        m += options.fastStrength * valueNoise(time * options.fastSpeed, seed ^ FAST_SALT, k);
    }
    return m < 0 ? 0 : m;
}

export const NO_FLICKER = Object.freeze(normalizeFlicker());

export function isFlickering(options) {
    return options.slowStrength > 0 || options.fastStrength > 0;
}

// The words for each flicker setting, in notetags and preset fields, and
// the range each is clamped to.
export const FLICKER_KEYS = Object.freeze({
    slow: "slowStrength",
    slowspeed: "slowSpeed",
    fast: "fastStrength",
    fastspeed: "fastSpeed",
    sharpness: "fastSharpness",
});

export const FLICKER_LIMITS = Object.freeze({
    slowStrength: [0, 1],
    slowSpeed: [0, MAX_SPEED],
    fastStrength: [0, 1],
    fastSpeed: [0, MAX_SPEED],
    fastSharpness: [0, 1],
});

// Plugin Manager flicker preset structs -> Map of lower-cased name to
// normalized options. Blank or unreadable fields fall back to no flicker.
export function buildFlickerPresets(structs, warn = () => {}) {
    const presets = new Map();
    for (const struct of structs) {
        const name = String(struct.name ?? "").trim();
        if (!name) {
            warn("a flicker preset has no name and was skipped");
            continue;
        }
        if (presets.has(name.toLowerCase())) {
            warn(`flicker preset "${name}" is defined twice; using the first`);
            continue;
        }
        const raw = {};
        for (const [key, value] of Object.entries(struct)) {
            const prop = FLICKER_KEYS[key.toLowerCase()];
            if (prop) raw[prop] = value;
        }
        presets.set(name.toLowerCase(), Object.freeze(normalizeFlicker(raw)));
    }
    return presets;
}
