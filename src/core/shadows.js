import { parseTagArgs } from "./notetags.js";
import { outlineDistance } from "./outlines.js";
import { smoothstep } from "./shapes.js";

// Shadows, worked out per pixel by the shadowed light shaders: from each
// lit point, look along the way to the light for anything in between.
//
//   tiles       walls, roofs and painted tiles, as a distance field (see
//               field.js) marched through toward the light. They are
//               infinitely tall: nothing passes over them.
//   characters  the outline of each one's sprite (outlines.js), standing
//               up at its feet and turned to face the light. Light from
//               higher up passes over them, so their shadows end: the
//               higher the light, the shorter the shadow. They fall on the
//               ground, never on casting tiles, which stand far above them.
//
// Shadows are soft: a light is a disc `softness` pixels across, and a point
// sees a fraction of it, growing from 0 to 1 across the edge of a shadow.
// The penumbra widens with distance from what casts it, as real shadows do.
//
// This file is the reference for the GLSL in src/mz/shaders.js, and the two
// must stay in step: the lighting model tests compare them pixel by pixel.

export const SHADOW_STEPS = 24; // march steps toward the light, at most
export const INSIDE_STEPS = 12; // tiles a light inside a caster lights through
export const MIN_STEP = 2; // pixels
export const MIN_CONE = 0.25; // pixels: the sharpest a shadow edge gets
export const MIN_CLEAR = 4; // pixels around a light that never shadow it
export const MAX_CASTERS = 8; // characters per light, nearest first
export const FACE_GAP = 1; // pixels out from a caster's face it is lit from
// Further than any light reaches (radius is at most 2000), and still within
// the range even medium-precision GLSL floats must hold.
export const FAR = 1e4;

// How far from a light the march stops. Nothing that close shadows it, so a
// light hung on a wall still shines out of it. A light inside a caster
// (painted onto a wall tile, say) ignores everything within a tile of it.
export function lightClear(light, inside, tile) {
    return inside ? tile : Math.max(light.softness, MIN_CLEAR);
}

// The way from a point toward the light, for a point (qx, qy) from the
// light, as [ux, uy, distance]. A beam's light comes in parallel from its
// start line, like sunlight through a window; others shine from a point.
export function shadowRay(light, qx, qy, dx, dy) {
    if (light.shape === "beam") return [-dx, -dy, qx * dx + qy * dy];
    const d = Math.hypot(qx, qy);
    return [-qx / Math.max(d, 1e-4), -qy / Math.max(d, 1e-4), d];
}

// The fraction of a light that point (qx, qy) sees, 0..1. Everything is
// relative to the light. (ux, uy) and D come from shadowRay(); `params` is
// { clear, softness, height, tile, mapX, mapY, parallel }: mapX, mapY are
// the light's position on the map, and parallel is true for a beam's light,
// as shadowRay() gives it; fieldAt(x, y) is the tile field's distance at a
// point. Each caster is { x, y, r, jump, w, h, sw, sh, outline }: it stands
// at x, y, r above the bottom of its sprite (sw x sh pixels, lifted `jump`
// off the ground), and its shadow is its outline (one slot's texels, or
// null for none yet) stretched to w x h.
export function shadowVisibility(qx, qy, ux, uy, D, params, casters, fieldAt) {
    const { clear, softness, height, tile, mapX, mapY, parallel } = params;
    if (D <= clear) return 1;

    // A point inside a caster takes the light of the side of its tile that
    // faces the light, as the ground just outside that side gets it: the
    // tops of walls are lit a tile deep along their edges facing a light,
    // and a painted crate on the sides facing it. Of two open sides, the
    // one facing the light more squarely wins; with neither, an open corner
    // between them lights it. A light inside a caster too (a lamp on top of
    // a wall) lights what it sees of it through it.
    let through = false;
    const onTile = fieldAt(qx, qy) < 0;
    if (onTile) {
        const open = (x, y) => fieldAt((x + 0.5) * tile - mapX, (y + 0.5) * tile - mapY) >= 0;
        through = fieldAt(0, 0) < 0 && seesThrough(qx, qy, ux, uy, D - clear, params, open);
        if (!through) {
            const cx = Math.floor((mapX + qx) / tile);
            const cy = Math.floor((mapY + qy) / tile);
            const sx = ux > 0 ? 1 : -1;
            const sy = uy > 0 ? 1 : -1;
            const openX = open(cx + sx, cy);
            const openY = open(cx, cy + sy);
            const faceX = (cx + Math.max(sx, 0)) * tile - mapX + sx * FACE_GAP;
            const faceY = (cy + Math.max(sy, 0)) * tile - mapY + sy * FACE_GAP;
            if (openY && (!openX || Math.abs(uy) >= Math.abs(ux))) {
                qy = faceY;
            } else if (openX) {
                qx = faceX;
            } else if (open(cx + sx, cy + sy)) {
                qx = faceX;
                qy = faceY;
            } else {
                return 0;
            }
            if (parallel) {
                D = -(qx * ux + qy * uy);
            } else {
                D = Math.hypot(qx, qy);
                ux = -qx / Math.max(D, 1e-4);
                uy = -qy / Math.max(D, 1e-4);
            }
            if (D <= clear) return 1;
        }
    }

    const tEnd = D - clear;
    // The least clearance past anything in the way, as a fraction of the
    // light's cone there: 1 or more is fully lit, -1 or less fully dark.
    let res = 1;

    // A character's shadow: the outline it shows the light, where the way
    // to the light passes it. A character never shadows its own sprite as
    // drawn; on screen that is the character, not the ground behind it.
    // Seen from the light, the sprite keeps its left and right: the outline
    // is not mirrored for lights behind it. Casting tiles stand far above
    // characters, so the tops of walls and roofs never catch their shadows.
    for (const c of onTile ? [] : casters) {
        if (!c.outline) continue;
        const rx = qx - c.x;
        const ry = qy - c.y;
        const ratio = c.sw / c.sh;
        // How far up the sprite the point is on screen.
        const above = c.r - c.jump - ry;
        const onSprite = Math.abs(rx) < c.sw / 2 && above > 0 && above < c.sh;
        if (onSprite && outlineDistance(c.outline, ratio, c.sw, c.sh, rx, above) < 0) continue;
        const along = -(rx * ux + ry * uy);
        if (along <= 0 || along >= tEnd) continue;
        const side = (parallel ? uy : -c.y) >= 0 ? 1 : -1;
        const across = (rx * uy - ry * ux) * side;
        const up = (height * along) / D - c.jump;
        const h = outlineDistance(c.outline, ratio, c.w, c.h, across, up);
        res = Math.min(res, h / Math.max((along * softness) / D, MIN_CONE));
    }
    if (res <= -1) return 0;
    if (through) return smoothstep(-1, 1, res);

    // March to the light, never further than the field says is clear.
    const minStep = Math.min(2 * tile, Math.max(MIN_STEP, tEnd / SHADOW_STEPS));
    const spread = softness / Math.max(D, 1);
    let h = fieldAt(qx, qy);
    let t = 0;
    for (let i = 0; i < SHADOW_STEPS; i++) {
        t += Math.min(2 * tile, Math.max(minStep, h));
        if (t >= tEnd) break;
        h = fieldAt(qx + ux * t, qy + uy * t);
        res = Math.min(res, h / Math.max(t * spread, MIN_CONE));
        if (res <= -1) break;
    }
    return smoothstep(-1, 1, res);
}

