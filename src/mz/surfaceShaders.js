import { AUTO_NORMAL_SCALE, MAX_SHADING } from "../core/surfaces.js";
import { shapeParts } from "./shaders.js";

// Shaders for normal and AO maps (src/core/surfaces.js has the math, line
// for line). GLSL ES 1.00, like everything else.
//
// The surface buffer is a full-resolution copy of the map's layout holding,
// per pixel: normal x and y on screen (y down) in red and green, 128 being
// flat, and ambient occlusion in blue. Each image's maps are first packed
// into that same form (PACK), so drawing the buffer is one texture read per
// pixel.

const float = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

// High precision where the device has it: these address textures up to
// 2048 pixels wide one texel at a time.
const HIGH = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif`;

// decodeNormal() and strengthen() in src/core/surfaces.js.
const NORMALS = `
vec3 decodeNormal(vec2 c) {
    vec2 n = clamp((c * 255.0 - 128.0) / 127.0, -1.0, 1.0);
    float len2 = dot(n, n);
    if (len2 > 1.0) {
        n /= sqrt(len2);
        len2 = 1.0;
    }
    return vec3(n, sqrt(max(0.0, 1.0 - len2)));
}

vec3 strengthen(vec3 n, float k) {
    vec3 m = vec3(n.xy * k, n.z);
    float len = length(m);
    return len > 0.0 ? m / len : vec3(0.0, 0.0, 1.0);
}

vec2 encodeNormal(vec3 n) {
    return (clamp(n.xy, -1.0, 1.0) * 127.0 + 128.0) / 255.0;
}
`;

// autoHeight() and autoNormal(): `tap` reads the color dx, dy texels away.
const autoNormal = (tap) => `
float autoHeight(vec4 c) {
    return dot(c.rgb, vec3(0.299, 0.587, 0.114));
}

vec3 autoNormal(float strength) {
    float tl = autoHeight(${tap("-1.0", "-1.0")});
    float t = autoHeight(${tap("0.0", "-1.0")});
    float tr = autoHeight(${tap("1.0", "-1.0")});
    float l = autoHeight(${tap("-1.0", "0.0")});
    float r = autoHeight(${tap("1.0", "0.0")});
    float bl = autoHeight(${tap("-1.0", "1.0")});
    float b = autoHeight(${tap("0.0", "1.0")});
    float br = autoHeight(${tap("1.0", "1.0")});
    float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl;
    float gy = bl + 2.0 * b + br - tl - 2.0 * t - tr;
    vec3 n = vec3(-gx, -gy, 1.0 / (strength * ${float(AUTO_NORMAL_SCALE)}));
    return strength > 0.0 ? normalize(n) : vec3(0.0, 0.0, 1.0);
}
`;

// A plain textured quad in the scene's own coordinates.
export const QUAD_VERTEX = `
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

// Packs one image's normal and AO maps into surface form. Images are
// uploaded with their color multiplied by alpha, which is undone first.
// Transparent normal map pixels count as flat and transparent AO as open.
//
//   uPack  has a normal map, has an AO map, green points up
export const PACK_FRAGMENT = `
precision mediump float;

uniform sampler2D uNormal;
uniform sampler2D uOcclusion;
uniform vec3 uPack;

varying vec2 vTextureCoord;

void main(void) {
    vec2 n = vec2(128.0 / 255.0);
    if (uPack.x > 0.5) {
        vec4 c = texture2D(uNormal, vTextureCoord);
        if (c.a > 0.0) n = c.rg / c.a;
        if (uPack.z > 0.5) n.g = min(1.0, 256.0 / 255.0 - n.g);
    }
    float ao = 1.0;
    if (uPack.y > 0.5) {
        vec4 a = texture2D(uOcclusion, vTextureCoord);
        ao = a.r + 1.0 - a.a;
    }
    gl_FragColor = vec4(n, ao, 1.0);
}
`;

// The surface of tiles, drawn from the tilemap's own vertex data so it lands
// exactly where MZ draws the tiles. MZ keeps the tileset in three 2048-pixel
// textures, four sheets to each, a sheet to each 1024-pixel corner; the
// packed maps (uSurface0-2) are laid out the same way.
//
//   uFlags0-2  per sheet (one per corner): 0 no maps, +1 a normal map,
//              +2 an AO map
//   uOptions   normal map strength, auto normal strength (0: off)
export const TILE_SURFACE_VERTEX = `
attribute float aTextureId;
attribute vec4 aFrame;
attribute vec2 aSource;
attribute vec2 aDest;

uniform mat3 uProjectionMatrix;

varying vec4 vFrame;
varying vec2 vTextureCoord;
varying float vTextureId;

void main(void) {
    vec3 position = uProjectionMatrix * vec3(aDest, 1.0);
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vFrame = aFrame;
    vTextureCoord = aSource;
    vTextureId = aTextureId;
}
`;

