import { flicker } from "../../src/core/flicker.js";
import { command, expect, lightingState, pixels, snapHash, step, stepUntil, test } from "./fixtures.js";
import { expectMatchesModel } from "./model.js";

// Tavern layout with no ambient tag, so it follows the global light. Event 1
// "Lab Lamp" (4, 11) has <light: Lamp> in its note and a self-switch-A page
// with <light: off>; event 2 "Lab Crystal" (14, 11, on top of a wall) has
// <light: Crystal radius: 100> as a page comment. Both are invisible. Event
// 3 "Lab Villager" (13, 8) is a plain People1 character with no tags.
// Region 5 is painted on (11, 7) and (11, 8), and casts shadows only when a
// test sets Shadow Regions to 5.
const LAB = { map: 3, x: 9, y: 8 };
const TAVERN = { map: 1, x: 9, y: 8 }; // <ambient: Evening>
const EVENING = [0x8a, 0x74, 0x68];
const NIGHT = [0x2c, 0x33, 0x52];
const CAVE = [0x18, 0x18, 0x1f];

const to255 = (color) => color.map((c) => Math.round(c * 255));
const mapAmbient = (page) => page.evaluate(() => $gameMap.ghAmbient().color).then(to255);
const globalLight = (page) => page.evaluate(() => $gameSystem.ghGlobalLight().color).then(to255);

// Settled on a map: no transfer pending, any screen fade finished. Passed to
// stepUntil as is: it runs in the page, so it cannot use anything from this
// file.
const onMap = () =>
    SceneManager._scene instanceof Scene_Map &&
    SceneManager._scene.isStarted() &&
    !SceneManager._scene.isFading() &&
    !$gamePlayer.isTransferring();

async function transfer(page, mapId) {
    await page.evaluate((id) => $gamePlayer.reserveTransfer(id, 9, 8, 2, 2), mapId);
    await stepUntil(page, onMap);
}

// The lab as drawn, with every light off. Afterwards the events go back to
// their own tags and the player has no light.
async function unlitPixels(page) {
    await command(page, "setEventLight", { eventId: "1", light: "off" });
    await command(page, "setEventLight", { eventId: "2", light: "off" });
    await command(page, "setPlayerLight", { light: "off" });
    await step(page);
    const unlit = await pixels(page);
    await command(page, "setEventLight", { eventId: "1", light: "" });
    await command(page, "setEventLight", { eventId: "2", light: "" });
    return unlit;
}

