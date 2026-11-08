// Surface maps: images saved beside a game image that describe its surface.
// They are found by name, so for img/characters/Actor1.png:
//
//   Actor1_normal.png     which way each pixel faces (also _n, _norm)
//   Actor1_ao.png         how much of the ambient light reaches each pixel:
//                         ambient occlusion (also _occlusion, _o)
//   Actor1_specular.png   how shiny each pixel is (also _spec, _s)
//
// Names are matched whatever their case. The short forms are what tools
// such as Laigter save.

// Each kind's suffixes, the preferred one first.
export const SURFACE_KINDS = Object.freeze({
    normal: ["normal", "norm", "n"],
    ao: ["ao", "occlusion", "o"],
    specular: ["specular", "spec", "s"],
});

// The image folders whose pictures are lit: map characters, tilesets and
// parallaxes. Pictures, battle backs and faces are drawn over the light.
export const SURFACE_FOLDERS = Object.freeze(["characters", "tilesets", "parallaxes"]);

// Where a play-test saves the list of surface maps, for platforms that cannot
// list folders (browsers and phones).
export const MANIFEST_FILE = "data/GH_LightingMaps.json";

// How much brighter than flat ground a surface facing a light can get.
// Without a cap, a low light far away would make the faces turned toward
// it many times brighter than the ground.
export const MAX_SHADING = 2;

// With surfaces, the light buffer holds each light's weight (its brightest
// channel over the ambient) divided by the frame's weight range (see
// "weight" in src/mz/shaders.js). Only the ratio of the buffer's two sums
// is used, so the range only sets how fine its 8-bit steps are: the smaller,
// the finer, as long as the sums stay below 1. The range is the total
// weight of the lights on screen, so they fit even where they all overlap,
// up to WEIGHT_RANGE; past that, only where many lights crowd together can
// the sums reach 1.
export const WEIGHT_RANGE = 4;

export function weightRange(totalWeight) {
    return Math.min(WEIGHT_RANGE, totalWeight);
}

// Auto normal maps: how steep a surface gets per step in brightness, at
// strength 1.
export const AUTO_NORMAL_SCALE = 0.5;

const SUFFIX = new RegExp(`^(.+)_(${Object.values(SURFACE_KINDS).flat().join("|")})$`, "i");

// A file name without its .png (or .png_, when encrypted for release), or
// null for files that are not images.
export function fileStem(file) {
    const m = /^(.+)\.png_?$/i.exec(file);
    return m ? m[1] : null;
}

// For a surface map's file stem, [the image it belongs to, its kind], or
// null for an ordinary image.
export function surfaceMapOf(stem) {
    const m = SUFFIX.exec(stem);
    if (!m) return null;
    const suffix = m[2].toLowerCase();
    for (const [kind, suffixes] of Object.entries(SURFACE_KINDS)) {
        if (suffixes.includes(suffix)) return [m[1], kind];
    }
    return null;
}

// Every image with surface maps among a folder's files, as a Map from the
// image's lower-cased name to { normal, ao, specular }: the stem of each map
// found (to load it by), or undefined. Where two files are maps of the same
// kind (Actor1_n and Actor1_normal), the preferred suffix wins.
export function surfaceMapsIn(files) {
    const found = new Map();
    const rank = new Map();
    for (const file of files) {
        const stem = fileStem(file);
        const map = stem && surfaceMapOf(stem);
        if (!map) continue;
        const [image, kind] = map;
        const key = image.toLowerCase();
        const suffix = stem.slice(image.length + 1).toLowerCase();
        const r = SURFACE_KINDS[kind].indexOf(suffix);
        if (!found.has(key)) found.set(key, {});
        const rankKey = `${key}/${kind}`;
        if (!rank.has(rankKey) || r < rank.get(rankKey)) {
            found.get(key)[kind] = stem;
            rank.set(rankKey, r);
        }
    }
    return found;
}

