// Half-plane of a triangle edge, shared by the scene walk area and the walk code.
// walk/geometry.ts re-exports both functions. formats/scene.ts keeps the bounding box.

const f32 = Math.fround;

/** Store to a 16-bit `short`, the same cast as `s16` in walk/geometry.ts. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * Geom_PointBelowLine: (px - ax) * slope(a, b) <= py - ay; the slope is a float,
 * a vertical edge gets slope dy * 1e7. The product is compared unrounded (x87 register).
 */
export function pointBelowLine(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = s16(bx - ax);
  const slope = dx === 0 ? f32((by - ay) * 1e7) : f32((by - ay) / dx);
  return (px - ax) * slope <= py - ay;
}

/** Half-plane part of Walk_FindTriangle and of the area test. */
export function insideTriangleSides(t: readonly number[], px: number, py: number): boolean {
  const [x1, y1, x2, y2, x3, y3] = t;
  if (!pointBelowLine(x2, y2, x1, y1, x3, y3)) {
    return (
      !pointBelowLine(px, py, x1, y1, x3, y3) &&
      pointBelowLine(px, py, x1, y1, x2, y2) &&
      pointBelowLine(px, py, x2, y2, x3, y3)
    );
  }
  return (
    pointBelowLine(px, py, x1, y1, x3, y3) &&
    !pointBelowLine(px, py, x1, y1, x2, y2) &&
    !pointBelowLine(px, py, x2, y2, x3, y3)
  );
}