test.describe("rendering matches the lighting model", () => {
    // Max Brightness is the plugin's default (1.25) unless the scenario sets it.
    const scenarios = [
        { name: "gray ambient with the lab's lights", ambient: "128,128,128", player: "off" },
        { name: "darkness with a white player light", ambient: "0,0,0", player: "radius: 120" },
        { name: "colored ambient and a colored light", ambient: "#402010", player: "color: #00ff80 radius: 160" },
        { name: "a light far brighter than the cap", ambient: "#101010", player: "Lamp intensity: 2.5" },
        { name: "lights no brighter than a fully lit map fade out", player: "Lamp" },
        { name: "a light brighter than a fully lit map still shows", player: "Lamp intensity: 1.5" },
        { name: "the global light on a map without an ambient tag", global: "#303860", player: "Torch" },
        { name: "a flashlight follows the player's facing", ambient: "Night", facing: 4, player: "Flashlight" },
        {
            name: "a narrow cone at a fixed angle",
            ambient: "Night",
            player: "off",
            events: { 1: "shape: cone direction: 135 spread: 25 radius: 320 color: #80c0ff" },
        },
        { name: "a cone wider than a half circle", ambient: "Night", facing: 8, player: "Flashlight spread: 250" },
        {
            name: "beams",
            ambient: "Night",
            player: "Sunbeam direction: 60 width: 40 radius: 400",
            events: { 2: "Sunbeam" },
        },
        {
            name: "flickering lights, caught at one frame",
            ambient: "Darkness",
            player: "Torch",
            events: { 1: "Lamp flicker: Faulty", 2: "Magic" },
        },
        {
            name: "Max Brightness 2",
            query: { "p.maxBrightness": 2 },
            ambient: "128,128,128",
            player: "Lamp intensity: 2.5",
        },
        {
            name: "Max Brightness 1: lights only restore colors",
            query: { "p.maxBrightness": 1 },
            ambient: "128,128,128",
            player: "Lamp intensity: 2.5",
        },
        {
            name: "walls cast soft shadows",
            ambient: "Night",
            player: "off",
            events: { 1: "Torch flicker: off radius: 260" },
        },
        {
            name: "a light with no softness casts hard shadows",
            ambient: "Night",
            player: "off",
            events: { 1: "Lamp softness: 0 radius: 260" },
        },
        {
            name: "a light can be set to cast no shadows",
            ambient: "Night",
            player: "off",
            events: { 1: "Torch flicker: off radius: 260 shadows: off" },
        },
        {
            name: "characters cast shadows, shorter from higher lights",
            query: { x: 6, y: 10 },
            ambient: "Night",
            player: "off",
            events: { 1: "Torch flicker: off radius: 260", 2: "Lamp height: 200 radius: 400" },
        },
        {
            name: "the player's light is shadowed by others, not by the player or the party",
            query: { x: 11, y: 8 },
            ambient: "Night",
            player: "Torch flicker: off",
        },
        {
            name: "painted regions cast shadows",
            query: { "p.shadowRegions": '["5"]' },
            ambient: "Night",
            player: "Lamp radius: 300",
        },
        {
            name: "with Character Shadows off, only tiles cast them",
            query: { x: 6, y: 10, "p.characterShadows": false },
            ambient: "Night",
            player: "off",
            events: { 1: "Torch flicker: off radius: 260" },
            check: (state) => expect(state.casters).toEqual([]),
        },
        {
            name: "with Shadows off, nothing casts them",
            query: { x: 11, y: 8, "p.shadows": false },
            ambient: "Night",
            player: "Torch flicker: off",
            check: (state) => expect(state.casterTiles).toBeNull(),
        },
    ];
    for (const s of scenarios) {
        test(s.name, async ({ page, openMap }) => {
            await openMap({ ...LAB, ...s.query });
            if (s.facing) await page.evaluate((d) => $gamePlayer.setDirection(d), s.facing);
            const unlit = await unlitPixels(page);
            if (s.global) await command(page, "setGlobalLight", { color: s.global, duration: "0" });
            if (s.ambient) await command(page, "setAmbient", { color: s.ambient, duration: "0" });
            for (const [id, light] of Object.entries(s.events ?? {})) {
                await command(page, "setEventLight", { eventId: id, light });
            }
            await command(page, "setPlayerLight", { light: s.player });
            // Two frames: a map following the global light catches up during
            // the map update, which runs after the sprites have been drawn.
            await step(page, 2);
            const state = await lightingState(page);
            if (s.check) s.check(state);
            expectMatchesModel(await pixels(page), unlit, state);
        });
    }
});

test("a light that follows its character's facing turns smoothly", async ({ page, openMap }) => {
    await openMap(LAB);
    // The frame compared below has the player facing left, so the unlit one
    // must too.
    await page.evaluate(() => $gamePlayer.setDirection(4));
    const unlit = await unlitPixels(page);
    await page.evaluate(() => $gamePlayer.setDirection(2));
    await command(page, "setAmbient", { color: "Night", duration: "0" });
    await command(page, "setPlayerLight", { light: "Flashlight" });
    await step(page);
    const drawnAngle = () => page.evaluate(() => SceneManager._scene._spriteset._lightingLayer.angleOf($gamePlayer));
    expect(await drawnAngle()).toBe(180); // facing down from the start

    await page.evaluate(() => $gamePlayer.setDirection(4));
    await step(page, 3);
    expect(await drawnAngle()).toBe(225); // 15 degrees a frame, toward left
    const state = await lightingState(page);
    const turning = state.lights.map((l) => (l.id === "player" ? { ...l, angle: 225 } : l));
    expectMatchesModel(await pixels(page), unlit, { ...state, lights: turning });

    await step(page, 3);
    expect(await drawnAngle()).toBe(270);
    await step(page, 3);
    expect(await drawnAngle()).toBe(270);
});

