import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseColor } from "../../src/core/color.js";
import {
    buildLightPresets,
    DEFAULT_LIGHT,
    lightBufferScale,
    lightOverAmbient,
    resolveLight,
} from "../../src/core/lights.js";
import { buildFlickerPresets, NO_FLICKER } from "../../src/core/flicker.js";
import { lightFalloff } from "../../src/core/shapes.js";
import { DEFAULT_FLICKER_PRESETS, DEFAULT_LIGHT_PRESETS } from "../../src/presets.js";

const collect = () => {
    const messages = [];
    const warn = (msg) => messages.push(msg);
    return { messages, warn };
};

const flickers = buildFlickerPresets(DEFAULT_FLICKER_PRESETS);
const presets = buildLightPresets(DEFAULT_LIGHT_PRESETS, undefined, flickers);
const resolve = (text, warn) => resolveLight(text, presets, warn, flickers);
const round = (v) => Math.round(v * 1e9) / 1e9;

describe("lightFalloff", () => {
    test("is full at the center and zero from the radius out", () => {
        assert.equal(lightFalloff(0), 1);
        assert.equal(lightFalloff(1), 0);
        assert.equal(lightFalloff(1.5), 0);
    });

    test("falls off smoothly and steadily", () => {
        let last = 1;
        for (let d = 0.05; d <= 1; d += 0.05) {
            const v = lightFalloff(d);
            assert.ok(v < last, `not decreasing at ${d}`);
            last = v;
        }
    });
});

describe("lightOverAmbient", () => {
    const light = (color, intensity = 1) => ({ ...DEFAULT_LIGHT, color, intensity });

    test("a light as bright as the ambient adds nothing", () => {
        assert.deepEqual(lightOverAmbient(light([1, 1, 1]), [1, 1, 1]), [0, 0, 0]);
        assert.deepEqual(lightOverAmbient(light([0.5, 0.5, 0.5]), [0.8, 0.8, 0.8]), [0, 0, 0]);
    });

    test("adds more the further it is above the ambient", () => {
        const night = [0.2, 0.2, 0.3];
        assert.deepEqual(lightOverAmbient(light([1, 1, 1]), night).map(round), [0.8, 0.8, 0.7]);
        assert.deepEqual(lightOverAmbient(light([1, 1, 1], 1.5), [1, 1, 1]), [0.5, 0.5, 0.5]);
    });

    test("works per channel, so a color shows where the ambient lacks it", () => {
        const torch = parseColor("#ff9d4d");
        const over = lightOverAmbient(light(torch), [0.5, 0.5, 0.5]);
        assert.ok(over[0] > over[1] && over[1] > 0 && over[2] === 0, over.join());
    });

    test("fills the given array", () => {
        const out = [9, 9, 9];
        assert.equal(lightOverAmbient(light([1, 0, 0]), [0, 0, 0], out), out);
        assert.deepEqual(out, [1, 0, 0]);
    });
});

describe("lightBufferScale", () => {
    test("reaches Max Brightness and stores light 1.0 as a whole byte", () => {
        for (const cap of [1, 1.1, 1.25, 1.5, 1.77, 2]) {
            const scale = lightBufferScale(cap);
            assert.ok(scale >= cap, `scale ${scale} below ${cap}`);
            assert.ok(scale < cap + 0.02, `scale ${scale} wastes precision at ${cap}`);
            const byte = 255 / scale;
            assert.ok(Math.abs(byte - Math.round(byte)) < 1e-9, `1.0 is byte ${byte} at ${cap}`);
        }
        assert.equal(lightBufferScale(1), 1);
        assert.equal(lightBufferScale(1.5), 1.5);
    });
});

