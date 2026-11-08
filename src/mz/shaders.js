import { FIELD_TILES } from "../core/field.js";
import { OUTLINE_ATLAS, OUTLINE_COLUMNS, OUTLINE_RANGE, OUTLINE_SLOT } from "../core/outlines.js";
import { FACE_GAP, FAR, INSIDE_STEPS, MIN_CONE, MIN_STEP, SHADOW_STEPS } from "../core/shadows.js";

// GLSL ES 1.00, so the same shaders run on WebGL 1 (every phone) and 2.
//
// The light buffer is an ordinary 8-bit texture holding light divided by
// uScale (lightBufferScale() in src/core/lights.js), so it can store
// brightness above 1 while white ambient (1.0) is still stored exactly.

// Draws one light. aVertexPosition is a unit quad corner in [-1, 1], mapped
// onto uBox, a rectangle in light space (x along uDirection, y across it, in
// pixels from uCenter), and from there onto the screen. See lightBox() in
// src/core/shapes.js. vOffset is the same point on screen, from uCenter.
export const LIGHT_VERTEX = `
attribute vec2 aVertexPosition;

uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uCenter;
uniform vec2 uDirection;
uniform vec4 uBox;

varying vec2 vLocal;
varying vec2 vOffset;

void main(void) {
    vLocal = uBox.xy + aVertexPosition * uBox.zw;
    vec2 across = vec2(-uDirection.y, uDirection.x);
    vOffset = uDirection * vLocal.x + across * vLocal.y;
    vec2 position = uCenter + vOffset;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
}
`;

// One fragment shader per shape, each matching shapeFalloff() in
// src/core/shapes.js. uColor is what the light adds over the ambient, divided
// by the buffer scale. Alpha is 0 so the additive blend leaves the buffer's
// alpha at 1.
//
// On maps with normal or AO maps, the light buffer holds weights instead
// (the "weight" output): how much of each light reaches each texel past
// shadows (red), out of how much would without them (green), each times
// uWeight, the light's brightness. The surface pass (surfaceShaders.js)
// shades the lights at full resolution without shadows, and the composite
// darkens that by red / green, the share of the light that gets through.
const OUTPUTS = {
    color: (f) => `    gl_FragColor = vec4(uColor * ${f}, 0.0);`,
    weight: (f) => `    gl_FragColor = vec4(uWeight * ${f}, uWeight * f, 0.0, 0.0);`,
};

const lightFragment = (uniforms, body, output) => `
precision mediump float;

uniform vec3 uColor;
uniform float uRadius;
uniform float uWeight;
${uniforms}
varying vec2 vLocal;

void main(void) {
${body}
${OUTPUTS[output]("f")}
}
`;

const float = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const [FIELD_MIN, FIELD_MAX] = FIELD_TILES;