test("flicker follows the two-layer model frame by frame, and is never still", async ({ page, openMap }) => {
    await openMap(LAB);
    const unlit = await unlitPixels(page);
    await command(page, "setAmbient", { color: "Darkness", duration: "0" });
    await command(page, "setPlayerLight", { light: "Torch" });
    const levels = [];
    for (let i = 0; i < 6; i++) {
        await step(page, 7);
        const state = await lightingState(page);
        expectMatchesModel(await pixels(page), unlit, state);
        const torch = state.lights.find((l) => l.id === "player");
        levels.push(flicker(state.time, torch.seed, torch.flicker));
    }
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.05);
    expect(new Set(levels).size).toBe(levels.length);
});

test("events' lights flicker differently, unless they share a seed", async ({ page, openMap }) => {
    await openMap(LAB);
    const levels = async () => {
        const { time, lights } = await lightingState(page);
        return lights.map((l) => flicker(time, l.seed, l.flicker));
    };
    await command(page, "setEventLight", { eventId: "1", light: "Torch" });
    await command(page, "setEventLight", { eventId: "2", light: "Torch" });
    await step(page, 5);
    const [a, b] = await levels();
    expect(a).not.toBeCloseTo(b, 6);

    await command(page, "setEventLight", { eventId: "1", light: "Torch seed: 7" });
    await command(page, "setEventLight", { eventId: "2", light: "Torch seed: 7" });
    await step(page, 5);
    const [c, d] = await levels();
    expect(c).toBe(d);
});

test("ambient fades over the given number of frames", async ({ page, openMap }) => {
    await openMap(LAB);
    const unlit = await unlitPixels(page);
    await command(page, "setAmbient", { color: "0,0,0", duration: "60" });
    // Scene_Map updates sprites before the map, so the screen shows the
    // fade one frame behind, exactly like character sprites: 31 frames run
    // shows 30 frames of fade.
    await step(page, 31);
    const state = await lightingState(page);
    expectMatchesModel(await pixels(page), unlit, { ...state, ambient: [0.5, 0.5, 0.5] });
    await step(page, 30);
    expectMatchesModel(await pixels(page), unlit, { ...state, ambient: [0, 0, 0] });
});

test("event lights come from notes and page comments, and follow page conditions", async ({ page, openMap }) => {
    await openMap(LAB);
    await command(page, "setAmbient", { color: "Darkness", duration: "0" });
    await step(page);
    let { lights } = await lightingState(page);
    expect(lights.map((l) => [l.id, l.radius])).toEqual([
        [1, 144], // Lamp preset, from the note
        [2, 100], // Crystal with radius: 100, from the page comment
    ]);

    // Self switch A activates the lamp's second page, whose comment says off.
    await page.evaluate(() => $gameSelfSwitches.setValue([3, 1, "A"], true));
    await step(page, 2);
    ({ lights } = await lightingState(page));
    expect(lights.map((l) => l.id)).toEqual([2]);
});

test("Set Event Light overrides an event, and 0 means the calling event", async ({ page, openMap }) => {
    await openMap(LAB);
    await command(page, "setEventLight", { eventId: "1", light: "Magic" });
    await command(page, "setEventLight", { eventId: "0", light: "off" }, 2);
    let lights = await page.evaluate(() => [$gameMap.event(1).ghLight(), $gameMap.event(2).ghLight()]);
    expect(lights[0].radius).toBe(144);
    expect(lights[0].color[0]).toBeCloseTo(0xc5 / 255);
    expect(lights[1]).toBeNull();

    // A blank light hands control back to the event's own tags.
    await command(page, "setEventLight", { eventId: "2", light: "" });
    lights = await page.evaluate(() => [$gameMap.event(2).ghLight()]);
    expect(lights[0].radius).toBe(100);
});

