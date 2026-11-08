import { decodeNormal, encodeNormal, strengthen } from "../../src/core/surfaces.js";
import {
    parallaxNormal,
    peopleAO,
    peopleNormal,
    sheetA5Normal,
    sheetBAO,
    sheetBNormal,
    TEST_TILESET_NAME,
} from "../../tools/make-test-maps.mjs";
import { SHOWCASE_SHEET } from "../../tools/make-test-maps.mjs";
import { SHOWCASE_PARTY, command, expect, lightingState, pixels, snapHash, step, stepUntil, test } from "./fixtures.js";
import { expectMatchesSurfaceModel } from "./model.js";

// The lab (see lighting.spec.js) switched to the test tileset, whose A5 and B
// sheets have normal maps (B also AO), with the villager (event 3) wearing
// Lab_People, which has a normal and an AO map. tools/make-test-maps.mjs
// draws them all. Event 1 is the lamp, event 2 the crystal on the wall.
const LAB = { map: 3, x: 9, y: 8 };

const layer = () => SceneManager._scene._spriteset._lightingLayer;

async function useTestMaps(page) {
    await page.evaluate((name) => {
        $gameMap.changeTileset($dataTilesets.findIndex((t) => t && t.name === name));
        $gameMap.event(3).setImage("Lab_People", 0);
    }, TEST_TILESET_NAME);
    // The new images and their maps load over a few frames.
    await stepUntil(page, () => {
        const s = SceneManager._scene._spriteset._lightingLayer._surfaces;
        return s.active && s._tileset.hasData && s._items.some((item) => item.flags === 3);
    });
}

// Lab_Ocean (with a normal map) as the parallax, showing through a hole in
// the lab: every tile cleared from the cells 1-5 left of the player and 2-3
// up. Nothing else in the lab lets the parallax show.
async function useTestParallax(page) {
    await page.evaluate(() => {
        $gameMap.changeParallax("Lab_Ocean", false, false, 0, 0);
        const [w, h] = [$dataMap.width, $dataMap.height];
        for (let y = $gamePlayer.y - 3; y <= $gamePlayer.y - 2; y++) {
            for (let x = $gamePlayer.x - 5; x <= $gamePlayer.x - 1; x++) {
                for (let z = 0; z < 5; z++) $dataMap.data[(z * h + y) * w + x] = 0;
            }
        }
        SceneManager._scene._spriteset._tilemap.refresh();
    });
    await stepUntil(page, () => {
        const s = SceneManager._scene._spriteset._lightingLayer._surfaces;
        return s.active && s._parallax !== null && s._parallax.flags === 1;
    });
}

// The frame without any lighting at all: what each pixel was drawn as.
async function albedo(page) {
    await command(page, "setEventLight", { eventId: "1", light: "off" });
    await command(page, "setEventLight", { eventId: "2", light: "off" });
    await command(page, "setPlayerLight", { light: "off" });
    await page.evaluate(() => {
        SceneManager._scene._spriteset._lightingLayer.renderable = false;
    });
    await step(page);
    const unlit = await pixels(page);
    await page.evaluate(() => {
        SceneManager._scene._spriteset._lightingLayer.renderable = true;
    });
    await command(page, "setEventLight", { eventId: "1", light: "" });
    await command(page, "setEventLight", { eventId: "2", light: "" });
    return unlit;
}

// The surface buffer as the GPU holds it: RGBA bytes with the layer's margin.
async function surfaceBuffer(page) {
    const { base64, width, height } = await page.evaluate(() => {
        const rt = SceneManager._scene._spriteset._lightingLayer._surfaces.texture;
        const data = Graphics.app.renderer.extract.pixels(rt);
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
        return { base64: btoa(binary), width: rt.width, height: rt.height };
    });
    return { width, height, data: new Uint8Array(Buffer.from(base64, "base64")) };
}

const surfaceOptions = (page) =>
    page.evaluate(() => ({ aoStrength: window.GH_Lighting.settings.aoStrength, margin: -SceneManager._scene._spriteset._lightingLayer._view.left }));

