import { describe, expect, it } from "vitest";
import type { Area } from "../formats/scene";
import {
  areaContains,
  exitAt,
  objectDepth,
  personDepth,
  planWalk,
  reorderJack,
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

describe("depth and areas", () => {
  const o = box(100, 100, 50, 20);
  it("object footprint: above all corners = behind, below all = in front", () => {
    expect(objectDepth(o, P(120, 90))).toBe("behind");
    expect(objectDepth(o, P(120, 130))).toBe("front");
    expect(objectDepth(box(0, 0, 0, 0, false), P(0, 0))).toBeNull();
  });
  it("within the y range: decided by the slanted edges", () => {
    // a diamond: top (50,0) right (100,20) bottom (50,40) left (0,20)
    const d: WalkObject = {
      x: 0,
      y: 0,
      quad: [50, 0, 100, 20, 50, 40, 0, 20],
      center: [50, 20],
      valid: true,
    };
    expect(objectDepth(d, P(95, 5))).toBe("behind");
    expect(objectDepth(d, P(95, 35))).toBe("front");
    expect(objectDepth(d, P(50, 20))).toBeNull();
  });
  it("persons by y; reorderJack moves Jack next to the other sprite", () => {
    expect(personDepth(100, 120)).toBe("behind");
    expect(personDepth(130, 120)).toBe("front");
    expect(personDepth(120, 120)).toBeNull();
    expect(reorderJack(["bg", "a", "b", "J"], "J", "a", "behind")).toEqual(["bg", "J", "a", "b"]);
    expect(reorderJack(["bg", "J", "a", "b"], "J", "b", "front")).toEqual(["bg", "a", "b", "J"]);
    expect(reorderJack(["bg", "J", "a"], "J", "a", "behind")).toEqual(["bg", "J", "a"]);
  });
  it("exitAt: last area first, only exits; areas have no bounding box test", () => {
    const tri = [0, 0, 0, 100, 100, 100];
    const areas: Area[] = [
      { name: "LEWO", exit: true, triangles: [tri] },
      { name: "KUBEL", exit: false, triangles: [tri] },
      { name: "PRAWO", exit: true, triangles: [[0, 0, 0, 50, 50, 50]] },
    ];
    expect(exitAt(areas, P(10, 40))).toBe(2);
    expect(exitAt(areas, P(10, 80))).toBe(0);
    expect(exitAt(areas, P(90, 10))).toBe(-1);
    expect(areaContains(areas[1], P(10, 80))).toBe(true);
  });

  describe("goal outside the area (SC009 alley exit)", () => {
    it("click: refused; script WALKTO (anyGoal): straight line to the goal, not to the nearest walkable point", () => {
      const w = world(SQUARE);
      expect(planWalk(w, P(80, 50), P(-60, 50))).toBeNull();
      const plan = planWalk(w, P(80, 50), P(-60, 50), { anyGoal: true })!;
      expect(plan.direct).toBe(true);
      expect(plan.path[plan.path.length - 1]).toEqual(P(-60, 50));
    });

    it("start outside as well: still straight to the goal outside (Walk_NearestWalkable moves only the start)", () => {
      const plan = planWalk(world(SQUARE), P(150, 50), P(-60, 50), { anyGoal: true })!;
      expect(plan.direct).toBe(true);
      expect(plan.path.map((p) => [p.x, p.y])).toEqual([
        [150, 50],
        [-60, 50],
      ]);
    });

    it("goal inside: anyGoal changes nothing", () => {
      const w = world(L);
      expect(planWalk(w, P(10, 10), P(280, 280), { anyGoal: true })).toEqual(planWalk(w, P(10, 10), P(280, 280)));
    });
  });
});
