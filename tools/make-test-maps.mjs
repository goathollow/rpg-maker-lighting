// Makes the test project's normal and AO maps: test-only copies of RTP
// images under their own names, with maps made for them, and a tileset that
// uses them. Existing maps keep their plain images, so their screenshots do
// not change; tests switch to these on purpose.
//
//   Lab_People.png       People1, with domed normals and rimmed AO per frame
//   Lab_Inside_A5.png    Inside_A5, with beveled tile edges (normal map)
//   Lab_Inside_B.png     Inside_B, with domed normals and AO per tile
//   Lab_Ocean.png        the Ocean parallax, with domed normals
//   Showcase_Party.png   Actor1, with maps worked out from its sprites, for
//                        the showcase party (actors 9-16)
//   tileset "[Test] Inside, normal maps"   Inside, with those two sheets
//
// They are made from the RTP in each person's own MZ install, so nothing
// from it is in the repository.
//
//   node tools/make-test-maps.mjs [--force]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const root = "testproject";
const force = process.argv.includes("--force");
export const TEST_TILESET_NAME = "[Test] Inside, normal maps";
// The showcase party's sheet (actors 9-16).
export const SHOWCASE_SHEET = "Showcase_Party";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

// An 8-bit RGBA PNG from pixel(x, y) -> [r, g, b, a].
export function encodePng(width, height, pixel) {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        const row = y * (width * 4 + 1);
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixel(x, y);
            raw.set([r, g, b, a], row + 1 + x * 4);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

// An 8-bit, non-interlaced PNG -> { width, height, data } with data as RGBA
// bytes, row by row. Enough for the RTP's images; anything else throws.
export function decodePng(buffer) {
    let width = 0;
    let height = 0;
    let colorType = 0;
    let palette = null;
    let transparency = null;
    const idat = [];
    for (let at = 8; at < buffer.length; ) {
        const length = buffer.readUInt32BE(at);
        const type = buffer.toString("ascii", at + 4, at + 8);
        const data = buffer.subarray(at + 8, at + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            colorType = data[9];
            if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs");
        } else if (type === "PLTE") {
            palette = data;
        } else if (type === "tRNS") {
            transparency = data;
        } else if (type === "IDAT") {
            idat.push(data);
        }
        at += 12 + length;
    }
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels) throw new Error(`unknown PNG color type ${colorType}`);
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const rows = Buffer.alloc(stride * height);
    // Undo each row's filter (PNG spec, section 9).
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = rows.subarray(y * stride, (y + 1) * stride);
        const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
        for (let i = 0; i < stride; i++) {
            const a = i >= channels ? out[i - channels] : 0;
            const b = up ? up[i] : 0;
            const c = up && i >= channels ? up[i - channels] : 0;
            let v = line[i];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            out[i] = v & 255;
        }
    }
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const s = rows.subarray(i * channels, (i + 1) * channels);
        let rgba;
        if (colorType === 3) {
            rgba = [palette[s[0] * 3], palette[s[0] * 3 + 1], palette[s[0] * 3 + 2], transparency && s[0] < transparency.length ? transparency[s[0]] : 255];
        } else if (colorType === 0 || colorType === 4) {
            rgba = [s[0], s[0], s[0], colorType === 4 ? s[1] : 255];
        } else {
            rgba = [s[0], s[1], s[2], colorType === 6 ? s[3] : 255];
        }
        data.set(rgba, i * 4);
    }
    return { width, height, data };
}

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

// A normal map pixel the way tools save it: x right, green up the image.
export const normalPixel = ([x, y, z]) => [clampByte(128 + x * 127), clampByte(128 - y * 127), clampByte(128 + z * 127), 255];

// Screen-space (y down) normals of a dome of radius r centered at (cx, cy).
export function dome(x, y, cx, cy, r) {
    const dx = (x + 0.5 - cx) / r;
    const dy = (y + 0.5 - cy) / r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1) return [0, 0, 1];
    return [dx, dy, Math.sqrt(1 - d2)];
}

