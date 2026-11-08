import { isUnlit } from "../core/ambient.js";
import { colorToTint } from "../core/color.js";
import { flicker, isFlickering } from "../core/flicker.js";
import { lightBufferScale, lightOverAmbient } from "../core/lights.js";
import { lightClear, MAX_CASTERS, pickCasters } from "../core/shadows.js";
import { weightRange } from "../core/surfaces.js";
import { coneEdges, lightAngle, lightBox, lightReach, turnToward } from "../core/shapes.js";
import { OutlineAtlas } from "./OutlineAtlas.js";
import { ShadowMap } from "./ShadowMap.js";
import { SurfaceBuffer } from "./SurfaceBuffer.js";
import { BRIGHTEN_FRAGMENT, COMPOSITE_VERTEX, DARKEN_FRAGMENT, LIGHT_VERTEX, lightFragmentFor } from "./shaders.js";
import {
    BRIGHTEN_SURFACE_FRAGMENT,
    DARKEN_SURFACE_FRAGMENT,
    SHADING_VERTEX,
    shadingFragmentFor,
} from "./surfaceShaders.js";

// Extra light buffer beyond each screen edge, so a screen shake never
// reveals an unlit strip.
const MARGIN = 48;

// How fast a light that follows its character's facing turns, in degrees
// per frame: a quarter turn takes 6 frames instead of snapping.
export const TURN_SPEED = 15;

// Blends PIXI does not have, registered at indices it leaves free. Both keep
// the destination's alpha.
//   DARKEN    result = dst * src
//   BRIGHTEN  result = dst * src + dst = dst * (1 + src)
const DARKEN = 100;
const BRIGHTEN = 101;

// PIXI rebuilds its blend table when a lost WebGL context comes back (common
// when a phone app is sent to the background), so this runs every frame.
function registerBlendModes(renderer) {
    const modes = renderer.state.blendModes;
    if (!modes[DARKEN]) {
        const gl = renderer.gl;
        modes[DARKEN] = [gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE];
        modes[BRIGHTEN] = [gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE];
    }
}

// How many characters can shadow one light. The shadowed shaders use about
// a dozen uniform vectors besides two per character; WebGL only promises
// 16, though nearly every device has 64 or more.
function casterCapacity(renderer) {
    const gl = renderer.gl;
    const vectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
    if (vectors >= 12 + MAX_CASTERS * 2) return MAX_CASTERS;
    return vectors >= 20 ? 4 : 0;
}

