import { AUTO_NORMALS } from "../core/surfaces.js";
import { surfaceImageForBitmap, TilesetSurface } from "./SurfaceImages.js";
import { QUAD_VERTEX, SPRITE_SURFACE_FRAGMENT, TILE_SURFACE_FRAGMENT, TILE_SURFACE_VERTEX } from "./surfaceShaders.js";

// Flat, with no occlusion: what the buffer holds where nothing has maps.
const FLAT = [128 / 255, 128 / 255, 1, 1];

const IDENTITY = new PIXI.Matrix();

// Draws the surface buffer (see surfaceShaders.js): the map's tiles,
// parallax and characters again, in the same order and places, each as its
// normal and AO maps. It draws only when something on screen has maps (or
// auto normal maps are on), and says so; otherwise the lighting layer keeps
// to the plain light buffer, which costs nothing extra.
//
// It runs after the spriteset's update, when the tilemap has scrolled for
// this frame but not yet been drawn, and works in the base sprite's own
// coordinates like the light buffer, so screen shake and zoom apply to both
// together when the layer is drawn.
export class SurfaceBuffer {
    constructor(settings, width, height, margin) {
        this._settings = settings;
        this._auto = AUTO_NORMALS[settings.autoNormals];
        this._greenUp = settings.normalGreen === "up";
        this.texture = PIXI.RenderTexture.create({ width, height });
        this.texture.baseTexture.clearColor = FLAT;
        this._transform = new PIXI.Matrix().translate(margin, margin);
        this._tileset = null;

        this._tileShader = PIXI.Shader.from(TILE_SURFACE_VERTEX, TILE_SURFACE_FRAGMENT, {
            uProjectionMatrix: new PIXI.Matrix(),
            uColor0: PIXI.Texture.WHITE.baseTexture,
            uColor1: PIXI.Texture.WHITE.baseTexture,
            uColor2: PIXI.Texture.WHITE.baseTexture,
            uSurface0: PIXI.Texture.WHITE.baseTexture,
            uSurface1: PIXI.Texture.WHITE.baseTexture,
            uSurface2: PIXI.Texture.WHITE.baseTexture,
            uFlags0: new Float32Array(4),
            uFlags1: new Float32Array(4),
            uFlags2: new Float32Array(4),
            uOptions: new Float32Array([settings.normalStrength, this._auto.tiles ? settings.autoNormalStrength : 0]),
        });
        this._spriteShader = PIXI.Shader.from(QUAD_VERTEX, SPRITE_SURFACE_FRAGMENT, {
            translationMatrix: IDENTITY,
            uColor: PIXI.Texture.WHITE.baseTexture,
            uSurface: PIXI.Texture.WHITE.baseTexture,
            uFlags: 0,
            uOptions: new Float32Array(4),
            uFrame: new Float32Array(4),
            uTexel: new Float32Array(2),
        });
        this._positions = new PIXI.Buffer(new Float32Array(8), false);
        this._uvs = new PIXI.Buffer(new Float32Array(8), false);
        this._quad = new PIXI.Geometry()
            .addAttribute("aVertexPosition", this._positions, 2)
            .addAttribute("aTextureCoord", this._uvs, 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        this._state = PIXI.State.for2d();
        this._state.blendMode = PIXI.BLEND_MODES.NORMAL;

        // What to draw this frame, in order.
        this._parallax = null;
        this._items = [];
        const self = this;
        this._scene = new PIXI.Container();
        this._scene.render = (renderer) => self.draw(renderer);

        this.active = false;
    }

    // Works out whether anything on screen has a surface this frame and, if
    // so, draws the buffer. Returns whether it did.
    update(renderer, spriteset) {
        const tilemap = spriteset._tilemap;
        const tileset = $gameMap.tileset();
        const names = tileset ? tileset.tilesetNames : [];
        if (!this._tileset || !this._tileset.matches(names)) {
            if (this._tileset) this._tileset.destroy();
            this._tileset = new TilesetSurface(names);
        }
        if (this._tileset.hasMaps) this._tileset.update(renderer, tilemap._bitmaps || [], this._greenUp);

        // Lay the tilemap out for this frame in the base sprite's
        // coordinates (as if it had no parent), and put it back afterwards.
        const parent = tilemap.enableTempParent();
        tilemap.updateTransform();
        tilemap.disableTempParent(parent);

        let active = this._tileset.hasData || this._auto.tiles;
        this._parallax = this.parallaxItem(renderer, spriteset._parallax);
        if (this._parallax) active = true;
        this._items.length = 0;
        for (const child of tilemap.children) {
            if (child === tilemap._lowerLayer || child === tilemap._upperLayer) {
                this._items.push(child);
            } else if (child instanceof Sprite_Character) {
                const before = this._items.length;
                this.addSprite(renderer, child);
                for (let i = before; i < this._items.length; i++) {
                    const item = this._items[i];
                    if (item.flags > 0 || item.auto) active = true;
                }
            }
        }

        this.active = active;
        if (active) renderer.render(this._scene, this.texture, true, this._transform, true);
        tilemap.updateTransform();
        return active;
    }

    // The parallax as an item to draw, or null if it has nothing to add.
    parallaxItem(renderer, parallax) {
        const bitmap = parallax && parallax.visible && parallax.bitmap;
        if (!bitmap || !bitmap.isReady() || bitmap.width === 0) return null;
        const image = surfaceImageForBitmap(bitmap);
        const texture = image && image.texture(renderer, bitmap.width, bitmap.height, this._greenUp);
        const flags = texture ? image.flags : 0;
        const auto = this._auto.tiles;
        if (!flags && !auto) return null;
        // Where TilingSprite puts the image: shifted by its rounded origin.
        const ox = -Math.round(-parallax.origin.x);
        const oy = -Math.round(-parallax.origin.y);
        const w = parallax.width;
        const h = parallax.height;
        const [bw, bh] = [bitmap.width, bitmap.height];
        return {
            color: bitmap.baseTexture,
            surface: texture ? texture.baseTexture : PIXI.Texture.WHITE.baseTexture,
            flags,
            auto,
            alpha: parallax.worldAlpha,
            wrap: true,
            positions: [0, 0, w, 0, w, h, 0, h],
            uvs: [ox / bw, oy / bh, (ox + w) / bw, oy / bh, (ox + w) / bw, (oy + h) / bh, ox / bw, (oy + h) / bh],
            frame: [-1e6, -1e6, 1e6, 1e6],
            texel: [1 / bw, 1 / bh],
        };
    }

    // A character's sprite and its children (such as the halves MZ splits it
    // into in a bush) as items to draw. Additive and other blended sprites
    // are effects drawn over a surface, not surfaces, and are left out.
    addSprite(renderer, sprite) {
        if (!sprite.visible || !sprite.renderable || sprite.worldAlpha <= 0) return;
        const texture = sprite.texture;
        if (sprite.blendMode === PIXI.BLEND_MODES.NORMAL && texture && texture.valid && texture.frame.width > 0) {
            const base = texture.baseTexture;
            const bitmap = sprite.bitmap;
            const image = surfaceImageForBitmap(bitmap);
            const packed = image && image.texture(renderer, base.width, base.height, this._greenUp);
            const isTile = image ? image.folder === "tilesets" : /^img\/tilesets\//.test((bitmap && bitmap.url) || "");
            sprite.calculateVertices();
            const f = texture.frame;
            this._items.push({
                color: base,
                surface: packed ? packed.baseTexture : PIXI.Texture.WHITE.baseTexture,
                flags: packed ? image.flags : 0,
                auto: isTile ? this._auto.tiles : this._auto.characters,
                alpha: sprite.worldAlpha,
                wrap: false,
                positions: sprite.vertexData,
                uvs: texture._uvs.uvsFloat32,
                frame: [
                    (f.x + 0.5) / base.width,
                    (f.y + 0.5) / base.height,
                    (f.x + f.width - 0.5) / base.width,
                    (f.y + f.height - 0.5) / base.height,
                ],
                texel: [1 / base.width, 1 / base.height],
            });
        }
        for (const child of sprite.children) {
            if (child instanceof PIXI.Sprite) this.addSprite(renderer, child);
        }
    }

    draw(renderer) {
        renderer.batch.flush();
        if (this._parallax) this.drawQuad(renderer, this._parallax);
        for (const item of this._items) {
            if (item instanceof PIXI.Container) {
                for (const layer of item.children) this.drawTiles(renderer, layer);
            } else {
                this.drawQuad(renderer, item);
            }
        }
    }

    // One of the tilemap's layers, as Tilemap.Layer.render() draws it, from
    // the same vertex data. Anything it would update first is updated here,
    // so MZ finds it done when it draws the layer itself.
    drawTiles(renderer, layer) {
        if (!layer._vao || layer._elements.length === 0) return;
        const tiles = renderer.plugins.rpgtilemap;
        if (layer._needsTexturesUpdate) {
            tiles.updateTextures(renderer, layer._images);
            layer._needsTexturesUpdate = false;
        }
        layer._updateIndexBuffer();
        if (layer._needsVertexUpdate) {
            layer._updateVertexBuffer();
            layer._needsVertexUpdate = false;
        }
        const shader = this._tileShader;
        const u = shader.uniforms;
        renderer.projection.projectionMatrix.copyTo(u.uProjectionMatrix);
        u.uProjectionMatrix.append(layer.worldTransform);
        const colors = tiles._internalTextures;
        for (let i = 0; i < 3; i++) {
            u[`uColor${i}`] = colors[i] || PIXI.Texture.WHITE.baseTexture;
            u[`uSurface${i}`] = this._tileset.baseTexture(i);
            u[`uFlags${i}`].set(this._tileset.flags[i]);
        }
        renderer.shader.bind(shader);
        renderer.geometry.bind(layer._vao, shader);
        renderer.geometry.updateBuffers();
        renderer.state.set(this._state);
        renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, layer._elements.length * 6, 0);
    }

    drawQuad(renderer, item) {
        const shader = this._spriteShader;
        const u = shader.uniforms;
        u.uColor = item.color;
        u.uSurface = item.surface;
        u.uFlags = item.flags;
        u.uOptions[0] = this._settings.normalStrength;
        u.uOptions[1] = item.auto ? this._settings.autoNormalStrength : 0;
        u.uOptions[2] = item.alpha;
        u.uOptions[3] = item.wrap ? 1 : 0;
        u.uFrame.set(item.frame);
        u.uTexel.set(item.texel);
        this._positions.data.set(item.positions);
        this._positions.update();
        this._uvs.data.set(item.uvs);
        this._uvs.update();
        renderer.shader.bind(shader);
        renderer.geometry.bind(this._quad, shader);
        renderer.geometry.updateBuffers();
        renderer.state.set(this._state);
        renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0);
    }

    destroy() {
        this.texture.destroy(true);
        if (this._tileset) this._tileset.destroy();
        this._quad.destroy();
    }
}
