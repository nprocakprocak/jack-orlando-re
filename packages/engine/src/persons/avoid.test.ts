import { describe, expect, it } from "vitest";
import type { WalkObject } from "../walk/objects";
import type { WalkWorld } from "../walk/smooth";
import { createWalker } from "../walk/walker";
import {
  applyStand,
  avoidPerson,
  dist2,
  dist3,
  escapeCandidates,
  sortCandidates,
  startAvoidWalk,
  type AvoidJack,
  type AvoidPerson,
} from "./avoid";

const FLAT = { horizonY: -10000, refY: 0, refScale: 1 };
const FLOOR = [
  [0, 0, 0, 600, 1000, 600],
  [0, 0, 1000, 0, 1000, 600],
];
const world = (walk: number[][] = FLOOR, objects: WalkObject[] = []): WalkWorld => ({
  walk,
  objects,
  perspective: FLAT,
});
const box = (x: number, y: number, w: number, h: number): WalkObject => ({
  x,
  y,
  quad: [0, 0, w, 0, w, h, 0, h],
  center: [w >> 1, h >> 1],
  valid: true,
});
const jack = (over: Partial<AvoidJack> = {}): AvoidJack => ({ x: 500, y: 300, scale: 1, ...over });
const person = (over: Partial<AvoidPerson> = {}): AvoidPerson => ({
  x: 400,
  y: 300,
  scale: 1,
  shadowDx: 0,
  shadowDy: 0,
  velX: 10,
  velY: 0,
  ...over,
});
const run = (j: AvoidJack, p: AvoidPerson, w = world(), busy = false) => avoidPerson(j, p, w, busy);

describe("distances", () => {
  it("dist3 triples the y delta, dist2 does not; both truncate", () => {
    expect(dist3(0, 0, 3, 4)).toBe(12); // sqrt(9 + 144)
    expect(dist2(0, 0, 3, 4)).toBe(5);
    expect(dist2(0, 0, 1, 1)).toBe(1);
  });
});

describe("trigger", () => {
  it("fires only strictly inside the radius jackScale * 200", () => {
    expect(run(jack(), person({ x: 300 })).kind).toBe("none"); // distance 200
    expect(run(jack(), person({ x: 301 })).kind).toBe("walk"); // 199
    expect(run(jack({ scale: 0.5 }), person({ x: 399 })).kind).toBe("none"); // radius 100, distance 101
    expect(run(jack({ scale: 0.5 }), person({ x: 401 })).kind).toBe("walk");
  });

  it("the y distance counts three times", () => {
    expect(run(jack(), person({ x: 500, y: 233, velX: 0, velY: 10 })).kind).toBe("none"); // 67 * 3 = 201
    expect(run(jack(), person({ x: 500, y: 234, velX: 0, velY: 10 })).kind).toBe("walk"); // 66 * 3 = 198
  });

  it("is off while an avoid walk is under way (flag)", () => {
    expect(run(jack(), person(), world(), true).kind).toBe("none");
  });

  it("uses the shadow offset (times the person's scale) as the person's reference point", () => {
    // feet at x = 250 (250 away), shadow offset +60 * 0.5 brings the point to 280: still outside
    expect(run(jack(), person({ x: 250, shadowDx: 60, scale: 0.5 })).kind).toBe("none");
    expect(run(jack(), person({ x: 250, shadowDx: 100, scale: 0.6 })).kind).toBe("walk"); // 310 -> 190 away
  });
});

describe("direction of the person", () => {
  it("a person walking away makes Jack stand", () => {
    expect(run(jack(), person({ velX: -10 })).kind).toBe("stand");
  });

  it("equal distance now and after the step is not 'away'", () => {
    expect(run(jack(), person({ velX: 0, velY: 0 })).kind).toBe("walk");
  });

  it("applyStand stops the walker in place", () => {
    const w = createWalker(10, 10, world());
    w.walking = true;
    applyStand(w);
    expect(w.walking).toBe(false);
    expect([w.x, w.y]).toEqual([10, 10]);
  });
});

describe("escape point", () => {
  it("candidates: two perpendicular points (y squashed by 3) and two 250 * scale to the sides", () => {
    const c = escapeCandidates(jack(), person(), 400, 300);
    expect(c).toHaveLength(4);
    const by = (x: number, y: number) => c.find((p) => p.x === x && p.y === y);
    expect(by(250, 300)?.rank).toBe(250); // constant rank 250 * 1
    expect(by(750, 300)?.rank).toBe(250);
    // perpendicular: (ax, ay) = (1, 10) / |.| * 200, y / 3
    expect(by(519, 366)).toBeDefined();
    expect(by(519, 233)).toBeDefined();
  });

  it("sorted by distance to the person, farthest first; ties keep their order", () => {
    const rows = [
      { x: 1, y: 0, rank: 5 },
      { x: 2, y: 0, rank: 9 },
      { x: 3, y: 0, rank: 5 },
      { x: 4, y: 0, rank: 9 },
    ];
    sortCandidates(rows);
    expect(rows.map((r) => r.x)).toEqual([2, 4, 1, 3]);
  });

  it("goes to the first sorted candidate (the left side point here)", () => {
    const r = run(jack(), person());
    expect(r.kind === "walk" && r.target).toEqual({ x: 250, y: 300 });
  });

  it("skips candidates inside an object quad or outside the walk area", () => {
    const blockLeft = world(FLOOR, [box(240, 290, 20, 20)]);
    expect((run(jack(), person(), blockLeft) as { target: unknown }).target).toEqual({
      x: 750,
      y: 300,
    });
    const noLeft = world([
      [350, 0, 350, 600, 1000, 600],
      [350, 0, 1000, 0, 1000, 600],
    ]);
    expect((run(jack(), person(), noLeft) as { target: unknown }).target).toEqual({
      x: 750,
      y: 300,
    });
    const both = world(FLOOR, [box(240, 290, 20, 20), box(740, 290, 20, 20)]);
    expect((run(jack(), person(), both) as { target: unknown }).target).toEqual({ x: 519, y: 366 });
  });

  it("no free candidate: nothing happens (and the flag stays clear, so the next step retries)", () => {
    const closed = world([
      [490, 290, 490, 310, 510, 310],
      [490, 290, 510, 290, 510, 310],
    ]);
    expect(run(jack(), person(), closed).kind).toBe("none");
  });

  it("a zero step component is replaced by 1 (no division by zero)", () => {
    const c = escapeCandidates(jack(), person({ velX: 0, velY: 0 }), 400, 300);
    for (const p of c) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });

  it("startAvoidWalk makes the walker follow the path to the target", () => {
    const w0 = world();
    const w = createWalker(500, 300, w0);
    const r = run(jack(), person(), w0);
    expect(r.kind).toBe("walk");
    if (r.kind !== "walk") return;
    expect(startAvoidWalk(w, w0, r.target)).toBe(true);
    expect(w.walking).toBe(true);
    expect(w.target).toEqual(r.target);
  });
});