test.describe("global light", () => {
    test("maps without an ambient tag follow it; maps with one keep their own", async ({ page, openMap }) => {
        await openMap({ ...LAB, "p.globalLight": "Night" });
        expect(await mapAmbient(page)).toEqual(NIGHT);

        await transfer(page, 1);
        expect(await mapAmbient(page)).toEqual(EVENING);
        await command(page, "setGlobalLight", { color: "Darkness", duration: "0" });
        await step(page);
        expect(await mapAmbient(page)).toEqual(EVENING);

        await transfer(page, 3);
        expect(await mapAmbient(page)).toEqual([0, 0, 0]);
    });

    test("a global fade carries the map along with it", async ({ page, openMap }) => {
        await openMap(LAB);
        await command(page, "setGlobalLight", { color: "0,0,0", duration: "60" });
        await step(page, 30);
        const [global, map] = await page.evaluate(() => [$gameSystem.ghGlobalLight().color, $gameMap.ghAmbient().color]);
        expect(global[0]).toBeCloseTo(0.5, 6);
        expect(map).toEqual(global);
        await step(page, 30);
        expect(await mapAmbient(page)).toEqual([0, 0, 0]);
    });

    test("Set Map Ambient overrides it until Reset Map Ambient", async ({ page, openMap }) => {
        await openMap(LAB);
        await command(page, "setGlobalLight", { color: "Cave", duration: "0" });
        await command(page, "setAmbient", { color: "Night", duration: "0" });
        await command(page, "setGlobalLight", { color: "Darkness", duration: "0" });
        await step(page);
        expect(await mapAmbient(page)).toEqual(NIGHT);

        await command(page, "resetAmbient", { duration: "0" });
        expect(await mapAmbient(page)).toEqual([0, 0, 0]);
        await command(page, "setGlobalLight", { color: "Cave", duration: "0" });
        await step(page);
        expect(await mapAmbient(page)).toEqual(CAVE);
    });

    // The lab's lamp and crystal have intensity 1: as bright as full daylight.
    test("lights fade out as the global light rises to their brightness", async ({ page, openMap }) => {
        const layerVisible = () => page.evaluate(() => SceneManager._scene._spriteset._lightingLayer.visible);
        await openMap(LAB);
        expect(await layerVisible()).toBe(false);
        const unlit = await unlitPixels(page);

        await command(page, "setGlobalLight", { color: "Night", duration: "0" });
        await step(page, 2);
        const night = await lightingState(page);
        expectMatchesModel(await pixels(page), unlit, night);

        // Halfway from night to day the lights still show, but less. The
        // screen is a frame behind the map, as in the fade test above.
        await command(page, "setGlobalLight", { color: "Day", duration: "60" });
        await step(page, 31);
        const dusk = night.ambient.map((c) => (c + 1) / 2);
        expectMatchesModel(await pixels(page), unlit, { ...night, ambient: dusk });

        await step(page, 30);
        expect(await layerVisible()).toBe(false);
    });

    test("Reset Map Ambient on a map with a tag goes back to the tag", async ({ page, openMap }) => {
        await openMap(TAVERN);
        await command(page, "setAmbient", { color: "Night", duration: "0" });
        await command(page, "resetAmbient", { duration: "0" });
        expect(await mapAmbient(page)).toEqual(EVENING);
    });

    test("Day and off both mean fully lit", async ({ page, openMap }) => {
        await openMap(LAB);
        await command(page, "setGlobalLight", { color: "Day", duration: "0" });
        await step(page, 2);
        expect(await page.evaluate(() => SceneManager._scene._spriteset._lightingLayer.visible)).toBe(false);
        await command(page, "setAmbient", { color: "Night", duration: "0" });
        await step(page);
        expect(await page.evaluate(() => SceneManager._scene._spriteset._lightingLayer.visible)).toBe(true);
        await command(page, "setAmbient", { color: "off", duration: "0" });
        await step(page);
        expect(await page.evaluate(() => SceneManager._scene._spriteset._lightingLayer.visible)).toBe(false);
    });
});

test("mistakes are reported in the console, not silently ignored", async ({ page, openMap }) => {
    const { warnings } = await openMap(LAB);

    await command(page, "setPlayerLight", { light: "Torc" });
    await command(page, "setAmbient", { color: "Twilight" });
    await command(page, "setGlobalLight", { color: "Nite" });
    await command(page, "setEventLight", { eventId: "99", light: "Torch" });
    await step(page);
    const text = warnings.join("\n");
    expect(text).toContain('unknown light preset "Torc"');
    expect(text).toContain('unknown ambient "Twilight"');
    expect(text).toContain('unknown ambient "Nite"');
    expect(text).toContain("there is no event 99");
    // The misspelt light still shows, as a plain white one.
    expect(await page.evaluate(() => $gamePlayer.ghLight().radius)).toBe(144);
});

