import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    autoNormal,
    buildManifest,
    decodeNormal,
    encodeNormal,
    fileStem,
    MAX_SHADING,
    readManifest,
    screenGreen,
    strengthen,
    surfaceMapOf,
    surfaceMapsIn,
    surfaceShading,
    WEIGHT_RANGE,
    weightRange,
} from "../../src/core/surfaces.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe("finding surface maps by name", () => {
    test("knows each kind by its suffixes, whatever their case", () => {
        assert.deepEqual(surfaceMapOf("Actor1_normal"), ["Actor1", "normal"]);
        assert.deepEqual(surfaceMapOf("Actor1_N"), ["Actor1", "normal"]);
        assert.deepEqual(surfaceMapOf("Actor1_ao"), ["Actor1", "ao"]);
        assert.deepEqual(surfaceMapOf("Actor1_Occlusion"), ["Actor1", "ao"]);
        assert.deepEqual(surfaceMapOf("!$Gate1_specular"), ["!$Gate1", "specular"]);
        assert.deepEqual(surfaceMapOf("Dungeon_A1_n"), ["Dungeon_A1", "normal"]);
    });

    test("ordinary images are not maps", () => {
        for (const stem of ["Actor1", "Outside_B", "Dungeon_A1", "SF_Inside_C", "normal", "_n"]) {
            assert.equal(surfaceMapOf(stem), null, stem);
        }
    });

    test("reads image names, encrypted or not, and nothing else", () => {
        assert.equal(fileStem("Actor1_n.png"), "Actor1_n");
        assert.equal(fileStem("Actor1_n.png_"), "Actor1_n");
        assert.equal(fileStem("Actor1_n.PNG"), "Actor1_n");
        assert.equal(fileStem("notes.txt"), null);
        assert.equal(fileStem("Actor1_n.png.bak"), null);
    });

    test("groups a folder's maps by the image they belong to", () => {
        const maps = surfaceMapsIn([
            "Showcase_Party.png",
            "Showcase_Party_normal.png",
            "Showcase_Party_ao.png",
            "Showcase_Party_specular.png",
            "Actor1.png",
            "actor1_N.png_",
            "Readme.txt",
        ]);
        assert.deepEqual([...maps.keys()].sort(), ["actor1", "showcase_party"]);
        assert.deepEqual(maps.get("showcase_party"), {
            normal: "Showcase_Party_normal",
            ao: "Showcase_Party_ao",
            specular: "Showcase_Party_specular",
        });
        assert.deepEqual(maps.get("actor1"), { normal: "actor1_N" });
    });

    test("the full suffix wins over a short one, in any order", () => {
        assert.equal(surfaceMapsIn(["A_n.png", "A_normal.png"]).get("a").normal, "A_normal");
        assert.equal(surfaceMapsIn(["A_normal.png", "A_n.png"]).get("a").normal, "A_normal");
    });

    test("a manifest keeps only the maps, sorted, and reads back the same", () => {
        const manifest = buildManifest({
            characters: ["Zed_n.png", "Actor1.png", "Actor1_ao.png", "Actor1_ao.png_"],
            tilesets: ["Inside_C.png", "Inside_C_normal.png"],
        });
        assert.deepEqual(manifest, {
            characters: ["Actor1_ao", "Zed_n"],
            tilesets: ["Inside_C_normal"],
            parallaxes: [],
        });
        const back = readManifest(manifest);
        assert.deepEqual(back.get("characters").get("actor1"), { ao: "Actor1_ao" });
        assert.deepEqual(back.get("tilesets").get("inside_c"), { normal: "Inside_C_normal" });
        assert.equal(back.get("parallaxes").size, 0);
    });

    test("a broken manifest means no maps rather than an error", () => {
        for (const bad of [null, "nonsense", { characters: "Actor1_n" }, { characters: [3, null] }]) {
            const back = readManifest(bad);
            assert.equal(back.get("characters").size, 0);
        }
    });
});

