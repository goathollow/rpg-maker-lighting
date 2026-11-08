import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildCasterGrid, casterAt, distanceField, sampleField } from "../../src/core/field.js";
import { DEFAULT_LIGHT } from "../../src/core/lights.js";
import { OUTLINE_SLOT, outlineField } from "../../src/core/outlines.js";
import {
    AUTO_SHADOW,
    lightClear,
    MAX_CASTERS,
    pickCasters,
    resolveShadow,
    shadowRay,
    shadowVisibility,
} from "../../src/core/shadows.js";
import { angleVector } from "../../src/core/shapes.js";

const TILE = 48;
const light = (values = {}) => ({ ...DEFAULT_LIGHT, ...values });

// A map from rows of text: "#" casts shadows.
function fieldOf(rows) {
    const width = rows[0].length;
    const height = rows.length;
    const grid = buildCasterGrid(width, height, (x, y) => rows[y][x] === "#");
    return distanceField({ grid, width, height, loopX: false, loopY: false }, { tile: TILE });
}

// The center of tile (x, y), plus an offset in pixels.
const at = (x, y, dx = 0, dy = 0) => [(x + 0.5) * TILE + dx, (y + 0.5) * TILE + dy];

// How much of `l`, at map pixel `from`, the point `to` sees. Characters are
// given on the map too, and made relative to the light here.
function sees(field, l, from, to, characters = []) {
    const [lx, ly] = from;
    const inside = casterAt(field, Math.floor(lx / TILE), Math.floor(ly / TILE));
    const clear = lightClear(l, inside, TILE);
    const parallel = l.shape === "beam";
    const params = { clear, softness: l.softness, height: l.height, tile: TILE, mapX: lx, mapY: ly, parallel };
    const [dx, dy] = angleVector(typeof l.direction === "number" ? l.direction : 180);
    const qx = to[0] - lx;
    const qy = to[1] - ly;
    const [ux, uy, D] = shadowRay(l, qx, qy, dx, dy);
    const casters = characters.map((c) => ({ ...c, x: c.x - lx, y: c.y - ly }));
    return shadowVisibility(qx, qy, ux, uy, D, params, casters, (x, y) => sampleField(field, lx + x, ly + y));
}

const ROOM = [
    "............",
    "............",
    ".....#......",
    "............",
    "............",
];