// The manifest a play-test saves: each folder's surface map stems, sorted so
// the file only changes when the maps do.
export function buildManifest(listings) {
    const manifest = {};
    for (const folder of SURFACE_FOLDERS) {
        const stems = (listings[folder] ?? []).map(fileStem).filter((stem) => stem && surfaceMapOf(stem));
        manifest[folder] = [...new Set(stems)].sort();
    }
    return manifest;
}

// A manifest read back: folder -> surfaceMapsIn() of its maps. Anything
// unreadable counts as no maps.
export function readManifest(manifest) {
    const out = new Map();
    for (const folder of SURFACE_FOLDERS) {
        const stems = manifest && Array.isArray(manifest[folder]) ? manifest[folder] : [];
        out.set(folder, surfaceMapsIn(stems.filter((s) => typeof s === "string").map((s) => `${s}.png`)));
    }
    return out;
}

// Surface normals are kept as 8-bit pairs: x and y on screen (y down), where
// 128 is flat. z is never stored: it follows from x and y, as normals face
// the viewer.
export function encodeNormal(v) {
    return Math.round(Math.max(-1, Math.min(1, v)) * 127 + 128);
}

export function decodeNormal(r, g) {
    let x = Math.max(-1, Math.min(1, (r - 128) / 127));
    let y = Math.max(-1, Math.min(1, (g - 128) / 127));
    const len2 = x * x + y * y;
    if (len2 > 1) {
        const len = Math.sqrt(len2);
        x /= len;
        y /= len;
    }
    return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
}

// The green byte of a normal map pixel turned into screen y (down). Most
// tools save green pointing up the image ("OpenGL" style), so it is flipped;
// "DirectX" style maps point it down already.
export function screenGreen(g, greenUp = true) {
    return greenUp ? Math.min(255, 256 - g) : g;
}

// A normal made steeper (strength above 1) or flatter (below 1).
export function strengthen([x, y, z], strength) {
    const sx = x * strength;
    const sy = y * strength;
    const len = Math.hypot(sx, sy, z);
    return len > 0 ? [sx / len, sy / len, z / len] : [0, 0, 1];
}

// How a light falls on a surface, relative to flat ground: 1 on flat
// ground, more on faces turned toward the light, less (down to none) on
// faces turned away. (vx, vy) runs from the surface point to the light on
// screen and `height` is how high the light hangs.
//
// A light's falloff (src/core/shapes.js) is how it lights flat ground, so
// this is the ratio of the surface's lighting to the ground's: N.L / Nflat.L,
// which comes to n.z + (n.xy . v) / height.
export function surfaceShading([nx, ny, nz], vx, vy, height) {
    const k = nz + (nx * vx + ny * vy) / Math.max(height, 1);
    return Math.max(0, Math.min(MAX_SHADING, k));
}

// The 0-1 brightness used as height for auto normal maps: the luma of a
// colour already multiplied by its alpha, so a sprite's outline slopes down
// to the transparent pixels around it.
export function autoHeight(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// An auto normal from the heights around a pixel, heightAt(dx, dy) for the
// 3x3 block around it (the caller keeps taps inside the sprite's frame): a
// Sobel gradient, so bright details stand out of dark ones.
export function autoNormal(heightAt, strength) {
    const gx =
        heightAt(1, -1) + 2 * heightAt(1, 0) + heightAt(1, 1) - heightAt(-1, -1) - 2 * heightAt(-1, 0) - heightAt(-1, 1);
    const gy =
        heightAt(-1, 1) + 2 * heightAt(0, 1) + heightAt(1, 1) - heightAt(-1, -1) - 2 * heightAt(0, -1) - heightAt(1, -1);
    const k = strength * AUTO_NORMAL_SCALE;
    const x = -gx * k || 0; // never -0
    const y = -gy * k || 0;
    const len = Math.hypot(x, y, 1);
    return [x / len, y / len, 1 / len];
}

// Which images get auto normal maps, by the Auto Normal Maps parameter.
export const AUTO_NORMALS = Object.freeze({
    off: { characters: false, tiles: false },
    characters: { characters: true, tiles: false },
    tiles: { characters: false, tiles: true },
    all: { characters: true, tiles: true },
});
