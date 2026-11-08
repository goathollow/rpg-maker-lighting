import os from "node:os";
import { test as base, expect } from "@playwright/test";
import { PLUGIN_NAME } from "../../src/config.js";

export { expect, PLUGIN_NAME };

// MZ's default starting party: Reid, Michelle, Kasey and Eliot (Actor1).
export const RTP_PARTY = "1,4,6,7";
// The test project's starting party: the eight AcademyStudents, actors 9-16,
// whose sheet has hand-made normal and AO maps.
export const ACADEMY_PARTY = "9,10,11,12,13,14,15,16";

// The test run is below normal priority (playwright.config.js) and browsers
// inherit that, except Chrome's GPU process, which raises itself above normal
// on Windows. With software WebGL that process does all the rendering, so it
// would starve everything else on the machine. It exists once a page does.
async function lowerGpuPriority(browser) {
    try {
        const session = await browser.newBrowserCDPSession();
        const { processInfo } = await session.send("SystemInfo.getProcessInfo");
        await session.detach();
        for (const p of processInfo) {
            if (p.type === "GPU") os.setPriority(p.id, os.constants.priority.PRIORITY_BELOW_NORMAL);
        }
    } catch {
        // Not allowed here: leave the priority as it is.
    }
}

export const test = base.extend({
    page: async ({ page, browser }, use) => {
        await lowerGpuPriority(browser);
        await use(page);
    },

    // Extra harness URL options for a whole project, e.g. { webgl1: "" }.
    harnessQuery: [{}, { option: true }],

    // openMap({ map: 1, x: 9, y: 8 }) boots the test project straight into a
    // map, waits until the harness has frozen a rendered frame, and returns
    // the harness state, uncaught page errors and console warnings (the last
    // two keep filling as the test runs).
    //
    // Tests start with the RTP party the golden images were drawn with
    // (RTP_PARTY), not the project's own, the AcademyStudents set: that has
    // normal maps, which would put every map on the surface path. Pass
    // `party` to start with others. Max Brightness is the plugin's default
    // (1.25), not the project's 2, which is there for the showcase maps.
    openMap: async ({ page, harnessQuery }, use) => {
        const pageErrors = [];
        const warnings = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        page.on("console", (m) => {
            if (m.type() === "warning") warnings.push(m.text());
        });

        await use(async (options = {}, target = page) => {
            const query = new URLSearchParams({ harness: "", party: RTP_PARTY, "p.maxBrightness": 1.25, ...harnessQuery });
            for (const [key, value] of Object.entries(options)) query.set(key, String(value));
            await target.goto(`/index.html?${query}`);
            await waitReady(target);
            const harness = await target.evaluate(() => ({ ...window.__harness }));
            return { ...harness, pageErrors, warnings };
        });
    },
});

const waitReady = (page) =>
    page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 60_000 });

// Runs n more game frames, then waits for the harness to freeze again.
export async function step(page, frames = 1) {
    await page.evaluate((n) => window.__harnessStep(n), frames);
    await waitReady(page);
}

// Steps until `predicate` (run in the page) is true, e.g. a scene change.
export async function stepUntil(page, predicate, maxFrames = 600) {
    for (let frames = 0; frames < maxFrames; frames += 5) {
        if (await page.evaluate(predicate)) return;
        await step(page, 5);
    }
    throw new Error(`stepUntil: still false after ${maxFrames} frames: ${predicate}`);
}

// Runs one of the plugin's commands the way an event would, with string args.
export const command = (page, name, args = {}, eventId = 0) =>
    page.evaluate(
        ([plugin, name, args, eventId]) => {
            const interpreter = new Game_Interpreter();
            interpreter.setup([], eventId);
            PluginManager.callCommand(interpreter, plugin, name, args);
        },
        [PLUGIN_NAME, name, args, eventId]
    );

// Serves an empty file in place of the plugin, giving a true "not installed"
// baseline without touching plugins.js.
export async function withoutPlugin(page) {
    await page.route(`**/js/plugins/${PLUGIN_NAME}.js`, (route) =>
        route.fulfill({ contentType: "text/javascript", body: "" })
    );
}

export const snapHash = (page) => page.evaluate(() => window.__harnessSnapHash());

// What the lighting layer should be drawing, read from the game: the map's
// ambient, Max Brightness, the light buffer's resolution and margin, the
// flicker clock of the last frame drawn, and
// each light where it lands on screen, with its colour times its intensity,
// its shape, its direction setting, its character's facing and its shadow
// settings. For shadows: the map's casting tiles (null with shadows off),
// how far the map was scrolled, and every character's shadow caster, as
// the layer placed them for that frame, with the outline it cast (null if
// no light needed it). With surfaces, the range the frame's light weights
// were divided by.
export const lightingState = (page) =>
    page.evaluate((plugin) => {
        const idOf = (character) => {
            if (character === $gamePlayer) return "player";
            if (character instanceof Game_Event) return character.eventId();
            return `follower ${$gamePlayer.followers().data().indexOf(character)}`;
        };
        const lights = [];
        const add = (character, id) => {
            const light = character.ghLight();
            if (!light) return;
            lights.push({
                id,
                x: character.screenX() + light.offsetX,
                y: character.screenY() - $gameMap.tileHeight() / 2 + light.offsetY,
                radius: light.radius,
                color: light.color.map((c) => c * light.intensity),
                shape: light.shape,
                spread: light.spread,
                width: light.width,
                direction: light.direction,
                facing: character.direction(),
                flicker: light.flicker,
                seed: light.seed ?? character.ghLightSeed(),
                shadows: light.shadows,
                softness: light.softness,
                height: light.height,
                ground: [character.screenX(), character.screenY() + character.jumpHeight()],
            });
        };
        for (const event of $gameMap.events()) add(event, event.eventId());
        if (!$gamePlayer.isTransparent()) add($gamePlayer, "player");
        const layer = SceneManager._scene._spriteset._lightingLayer;
        const shadowMap = layer._shadowMap;
        return {
            ambient: $gameMap.ghAmbient().color,
            cap: window[plugin].settings.maxBrightness,
            resolution: window[plugin].settings.lightResolution,
            margin: -layer._view.left,
            time: layer._time,
            lights,
            tile: $gameMap.tileWidth(),
            display: [...layer._display],
            casterTiles: shadowMap && { ...shadowMap.map, grid: [...shadowMap.map.grid] },
            maxCasters: layer._maxCasters,
            weightRange: layer._weightRange,
            casters: layer._footprints.map((f) => ({
                ...f,
                id: idOf(f.id),
                outline: f.slot >= 0 ? [...layer._outlines.slotData(f.slot)] : null,
            })),
        };
    }, PLUGIN_NAME);

// The scene's pixels at game resolution: { width, height, data: RGBA bytes }.
export async function pixels(page) {
    const { base64, width, height } = await page.evaluate(() => ({
        base64: window.__harnessPixels(),
        width: Graphics.width,
        height: Graphics.height,
    }));
    return { width, height, data: new Uint8Array(Buffer.from(base64, "base64")) };
}
