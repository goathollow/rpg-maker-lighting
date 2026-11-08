import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    buildFlickerPresets,
    FLICKER_DEFAULTS,
    flicker,
    isFlickering,
    NO_FLICKER,
    normalizeFlicker,
} from "../../src/core/flicker.js";
import { DEFAULT_FLICKER_PRESETS } from "../../src/presets.js";

const FPS = 60;

function sample(options, { seconds, seed = 1, fps = FPS }) {
    const values = [];
    for (let f = 0; f < seconds * fps; f++) {
        values.push(flicker(f / fps, seed, options));
    }
    return values;
}

function largestFrameStep(values) {
    let max = 0;
    for (let i = 1; i < values.length; i++) {
        max = Math.max(max, Math.abs(values[i] - values[i - 1]));
    }
    return max;
}

function countTurns(values) {
    let turns = 0;
    let lastDir = 0;
    for (let i = 1; i < values.length; i++) {
        const d = Math.sign(values[i] - values[i - 1]);
        if (d !== 0 && lastDir !== 0 && d !== lastDir) turns++;
        if (d !== 0) lastDir = d;
    }
    return turns;
}

const slowOnly = (o) => normalizeFlicker({ slowStrength: 0.2, slowSpeed: 0.5, ...o });
const fastOnly = (o) => normalizeFlicker({ fastStrength: 0.2, fastSpeed: 10, ...o });
const fire = normalizeFlicker({ slowStrength: 0.15, slowSpeed: 0.6, fastStrength: 0.1, fastSpeed: 9 });

describe("flicker", () => {
    test("is a steady 1 when both strengths are 0", () => {
        const values = sample(normalizeFlicker({}), { seconds: 5 });
        assert.ok(values.every((v) => v === 1));
    });

    test("depends only on time and seed", () => {
        assert.equal(flicker(12.34, 9, fire), flicker(12.34, 9, fire));
        // The same moment gives the same value at 30 and 60 fps.
        const at30 = sample(fire, { seconds: 2, fps: 30 });
        const at60 = sample(fire, { seconds: 2, fps: 60 });
        at30.forEach((v, i) => assert.equal(v, at60[i * 2]));
    });

    test("different seeds flicker out of sync", () => {
        const a = sample(fire, { seconds: 10, seed: 1 });
        const b = sample(fire, { seconds: 10, seed: 2 });
        const differing = a.filter((v, i) => Math.abs(v - b[i]) > 0.01).length;
        assert.ok(differing > a.length * 0.8);
    });

    test("stays within the combined strength and never goes negative", () => {
        for (const v of sample(fire, { seconds: 60 })) {
            assert.ok(v >= 1 - 0.25 - 1e-9 && v <= 1 + 0.25 + 1e-9, `value ${v}`);
        }
        const extreme = normalizeFlicker({ slowStrength: 1, fastStrength: 1 });
        assert.ok(sample(extreme, { seconds: 60 }).every((v) => v >= 0));
    });

    test("averages out to the light's set brightness", () => {
        const values = sample(fire, { seconds: 600 });
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        assert.ok(Math.abs(mean - 1) < 0.02, `mean ${mean}`);
    });

    test("slow speed sets how often the overall level changes", () => {
        const lazy = countTurns(sample(slowOnly({ slowSpeed: 0.5 }), { seconds: 120 }));
        const brisk = countTurns(sample(slowOnly({ slowSpeed: 2 }), { seconds: 120 }));
        assert.ok(brisk > lazy * 3, `turns: ${lazy} at 0.5/s vs ${brisk} at 2/s`);
    });

    test("the slow layer drifts gently while the fast layer pops", () => {
        const slowStep = largestFrameStep(sample(slowOnly(), { seconds: 30 }));
        const fastStep = largestFrameStep(sample(fastOnly(), { seconds: 30 }));
        assert.ok(slowStep < 0.02, `slow layer moved ${slowStep} in one frame`);
        assert.ok(fastStep > slowStep * 5, `fast ${fastStep} vs slow ${slowStep}`);
    });

    test("sharpness makes the fast pops snappier", () => {
        const soft = largestFrameStep(sample(fastOnly({ fastSharpness: 0 }), { seconds: 30 }));
        const hard = largestFrameStep(sample(fastOnly({ fastSharpness: 1 }), { seconds: 30 }));
        assert.ok(hard > soft * 1.5, `soft ${soft} vs hard ${hard}`);
    });
});

describe("normalizeFlicker", () => {
    test("fills in defaults", () => {
        assert.deepEqual(normalizeFlicker(), { ...FLICKER_DEFAULTS });
    });

    test("accepts the strings the Plugin Manager hands over", () => {
        const o = normalizeFlicker({ slowStrength: "0.3", fastSpeed: "12" });
        assert.equal(o.slowStrength, 0.3);
        assert.equal(o.fastSpeed, 12);
    });

    test("clamps out-of-range and ignores garbage", () => {
        const o = normalizeFlicker({ slowStrength: 5, fastSpeed: 1000, fastSharpness: -1, slowSpeed: "fast" });
        assert.equal(o.slowStrength, 1);
        assert.equal(o.fastSpeed, 30);
        assert.equal(o.fastSharpness, 0);
        assert.equal(o.slowSpeed, FLICKER_DEFAULTS.slowSpeed);
    });
});

describe("flicker presets", () => {
    test("built-in presets read cleanly and all flicker", () => {
        const messages = [];
        const presets = buildFlickerPresets(DEFAULT_FLICKER_PRESETS, (m) => messages.push(m));
        assert.deepEqual(messages, []);
        assert.deepEqual([...presets.keys()], ["fire", "candle", "pulse", "faulty"]);
        for (const [name, options] of presets) assert.ok(isFlickering(options), name);
        assert.equal(presets.get("fire").slowStrength, 0.15);
        assert.equal(presets.get("faulty").fastSharpness, 1);
    });

    test("uses the same words as notetags, and clamps", () => {
        const presets = buildFlickerPresets([{ name: "Wild", slow: "5", slowSpeed: "1", fast: "", sharpness: "x" }]);
        const wild = presets.get("wild");
        assert.equal(wild.slowStrength, 1);
        assert.equal(wild.slowSpeed, 1);
        assert.equal(wild.fastStrength, FLICKER_DEFAULTS.fastStrength);
        assert.equal(wild.fastSharpness, FLICKER_DEFAULTS.fastSharpness);
    });

    test("skips nameless presets and keeps the first duplicate", () => {
        const messages = [];
        const presets = buildFlickerPresets(
            [{ name: "" }, { name: "A", slow: "0.1" }, { name: "a", slow: "0.2" }],
            (m) => messages.push(m)
        );
        assert.equal(presets.size, 1);
        assert.equal(presets.get("a").slowStrength, 0.1);
        assert.equal(messages.length, 2);
    });

    test("no flicker is steady", () => {
        assert.ok(!isFlickering(NO_FLICKER));
        assert.equal(flicker(12.3, 4, NO_FLICKER), 1);
    });
});
