import { describe, expect, it } from "vitest";
import {
  createWalker,
  detourAround,
  DIR_AWAY,
  DIR_DIAG_DOWN,
  DIR_DIAG_UP,
  DIR_SIDE,
  DIR_TOWARDS,
  dist,
  dropNearLine,
  edgeCrossing,
  escapePoint,
  f32,
  facingForAngle,
  findPath,
  findWalkTriangle,
  followPlan,
  forcedFacing,
  ftol,
  iabs,
  jackScale,
  lineIntersection,
  nearestWalkable,
  objectAt,
  offLine,
  perspThird,
  planWalk,
  pointBelowLine,
  quadContains,
  s16,
  segmentClear,
  segmentIntersection,
  smoothPath,
  spreadCandidates,
  startSegment,
  stepTicks,
  walkAngle,
  walkStep,
  walkTick,
  walkTriangleContains,
  type Point,
  type WalkObject,
  type WalkWorld,
} from "./index";

/** Scale 1 everywhere: horizon far above the screen. */
const FLAT = { horizonY: -10000, refY: 0, refScale: 1 };
/** 0..100 square split along the diagonal (vertices sorted by x, as in the data). */
const SQUARE = [
  [0, 0, 0, 100, 100, 100],
  [0, 0, 100, 0, 100, 100],
];
/** L-shaped corridor: a horizontal bar 0..300 x 0..40 and a vertical bar 260..300 x 0..300. */
const L = [
  [0, 0, 0, 40, 300, 40],
  [0, 0, 300, 0, 300, 40],
  [260, 0, 260, 300, 300, 300],
  [260, 0, 300, 0, 300, 300],
];
const world = (walk: number[][], objects: WalkObject[] = [], perspective = FLAT): WalkWorld => ({
  walk,
  objects,
  perspective,
});
/** Square object footprint at (x, y), corners clockwise on screen from the top left. */
const box = (x: number, y: number, w: number, h: number, valid = true): WalkObject => ({
  x,
  y,
  quad: [0, 0, w, 0, w, h, 0, h],
  center: [w >> 1, h >> 1],
  valid,
});
const P = (x: number, y: number): Point => ({ x, y });
const insideAll = (walk: number[][], pts: Point[]) => pts.every((p) => findWalkTriangle(walk, p.x, p.y) >= 0);

describe("numbers", () => {
  it("ftol truncates like __ftol and gives for NaN / overflow", () => {
    expect(ftol(2.9)).toBe(2);
    expect(ftol(-2.9)).toBe(-2);
    expect(ftol(NaN)).toBe(-2147483648);
    expect(ftol(Infinity)).toBe(-2147483648);
    expect(ftol(2 ** 31)).toBe(-2147483648);
    expect(ftol(2 ** 31 - 1)).toBe(2147483647);
  });
  it("s16 wraps, iabs keeps INT_MIN", () => {
    expect(s16(0x8000)).toBe(-32768);
    expect(s16(-2147483648)).toBe(0);
    expect(iabs(-5)).toBe(5);
    expect(iabs(-2147483648)).toBe(-2147483648);
  });
  it("dist is truncated", () => {
    expect(dist(P(0, 0), P(3, 4))).toBe(5);
    expect(dist(P(0, 0), P(1, 1))).toBe(1);
  });
});