test.describe("lighting state", () => {
    // A map override (Night) on top of a global light (Cave), so the tests
    // can tell which of the two survived. No flicker: these tests compare
    // frames taken at different times.
    async function lightUpLab(page) {
        await command(page, "setGlobalLight", { color: "Cave", duration: "0" });
        await command(page, "setAmbient", { color: "Night", duration: "0" });
        await command(page, "setPlayerLight", { light: "Lantern flicker: off" });
        await command(page, "setEventLight", { eventId: "2", light: "Magic flicker: off" });
        await step(page, 2);
    }

    test("survives opening the menu", async ({ page, openMap }) => {
        await openMap(LAB);
        await lightUpLab(page);
        const before = await snapHash(page);
        await page.evaluate(() => SceneManager.push(Scene_Menu));
        await stepUntil(page, () => SceneManager._scene instanceof Scene_Menu && SceneManager._scene.isStarted());
        await page.evaluate(() => SceneManager.pop());
        await stepUntil(page, onMap);
        await step(page);
        expect(await snapHash(page)).toBe(before);
    });

    test("survives saving and loading", async ({ page, openMap }) => {
        await openMap(LAB);
        await lightUpLab(page);
        const before = await snapHash(page);
        await page.evaluate(() => {
            const save = JsonEx.stringify(DataManager.makeSaveContents());
            DataManager.createGameObjects();
            DataManager.extractSaveContents(JsonEx.parse(save));
            SceneManager.goto(Scene_Map);
        });
        await stepUntil(page, onMap);
        await step(page);
        expect(await snapHash(page)).toBe(before);
        expect(await globalLight(page)).toEqual(CAVE);
    });

    // A transfer within the same map is not "leaving" it: MZ keeps the
    // map's events as they are, and the lighting follows suit.
    test("leaving a map resets its lighting but keeps the global and player lights", async ({ page, openMap }) => {
        await openMap(LAB);
        await lightUpLab(page);
        const playerRadius = () => page.evaluate(() => $gamePlayer.ghLight().radius);

        await transfer(page, 1);
        expect(await mapAmbient(page)).toEqual(EVENING);
        expect(await playerRadius()).toBe(216);

        await transfer(page, 3);
        expect(await mapAmbient(page)).toEqual(CAVE);
        expect(await playerRadius()).toBe(216);
        expect(await page.evaluate(() => $gameMap.event(2).ghLight().radius)).toBe(100);
    });
});

