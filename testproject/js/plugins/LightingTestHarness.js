/*:
 * @target MZ
 * @plugindesc [Test only] Boots straight into a map for automated tests.
 * @author Goat Hollow Games
 *
 * @help LightingTestHarness.js
 *
 * Does nothing unless the page URL contains "harness", so it is safe to leave
 * enabled while play-testing from the editor. The Playwright suite opens
 * index.html?harness&map=1&... and waits for window.__harness.ready.
 *
 * URL options:
 *   harness           enable the harness
 *   map, x, y, dir    start position (defaults: the System start position)
 *   frames=N          game frames to run before freezing (default 60)
 *   webgl1            force a WebGL 1 context, like older phones
 *   hideplayer        make the player and followers invisible
 *   party=1,4,6,7     start with these actors instead of the System party
 *   touchui           keep the touch menu button (hidden by default)
 *   p.NAME=VALUE      override GH_Lighting's NAME parameter, e.g.
 *                     p.maxBrightness=1. Works because this plugin is
 *                     listed, and so runs, before GH_Lighting.
 *
 * Once frozen, the game loop stops with the last frame left on screen, so
 * screenshots taken at any point after "ready" are identical.
 *
 * Test API (from page.evaluate):
 *   __harnessStep(n)    run n more frames of any scene, then freeze again
 *                       (wait for __harness.ready)
 *   __harnessPixels()   the current scene's RGBA pixels, base64-encoded
 *   __harnessSnapHash() a hash of those pixels
 */

(() => {
    "use strict";

    const query = new URLSearchParams(location.search);
    if (!query.has("harness")) return;

    const num = (key, fallback) => {
        const n = Number(query.get(key));
        return query.has(key) && Number.isFinite(n) ? n : fallback;
    };

    const state = { ready: false, frame: 0, errors: [], webglVersion: 0 };
    window.__harness = state;
    const freezeAt = num("frames", 60);
    let frozen = false;
    // Frames left to run after __harnessStep(); null until the first freeze.
    let budget = null;

    if (query.has("webgl1")) {
        PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL;
    }

    const overrides = [...query].filter(([key]) => key.startsWith("p."));
    if (overrides.length) {
        const params = { ...PluginManager.parameters("GH_Lighting") };
        for (const [key, value] of overrides) params[key.slice(2)] = value;
        PluginManager.setParameters("GH_Lighting", params);
    }

    // Exactly one game update per rendered frame, and keep updating without
    // window focus, so the state after N frames is the same on every machine.
    SceneManager.determineRepeatNumber = () => 1;
    SceneManager.isGameActive = () => true;

    const catchException = SceneManager.catchException;
    SceneManager.catchException = function(e) {
        state.errors.push(String((e && e.stack) || e));
        catchException.call(this, e);
    };

    Scene_Boot.prototype.startNormalGame = function() {
        this.checkPlayerLocation();
        DataManager.setupNewGame();
        if (query.has("party")) {
            const ids = query.get("party").split(",").map(Number);
            $gameParty._actors = ids.filter((id) => $gameActors.actor(id));
        }
        WebAudio.setMasterVolume(0);
        // The touch menu button is drawn over the map and would show up in
        // every pixel comparison.
        ConfigManager.touchUI = query.has("touchui");
        const sys = $dataSystem;
        $gamePlayer.reserveTransfer(
            num("map", sys.startMapId),
            num("x", sys.startX),
            num("y", sys.startY),
            num("dir", 2),
            0
        );
        if (query.has("hideplayer")) $gamePlayer.setTransparent(true);
        SceneManager.goto(Scene_Map);
    };

    const updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function() {
        if (frozen) return;
        updateMain.call(this);
        if (budget !== null && --budget <= 0) frozen = true;
    };

    // The first freeze counts map frames, so boot and loading time do not
    // matter; later steps count frames of whatever scene is running.
    const mapUpdate = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        mapUpdate.call(this);
        state.frame++;
        if (budget === null && state.frame >= freezeAt) frozen = true;
    };

    window.__harnessStep = (n = 1) => {
        budget = Math.max(1, n);
        frozen = false;
        state.ready = false;
        Graphics.startGameLoop();
    };

    // Ready only after the frozen frame has actually been drawn. Stopping the
    // loop there keeps that frame on screen and frees the CPU, which matters
    // when several software-rendered test pages run in parallel.
    const onTick = Graphics._onTick;
    Graphics._onTick = function(deltaTime) {
        onTick.call(this, deltaTime);
        if (frozen && !state.ready) {
            Graphics.stopGameLoop();
            state.webglVersion = Graphics.app.renderer.context.webGLVersion;
            state.ready = true;
        }
    };

    // The current scene rendered off-screen, at game resolution whatever the
    // window or device size.
    const snapPixels = () => {
        const bitmap = Bitmap.snap(SceneManager._scene);
        const data = bitmap.context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        bitmap.destroy();
        return data;
    };

    window.__harnessPixels = () => {
        const data = snapPixels();
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
        }
        return btoa(binary);
    };

    // FNV-1a hash of the scene's pixels. Lets tests assert that two setups
    // produce exactly the same image.
    window.__harnessSnapHash = () => {
        const data = snapPixels();
        let h = 0x811c9dc5;
        for (let i = 0; i < data.length; i++) {
            h = Math.imul(h ^ data[i], 0x01000193);
        }
        return (h >>> 0).toString(16).padStart(8, "0");
    };
})();
