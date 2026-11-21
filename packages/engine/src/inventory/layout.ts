// Geometry of the coat screen. Pixels of the 640x480 screen.
export const COLS = 3;
export const ROWS = 5;
export const CELL_W = 0x30;
export const CELL_H = 0x34;
/** Hit area of the grid: (0x56, 0xe6] x (0xae, 0x1b2]; also the clip rectangle of the item sprites. */
export const GRID_X0 = 0x56;
export const GRID_Y0 = 0xae;
export const GRID_X1 = 0xe6;
export const GRID_Y1 = 0x1b2;
/** Centre of cell (col, row): (0x6e + col*0x30, 200 + row*0x34). */
export const CELL_CX = 0x6e;
export const CELL_CY = 200;
/** The shadow sprite is shifted by (+3, +3) (`g_itemShadowDx/Dy`). */
export const SHADOW_DX = 3;
export const SHADOW_DY = 3;
/** Last scroll row (`g_invSplit/3 - 6`) and the fixed first row of region B (`g_invSplit/3`). */
export const MAX_SCROLL_ROW = 16;
export const REGION_B_ROW = 22;
/** Right part of the screen (Jack) closes the coat on a left click: mouseX >= 0xf1. */
export const CLOSE_X = 0xf1;

export const UP_ARROW = { x: 0x21, y: 0xfc, x0: 0x22, x1: 0x48, y0: 0xfd, y1: 0x123 };
export const DOWN_ARROW = { x: 0x21, y: 0x15a, x0: 0x22, x1: 0x48, y0: 0x15b, y1: 0x181 };
/** Options button: sprite position and the press area (inclusive); the release area is the open interval (99,0xfb)x(0x42,0x8a). */
export const OPT = { x: 99, y: 0x42, x0: 100, x1: 0xfa, y0: 0x43, y1: 0x89 };

/** Hidden Ctrl points, [civilian, uniform]. Index = point number - 1. */
export const CTRL_POINTS: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
  [[417, 197], [405, 211]],
  [[417, 248], [407, 299]],
  [[416, 312], [411, 393]],
  [[417, 365], [319, 200]],
];
/** Game_Run: `x - 4 < mouse < x + 4` (strict), i.e. up to 3 px away on each axis. */
export const CTRL_RADIUS = 3;

export interface Cell {
  col: number;
  row: number;
}

/** Cell under the mouse or null (`kol = (x-0x56)/0x30`, needs x-0x56 >= 1 and y-0xae >= 1; the right/bottom edge is outside). */
export function cellAt(x: number, y: number): Cell | null {
  const dx = x - GRID_X0;
  const dy = y - GRID_Y0;
  if (dx < 1 || dy < 1) return null;
  const col = Math.floor(dx / CELL_W);
  const row = Math.floor(dy / CELL_H);
  return col < COLS && row < ROWS ? { col, row } : null;
}

/** Slot shown in cell (col, row) with the first visible row `scrollRow`. */
export function slotOfCell(col: number, row: number, scrollRow: number): number {
  return col + (row + scrollRow) * COLS;
}

export const inBox = (b: { x0: number; x1: number; y0: number; y1: number }, x: number, y: number): boolean =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** Which hidden Ctrl point (1..4) is within ±3 px of the mouse (strict `x-4 < mouse < x+4`), 0 = none. */
export function ctrlPointAt(x: number, y: number, uniform: boolean): number {
  for (let i = 0; i < CTRL_POINTS.length; i++) {
    const [px, py] = CTRL_POINTS[i][uniform ? 1 : 0];
    if (Math.abs(x - px) <= CTRL_RADIUS && Math.abs(y - py) <= CTRL_RADIUS) return i + 1;
  }
  return 0;
}
