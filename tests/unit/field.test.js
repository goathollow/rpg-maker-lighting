import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    anyCasterIn,
    buildCasterGrid,
    casterAt,
    distanceField,
    FIELD_MARGIN,
    fieldDensity,
    fieldRange,
    sampleField,
    summedArea,
} from "../../src/core/field.js";

const TILE = 48;

// A map from rows of text: "#" casts shadows, anything else is free.
function mapOf(rows, { loopX = false, loopY = false } = {}) {
    const width = rows[0].length;
    const height = rows.length;
    const grid = buildCasterGrid(width, height, (x, y) => rows[y][x] === "#");
    return { grid, width, height, loopX, loopY };
}

// Exact signed distance from map pixel (x, y) to the casters' squares, the
// slow way: every tile, wrapping copies included.
function bruteDistance(map, x, y) {
    const inside = casterAt(map, Math.floor(x / TILE), Math.floor(y / TILE));
    let best = Infinity;
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    for (let ty = cy - 4; ty <= cy + 4; ty++) {
        for (let tx = cx - 4; tx <= cx + 4; tx++) {
            if (casterAt(map, tx, ty) === inside) continue;
            const dx = Math.max(tx * TILE - x, 0, x - (tx + 1) * TILE);
            const dy = Math.max(ty * TILE - y, 0, y - (ty + 1) * TILE);
            best = Math.min(best, Math.hypot(dx, dy));
        }
    }
    const [min, max] = fieldRange(TILE);
    return Math.min(max, Math.max(min, inside ? -best : best));
}

// A small deterministic generator, so a failure always reproduces.
function random(seed) {
    let s = seed;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) | 0;
        return (s >>> 0) / 2 ** 32;
    };
}

function randomMap(width, height, seed, options) {
    const next = random(seed);
    const rows = [];
    for (let y = 0; y < height; y++) {
        let row = "";
        for (let x = 0; x < width; x++) row += next() < 0.3 ? "#" : ".";
        rows.push(row);
    }
    return mapOf(rows, options);
}

// Half a step of the 8-bit encoding, in pixels.
const [MIN, MAX] = fieldRange(TILE);
const QUANTUM = (MAX - MIN) / 255 / 2 + 1e-9;

describe("caster grid", () => {
    test("marks the tiles the rule picks, row by row", () => {
        const map = mapOf(["#..", ".#."]);
        assert.deepEqual([...map.grid], [1, 0, 0, 0, 1, 0]);
    });

    test("wraps on looping maps; off any other map there is nothing", () => {
        const map = mapOf(["#.."]);
        assert.equal(casterAt(map, 3, 0), false);
        assert.equal(casterAt(map, -3, 0), false);
        const looping = { ...map, loopX: true, loopY: true };
        assert.equal(casterAt(looping, 3, 0), true);
        assert.equal(casterAt(looping, -3, 5), true);
    });

    test("finds casters in any rectangle, as counting them one by one does", () => {
        const map = randomMap(13, 9, 7);
        const sat = summedArea(map.grid, map.width, map.height);
        for (let y0 = -2; y0 < 10; y0 += 2) {
            for (let x0 = -2; x0 < 14; x0 += 3) {
                for (const [w, h] of [[0, 0], [1, 2], [4, 1], [20, 20]]) {
                    let slow = false;
                    for (let y = y0; y <= y0 + h; y++) {
                        for (let x = x0; x <= x0 + w; x++) slow ||= casterAt(map, x, y);
                    }
                    assert.equal(anyCasterIn(map, sat, x0, y0, x0 + w, y0 + h), slow, `${x0},${y0} +${w},${h}`);
                }
            }
        }
    });
});

describe("distance field", () => {
    test("holds the exact distance at every texel centre, within 8-bit rounding", () => {
        for (const [seed, options] of [[1, {}], [2, { loopX: true }], [3, { loopX: true, loopY: true }]]) {
            const map = randomMap(9, 7, seed, options);
            const field = distanceField(map, { tile: TILE, density: 4 });
            const [min, max] = fieldRange(TILE);
            for (let j = 0; j < field.texHeight; j++) {
                for (let i = 0; i < field.texWidth; i++) {
                    const x = ((i + 0.5) / field.density - FIELD_MARGIN) * TILE;
                    const y = ((j + 0.5) / field.density - FIELD_MARGIN) * TILE;
                    const stored = (field.data[j * field.texWidth + i] / 255) * (max - min) + min;
                    const exact = bruteDistance(map, x, y);
                    assert.ok(Math.abs(stored - exact) <= QUANTUM, `seed ${seed} at ${x},${y}: ${stored} vs ${exact}`);
                }
            }
        }
    });

    test("is zero on the edge of a caster, negative inside, and clamped far away", () => {
        const map = mapOf(["........", "...#....", "........"]);
        const field = distanceField(map, { tile: TILE });
        const edge = sampleField(field, 3 * TILE, 1.5 * TILE);
        assert.ok(Math.abs(edge) < 0.5, `edge ${edge}`);
        // The centre is between texels 3 px either way, which are 21 px in.
        assert.ok(Math.abs(sampleField(field, 3.5 * TILE, 1.5 * TILE) + 21) < 0.5);
        assert.ok(Math.abs(sampleField(field, 3.5 * TILE, 0.5 * TILE) - TILE / 2) < 1);
        assert.equal(sampleField(field, 7.5 * TILE, 1.5 * TILE), MAX);
    });

    test("on a looping map, sees casters across the edge", () => {
        const rows = ["#.......", "........"];
        const plain = distanceField(mapOf(rows), { tile: TILE });
        const looping = distanceField(mapOf(rows, { loopX: true }), { tile: TILE });
        const nearRightEdge = [8 * TILE - 10, 0.5 * TILE];
        assert.equal(sampleField(plain, ...nearRightEdge), MAX);
        assert.ok(Math.abs(sampleField(looping, ...nearRightEdge) - 10) < 1);
        // And the same point a whole map further on reads the same.
        assert.equal(sampleField(looping, 16 * TILE - 10, 0.5 * TILE), sampleField(looping, ...nearRightEdge));
    });

    test("texture rows are 4-byte aligned, and big maps get fewer samples a tile", () => {
        const field = distanceField(mapOf(["#.."]), { tile: TILE, density: 3 });
        assert.equal(field.texWidth % 4, 0);
        assert.equal(fieldDensity(20, 15), 8);
        assert.equal(fieldDensity(256, 256), 7);
        assert.ok((256 + FIELD_MARGIN * 2) * fieldDensity(256, 256) <= 2048 - 3);
    });

    test("scales with the tile size", () => {
        const map = mapOf(["....", ".#..", "...."]);
        const small = distanceField(map, { tile: 32 });
        assert.deepEqual(fieldRange(32), [-32, 64]);
        assert.ok(Math.abs(sampleField(small, 2 * 32 + 10, 1.5 * 32) - 10) < 0.5);
    });
});
