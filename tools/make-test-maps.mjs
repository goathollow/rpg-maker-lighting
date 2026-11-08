// Makes the test project's normal and AO maps: test-only copies of RTP
// images under their own names, with simple maps drawn for them, and a
// tileset that uses them. Existing maps keep their plain images, so their
// screenshots do not change; tests switch to these on purpose.
//
//   Lab_People.png       People1, with domed normals and rimmed AO per frame
//   Lab_Inside_A5.png    Inside_A5, with beveled tile edges (normal map)
//   Lab_Inside_B.png     Inside_B, with domed normals and AO per tile
//   Lab_Ocean.png        the Ocean parallax, with domed normals
//   tileset "[Test] Inside, normal maps"   Inside, with those two sheets
//
//   node tools/make-test-maps.mjs [--force]

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const root = "testproject";
const force = process.argv.includes("--force");
export const TEST_TILESET_NAME = "[Test] Inside, normal maps";

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
    ensureTileset();
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replaceAll("\\", "/")}`) {
    makeTestMaps();
    console.log("[test maps] done");
}
