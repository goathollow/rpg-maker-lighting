import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { DEFAULT_LIGHT } from "../../src/core/lights.js";
import { DEFAULT_AMBIENT_PRESETS, DEFAULT_FLICKER_PRESETS, DEFAULT_LIGHT_PRESETS } from "../../src/presets.js";
import { parseSettings } from "../../src/settings.js";

// The plugin header is what RPG Maker shows in the Plugin Manager, so its
// parameters must be the ones the code reads.
const header = readFileSync(new URL("../../src/header.txt", import.meta.url), "utf8");

// Each block's @param names, with their @default and @min/@max.
function paramsOf(block) {
    const params = {};
    let current = null;
    for (const line of block.split("\n")) {
        const m = line.match(/^\s*\*\s*@(\w+)\s*(.*)$/);
        if (!m) continue;
        const [, tag, value] = m;
        if (tag === "param") params[(current = value.trim())] = {};
        else if (tag === "command") current = null;
        else if (current) params[current][tag] = value.trim();
    }
    return params;
}

const main = header.slice(0, header.indexOf("@command"));
const struct = (name) => {
    const start = header.indexOf(`/*~struct~${name}:`);
    return paramsOf(header.slice(start, header.indexOf("*/", start)));
};

describe("plugin header", () => {
    test("lists every parameter the plugin reads, and no others", () => {
        assert.deepEqual(Object.keys(paramsOf(main)).sort(), Object.keys(parseSettings({})).sort());
    });

    test("its preset structs have the fields of the built-in presets", () => {
        assert.deepEqual(Object.keys(struct("LightPreset")).sort(), Object.keys(DEFAULT_LIGHT_PRESETS[0]).sort());
        assert.deepEqual(Object.keys(struct("FlickerPreset")).sort(), Object.keys(DEFAULT_FLICKER_PRESETS[0]).sort());
        assert.deepEqual(Object.keys(struct("AmbientPreset")).sort(), Object.keys(DEFAULT_AMBIENT_PRESETS[0]).sort());
    });

    test("a new light preset starts with the settings of a plain light", () => {
        const fields = struct("LightPreset");
        for (const key of ["radius", "intensity", "spread", "width", "softness", "height", "offsetX", "offsetY"]) {
            assert.equal(Number(fields[key].default), DEFAULT_LIGHT[key], key);
        }
        for (const key of ["shape", "direction", "shadows"]) {
            assert.equal(fields[key].default, String(DEFAULT_LIGHT[key]), key);
        }
    });

    test("its shadow parameters default as the code does", () => {
        const params = paramsOf(main);
        const settings = parseSettings({});
        for (const key of ["shadows", "wallShadows", "characterShadows"]) {
            assert.equal(params[key].default, String(settings[key]), key);
        }
        assert.deepEqual(JSON.parse(params.shadowRegions.default), settings.shadowRegions);
        assert.deepEqual(JSON.parse(params.shadowTerrainTags.default), settings.shadowTerrainTags);
    });

    test("its normal and AO map parameters default as the code does, within its limits", () => {
        const params = paramsOf(main);
        const settings = parseSettings({});
        for (const key of ["surfaceMaps", "normalGreen", "autoNormals"]) {
            assert.equal(params[key].default, String(settings[key]), key);
        }
        for (const key of ["normalStrength", "aoStrength", "autoNormalStrength"]) {
            assert.equal(Number(params[key].default), settings[key], key);
            const over = parseSettings({ [key]: String(Number(params[key].max) + 1) })[key];
            assert.equal(over, Number(params[key].max), `${key} max`);
        }
    });

    test("every option of a select parameter is a value the code accepts", () => {
        const options = (name) => {
            const block = main.slice(main.indexOf(`@param ${name}\n`));
            const end = block.indexOf("@param", 1);
            const lines = block.slice(0, end).split("\n");
            const values = [];
            for (let i = 0; i < lines.length; i++) {
                const option = lines[i].match(/@option (.+)$/);
                if (!option) continue;
                const value = lines[i + 1]?.match(/@value (.+)$/);
                values.push((value ? value[1] : option[1]).trim());
            }
            return values;
        };
        for (const name of ["normalGreen", "autoNormals"]) {
            const values = options(name);
            assert.ok(values.length > 1, name);
            for (const value of values) assert.equal(parseSettings({ [name]: value })[name], value, `${name}: ${value}`);
        }
    });

    test("every parameter, command and argument has a name and a description", () => {
        // What the Plugin Manager and the command editor show for each one.
        const missing = [];
        let current = null;
        const check = () => {
            if (current && !(current.text && current.desc)) missing.push(current.name);
        };
        for (const line of header.split("\n")) {
            const m = line.match(/^\s*\*\s*@(\w+)\s*(.*)$/);
            if (!m) continue;
            const [, tag, value] = m;
            if (["param", "command", "arg"].includes(tag)) {
                check();
                current = { name: `@${tag} ${value.trim()}` };
            } else if (current && (tag === "text" || tag === "desc")) {
                current[tag] = value.trim();
            }
        }
        check();
        assert.deepEqual(missing, []);
    });
});