export const TILE_SURFACE_FRAGMENT = `
${HIGH}

uniform sampler2D uColor0;
uniform sampler2D uColor1;
uniform sampler2D uColor2;
uniform sampler2D uSurface0;
uniform sampler2D uSurface1;
uniform sampler2D uSurface2;
uniform vec4 uFlags0;
uniform vec4 uFlags1;
uniform vec4 uFlags2;
uniform vec2 uOptions;

varying vec4 vFrame;
varying vec2 vTextureCoord;
varying float vTextureId;

vec4 colorAt(int id, vec2 p) {
    p = clamp(p, vFrame.xy, vFrame.zw) / 2048.0;
    if (id == 0) return texture2D(uColor0, p);
    if (id == 1) return texture2D(uColor1, p);
    return texture2D(uColor2, p);
}

vec4 surfaceAt(int id, vec2 p) {
    p /= 2048.0;
    if (id == 0) return texture2D(uSurface0, p);
    if (id == 1) return texture2D(uSurface1, p);
    return texture2D(uSurface2, p);
}

float flagAt(int id, vec2 p) {
    vec4 f = id == 0 ? uFlags0 : id == 1 ? uFlags1 : uFlags2;
    vec2 corner = step(1024.0, p);
    vec2 row = corner.y > 0.5 ? f.zw : f.xy;
    return corner.x > 0.5 ? row.y : row.x;
}

int tileId;
vec2 tileCoord;
${NORMALS}
${autoNormal((dx, dy) => `colorAt(tileId, tileCoord + vec2(${dx}, ${dy}))`)}

void main(void) {
    tileId = int(vTextureId);
    // MZ's auto shadows: they darken the color, not the surface.
    if (tileId < 0) discard;
    tileCoord = clamp(vTextureCoord, vFrame.xy, vFrame.zw);
    vec4 color = colorAt(tileId, tileCoord);
    if (color.a <= 0.0) discard;
    float flags = flagAt(tileId, tileCoord);
    vec3 n = vec3(0.0, 0.0, 1.0);
    float ao = 1.0;
    if (flags > 0.5) {
        vec4 s = surfaceAt(tileId, tileCoord);
        if (mod(flags, 2.0) > 0.5) n = strengthen(decodeNormal(s.rg), uOptions.x);
        if (flags > 1.5) ao = s.b;
    }
    if (mod(flags, 2.0) < 0.5 && uOptions.y > 0.0) n = autoNormal(uOptions.y);
    gl_FragColor = vec4(encodeNormal(n), ao, 1.0) * color.a;
}
`;

// The surface of a sprite (a character, or a tile event) or of the
// parallax. Its packed maps (uSurface) are the size of its image, so they
// are read at its own texture coordinates.
//
//   uFlags     as for tiles
//   uOptions   normal map strength, auto normal strength (0: off), opacity,
//              and 1 to wrap texture coordinates (a tiling parallax)
//   uFrame     the sprite's frame in its texture, which auto normals keep
//              their taps inside
//   uTexel     one texel of its texture
export const SPRITE_SURFACE_FRAGMENT = `
${HIGH}

uniform sampler2D uColor;
uniform sampler2D uSurface;
uniform float uFlags;
uniform vec4 uOptions;
uniform vec4 uFrame;
uniform vec2 uTexel;

varying vec2 vTextureCoord;

vec2 spriteUv;

vec4 colorTap(vec2 d) {
    vec2 p = spriteUv + d * uTexel;
    p = uOptions.w > 0.5 ? fract(p) : clamp(p, uFrame.xy, uFrame.zw);
    return texture2D(uColor, p);
}
${NORMALS}
${autoNormal((dx, dy) => `colorTap(vec2(${dx}, ${dy}))`)}

void main(void) {
    spriteUv = uOptions.w > 0.5 ? fract(vTextureCoord) : vTextureCoord;
    vec4 color = texture2D(uColor, spriteUv);
    float alpha = color.a * uOptions.z;
    if (alpha <= 0.0) discard;
    vec3 n = vec3(0.0, 0.0, 1.0);
    float ao = 1.0;
    if (uFlags > 0.5) {
        vec4 s = texture2D(uSurface, spriteUv);
        if (mod(uFlags, 2.0) > 0.5) n = strengthen(decodeNormal(s.rg), uOptions.x);
        if (uFlags > 1.5) ao = s.b;
    }
    if (mod(uFlags, 2.0) < 0.5 && uOptions.y > 0.0) n = autoNormal(uOptions.y);
    gl_FragColor = vec4(encodeNormal(n), ao, 1.0) * alpha;
}
`;