describe("geometry", () => {
  it("pointBelowLine compares the unrounded product with a float slope", () => {
    // slope f32(1/3) * 3 = 1.0000000298 > 1: the point on the line is NOT below it
    expect(pointBelowLine(3, 1, 0, 0, 3, 1)).toBe(false);
    expect(pointBelowLine(3, 2, 0, 0, 3, 1)).toBe(true);
    // vertical edge: slope dy * 1e7
    expect(pointBelowLine(0, 5, 0, 0, 0, 10)).toBe(true);
    expect(pointBelowLine(1, 5, 0, 0, 0, 10)).toBe(false);
  });
  it("walk triangle test: x range x1..x3, y range, half-planes; some edges exclusive", () => {
    const t = [0, 0, 0, 100, 100, 100];
    expect(walkTriangleContains(t, 10, 50)).toBe(true);
    expect(walkTriangleContains(t, 50, 10)).toBe(false);
    expect(walkTriangleContains(t, 101, 100)).toBe(false);
    // for this orientation the edge x1-x3 (the diagonal) is inclusive, the x = 0 edge exclusive
    expect(walkTriangleContains(t, 50, 50)).toBe(true);
    expect(walkTriangleContains(t, 0, 50)).toBe(false);
    // unsorted vertices: x range x1..x3 is empty
    expect(walkTriangleContains([100, 100, 0, 0, 0, 100], 10, 50)).toBe(false);
    expect(findWalkTriangle(SQUARE, 50, 50)).toBe(0);
    // the shared diagonal belongs to the first triangle only
    expect(findWalkTriangle(SQUARE, 50, 50, 1)).toBe(-1);
    expect(findWalkTriangle(SQUARE, 200, 50)).toBe(-1);
  });
  it("segmentIntersection: crossing, parallel, outside, vertical", () => {
    expect(segmentIntersection(P(0, 0), P(100, 100), P(0, 100), P(100, 0))).toEqual(P(50, 50));
    expect(segmentIntersection(P(0, 0), P(100, 0), P(0, 10), P(100, 10))).toEqual(P(-1, -1));
    expect(segmentIntersection(P(0, 0), P(10, 10), P(0, 100), P(100, 0))).toEqual(P(-1, -1));
    // a vertical segment gets dx = 1/256: x = 49.998 truncates to 49, outside its box
    expect(segmentIntersection(P(50, 0), P(50, 100), P(0, 40), P(100, 40))).toEqual(P(-1, -1));
    // the same segment the other way round gives x = 50.0016
    expect(segmentIntersection(P(50, 100), P(50, 0), P(0, 40), P(100, 40))).toEqual(P(50, 40));
  });
  it("offLine: distance of the middle point from its neighbours' line (truncated twice)", () => {
    // |sin(atan(10/50))| * trunc(50.99) = 9.8
    expect(offLine(P(50, 10), P(0, 0), P(100, 0))).toBe(9);
    expect(offLine(P(50, 3), P(0, 0), P(100, 0))).toBe(2);
    expect(offLine(P(50, 0), P(0, 0), P(100, 0))).toBe(0);
    // prev == mid: atan(NaN) -> __ftol(NaN) -> -> short 0
    expect(offLine(P(0, 0), P(0, 0), P(100, 0))).toBe(0);
  });
  it("scales: Jack's clamped to 0.1..1, Persp_ScaleAtY divided by 3", () => {
    const p = { horizonY: 200, refY: 400, refScale: f32(0.5) };
    expect(jackScale(p, 400)).toBe(f32(0.5));
    expect(jackScale(p, 100)).toBe(f32(0.1));
    expect(jackScale(p, 2000)).toBe(1);
    expect(perspThird(p, 400)).toBeCloseTo(0.5 / 3, 9);
    expect(perspThird(p, 0)).toBeCloseTo(f32(0.1) / 3, 9);
  });
});