// Whether the way from point (qx, qy) toward the light stays inside casting
// tiles until it is `tEnd` along, followed a tile at a time since casters
// are whole tiles. open(x, y) says whether map tile (x, y) is free.
function seesThrough(qx, qy, ux, uy, tEnd, { tile, mapX, mapY }, open) {
    const mx = mapX + qx;
    const my = mapY + qy;
    let cx = Math.floor(mx / tile);
    let cy = Math.floor(my / tile);
    const sx = ux > 0 ? 1 : -1;
    const sy = uy > 0 ? 1 : -1;
    const ax = Math.abs(ux) > 1e-6;
    const ay = Math.abs(uy) > 1e-6;
    const dx = ax ? tile / Math.abs(ux) : FAR;
    const dy = ay ? tile / Math.abs(uy) : FAR;
    let tx = ax ? ((cx + Math.max(sx, 0)) * tile - mx) / ux : FAR;
    let ty = ay ? ((cy + Math.max(sy, 0)) * tile - my) / uy : FAR;
    for (let i = 0; i < INSIDE_STEPS; i++) {
        let t;
        if (tx < ty) {
            t = tx;
            tx += dx;
            cx += sx;
        } else {
            t = ty;
            ty += dy;
            cy += sy;
        }
        if (t >= tEnd) return true;
        if (open(cx, cy)) return false;
    }
    return false;
}

// The characters that can shadow a light, nearest first, relative to it.
// `light` is { x, y, reach, clear } on screen; `owner` is the character
// carrying it, { id, x, y }, with x, y where it stands. `footprints` are on
// screen too, casters as shadowVisibility() takes them. Neither the owner
// nor anyone on the same spot (followers gathered on the player, say)
// shadows the light, and nor does anyone standing in its clear zone.
export function pickCasters(light, owner, footprints, max = MAX_CASTERS) {
    const near = [];
    for (const f of footprints) {
        if (f.id === owner.id || Math.hypot(f.x - owner.x, f.y + f.r - owner.y) < f.r) continue;
        const d = Math.hypot(f.x - light.x, f.y - light.y);
        if (d < light.clear || d > light.reach + Math.max(f.r, f.w / 2)) continue;
        near.push({ d, caster: { ...f, x: f.x - light.x, y: f.y - light.y } });
    }
    near.sort((a, b) => a.d - b.d);
    return near.slice(0, max).map((n) => n.caster);
}

//-----------------------------------------------------------------------------
// <shadow> tags on events

// width and height in pixels; null means from the character's sprite.
export const AUTO_SHADOW = Object.freeze({ width: null, height: null });

const SHADOW_LIMITS = { width: [1, 480], height: [0, 960] };
const SHADOW_ALIASES = { width: "width", size: "width", height: "height" };

// Text of a <shadow> tag -> { width, height }, or null for "off".
export function resolveShadow(text, warn = () => {}) {
    const { name, values } = parseTagArgs(text);
    if (/^(off|none|no|false)$/i.test(name)) return null;
    if (name && !/^(on|yes|true)$/i.test(name)) warn(`can't read shadow "${name}"; use on, off, or width: and height:`);
    const shadow = { ...AUTO_SHADOW };
    for (const [key, raw] of Object.entries(values)) {
        const prop = SHADOW_ALIASES[key];
        const n = Number(raw);
        if (!prop) {
            warn(`unknown shadow setting "${key}"; use width or height`);
        } else if (!Number.isFinite(n)) {
            warn(`can't read shadow ${key} "${raw}"; it should be a number`);
        } else {
            const [min, max] = SHADOW_LIMITS[prop];
            shadow[prop] = Math.min(max, Math.max(min, n));
        }
    }
    return shadow;
}