// Where things are drawn, read from the game: the villager's frame and the
// top-left of its sprite, and each on-screen tile from the B and A5 sheets
// in the top tile layer, with its place in its sheet. Plus which of those
// sheet pixels are fully opaque, so tests only look where nothing behind
// shows through.
const layout = (page) =>
    page.evaluate(() => {
        const spriteset = SceneManager._scene._spriteset;
        const sprite = spriteset._characterSprites.find((s) => s._character === $gameMap.event(3));
        const frame = sprite._frame;
        const opaque = (bitmap, x, y) => bitmap.context.getImageData(x, y, 1, 1).data[3] === 255;
        const villager = {
            left: Math.round(sprite.x - frame.width / 2),
            top: Math.round(sprite.y - frame.height),
            frameX: frame.x,
            frameY: frame.y,
            opaque: [],
        };
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                if (opaque(sprite.bitmap, frame.x + x, frame.y + y)) villager.opaque.push([x, y]);
            }
        }
        const tw = $gameMap.tileWidth();
        const dx = Math.round($gameMap.displayX() * tw);
        const dy = Math.round($gameMap.displayY() * tw);
        const tiles = [];
        const sheets = spriteset._tilemap._bitmaps;
        for (let my = 0; my < $gameMap.height(); my++) {
            for (let mx = 0; mx < $gameMap.width(); mx++) {
                const ids = [0, 1, 2, 3].map((z) => $gameMap.tileId(mx, my, z));
                const top = ids.filter((id) => id > 0).pop();
                if (top === undefined || $gameMap.eventsXy(mx, my).length > 0) continue;
                if (mx === $gamePlayer.x && my === $gamePlayer.y) continue;
                let sheet = null;
                let sx;
                let sy;
                if (top < 256) {
                    sheet = "B";
                    sx = ((Math.floor(top / 128) % 2) * 8 + (top % 8)) * tw;
                    sy = (Math.floor((top % 256) / 8) % 16) * tw;
                } else if (top >= 1536 && top < 2048) {
                    sheet = "A5";
                    const t = top - 1536;
                    sx = (t % 8) * tw;
                    sy = Math.floor(t / 8) * tw;
                }
                if (!sheet) continue;
                const x = mx * tw - dx;
                const y = my * tw - dy;
                if (x < 0 || y < 0 || x + tw > Graphics.width || y + tw > Graphics.height) continue;
                const bitmap = sheets[sheet === "B" ? 5 : 4];
                const points = [];
                for (const [px, py] of [[4, 24], [24, 4], [40, 30], [30, 12], [12, 36], [24, 24]]) {
                    if (opaque(bitmap, sx + px, sy + py)) points.push([px, py]);
                }
                tiles.push({ sheet, x, y, sx, sy, points });
            }
        }
        return { villager, tiles };
    });

function expectNormalAt(buffer, margin, x, y, normal, ao, what) {
    const p = ((y + margin) * buffer.width + (x + margin)) * 4;
    const got = [buffer.data[p], buffer.data[p + 1], buffer.data[p + 2]];
    const want = [encodeNormal(normal[0]), encodeNormal(normal[1]), Math.round(ao * 255)];
    for (let i = 0; i < 3; i++) {
        expect(Math.abs(got[i] - want[i]), `${what} at (${x},${y}): got ${got}, want ${want}`).toBeLessThanOrEqual(2);
    }
}

