// Smoke test in the runtime desktop players actually use: the NW.js build
// that ships with RPG Maker MZ, driven through its bundled chromedriver.
// Boots the test project into a map via the harness and fails on any error.
// Opens a real game window for a few seconds.
//
//   node tools/nwjs-smoke.mjs [map=1] [x=9] [y=8] [harness options...]
//   node tools/nwjs-smoke.mjs 3 9 8 dir=4 p.globalLight=Night p.playerLight=Flashlight
//   MZ_PATH="D:/Games/RPG Maker MZ" node tools/nwjs-smoke.mjs
//   node tools/nwjs-smoke.mjs --surfaces
//
// --surfaces play-tests (MZ's "test" flag) and then puts normal and AO maps
// on screen: the test tileset, and the player in Lab_People, by a torch at
// night. It fails unless the plugin read the image folders and saved the
// list of maps (the same one the build writes), or on any console error,
// such as a shader this GPU would not compile.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLUGIN_NAME } from "../src/config.js";
import { MANIFEST_FILE } from "../src/core/surfaces.js";
import { TEST_TILESET_NAME } from "./make-test-maps.mjs";

const DEFAULT_MZ_PATH = "C:/Program Files (x86)/Steam/steamapps/common/RPG Maker MZ";
const mzPath = process.env.MZ_PATH ?? DEFAULT_MZ_PATH;
const surfaces = process.argv.includes("--surfaces");
const [map = "1", x = "9", y = "8", ...options] = process.argv.slice(2).filter((a) => a !== "--surfaces");
const query = new URLSearchParams({ harness: "", map, x, y });
for (const option of options) {
    const [key, ...value] = option.split("=");
    query.set(key, value.join("="));
}
const PORT = 9516;
const driverUrl = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The build's list of maps, put back afterwards whatever happens; the
// play-test has to save it again from scratch.
const manifestFile = join("testproject", MANIFEST_FILE);
const builtManifest = surfaces && existsSync(manifestFile) ? readFileSync(manifestFile, "utf8") : null;

async function call(method, path, body) {
    if (process.env.SMOKE_VERBOSE) console.log(`> ${method} ${path.replace(/^\/session\/[^/]+/, "")}`);
    const res = await fetch(driverUrl + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body && JSON.stringify(body),
    });
    const json = await res.json();
    if (json.value && json.value.error) throw new Error(`${json.value.error}: ${json.value.message}`);
    return json.value;
}

