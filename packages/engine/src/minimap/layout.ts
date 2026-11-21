// Geometry and tables of the small map (M).

/** Window rectangle: `Blit_ImageToScreen(g_scrollX + 10, 0x56)` of a 0x26c x 0x134 buffer. */
export const MAP_X = 10;
export const MAP_Y = 0x56;
export const WINDOW_W = 0x26c;
export const WINDOW_H = 0x134;
/** `MAP2.BM` is 0x266 x 0x12e, copied into the window buffer at (3, 3) over the frame (`Blit_Copy16`). */
export const IMAGE_INSET = 3;
export const IMAGE_W = WINDOW_W - 2 * IMAGE_INSET;
export const IMAGE_H = WINDOW_H - 2 * IMAGE_INSET;

/** Marker animation: 20 frames, `Timer_Sleep(0x1e)` (= 30 ms, `Timer_Sleep` waits ms/5 ticks of 5 ms) per frame. */
export const MARKER_FRAMES = 20;
export const FRAME_MS = 30;
/** (single 0.63): the marker patches are scaled down to this by `Cursor_BoxScale`. */
export const MARKER_SCALE = 0.63;

export const DIK_MAP = { ESC: 0x01, M: 0x32 } as const;

/** One marker animation set (`set * 0x140 + frame * 0x10`, names written by `Game_Main`). */
export interface MarkerSet {
  /** file name prefix in GLOBAL.PAK */
  prefix: string;
  /** digits of the frame number in the name (`haf000`, `jack00`, `stad00`) */
  digits: number;
  /** absolute screen position (the original adds `g_scrollX` to x): `[set]`, `[set]` */
  x: number;
  y: number;
}

export const MARKER_SETS: readonly MarkerSet[] = [
  { prefix: "haf", digits: 3, x: 0x1b2, y: 100 },
  { prefix: "jack", digits: 2, x: 0x171, y: 0x105 },
  { prefix: "stad", digits: 2, x: 0xb6, y: 0xaf },
];

/**
 * Set for the chapter: 1 → set 1 (`jack`), 2 → set 2 (`stad`), 3 → set 0 (`haf`).
 * Chapter 4 leaves the local variable uninitialised in the original, but the map is available there only in scenes of the
 * list (all numbered < 31, chapter 1), so it is unreachable: null (no marker).
 */
export function markerSetFor(chapter: number): number | null {
  if (chapter === 1) return 1;
  if (chapter === 2) return 2;
  if (chapter === 3) return 0;
  return null;
}

export function markerFileName(set: number, frame: number): string {
  const m = MARKER_SETS[set];
  return `${m.prefix}${String(frame).padStart(m.digits, "0")}.bm`;
}