describe("buildLightPresets", () => {
    test("reads the built-in presets", () => {
        const torch = presets.get("torch");
        assert.deepEqual(torch.color, parseColor("#ff9d4d"));
        assert.equal(torch.radius, 168);
        assert.equal(torch.flicker, flickers.get("fire"));
        assert.equal(presets.get("fireplace").intensity, 1.2);
        assert.equal(presets.get("lamp").flicker, NO_FLICKER);
        assert.equal(presets.get("flashlight").shape, "cone");
        assert.equal(presets.get("sunbeam").shape, "beam");
        assert.equal(presets.get("sunbeam").direction, 180);
    });

    test("every built-in preset reads cleanly", () => {
        const { messages, warn } = collect();
        buildLightPresets(DEFAULT_LIGHT_PRESETS, warn, flickers);
        assert.deepEqual(messages, []);
    });

    test("skips nameless presets and keeps the first duplicate", () => {
        const { messages, warn } = collect();
        const map = buildLightPresets(
            [
                { name: "", radius: "10" },
                { name: "Glow", radius: "20" },
                { name: "glow", radius: "30" },
            ],
            warn
        );
        assert.equal(map.size, 1);
        assert.equal(map.get("glow").radius, 20);
        assert.equal(messages.length, 2);
    });

    test("empty fields fall back to defaults silently", () => {
        const { messages, warn } = collect();
        const map = buildLightPresets([{ name: "Blank", color: "", radius: "", intensity: "" }], warn);
        assert.deepEqual(map.get("blank"), { ...DEFAULT_LIGHT });
        assert.deepEqual(messages, []);
    });

    test("bad fields are reported and fall back", () => {
        const { messages, warn } = collect();
        const map = buildLightPresets([{ name: "Oops", color: "orange", radius: "wide" }], warn);
        assert.deepEqual(map.get("oops").color, DEFAULT_LIGHT.color);
        assert.equal(map.get("oops").radius, DEFAULT_LIGHT.radius);
        assert.equal(messages.length, 2);
        assert.match(messages[0], /preset "Oops"/);
    });
});

describe("resolveLight", () => {
    test("uses a preset by name, ignoring case", () => {
        assert.deepEqual(resolveLight("torch", presets), presets.get("torch"));
        assert.deepEqual(resolveLight("TORCH", presets), presets.get("torch"));
    });

    test("applies settings on top of the preset", () => {
        const light = resolveLight("Torch radius: 300 color: 255,0,0 x: 4 y: -8 intensity: 0.5", presets);
        assert.equal(light.radius, 300);
        assert.deepEqual(light.color, [1, 0, 0]);
        assert.equal(light.offsetX, 4);
        assert.equal(light.offsetY, -8);
        assert.equal(light.intensity, 0.5);
    });

    test("does not change the preset itself", () => {
        resolveLight("Torch radius: 999", presets);
        assert.equal(presets.get("torch").radius, 168);
    });

    test("accepts friendly synonyms", () => {
        const light = resolveLight("color: #00ff00 size: 50 brightness: 2", presets);
        assert.deepEqual(light.color, [0, 1, 0]);
        assert.equal(light.radius, 50);
        assert.equal(light.intensity, 2);
    });

    test("a bare tag is a plain white light", () => {
        assert.deepEqual(resolveLight("", presets), { ...DEFAULT_LIGHT });
    });

    test("off and none turn the light off", () => {
        assert.equal(resolveLight("off", presets), null);
        assert.equal(resolveLight("None", presets), null);
    });

    test("an unknown preset still lights, and says so", () => {
        const { messages, warn } = collect();
        const light = resolveLight("Torc", presets, warn);
        assert.deepEqual(light, { ...DEFAULT_LIGHT });
        assert.match(messages[0], /unknown light preset "Torc"/);
        assert.match(messages[0], /torch/);
    });

    test("clamps out-of-range numbers", () => {
        const light = resolveLight("radius: 0 intensity: 50", presets);
        assert.equal(light.radius, 1);
        assert.equal(light.intensity, 4);
    });

    test("reports unknown settings and unreadable values", () => {
        const { messages, warn } = collect();
        const light = resolveLight("Torch radius: big glow: 3", presets, warn);
        assert.equal(light.radius, 168);
        assert.equal(messages.length, 2);
    });
});

