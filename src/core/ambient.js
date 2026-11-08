import { parseColor } from "./color.js";
import { readString } from "./params.js";

// Ambient light is the color the whole map is multiplied by before lights
// are added. White means unlit: the map draws exactly as without the plugin.
//
// There are two levels:
//   global light  game-wide, kept across maps (day and night, weather...)
//   map ambient   a map's own <ambient> tag, for interiors, caves and so on
// A map without an <ambient> tag follows the global light.
export const UNLIT = Object.freeze([1, 1, 1]);

export function isUnlit(color) {
    return color[0] >= 1 && color[1] >= 1 && color[2] >= 1;
}

// Plugin Manager preset structs -> Map of lower-cased name to color.
export function buildAmbientPresets(structs, warn = () => {}) {
    const presets = new Map();
    for (const struct of structs) {
        const name = readString(struct.name, "");
        const color = parseColor(struct.color);
        if (!name || !color) {
            warn(`ambient preset "${name}" needs a name and a color like #303860; skipped`);
        } else if (!presets.has(name.toLowerCase())) {
            presets.set(name.toLowerCase(), color);
        }
    }
    return presets;
}

// Text of an <ambient> tag or command -> color, or null when blank or
// unreadable. Accepts a preset name, a color, or "off"/"none" for fully lit.
export function resolveAmbient(text, presets, warn = () => {}) {
    const s = String(text ?? "").trim();
    if (!s) return null;
    if (/^(off|none)$/i.test(s)) return UNLIT.slice();
    const preset = presets.get(s.toLowerCase());
    if (preset) return preset.slice();
    const color = parseColor(s);
    if (color) return color;
    warn(`unknown ambient "${s}"; use a preset name, a color like #303860, or off`);
    return null;
}

// Ambient state is a plain object so it can live in the save file:
//   color         current color
//   target        color being faded to
//   duration      frames of fade left
//   base          the map's own ambient for "reset", or null if it has none
//   followGlobal  true while the color tracks the global light
//
// `base` null means the state follows the global light, starting from
// `globalColor`. The global light itself is a state with a fixed base.
export function createAmbient(base, globalColor = UNLIT) {
    const color = (base ?? globalColor).slice();
    return {
        color,
        target: color.slice(),
        duration: 0,
        base: base ? base.slice() : null,
        followGlobal: !base,
    };
}

// Fades to a fixed color. A map that was following the global light stops
// following it until reset.
export function fadeAmbient(state, target, duration) {
    state.followGlobal = false;
    state.target = target.slice();
    state.duration = Math.max(0, Math.round(duration));
    if (state.duration === 0) state.color = target.slice();
}

// Fades back to the map's own ambient, or, for a map without one, back to
// following the global light.
export function resetAmbient(state, duration, globalColor) {
    if (state.base) {
        fadeAmbient(state, state.base, duration);
    } else {
        fadeAmbient(state, globalColor, duration);
        state.followGlobal = true;
    }
}

// One frame: the same linear step MZ uses for Tint Screen. While following,
// the target is the global light's current color, so a map fades along
// with a global fade, or catches up with it after a reset.
export function updateAmbient(state, globalColor) {
    if (state.followGlobal && globalColor) {
        for (let i = 0; i < 3; i++) state.target[i] = globalColor[i];
    }
    if (state.duration > 0) {
        const d = state.duration;
        for (let i = 0; i < 3; i++) {
            state.color[i] = (state.color[i] * (d - 1) + state.target[i]) / d;
        }
        state.duration--;
    } else if (state.followGlobal && globalColor) {
        for (let i = 0; i < 3; i++) state.color[i] = globalColor[i];
    }
}