test.describe("the surface buffer", () => {
    test("holds each image's maps where the image is drawn, and flat ground elsewhere", async ({ page, openMap }) => {
        const { warnings } = await openMap(LAB);
        await useTestMaps(page);
        await step(page);
        const buffer = await surfaceBuffer(page);
        const { margin } = await surfaceOptions(page);
        const { villager, tiles } = await layout(page);

        expect(villager.opaque.length).toBeGreaterThan(200);
        for (const [x, y] of villager.opaque.filter((_, i) => i % 17 === 0)) {
            const sx = villager.frameX + x;
            const sy = villager.frameY + y;
            expectNormalAt(buffer, margin, villager.left + x, villager.top + y, peopleNormal(sx, sy), peopleAO(sx, sy), "villager");
        }

        const b = tiles.filter((t) => t.sheet === "B" && t.points.length > 0);
        const a5 = tiles.filter((t) => t.sheet === "A5" && t.points.length > 0);
        // The lab shows a few B tiles, and one A5 tile.
        expect(b.length).toBeGreaterThan(3);
        expect(a5.length).toBeGreaterThan(0);
        for (const t of [...b.slice(0, 6), ...a5.slice(0, 6)]) {
            for (const [px, py] of t.points) {
                const [sx, sy] = [t.sx + px, t.sy + py];
                const normal = t.sheet === "B" ? sheetBNormal(sx, sy) : sheetA5Normal(sx, sy);
                const ao = t.sheet === "B" ? sheetBAO(sx, sy) : 1;
                expectNormalAt(buffer, margin, t.x + px, t.y + py, normal, ao, `${t.sheet} tile`);
            }
        }

        // Most of the floor (A2, with no maps) is flat and open.
        let flat = 0;
        for (let i = 0; i < buffer.data.length; i += 4) {
            if (buffer.data[i] === 128 && buffer.data[i + 1] === 128 && buffer.data[i + 2] === 255) flat++;
        }
        expect(flat / (buffer.data.length / 4)).toBeGreaterThan(0.4);
        expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
    });

    test("Normal Map Green: down reads green the other way", async ({ page, openMap }) => {
        await openMap({ ...LAB, "p.normalGreen": "down" });
        await useTestMaps(page);
        await step(page);
        const buffer = await surfaceBuffer(page);
        const { margin } = await surfaceOptions(page);
        const { villager } = await layout(page);
        for (const [x, y] of villager.opaque.filter((_, i) => i % 23 === 0)) {
            const [nx, ny, nz] = peopleNormal(villager.frameX + x, villager.frameY + y);
            const ao = peopleAO(villager.frameX + x, villager.frameY + y);
            expectNormalAt(buffer, margin, villager.left + x, villager.top + y, [nx, -ny, nz], ao, "villager");
        }
    });

    test("Normal Map Strength steepens normals", async ({ page, openMap }) => {
        await openMap({ ...LAB, "p.normalStrength": 2 });
        await useTestMaps(page);
        await step(page);
        const buffer = await surfaceBuffer(page);
        const { margin } = await surfaceOptions(page);
        const { villager } = await layout(page);
        for (const [x, y] of villager.opaque.filter((_, i) => i % 23 === 0)) {
            const sx = villager.frameX + x;
            const sy = villager.frameY + y;
            // The map is stored in 8 bits first, then steepened.
            const stored = decodeNormal(encodeNormal(peopleNormal(sx, sy)[0]), encodeNormal(peopleNormal(sx, sy)[1]));
            expectNormalAt(buffer, margin, villager.left + x, villager.top + y, strengthen(stored, 2), peopleAO(sx, sy), "villager");
        }
    });

    test("a parallax's maps show wherever the parallax does", async ({ page, openMap }) => {
        await openMap(LAB);
        await useTestParallax(page);
        const buffer = await surfaceBuffer(page);
        const { margin } = await surfaceOptions(page);
        // The screen's cells with no tile on any layer, or off the map, and
        // nobody standing in them: where the parallax shows. The hole, here.
        const { open, size } = await page.evaluate(() => {
            const tw = $gameMap.tileWidth();
            const open = [];
            const [dx, dy] = [$gameMap.displayX(), $gameMap.displayY()];
            for (let y = 0; y * tw < Graphics.height; y++) {
                for (let x = 0; x * tw < Graphics.width; x++) {
                    const [mx, my] = [Math.floor(dx) + x, Math.floor(dy) + y];
                    const inside = mx < $gameMap.width() && my < $gameMap.height();
                    const empty = [0, 1, 2, 3].every((z) => $gameMap.tileId(mx, my, z) === 0);
                    const nobody = $gameMap.eventsXy(mx, my).length === 0 && !$gamePlayer.pos(mx, my);
                    if ((!inside || empty) && nobody) open.push([(mx - dx) * tw, (my - dy) * tw]);
                }
            }
            return { open, size: SceneManager._scene._spriteset._parallax.bitmap.width };
        });
        const [width, height] = [buffer.width - 2 * margin, buffer.height - 2 * margin];
        expect(open.length).toBeGreaterThanOrEqual(8);
        for (const [left, top] of open) {
            // Away from the cell's top, where sprites from the cell above can
            // hang over it.
            for (const [px, py] of [[8, 20], [24, 24], [40, 30], [16, 40]]) {
                const [x, y] = [left + px, top + py];
                if (x >= width || y >= height) continue;
                // A parallax that neither loops nor scrolls stays put on screen.
                expectNormalAt(buffer, margin, x, y, parallaxNormal(x % size, y % size), 1, "parallax");
            }
        }
    });

    test("after a lost WebGL context comes back, everything is drawn as before", async ({ page, openMap }) => {
        // Phones often lose the context when the game goes to the background.
        // MZ 1.10 itself does not fully recover: with WebGL 2 its tilemap
        // makes new, empty textures for the tilesets and never fills them, so
        // this test does that for it, leaving only the plugin's own textures
        // to check. With WebGL 1 nothing at all is drawn afterwards, with or
        // without the plugin.
        const { webglVersion } = await openMap(LAB);
        test.skip(webglVersion === 1, "MZ draws nothing after a lost WebGL 1 context comes back");
        await useTestMaps(page);
        await useTestParallax(page);
        await command(page, "setAmbient", { color: "Night", duration: "0" });
        await command(page, "setEventLight", { eventId: "1", light: "Torch flicker: off radius: 300" });
        await step(page, 2);
        const before = { surfaces: await surfaceBuffer(page), frame: await snapHash(page) };
        await page.evaluate(() => {
            window.__loseContext = Graphics.app.renderer.gl.getExtension("WEBGL_lose_context");
            window.__loseContext.loseContext();
        });
        await step(page, 2);
        await page.evaluate(() => window.__loseContext.restoreContext());
        await stepUntil(page, () => !Graphics.app.renderer.context.isLost);
        await page.evaluate(() => {
            const tilemap = SceneManager._scene._spriteset._tilemap;
            tilemap.setBitmaps(tilemap._bitmaps);
        });
        await step(page, 2);
        const after = await surfaceBuffer(page);
        let changed = 0;
        for (let i = 0; i < after.data.length; i++) if (after.data[i] !== before.surfaces.data[i]) changed++;
        expect(changed).toBe(0);
        expect(await snapHash(page)).toBe(before.frame);
    });

    test("auto normal maps raise images without maps, and only the kind asked for", async ({ page, openMap }) => {
        const bumpy = async () => {
            const buffer = await surfaceBuffer(page);
            const { margin } = await surfaceOptions(page);
            const v = await layout(page);
            const at = (x, y) => {
                const p = ((y + margin) * buffer.width + (x + margin)) * 4;
                return buffer.data[p] !== 128 || buffer.data[p + 1] !== 128;
            };
            const villager = v.villager.opaque.filter(([x, y]) => at(v.villager.left + x, v.villager.top + y)).length;
            // The floor: an A2 tile under nothing else, from the lab's open floor.
            let floor = 0;
            for (let y = 200; y < 260; y++) for (let x = 560; x < 600; x++) if (at(x, y)) floor++;
            return { villager: villager / v.villager.opaque.length, floor: floor / 2400 };
        };
        await openMap({ ...LAB, "p.autoNormals": "characters" });
        let b = await bumpy();
        expect(b.villager).toBeGreaterThan(0.3);
        expect(b.floor).toBe(0);

        await openMap({ ...LAB, "p.autoNormals": "tiles" });
        b = await bumpy();
        expect(b.villager).toBe(0);
        expect(b.floor).toBeGreaterThan(0.1);

        await openMap({ ...LAB, "p.autoNormals": "all", "p.autoNormalStrength": 0 });
        b = await bumpy();
        expect(b.villager).toBe(0);
        expect(b.floor).toBe(0);
    });
});

