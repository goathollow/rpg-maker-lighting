// Light shapes, worked out in "light space": x runs along the direction the
// light points, y across it, both in pixels from the light's position.
//
//   point  a circle of the light's radius
//   cone   a slice of that circle, `spread` degrees wide, with soft sides
//   beam   a strip `width` wide and `radius` long, starting at the light
//
// The falloff functions must match the fragment shaders in src/mz/shaders.js.

export const SHAPES = Object.freeze(["point", "cone", "beam"]);

// Brightness at distance `d` from the centre, as a fraction of the radius.
// Smooth, and exactly zero from the radius outwards.
export function lightFalloff(d) {
    const f = Math.max(1 - d * d, 0);
    return f * f;
}

// A cone's sides fade over this fraction of its half-angle.
const CONE_SOFTNESS = 0.3;

// A beam is fully bright across this fraction of its width, then fades.
const BEAM_CORE = 0.5;

export function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// Cosines of a cone's inner (fully bright) and outer (dark) half-angles.
// A full 360 degrees would still fade out behind the light, so it gets edges
// below any cosine: lit all the way round.
export function coneEdges(spread, out = [0, 0]) {
    if (spread >= 360) {
        out[0] = -2;
        out[1] = -3;
        return out;
    }
    const half = ((spread / 2) * Math.PI) / 180;
    out[0] = Math.cos(half * (1 - CONE_SOFTNESS));
    out[1] = Math.cos(half);
    return out;
}

// Brightness at light-space (x, y), 0..1.
export function shapeFalloff(light, x, y) {
    const r = light.radius;
    if (light.shape === "beam") {
        if (x < 0) return 0;
        const across = Math.abs(y) / (light.width / 2);
        return lightFalloff(x / r) * (1 - smoothstep(BEAM_CORE, 1, across));
    }
    const d = Math.hypot(x, y);
    const f = lightFalloff(d / r);
    if (light.shape !== "cone") return f;
    const [inner, outer] = coneEdges(light.spread);
    return f * smoothstep(outer, inner, x / Math.max(d, 1e-4));
}

// The rectangle in light space that the shape's quad covers, as
// [centreX, centreY, halfWidth, halfHeight]. Everything the shape lights is
// inside it; a narrow cone or a beam covers far fewer pixels than its circle.
export function lightBox(light, out = [0, 0, 0, 0]) {
    const r = light.radius;
    let x0 = -r;
    let x1 = r;
    let y1 = r;
    if (light.shape === "beam") {
        x0 = 0;
        y1 = light.width / 2;
    } else if (light.shape === "cone") {
        const half = ((light.spread / 2) * Math.PI) / 180;
        x0 = half < Math.PI / 2 ? 0 : r * Math.cos(half);
        y1 = half < Math.PI / 2 ? r * Math.sin(half) : r;
    }
    out[0] = (x0 + x1) / 2;
    out[1] = 0;
    out[2] = (x1 - x0) / 2;
    out[3] = y1;
    return out;
}

// How far from its position a light can reach, for culling.
export function lightReach(light) {
    return light.shape === "beam" ? Math.hypot(light.radius, light.width / 2) : light.radius;
}

// Directions are degrees clockwise from up: 0 up, 90 right, 180 down, 270 left.
// MZ's character directions are numpad digits (8 up, 6 right, 2 down, 4 left;
// 7, 9, 1, 3 for the diagonals some movement plugins add).
const FACING_ANGLES = { 8: 0, 9: 45, 6: 90, 3: 135, 2: 180, 1: 225, 4: 270, 7: 315 };

export function lightAngle(direction, facing) {
    if (direction === "facing") return FACING_ANGLES[facing] ?? 180;
    return direction;
}

// Screen-space unit vector for an angle (screen y points down).
export function angleVector(degrees, out = [0, 0]) {
    const a = (degrees * Math.PI) / 180;
    out[0] = Math.sin(a);
    out[1] = -Math.cos(a);
    return out;
}

// Turns `current` toward `target` by at most `step` degrees, the short way
// round, landing exactly on the target.
export function turnToward(current, target, step) {
    const diff = ((((target - current) % 360) + 540) % 360) - 180;
    if (Math.abs(diff) <= step) return target;
    return (current + Math.sign(diff) * step + 360) % 360;
}

// Screen position (px, py) to light space, for a light at (cx, cy) pointing
// at `degrees`. The inverse of what the light vertex shader does.
export function toLightSpace(px, py, cx, cy, degrees) {
    const [dx, dy] = angleVector(degrees);
    const x = px - cx;
    const y = py - cy;
    return [x * dx + y * dy, -x * dy + y * dx];
}