describe("shapes and directions", () => {
    test("reads shape, direction, spread and width", () => {
        const light = resolve("shape: cone direction: left spread: 40 width: 20");
        assert.equal(light.shape, "cone");
        assert.equal(light.direction, 270);
        assert.equal(light.spread, 40);
        assert.equal(light.width, 20);
    });

    test("type and length are friendly synonyms", () => {
        const light = resolve("type: beam length: 300");
        assert.equal(light.shape, "beam");
        assert.equal(light.radius, 300);
    });

    test("directions: facing, compass words, and any angle", () => {
        assert.equal(resolve("Flashlight").direction, "facing");
        assert.equal(resolve("direction: up").direction, 0);
        assert.equal(resolve("direction: Right").direction, 90);
        assert.equal(resolve("direction: 450").direction, 90);
        assert.equal(resolve("direction: -45").direction, 315);
        assert.equal(resolve("Sunbeam direction: facing").direction, "facing");
    });

    test("clamps spread and width", () => {
        assert.equal(resolve("spread: 999").spread, 360);
        assert.equal(resolve("spread: 0").spread, 1);
        assert.equal(resolve("width: 0").width, 1);
    });

    test("reports unknown shapes and unreadable directions", () => {
        const { messages, warn } = collect();
        const light = resolve("Torch shape: blob direction: sideways", warn);
        assert.equal(light.shape, "point");
        assert.equal(light.direction, "facing");
        assert.match(messages[0], /unknown shape "blob"; use point, cone, beam/);
        assert.match(messages[1], /can't read direction "sideways"/);
    });
});

describe("flicker on lights", () => {
    test("takes a flicker preset by name, or off", () => {
        assert.equal(resolve("Lamp flicker: faulty").flicker, flickers.get("faulty"));
        assert.equal(resolve("Torch flicker: off").flicker, NO_FLICKER);
        assert.equal(resolve("Torch flicker: none").flicker, NO_FLICKER);
    });

    test("single settings tweak the named flicker, whatever order they come in", () => {
        const fire = flickers.get("fire");
        for (const text of ["Lamp flicker: Fire fast: 0.3", "Lamp fast: 0.3 flicker: Fire"]) {
            const { flicker } = resolve(text);
            assert.equal(flicker.fastStrength, 0.3, text);
            assert.equal(flicker.slowStrength, fire.slowStrength, text);
        }
    });

    test("tweaks a preset's own flicker without changing the preset", () => {
        const light = resolve("Torch slow: 0.5 slowSpeed: 2 fastSpeed: 99 sharpness: 1");
        assert.equal(light.flicker.slowStrength, 0.5);
        assert.equal(light.flicker.slowSpeed, 2);
        assert.equal(light.flicker.fastSpeed, 30);
        assert.equal(light.flicker.fastSharpness, 1);
        assert.equal(presets.get("torch").flicker, flickers.get("fire"));
    });

    test("reads a seed as a whole number", () => {
        assert.equal(resolve("Torch seed: 7").seed, 7);
        assert.equal(resolve("Torch seed: 2.6").seed, 3);
        assert.equal(resolve("Torch").seed, null);
    });

    test("an unknown flicker keeps the light's own and lists the known ones", () => {
        const { messages, warn } = collect();
        const light = resolve("Torch flicker: Wobble", warn);
        assert.equal(light.flicker, flickers.get("fire"));
        assert.match(messages[0], /unknown flicker "Wobble". Known: fire, candle, pulse, faulty, off./);
    });

    test("presets can use flicker presets", () => {
        const { messages, warn } = collect();
        const map = buildLightPresets([{ name: "Brazier", flicker: "Fire", fast: "0.4" }], warn, flickers);
        assert.deepEqual(messages, []);
        assert.equal(map.get("brazier").flicker.fastStrength, 0.4);
        assert.equal(map.get("brazier").flicker.slowSpeed, flickers.get("fire").slowSpeed);
    });
});

describe("shadow settings on lights", () => {
    test("lights cast shadows by default, with a modest size and height", () => {
        const light = resolve("");
        assert.equal(light.shadows, true);
        assert.equal(light.softness, 8);
        assert.equal(light.height, 72);
    });

    test("shadows can be turned off and on, in friendly words", () => {
        assert.equal(resolve("Torch shadows: off").shadows, false);
        assert.equal(resolve("Torch shadow: no").shadows, false);
        assert.equal(resolve("Torch shadows: on").shadows, true);
    });

    test("reads softness and height, clamped", () => {
        const light = resolve("Torch softness: 20 height: 120");
        assert.equal(light.softness, 20);
        assert.equal(light.height, 120);
        assert.equal(resolve("softness: 500").softness, 48);
        assert.equal(resolve("height: -5").height, 0);
    });

    test("presets set how big and how high their light is", () => {
        assert.equal(presets.get("fireplace").softness, 24);
        assert.equal(presets.get("fireplace").height, 24);
        assert.equal(presets.get("sunbeam").height, 240);
        for (const preset of presets.values()) assert.equal(preset.shadows, true);
    });

    test("presets saved before shadows existed cast them, at the plain light's size and height", () => {
        const { messages, warn } = collect();
        const { shadows, softness, height, ...older } = DEFAULT_LIGHT_PRESETS[0];
        const torch = buildLightPresets([older], warn, flickers).get("torch");
        assert.deepEqual([torch.shadows, torch.softness, torch.height], [true, 8, 72]);
        assert.deepEqual(messages, []);
    });

    test("an unreadable switch is reported and leaves shadows on", () => {
        const { messages, warn } = collect();
        assert.equal(resolve("Torch shadows: maybe", warn).shadows, true);
        assert.match(messages[0], /can't read shadows "maybe"; use on or off/);
    });
});