test.describe("rendering with normal and AO maps matches the model", () => {
    const scenarios = [
        {
            name: "lights catch the sides of things facing them",
            ambient: "Night",
            events: { 1: "Torch flicker: off radius: 300", 2: "Lamp radius: 400 height: 120" },
            move: [10, 8],
        },
        {
            name: "a low light rakes across them",
            ambient: "Night",
            events: { 1: "Lamp radius: 300 height: 12 shadows: off" },
            move: [11, 9],
        },
        {
            name: "shadows still fall on them",
            ambient: "Night",
            events: { 1: "Torch flicker: off radius: 260", 2: "Lamp height: 200 radius: 400" },
            query: { x: 6, y: 10 },
        },
        {
            name: "cones and beams",
            ambient: "Night",
            events: {
                1: "Sunbeam direction: 120 width: 60 radius: 500",
                2: "shape: cone direction: 225 spread: 50 radius: 400 color: #9fd0ff",
            },
        },
        {
            name: "AO holds back what lights add, not the ambient",
            ambient: "128,128,128",
            events: { 1: "Lamp radius: 300" },
            move: [12, 8],
        },
        {
            name: "by day with no lights, the maps change nothing",
            ambient: "off",
            events: { 1: "off", 2: "off" },
            hidden: true,
        },
        {
            name: "by day, a light brighter than the day still shades them",
            query: { "p.maxBrightness": 2 },
            ambient: "off",
            events: { 1: "Lamp intensity: 2 radius: 300" },
            move: [12, 8],
        },
        {
            name: "AO Strength eases it",
            query: { "p.aoStrength": 0.5 },
            ambient: "#808080",
            events: { 1: "Torch flicker: off radius: 300" },
            move: [12, 8],
        },
        {
            name: "Max Brightness 2",
            query: { "p.maxBrightness": 2 },
            ambient: "128,128,128",
            events: { 1: "Lamp intensity: 2.5 radius: 300" },
            move: [12, 8],
        },
        {
            name: "a parallax with a normal map",
            parallax: true,
            ambient: "Night",
            events: { 1: "Lamp radius: 300 height: 60" },
            move: [6, 7],
        },
        {
            name: "Light Quality: Quarter keeps the maps sharp",
            query: { "p.lightResolution": 0.25 },
            ambient: "Night",
            events: { 1: "Torch flicker: off radius: 300" },
            move: [12, 8],
        },
    ];
    for (const s of scenarios) {
        test(s.name, async ({ page, openMap }) => {
            const { warnings } = await openMap({ ...LAB, ...s.query });
            await useTestMaps(page);
            if (s.parallax) await useTestParallax(page);
            if (s.move) await page.evaluate(([x, y]) => $gameMap.event(1).locate(x, y), s.move);
            const unlit = await albedo(page);
            await command(page, "setAmbient", { color: s.ambient, duration: "0" });
            await command(page, "setPlayerLight", { light: "off" });
            for (const [id, light] of Object.entries(s.events)) {
                await command(page, "setEventLight", { eventId: id, light });
            }
            await step(page, 2);
            expect(await page.evaluate(() => SceneManager._scene._spriteset._lightingLayer._surfaces.active)).toBe(true);
            if (s.hidden) expect(await page.evaluate(() => SceneManager._scene._spriteset._lightingLayer.visible)).toBe(false);
            const state = await lightingState(page);
            const surface = { ...(await surfaceBuffer(page)), ...(await surfaceOptions(page)) };
            expectMatchesSurfaceModel(await pixels(page), unlit, state, surface);
            expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
        });
    }
});

