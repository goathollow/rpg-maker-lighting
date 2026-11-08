import { OUTLINE_ATLAS, OUTLINE_COLUMNS, OUTLINE_SLOT, OUTLINE_SLOTS, outlineField, outlineSize } from "../core/outlines.js";

// The outlines of the frames characters are showing, which their shadows
// take their shape from (src/core/outlines.js). Each is made the first time
// a light needs it and kept in a slot of one texture; when the slots run
// out, the one used longest ago goes. Like the shadow map, they outlast the
// scene, so coming back from the menu costs nothing.
let shared = null;

function sharedSlots() {
    if (!shared) {
        shared = {
            data: new Uint8Array(OUTLINE_ATLAS * OUTLINE_ATLAS).fill(255),
            slots: new Map(), // frame key -> slot
            keys: new Array(OUTLINE_SLOTS).fill(null),
            used: new Float64Array(OUTLINE_SLOTS).fill(-1), // frame number
            frame: 0,
            ids: new WeakMap(), // bitmap -> number, for frame keys
            nextId: 1,
        };
    }
    return shared;
}

// A canvas to read frames' pixels from, as big as a slot.
let reader = null;

function readerContext() {
    if (!reader) {
        const canvas = document.createElement("canvas");
        canvas.width = OUTLINE_SLOT;
        canvas.height = OUTLINE_SLOT;
        reader = canvas.getContext("2d", { willReadFrequently: true });
    }
    return reader;
}

// The alpha of a frame drawn `width` x `height` texels (rounded up) into the
// top left of a slot. If the image can't be read (one from another site,
// say), a solid post half the frame's width, as shadows had before outlines.
function frameAlpha(source, frame, width, height) {
    const w = Math.ceil(width);
    const h = Math.ceil(height);
    const alpha = new Uint8Array(w * h);
    try {
        const context = readerContext();
        context.clearRect(0, 0, OUTLINE_SLOT, OUTLINE_SLOT);
        context.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, w, h).data;
        for (let i = 0; i < w * h; i++) alpha[i] = pixels[i * 4 + 3];
    } catch {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) alpha[y * w + x] = Math.abs(x + 0.5 - width / 2) < width / 4 ? 255 : 0;
        }
    }
    return alpha;
}

export class OutlineAtlas {
    constructor() {
        this._shared = sharedSlots();
        const resource = new PIXI.resources.BufferResource(this._shared.data, {
            width: OUTLINE_ATLAS,
            height: OUTLINE_ATLAS,
        });
        this.texture = new PIXI.BaseTexture(resource, {
            width: OUTLINE_ATLAS,
            height: OUTLINE_ATLAS,
            format: PIXI.FORMATS.LUMINANCE,
            type: PIXI.TYPES.UNSIGNED_BYTE,
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            mipmap: PIXI.MIPMAP_MODES.OFF,
            wrapMode: PIXI.WRAP_MODES.CLAMP,
            alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
        });
        this._changed = false;
    }

    // Called once a frame, before any slotFor().
    nextFrame() {
        this._shared.frame++;
    }

    // The slot holding the outline of the frame a character's sprite is
    // showing, made now if need be, or -1 if its image hasn't loaded or
    // every slot is in use this frame.
    slotFor(sprite) {
        const bitmap = sprite.bitmap;
        if (!bitmap || !bitmap.isReady() || bitmap.width === 0) return -1;
        const s = this._shared;
        if (!s.ids.has(bitmap)) s.ids.set(bitmap, s.nextId++);
        // The whole frame: in a bush, MZ draws it in two halves.
        const { x, y } = sprite._frame;
        const frame = { x, y, width: sprite.patternWidth(), height: sprite.patternHeight() };
        const key = `${s.ids.get(bitmap)}:${bitmap.baseTexture.dirtyId}:${x},${y},${frame.width},${frame.height}`;
        let slot = s.slots.get(key);
        if (slot === undefined) {
            slot = this.freeSlot();
            if (slot < 0) return -1;
            this.fill(slot, bitmap, frame);
            if (s.keys[slot] !== null) s.slots.delete(s.keys[slot]);
            s.keys[slot] = key;
            s.slots.set(key, slot);
        }
        s.used[slot] = s.frame;
        return slot;
    }

    // The slot used longest ago, unless that was this frame.
    freeSlot() {
        const { used, frame } = this._shared;
        let best = 0;
        for (let i = 1; i < OUTLINE_SLOTS; i++) if (used[i] < used[best]) best = i;
        return used[best] < frame ? best : -1;
    }

    fill(slot, bitmap, frame) {
        const [width, height] = outlineSize(frame.width / frame.height);
        const source = bitmap._canvas || bitmap._image;
        const field = outlineField(frameAlpha(source, frame, width, height), Math.ceil(width), Math.ceil(height));
        const data = this._shared.data;
        const x0 = (slot % OUTLINE_COLUMNS) * OUTLINE_SLOT;
        const y0 = Math.floor(slot / OUTLINE_COLUMNS) * OUTLINE_SLOT;
        for (let y = 0; y < OUTLINE_SLOT; y++) {
            data.set(field.subarray(y * OUTLINE_SLOT, (y + 1) * OUTLINE_SLOT), (y0 + y) * OUTLINE_ATLAS + x0);
        }
        this._changed = true;
    }

    // Sends new outlines to the GPU, before the lights are drawn.
    upload() {
        if (!this._changed) return;
        this.texture.resource.update();
        this._changed = false;
    }

    // One slot's texels, row by row: what shadowVisibility() takes.
    slotData(slot) {
        const data = new Uint8Array(OUTLINE_SLOT * OUTLINE_SLOT);
        const x0 = (slot % OUTLINE_COLUMNS) * OUTLINE_SLOT;
        const y0 = Math.floor(slot / OUTLINE_COLUMNS) * OUTLINE_SLOT;
        for (let y = 0; y < OUTLINE_SLOT; y++) {
            const row = (y0 + y) * OUTLINE_ATLAS + x0;
            data.set(this._shared.data.subarray(row, row + OUTLINE_SLOT), y * OUTLINE_SLOT);
        }
        return data;
    }

    destroy() {
        this.texture.destroy();
    }
}