// Builds a light buffer each frame and applies it to everything below:
//
//   1. fill the buffer with the ambient colour
//   2. add each light on top (additive blend, one quad per light, fitted to
//      its shape), darkened where walls or characters block it
//   3. darken the map where the light is below 1, then brighten it where
//      the light is above 1, up to Max Brightness
//
// Steps 1-2 happen in refresh(), outside PIXI's main render pass, because
// rendering to a texture in the middle of that pass would break the base
// sprite's filter. Each step-3 pass is skipped when it would do nothing:
// darken when the ambient is white, brighten when Max Brightness is 1 or no
// light is on screen. With both skipped the whole layer is hidden, so unlit
// maps cost nothing and look exactly as without the plugin.
//
// A light adds only what it has above the ambient (lightOverAmbient), so
// lights fade out as the ambient rises to their brightness, and lights that
// add nothing are skipped altogether. Flicker scales what a light adds, so a
// torch that has faded out by day does not flicker either.
//
// Shadows (src/core/shadows.js) are worked out in the light's own shader,
// so they cost no extra passes. A light with nothing near it that could
// cast a shadow uses the plain shader, so open ground costs no more than
// before. Characters' shadows take the shape of the frames they show, from
// outlines made as lights first need them (OutlineAtlas).
//
// When something on screen has normal or AO maps (src/core/surfaces.js),
// the frame is built differently, so the maps stay sharp at any Light
// Quality while shadows keep costing what they did:
//
//   1. the surface buffer: every pixel's normal and AO (SurfaceBuffer)
//   2. the light buffer, at Light Quality: per texel, how much of the
//      lights gets past shadows, out of how much would without them
//   3. the shading buffer, at full resolution: each light without shadows,
//      shaded by the surface it falls on
//   4. darken and brighten as before, by
//      ambient + shading * (the share from 2) * AO
//
// The share is exact where one light reaches, and where overlapping lights
// are shadowed alike. Flat surfaces with no AO look as they would without
// maps, and the ambient lights everything as it would without them: by day,
// with no lights, the maps change nothing.
export class LightingLayer extends PIXI.Container {
    constructor(settings) {
        super();
        this.name = "LightingLayer";
        const width = Graphics.width + MARGIN * 2;
        const height = Graphics.height + MARGIN * 2;
        this._view = {
            left: -MARGIN,
            top: -MARGIN,
            right: Graphics.width + MARGIN,
            bottom: Graphics.height + MARGIN,
        };
        this._scale = lightBufferScale(settings.maxBrightness);
        this._overbright = settings.maxBrightness > 1;

        this._buffer = PIXI.RenderTexture.create({ width, height, resolution: settings.lightResolution });

        // What gets drawn into the buffer, in screen coordinates. The weight
        // and shading scenes are steps 2 and 3 for maps with surfaces.
        this._lightScene = new PIXI.Container();
        this._lightScene.position.set(MARGIN, MARGIN);
        this._weightScene = new PIXI.Container();
        this._weightScene.position.set(MARGIN, MARGIN);
        this._shadingScene = new PIXI.Container();
        this._shadingScene.position.set(MARGIN, MARGIN);
        this._scenes = { color: this._lightScene, weight: this._weightScene, shading: this._shadingScene };
        this._ambientSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        this._ambientSprite.position.set(-MARGIN, -MARGIN);
        this._ambientSprite.width = width;
        this._ambientSprite.height = height;
        this._lightScene.addChild(this._ambientSprite);

        this._quad = new PIXI.Geometry()
            .addAttribute("aVertexPosition", [-1, -1, 1, -1, 1, 1, -1, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        // Meshes are reused from frame to frame, one pool per shape, with
        // and without shadows.
        this._pools = new Map();
        this._shadowMap = ShadowMap.forCurrentMap(settings);
        this._maxCasters = this._shadowMap && settings.characterShadows ? casterCapacity(Graphics.app.renderer) : 0;
        this._outlines = this._maxCasters > 0 ? new OutlineAtlas() : null;
        this._footprints = [];
        // This frame's footprints and character sprites, by character.
        this._footprintOf = new Map();
        this._spriteOf = new Map();
        this._display = [0, 0];

        const right = Graphics.width + MARGIN;
        const bottom = Graphics.height + MARGIN;
        const screenQuad = new PIXI.Geometry()
            .addAttribute("aVertexPosition", [-MARGIN, -MARGIN, right, -MARGIN, right, bottom, -MARGIN, bottom], 2)
            .addAttribute("aTextureCoord", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const uniforms = { uSampler: this._buffer, uScale: this._scale, uCap: settings.maxBrightness };
        this._darken = new PIXI.Mesh(screenQuad, PIXI.Shader.from(COMPOSITE_VERTEX, DARKEN_FRAGMENT, { ...uniforms }));
        this._darken.blendMode = DARKEN;
        this._brighten = new PIXI.Mesh(screenQuad, PIXI.Shader.from(COMPOSITE_VERTEX, BRIGHTEN_FRAGMENT, { ...uniforms }));
        this._brighten.blendMode = BRIGHTEN;
        this.addChild(this._darken, this._brighten);

        this._surfaces = settings.surfaceMaps ? new SurfaceBuffer(settings, width, height, MARGIN) : null;
        if (this._surfaces) {
            this._shading = PIXI.RenderTexture.create({ width, height });
            // Surface buffer coordinates of a screen point: scale, offset.
            this._surfaceMap = new Float32Array([1 / width, 1 / height, MARGIN / width, MARGIN / height]);
            const surfaceUniforms = {
                uWeights: this._buffer,
                uShading: this._shading,
                uSurface: this._surfaces.texture,
                uAmbient: new Float32Array(3),
                uScale: this._scale,
                uCap: settings.maxBrightness,
                uAOStrength: settings.aoStrength,
                uLit: 0,
            };
            const shader = (fragment) => PIXI.Shader.from(COMPOSITE_VERTEX, fragment, surfaceUniforms);
            this._darkenSurfaces = new PIXI.Mesh(screenQuad, shader(DARKEN_SURFACE_FRAGMENT));
            this._darkenSurfaces.blendMode = DARKEN;
            this._brightenSurfaces = new PIXI.Mesh(screenQuad, shader(BRIGHTEN_SURFACE_FRAGMENT));
            this._brightenSurfaces.blendMode = BRIGHTEN;
            this._surfaceUniforms = surfaceUniforms;
            this.addChild(this._darkenSurfaces, this._brightenSurfaces);
        }

        // The angle each facing-following light is drawn at, as it turns.
        // Not saved: after a scene change, lights start at their target.
        this._angles = new WeakMap();
        this._over = [0, 0, 0];
        // With surfaces: this frame's weight uniforms, and their range.
        this._weights = [];
        this._weightRange = 1;
        this._time = 0;
        this.visible = false;
    }

    // Called every frame once the spriteset has updated (src/mz/spriteset.js),
    // so the tilemap has scrolled for this frame.
    refresh(spriteset) {
        const ambient = $gameMap.ghAmbient().color;
        this._time = $gameMap.ghLightTime();
        this._display[0] = $gameMap.displayX() * $gameMap.tileWidth();
        this._display[1] = $gameMap.displayY() * $gameMap.tileHeight();
        const renderer = Graphics.app.renderer;
        const surfaces = this._surfaces !== null && this._surfaces.update(renderer, spriteset);
        this.updateFootprints(spriteset);
        for (const pool of this._pools.values()) pool.used = 0;
        this._weights.length = 0;
        let used = 0;
        for (const event of $gameMap.events()) {
            if (this.placeLight(event, ambient, surfaces)) used++;
        }
        if (!$gamePlayer.isTransparent() && this.placeLight($gamePlayer, ambient, surfaces)) used++;
        if (this._outlines) this._outlines.upload();
        if (this._weights.length > 0) {
            this._weightRange = weightRange(this._weights.reduce((sum, w) => sum + w.uWeight, 0));
            for (const w of this._weights) w.uWeight /= this._weightRange;
        }
        for (const pool of this._pools.values()) {
            for (let i = pool.used; i < pool.meshes.length; i++) pool.meshes[i].visible = false;
        }

        const darken = !isUnlit(ambient);
        const brighten = this._overbright && used > 0;
        this._darken.visible = darken && !surfaces;
        this._brighten.visible = brighten && !surfaces;
        if (this._surfaces) {
            this._darkenSurfaces.visible = darken && surfaces;
            this._brightenSurfaces.visible = brighten && surfaces;
        }
        this.visible = darken || brighten;
        if (!this.visible) return;
        registerBlendModes(renderer);
        if (!surfaces) {
            const s = this._scale;
            this._ambientSprite.tint = colorToTint([ambient[0] / s, ambient[1] / s, ambient[2] / s]);
            renderer.render(this._lightScene, this._buffer, true);
            return;
        }
        this._surfaceUniforms.uAmbient.set(ambient);
        this._surfaceUniforms.uLit = used > 0 ? 1 : 0;
        if (used > 0) {
            renderer.render(this._weightScene, this._buffer, true);
            renderer.render(this._shadingScene, this._shading, true);
        }
    }

    // Every character casting a shadow this frame, where it stands on screen.
    // A party member on the same spot as one drawn over it (followers
    // gathered on the player) is hidden behind it, and left out.
    updateFootprints(spriteset) {
        const out = this._footprints;
        out.length = 0;
        this._footprintOf.clear();
        if (this._maxCasters === 0) return;
        this._outlines.nextFrame();
        this._spriteOf.clear();
        for (const sprite of spriteset._characterSprites) this._spriteOf.set(sprite._character, sprite);
        const party = [];
        const add = (character, inParty = false) => {
            const footprint = this.footprintOf(character);
            if (!footprint) return;
            if (inParty) {
                if (party.some((f) => Math.abs(f.x - footprint.x) < 1 && Math.abs(f.y - footprint.y) < 1)) return;
                party.push(footprint);
            }
            out.push(footprint);
            this._footprintOf.set(character, footprint);
        };
        for (const event of $gameMap.events()) add(event);
        add($gamePlayer, true);
        for (const follower of $gamePlayer.followers().visibleFollowers()) add(follower, true);
    }

    // A character's shadow caster on screen, as shadowVisibility() takes it:
    // it stands a quarter of its shadow's width above the bottom of its
    // sprite (sw x sh), where its feet are, and casts its sprite's outline
    // at the size its <shadow> tag gives, or else at the sprite's own.
    footprintOf(character) {
        const shadow = character.ghShadow();
        if (!shadow) return null;
        const [sw, sh] = this.spriteSize(character);
        const w = shadow.width ?? sw;
        const h = shadow.height ?? sh;
        const r = w / 4;
        const jump = character.jumpHeight();
        return { id: character, x: character.screenX(), y: character.screenY() + jump - r, r, jump, w, h, sw, sh };
    }

    // The slot of a character's outline in the atlas (-1 for none yet),
    // looked up the first time a light needs it each frame.
    outlineSlot(character) {
        const footprint = this._footprintOf.get(character);
        if (footprint.slot === undefined) {
            const sprite = this._spriteOf.get(character);
            footprint.slot = sprite ? this._outlines.slotFor(sprite) : -1;
        }
        return footprint.slot;
    }

    // The size of one frame of a character's sprite.
    spriteSize(character) {
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        if (character.tileId() > 0) return [tw, th];
        const name = character.characterName();
        const bitmap = ImageManager.loadCharacter(name);
        if (!bitmap.isReady()) return [tw, th];
        const big = ImageManager.isBigCharacter(name);
        return [bitmap.width / (big ? 3 : 12), bitmap.height / (big ? 4 : 8)];
    }

    // Sets up the character's light, if it has one that reaches the screen
    // and adds something over the ambient: one mesh in the light buffer, or
    // with surfaces a weight mesh and a shading mesh. Returns whether it did.
    placeLight(character, ambient, surfaces = false) {
        const light = character.ghLight();
        if (!light) return false;
        const x = character.screenX() + light.offsetX;
        const y = character.screenY() - $gameMap.tileHeight() / 2 + light.offsetY;
        const reach = lightReach(light);
        const view = this._view;
        if (x + reach < view.left || x - reach > view.right || y + reach < view.top || y - reach > view.bottom) {
            return false;
        }
        const over = lightOverAmbient(light, ambient, this._over);
        if (isFlickering(light.flicker)) {
            const m = flicker(this._time, light.seed ?? character.ghLightSeed(), light.flicker);
            for (let i = 0; i < 3; i++) over[i] *= m;
        }
        if (over[0] + over[1] + over[2] <= 0) return false;

        const shadows = this.shadowsFor(character, light, x, y, reach);
        const angle = light.shape === "point" ? 0 : this.angleFor(character, light);
        const radians = (angle * Math.PI) / 180;
        const placed = { x, y, dx: Math.sin(radians), dy: -Math.cos(radians) };
        if (!surfaces) {
            const u = this.meshFor("color", light.shape, shadows !== null).shader.uniforms;
            this.setLight(u, light, placed, over);
            if (shadows) this.applyShadows(u, light, shadows);
            return true;
        }
        const w = this.meshFor("weight", light.shape, shadows !== null).shader.uniforms;
        this.setLight(w, light, placed, over);
        if (shadows) this.applyShadows(w, light, shadows);
        // The light's brightness, which weighs it against others that overlap
        // it. Its brightest channel keeps the most precision. refresh()
        // divides it by the frame's range once every light is placed.
        w.uWeight = Math.max(over[0], over[1], over[2]);
        this._weights.push(w);
        const s = this.meshFor("shading", light.shape, false).shader.uniforms;
        this.setLight(s, light, placed, over);
        s.uHeight = light.height;
        s.uToLight[0] = -placed.dx;
        s.uToLight[1] = -placed.dy;
        return true;
    }

    // The uniforms every light's shaders share.
    setLight(u, light, { x, y, dx, dy }, over) {
        u.uCenter[0] = x;
        u.uCenter[1] = y;
        u.uDirection[0] = dx;
        u.uDirection[1] = dy;
        lightBox(light, u.uBox);
        u.uRadius = light.radius;
        for (let i = 0; i < 3; i++) u.uColor[i] = over[i] / this._scale;
        if (light.shape === "cone") coneEdges(light.spread, u.uCone);
        if (light.shape === "beam") u.uHalfWidth = light.width / 2;
    }

    // What can shadow a light at (x, y) on screen: { mapX, mapY, clear,
    // casters }, or null if nothing can, and the plain shader will do.
    shadowsFor(character, light, x, y, reach) {
        const map = this._shadowMap;
        if (!map || !light.shadows) return null;
        const mapX = x + this._display[0];
        const mapY = y + this._display[1];
        const clear = lightClear(light, map.casterAtPixel(mapX, mapY), map.tile);
        let casters = [];
        if (this._footprints.length > 0) {
            const owner = { id: character, x: character.screenX(), y: character.screenY() + character.jumpHeight() };
            casters = pickCasters({ x, y, reach, clear }, owner, this._footprints, this._maxCasters);
        }
        if (casters.length === 0 && !map.anyCasterNear(mapX, mapY, reach)) return null;
        return { mapX, mapY, clear, casters };
    }

    applyShadows(u, light, { mapX, mapY, clear, casters }) {
        u.uLightMap[0] = mapX;
        u.uLightMap[1] = mapY;
        u.uShadow[0] = clear;
        u.uShadow[1] = light.softness;
        u.uShadow[2] = light.height;
        u.uShadow[3] = this._shadowMap.tile;
        u.uToLight[0] = -u.uDirection[0];
        u.uToLight[1] = -u.uDirection[1];
        if (this._maxCasters === 0) return;
        let n = 0;
        for (const c of casters) {
            const slot = this.outlineSlot(c.id);
            if (slot < 0) continue;
            u.uCasters.set([c.x, c.y, c.jump, c.sh], n * 4);
            u.uCasterShapes.set([slot, c.w, c.h, c.sw / c.sh], n * 4);
            n++;
        }
        u.uCasterCount = n;
    }

    // The light's angle this frame. Lights that follow their character's
    // facing turn toward it at TURN_SPEED; fixed directions never move.
    angleFor(character, light) {
        const target = lightAngle(light.direction, character.direction());
        if (light.direction !== "facing") return target;
        const last = this._angles.get(character);
        const angle = last === undefined ? target : turnToward(last, target, TURN_SPEED);
        this._angles.set(character, angle);
        return angle;
    }

    // The angle a facing-following light was last drawn at, for tests.
    angleOf(character) {
        return this._angles.get(character);
    }

    // A mesh for a light in one of the scenes: "color" (the plain light
    // buffer), "weight" or "shading" (for surfaces; see the top).
    meshFor(pass, shape, shadowed) {
        const key = `${pass}:${shape}${shadowed ? "+shadows" : ""}`;
        let pool = this._pools.get(key);
        if (!pool) {
            pool = { meshes: [], used: 0 };
            this._pools.set(key, pool);
        }
        let mesh = pool.meshes[pool.used];
        if (!mesh) {
            const uniforms = {
                uCenter: new Float32Array(2),
                uDirection: new Float32Array([1, 0]),
                uBox: new Float32Array(4),
                uRadius: 1,
                uColor: new Float32Array(3),
                uCone: new Float32Array(2),
                uHalfWidth: 1,
                uWeight: 0,
            };
            if (pass === "shading") {
                Object.assign(uniforms, {
                    uSurface: this._surfaces.texture,
                    uSurfaceMap: this._surfaceMap,
                    uHeight: 1,
                    uToLight: new Float32Array(2),
                });
            }
            if (shadowed) {
                const map = this._shadowMap;
                Object.assign(uniforms, {
                    uField: map.texture,
                    uFieldMap: new Float32Array(map.fieldMap),
                    uMapSize: new Float32Array(map.mapSize),
                    uLoop: new Float32Array(map.loop),
                    uLightMap: new Float32Array(2),
                    uShadow: new Float32Array(4),
                    uToLight: new Float32Array(2),
                    uCasterCount: 0,
                    uCasters: new Float32Array(Math.max(1, this._maxCasters) * 4),
                    uCasterShapes: new Float32Array(Math.max(1, this._maxCasters) * 4),
                    uOutlines: this._outlines ? this._outlines.texture : PIXI.Texture.WHITE.baseTexture,
                });
            }
            const shader =
                pass === "shading"
                    ? PIXI.Shader.from(SHADING_VERTEX, shadingFragmentFor(shape), uniforms)
                    : PIXI.Shader.from(LIGHT_VERTEX, lightFragmentFor(shape, shadowed, this._maxCasters, pass), uniforms);
            mesh = new PIXI.Mesh(this._quad, shader);
            mesh.blendMode = PIXI.BLEND_MODES.ADD;
            pool.meshes.push(mesh);
            this._scenes[pass].addChild(mesh);
        }
        pool.used++;
        mesh.visible = true;
        return mesh;
    }

    // MZ destroys scenes with { texture: true }, which would destroy the
    // shared PIXI.Texture.WHITE, so the options are deliberately not passed on.
    destroy() {
        this._lightScene.destroy({ children: true });
        this._weightScene.destroy({ children: true });
        this._shadingScene.destroy({ children: true });
        super.destroy({ children: true });
        this._buffer.destroy(true);
        if (this._shadowMap) this._shadowMap.destroy();
        if (this._outlines) this._outlines.destroy();
        if (this._surfaces) {
            this._surfaces.destroy();
            this._shading.destroy(true);
        }
    }
}