test.describe("finding and loading maps", () => {
    test("with no maps on screen, frames are exactly as with maps turned off", async ({ page, openMap }) => {
        const scene = async (query) => {
            await openMap({ ...LAB, ...query });
            await command(page, "setAmbient", { color: "Night", duration: "0" });
            await command(page, "setPlayerLight", { light: "Torch flicker: off" });
            await step(page, 2);
            return snapHash(page);
        };
        const on = await scene({});
        expect(await page.evaluate(() => SceneManager._scene._spriteset._lightingLayer._surfaces.active)).toBe(false);
        const off = await scene({ "p.surfaceMaps": false });
        expect(on).toBe(off);
    });

    test("flat surfaces with no AO look as they would without maps", async ({ page, openMap }) => {
        // Strength 0 and AO Strength 0 leave nothing for the maps to do, so
        // only rounding separates the two ways of drawing the frame.
        const frame = async (query, maps) => {
            await openMap({ ...LAB, ...query });
            if (maps) await useTestMaps(page);
            else await page.evaluate(() => $gameMap.event(3).setImage("Lab_People", 0));
            await command(page, "setAmbient", { color: "Night", duration: "0" });
            await command(page, "setEventLight", { eventId: "1", light: "Torch flicker: off radius: 300" });
            await command(page, "setPlayerLight", { light: "off" });
            if (!maps) {
                await page.evaluate(
                    (name) => $gameMap.changeTileset($dataTilesets.findIndex((t) => t && t.name === name)),
                    TEST_TILESET_NAME
                );
            }
            await step(page, 10);
            return pixels(page);
        };
        const flat = await frame({ "p.normalStrength": 0, "p.aoStrength": 0 }, true);
        const plain = await frame({ "p.surfaceMaps": false }, false);
        let worst = 0;
        for (let i = 0; i < flat.data.length; i++) worst = Math.max(worst, Math.abs(flat.data[i] - plain.data[i]));
        expect(worst).toBeLessThanOrEqual(2);
    });

    test("a map that fails to load is reported and left out, and the game goes on", async ({ page, openMap }) => {
        await page.route("**/img/characters/Lab_People_ao.png", (route) => route.fulfill({ status: 404, body: "" }));
        const { warnings, pageErrors } = await openMap(LAB);
        await page.evaluate(() => $gameMap.event(3).setImage("Lab_People", 0));
        await stepUntil(page, () => SceneManager._scene._spriteset._lightingLayer._surfaces._items.some((i) => i.flags === 1));
        await step(page, 5);
        expect(warnings.some((w) => w.includes("couldn't load img/characters/Lab_People_ao.png"))).toBe(true);
        expect(pageErrors).toEqual([]);
        expect(await page.evaluate(() => SceneManager._scene instanceof Scene_Map)).toBe(true);
    });

    test("without the list of maps, a browser just has none", async ({ page, openMap }) => {
        await page.route("**/data/GH_LightingMaps.json", (route) => route.fulfill({ status: 404, body: "" }));
        const { warnings, pageErrors } = await openMap(LAB);
        await page.evaluate(() => $gameMap.event(3).setImage("Lab_People", 0));
        await step(page, 10);
        expect(await page.evaluate(() => SceneManager._scene._spriteset._lightingLayer._surfaces.active)).toBe(false);
        expect(pageErrors).toEqual([]);
        expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
    });

    test("a map scene waits for the maps of what it shows", async ({ page, openMap }) => {
        // The villager starts the map in Lab_People, whose maps arrive late,
        // and the first frame drawn already has them.
        await page.route("**/data/Map003.json", async (route) => {
            const response = await route.fetch();
            const map = await response.json();
            for (const p of map.events[3].pages) p.image.characterName = "Lab_People";
            await route.fulfill({ response, json: map });
        });
        let delayed = 0;
        await page.route("**/img/characters/Lab_People_*.png", async (route) => {
            delayed++;
            await new Promise((resolve) => setTimeout(resolve, 500));
            await route.continue();
        });
        const { warnings } = await openMap({ ...LAB, frames: 1 });
        const flags = await page.evaluate(() =>
            SceneManager._scene._spriteset._lightingLayer._surfaces._items.map((i) => i.flags)
        );
        expect(delayed).toBe(2);
        expect(flags).toContain(3);
        expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
    });
});

