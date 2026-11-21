// Walk_FindPath and Walk_SearchRec: depth-first branch-and-bound search
// over points of the walk triangles.
import { dist, findWalkTriangle, segmentIntersection, type Point } from "./geometry";

/** Walk_SearchRec stops at this many points on its stack (< 100). */
export const MAX_PATH_POINTS = 100;
/** Initial best length. */
const NO_BEST = 0x7fff;
/** Candidate array of Walk_SearchRec (ebp-0x2c): the 9th entry overwrites the triangle pointer. */
export const CANDIDATE_SLOTS = 8;

export interface SearchOptions {
  /**
   * The original keeps searching for a shorter path only until 100 ticks of Game_Tick14ms
   * (1.4 s) after Walk_FindPath started, and only once a path was found. This port counts
   * Walk_SearchRec calls instead: after the first path is found, the search stops entering
   * new nodes once `budget` calls were made. Infinity (default) = exhaustive search.
   */
  budget?: number;
}

export interface SearchStats {
  /** Walk_SearchRec calls (both directions) */
  calls: number;
  /** paths recorded */
  found: number;
  /** largest candidate list built for a pair of triangles (> CANDIDATE_SLOTS corrupts the original's stack) */
  maxCandidates: number;
  /** the reverse search (target -> start) gave the result */
  reversed: boolean;
  /** path length in the game's metric (sum of truncated segment lengths), NO_BEST if none */
  length: number;
}

export interface PathResult {
  /** points from start to target, both included; empty = no path */
  path: Point[];
  stats: SearchStats;
}

/**
 * pulls every candidate 1/(n+20) of the way towards the candidates' sum
 * (integer division), drops points within 2 px of an already kept one, then does a single
 * bubble pass ordering neighbours by distance from `from`.
 */
export function spreadCandidates(cands: Point[], from: Point): Point[] {
  const n = cands.length;
  let sx = 0;
  let sy = 0;
  for (const c of cands) {
    sx += c.x;
    sy += c.y;
  }
  const kept: Point[] = [];
  for (const c of cands) {
    const q = {
      x: Math.trunc((sx + c.x * 20) / (n + 20)),
      y: Math.trunc((sy + c.y * 20) / (n + 20)),
    };
    if (kept.every((k) => dist(q, k) > 2)) kept.push(q);
  }
  for (let k = 0; k < kept.length - 1; k++) {
    if (dist(from, kept[k + 1]) < dist(from, kept[k])) [kept[k], kept[k + 1]] = [kept[k + 1], kept[k]];
  }
  return kept;
}

class Search {
  readonly visited: boolean[];
  target: Point = { x: 0, y: 0 };
  stack: Point[] = [];
  seg: number[] = [];
  depth = 0;
  best = NO_BEST;
  found = 0;
  calls = 0;
  maxCandidates = 0;
  path: Point[] = [];

  constructor(
    readonly tris: readonly (readonly number[])[],
    readonly budget: number,
  ) {
    this.visited = tris.map(() => false);
  }

  private tri(p: Point, from = 0): number {
    return findWalkTriangle(this.tris, p.x, p.y, from);
  }

  /** length of the points on the stack. */
  private cost(): number {
    let s = 0;
    for (let i = 1; i < this.depth; i++) s += this.seg[i];
    return (s << 16) >> 16;
  }

  private push(p: Point): void {
    this.stack[this.depth] = p;
    if (this.depth !== 0) this.seg[this.depth] = dist(this.stack[this.depth - 1], p);
    this.depth++;
  }

  /** */
  private record(): void {
    this.path = this.stack.slice(0, this.depth).map((p) => ({ ...p }));
    this.best = this.cost();
    this.found++;
  }

  /** straight towards the target: where the line leaves triangle t. */
  private exitsTowardTarget(p: Point, tv: readonly Point[]): void {
    for (let i = 0; i < 3; i++) {
      const q = segmentIntersection(p, this.target, tv[i], tv[(i + 1) % 3]);
      if (q.x < 0) continue;
      for (let s = this.tri(q); s >= 0; s = this.tri(q, s + 1)) if (!this.visited[s]) this.rec(q);
    }
  }

  /** contact points with triangle u; the caller skips a triangle on the current branch. */
  private contacts(p: Point, t: number, u: number, tv: readonly Point[]): void {
    const ut = this.tris[u];
    const uv = [0, 2, 4].map((i) => ({ x: ut[i], y: ut[i + 1] }));
    const cands: Point[] = [];
    for (const v of uv) if (this.tri(v, t) === t) cands.push(v);
    for (let k = 0; k < 3; k++) {
      if (this.tri(tv[k], u) === u) cands.push(tv[k]);
      for (let m = 0; m < 3; m++) {
        const q = segmentIntersection(tv[k], tv[(k + 1) % 3], uv[m], uv[(m + 1) % 3]);
        if (q.x >= 0) cands.push(q);
      }
    }
    if (!cands.length) return;
    this.maxCandidates = Math.max(this.maxCandidates, cands.length);
    for (const c of spreadCandidates(cands, p)) this.rec(c);
  }

  rec(p: Point): void {
    this.calls++;
    if (!(this.found === 0 || this.calls <= this.budget) || this.depth >= MAX_PATH_POINTS) return;
    this.push(p);
    if (this.cost() + dist(p, this.target) < this.best) {
      for (let t = this.tri(p); t >= 0; t = this.tri(p, t + 1)) {
        if (this.visited[t]) continue;
        this.visited[t] = true;
        if (this.tri(this.target, t) === t) {
          this.push(this.target);
          this.record();
          this.depth--;
          this.visited[t] = false;
          break;
        }
        const tt = this.tris[t];
        const tv = [0, 2, 4].map((i) => ({ x: tt[i], y: tt[i + 1] }));
        this.exitsTowardTarget(p, tv);
        for (let u = 0; u < this.tris.length; u++) {
          if (this.visited[u]) continue;
          this.contacts(p, t, u, tv);
        }
        this.visited[t] = false;
      }
    }
    this.depth--;
  }
}

/**
 * Walk_FindPath(start, target). The target and then the start must lie in the walk
 * area. Searches start -> target, then target -> start with the best length so far as the bound;
 * a shorter reverse path replaces the first one (reversed). Returns the points from start to
 * target; the first point is `start` itself.
 */
export function findPath(
  walk: readonly (readonly number[])[],
  start: Point,
  target: Point,
  opts: SearchOptions = {},
): PathResult {
  const s = new Search(walk, opts.budget ?? Infinity);
  let reversed = false;
  s.target = target;
  if (findWalkTriangle(walk, target.x, target.y) >= 0) {
    s.rec(start);
    s.target = start;
    if (findWalkTriangle(walk, start.x, start.y) >= 0) {
      const first = s.best;
      s.rec(target);
      if (s.best < first) {
        s.path.reverse();
        reversed = true;
      }
    }
  }
  return {
    path: s.path,
    stats: {
      calls: s.calls,
      found: s.found,
      maxCandidates: s.maxCandidates,
      reversed,
      length: s.best,
    },
  };
}