describe("findPath", () => {
  it("same triangle: start and target", () => {
    const r = findPath(SQUARE, P(10, 50), P(20, 80));
    expect(r.path).toEqual([P(10, 50), P(20, 80)]);
    expect(r.stats.found).toBe(1);
  });
  it("neighbouring triangles: a straight line through the shared edge", () => {
    const r = findPath(SQUARE, P(10, 80), P(80, 10));
    expect(r.path[0]).toEqual(P(10, 80));
    expect(r.path.at(-1)).toEqual(P(80, 10));
    expect(insideAll(SQUARE, r.path)).toBe(true);
    expect(r.stats.length).toBeLessThanOrEqual(dist(P(10, 80), P(80, 10)) + 2);
  });
  it("L corridor: goes round the corner, every point and segment inside", () => {
    const r = findPath(L, P(20, 20), P(280, 280));
    expect(r.path.length).toBeGreaterThan(2);
    expect(insideAll(L, r.path)).toBe(true);
    for (let i = 0; i + 1 < r.path.length; i++) expect(segmentClear(world(L), r.path[i], r.path[i + 1])).toBe(true);
    // never longer than going via the corridor centre lines
    expect(r.stats.length).toBeLessThan(dist(P(20, 20), P(280, 20)) + dist(P(280, 20), P(280, 280)) + 20);
  });
  it("reverse search wins when it is shorter and the result is reversed back", () => {
    const fwd = findPath(L, P(280, 280), P(20, 20));
    const back = findPath(L, P(20, 20), P(280, 280));
    expect(fwd.path[0]).toEqual(P(280, 280));
    expect(back.path[0]).toEqual(P(20, 20));
    expect(fwd.stats.length).toBe(back.stats.length);
  });
  it("no path: target or start outside, disconnected parts", () => {
    expect(findPath(SQUARE, P(10, 50), P(500, 50)).path).toEqual([]);
    expect(findPath(SQUARE, P(500, 50), P(10, 50)).path).toEqual([]);
    const apart = [...SQUARE, [300, 0, 300, 100, 400, 100]];
    const r = findPath(apart, P(10, 50), P(310, 90));
    expect(r.path).toEqual([]);
    expect(r.stats.found).toBe(0);
  });
  it("budget stops improving after the first path", () => {
    const full = findPath(L, P(20, 20), P(280, 280));
    const quick = findPath(L, P(20, 20), P(280, 280), { budget: 0 });
    expect(quick.path.length).toBeGreaterThan(0);
    expect(quick.stats.calls).toBeLessThanOrEqual(full.stats.calls);
    expect(quick.stats.length).toBeGreaterThanOrEqual(full.stats.length);
  });
  it("spreadCandidates: pulled towards the sum, near duplicates dropped, one bubble pass only", () => {
    // 20/(n+20) of the point + 1/(n+20) of every point
    expect(spreadCandidates([P(0, 0), P(21, 0)], P(0, 0))).toEqual([P(0, 0), P(20, 0)]);
    expect(spreadCandidates([P(10, 10), P(11, 10), P(10, 12)], P(0, 0))).toEqual([P(10, 10)]);
    // pulled to 286, 200, 113; one bubble pass moves only the farthest to the end
    const r = spreadCandidates([P(300, 0), P(200, 0), P(100, 0)], P(0, 0));
    expect(r.map((p) => p.x)).toEqual([200, 113, 286]);
  });
});

