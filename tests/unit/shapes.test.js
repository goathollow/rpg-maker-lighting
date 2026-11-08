import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_LIGHT } from "../../src/core/lights.js";
import {
    angleVector,
    coneEdges,
    lightAngle,
    lightBox,
    lightFalloff,
    lightReach,
    shapeFalloff,
    smoothstep,
    toLightSpace,
    turnToward,
} from "../../src/core/shapes.js";

const light = (values) => ({ ...DEFAULT_LIGHT, ...values });
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// A small deterministic generator, so a failure always reproduces.
function* randomPoints(count, range, seed = 1) {
    let s = seed;
    const next = () => {
        s = (Math.imul(s, 1664525) + 1013904223) | 0;
        return ((s >>> 0) / 2 ** 32) * 2 - 1;
    };
    for (let i = 0; i < count; i++) yield [next() * range, next() * range];
}

describe("smoothstep", () => {
    test("is 0 below, 1 above, and smooth between", () => {
        assert.equal(smoothstep(0, 1, -1), 0);
        assert.equal(smoothstep(0, 1, 2), 1);
        assert.equal(smoothstep(0, 1, 0.5), 0.5);
        assert.ok(smoothstep(0, 1, 0.1) < 0.1);
    });
});

describe("point", () => {
    test("is the radial falloff", () => {
        const point = light({ radius: 100 });
        assert.equal(shapeFalloff(point, 0, 0), 1);
        assert.equal(shapeFalloff(point, 30, 40), lightFalloff(0.5));
        assert.equal(shapeFalloff(point, 100, 0), 0);
    });
});

describe("cone", () => {
    const cone = light({ shape: "cone", radius: 100, spread: 60 });

    test("is full strength straight ahead and dark behind", () => {
        assert.equal(shapeFalloff(cone, 50, 0), lightFalloff(0.5));
        assert.equal(shapeFalloff(cone, -50, 0), 0);
        assert.equal(shapeFalloff(cone, 0, 50), 0);
    });

    test("fades out at its edge, symmetrically", () => {
        const at = (degrees) => {
            const a = (degrees * Math.PI) / 180;
            return shapeFalloff(cone, 50 * Math.cos(a), 50 * Math.sin(a));
        };
        assert.equal(at(20), lightFalloff(0.5)); // inside the bright core
        assert.ok(at(25) > 0 && at(25) < lightFalloff(0.5));
        assert.equal(at(30), 0); // half the spread
        assert.ok(close(at(25), at(-25)));
    });

    test("a full circle is lit all round", () => {
        const round = light({ shape: "cone", radius: 100, spread: 360 });
        assert.equal(shapeFalloff(round, -50, 0), lightFalloff(0.5));
        const [inner, outer] = coneEdges(360);
        assert.ok(outer < inner && inner < -1);
    });
});

describe("beam", () => {
    const beam = light({ shape: "beam", radius: 200, width: 40 });

    test("starts at the light and fades along its length", () => {
        assert.equal(shapeFalloff(beam, 0, 0), 1);
        assert.equal(shapeFalloff(beam, 100, 0), lightFalloff(0.5));
        assert.equal(shapeFalloff(beam, 200, 0), 0);
        assert.equal(shapeFalloff(beam, -1, 0), 0);
    });

    test("is fully bright across its middle half, dark at its edges", () => {
        assert.equal(shapeFalloff(beam, 0, 10), 1);
        assert.ok(shapeFalloff(beam, 0, 15) < 1);
        assert.equal(shapeFalloff(beam, 0, 20), 0);
        assert.equal(shapeFalloff(beam, 0, -20), 0);
    });
});

describe("lightBox", () => {
    const shapes = [
        light({ radius: 100 }),
        light({ shape: "cone", radius: 100, spread: 30 }),
        light({ shape: "cone", radius: 100, spread: 179 }),
        light({ shape: "cone", radius: 100, spread: 250 }),
        light({ shape: "cone", radius: 100, spread: 360 }),
        light({ shape: "beam", radius: 300, width: 24 }),
    ];

    for (const shape of shapes) {
        test(`contains everything a ${shape.shape} (spread ${shape.spread}) lights`, () => {
            const [cx, cy, hx, hy] = lightBox(shape);
            for (const [x, y] of randomPoints(20000, 320)) {
                if (shapeFalloff(shape, x, y) > 0) {
                    assert.ok(Math.abs(x - cx) <= hx + 1e-9 && Math.abs(y - cy) <= hy + 1e-9, `(${x}, ${y}) outside`);
                }
            }
        });
    }

    test("a narrow cone and a beam cover far less than their circle", () => {
        const area = ([, , hx, hy]) => 4 * hx * hy;
        const circle = area(lightBox(light({ radius: 100 })));
        assert.ok(area(lightBox(light({ shape: "cone", radius: 100, spread: 30 }))) < circle / 3);
        assert.ok(area(lightBox(light({ shape: "beam", radius: 100, width: 20 }))) < circle / 3);
    });

    test("a beam reaches to its far corners", () => {
        assert.equal(lightReach(light({ shape: "beam", radius: 300, width: 80 })), Math.hypot(300, 40));
        assert.equal(lightReach(light({ shape: "cone", radius: 120 })), 120);
    });
});

describe("directions", () => {
    test("facing follows MZ's directions, diagonals included", () => {
        const angles = [8, 9, 6, 3, 2, 1, 4, 7].map((d) => lightAngle("facing", d));
        assert.deepEqual(angles, [0, 45, 90, 135, 180, 225, 270, 315]);
        assert.equal(lightAngle(45, 2), 45);
    });

    test("angles are clockwise from up, on a screen whose y points down", () => {
        const round = ([x, y]) => [Math.round(x) || 0, Math.round(y) || 0];
        assert.deepEqual(round(angleVector(0)), [0, -1]);
        assert.deepEqual(round(angleVector(90)), [1, 0]);
        assert.deepEqual(round(angleVector(180)), [0, 1]);
        assert.deepEqual(round(angleVector(270)), [-1, 0]);
    });

    test("light space runs along the direction", () => {
        // A light at (100, 100) pointing right: a pixel 10 px to its right is
        // 10 along and 0 across; one 10 px below is 0 along, 10 across.
        const [x1, y1] = toLightSpace(110, 100, 100, 100, 90);
        assert.ok(close(x1, 10) && close(y1, 0));
        const [x2, y2] = toLightSpace(100, 110, 100, 100, 90);
        assert.ok(close(x2, 0) && close(Math.abs(y2), 10));
    });
});

describe("turnToward", () => {
    test("turns the short way round and lands exactly", () => {
        assert.equal(turnToward(0, 90, 15), 15);
        assert.equal(turnToward(10, 350, 15), 355);
        assert.equal(turnToward(350, 10, 15), 5);
        assert.equal(turnToward(80, 90, 15), 90);
    });

    test("a quarter turn takes six frames at 15 degrees a frame", () => {
        let angle = 180;
        const path = [];
        while (angle !== 270) path.push((angle = turnToward(angle, 270, 15)));
        assert.deepEqual(path, [195, 210, 225, 240, 255, 270]);
    });
});
