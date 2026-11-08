import { LightingLayer } from "./LightingLayer.js";

export function installSpritesetHooks(settings) {
    const createLowerLayer = Spriteset_Map.prototype.createLowerLayer;
    Spriteset_Map.prototype.createLowerLayer = function() {
        createLowerLayer.call(this);
        this.createLightingLayer();
    };

    // On the prototype, MZ-style, so other plugins can move the layer.
    Spriteset_Map.prototype.createLightingLayer = function() {
        this._lightingLayer = new LightingLayer(settings);
        // Last in the base sprite: over the tilemap (tiles and characters),
        // under the weather and pictures, which the spriteset itself holds.
        // The base sprite's Tint Screen filter then tints the lit result.
        this._baseSprite.addChild(this._lightingLayer);
    };

    // After everything else, because MZ scrolls the tilemap and parallax at
    // the end of its update, after updating the sprites; the surface buffer
    // must see them where they will be drawn.
    const update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        update.call(this);
        if (this._lightingLayer) this._lightingLayer.refresh(this);
    };
}
