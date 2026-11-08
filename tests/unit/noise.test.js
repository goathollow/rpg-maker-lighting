import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ease, hash, valueNoise } from "../../src/core/noise.js";

describe("hash", () => {
    test("is deterministic", () => {
        assert.equal(hash(42, 7), hash(42, 7));
    });

    test("spreads evenly over [-1, 1]", () => {
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        const n = 20000;
        for (let i = 0; i < n; i++) {
            const v = hash(i, 1);
            sum += v;
            min = Math.min(min, v);
            max = Math.max(max, v);
        }
        assert.ok(min >= -1 && max <= 1, `range ${min}..${max}`);
        assert.ok(min < -0.99 && max > 0.99, "should reach both ends");
        assert.ok(Math.abs(sum / n) < 0.02, `mean ${sum / n}`);
    });

    test("different seeds give unrelated sequences", () => {
        let same = 0;
        for (let i = 0; i < 1000; i++) {
            if (Math.sign(hash(i, 1)) === Math.sign(hash(i, 2))) same++;
        }
        assert.ok(same > 400 && same < 600, `${same}/1000 sign matches`);
    });
});

describe("ease", () => {
    test("runs from 0 to 1 and is symmetric", () => {
        for (const k of [1, 2, 8, 32]) {
            assert.equal(ease(0, k), 0);
            assert.equal(ease(1, k), 1);
            assert.ok(Math.abs(ease(0.5, k) - 0.5) < 1e-12);
            assert.ok(Math.abs(ease(0.2, k) + ease(0.8, k) - 1) < 1e-12);
        }
    });

    test("large k approaches a step", () => {
        assert.ok(ease(0.4, 32) < 0.001);
        assert.ok(ease(0.6, 32) > 0.999);
    });
});

describe("valueNoise", () => {
    test("passes through the lattice values", () => {
        for (let i = -3; i < 10; i++) {
            assert.equal(valueNoise(i, 5), hash(i, 5));
        }
    });

    test("is continuous between lattice points", () => {
        for (let t = 0; t < 20; t += 0.001) {
            const step = Math.abs(valueNoise(t + 0.001, 3) - valueNoise(t, 3));
            assert.ok(step < 0.01, `jump of ${step} at t=${t}`);
        }
    });
});