describe("tile shadows", () => {
    const field = fieldOf(ROOM);

    test("a caster between a point and the light shadows it; with nothing between, it is lit", () => {
        const torch = light();
        assert.equal(sees(field, torch, at(2, 2), at(8, 2)), 0);
        assert.equal(sees(field, torch, at(2, 2), at(4, 0)), 1);
        assert.equal(sees(field, torch, at(2, 2), at(2, 4)), 1);
    });

    test("shadow edges are soft, and widen with distance behind the caster", () => {
        const torch = light({ softness: 12 });
        // The block's shadow edge runs from the light past the block's top
        // corner. Sweep from above it to the middle of the shadow, at two
        // distances behind the block.
        const width = (x) => {
            const values = [];
            for (let y = 0; y <= 2.5 * TILE; y += 0.5) values.push(sees(field, torch, at(2, 2), [x, y]));
            for (let i = 1; i < values.length; i++) assert.ok(values[i] <= values[i - 1] + 1e-9, "darkens steadily");
            return values.filter((v) => v > 0.1 && v < 0.9).length * 0.5;
        };
        const near = width(7 * TILE);
        const far = width(11 * TILE);
        assert.ok(near > 2, `near ${near}`);
        assert.ok(far > near * 1.5, `near ${near}, far ${far}`);
    });

    test("a light with no softness casts hard edges", () => {
        const spot = light({ softness: 0 });
        let soft = 0;
        for (let y = 0; y <= 2 * TILE; y += 0.5) {
            const v = sees(field, spot, at(2, 2), [10 * TILE, 1.5 * TILE + y]);
            if (v > 0.05 && v < 0.95) soft++;
        }
        assert.ok(soft <= 4, `${soft} half-pixel steps in between`);
    });

    test("a wall's face toward the light catches it, to a tile's depth", () => {
        const wall = fieldOf(["............", "############", "############", "............", "............"]);
        const lamp = light();
        assert.ok(sees(wall, lamp, at(5, 4), at(5, 2, 0, 20)) > 0.99, "first row, near side");
        assert.ok(sees(wall, lamp, at(5, 4), at(5, 2, 0, -20)) > 0.99, "first row, far side");
        assert.equal(sees(wall, lamp, at(5, 4), at(5, 1)), 0, "second row");
        assert.equal(sees(wall, lamp, at(5, 4), at(5, 0)), 0, "beyond the wall");
    });

    test("the edge of a long wall is lit evenly, even far along it from the light", () => {
        const wall = fieldOf(["....................", "....................", "####################", "...................."]);
        const lamp = light({ softness: 4 });
        for (let x = 4; x < 20; x++) {
            for (const dy of [-18, 0, 18]) {
                assert.ok(sees(wall, lamp, at(1, 1), at(x, 2, 0, dy)) > 0.99, `tile ${x}, ${dy}`);
            }
        }
    });

    test("the inside corner of a wall is lit through the open corner facing the light", () => {
        const corner = fieldOf(["#.....", "#.....", "######", "......"]);
        const lamp = light();
        assert.ok(sees(corner, lamp, at(3, 0), at(0, 2)) > 0.99, "corner");
        assert.ok(sees(corner, lamp, at(3, 0), at(0, 1)) > 0.99, "upright");
        assert.ok(sees(corner, lamp, at(3, 0), at(2, 2)) > 0.99, "along the bottom");
    });

    test("a light hung on a casting tile still shines out of it", () => {
        const post = light();
        assert.equal(sees(field, post, at(5, 2), at(5, 4)), 1);
        assert.equal(sees(field, post, at(5, 2), at(8, 3)), 1);
    });

    test("a light on top of a wall lights the wall it can see through, but not walls beyond", () => {
        const walls = fieldOf([
            "....#....",
            "....#....",
            "....#....",
            "....#....",
            "....#....",
            ".........",
            "....#....",
            "....#....",
        ]);
        const lamp = light();
        for (let y = 0; y < 4; y++) assert.equal(sees(walls, lamp, at(4, 4), at(4, y)), 1, `pillar, row ${y}`);
        assert.ok(sees(walls, lamp, at(4, 4), at(4, 6, 0, 10)) > 0.99, "the next wall, a tile deep");
        assert.equal(sees(walls, lamp, at(4, 4), at(4, 7)), 0, "the next wall, further in");
    });

    test("a light right beside a wall is not dimmed by it", () => {
        const lamp = light({ softness: 8 });
        const beside = at(5, 3, 0, -TILE / 2 + 2); // 2 px below the block
        assert.equal(sees(field, lamp, beside, at(5, 4, 0, 10)), 1);
        assert.equal(sees(field, lamp, beside, at(3, 4)), 1);
    });
});

// The outline of a 48 x 48 sprite, opaque where solid(x, y) says (in its
// pixels, y down from the top).
function spriteOutline(solid) {
    const scale = OUTLINE_SLOT / 48;
    const alpha = new Uint8Array(OUTLINE_SLOT * OUTLINE_SLOT);
    for (let y = 0; y < OUTLINE_SLOT; y++) {
        for (let x = 0; x < OUTLINE_SLOT; x++) {
            alpha[y * OUTLINE_SLOT + x] = solid((x + 0.5) / scale, (y + 0.5) / scale) ? 255 : 0;
        }
    }
    return outlineField(alpha, OUTLINE_SLOT, OUTLINE_SLOT);
}

// A character 48 px tall standing at (x, y), 12 px above the bottom of its
// sprite, as the lighting layer places it. Its sprite is a post 24 px wide
// unless given another outline.
const POST = spriteOutline((x) => Math.abs(x - 24) < 12);
const standing = (x, y, values = {}) => ({ x, y, r: 12, jump: 0, w: 48, h: 48, sw: 48, sh: 48, outline: POST, ...values });

