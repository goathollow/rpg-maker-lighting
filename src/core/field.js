// Shadow-casting tiles, as a grid and as the distance field that the
// shadowed light shaders march through (see shadowVisibility() in
// shadows.js).
//
// The field is sampled `density` times across each tile, over the map and a
// margin of FIELD_MARGIN tiles around it. Each sample is the distance in
// pixels from its point to the nearest shadow-casting tile, or, inside one,
// minus the distance to the nearest free tile. Values are clamped to one
// tile inside and two outside, and stored in 8 bits. Around a looping map
// the margin holds the tiles from the other side, so the field wraps without
// a seam; around any other map it is free space.

export const FIELD_MARGIN = 2;

// The stored range, in tiles: [min, max].
export const FIELD_TILES = Object.freeze([-1, 2]);
const [MIN_TILES, MAX_TILES] = FIELD_TILES;
// Rows either side of a sample that can hold a caster within range.
const ROWS = MAX_TILES + 1;

// The largest field texture side, in texels. WebGL 1 devices manage at least
// this, and it keeps the biggest MZ map (256 x 256) at a few megabytes.
const MAX_TEXTURE = 2048;

export function fieldRange(tile) {
    return [MIN_TILES * tile, MAX_TILES * tile];
}

// Samples per tile: 8, or fewer on maps too big for that.
export function fieldDensity(width, height, maxTexture = MAX_TEXTURE) {
    const tiles = Math.max(width, height) + FIELD_MARGIN * 2;
    return Math.max(1, Math.min(8, Math.floor((maxTexture - 3) / tiles)));
}

const wrap = (n, size) => ((n % size) + size) % size;

// 1 for each tile (row by row) where castsShadow(x, y) is true.
export function buildCasterGrid(width, height, castsShadow) {
    const grid = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) grid[y * width + x] = castsShadow(x, y) ? 1 : 0;
    }
    return grid;
}

// Whether tile (x, y) casts shadows, wrapping on looping maps. Off the edge
// of any other map there is nothing.
export function casterAt(map, x, y) {
    const { grid, width, height, loopX, loopY } = map;
    if (loopX) x = wrap(x, width);
    if (loopY) y = wrap(y, height);
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return grid[y * width + x] === 1;
}

// Running totals of the grid, so that rectangles can be checked for casters
// in constant time: entry (x, y) counts the casters above and left of it.
export function summedArea(grid, width, height) {
    const w = width + 1;
    const sat = new Uint32Array(w * (height + 1));
    for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
            row += grid[y * width + x];
            sat[(y + 1) * w + x + 1] = sat[y * w + x + 1] + row;
        }
    }
    return sat;
}

// Whether any tile from (x0, y0) to (x1, y1) inclusive casts shadows. On a
// looping map a rectangle that crosses the edge counts as having casters.
export function anyCasterIn(map, sat, x0, y0, x1, y1) {
    const { width, height, loopX, loopY } = map;
    if ((loopX && (x0 < 0 || x1 >= width)) || (loopY && (y0 < 0 || y1 >= height))) return true;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(width - 1, x1);
    y1 = Math.min(height - 1, y1);
    if (x0 > x1 || y0 > y1) return false;
    const w = width + 1;
    const n = sat[(y1 + 1) * w + x1 + 1] - sat[y0 * w + x1 + 1] - sat[(y1 + 1) * w + x0] + sat[y0 * w + x0];
    return n > 0;
}

// The distance field of `map` ({ grid, width, height, loopX, loopY }), as
// 8-bit texels: { data, texWidth, texHeight, density, tile, ...map }.
// Distances are exact (to the edges of the tiles' squares) at each texel's
// center, worked out row by row: for each nearby row of tiles, the gap
// across to that row's nearest caster, combined with the gap down to it.
export function distanceField(map, { tile = 48, density = fieldDensity(map.width, map.height) } = {}) {
    const m = FIELD_MARGIN;
    // Rows of a 1-byte texture must start on 4-byte boundaries.
    const texWidth = Math.ceil(((map.width + m * 2) * density) / 4) * 4;
    const texHeight = (map.height + m * 2) * density;
    const [min, max] = fieldRange(tile);

    // The tiles the texels can see: the texture's tiles plus ROWS beyond.
    const c0 = -m - ROWS;
    const r0 = -m - ROWS;
    const cols = Math.ceil(texWidth / density) + ROWS * 2;
    const rows = map.height + (m + ROWS) * 2;
    const ext = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) ext[r * cols + c] = casterAt(map, c + c0, r + r0) ? 1 : 0;
    }

    // For each tile, the nearest column to its left and right (in the same
    // row) that is a caster, and that is free. -Infinity / Infinity if none.
    const near = (want) => {
        const left = new Float64Array(cols * rows);
        const right = new Float64Array(cols * rows);
        for (let r = 0; r < rows; r++) {
            let last = -Infinity;
            for (let c = 0; c < cols; c++) {
                left[r * cols + c] = last;
                if (ext[r * cols + c] === want) last = c;
            }
            last = Infinity;
            for (let c = cols - 1; c >= 0; c--) {
                right[r * cols + c] = last;
                if (ext[r * cols + c] === want) last = c;
            }
        }
        return { left, right };
    };
    const toCaster = near(1);
    const toFree = near(0);

    const data = new Uint8Array(texWidth * texHeight);
    const span = max - min;
    for (let j = 0; j < texHeight; j++) {
        const y = ((j + 0.5) / density - m) * tile; // map pixels
        const row = Math.floor(y / tile) - r0;
        for (let i = 0; i < texWidth; i++) {
            const x = ((i + 0.5) / density - m) * tile;
            const col = Math.floor(x / tile) - c0;
            const inside = ext[row * cols + col] === 1;
            const { left, right } = inside ? toFree : toCaster;
            const want = inside ? 0 : 1;
            let best = Infinity;
            for (let r = row - ROWS; r <= row + ROWS; r++) {
                const ty = r + r0;
                const dy = r < row ? y - (ty + 1) * tile : r > row ? ty * tile - y : 0;
                let dx;
                if (ext[r * cols + col] === want) {
                    dx = 0;
                } else {
                    const l = left[r * cols + col];
                    const rt = right[r * cols + col];
                    dx = Math.min(x - (l + c0 + 1) * tile, (rt + c0) * tile - x);
                }
                best = Math.min(best, dx * dx + dy * dy);
            }
            const d = inside ? -Math.sqrt(best) : Math.sqrt(best);
            const v = Math.min(max, Math.max(min, d));
            data[j * texWidth + i] = Math.round(((v - min) / span) * 255);
        }
    }
    return { ...map, data, texWidth, texHeight, density, tile };
}

// The stored distance at map pixel (x, y), filtered the way the GPU filters
// the field texture: wrapped on looping maps, between the four nearest
// texels, clamped at the texture's edges.
export function sampleField(field, x, y) {
    const { data, texWidth, texHeight, density, tile, width, height, loopX, loopY } = field;
    if (loopX) x = wrap(x, width * tile);
    if (loopY) y = wrap(y, height * tile);
    const u = (x / tile + FIELD_MARGIN) * density - 0.5;
    const v = (y / tile + FIELD_MARGIN) * density - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const at = (a, b) => {
        const ci = Math.min(texWidth - 1, Math.max(0, a));
        const cj = Math.min(texHeight - 1, Math.max(0, b));
        return data[cj * texWidth + ci] / 255;
    };
    const s =
        (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
    const [min, max] = fieldRange(tile);
    return s * (max - min) + min;
}