// The same, times the fraction of the light each point sees past shadow
// casters: shadowVisibility() in src/core/shadows.js, line for line. Map
// positions run to thousands of pixels, so this needs high precision where
// the device has it (nearly all do).
//
//   uField        the tile distance field (src/core/field.js), 8 bits
//   uLightMap     the light's position on the map, in pixels
//   uMapSize      the map's size in pixels; uLoop is 1 where it loops
//   uFieldMap     field texture coordinates per map pixel (xy), and of the
//                 map's top-left corner (zw)
//   uShadow       clear zone, softness, height, tile size
//   uToLight      for a beam, the way back to its start line (the vertex
//                 shader has its direction, but a uniform in both shaders
//                 must have the same precision there, and this one may not)
//   uCasters      characters: x, y from the light, how far they are lifted
//                 off the ground (jumping), their sprites' height
//   uCasterShapes their outlines: slot in uOutlines, the width and height
//                 they are stretched to, their frames' width over height
//   uOutlines     the outlines (src/core/outlines.js), 8 bits
//
// `ray` is the body of toLight(), which sets u (the way to the light) and D
// (the distance to it) for a point q from the light, as shadowRay() does.
// `side` says which side of a caster c the light is on.
const shadowedFragment = (uniforms, body, ray, side, maxCasters, output) => `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec3 uColor;
uniform float uRadius;
uniform float uWeight;
${uniforms}
uniform vec2 uToLight;
uniform sampler2D uField;
uniform vec2 uLightMap;
uniform vec2 uMapSize;
uniform vec2 uLoop;
uniform vec4 uFieldMap;
uniform vec4 uShadow;
${maxCasters > 0 ? casterUniforms(maxCasters) : ""}
varying vec2 vLocal;
varying vec2 vOffset;

float fieldAt(vec2 p) {
    vec2 m = uLightMap + p;
    m = mix(m, mod(m, uMapSize), uLoop);
    float stored = texture2D(uField, m * uFieldMap.xy + uFieldMap.zw).r;
    return (stored * ${float(FIELD_MAX - FIELD_MIN)} + ${float(FIELD_MIN)}) * uShadow.w;
}

void toLight(vec2 q, out vec2 u, out float D) {
${ray}
}

bool isOpen(vec2 cell) {
    return fieldAt((cell + 0.5) * uShadow.w - uLightMap) >= 0.0;
}

bool seesThrough(vec2 q, vec2 u, float tEnd) {
    float tile = uShadow.w;
    vec2 m = uLightMap + q;
    vec2 cell = floor(m / tile);
    vec2 s = vec2(u.x > 0.0 ? 1.0 : -1.0, u.y > 0.0 ? 1.0 : -1.0);
    vec2 a = abs(u);
    vec2 ahead = (cell + max(s, 0.0)) * tile;
    vec2 delta = vec2(a.x > 1e-6 ? tile / a.x : ${float(FAR)}, a.y > 1e-6 ? tile / a.y : ${float(FAR)});
    vec2 next = vec2(a.x > 1e-6 ? (ahead.x - m.x) / u.x : ${float(FAR)}, a.y > 1e-6 ? (ahead.y - m.y) / u.y : ${float(FAR)});
    for (int i = 0; i < ${INSIDE_STEPS}; i++) {
        float t;
        if (next.x < next.y) {
            t = next.x;
            next.x += delta.x;
            cell.x += s.x;
        } else {
            t = next.y;
            next.y += delta.y;
            cell.y += s.y;
        }
        if (t >= tEnd) return true;
        if (isOpen(cell)) return false;
    }
    return false;
}

float visibility(vec2 q) {
    vec2 u;
    float D;
    toLight(q, u, D);
    float clear = uShadow.x;
    if (D <= clear) return 1.0;
    float tile = uShadow.w;

    bool through = false;
    bool onTile = fieldAt(q) < 0.0;
    if (onTile) {
        through = fieldAt(vec2(0.0)) < 0.0 && seesThrough(q, u, D - clear);
        if (!through) {
            vec2 cell = floor((uLightMap + q) / tile);
            vec2 s = vec2(u.x > 0.0 ? 1.0 : -1.0, u.y > 0.0 ? 1.0 : -1.0);
            bool openX = isOpen(cell + vec2(s.x, 0.0));
            bool openY = isOpen(cell + vec2(0.0, s.y));
            vec2 face = (cell + max(s, 0.0)) * tile - uLightMap + s * ${float(FACE_GAP)};
            if (openY && (!openX || abs(u.y) >= abs(u.x))) {
                q.y = face.y;
            } else if (openX) {
                q.x = face.x;
            } else if (isOpen(cell + s)) {
                q = face;
            } else {
                return 0.0;
            }
            toLight(q, u, D);
            if (D <= clear) return 1.0;
        }
    }

    float tEnd = D - clear;
    float res = 1.0;
${maxCasters > 0 ? casterLoop(maxCasters, side) : ""}
    if (through) return smoothstep(-1.0, 1.0, res);

    float minStep = min(2.0 * tile, max(${float(MIN_STEP)}, tEnd / ${float(SHADOW_STEPS)}));
    float spread = uShadow.y / max(D, 1.0);
    float h = fieldAt(q);
    float t = 0.0;
    for (int i = 0; i < ${SHADOW_STEPS}; i++) {
        t += min(2.0 * tile, max(minStep, h));
        if (t >= tEnd) break;
        h = fieldAt(q + u * t);
        res = min(res, h / max(t * spread, ${float(MIN_CONE)}));
        if (res <= -1.0) break;
    }
    return smoothstep(-1.0, 1.0, res);
}

void main(void) {
${body}
    float lit = f > 0.0 ? f * visibility(vOffset) : 0.0;
${OUTPUTS[output]("lit")}
}
`;

const [OUTLINE_MIN, OUTLINE_MAX] = OUTLINE_RANGE;

// outlineDistance() in src/core/outlines.js: from a point in a caster's
// plane (across, up) to its outline, in slot `slot`, stretched to `size`.
const casterUniforms = (n) => `uniform float uCasterCount;
uniform vec4 uCasters[${n}];
uniform vec4 uCasterShapes[${n}];
uniform sampler2D uOutlines;

float outlineAt(float slot, vec2 size, float ratio, vec2 p) {
    vec2 frame = ${float(OUTLINE_SLOT)} * vec2(min(1.0, ratio), min(1.0, 1.0 / ratio));
    vec2 k = size / frame;
    vec2 t = vec2(p.x / k.x + frame.x * 0.5, frame.y - p.y / k.y);
    vec2 inside = clamp(t, vec2(0.5), frame - 0.5);
    vec2 corner = vec2(mod(slot, ${float(OUTLINE_COLUMNS)}), floor(slot / ${float(OUTLINE_COLUMNS)})) * ${float(OUTLINE_SLOT)};
    float stored = texture2D(uOutlines, (corner + inside) / ${float(OUTLINE_ATLAS)}).r;
    float d = stored * ${float(OUTLINE_MAX - OUTLINE_MIN)} + ${float(OUTLINE_MIN)} + length(t - inside);
    return d * min(k.x, k.y);
}`;