describe("character shadows", () => {
    const open = fieldOf(["............", "............", "............", "............", "............"]);
    // A character two tiles right of the light.
    const from = at(2, 2);
    const character = standing(from[0] + 96, from[1]);
    const behind = (distance) => [character.x + distance, character.y];

    // Lights lower than the character, so its shadows run to their edge.
    test("a character shadows what is behind it, away from the light", () => {
        const torch = light({ height: 24 });
        assert.equal(sees(open, torch, from, behind(14), [character]), 0);
        assert.equal(sees(open, torch, from, [character.x - 30, character.y], [character]), 1);
        assert.equal(sees(open, torch, from, [character.x + 14, character.y + 40], [character]), 1);
    });

    test("the higher the light, the shorter the shadow", () => {
        // A light at twice the character's height: the shadow is as long as
        // the character is far from the light.
        const lamp = light({ height: 96, softness: 0 });
        assert.equal(sees(open, lamp, from, behind(80), [character]), 0);
        assert.equal(sees(open, lamp, from, behind(112), [character]), 1);
        // A light lower than the character: the shadow runs to the light's edge.
        const fire = light({ height: 24, softness: 0 });
        assert.equal(sees(open, fire, from, behind(300), [character]), 0);
    });

    test("a shadow has the shape of the sprite", () => {
        // A body on two legs, with a gap between them up to 18 px high.
        const legs = spriteOutline((x, y) => (y < 30 ? Math.abs(x - 24) < 12 : Math.abs(Math.abs(x - 24) - 7) < 4));
        const walker = { ...character, outline: legs };
        const lamp = light();
        // Just behind, the way to the light passes at the height of the legs.
        assert.equal(sees(open, lamp, from, behind(14), [walker]), 1, "between the legs");
        assert.equal(sees(open, lamp, from, [character.x + 14, character.y + 7], [walker]), 0, "behind a leg");
        assert.equal(sees(open, lamp, from, behind(60), [walker]), 0, "behind the body");
    });

    test("a character never darkens its own sprite, but does the ground beside it", () => {
        const torch = light({ height: 24 });
        // Lit from below, the shadow runs up the screen, where the sprite is.
        const below = [character.x, character.y + 100];
        assert.equal(sees(open, torch, below, [character.x, character.y - 20], [character]), 1);
        assert.equal(sees(open, torch, below, [character.x, character.y - 5], [character]), 1);
        assert.equal(sees(open, torch, below, [character.x, character.y - 60], [character]), 0);
        // Lit from below and to the left, the shadow runs up to the right,
        // over the clear part of its sprite's frame.
        const belowLeft = [character.x - 60, character.y + 80];
        assert.equal(sees(open, torch, belowLeft, [character.x + 15, character.y - 20], [character]), 0);
        assert.equal(sees(open, torch, belowLeft, [character.x + 9, character.y - 20], [character]), 1);
    });

    test("seen from in front or behind, a shadow keeps the sprite's left and right", () => {
        // A post with an arm out to the right, 24 to 32 px up.
        const arm = spriteOutline((x, y) => (x >= 12 && x < 36) || (x >= 36 && x < 44 && y >= 16 && y < 24));
        const height = 96;
        // Sunlight from the south, with the character 100 px into it: 41 px
        // behind, the way to the light passes 28 px up.
        const south = light({ shape: "beam", direction: 0, height });
        const north = light({ shape: "beam", direction: 180, height });
        const [x, y] = from;
        const lit = (l, source, person, point) => sees(open, l, source, point, [person]);
        const fromSouth = standing(x, y - 100, { outline: arm });
        assert.equal(lit(south, from, fromSouth, [x + 16, y - 141]), 0, "south: right");
        assert.equal(lit(south, from, fromSouth, [x - 16, y - 141]), 1, "south: left");
        const fromNorth = standing(x, y + 100, { outline: arm });
        assert.equal(lit(north, from, fromNorth, [x + 16, y + 141]), 0, "north: right");
        assert.equal(lit(north, from, fromNorth, [x - 16, y + 141]), 1, "north: left");
    });

    test("the tops of walls and roofs never catch a character's shadow", () => {
        // A wall along row 2, and a character a tile below it, lit from
        // below by a low light: its shadow runs up to the wall.
        const wall = fieldOf(["............", "............", "############", "............", "............", "............", "............"]);
        const person = standing(5.5 * TILE, 4 * TILE);
        const torch = light({ height: 24 });
        const below = [person.x, 6.25 * TILE];
        assert.equal(sees(wall, torch, below, [person.x, 3 * TILE + 6], [person]), 0, "the ground at the wall's foot");
        assert.equal(sees(wall, torch, below, [person.x, 3 * TILE - 6], [person]), 1, "the top of the wall");
        assert.equal(sees(wall, torch, below, [person.x, 3 * TILE - 6], []), 1, "as with nobody there");
    });

    test("light from low down passes under a jumping character", () => {
        const torch = light({ height: 24 });
        assert.equal(sees(open, torch, from, behind(14), [{ ...character, jump: 20 }]), 1);
    });

    test("a character with no outline yet casts none", () => {
        assert.equal(sees(open, light(), from, behind(14), [{ ...character, outline: null }]), 1);
    });

    test("a beam's shadows are parallel, like sunlight through a window", () => {
        const sun = light({ shape: "beam", direction: 180 });
        const [dx, dy] = angleVector(180);
        assert.deepEqual(shadowRay(sun, 10, 50, dx, dy).slice(0, 2), shadowRay(sun, -30, 200, dx, dy).slice(0, 2));
        assert.equal(shadowRay(sun, -30, 200, dx, dy)[2], 200);
        const window = at(5, 0);
        const person = { ...character, x: window[0], y: window[1] + 100 };
        assert.equal(sees(open, sun, window, [window[0] - 30, window[1] + 110], [person]), 1);
        assert.equal(sees(open, sun, window, [window[0], window[1] + 112], [person]), 0);
    });
});

