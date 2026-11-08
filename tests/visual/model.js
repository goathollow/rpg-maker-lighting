import { casterAt, distanceField, sampleField } from "../../src/core/field.js";
import { flicker, isFlickering } from "../../src/core/flicker.js";
import { lightBufferScale } from "../../src/core/lights.js";
import { lightClear, pickCasters, shadowRay, shadowVisibility } from "../../src/core/shadows.js";
import { angleVector, lightAngle, lightReach, shapeFalloff, toLightSpace } from "../../src/core/shapes.js";
import { decodeNormal, surfaceShading } from "../../src/core/surfaces.js";
import { expect } from "./fixtures.js";

// Reference model, built the way the GPU builds the frame:
//
//   1. the light buffer, one value per texel at Light Quality resolution:
//      ambient + the sum over lights of excess * flicker * shape falloff *
//      the fraction of the light the texel sees past shadow casters,
//      rounded to the buffer's 8 bits. A light's excess is max(0, color *
//      intensity - ambient).
//   2. each screen pixel reads the buffer between its four nearest texels
//      (bilinear filtering)
//   3. the pixel is its unlit color times min(Max Brightness, that light)
//
// Sampling the buffer like this, rather than the shapes directly, keeps the
// model exact at sharp features such as a cone's tip or a beam's edge.
// A light's angle is where its direction setting points, unless the test
// gives one (`angle`, for a light caught mid-turn).
export function expectMatchesModel(lit, unlit, state, tolerance = 3) {
    const { ambient, cap, time, resolution, margin, lights } = state;
    const scale = lightBufferScale(cap);
    const to8 = (v) => (Math.min(255, Math.round((v / scale) * 255)) / 255) * scale;
    const shadows = shadowModel(state);
    const placed = lights.map((l) => {
        const m = isFlickering(l.flicker) ? flicker(time, l.seed, l.flicker) : 1;
        const angle = l.angle ?? lightAngle(l.direction, l.facing);
        return {
            ...l,
            angle,
            excess: l.color.map((c, i) => Math.max(0, c - ambient[i]) * m),
            visibility: shadows && l.shadows ? shadows({ ...l, angle }) : null,
        };
    });
    const texels = new Map();
    const texel = (i, j) => {
        const key = i * 100000 + j;
        if (!texels.has(key)) {
            const x = (i + 0.5) / resolution - margin;
            const y = (j + 0.5) / resolution - margin;
            const light = ambient.map(to8);
            for (const l of placed) {
                const [lx, ly] = toLightSpace(x, y, l.x, l.y, l.angle);
                let f = shapeFalloff(l, lx, ly);
                if (f > 0 && l.visibility) f *= l.visibility(x - l.x, y - l.y);
                for (let c = 0; c < 3; c++) light[c] += l.excess[c] * f;
            }
            texels.set(key, light.map(to8));
        }
        return texels.get(key);
    };
    const failures = [];
    for (let y = 2; y < lit.height; y += 13) {
        for (let x = 2; x < lit.width; x += 13) {
            const u = (x + 0.5 + margin) * resolution - 0.5;
            const v = (y + 0.5 + margin) * resolution - 0.5;
            const i = Math.floor(u);
            const j = Math.floor(v);
            const [fu, fv] = [u - i, v - j];
            const [a, b, c, d] = [texel(i, j), texel(i + 1, j), texel(i, j + 1), texel(i + 1, j + 1)];
            const p = (y * lit.width + x) * 4;
            for (let ch = 0; ch < 3; ch++) {
                const light =
                    (a[ch] * (1 - fu) + b[ch] * fu) * (1 - fv) + (c[ch] * (1 - fu) + d[ch] * fu) * fv;
                const expected = Math.min(255, unlit.data[p + ch] * Math.min(cap, light));
                if (Math.abs(lit.data[p + ch] - expected) > tolerance) {
                    failures.push(`(${x},${y}) ch${ch}: got ${lit.data[p + ch]}, expected ${expected.toFixed(1)}`);
                }
            }
        }
    }
    expect(failures.slice(0, 8), `${failures.length} pixels off`).toEqual([]);
}

// For a light, the fraction of it a point (from the light, on screen) sees,
// as shadowVisibility() works it out from the map's casting tiles and the
// characters near the light. Null when the map has shadows off.
export function shadowModel({ casterTiles, tile, display, casters, maxCasters }) {
    if (!casterTiles) return null;
    const field = distanceField(casterTiles, { tile });
    return (light) => {
        const mapX = light.x + display[0];
        const mapY = light.y + display[1];
        const inside = casterAt(casterTiles, Math.floor(mapX / tile), Math.floor(mapY / tile));
        const clear = lightClear(light, inside, tile);
        const parallel = light.shape === "beam";
        const params = { clear, softness: light.softness, height: light.height, tile, mapX, mapY, parallel };
        const owner = { id: light.id, x: light.ground[0], y: light.ground[1] };
        const reach = lightReach(light);
        const near = maxCasters ? pickCasters({ x: light.x, y: light.y, reach, clear }, owner, casters, maxCasters) : [];
        const [dx, dy] = angleVector(light.angle);
        const fieldAt = (x, y) => sampleField(field, mapX + x, mapY + y);
        return (qx, qy) => {
            const [ux, uy, D] = shadowRay(light, qx, qy, dx, dy);
            return shadowVisibility(qx, qy, ux, uy, D, params, near, fieldAt);
        };
    };
}

