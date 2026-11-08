// Built-in presets, in the string form the Plugin Manager stores. The build
// writes these into the plugin header as the parameters' defaults, so the
// editor and the code always agree.

// softness: the light's size in pixels (how soft shadow edges are);
// height: how high it hangs (higher lights give shorter character shadows).
const light = (name, color, radius, intensity, flicker, softness, height, shape = {}) => ({
    name,
    color,
    radius: String(radius),
    intensity: String(intensity),
    flicker,
    shape: shape.shape ?? "point",
    direction: shape.direction ?? "facing",
    spread: String(shape.spread ?? 60),
    width: String(shape.width ?? 48),
    shadows: "true",
    softness: String(softness),
    height: String(height),
    offsetX: "0",
    offsetY: "0",
});

export const DEFAULT_LIGHT_PRESETS = [
    light("Torch", "#ff9d4d", 168, 1, "Fire", 12, 72),
    light("Candle", "#ffc27a", 96, 0.9, "Candle", 6, 32),
    light("Lamp", "#ffd391", 144, 1, "", 8, 72),
    light("Fireplace", "#ff8a3d", 264, 1.2, "Fire", 24, 24),
    light("Lantern", "#ffe2a8", 216, 1, "Candle", 8, 40),
    light("Crystal", "#7fc4ff", 144, 1, "", 8, 48),
    light("Magic", "#c58cff", 144, 1, "Pulse", 8, 48),
    light("Flashlight", "#fff4dc", 336, 1, "", 4, 40, { shape: "cone", spread: 50 }),
    light("Sunbeam", "#fff1c7", 240, 1.3, "", 6, 240, { shape: "beam", direction: "down", width: 72 }),
];

// slow / fast: how far each layer moves the light (0-1); speeds are changes
// per second; sharpness 0 is a soft shimmer, 1 is sudden snaps.
const flicker = (name, slow, slowSpeed, fast, fastSpeed, sharpness) => ({
    name,
    slow: String(slow),
    slowSpeed: String(slowSpeed),
    fast: String(fast),
    fastSpeed: String(fastSpeed),
    sharpness: String(sharpness),
});

export const DEFAULT_FLICKER_PRESETS = [
    flicker("Fire", 0.15, 0.7, 0.1, 10, 0.6),
    flicker("Candle", 0.06, 0.5, 0.05, 7, 0.3),
    flicker("Pulse", 0.3, 0.4, 0, 10, 0),
    flicker("Faulty", 0, 0.5, 0.5, 8, 1),
];

export const DEFAULT_AMBIENT_PRESETS = [
    { name: "Day", color: "#ffffff" },
    { name: "Evening", color: "#8a7468" },
    { name: "Night", color: "#2c3352" },
    { name: "Dungeon", color: "#2a2632" },
    { name: "Cave", color: "#18181f" },
    { name: "Darkness", color: "#000000" },
];
