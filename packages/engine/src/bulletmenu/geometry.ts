// Geometry of the bullet menu and the verb menu: icon rectangles, popup placement, hit test.
// Evidence.

export type IconId = "look" | "pointer" | "take" | "hit" | "gun";

export interface Icon {
  id: IconId;
  /** Cursor mode set by choosing it (g_verbMode). */
  mode: number;
  /** Offset inside the bullet image (g_bulletIconPos) and hit rectangle size. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Highlight image stem (set 1/2 suffix added by highlightImageName). */
  image: string;
  /** Only with a revolver (g_varValues[GUN] == 1). */
  needsGun: boolean;
}

/** Processing order of Game_Run step 13: look, pointer, take, hit, gun. On overlap the later one wins. */
export const ICONS: readonly Icon[] = [
  { id: "look", mode: 1, x: 90, y: 111, w: 20, h: 26, image: "LUPA", needsGun: false },
  { id: "pointer", mode: 0, x: 54, y: 70, w: 22, h: 38, image: "STRZA", needsGun: false },
  { id: "take", mode: 4, x: 74, y: 49, w: 42, h: 34, image: "REKA", needsGun: false },
  { id: "hit", mode: 2, x: 121, y: 90, w: 32, h: 32, image: "PIESC", needsGun: false },
  { id: "gun", mode: 3, x: 71, y: 80, w: 36, h: 23, image: "SPLUWA_2.BM", needsGun: true },
];

export const BULLET_W = 181;
export const BULLET_H = 182;

/** Bullet image: set 1 (no revolver, Cursor_LoadSet1) or set 2 (with it, Cursor_LoadSet2). */
export function bulletImageName(gun: boolean): string {
  return gun ? "POCISK2.BM" : "POCISK.BM";
}

export function highlightImageName(icon: Icon, gun: boolean): string {
  return icon.needsGun ? icon.image : `${icon.image}_${gun ? 2 : 1}.BM`;
}

/** Click_InRect: strict inequalities. */
export function inRect(x: number, y: number, l: number, t: number, w: number, h: number): boolean {
  return l < x && x < l + w && t < y && y < t + h;
}

/**
 * Top-left of the opened bullet: mouse (world coordinates, scroll included) minus (102, 97),
 * clamped to [scroll + 10, scroll + 630 - w] x [15, 470 - h]; the lower bound first, the upper second.
 */
export function bulletPosition(
  mouseX: number,
  mouseY: number,
  scrollX: number,
  w = BULLET_W,
  h = BULLET_H,
): { x: number; y: number } {
  let x = mouseX - 0x66;
  let y = mouseY - 0x61;
  if (x < scrollX + 10) x = scrollX + 10;
  if (x > scrollX + 0x276 - w) x = scrollX + 0x276 - w;
  if (y < 15) y = 15;
  if (y > 0x1d6 - h) y = 0x1d6 - h;
  return { x, y };
}

/** Stored window width W: 145, 240 for German ('D'). */
export function verbMenuWidth(language: string): number {
  return language === "D" ? 240 : 145;
}

/** Stored window height H: 158 without the revolver, 185 with it. */
export function verbMenuHeight(gun: boolean): number {
  return gun ? 185 : 158;
}

/** Screen position of the verb window: centred on mouse - 7, 63 px above the mouse, clamped. */
export function verbMenuPosition(
  mouseX: number,
  mouseY: number,
  scrollX: number,
  gun: boolean,
  language = "P",
): { x: number; y: number } {
  const w = verbMenuWidth(language);
  const h = verbMenuHeight(gun);
  let x = mouseX - 7 - (w >> 1) - scrollX;
  let y = mouseY - 0x3f;
  if (x < 10) x = 10;
  if (x > 630 - w) x = 630 - w;
  if (y < 15) y = 15;
  if (y > 470 - h) y = 470 - h;
  return { x, y };
}