const driver = spawn(join(mzPath, "nwjs-win", "chromedriver.exe"), [`--port=${PORT}`], { stdio: "ignore" });
let session;
try {
    for (let i = 0; ; i++) {
        try {
            if ((await call("GET", "/status")).ready) break;
        } catch {}
        if (i > 50) throw new Error("chromedriver did not start");
        await sleep(100);
    }

    // Chromium stops rendering windows that Windows reports as covered or
    // hidden (another window on top, a locked screen, a sleeping monitor),
    // and the game would never start. These switches keep it running.
    const args = [
        `nwapp=${resolve("testproject")}`,
        "--disable-features=CalculateNativeWinOcclusion",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
    ];
    const created = await call("POST", "/session", {
        capabilities: { alwaysMatch: { "goog:chromeOptions": { args } } },
    });
    session = created.sessionId;
    const script = (src) => call("POST", `/session/${session}/execute/sync`, { script: src, args: [] });

    const waitReady = async () => {
        let harness;
        const deadline = Date.now() + 60_000;
        do {
            await sleep(250);
            harness = await script("return window.__harness || null;");
        } while (!(harness && (harness.ready || harness.errors.length)) && Date.now() < deadline);
        return harness;
    };

    if (surfaces) rmSync(manifestFile, { force: true });
    const appUrl = (await call("GET", `/session/${session}/url`)).split("?")[0];
    await call("POST", `/session/${session}/url`, { url: `${appUrl}?${query}${surfaces ? "&test" : ""}` });
    const harness = await waitReady();

    const info = await script(
        `return { nw: process.versions.nw, chromium: process.versions.chromium,
                  plugin: window["${PLUGIN_NAME}"] && window["${PLUGIN_NAME}"].version,
                  visibility: document.visibilityState,
                  scene: SceneManager._scene && SceneManager._scene.constructor.name,
                  frameCount: Graphics.frameCount };`
    );
    if (!harness || !harness.ready) {
        console.log("Stalled:", JSON.stringify({ harness, ...info }));
    }
    mkdirSync("test-results", { recursive: true });
    const shot = await call("GET", `/session/${session}/screenshot`);
    writeFileSync("test-results/nwjs-smoke.png", Buffer.from(shot, "base64"));

    console.log(`NW.js ${info.nw} (Chromium ${info.chromium}), ${PLUGIN_NAME} ${info.plugin ?? "NOT LOADED"}`);
    if (!harness || !harness.ready) throw new Error("harness never became ready");
    if (harness.errors.length) throw new Error("game errors:\n" + harness.errors.join("\n"));
    if (!info.plugin) throw new Error(`${PLUGIN_NAME} did not load`);
    console.log(`OK: map ${map} rendered with WebGL ${harness.webglVersion}; screenshot in test-results/nwjs-smoke.png`);

    if (surfaces) {
        const saved = existsSync(manifestFile) ? readFileSync(manifestFile, "utf8") : null;
        if (saved === null) throw new Error(`the play-test did not save ${MANIFEST_FILE}`);
        if (builtManifest !== null && saved !== builtManifest) {
            throw new Error(`the play-test saved a different ${MANIFEST_FILE} from the build's:\n${saved}`);
        }
        await script(`
            window.__smokeLogs = [];
            for (const level of ["error", "warn"]) {
                const original = console[level];
                console[level] = function(...args) {
                    window.__smokeLogs.push(level + ": " + args.join(" "));
                    return original.apply(this, args);
                };
            }
            $gameMap.changeTileset($dataTilesets.findIndex((t) => t && t.name === ${JSON.stringify(TEST_TILESET_NAME)}));
            $gamePlayer.setImage("Lab_People", 0);
            const run = (name, args) => {
                const interpreter = new Game_Interpreter();
                interpreter.setup([], 0);
                PluginManager.callCommand(interpreter, "${PLUGIN_NAME}", name, args);
            };
            run("setAmbient", { color: "Night", duration: "0" });
            run("setPlayerLight", { light: "Torch flicker: off" });
            window.__harnessStep(30);
            return true;`);
        await waitReady();
        const state = await script(`
            const s = SceneManager._scene._spriteset._lightingLayer._surfaces;
            return { active: s.active, tiles: s._tileset.hasData, flags: s._items.map((i) => i.flags),
                     logs: window.__smokeLogs, errors: window.__harness.errors };`);
        const surfaceShot = await call("GET", `/session/${session}/screenshot`);
        writeFileSync("test-results/nwjs-smoke-surfaces.png", Buffer.from(surfaceShot, "base64"));
        for (const log of state.logs) console.log(`  ${log}`);
        if (state.errors.length) throw new Error("game errors:\n" + state.errors.join("\n"));
        if (state.logs.some((log) => log.startsWith("error") || log.includes(PLUGIN_NAME))) {
            throw new Error("errors or plugin warnings in the console (above)");
        }
        if (!state.active || !state.tiles || !state.flags.includes(3)) {
            throw new Error(`normal and AO maps are not drawn: ${JSON.stringify(state)}`);
        }
        console.log("OK: normal and AO maps found, listed and drawn; screenshot in test-results/nwjs-smoke-surfaces.png");
    }
} catch (e) {
    console.error(`FAIL: ${e.message}`);
    process.exitCode = 1;
} finally {
    if (session) await call("DELETE", `/session/${session}`).catch(() => {});
    driver.kill();
    if (builtManifest !== null) writeFileSync(manifestFile, builtManifest);
}