describe("picking characters", () => {
    const f = (id, x, y) => ({ id, ...standing(x, y) });

    // A light held 24 px above where its owner stands.
    const lamp = (reach, clear) => ({ x: 100, y: 76, reach, clear });
    const owner = { id: "me", x: 100, y: 100 };
    const nobody = { id: null, x: -1000, y: -1000 };

    test("nearest first, relative to the light, and never the light's own", () => {
        const picked = pickCasters(lamp(200, 8), owner, [f("far", 250, 76), f("me", 100, 88), f("near", 130, 76)]);
        assert.deepEqual(picked.map((c) => [c.id, c.x, c.y]), [["near", 30, 0], ["far", 150, 0]]);
    });

    test("nor anyone standing where its owner stands, like gathered followers", () => {
        const picked = pickCasters(lamp(200, 8), owner, [f("follower", 100, 88), f("beside", 130, 88)]);
        assert.deepEqual(picked.map((c) => c.id), ["beside"]);
    });

    test("leaves out characters out of reach or standing in the light's clear zone", () => {
        // Half its 48 px shadow can reach in from beyond the light's reach.
        const light = { x: 0, y: 0, reach: 100, clear: 10 };
        const picked = pickCasters(light, nobody, [f("in", 5, 0), f("edge", 120, 0), f("out", 125, 0)]);
        assert.deepEqual(picked.map((c) => c.id), ["edge"]);
    });

    test("takes at most MAX_CASTERS", () => {
        const crowd = Array.from({ length: 20 }, (_, i) => f(i, 20 + i, 0));
        assert.equal(pickCasters({ x: 0, y: 0, reach: 500, clear: 4 }, nobody, crowd).length, MAX_CASTERS);
    });

    test("a light inside a caster clears a whole tile; others clear their softness", () => {
        assert.equal(lightClear(light({ softness: 12 }), false, TILE), 12);
        assert.equal(lightClear(light({ softness: 0 }), false, TILE), 4);
        assert.equal(lightClear(light({ softness: 12 }), true, TILE), TILE);
    });
});

describe("<shadow> tags", () => {
    const collect = () => {
        const messages = [];
        return { messages, warn: (msg) => messages.push(msg) };
    };

    test("a bare tag, or on, takes its size from the sprite", () => {
        assert.deepEqual(resolveShadow(""), AUTO_SHADOW);
        assert.deepEqual(resolveShadow("on"), AUTO_SHADOW);
    });

    test("off turns it off", () => {
        for (const text of ["off", "OFF", "none", "false"]) assert.equal(resolveShadow(text), null);
    });

    test("reads width and height, clamped", () => {
        assert.deepEqual(resolveShadow("width: 32 height: 60"), { width: 32, height: 60 });
        assert.deepEqual(resolveShadow("size: 9999"), { width: 480, height: null });
    });

    test("reports what it can't read", () => {
        const { messages, warn } = collect();
        resolveShadow("big width: wide hue: red", warn);
        assert.match(messages.join("\n"), /can't read shadow "big"/);
        assert.match(messages.join("\n"), /can't read shadow width "wide"/);
        assert.match(messages.join("\n"), /unknown shadow setting "hue"/);
    });
});