test.describe("shadow casters", () => {
    const casts = (page, x, y) => page.evaluate(([x, y]) => $gameMap.ghCastsShadow(x, y), [x, y]);

    test("tops of walls cast shadows, and so do chosen regions and terrain tags", async ({ page, openMap }) => {
        await openMap({ ...LAB, "p.shadowRegions": '["5"]', "p.shadowTerrainTags": '["3"]' });
        expect(await casts(page, 1, 1)).toBe(true); // wall top
        expect(await casts(page, 3, 3)).toBe(false); // wall front
        expect(await casts(page, 11, 7)).toBe(true); // region 5
        expect(await casts(page, 5, 8)).toBe(false); // floor...
        await page.evaluate(() => {
            $gameMap.tilesetFlags()[$gameMap.tileId(5, 8, 0)] |= 3 << 12;
        });
        expect(await casts(page, 5, 8)).toBe(true); // ...with terrain tag 3
    });

    test("with Walls Cast Shadows off, walls are left out", async ({ page, openMap }) => {
        await openMap({ ...LAB, "p.wallShadows": false, "p.shadowRegions": '["5"]' });
        expect(await casts(page, 1, 1)).toBe(false);
        expect(await casts(page, 11, 7)).toBe(true);
    });

    test("a map's note can turn shadows off, or on against the parameter", async ({ page, openMap }) => {
        const withNote = (note) =>
            page.evaluate((note) => {
                $dataMap.note = note;
                return $gameMap.ghShadowsOn();
            }, note);
        await openMap(LAB);
        expect(await withNote("")).toBe(true);
        expect(await withNote("<shadows: off>")).toBe(false);
        await openMap({ ...LAB, "p.shadows": false });
        expect(await withNote("")).toBe(false);
        expect(await withNote("<shadows: on>")).toBe(true);
    });

    // MZ reloads the map file whenever the menu closes, so this checks the
    // cache is keyed on what is in the map, not on the object holding it.
    test("the distance field is worked out once per map, not on every return from the menu", async ({
        page,
        openMap,
    }) => {
        await openMap(LAB);
        const remember = () => page.evaluate(() => (window.__field = SceneManager._scene._spriteset._lightingLayer._shadowMap.field));
        const same = () => page.evaluate(() => SceneManager._scene._spriteset._lightingLayer._shadowMap.field === window.__field);
        await remember();
        await page.evaluate(() => SceneManager.push(Scene_Menu));
        await stepUntil(page, () => SceneManager._scene instanceof Scene_Menu && SceneManager._scene.isStarted());
        await page.evaluate(() => SceneManager.pop());
        await stepUntil(page, onMap);
        expect(await same()).toBe(true);

        await transfer(page, 1);
        expect(await same()).toBe(false);
    });

    // People1 frames are 48 x 48: it stands 12 px above the bottom of its
    // sprite and casts its outline at the sprite's size.
    test("characters cast from their feet, sized by their sprites", async ({ page, openMap }) => {
        await openMap(LAB);
        const footprint = await page.evaluate(() => {
            const villager = $gameMap.event(3);
            const f = SceneManager._scene._spriteset._lightingLayer.footprintOf(villager);
            return { ...f, id: undefined, screenX: villager.screenX(), screenY: villager.screenY() };
        });
        expect(footprint).toEqual({
            id: undefined,
            x: footprint.screenX,
            y: footprint.screenY - 12,
            r: 12,
            jump: 0,
            w: 48,
            h: 48,
            sw: 48,
            sh: 48,
            screenX: footprint.screenX,
            screenY: footprint.screenY,
        });
    });

    test("a character's shadow takes the outline of the frame it shows", async ({ page, openMap }) => {
        // Two tiles from the villager, with a torch.
        await openMap({ ...LAB, x: 11, y: 8, "p.globalLight": "Night" });
        await command(page, "setPlayerLight", { light: "Torch" });
        await step(page);
        // The villager's frame, read straight from its image, and the
        // outline its shadow was cast with.
        const { alpha, outline, slot } = await page.evaluate(() => {
            const layer = SceneManager._scene._spriteset._lightingLayer;
            const villager = $gameMap.event(3);
            const sprite = SceneManager._scene._spriteset._characterSprites.find((s) => s._character === villager);
            const f = sprite._frame;
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 48;
            const context = canvas.getContext("2d");
            context.drawImage(sprite.bitmap._image, f.x, f.y, 48, 48, 0, 0, 48, 48);
            const pixels = context.getImageData(0, 0, 48, 48).data;
            const footprint = layer._footprints.find((p) => p.id === villager);
            return {
                alpha: [...pixels].filter((_, i) => i % 4 === 3),
                outline: [...layer._outlines.slotData(footprint.slot)],
                slot: footprint.slot,
            };
        });
        expect(slot).toBeGreaterThanOrEqual(0);
        // Inside where the sprite is opaque, outside where it is clear, at
        // the middle of each of its pixels (64 / 48 slot texels a pixel)
        // that is well inside or outside.
        let checked = 0;
        for (let y = 1; y < 47; y++) {
            for (let x = 1; x < 47; x++) {
                const around = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => alpha[(y + dy) * 48 + x + dx] >= 128));
                if (!around.every((a) => a === around[0])) continue;
                const t = outline[Math.floor((y + 0.5) * (64 / 48)) * 64 + Math.floor((x + 0.5) * (64 / 48))];
                expect(t < 255 * (16 / 64) === around[0], `pixel (${x}, ${y})`).toBe(true);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(1000);
    });

    // The villager stands just west of a wall (14, 8), with the player's
    // torch two tiles west of it: its shadow runs east, up to the wall.
    test("characters' shadows fall on the ground, not on the tops of walls", async ({ page, openMap }) => {
        const scene = async (query) => {
            await openMap({ ...LAB, x: 11, y: 8, "p.globalLight": "Night", ...query });
            await command(page, "setPlayerLight", { light: "Torch flicker: off" });
            await step(page, 2);
            const wall = await page.evaluate(() => [$gameMap.adjustX(14) * 48, $gameMap.adjustY(8) * 48]);
            return { wall, frame: await pixels(page) };
        };
        const shadowed = await scene({});
        const plain = await scene({ "p.characterShadows": false });
        const [x0, y0] = shadowed.wall;
        let onWall = 0;
        let elsewhere = 0;
        for (let y = 0; y < plain.frame.height; y++) {
            for (let x = 0; x < plain.frame.width; x++) {
                const p = (y * plain.frame.width + x) * 4;
                const d = Math.max(...[0, 1, 2].map((c) => Math.abs(shadowed.frame.data[p + c] - plain.frame.data[p + c])));
                // Inside the wall's top, clear of the light buffer's blur at
                // its edges.
                const inside = x >= x0 + 4 && x < x0 + 44 && y >= y0 + 4 && y < y0 + 44;
                if (inside) onWall = Math.max(onWall, d);
                else if (d > 8) elsewhere++;
            }
        }
        expect(onWall).toBeLessThanOrEqual(2);
        expect(elsewhere, "the villager still casts a shadow").toBeGreaterThan(200);
    });

    test("<shadow> tags turn a character's shadow off or on, and size it", async ({ page, openMap }) => {
        await openMap(LAB);
        const shadowWith = (note, image) =>
            page.evaluate(
                ([note, image]) => {
                    const villager = $gameMap.event(3);
                    villager.event().note = note;
                    villager.setupPage();
                    villager.setImage(image, 0);
                    return villager.ghShadow();
                },
                [note, image]
            );
        expect(await shadowWith("", "People1")).toEqual({ width: null, height: null });
        expect(await shadowWith("<shadow: off>", "People1")).toBeNull();
        expect(await shadowWith("", "!Door1")).toBeNull(); // objects need a tag
        expect(await shadowWith("<shadow: width: 30 height: 60>", "!Door1")).toEqual({ width: 30, height: 60 });
        expect(await shadowWith("<shadow>", "")).toBeNull(); // nothing to cast it
    });

    test("the player and the party cast shadows unless Character Shadows is off", async ({ page, openMap }) => {
        await openMap(LAB);
        // Gathered on the player, the followers are hidden behind it.
        let { casters } = await lightingState(page);
        expect(casters.map((c) => c.id)).toEqual([3, "player"]);
        await page.evaluate(() => {
            const followers = $gamePlayer.followers().data();
            followers.forEach((follower, i) => follower.locate($gamePlayer.x - 1 - i, $gamePlayer.y));
        });
        await step(page);
        ({ casters } = await lightingState(page));
        expect(casters.map((c) => c.id)).toEqual([3, "player", "follower 0", "follower 1", "follower 2"]);

        await openMap({ ...LAB, "p.characterShadows": false });
        ({ casters } = await lightingState(page));
        expect(casters).toEqual([]);
        expect(await page.evaluate(() => [$gamePlayer.ghShadow(), $gameMap.event(3).ghShadow()])).toEqual([null, null]);
    });
});

