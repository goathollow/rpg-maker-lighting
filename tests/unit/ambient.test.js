import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    buildAmbientPresets,
    createAmbient,
    fadeAmbient,
    isUnlit,
    resetAmbient,
    resolveAmbient,
    UNLIT,
    updateAmbient,
} from "../../src/core/ambient.js";
import { parseColor } from "../../src/core/color.js";
import { DEFAULT_AMBIENT_PRESETS } from "../../src/presets.js";

const presets = buildAmbientPresets(DEFAULT_AMBIENT_PRESETS);
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

describe("parseColor", () => {
    test("reads hex and r,g,b", () => {
        assert.deepEqual(parseColor("#ff0000"), [1, 0, 0]);
        assert.deepEqual(parseColor("#F00"), [1, 0, 0]);
        assert.deepEqual(parseColor(" 255, 0, 51 "), [1, 0, 0.2]);
        assert.deepEqual(parseColor("0,0,0"), [0, 0, 0]);
    });

    test("rejects anything else", () => {
        for (const bad of ["", "red", "#ff00", "#gg0000", "256,0,0", "1,2", "-1,0,0", null, 7]) {
            assert.equal(parseColor(bad), null, `input ${bad}`);
        }
    });
});

describe("ambient presets and resolution", () => {
    test("built-in presets read cleanly", () => {
        const messages = [];
        buildAmbientPresets(DEFAULT_AMBIENT_PRESETS, (m) => messages.push(m));
        assert.deepEqual(messages, []);
        assert.deepEqual(presets.get("darkness"), [0, 0, 0]);
    });

    test("resolves preset names, ignoring case, and colors", () => {
        assert.deepEqual(resolveAmbient("night", presets), presets.get("night"));
        assert.deepEqual(resolveAmbient("#808080", presets), parseColor("#808080"));
        assert.deepEqual(resolveAmbient("64, 64, 64", presets), parseColor("64,64,64"));
    });

    test("returns a copy, so fades cannot change the preset", () => {
        resolveAmbient("night", presets)[0] = 99;
        assert.notEqual(presets.get("night")[0], 99);
    });

    test("off and none mean fully lit", () => {
        assert.deepEqual(resolveAmbient("off", presets), [1, 1, 1]);
        assert.deepEqual(resolveAmbient("None", presets), [1, 1, 1]);
    });

    test("blank means no ambient; unknown warns", () => {
        const messages = [];
        assert.equal(resolveAmbient("", presets), null);
        assert.equal(resolveAmbient("Twilight", presets, (m) => messages.push(m)), null);
        assert.match(messages[0], /unknown ambient "Twilight"/);
    });

    test("only pure white counts as unlit", () => {
        assert.ok(isUnlit(UNLIT));
        assert.ok(!isUnlit([1, 1, 0.99]));
    });
});

describe("ambient fades", () => {
    test("an instant change applies immediately", () => {
        const state = createAmbient(UNLIT);
        fadeAmbient(state, [0, 0, 0], 0);
        assert.deepEqual(state.color, [0, 0, 0]);
    });

    test("fades linearly and lands exactly on the target", () => {
        const state = createAmbient(UNLIT);
        fadeAmbient(state, [0, 0.5, 0], 60);
        for (let i = 0; i < 30; i++) updateAmbient(state);
        assert.ok(close(state.color, [0.5, 0.75, 0.5]), state.color.join());
        for (let i = 0; i < 30; i++) updateAmbient(state);
        assert.deepEqual(state.color, [0, 0.5, 0]);
        updateAmbient(state);
        assert.deepEqual(state.color, [0, 0.5, 0]);
    });

    test("fading back to white is unlit again", () => {
        const state = createAmbient([0.2, 0.2, 0.2]);
        fadeAmbient(state, UNLIT, 10);
        for (let i = 0; i < 10; i++) updateAmbient(state);
        assert.ok(isUnlit(state.color));
    });

    test("reset fades back to the map's own ambient", () => {
        const state = createAmbient([0.1, 0.2, 0.3]);
        fadeAmbient(state, UNLIT, 0);
        resetAmbient(state, 0, [0.9, 0.9, 0.9]);
        assert.deepEqual(state.color, [0.1, 0.2, 0.3]);
        assert.equal(state.followGlobal, false);
    });

    test("is plain data that survives a save file round trip", () => {
        const state = createAmbient(null, [0.5, 0.5, 0.5]);
        fadeAmbient(state, [0, 0, 0], 20);
        updateAmbient(state, UNLIT);
        const copy = JSON.parse(JSON.stringify(state));
        updateAmbient(state, UNLIT);
        updateAmbient(copy, UNLIT);
        assert.deepEqual(copy, state);
    });
});

describe("following the global light", () => {
    const night = [0.2, 0.2, 0.3];

    test("a map without its own ambient starts at, and tracks, the global light", () => {
        const map = createAmbient(null, night);
        assert.deepEqual(map.color, night);
        assert.equal(map.followGlobal, true);
        updateAmbient(map, [0.5, 0.5, 0.5]);
        assert.deepEqual(map.color, [0.5, 0.5, 0.5]);
    });

    test("a map with its own ambient ignores the global light", () => {
        const map = createAmbient([0.1, 0.1, 0.1], night);
        updateAmbient(map, UNLIT);
        assert.deepEqual(map.color, [0.1, 0.1, 0.1]);
    });

    test("moves in step with a global fade", () => {
        const global = createAmbient(UNLIT);
        const map = createAmbient(null, global.color);
        fadeAmbient(global, [0, 0, 0], 10);
        for (let i = 0; i < 5; i++) {
            updateAmbient(global);
            updateAmbient(map, global.color);
        }
        assert.ok(close(map.color, [0.5, 0.5, 0.5]), map.color.join());
    });

    test("a map change of ambient stops following until reset", () => {
        const map = createAmbient(null, night);
        fadeAmbient(map, [1, 0, 0], 0);
        updateAmbient(map, [0.5, 0.5, 0.5]);
        assert.deepEqual(map.color, [1, 0, 0]);

        resetAmbient(map, 0, [0.5, 0.5, 0.5]);
        assert.equal(map.followGlobal, true);
        updateAmbient(map, [0.4, 0.4, 0.4]);
        assert.deepEqual(map.color, [0.4, 0.4, 0.4]);
    });

    test("a reset fade catches up with a global light that is itself fading", () => {
        const global = createAmbient(UNLIT);
        const map = createAmbient(null, global.color);
        fadeAmbient(map, [1, 0, 0], 0);
        resetAmbient(map, 20, global.color);
        fadeAmbient(global, [0, 0, 0], 40);
        for (let i = 0; i < 20; i++) {
            updateAmbient(global);
            updateAmbient(map, global.color);
        }
        // At the end of its 20 frames the map has landed on the global
        // light, then stays on it as the global fade carries on.
        assert.ok(close(map.color, global.color), `${map.color} vs ${global.color}`);
        for (let i = 0; i < 20; i++) {
            updateAmbient(global);
            updateAmbient(map, global.color);
        }
        assert.deepEqual(map.color, [0, 0, 0]);
    });
});
