// Integer/float helpers and the small geometry routines of the original walk code.
// Floats follow the x87 code: values stored to `float` locals are rounded with f32,
// intermediate expressions are kept in double (53-bit precision control).

export const f32 = Math.fround;

export interface Point {
  x: number;
  y: number;
}

/** MSVC __ftol: truncation toward zero; NaN or out of int32 range ->. */
export function ftol(v: number): number {
  if (!(v > -2147483649 && v < 2147483648)) return -2147483648;
  return Math.trunc(v) | 0;
}

/** Store to a 16-bit `short`. */
export function s16(v: number): number {
  return (v << 16) >> 16;
}

/** CRT abs on int32 (abs(INT_MIN) stays INT_MIN). */
export function iabs(v: number): number {
  return v < 0 ? -v | 0 : v;
}

/** The game uses 3.141592 instead of pi. */
export const GAME_PI = 3.141592;

/** /: truncated Euclidean distance, as a short. */
export function dist(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return s16(ftol(Math.sqrt(dx * dx + dy * dy)));
}

export { insideTriangleSides, pointBelowLine } from "../formats/halfplane";

/** Walk_FindTriangle for one triangle and for the whole list: the scene parser's copy. */
export { findTriangle as findWalkTriangle, triangleContains as walkTriangleContains } from "../formats/scene";

/** p lies in the bounding box of segment ab (inclusive). */
export function inSegmentBox(p: Point, a: Point, b: Point): boolean {
  return (p.x - a.x) * (b.x - p.x) >= 0 && (p.y - a.y) * (b.y - p.y) >= 0;
}

const NO_POINT: Point = { x: -1, y: -1 };

/**
 * intersection of segments ab and cd as y = m*x + c lines (float32 slope and
 * offset; a vertical segment gets dx = 1/256), truncated; (-1, -1) when the slopes are equal
 * or the point is outside either segment's bounding box.
 */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point {
  let dx1 = f32(a.x - b.x);
  if (dx1 === 0) dx1 = 0.00390625;
  const m1 = f32(f32(a.y - b.y) / dx1);
  const c1 = f32(f32(a.x * b.y - a.y * b.x) / dx1);
  let dx2 = f32(c.x - d.x);
  if (dx2 === 0) dx2 = 0.00390625;
  const m2 = f32(f32(c.y - d.y) / dx2);
  const c2 = f32(f32(c.x * d.y - c.y * d.x) / dx2);
  if (m1 === m2) return NO_POINT;
  const dm = f32(m2 - m1);
  const dc = f32(c1 - c2);
  const num = f32(m2 * c1 - m1 * c2);
  const p = { x: s16(ftol(dc / dm)), y: s16(ftol(num / dm)) };
  if (inSegmentBox(p, a, b) && inSegmentBox(p, c, d)) return p;
  return NO_POINT;
}

/**
 * |sin(angle(prev->next) - angle(prev->mid)) * |prev-mid||, i.e. the distance of
 * `mid` from the line prev-next. Angles from atan of the slope, stored as floats.
 */
export function offLine(mid: Point, prev: Point, next: Point): number {
  const d = dist(prev, mid);
  const a1 = f32(Math.atan((next.y - prev.y) / (next.x - prev.x)));
  const a2 = f32(Math.atan((mid.y - prev.y) / (mid.x - prev.x)));
  return s16(iabs(ftol(Math.sin(a1 - a2) * d)));
}

/** Perspective of a scene (`[perspektywa]`) with refScale as the game's float. */
export interface WalkPerspective {
  horizonY: number;
  refY: number;
  refScale: number;
}

/**
 * Jack's scale g_jackScale, recomputed every walk step in Game_Run:
 * float((y - horizon) * refScale / (refY - horizon)) clamped to 0.1..1.
 */
export function jackScale(p: WalkPerspective, y: number): number {
  let s = f32(((y - p.horizonY) * p.refScale) / (p.refY - p.horizonY));
  if (s < f32(0.1)) s = f32(0.1);
  if (s > 1) s = 1;
  return s;
}

/** Persp_ScaleAtY: the same scale at integer y, clamped, divided by 3. */
export function perspThird(p: WalkPerspective, y: number): number {
  let s = f32(((y - p.horizonY) * p.refScale) / (p.refY - p.horizonY));
  if (s > 1) s = 1;
  else if (s < f32(0.1)) s = f32(0.1);
  return s / 3;
}