describe("normals", () => {
    test("128 is exactly flat, and the ends are straight sideways", () => {
        assert.deepEqual(decodeNormal(128, 128), [0, 0, 1]);
        assert.deepEqual(decodeNormal(255, 128), [1, 0, 0]);
        assert.deepEqual(decodeNormal(128, 1), [0, -1, 0]);
    });

    test("encoding and decoding round-trip to within a step", () => {
        for (const v of [-1, -0.5, -0.01, 0, 0.3, 1]) {
            const [x] = decodeNormal(encodeNormal(v), 128);
            close(x, v, 0.5 / 127);
        }
    });

    test("too long a normal is brought back to length 1", () => {
        const [x, y, z] = decodeNormal(255, 255);
        close(Math.hypot(x, y), 1);
        close(z, 0, 1e-6);
    });

    test("green up in the file is up on screen, so screen y (down) is flipped", () => {
        // A pixel facing up the image: bright green.
        const [, upY] = decodeNormal(128, screenGreen(255));
        assert.ok(upY < -0.99, String(upY));
        const [, downY] = decodeNormal(128, screenGreen(255, false));
        assert.ok(downY > 0.99, String(downY));
        assert.equal(screenGreen(128), 128);
        assert.equal(screenGreen(0), 255);
    });

    test("strength steepens or flattens a normal, keeping it length 1", () => {
        const n = decodeNormal(180, 128);
        const steep = strengthen(n, 2);
        const flat = strengthen(n, 0);
        assert.ok(steep[0] > n[0]);
        close(Math.hypot(...steep), 1);
        assert.deepEqual(flat, [0, 0, 1]);
        assert.deepEqual(strengthen([0, 0, 1], 3), [0, 0, 1]);
    });
});

describe("how light falls on a surface", () => {
    const flat = [0, 0, 1];
    const s = Math.SQRT1_2;

    test("flat ground is lit exactly as without normal maps", () => {
        for (const [vx, vy, h] of [[0, 0, 72], [100, -40, 72], [500, 500, 1], [3, 4, 0]]) {
            assert.equal(surfaceShading(flat, vx, vy, h), 1);
        }
    });

    test("a face turned toward the light is brighter, one turned away darker", () => {
        // A light 72 to the right, hanging 72 up: 45 degrees.
        const toward = surfaceShading([s, 0, s], 72, 0, 72);
        const away = surfaceShading([-s, 0, s], 72, 0, 72);
        close(toward, 2 * s);
        assert.equal(away, 0);
    });

    test("right under a light, tilted faces get less than flat ground", () => {
        close(surfaceShading([s, 0, s], 0, 0, 72), s);
    });

    test("it is capped, so far, low lights do not blow out", () => {
        assert.equal(surfaceShading([1, 0, 0], 1000, 0, 10), MAX_SHADING);
    });

    test("screen y runs down, and so does the normal's", () => {
        // A light above (y negative) lights a face turned up (y negative).
        assert.ok(surfaceShading([0, -s, s], 0, -72, 72) > 1);
        assert.ok(surfaceShading([0, s, s], 0, -72, 72) < 1);
    });
});

describe("light weights", () => {
    test("a frame's lights share the whole range, so even a dim one gets every step", () => {
        assert.equal(weightRange(0.3), 0.3);
        assert.equal(weightRange(2.5), 2.5);
    });

    test("with many lights it stops growing, keeping steps fine where few overlap", () => {
        assert.equal(weightRange(40), WEIGHT_RANGE);
    });
});

describe("auto normal maps", () => {
    const ramp = (dx) => 0.5 + 0.1 * dx; // brighter to the right

    test("a flat image gives flat normals", () => {
        const [x, y, z] = autoNormal(() => 0.7, 1);
        close(x, 0);
        close(y, 0);
        close(z, 1);
    });

    test("brightness rising to the right faces the surface left, like a slope", () => {
        const [x, y, z] = autoNormal(ramp, 1);
        assert.ok(x < 0, String(x));
        close(y, 0);
        close(Math.hypot(x, y, z), 1);
    });

    test("strength makes it steeper, and 0 flat", () => {
        assert.ok(autoNormal(ramp, 2)[0] < autoNormal(ramp, 1)[0]);
        assert.deepEqual(autoNormal(ramp, 0), [0, 0, 1]);
    });

    test("brightness rising downward faces the surface up the screen", () => {
        const [, y] = autoNormal((dx, dy) => 0.5 + 0.1 * dy, 1);
        assert.ok(y < 0, String(y));
    });
});