describe("smoothing", () => {
  it("nearestWalkable: first of 16 rays with the fewest 5 px steps", () => {
    // left of the square: the ray at 92 degrees (x = sin) reaches x >= 0 first
    const n = nearestWalkable(SQUARE, P(-12, 50))!;
    expect(findWalkTriangle(SQUARE, n.x, n.y)).toBeGreaterThanOrEqual(0);
    expect(n.x).toBeLessThan(5);
    expect(nearestWalkable(SQUARE, P(20, 50))).toEqual(P(20, 50));
    expect(nearestWalkable(SQUARE, P(5000, 5000))).toBeNull();
  });
  it("dropNearLine removes points closer than 6 px to the neighbours' line", () => {
    const p = [P(0, 0), P(50, 5), P(100, 0), P(100, 50)];
    dropNearLine(p);
    expect(p).toEqual([P(0, 0), P(100, 0), P(100, 50)]);
    // 50, 6 is 5.96 px off after truncation, 50, 7 is 6.9
    const q = [P(0, 0), P(50, 7), P(100, 0)];
    dropNearLine(q);
    expect(q).toHaveLength(3);
  });
  it("quads: containment, only valid quads are found, escape point lies outside", () => {
    const o = box(40, 40, 20, 20);
    expect(quadContains(o, P(50, 50))).toBe(true);
    expect(quadContains(o, P(70, 50))).toBe(false);
    expect(objectAt([box(40, 40, 20, 20, false), o], P(50, 50))).toBe(1);
    expect(objectAt([o], P(10, 10))).toBe(-1);
    const e = escapePoint(o, P(50, 43));
    expect(quadContains(o, e)).toBe(false);
    expect(e.y).toBeLessThan(43);
  });
  it("edge and line intersections", () => {
    const o = box(40, 40, 20, 20);
    expect(edgeCrossing(o, 3, P(0, 50), P(100, 50))).toEqual(P(40, 50));
    expect(edgeCrossing(o, 1, P(0, 50), P(100, 50))).toEqual(P(60, 50));
    expect(edgeCrossing(o, 0, P(0, 50), P(100, 50))).toBeNull();
    expect(lineIntersection(P(0, 0), P(10, 10), P(0, 10), P(10, 0))).toEqual(P(5, 5));
    expect(lineIntersection(P(0, 0), P(10, 0), P(0, 5), P(10, 5))).toBeNull();
  });
  it("segmentClear samples every 4 px from a, end point excluded", () => {
    const w = world(SQUARE, [box(40, 40, 20, 20)]);
    expect(segmentClear(w, P(10, 10), P(90, 10))).toBe(true);
    expect(segmentClear(w, P(10, 50), P(90, 50))).toBe(false);
    expect(segmentClear(w, P(10, 10), P(10, 300))).toBe(false);
    expect(segmentClear(w, P(10, 10), P(10, 12))).toBe(true);
  });
  it("detour around a quad: both directions, cheaper one, outside-area penalty", () => {
    const big = [
      [0, 0, 0, 200, 200, 200],
      [0, 0, 200, 0, 200, 200],
    ];
    const w = world(big, [box(80, 80, 40, 40)]);
    const fwd = detourAround(w, 0, 3, 1, P(60, 100), P(140, 100), true);
    const back = detourAround(w, 0, 3, 1, P(60, 100), P(140, 100), false);
    // forward: corners 0 (top left) and 1 (top right); backward: 3 and 2 (bottom)
    expect(fwd.points.slice(1, -1).map((p) => p.y < 80)).toEqual([true, true]);
    expect(back.points.slice(1, -1).map((p) => p.y > 120)).toEqual([true, true]);
    // pushed corners truncate towards zero: top ones end 32 px from the centre, bottom 31
    expect(fwd.cost - back.cost).toBe(1);
    const narrow = world(
      [
        [0, 0, 0, 120, 200, 120],
        [0, 0, 200, 0, 200, 120],
      ],
      [box(80, 80, 40, 40)],
    );
    const b2 = detourAround(narrow, 0, 3, 1, P(60, 100), P(140, 100), false);
    expect(b2.cost).toBeGreaterThan(2000);
  });
  it("smoothPath: detour around an object across the path, then shortcuts", () => {
    const big = [
      [0, 0, 0, 200, 200, 200],
      [0, 0, 200, 0, 200, 200],
    ];
    const w = world(big, [box(80, 90, 40, 20)]);
    const stats = { detours: 0, invalidQuadDetours: 0, noExit: 0, shortcuts: 0 };
    const out = smoothPath(w, [P(10, 100), P(190, 100)], 1, stats);
    expect(stats.detours).toBe(1);
    expect(out[0]).toEqual(P(10, 100));
    expect(out.at(-1)).toEqual(P(190, 100));
    expect(out.length).toBeGreaterThan(2);
    for (let i = 0; i + 1 < out.length; i++) {
      for (let k = 0; k <= 10; k++) {
        const x = out[i].x + ((out[i + 1].x - out[i].x) * k) / 10;
        const y = out[i].y + ((out[i + 1].y - out[i].y) * k) / 10;
        expect(quadContains(w.objects[0], P(Math.trunc(x), Math.trunc(y)))).toBe(false);
      }
    }
  });
  it("smoothPath: target in an object cancels a click walk (mode 1), is moved out otherwise", () => {
    const w = world(SQUARE, [box(40, 40, 20, 20)]);
    expect(smoothPath(w, [P(10, 10), P(50, 50)], 1)).toEqual([]);
    const m0 = smoothPath(w, [P(10, 10), P(50, 45)], 0);
    expect(m0.at(-1)).toEqual(P(50, 45));
    expect(quadContains(w.objects[0], m0.at(-2)!)).toBe(false);
  });
  it("smoothPath: start in an object is moved out and put back in front", () => {
    const w = world(SQUARE, [box(40, 40, 20, 20)]);
    const r = smoothPath(w, [P(50, 45), P(90, 10)], 1);
    expect(r[0]).toEqual(P(50, 45));
    expect(quadContains(w.objects[0], r[1])).toBe(false);
  });
});

