import { command, expect, lightingState, pixels, PLUGIN_NAME, snapHash, step, test, withoutPlugin } from "./fixtures.js";

const TAVERN = { map: 1, x: 9, y: 8 };
// Same layout, no ambient, and only invisible events that carry lights.
const LAB = { map: 3, x: 9, y: 8 };

test("plugin loads into a map without errors", async ({ page, openMap }) => {
    const harness = await openMap(TAVERN);
    expect(harness.errors).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
    const plugin = await page.evaluate((name) => window[name] && window[name].version, PLUGIN_NAME);
    expect(plugin).toMatch(/^\d+\.\d+\.\d+$/);
});

test("renders with the WebGL version the project asks for", async ({ openMap }, testInfo) => {
    const harness = await openMap(TAVERN);
    // PIXI 5 picks WebGL 1 on every mobile device, so phones always take the
    // WebGL 1 path, as does the project that forces it on desktop.
    const forced = "webgl1" in (testInfo.project.use.harnessQuery ?? {});
    const expected = forced || testInfo.project.use.isMobile ? 1 : 2;
    expect(harness.webglVersion).toBe(expected);
});

test("lighting layer covers tiles and characters but not weather", async ({ page, openMap }) => {
    await openMap(TAVERN);
    const layout = await page.evaluate(() => {
        const spriteset = SceneManager._scene._spriteset;
        const base = spriteset._baseSprite;
        return {
            lighting: base.children.indexOf(spriteset._lightingLayer),
            tilemap: base.children.indexOf(spriteset._tilemap),
            last: base.children.length - 1,
            weatherAboveBase:
                spriteset.children.indexOf(spriteset._weather) > spriteset.children.indexOf(base),
        };
    });
    expect(layout.lighting).toBe(layout.last);
    expect(layout.lighting).toBeGreaterThan(layout.tilemap);
    expect(layout.weatherAboveBase).toBe(true);
});

// The lab's lights have intensity 1, as bright as full daylight, so they
// fade out completely.
test("a fully lit map with daylight-strength lights looks the same as without the plugin", async ({
    page,
    openMap,
}) => {
    await openMap(LAB);
    const withPlugin = await snapHash(page);

    const bare = await page.context().newPage();
    await withoutPlugin(bare);
    await openMap(LAB, bare);
    expect(await snapHash(bare)).toBe(withPlugin);
});

// A light brighter than daylight brightens the map around it, but every
// pixel out of its reach, faded-out lights included, must be untouched to
// the last bit.
test("a light brighter than daylight changes nothing out of its reach", async ({ page, openMap }) => {
    await openMap(LAB);
    await command(page, "setPlayerLight", { light: "Lamp intensity: 1.5" });
    await step(page);
    const lit = await pixels(page);
    const { ambient, lights: all } = await lightingState(page);
    const lights = all.filter((l) => l.color.some((c, i) => c > ambient[i]));
    expect(lights.map((l) => l.id)).toEqual(["player"]);

    const bare = await page.context().newPage();
    await withoutPlugin(bare);
    await openMap(LAB, bare);
    const unlit = await pixels(bare);

    // The light buffer is drawn at reduced resolution and filtered, so allow
    // a few pixels of spill past each radius.
    const SPILL = 4;
    const changedOutside = [];
    let changedInside = 0;
    for (let y = 0; y < lit.height; y++) {
        for (let x = 0; x < lit.width; x++) {
            const i = (y * lit.width + x) * 4;
            const same = lit.data[i] === unlit.data[i] && lit.data[i + 1] === unlit.data[i + 1] &&
                lit.data[i + 2] === unlit.data[i + 2];
            const inReach = lights.some((l) => Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y) < l.radius + SPILL);
            if (inReach) changedInside += same ? 0 : 1;
            else if (!same) changedOutside.push(`(${x},${y})`);
        }
    }
    expect(changedOutside.slice(0, 8), `${changedOutside.length} pixels changed`).toEqual([]);
    expect(changedInside).toBeGreaterThan(5000);
});
