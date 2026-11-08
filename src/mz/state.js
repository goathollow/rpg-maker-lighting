import { createAmbient, resolveAmbient, UNLIT, updateAmbient } from "../core/ambient.js";
import { resolveLight } from "../core/lights.js";
import { findTags, pageCommentText } from "../core/notetags.js";
import { AUTO_SHADOW, resolveShadow } from "../core/shadows.js";
import { warnOnce } from "./warn.js";

// Lighting state lives on objects MZ already saves ($gameSystem, $gameMap,
// events, the player), so it survives save/load with no extra work. Only
// plain colours and the text of commands are saved; resolved lights are
// cached in a WeakMap, which is never saved and is rebuilt after loading.
export function installStateHooks(settings) {
    const lightCache = new WeakMap();
    const shadowCache = new WeakMap();
    const shadowRegions = new Set(settings.shadowRegions);
    const shadowTerrainTags = new Set(settings.shadowTerrainTags);

    //-------------------------------------------------------------------------
    // Global light (whole game) and map ambient

    // Created on first use, which also covers saves made before the plugin
    // was installed.
    Game_System.prototype.ghGlobalLight = function() {
        if (!this._ghGlobalLight) {
            const warn = (msg) => warnOnce(`Global Light parameter: ${msg}`);
            const start = resolveAmbient(settings.globalLight, settings.ambientPresets, warn) ?? UNLIT;
            this._ghGlobalLight = createAmbient(start);
        }
        return this._ghGlobalLight;
    };

    // The map's own <ambient>, or null if it has none (or an unreadable one)
    // and so follows the global light.
    Game_Map.prototype.ghNoteAmbient = function() {
        const [tag] = findTags($dataMap && $dataMap.note, "ambient");
        if (tag === undefined) return null;
        const warn = (msg) => warnOnce(`Map ${this.mapId()}: ${msg}`);
        return resolveAmbient(tag, settings.ambientPresets, warn);
    };

    Game_Map.prototype.ghAmbient = function() {
        if (!this._ghAmbient) {
            this._ghAmbient = createAmbient(this.ghNoteAmbient(), $gameSystem.ghGlobalLight().color);
        }
        return this._ghAmbient;
    };

    // Every map starts from its own <ambient> or the global light; command
    // changes to a map's ambient do not carry over to the next map.
    const setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function(mapId) {
        setup.call(this, mapId);
        this._ghAmbient = createAmbient(this.ghNoteAmbient(), $gameSystem.ghGlobalLight().color);
    };

    // The global light first, so a map following it moves in the same frame.
    const update = Game_Map.prototype.update;
    Game_Map.prototype.update = function(sceneActive) {
        update.call(this, sceneActive);
        const global = $gameSystem.ghGlobalLight();
        updateAmbient(global);
        updateAmbient(this.ghAmbient(), global.color);
        this._ghFrames = (this._ghFrames || 0) + 1;
    };

    // Seconds of map time, which drives flicker. Counted here rather than
    // taken from Graphics.frameCount, which includes loading screens, so
    // flicker is the same on every run; it pauses in menus and is saved.
    Game_Map.prototype.ghLightTime = function() {
        return (this._ghFrames || 0) / 60;
    };

    //-------------------------------------------------------------------------
    // Lights on characters

    Game_CharacterBase.prototype.ghLight = function() {
        if (!lightCache.has(this)) lightCache.set(this, this.ghComputeLight());
        return lightCache.get(this);
    };

    // Text from a plugin command, overriding notetags; undefined to clear.
    // Resolved straight away so a typo is reported when the command runs,
    // not later when the map happens to be dark.
    Game_CharacterBase.prototype.ghSetLight = function(text) {
        this._ghLightCommand = text;
        lightCache.delete(this);
        this.ghLight();
    };

    Game_CharacterBase.prototype.ghComputeLight = function() {
        return null;
    };

    // Flicker seed for a light with no seed of its own, so that every
    // event's light flickers differently.
    Game_CharacterBase.prototype.ghLightSeed = function() {
        return 0;
    };

    Game_Event.prototype.ghLightSeed = function() {
        return this._mapId * 1000 + this._eventId;
    };

    // Which text decides an event's light, first match wins:
    //   1. no active page (erased, or no page's conditions met): no light
    //   2. a Set Event Light command
    //   3. a <light> comment on the active page, so switches and self
    //      switches can turn lights on and off through page conditions
    //   4. a <light> tag in the event's note
    Game_Event.prototype.ghLightText = function() {
        const page = this.page();
        if (!page) return null;
        if (this._ghLightCommand !== undefined) return this._ghLightCommand;
        const [fromPage] = findTags(pageCommentText(page.list), "light");
        if (fromPage !== undefined) return fromPage;
        const [fromNote] = findTags(this.event().note, "light");
        return fromNote ?? null;
    };

    Game_Event.prototype.ghComputeLight = function() {
        const text = this.ghLightText();
        if (text === null) return null;
        const where = `Map ${$gameMap.mapId()}, event ${this.eventId()} (${this.event().name})`;
        const warn = (msg) => warnOnce(`${where}: ${msg}`);
        return resolveLight(text, settings.lightPresets, warn, settings.flickerPresets);
    };

    const setupPage = Game_Event.prototype.setupPage;
    Game_Event.prototype.setupPage = function() {
        setupPage.call(this);
        lightCache.delete(this);
        shadowCache.delete(this);
    };

    Game_Player.prototype.ghComputeLight = function() {
        const text = this._ghLightCommand ?? settings.playerLight;
        if (!text) return null;
        const warn = (msg) => warnOnce(`Player light: ${msg}`);
        return resolveLight(text, settings.lightPresets, warn, settings.flickerPresets);
    };

    //-------------------------------------------------------------------------
    // Shadows

    // Whether shadows are on for this map: the Shadows parameter, unless the
    // map's note says <shadows: on> or <shadows: off>.
    Game_Map.prototype.ghShadowsOn = function() {
        const [tag] = findTags($dataMap && $dataMap.note, "shadows");
        if (tag === undefined) return settings.shadows;
        if (/^(on|yes|true)$/i.test(tag)) return true;
        if (/^(off|no|none|false)$/i.test(tag)) return false;
        warnOnce(`Map ${this.mapId()}: can't read <shadows: ${tag}>; use on or off`);
        return settings.shadows;
    };

    // Whether tile (x, y) blocks light: tops of walls (A4) and roofs (A3),
    // which are where walls stand rather than their fronts, plus tiles
    // painted with a Shadow Region or tagged with a Shadow Terrain Tag.
    // Read once when the map is shown, so a plugin that changes tiles on
    // the fly should rebuild the spriteset.
    Game_Map.prototype.ghCastsShadow = function(x, y) {
        if (settings.wallShadows) {
            for (let z = 0; z < 2; z++) {
                const tileId = this.tileId(x, y, z);
                if (Tilemap.isWallTopTile(tileId) || Tilemap.isRoofTile(tileId)) return true;
            }
        }
        if (shadowRegions.has(this.regionId(x, y))) return true;
        return shadowTerrainTags.size > 0 && shadowTerrainTags.has(this.terrainTag(x, y));
    };

    // A character's shadow, { width, height } in pixels (null for "from the
    // sprite"), or null for none.
    Game_CharacterBase.prototype.ghShadow = function() {
        return null;
    };

    // Walking characters cast shadows by themselves; objects ("!" files)
    // and tile graphics only with a <shadow> tag.
    const isCharacterSprite = (character) => {
        const name = character.characterName();
        return character.tileId() === 0 && name !== "" && !ImageManager.isObjectCharacter(name);
    };
    const autoShadow = (character) =>
        settings.characterShadows && !character.isTransparent() && isCharacterSprite(character) ? AUTO_SHADOW : null;

    Game_Player.prototype.ghShadow = function() {
        return autoShadow(this);
    };

    Game_Follower.prototype.ghShadow = function() {
        return this.isVisible() ? autoShadow(this) : null;
    };

    // An event's <shadow> tag, from a comment on the active page or else its
    // note, as for lights: a shadow, null for <shadow: off>, or undefined
    // with no tag.
    Game_Event.prototype.ghShadowTag = function() {
        const page = this.page();
        const [fromPage] = page ? findTags(pageCommentText(page.list), "shadow") : [];
        const [fromNote] = findTags(this.event().note, "shadow");
        const text = fromPage ?? fromNote;
        if (text === undefined) return undefined;
        const where = `Map ${$gameMap.mapId()}, event ${this.eventId()} (${this.event().name})`;
        return resolveShadow(text, (msg) => warnOnce(`${where}: ${msg}`));
    };

    Game_Event.prototype.ghShadow = function() {
        if (!this.page() || this.isTransparent()) return null;
        if (!shadowCache.has(this)) shadowCache.set(this, this.ghShadowTag());
        const tag = shadowCache.get(this);
        if (tag === null) return null;
        if (tag) return this.characterName() || this.tileId() ? tag : null;
        return autoShadow(this);
    };
}
