import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodePng, encodePng, spriteMaps } from "../../tools/make-test-maps.mjs";

// The test project's images with normal maps are made by these from the
// RTP in the local MZ install (tools/make-test-maps.mjs).

describe("decodePng", () => {
    test("reads back what encodePng wrote", () => {
        const pixel = (x, y) => [x * 40, y * 50, (x + y) * 20, x === 1 ? 0 : 255];
        const { width, height, data } = decodePng(encodePng(5, 4, pixel));
        assert.equal(width, 5);
        assert.equal(height, 4);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 5; x++) assert.deepEqual([...data.subarray((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)], pixel(x, y));
        }
    });
});

describe("spriteMaps", () => {
    // One 48 x 48 frame holding an opaque disc of radius 16, evenly gray.
    const disc = (x, y) => Math.hypot(x + 0.5 - 24, y + 0.5 - 24) < 16;
    const image = { width: 48, height: 48, data: Buffer.alloc(48 * 48 * 4) };
    for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 48; x++) image.data.set([128, 128, 128, disc(x, y) ? 255 : 0], (y * 48 + x) * 4);
    }
    const maps = spriteMaps(image);

    test("faces the viewer in the middle and is open there", () => {
        // + 0 turns -0 into 0.
        assert.deepEqual(maps.normal(24, 24).map((v) => v + 0), [0, 0, 1]);
        assert.equal(maps.ao(24, 24), 1);
    });

    test("rounds off toward the outline, facing out (y down)", () => {
        const [rx, , rz] = maps.normal(38, 24);
        const [lx] = maps.normal(9, 24);
        const [, ty] = maps.normal(24, 9);
        const [, by] = maps.normal(24, 38);
        assert.ok(rx > 0.3 && rz < 0.95, `right edge ${rx}, ${rz}`);
        assert.ok(lx < -0.3, `left edge ${lx}`);
        assert.ok(ty < -0.3, `top edge ${ty}`);
        assert.ok(by > 0.3, `bottom edge ${by}`);
    });

    test("leaves clear pixels flat and open", () => {
        assert.deepEqual(maps.normal(2, 2), [0, 0, 1]);
        assert.equal(maps.ao(2, 2), 1);
    });

    test("sinks dark detail, so AO darkens it", () => {
        const dotted = { ...image, data: Buffer.from(image.data) };
        dotted.data.set([20, 20, 20, 255], (24 * 48 + 24) * 4);
        assert.ok(spriteMaps(dotted).ao(24, 24) < 1);
    });
});
