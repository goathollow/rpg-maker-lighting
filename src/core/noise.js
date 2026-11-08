// Deterministic 1D value noise. There is no Math.random here: the same
// (t, seed) gives the same value on every machine and every frame, which keeps
// screenshot tests stable and lets lights share a seed to flicker in sync.

// Integer hash (lowbias32 by Chris Wellons), mapped to [-1, 1].
export function hash(i, seed) {
    let x = (Math.imul(i | 0, 0x9e3779b1) + Math.imul(seed | 0, 0x85ebca77) + 0x165667b1) | 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) / 2147483647.5 - 1;
}

// Blend weight between two lattice values. k = 1 is linear, k = 2 is a soft
// S-curve that eases in and out, and large k approaches a hard step halfway
// between the points.
export function ease(f, k) {
    const a = f ** k;
    return a / (a + (1 - f) ** k);
}

// A new random target every whole unit of t, eased between with ease(k).
export function valueNoise(t, seed, k = 2) {
    const i = Math.floor(t);
    const a = hash(i, seed);
    const b = hash(i + 1, seed);
    return a + (b - a) * ease(t - i, k);
}