// The same, for a frame with normal or AO maps (see LightingLayer.js):
//
//   1. the surface buffer, read back from the GPU (its own test checks it
//      against the maps): each pixel's normal and AO
//   2. the light buffer at Light Quality: per texel, red = the sum over
//      lights of weight * falloff * visibility, green = the same without
//      visibility, each rounded to 8 bits. A light's weight is its excess's
//      brightest channel / the frame's weight range.
//   3. the shading buffer at full resolution: the sum over lights of excess *
//      falloff * surfaceShading(the pixel's normal), rounded to 8 bits
//   4. light = ambient + shading * red / green * AO (eased by AO Strength),
//      reading red and green between the four nearest texels
//   5. the pixel is its unlit color times min(Max Brightness, that light)
export function expectMatchesSurfaceModel(lit, unlit, state, surface, tolerance = 3) {
    const { ambient, cap, time, resolution, margin, lights } = state;
    const scale = lightBufferScale(cap);
    const to8 = (v, range) => (Math.min(255, Math.round((v / range) * 255)) / 255) * range;
    const shadows = shadowModel(state);
    const placed = lights.map((l) => {
        const m = isFlickering(l.flicker) ? flicker(time, l.seed, l.flicker) : 1;
        const angle = l.angle ?? lightAngle(l.direction, l.facing);
        const excess = l.color.map((c, i) => Math.max(0, c - ambient[i]) * m);
        return {
            ...l,
            angle,
            excess,
            weight: Math.max(...excess) / state.weightRange,
            dir: angleVector(angle),
            visibility: shadows && l.shadows ? shadows({ ...l, angle }) : null,
        };
    });
    const surfaceAt = (x, y) => {
        const p = ((y + margin) * surface.width + (x + margin)) * 4;
        return { normal: decodeNormal(surface.data[p], surface.data[p + 1]), ao: surface.data[p + 2] / 255 };
    };
    const texels = new Map();
    const texel = (i, j) => {
        const key = i * 100000 + j;
        if (!texels.has(key)) {
            const x = (i + 0.5) / resolution - margin;
            const y = (j + 0.5) / resolution - margin;
            let seen = 0;
            let all = 0;
            for (const l of placed) {
                const [lx, ly] = toLightSpace(x, y, l.x, l.y, l.angle);
                const f = shapeFalloff(l, lx, ly);
                if (f <= 0) continue;
                const v = l.visibility ? l.visibility(x - l.x, y - l.y) : 1;
                seen += l.weight * f * v;
                all += l.weight * f;
            }
            texels.set(key, [to8(seen, 1), to8(all, 1)]);
        }
        return texels.get(key);
    };
    const failures = [];
    for (let y = 2; y < lit.height; y += 7) {
        for (let x = 2; x < lit.width; x += 7) {
            const u = (x + 0.5 + margin) * resolution - 0.5;
            const v = (y + 0.5 + margin) * resolution - 0.5;
            const i = Math.floor(u);
            const j = Math.floor(v);
            const [fu, fv] = [u - i, v - j];
            const [a, b, c, d] = [texel(i, j), texel(i + 1, j), texel(i, j + 1), texel(i + 1, j + 1)];
            const lerp = (k) => (a[k] * (1 - fu) + b[k] * fu) * (1 - fv) + (c[k] * (1 - fu) + d[k] * fu) * fv;
            const [seen, all] = [lerp(0), lerp(1)];
            const share = all > 0 ? Math.min(seen / all, 1) : 0;

            const { normal, ao } = surfaceAt(x, y);
            const shading = [0, 0, 0];
            for (const l of placed) {
                const [lx, ly] = toLightSpace(x + 0.5, y + 0.5, l.x, l.y, l.angle);
                const f = shapeFalloff(l, lx, ly);
                if (f <= 0) continue;
                const [ux, uy, D] = shadowRay(l, x + 0.5 - l.x, y + 0.5 - l.y, l.dir[0], l.dir[1]);
                const k = surfaceShading(normal, ux * D, uy * D, l.height);
                for (let ch = 0; ch < 3; ch++) shading[ch] += l.excess[ch] * f * k;
            }
            const open = 1 - (1 - ao) * surface.aoStrength;
            const p = (y * lit.width + x) * 4;
            for (let ch = 0; ch < 3; ch++) {
                const light = ambient[ch] + to8(shading[ch], scale) * share * open;
                const expected = Math.min(255, unlit.data[p + ch] * Math.min(cap, light));
                if (Math.abs(lit.data[p + ch] - expected) > tolerance) {
                    failures.push(`(${x},${y}) ch${ch}: got ${lit.data[p + ch]}, expected ${expected.toFixed(1)}`);
                }
            }
        }
    }
    expect(failures.slice(0, 8), `${failures.length} pixels off`).toEqual([]);
}
