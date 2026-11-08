import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    OUTLINE_RANGE,
    OUTLINE_SLOT,
    outlineDistance,
    outlineField,
    outlineSize,
    sampleOutline,
} from "../../src/core/outlines.js";

const S = OUTLINE_SLOT;
const [MIN, MAX] = OUTLINE_RANGE;
// One stored step.
const STEP = (MAX - MIN) / 255;

// A whole slot of alpha, opaque where solid(x, y) says (texel indices).
function alphaOf(solid, width = S, height = S) {
    const alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = solid(x, y) ? 255 : 0;
    return alpha;
}

// A square from texel 16 to texel 47 each way.
const square = outlineField(alphaOf((x, y) => x >= 16 && x < 48 && y >= 16 && y < 48), S, S);
const at = (data, x, y) => sampleOutline(data, S, S, x + 0.5, y + 0.5);

describe("outlines", () => {
    test("each texel holds its distance to the edge of the opaque pixels, negative inside", () => {
        assert.ok(Math.abs(at(square, 8, 32) - 7.5) <= STEP, "8 texels out");
        assert.ok(Math.abs(at(square, 15, 32) - 0.5) <= STEP, "next to it");
        assert.ok(Math.abs(at(square, 16, 32) + 0.5) <= STEP, "just inside");
        assert.ok(Math.abs(at(square, 20, 32) + 4.5) <= STEP, "4 texels in");
        // Off a corner, within half a texel of the way to it.
        assert.ok(Math.abs(at(square, 7, 7) - Math.hypot(8.5, 8.5)) <= 0.5, "off a corner");
    });

    test("distances are clamped to the stored range", () => {
        const dot = outlineField(alphaOf((x, y) => x === 0 && y === 0), S, S);
        assert.equal(at(dot, 63, 63), MAX);
        const full = outlineField(alphaOf(() => true), S, S);
        assert.equal(at(full, 32, 32), MIN);
    });

    test("the edges of the frame count as outline", () => {
        const full = outlineField(alphaOf(() => true), S, S);
        assert.ok(Math.abs(at(full, 0, 32) + 0.5) <= STEP);
        assert.ok(Math.abs(at(full, 63, 32) + 0.5) <= STEP);
    });

    test("with nothing opaque, there is no outline anywhere", () => {
        const empty = outlineField(alphaOf(() => false), S, S);
        assert.equal(at(empty, 32, 32), MAX);
    });

    test("beyond the frame, the distance carries on from its edge", () => {
        // A frame 32 texels wide, opaque in its left half.
        const half = outlineField(alphaOf((x) => x < 16, 32, S), 32, S);
        const edge = sampleOutline(half, 32, S, 31.5, 32);
        assert.ok(Math.abs(sampleOutline(half, 32, S, 41.5, 32) - (edge + 10)) < 1e-9);
        assert.ok(Math.abs(sampleOutline(half, 32, S, -9.5, 32) - (sampleOutline(half, 32, S, 0.5, 32) + 10)) < 1e-9);
    });

    test("frames are scaled to fit their slot, the longer side filling it", () => {
        assert.deepEqual(outlineSize(1), [S, S]);
        assert.deepEqual(outlineSize(0.5), [S / 2, S]);
        assert.deepEqual(outlineSize(2), [S, S / 2]);
    });

    test("a character's plane maps onto its frame, across from the middle and up from the feet", () => {
        // On a 48 px sprite the square covers the middle half, 12 to 36 px
        // each way: 12 px either side of the middle, and 12 to 36 px up.
        const near = (a, b) => Math.abs(a - b) <= 0.5;
        assert.ok(near(outlineDistance(square, 1, 48, 48, 0, 24), -12), "its middle");
        assert.ok(near(outlineDistance(square, 1, 48, 48, 18, 24), 6), "6 px right of it");
        assert.ok(near(outlineDistance(square, 1, 48, 48, -18, 24), 6), "6 px left of it");
        assert.ok(near(outlineDistance(square, 1, 48, 48, 0, 6), 6), "6 px below it");
        assert.ok(near(outlineDistance(square, 1, 48, 48, 0, 42), 6), "6 px above it");
        // Stretched to twice the width, it reaches twice as far across,
        // and distances are measured at the smaller of the two scales.
        assert.ok(outlineDistance(square, 1, 96, 48, 22, 24) < 0, "stretched, inside");
        assert.ok(near(outlineDistance(square, 1, 96, 48, 30, 24), 3), "stretched, 6 px right of it");
    });
});