// Lights for the surface pass: drawn at full resolution with no shadows,
// each its falloff times surfaceShading(): how it falls on the surface
// there, from the surface buffer. Same quads as LIGHT_VERTEX, plus where each
// point is in the surface buffer (uSurfaceMap: scale xy, offset zw).
export const SHADING_VERTEX = `
attribute vec2 aVertexPosition;

uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uCenter;
uniform vec2 uDirection;
uniform vec4 uBox;
uniform vec4 uSurfaceMap;

varying vec2 vLocal;
varying vec2 vOffset;
varying vec2 vSurfaceUv;

void main(void) {
    vLocal = uBox.xy + aVertexPosition * uBox.zw;
    vec2 across = vec2(-uDirection.y, uDirection.x);
    vOffset = uDirection * vLocal.x + across * vLocal.y;
    vec2 position = uCenter + vOffset;
    vSurfaceUv = position * uSurfaceMap.xy + uSurfaceMap.zw;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
}
`;

// The way to the light on screen from a point vOffset from it: straight to
// a point light or cone, or back to a beam's start line (as shadows see it).
const TO_LIGHT = {
    point: "-vOffset",
    cone: "-vOffset",
    beam: "uToLight * -dot(vOffset, uToLight)",
};

export function shadingFragmentFor(shape) {
    const { uniforms, body } = shapeParts(shape);
    return `
${HIGH}

uniform vec3 uColor;
uniform float uRadius;
uniform float uHeight;
uniform vec2 uToLight;
uniform sampler2D uSurface;
${uniforms}
varying vec2 vLocal;
varying vec2 vOffset;
varying vec2 vSurfaceUv;
${NORMALS}
void main(void) {
${body}
    vec3 n = decodeNormal(texture2D(uSurface, vSurfaceUv).rg);
    vec2 toLight = ${TO_LIGHT[shape]};
    float k = clamp(n.z + dot(n.xy, toLight) / max(uHeight, 1.0), 0.0, ${float(MAX_SHADING)});
    gl_FragColor = vec4(uColor * f * k, 0.0);
}
`;
}

// The composite with surfaces: the light at each pixel is
//
//   ambient + shaded lights * (red / green of the weights) * AO
//
// AO eased toward 1 by uAOStrength. The ambient (the global light, or the
// map's) lights every surface evenly, maps or not: only lights shade them,
// and only what they add sinks into creases. The weights are at Light Quality
// resolution, the rest at full resolution. Then darken and brighten as in
// DARKEN_FRAGMENT and BRIGHTEN_FRAGMENT. uLit is 0 with no lights on screen,
// when the light buffers are not drawn at all.
const surfaceLight = `
${HIGH}

uniform sampler2D uWeights;
uniform sampler2D uShading;
uniform sampler2D uSurface;
uniform vec3 uAmbient;
uniform float uScale;
uniform float uCap;
uniform float uAOStrength;
uniform float uLit;

varying vec2 vTextureCoord;

vec3 light() {
    vec3 light = uAmbient;
    if (uLit > 0.5) {
        float ao = 1.0 - (1.0 - texture2D(uSurface, vTextureCoord).b) * uAOStrength;
        vec2 w = texture2D(uWeights, vTextureCoord).rg;
        float seen = w.y > 0.0 ? min(w.x / w.y, 1.0) : 0.0;
        light += texture2D(uShading, vTextureCoord).rgb * uScale * seen * ao;
    }
    return light;
}
`;

export const DARKEN_SURFACE_FRAGMENT = `${surfaceLight}
void main(void) {
    gl_FragColor = vec4(min(light(), vec3(1.0)), 1.0);
}
`;

export const BRIGHTEN_SURFACE_FRAGMENT = `${surfaceLight}
void main(void) {
    gl_FragColor = vec4(clamp(min(light(), vec3(uCap)) - 1.0, 0.0, 1.0), 1.0);
}
`;