// A tile with its edges beveled outward over `width` pixels.
export function bevel(x, y, size, width) {
    const u = x % size;
    const v = y % size;
    const s = Math.SQRT1_2;
    if (u < width) return [-s, 0, s];
    if (u >= size - width) return [s, 0, s];
    if (v < width) return [0, -s, s];
    if (v >= size - width) return [0, s, s];
    return [0, 0, 1];
}

// Character frames are 48 x 48; the dome sits on the body.
export const PEOPLE_DOME = { cx: 24, cy: 28, r: 18 };
export const peopleNormal = (x, y) => dome(x % 48, y % 48, PEOPLE_DOME.cx, PEOPLE_DOME.cy, PEOPLE_DOME.r);
export function peopleAO(x, y) {
    const [, , z] = peopleNormal(x, y);
    return 0.35 + 0.65 * z;
}
export const sheetBNormal = (x, y) => dome(x % 48, y % 48, 24, 24, 22);
export const sheetBAO = (x, y) => 0.5 + 0.5 * sheetBNormal(x, y)[2];
export const sheetA5Normal = (x, y) => bevel(x, y, 48, 6);
// Ocean is 816 pixels square: eight domes across, so they wrap seamlessly.
export const parallaxNormal = (x, y) => dome(x % 102, y % 102, 51, 51, 46);

// Normal and AO maps for a sheet of character sprites, worked out from the
// sprites the way normal map tools do: each sprite's silhouette rounded off
// over its outer `bevel` pixels, and its fine detail (hair, folds,
// outlines) raised or sunk by how much lighter or darker it is than the
// pixels around it. AO darkens where that surface dips. Each frame
// (`frame` pixels square) is worked out on its own. Returns normal(x, y)
// (screen space, y down) and ao(x, y) (0..1, 1 = open).
//
//   bevel   how far in from the outline the rounding goes, in pixels
//   detail  pixels of height per unit of lightness
//   dip     how much AO darkens per pixel of dip
export const SPRITE_MAPS = Object.freeze({ frame: 48, bevel: 6, detail: 1, dip: 0.15 });
export function spriteMaps({ width, height, data }, options = {}) {
    const { frame, bevel, detail, dip: dipStrength } = { ...SPRITE_MAPS, ...options };
    const count = width * height;
    const solid = new Uint8Array(count);
    const light = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        solid[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
        light[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    }
    // Whether (x, y) is an opaque pixel of the same frame as (x0, y0).
    const sameFrame = (x0, y0, x, y) =>
        x >= 0 && y >= 0 && x < width && y < height && Math.floor(x / frame) === Math.floor(x0 / frame) && Math.floor(y / frame) === Math.floor(y0 / frame);
    const opaque = (x0, y0, x, y) => sameFrame(x0, y0, x, y) && solid[y * width + x] === 1;

    const lift = new Float32Array(count);
    const reach = Math.ceil(bevel) + 1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!solid[y * width + x]) continue;
            // Distance to the nearest clear pixel, up to the bevel's width.
            let edge = bevel;
            let sum = 0;
            let n = 0;
            for (let dy = -reach; dy <= reach; dy++) {
                for (let dx = -reach; dx <= reach; dx++) {
                    const inside = opaque(x, y, x + dx, y + dy);
                    if (!inside) edge = Math.min(edge, Math.hypot(dx, dy) - 0.5);
                    else if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
                        sum += light[(y + dy) * width + x + dx];
                        n++;
                    }
                }
            }
            const t = Math.max(0, edge) / bevel;
            const round = bevel * Math.sqrt(1 - (1 - t) * (1 - t));
            lift[y * width + x] = round + detail * (light[y * width + x] - sum / n);
        }
    }

    const liftAt = (x0, y0, x, y) => (opaque(x0, y0, x, y) ? lift[y * width + x] : 0);
    return {
        normal(x, y) {
            if (!solid[y * width + x]) return [0, 0, 1];
            const l = (dx, dy) => liftAt(x, y, x + dx, y + dy);
            const gx = (l(1, -1) + 2 * l(1, 0) + l(1, 1) - l(-1, -1) - 2 * l(-1, 0) - l(-1, 1)) / 8;
            const gy = (l(-1, 1) + 2 * l(0, 1) + l(1, 1) - l(-1, -1) - 2 * l(0, -1) - l(1, -1)) / 8;
            const length = Math.hypot(gx, gy, 1);
            return [-gx / length, -gy / length, 1 / length];
        },
        ao(x, y) {
            if (!solid[y * width + x]) return 1;
            let sum = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += liftAt(x, y, x + dx, y + dy);
            const dip = sum / 25 - lift[y * width + x];
            return 1 - Math.min(0.6, Math.max(0, dip) * dipStrength);
        },
    };
}