describe("walker", () => {
  it("facing sectors (0 = right, 90 = down), bounds inclusive as in the game", () => {
    const f = (d: number) => {
      const r = facingForAngle(d);
      return [r.dir, r.mirror];
    };
    expect(f(0)).toEqual([DIR_SIDE, -1]);
    expect(f(21)).toEqual([DIR_SIDE, -1]);
    expect(f(22)).toEqual([DIR_DIAG_DOWN, -1]);
    expect(f(67)).toEqual([DIR_DIAG_DOWN, -1]);
    expect(f(90)).toEqual([DIR_TOWARDS, 1]);
    expect(f(112)).toEqual([DIR_DIAG_DOWN, 1]);
    expect(f(180)).toEqual([DIR_SIDE, 1]);
    expect(f(225)).toEqual([DIR_DIAG_UP, -1]);
    expect(f(270)).toEqual([DIR_AWAY, 1]);
    expect(f(315)).toEqual([DIR_DIAG_UP, 1]);
    expect(f(339)).toEqual([DIR_SIDE, -1]);
  });
  it("forced facing values of a script", () => {
    expect(forcedFacing(-3)).toEqual({ dir: 3, mirror: -1 });
    expect(forcedFacing(4)).toEqual({ dir: 4, mirror: 1 });
    expect(forcedFacing(7)).toEqual({ dir: 1, mirror: -1 });
  });
  it("SC033 from SC063: script forces 4 (right-up) while the walk goes left-up (original script quirk)", () => {
    // WALKTODIR JACK 535 410 4 from (690, 440): the angle sector says left-up (4, mirror -1), the script forces mirror +1.
    const { deg } = walkAngle(690, 440, 535, 410);
    const natural = facingForAngle(deg);
    expect(natural).toEqual({ dir: 4, mirror: -1 });
    expect(forcedFacing(4)).toEqual({ dir: 4, mirror: 1 });
    expect(forcedFacing(-4)).toEqual(natural);
  });
  it("walk angle uses dy / 0.3", () => {
    expect(walkAngle(0, 0, 100, 0).deg).toBe(0);
    expect(walkAngle(0, 0, 0, 100).deg).toBe(90);
    expect(walkAngle(0, 0, -100, 0).deg).toBe(180);
    expect(walkAngle(0, 0, 0, -100).deg).toBe(270);
    // 10 right, 3 down on screen = 45 degrees on the floor
    expect(walkAngle(0, 0, 100, 30).deg).toBe(45);
  });
  it("startSegment: velocity 12 px horizontally, 3.6 px vertically; near target = arrived at once", () => {
    const w = world(SQUARE);
    const k = createWalker(10, 50, w);
    expect(startSegment(k, P(90, 50))).toBe(false);
    expect(k.vx).toBeCloseTo(12, 5);
    expect(k.walking).toBe(true);
    const v = createWalker(10, 10, w);
    startSegment(v, P(10, 90));
    expect(v.vy).toBeCloseTo(3.6, 5);
    expect(v.dir).toBe(DIR_TOWARDS);
    const n = createWalker(10, 10, w, { dir: 2, mirror: 1 });
    expect(startSegment(n, P(24, 15))).toBe(true);
    expect([n.x, n.y, n.dir, n.walking]).toEqual([24, 15, 2, false]);
  });
  it("walks straight, stops 2-3 steps early and snaps onto the target", () => {
    const w = world(SQUARE);
    const k = createWalker(0, 50, w);
    followPlan(k, { path: [P(0, 50), P(100, 50)], direct: false, fromOutside: false });
    const xs: number[] = [];
    for (let i = 0; i < 20 && k.walking; i++) {
      walkStep(k, w);
      xs.push(k.x);
    }
    expect(xs.slice(0, 3)).toEqual([12, 24, 36]);
    expect(k.walking).toBe(false);
    expect([k.x, k.y]).toEqual([100, 50]);
    // 84 + 4 steps ahead overshoots the distance one step before
    expect(xs.at(-2)).toBe(84);
  });
  it("speed follows the perspective scale", () => {
    const p = { horizonY: 0, refY: 100, refScale: 1 };
    const w = world(
      [
        [0, 0, 0, 100, 500, 100],
        [0, 0, 500, 0, 500, 100],
      ],
      [],
      p,
    );
    const k = createWalker(0, 50, w);
    expect(k.scale).toBe(0.5);
    followPlan(k, { path: [P(0, 50), P(400, 50)], direct: false, fromOutside: false });
    walkStep(k, w);
    expect(k.x).toBe(6);
  });
  it("walkTick steps every N logic ticks (g_insFrameDelay - WalkSpeed option)", () => {
    expect(stepTicks(1)).toBe(4);
    expect(stepTicks(1, 4)).toBe(3);
    expect(stepTicks(6)).toBe(1);
    const w = world(SQUARE);
    const k = createWalker(0, 50, w);
    followPlan(k, { path: [P(0, 50), P(100, 50)], direct: false, fromOutside: false });
    const moved: number[] = [];
    for (let t = 0; t < 9; t++) moved.push(walkTick(k, w).length);
    expect(moved).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it("multi-point path: next point without moving, then on", () => {
    const w = world(L);
    const k = createWalker(20, 20, w);
    const plan = planWalk(w, k, P(280, 280))!;
    expect(plan.path.length).toBeGreaterThan(2);
    followPlan(k, plan);
    let next = 0;
    for (let t = 0; t < 500 && k.walking; t++) next += walkTick(k, w).filter((e) => e.nextPoint).length;
    expect(k.walking).toBe(false);
    expect([k.x, k.y]).toEqual([280, 280]);
    expect(next).toBe(plan.path.length - 2);
  });
  it("planWalk: click outside ignored, from outside via the nearest point, disconnected = direct", () => {
    const w = world(SQUARE);
    expect(planWalk(w, { x: 10, y: 10 }, P(500, 10))).toBeNull();
    const out = planWalk(w, { x: -12.5, y: 50 }, P(80, 90))!;
    expect(out.fromOutside).toBe(true);
    expect(out.path[0]).toEqual(P(-12, 50));
    const apart = world([...SQUARE, [300, 0, 300, 100, 400, 100]]);
    const d = planWalk(apart, { x: 10, y: 50 }, P(310, 90))!;
    expect(d.direct).toBe(true);
    const k = createWalker(10, 50, apart);
    followPlan(k, d);
    for (let t = 0; t < 500 && k.walking; t++) walkTick(k, apart);
    expect([k.x, k.y]).toEqual([310, 90]);
  });
});
