// Colors as typed by developers: "#rgb", "#rrggbb" or "red,green,blue" with
// each part 0-255. Returns [r, g, b] in 0..1, or null if unreadable.
export function parseColor(text) {
    if (typeof text !== "string") return null;
    const s = text.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
        return [...m[1]].map((h) => parseInt(h + h, 16) / 255);
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
        const hex = m[1];
        return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    }
    m = /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/.exec(s);
    if (m) {
        const rgb = m.slice(1).map(Number);
        if (rgb.every((v) => v <= 255)) return rgb.map((v) => v / 255);
    }
    return null;
}

// [r, g, b] in 0..1 to the 0xRRGGBB integer PIXI uses for tints.
export function colorToTint(color) {
    const to8 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    return (to8(color[0]) << 16) | (to8(color[1]) << 8) | to8(color[2]);
}