const gray = (v) => [clampByte(v * 255), clampByte(v * 255), clampByte(v * 255), 255];

function sizeOf(file) {
    const b = readFileSync(file);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function make(dir, from, to, maps) {
    const src = `${root}/img/${dir}/${from}.png`;
    if (!existsSync(src)) {
        console.warn(`[test maps] ${src} not found; run npm run setup first`);
        return;
    }
    const copy = `${root}/img/${dir}/${to}.png`;
    if (force || !existsSync(copy)) copyFileSync(src, copy);
    const [width, height] = sizeOf(src);
    for (const [suffix, pixel] of Object.entries(maps)) {
        const file = `${root}/img/${dir}/${to}_${suffix}.png`;
        if (force || !existsSync(file)) writeFileSync(file, encodePng(width, height, pixel));
    }
}

function ensureTileset() {
    const path = `${root}/data/Tilesets.json`;
    const tilesets = JSON.parse(readFileSync(path, "utf8"));
    if (tilesets.some((t) => t && t.name === TEST_TILESET_NAME)) return;
    const inside = tilesets.find((t) => t && t.name === "Inside");
    if (!inside) return;
    const names = inside.tilesetNames.slice();
    names[4] = "Lab_Inside_A5";
    names[5] = "Lab_Inside_B";
    tilesets.push({ ...inside, id: tilesets.length, name: TEST_TILESET_NAME, tilesetNames: names, note: "" });
    // MZ writes Tilesets.json one entry per line; keep that so diffs stay small.
    writeFileSync(path, "[\n" + tilesets.map((t) => JSON.stringify(t)).join(",\n") + "\n]");
}

export function makeTestMaps() {
    if (!existsSync(`${root}/img`)) return;
    make("characters", "People1", "Lab_People", {
        normal: (x, y) => normalPixel(peopleNormal(x, y)),
        ao: (x, y) => gray(peopleAO(x, y)),
    });
    make("tilesets", "Inside_A5", "Lab_Inside_A5", { normal: (x, y) => normalPixel(sheetA5Normal(x, y)) });
    make("tilesets", "Inside_B", "Lab_Inside_B", {
        n: (x, y) => normalPixel(sheetBNormal(x, y)),
        ao: (x, y) => gray(sheetBAO(x, y)),
    });
    make("parallaxes", "Ocean", "Lab_Ocean", { normal: (x, y) => normalPixel(parallaxNormal(x, y)) });
    // Worked out only when the maps are being written.
    let party = null;
    const partyMaps = () => (party ??= spriteMaps(decodePng(readFileSync(`${root}/img/characters/Actor1.png`))));
    make("characters", "Actor1", SHOWCASE_SHEET, {
        normal: (x, y) => normalPixel(partyMaps().normal(x, y)),
        ao: (x, y) => gray(partyMaps().ao(x, y)),
    });
    ensureTileset();
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replaceAll("\\", "/")}`) {
    makeTestMaps();
    console.log("[test maps] done");
}