test.describe("golden images", () => {
    const maps = {
        tavern: TAVERN,
        temple: { map: 2, x: 11, y: 20, dir: 8 },
    };
    for (const [name, start] of Object.entries(maps)) {
        test(name, async ({ page, openMap }) => {
            const harness = await openMap(start);
            expect(harness.errors).toEqual([]);
            expect(harness.warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
            await expect(page.locator("#gameCanvas")).toHaveScreenshot(`${name}.png`);
        });
    }

    test("shapes", async ({ page, openMap }) => {
        const { warnings } = await openMap({ ...LAB, "p.globalLight": "Night", dir: 4 });
        await command(page, "setPlayerLight", { light: "Flashlight" });
        await command(page, "setEventLight", { eventId: "1", light: "Sunbeam" });
        await command(page, "setEventLight", {
            eventId: "2",
            light: "shape: cone direction: 315 spread: 40 radius: 300 color: #9fd0ff flicker: Pulse",
        });
        await step(page, 2);
        expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
        await expect(page.locator("#gameCanvas")).toHaveScreenshot("shapes.png");
    });

    test("shadows", async ({ page, openMap }) => {
        const { warnings } = await openMap({ ...LAB, x: 6, y: 10, dir: 6, "p.globalLight": "Night", "p.shadowRegions": '["5"]' });
        await command(page, "setEventLight", { eventId: "1", light: "Torch radius: 260" });
        await command(page, "setEventLight", { eventId: "2", light: "Lamp height: 200 radius: 400" });
        await step(page, 2);
        expect(warnings.filter((w) => w.includes("GH_Lighting"))).toEqual([]);
        await expect(page.locator("#gameCanvas")).toHaveScreenshot("shadows.png");
    });
});
