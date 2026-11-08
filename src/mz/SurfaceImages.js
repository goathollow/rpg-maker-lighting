import { surfaceFilesFor } from "./surfaceFiles.js";
import { PACK_FRAGMENT, QUAD_VERTEX } from "./surfaceShaders.js";
import { warnOnce } from "./warn.js";

export const HAS_NORMAL = 1;
export const HAS_AO = 2;

// Every image's surface maps, by folder and lower-cased name (null for an
// image without any), kept for the whole game like MZ's image cache.
const images = new Map();
const byBitmap = new WeakMap();

// Everything that holds packed maps on the GPU. A lost WebGL context (common
// when a phone app goes to the background) wipes them, so they pack again.
const holders = new Set();
let watching = null;

function watchContext(renderer) {
    if (watching === renderer) return;
    watching = renderer;
    renderer.runners.contextChange.add({
        contextChange() {
            for (const holder of holders) holder.contextLost();
        },
    });
}

let packer = null;

// One quad drawing an image's maps in packed form (PACK_FRAGMENT).
function packMesh() {
    if (!packer) {
        const geometry = new PIXI.Geometry()
            .addAttribute("aVertexPosition", new PIXI.Buffer(new Float32Array(8), false), 2)
            .addAttribute("aTextureCoord", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const shader = PIXI.Shader.from(QUAD_VERTEX, PACK_FRAGMENT, {
            uNormal: PIXI.Texture.WHITE.baseTexture,
            uOcclusion: PIXI.Texture.WHITE.baseTexture,
            uPack: new Float32Array(3),
        });
        packer = new PIXI.Mesh(geometry, shader);
        packer.blendMode = PIXI.BLEND_MODES.NONE;
    }
    return packer;
}

const usable = (bitmap) => bitmap && bitmap.isReady() && bitmap.width > 0;

// One image's maps.
export class SurfaceImage {
    constructor(folder, name, files) {
        this.folder = folder;
        this.name = name;
        this._normal = files.normal ? this.load(files.normal) : null;
        this._ao = files.ao ? this.load(files.ao) : null;
        this._texture = null;
        this._packed = false;
    }

    // Loaded like MZ loads images, so encrypted ones work, but not through
    // ImageManager, whose cache stops the game on a missing file.
    load(stem) {
        return Bitmap.load(`img/${this.folder}/${Utils.encodeURI(stem)}.png`);
    }

    // Whether its maps have finished loading. One that failed to load is
    // reported and left out.
    isReady() {
        for (const bitmap of [this._normal, this._ao]) {
            if (!bitmap) continue;
            if (bitmap.isError()) {
                warnOnce(`couldn't load ${decodeURIComponent(bitmap.url)}; it is left out`);
                continue;
            }
            if (!bitmap.isReady()) return false;
        }
        return true;
    }

    // HAS_NORMAL and HAS_AO for the maps that loaded.
    get flags() {
        return (usable(this._normal) ? HAS_NORMAL : 0) + (usable(this._ao) ? HAS_AO : 0);
    }

    // The maps packed into one texture the size of the image, or null until
    // they have loaded.
    texture(renderer, width, height, greenUp) {
        if (!this.isReady()) return null;
        if (this._texture && (this._texture.width !== width || this._texture.height !== height)) {
            this._texture.destroy(true);
            this._texture = null;
        }
        if (!this._texture) {
            this._texture = PIXI.RenderTexture.create({ width, height });
            holders.add(this);
            this._packed = false;
        }
        if (!this._packed) {
            this.packInto(renderer, this._texture, 0, 0, width, height, greenUp, true);
            this._packed = true;
        }
        return this._texture;
    }

    // Draws the packed maps into `target` at (x, y), sized to the image
    // (width x height).
    packInto(renderer, target, x, y, width, height, greenUp, clear = false) {
        watchContext(renderer);
        for (const [bitmap, kind] of [[this._normal, "normal"], [this._ao, "AO"]]) {
            if (usable(bitmap) && (bitmap.width !== width || bitmap.height !== height)) {
                warnOnce(
                    `the ${kind} map ${decodeURIComponent(bitmap.url)} is ${bitmap.width}x${bitmap.height}, but ` +
                        `its image is ${width}x${height}; it is stretched to fit, which may not line up`
                );
            }
        }
        const mesh = packMesh();
        mesh.geometry.getBuffer("aVertexPosition").update(new Float32Array([x, y, x + width, y, x + width, y + height, x, y + height]));
        const u = mesh.shader.uniforms;
        u.uNormal = usable(this._normal) ? this._normal.baseTexture : PIXI.Texture.WHITE.baseTexture;
        u.uOcclusion = usable(this._ao) ? this._ao.baseTexture : PIXI.Texture.WHITE.baseTexture;
        u.uPack[0] = usable(this._normal) ? 1 : 0;
        u.uPack[1] = usable(this._ao) ? 1 : 0;
        u.uPack[2] = greenUp ? 1 : 0;
        renderer.render(mesh, target, clear);
    }

    contextLost() {
        this._packed = false;
    }
}

// The surface maps of an image, or null if it has none.
export function surfaceImageFor(folder, name) {
    const key = `${folder}/${String(name).toLowerCase()}`;
    if (!images.has(key)) {
        const files = surfaceFilesFor(folder, name);
        images.set(key, files ? new SurfaceImage(folder, name, files) : null);
    }
    return images.get(key);
}

// Whether every image's maps asked for so far have loaded.
export function surfaceImagesReady() {
    for (const image of images.values()) if (image && !image.isReady()) return false;
    return true;
}

const LIT_IMAGE = /^img\/(characters|tilesets|parallaxes)\/(.+)\.png$/;

// The surface maps of the image a bitmap was loaded from, or null.
export function surfaceImageForBitmap(bitmap) {
    if (!bitmap) return null;
    if (!byBitmap.has(bitmap)) {
        const m = LIT_IMAGE.exec(bitmap.url || "");
        let image = null;
        if (m) {
            try {
                image = surfaceImageFor(m[1], decodeURIComponent(m[2]));
            } catch {
                image = null;
            }
        }
        byBitmap.set(bitmap, image);
    }
    return byBitmap.get(bitmap);
}

// A tileset's maps, packed the way MZ lays the tileset out on the GPU: three
// 2048-pixel textures, each holding four sheets, one to each 1024-pixel
// corner. Textures without any maps are never made.
export class TilesetSurface {
    constructor(names) {
        this.names = names.slice();
        this._images = this.names.map((name) => (name ? surfaceImageFor("tilesets", name) : null));
        this._atlases = [null, null, null];
        this._packed = this._images.map(() => false);
        this.flags = [new Float32Array(4), new Float32Array(4), new Float32Array(4)];
        this.hasMaps = this._images.some(Boolean);
        holders.add(this);
    }

    matches(names) {
        return names.length === this.names.length && names.every((name, i) => name === this.names[i]);
    }

    // Packs each sheet whose maps and image have loaded. `bitmaps` are the
    // tilemap's own, for each sheet's size.
    update(renderer, bitmaps, greenUp) {
        for (let i = 0; i < this._images.length && i < 12; i++) {
            const image = this._images[i];
            const bitmap = bitmaps[i];
            if (!image || this._packed[i] || !image.isReady() || !bitmap || !bitmap.isReady()) continue;
            const atlas = this.atlas(i >> 2);
            image.packInto(renderer, atlas, 1024 * (i % 2), 1024 * ((i >> 1) % 2), bitmap.width, bitmap.height, greenUp);
            this._packed[i] = true;
            this.flags[i >> 2][i % 4] = image.flags;
        }
    }

    atlas(index) {
        if (!this._atlases[index]) {
            this._atlases[index] = PIXI.RenderTexture.create({
                width: 2048,
                height: 2048,
                scaleMode: PIXI.SCALE_MODES.NEAREST,
            });
        }
        return this._atlases[index];
    }

    // The base texture for a slot, or a placeholder for one with no maps.
    baseTexture(index) {
        const atlas = this._atlases[index];
        return atlas ? atlas.baseTexture : PIXI.Texture.WHITE.baseTexture;
    }

    get hasData() {
        return this.flags.some((f) => f.some((v) => v > 0));
    }

    contextLost() {
        this._packed.fill(false);
        for (const f of this.flags) f.fill(0);
    }

    destroy() {
        holders.delete(this);
        for (const atlas of this._atlases) if (atlas) atlas.destroy(true);
        this._atlases = [null, null, null];
    }
}