test.describe("the project's party", () => {
    // Showcase_Party has normal and AO maps. The leader and each follower on
    // screen should draw them; the other four wait in reserve, as MZ shows
    // only the battle members.
    test("the leader and followers draw their maps", async ({ page, openMap }) => {
        const { warnings, pageErrors } = await openMap({ ...LAB, party: SHOWCASE_PARTY, "p.globalLight": "Night" });
        const party = await page.evaluate(() => $gameParty.members().map((a) => [a.characterName(), a.characterIndex()]));
        expect(party).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [SHOWCASE_SHEET, i]));
        // Followers start on the player's tile; stand them beside it.
        await page.evaluate(() => {
            $gamePlayer.followers().data().forEach((f, i) => f.locate([7, 8, 10][i], 8));
        });
        const drawn = (name) => {
            const s = SceneManager._scene._spriteset._lightingLayer._surfaces;
            const sheet = ImageManager.loadCharacter(name).baseTexture;
            return s.active ? s._items.filter((item) => item.color === sheet && item.flags === 3).length : 0;
        };
        await stepUntil(page, `(${drawn})(${JSON.stringify(SHOWCASE_SHEET)}) === 4`);
        expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
        expect(pageErrors).toEqual([]);
    });
});

test.describe("golden images", () => {
    test("surfaces", async ({ page, openMap }) => {
        const { warnings } = await openMap({ ...LAB, x: 11, y: 9, dir: 4, "p.globalLight": "Night" });
        await useTestMaps(page);
        await page.evaluate(() => $gameMap.event(1).locate(10, 8));
        await command(page, "setEventLight", { eventId: "1", light: "Torch flicker: off radius: 300" });
        await command(page, "setEventLight", { eventId: "2", light: "Lamp height: 120 radius: 400" });
        await step(page, 2);
        expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
        await expect(page.locator("#gameCanvas")).toHaveScreenshot("surfaces.png");
    });
});