const casterLoop = (n, side) => `
    for (int i = 0; i < ${n}; i++) {
        if (onTile || float(i) >= uCasterCount) break;
        vec4 c = uCasters[i];
        vec4 s = uCasterShapes[i];
        vec2 rel = q - c.xy;
        vec2 sprite = vec2(c.w * s.w, c.w);
        float above = s.y * 0.25 - c.z - rel.y;
        bool onSprite = abs(rel.x) < sprite.x * 0.5 && above > 0.0 && above < sprite.y;
        if (onSprite && outlineAt(s.x, sprite, s.w, vec2(rel.x, above)) < 0.0) continue;
        float along = -dot(rel, u);
        if (along <= 0.0 || along >= tEnd) continue;
        float across = (rel.x * u.y - rel.y * u.x) * (${side} >= 0.0 ? 1.0 : -1.0);
        float up = uShadow.z * along / D - c.z;
        res = min(res, outlineAt(s.x, s.yz, s.w, vec2(across, up)) / max(along * uShadow.y / D, ${float(MIN_CONE)}));
    }
    if (res <= -1.0) return 0.0;
`;

const RADIAL = `    vec2 v = vLocal / uRadius;
    float d2 = dot(v, v);
    float f = max(1.0 - d2, 0.0);
    f *= f;`;

// uCone: cosines of the inner (fully bright) and outer (dark) half-angles.
const CONE = `${RADIAL}
    f *= smoothstep(uCone.y, uCone.x, v.x / max(sqrt(d2), 1e-4));`;

// Fully bright across the middle half of its width, fading to the edges.
const BEAM = `    float along = vLocal.x / uRadius;
    float f = max(1.0 - along * along, 0.0);
    f *= f * (1.0 - smoothstep(0.5, 1.0, abs(vLocal.y) / uHalfWidth));`;

const POINT_RAY = `    D = length(q);
    u = -q / max(D, 1e-4);`;

// A beam's light comes in parallel from its start line.
const BEAM_RAY = `    u = uToLight;
    D = -dot(q, u);`;

// Per shape: extra uniforms, falloff, toLight() and which side of a caster
// c the light is on, as shadowVisibility() has it (a point light is at the
// origin; a beam's light comes in along u).
const SHAPES = {
    point: ["", RADIAL, POINT_RAY, "-c.y"],
    cone: ["uniform vec2 uCone;", CONE, POINT_RAY, "-c.y"],
    beam: ["uniform float uHalfWidth;", BEAM, BEAM_RAY, "u.y"],
};

// The fragment shader for a shape, with or without shadows, giving color
// or weights (see OUTPUTS). maxCasters is how many characters can shadow one
// light, which the device's uniform limit decides (0 for none).
export function lightFragmentFor(shape, shadowed, maxCasters = 0, output = "color") {
    const [uniforms, body, ray, side] = SHAPES[shape];
    return shadowed
        ? shadowedFragment(uniforms, body, ray, side, maxCasters, output)
        : lightFragment(uniforms, body, output);
}

// A shape's falloff and the uniforms it needs, for the surface pass.
export function shapeParts(shape) {
    const [uniforms, body] = SHAPES[shape];
    return { uniforms, body };
}

// Draws the light buffer over the map, in up to two passes that together
// multiply the map by min(light, uCap):
//
//   darken    map * min(light, 1)                 multiply blend
//   brighten  map * (1 + min(light, uCap) - 1)    DST_COLOR, ONE blend
//
// Where a pass has nothing to do, its output is exactly 1.0 (darken) or 0.0
// (brighten), even after rounding to 8 bits, so areas without a light look
// exactly as they would without the plugin.
export const COMPOSITE_VERTEX = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;

varying vec2 vTextureCoord;

void main(void) {
    vTextureCoord = aTextureCoord;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}
`;

export const DARKEN_FRAGMENT = `
precision mediump float;

uniform sampler2D uSampler;
uniform float uScale;

varying vec2 vTextureCoord;

void main(void) {
    vec3 light = texture2D(uSampler, vTextureCoord).rgb * uScale;
    gl_FragColor = vec4(min(light, vec3(1.0)), 1.0);
}
`;

export const BRIGHTEN_FRAGMENT = `
precision mediump float;

uniform sampler2D uSampler;
uniform float uScale;
uniform float uCap;

varying vec2 vTextureCoord;

void main(void) {
    vec3 light = texture2D(uSampler, vTextureCoord).rgb * uScale;
    gl_FragColor = vec4(clamp(min(light, vec3(uCap)) - 1.0, 0.0, 1.0), 1.0);
}
`;
