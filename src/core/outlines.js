// Characters' outlines, which give their shadows the shape of their sprites
// (see shadowVisibility() in shadows.js).
//
// Each frame of a sprite is drawn into a square slot OUTLINE_SLOT texels
// across, its longer side filling the slot, and kept as a signed distance
// field: per texel, the distance from its center to the outline of the
// frame's opaque pixels (alpha at least half), negative inside, in slot
// texels. Values are clamped to OUTLINE_RANGE and stored in 8 bits. The
// slots sit OUTLINE_COLUMNS to a row in one texture, which the shadowed light
// shaders read.
//
// A shadow works in the plane a character stands up in: `across` pixels
// from the middle of its sprite and `up` from its feet, the way its frame is
// drawn on screen.

export const OUTLINE_SLOT = 64;
export const OUTLINE_COLUMNS = 8;
export const OUTLINE_SLOTS = OUTLINE_COLUMNS * OUTLINE_COLUMNS;
export const OUTLINE_ATLAS = OUTLINE_SLOT * OUTLINE_COLUMNS;
// The stored range, in slot texels: [min, max].
export const OUTLINE_RANGE = Object.freeze([-16, 48]);
const [MIN, MAX] = OUTLINE_RANGE;

const INF = 1e20;

// The size a frame `ratio` times as wide as it is tall is drawn at in its
// slot, in slot texels: [width, height].
export function outlineSize(ratio) {
    return [OUTLINE_SLOT * Math.min(1, ratio), OUTLINE_SLOT * Math.min(1, 1 / ratio)];
}

// One row or column of the squared distance transform (Felzenszwalb and
// Huttenlocher): d[q] = min over p of (q - p)^2 + f[p].
function transform1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
            k--;
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
}

// For each cell of a w x h grid, the squared distance to the nearest cell
// where `isSource` is true (INF-ish with none).
function squaredDistances(w, h, isSource) {
    const grid = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) grid[i] = isSource(i) ? 0 : INF;
    const n = Math.max(w, h);
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
        transform1d(f, h, d, v, z);
        for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
        transform1d(f, w, d, v, z);
        for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
    }
    return grid;
}

// The outline of a frame drawn into the top left of a slot, `width` x
// `height` texels of alpha (0-255, row by row), as the slot's 8-bit texels.
// Beyond the frame is empty space.
export function outlineField(alpha, width, height) {
    // A texel of empty space all round, so the frame's edges count as
    // outline too.
    const w = width + 2;
    const h = height + 2;
    const solid = new Uint8Array(w * h);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) solid[(y + 1) * w + x + 1] = alpha[y * width + x] >= 128 ? 1 : 0;
    }
    const toSolid = squaredDistances(w, h, (i) => solid[i] === 1);
    const toEmpty = squaredDistances(w, h, (i) => solid[i] === 0);
    const data = new Uint8Array(OUTLINE_SLOT * OUTLINE_SLOT).fill(255);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y + 1) * w + x + 1;
            // Half a texel either side of the edge between two texels.
            const d = solid[i] ? 0.5 - Math.sqrt(toEmpty[i]) : Math.sqrt(toSolid[i]) - 0.5;
            const v = Math.min(MAX, Math.max(MIN, d));
            data[y * OUTLINE_SLOT + x] = Math.round(((v - MIN) / (MAX - MIN)) * 255);
        }
    }
    return data;
}

// The distance in slot texels from slot point (x, y) to the outline in
// `data` (one slot's texels), filtered the way the GPU filters the texture:
// between the four nearest texels, at a point kept half a texel inside the
// frame (`width` x `height` texels), plus the way from there to the point.
export function sampleOutline(data, width, height, x, y) {
    const cx = Math.min(width - 0.5, Math.max(0.5, x));
    const cy = Math.min(height - 0.5, Math.max(0.5, y));
    const u = cx - 0.5;
    const v = cy - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const last = OUTLINE_SLOT - 1;
    const at = (a, b) => data[Math.min(last, b) * OUTLINE_SLOT + Math.min(last, a)] / 255;
    const s =
        (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
    return s * (MAX - MIN) + MIN + Math.hypot(x - cx, y - cy);
}

// The distance in pixels from a point in a character's plane (`across` from
// the middle, `up` from its feet) to its outline, stretched to `width` x
// `height` pixels. `ratio` is its frame's width over its height. Stretched
// unevenly, distances are measured at the smaller scale.
export function outlineDistance(data, ratio, width, height, across, up) {
    const [w, h] = outlineSize(ratio);
    const kx = width / w;
    const ky = height / h;
    return sampleOutline(data, w, h, across / kx + w / 2, h - up / ky) * Math.min(kx, ky);
}
