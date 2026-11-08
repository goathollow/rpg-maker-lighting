import { anyCasterIn, buildCasterGrid, casterAt, distanceField, FIELD_MARGIN, summedArea } from "../core/field.js";

// The last map's grid and field, since every return from the menu builds a
// new spriteset. MZ reloads the map file then too, so the cache is checked
// against the map's tiles rather than the $dataMap object, which also
// catches plugins that change tiles.
let cache = null;

function isCached(entry) {
    if (!entry || entry.mapId !== $gameMap.mapId() || entry.tilesetId !== $gameMap.tilesetId()) return false;
    const data = $dataMap.data;
    if (entry.data.length !== data.length) return false;
    for (let i = 0; i < data.length; i++) if (entry.data[i] !== data[i]) return false;
    return true;
}

// The current map's shadow-casting tiles: a grid for quick questions on the
// CPU, and the distance field texture the shadowed light shaders read.
export class ShadowMap {
    // For the map being shown, or null when shadows are off there, or
    // nothing on it can cast one.
    static forCurrentMap(settings) {
        if (!$gameMap.ghShadowsOn()) return null;
        let entry = cache;
        if (!isCached(entry)) {
            const width = $gameMap.width();
            const height = $gameMap.height();
            const grid = buildCasterGrid(width, height, (x, y) => $gameMap.ghCastsShadow(x, y));
            const map = {
                grid,
                width,
                height,
                loopX: $gameMap.isLoopHorizontal(),
                loopY: $gameMap.isLoopVertical(),
            };
            const sat = summedArea(grid, width, height);
            const hasTiles = sat[sat.length - 1] > 0;
            // A map without casting tiles still needs a field for the
            // shaders to read; one sample a tile is plenty for empty space.
            const tile = $gameMap.tileWidth();
            const field = distanceField(map, hasTiles ? { tile } : { tile, density: 1 });
            const data = [...$dataMap.data];
            entry = { mapId: $gameMap.mapId(), tilesetId: $gameMap.tilesetId(), data, map, sat, field, hasTiles };
            cache = entry;
        }
        if (!entry.hasTiles && !settings.characterShadows) return null;
        return new ShadowMap(entry);
    }

    constructor({ map, sat, field, hasTiles }) {
        this.map = map;
        this.field = field;
        this._sat = sat;
        this._hasTiles = hasTiles;
        this.tile = field.tile;
        const resource = new PIXI.resources.BufferResource(field.data, {
            width: field.texWidth,
            height: field.texHeight,
        });
        this.texture = new PIXI.BaseTexture(resource, {
            width: field.texWidth,
            height: field.texHeight,
            format: PIXI.FORMATS.LUMINANCE,
            type: PIXI.TYPES.UNSIGNED_BYTE,
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            mipmap: PIXI.MIPMAP_MODES.OFF,
            wrapMode: PIXI.WRAP_MODES.CLAMP,
            alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
        });
        // Field texture coordinates per map pixel, and of the map's corner.
        const texelSize = field.tile / field.density;
        this.fieldMap = [
            1 / (field.texWidth * texelSize),
            1 / (field.texHeight * texelSize),
            (FIELD_MARGIN * field.density) / field.texWidth,
            (FIELD_MARGIN * field.density) / field.texHeight,
        ];
        this.mapSize = [map.width * field.tile, map.height * field.tile];
        this.loop = [map.loopX ? 1 : 0, map.loopY ? 1 : 0];
    }

    // Whether the tile under map pixel (x, y) casts shadows.
    casterAtPixel(x, y) {
        return casterAt(this.map, Math.floor(x / this.tile), Math.floor(y / this.tile));
    }

    // Whether any casting tile is within `reach` pixels of map pixel (x, y),
    // counting the whole tiles the square around it touches.
    anyCasterNear(x, y, reach) {
        if (!this._hasTiles) return false;
        const t = this.tile;
        const x0 = Math.floor((x - reach) / t);
        const y0 = Math.floor((y - reach) / t);
        const x1 = Math.floor((x + reach) / t);
        const y1 = Math.floor((y + reach) / t);
        return anyCasterIn(this.map, this._sat, x0, y0, x1, y1);
    }

    destroy() {
        this.texture.destroy();
    }
}
