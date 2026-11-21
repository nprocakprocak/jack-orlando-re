// Turn_Start rule table. The last matching rule is the sequence that plays.

import type { Facing } from "./jack";
import type { TurnStep } from "./turn";

type F = "n" | "o" | "-n" | "-o" | 1 | -1;
interface Rule {
  from: number;
  to: number;
  /** product old·new facing required, if any */
  prod?: 1 | -1;
  /** old/new facing required (for 1 → 1) */
  oldF?: Facing;
  newF?: Facing;
  /** sequence when turning on the spot / while walking; one array = same for both */
  spot: [number, F][];
  walk?: [number, F][];
}

const RULES: Rule[] = [
  {
    from: 0,
    to: 1,
    spot: [
      [17, "n"],
      [18, "n"],
    ],
    walk: [
      [2, "-n"],
      [3, "-n"],
    ],
  },
  {
    from: 2,
    to: 1,
    spot: [
      [13, "n"],
      [14, "n"],
    ],
    walk: [
      [6, "n"],
      [7, "n"],
    ],
  },
  {
    from: 1,
    to: 2,
    spot: [
      [19, "o"],
      [20, "o"],
    ],
    walk: [
      [4, "-o"],
      [5, "-o"],
    ],
  },
  {
    from: 1,
    to: 0,
    spot: [
      [15, "o"],
      [16, "o"],
    ],
    walk: [
      [0, "o"],
      [1, "o"],
    ],
  },
  {
    from: 4,
    to: 4,
    prod: -1,
    spot: [
      [20, "n"],
      [13, "o"],
    ],
    walk: [
      [5, "o"],
      [6, "o"],
    ],
  },
  {
    from: 3,
    to: 4,
    prod: -1,
    spot: [
      [18, "-n"],
      [19, "-n"],
    ],
    walk: [
      [3, "n"],
      [4, "n"],
    ],
  },
  {
    from: 4,
    to: 3,
    prod: -1,
    spot: [
      [14, "n"],
      [15, "n"],
    ],
    walk: [
      [7, "n"],
      [0, "n"],
    ],
  },
  {
    from: 3,
    to: 3,
    prod: -1,
    spot: [
      [16, "o"],
      [17, "n"],
    ],
    walk: [
      [1, "o"],
      [2, "o"],
    ],
  },
  { from: 1, to: 3, spot: [[15, "n"]], walk: [[0, "n"]] },
  { from: 3, to: 0, spot: [[16, "o"]], walk: [[1, "o"]] },
  { from: 0, to: 3, spot: [[17, "n"]], walk: [[2, "-n"]] },
  { from: 3, to: 1, spot: [[18, "n"]], walk: [[3, "-n"]] },
  { from: 1, to: 4, spot: [[19, "-n"]], walk: [[4, "n"]] },
  { from: 4, to: 2, spot: [[20, "-o"]], walk: [[5, "o"]] },
  { from: 2, to: 4, spot: [[13, "-n"]], walk: [[6, "-n"]] },
  // requires prod −1 here, does not; a later rule covers prod +1 in both, so same result
  { from: 4, to: 1, spot: [[14, "n"]], walk: [[7, "n"]] },
  {
    from: 1,
    to: 1,
    oldF: 1,
    newF: -1,
    spot: [
      [15, 1],
      [16, 1],
      [17, -1],
      [18, -1],
    ],
    walk: [[8, -1]],
  },
  {
    from: 1,
    to: 1,
    oldF: -1,
    newF: 1,
    spot: [
      [19, -1],
      [20, -1],
      [13, 1],
      [14, 1],
    ],
    walk: [[8, 1]],
  },
  {
    from: 0,
    to: 2,
    spot: [
      [17, 1],
      [18, 1],
      [19, 1],
      [20, 1],
    ],
    walk: [[10, 1]],
  },
  {
    from: 2,
    to: 0,
    spot: [
      [13, 1],
      [14, 1],
      [15, 1],
      [16, 1],
    ],
    walk: [[9, 1]],
  },
  // from here on the same frames whether walking or not
  {
    from: 4,
    to: 3,
    prod: 1,
    spot: [
      [20, "-n"],
      [13, "n"],
      [14, "n"],
      [15, "n"],
    ],
  },
  // passes 0xcc (204) as the count when walking; Turn_Start subtracts 200 — same 4 steps
  {
    from: 3,
    to: 4,
    prod: 1,
    spot: [
      [16, "n"],
      [17, "-n"],
      [18, "-n"],
      [19, "-n"],
    ],
  },
  {
    from: 1,
    to: 4,
    prod: 1,
    spot: [
      [19, "n"],
      [20, "n"],
      [13, "-n"],
    ],
  },
  {
    from: 1,
    to: 3,
    prod: -1,
    spot: [
      [15, "o"],
      [16, "o"],
      [17, "n"],
    ],
  },
  {
    from: 0,
    to: 4,
    spot: [
      [17, "-n"],
      [18, "-n"],
      [19, "-n"],
    ],
  },
  {
    from: 2,
    to: 3,
    spot: [
      [13, "n"],
      [14, "n"],
      [15, "n"],
    ],
  },
  {
    from: 3,
    to: 2,
    spot: [
      [18, "o"],
      [19, "o"],
      [20, "o"],
    ],
  },
  {
    from: 3,
    to: 1,
    prod: -1,
    spot: [
      [16, "-n"],
      [17, "n"],
      [18, "n"],
    ],
  },
  {
    from: 4,
    to: 1,
    prod: 1,
    spot: [
      [20, "-n"],
      [13, "n"],
      [14, "n"],
    ],
  },
  {
    from: 4,
    to: 0,
    spot: [
      [14, "-o"],
      [15, "-o"],
      [16, "-o"],
    ],
  },
];

function resolve(f: F, o: Facing, n: Facing): Facing {
  switch (f) {
    case "n":
      return n;
    case "o":
      return o;
    case "-n":
      return -n as Facing;
    case "-o":
      return -o as Facing;
    default:
      return f;
  }
}

/**
 * The sequence Turn_Start receives when Jack's (dir, facing) changes from (oldDir, oldFacing)
 * to (newDir, newFacing); [] = no animation (also when nothing changed, or for a change no rule
 * covers, e.g. 0 → 0 with another facing). `walking`: bVar1 of — Jack was already moving
 * (g_jackWalking or), not POINTROTATE and not in uniform (g_jackUniform).
 */
export function turnSequence(
  oldDir: number,
  oldFacing: Facing,
  newDir: number,
  newFacing: Facing,
  walking = false,
): TurnStep[] {
  if (oldDir === newDir && oldFacing === newFacing) return [];
  let out: TurnStep[] = [];
  for (const r of RULES) {
    if (r.from !== oldDir || r.to !== newDir) continue;
    if (r.prod !== undefined && oldFacing * newFacing !== r.prod) continue;
    if (r.oldF !== undefined && (oldFacing !== r.oldF || newFacing !== r.newF)) continue;
    const seq = walking && r.walk ? r.walk : r.spot;
    out = seq.map(([anim, f]) => ({ anim, frame: 0, facing: resolve(f, oldFacing, newFacing) }));
  }
  return out;
}
