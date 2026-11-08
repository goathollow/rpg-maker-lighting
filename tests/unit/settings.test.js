import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readBoolean, readChoice, readNumber, readNumberList, readStructList } from "../../src/core/params.js";
import { DEFAULT_LIGHT_PRESETS } from "../../src/presets.js";
import { parseSettings } from "../../src/settings.js";

// How MZ stores a struct list parameter: a JSON array of JSON strings.
const encodeStructList = (list) => JSON.stringify(list.map((item) => JSON.stringify(item)));

describe("readNumber", () => {
    test("parses numeric strings", () => {
        assert.equal(readNumber("0.5", 1), 0.5);
        assert.equal(readNumber(" 12 ", 1), 12);
    });

    test("falls back on missing or invalid input", () => {
        for (const raw of [undefined, null, "", "  ", "abc", "NaN", "Infinity", {}]) {
            assert.equal(readNumber(raw, 7), 7, `input ${String(raw)}`);
        }
    });

    test("clamps to the allowed range", () => {
        assert.equal(readNumber("5", 0, { min: 0, max: 1 }), 1);
        assert.equal(readNumber("-5", 0, { min: 0, max: 1 }), 0);
    });
});

describe("readBoolean", () => {
    test("reads the editor's true/false strings", () => {
        assert.equal(readBoolean("true", false), true);
        assert.equal(readBoolean("false", true), false);
        assert.equal(readBoolean("maybe", true), true);
        assert.equal(readBoolean(undefined, false), false);
    });
});

describe("readStructList", () => {
    test("decodes the editor's double-encoded list", () => {
        const list = [{ name: "A" }, { name: "B" }];
        assert.deepEqual(readStructList(encodeStructList(list), []), list);
    });

    test("keeps good entries when one is broken", () => {
        const raw = JSON.stringify([JSON.stringify({ name: "A" }), "{broken", "42"]);
        assert.deepEqual(readStructList(raw, []), [{ name: "A" }]);
    });

    test("falls back when the list is missing or unreadable, not when it is empty", () => {
        assert.deepEqual(readStructList(undefined, ["fallback"]), ["fallback"]);
        assert.deepEqual(readStructList("not json", ["fallback"]), ["fallback"]);
        assert.deepEqual(readStructList("[]", ["fallback"]), []);
    });
});

describe("readChoice", () => {
    test("reads one of its words, whatever the case, or falls back", () => {
        assert.equal(readChoice("Down", "up", ["up", "down"]), "down");
        assert.equal(readChoice(" up ", "down", ["up", "down"]), "up");
        assert.equal(readChoice("sideways", "up", ["up", "down"]), "up");
        assert.equal(readChoice(undefined, "up", ["up", "down"]), "up");
    });
});

describe("readNumberList", () => {
    test("reads the editor's number[] and numbers typed by hand", () => {
        assert.deepEqual(readNumberList('["3","1"]', []), [1, 3]);
        assert.deepEqual(readNumberList("5, 2 2;7", []), [2, 5, 7]);
        assert.deepEqual(readNumberList("[]", [9]), []);
        assert.deepEqual(readNumberList("", [9]), []);
        assert.deepEqual(readNumberList(undefined, [9]), [9]);
    });

    test("drops what is out of range or not a whole number", () => {
        assert.deepEqual(readNumberList('["0","1","256","2.5","x"]', [], { min: 1, max: 255 }), [1]);
    });
});

describe("parseSettings", () => {
    test("uses defaults for an empty parameter set", () => {
        for (const settings of [parseSettings({}), parseSettings()]) {
            assert.equal(settings.lightResolution, 0.5);
            assert.equal(settings.maxBrightness, 1.25);
            assert.equal(settings.globalLight, "");
            assert.equal(settings.playerLight, "");
            assert.equal(settings.lightPresets.size, DEFAULT_LIGHT_PRESETS.length);
            assert.ok(settings.ambientPresets.has("night"));
            assert.equal(settings.shadows, true);
            assert.equal(settings.wallShadows, true);
            assert.equal(settings.characterShadows, true);
            assert.deepEqual(settings.shadowRegions, []);
            assert.deepEqual(settings.shadowTerrainTags, []);
            assert.equal(settings.surfaceMaps, true);
            assert.equal(settings.normalStrength, 1);
            assert.equal(settings.normalGreen, "up");
            assert.equal(settings.aoStrength, 1);
            assert.equal(settings.autoNormals, "off");
            assert.equal(settings.autoNormalStrength, 1);
        }
    });

    test("reads the normal and AO map parameters", () => {
        const settings = parseSettings({
            surfaceMaps: "false",
            normalStrength: "1.5",
            normalGreen: "down",
            aoStrength: "0.5",
            autoNormals: "characters",
            autoNormalStrength: "9",
        });
        assert.equal(settings.surfaceMaps, false);
        assert.equal(settings.normalStrength, 1.5);
        assert.equal(settings.normalGreen, "down");
        assert.equal(settings.aoStrength, 0.5);
        assert.equal(settings.autoNormals, "characters");
        assert.equal(settings.autoNormalStrength, 3);
        assert.equal(parseSettings({ autoNormals: "everything" }).autoNormals, "off");
    });

    test("reads the shadow parameters", () => {
        const settings = parseSettings({
            shadows: "false",
            wallShadows: "false",
            characterShadows: "false",
            shadowRegions: '["12","4"]',
            shadowTerrainTags: '["3","9"]',
        });
        assert.equal(settings.shadows, false);
        assert.equal(settings.wallShadows, false);
        assert.equal(settings.characterShadows, false);
        assert.deepEqual(settings.shadowRegions, [4, 12]);
        assert.deepEqual(settings.shadowTerrainTags, [3]);
    });

    test("reads Plugin Manager values", () => {
        const settings = parseSettings({
            lightResolution: "0.25",
            maxBrightness: "2",
            globalLight: " Night ",
            playerLight: "Lantern",
            lightPresets: encodeStructList([{ name: "Glow", color: "#00ff00", radius: "50" }]),
        });
        assert.equal(settings.lightResolution, 0.25);
        assert.equal(settings.maxBrightness, 2);
        assert.equal(settings.globalLight, "Night");
        assert.equal(settings.playerLight, "Lantern");
        assert.deepEqual([...settings.lightPresets.keys()], ["glow"]);
        assert.equal(settings.lightPresets.get("glow").radius, 50);
    });

    test("survives hand-edited nonsense", () => {
        const settings = parseSettings({ lightResolution: "ultra", lightPresets: "{{{" });
        assert.equal(settings.lightResolution, 0.5);
        assert.equal(settings.lightPresets.size, DEFAULT_LIGHT_PRESETS.length);
        assert.equal(parseSettings({ lightResolution: "8" }).lightResolution, 1);
        assert.equal(parseSettings({ maxBrightness: "5" }).maxBrightness, 2);
        assert.equal(parseSettings({ maxBrightness: "0.5" }).maxBrightness, 1);
    });
});
