import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findTags, pageCommentText, parseTagArgs } from "../../src/core/notetags.js";

describe("findTags", () => {
    test("finds bare and argument tags in order", () => {
        assert.deepEqual(findTags("<light> hello <light: Torch>", "light"), ["", "Torch"]);
    });

    test("ignores case and spacing", () => {
        assert.deepEqual(findTags("< LIGHT : Torch >", "light"), ["Torch"]);
        assert.deepEqual(findTags("<Light:Torch>", "light"), ["Torch"]);
    });

    test("does not match longer tag names", () => {
        assert.deepEqual(findTags("<lightning: on> <lights: 3>", "light"), []);
    });

    test("reads tags that span lines", () => {
        assert.deepEqual(findTags("<light: Torch\nradius: 200>", "light"), ["Torch\nradius: 200"]);
    });

    test("copes with no text", () => {
        assert.deepEqual(findTags(undefined, "light"), []);
        assert.deepEqual(findTags("", "light"), []);
    });
});

describe("parseTagArgs", () => {
    test("a preset name alone", () => {
        assert.deepEqual(parseTagArgs("Torch"), { name: "Torch", values: {} });
    });

    test("nothing at all", () => {
        assert.deepEqual(parseTagArgs(""), { name: "", values: {} });
        assert.deepEqual(parseTagArgs(undefined), { name: "", values: {} });
    });

    test("name with settings, with or without commas and spaces", () => {
        const expected = { name: "Torch", values: { radius: "200", color: "#ff0000" } };
        assert.deepEqual(parseTagArgs("Torch radius:200 color:#ff0000"), expected);
        assert.deepEqual(parseTagArgs("Torch, radius: 200, color: #ff0000"), expected);
        assert.deepEqual(parseTagArgs("Torch radius=200 color=#ff0000"), expected);
    });

    test("keeps an r,g,b colour together", () => {
        assert.deepEqual(parseTagArgs("torch color: 255, 128, 0 radius: 100").values, {
            color: "255, 128, 0",
            radius: "100",
        });
    });

    test("multi-word names and negative offsets", () => {
        assert.deepEqual(parseTagArgs("Big Torch x: -4 y: -12.5"), {
            name: "Big Torch",
            values: { x: "-4", y: "-12.5" },
        });
    });

    test("settings without a name", () => {
        assert.deepEqual(parseTagArgs("radius: 50"), { name: "", values: { radius: "50" } });
    });

    test("captures unreadable values so they can be reported", () => {
        assert.deepEqual(parseTagArgs("Torch radius: big").values, { radius: "big" });
    });

    test("lower-cases keys", () => {
        assert.deepEqual(parseTagArgs("Torch RADIUS: 10").values, { radius: "10" });
    });
});

describe("pageCommentText", () => {
    test("joins comment lines and skips other commands", () => {
        const list = [
            { code: 108, indent: 0, parameters: ["<light: Torch"] },
            { code: 408, indent: 0, parameters: ["radius: 200>"] },
            { code: 101, indent: 0, parameters: ["", 0, 0, 2] },
            { code: 108, indent: 0, parameters: ["second comment"] },
            { code: 0, indent: 0, parameters: [] },
        ];
        assert.equal(pageCommentText(list), "<light: Torch\nradius: 200>\nsecond comment");
    });

    test("copes with a missing list", () => {
        assert.equal(pageCommentText(undefined), "");
    });
});
