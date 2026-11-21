// RAMKA.BM: the frame Game_Run (l. 779-788) hangs on the item cursor.
import type { Surface16 } from "../render/surface";

export interface FrameEnv {
  /** g_cursorIdle: true = nothing under the hotspot that the item could be used on */
  idle: boolean;
  /** g_cursorMode: the frame exists for the item cursor (5) and the zone/edge cursors (10+), never for modes 0-4 */
  mode: number;
  /** the item bar (g_topBarOpen), the answer menu (g_menuOpen), a caption (g_captionShown), the bullet menu / zone suspension (g_cursorZoneSuspended) */
  barOpen: boolean;
  menuOpen: boolean;
  captionShown: boolean;
  bulletOpen: boolean;
}

/** The whole condition of Game_Run: otherwise the sprite is parked at (0, 500), off the screen. */
export function frameVisible(env: FrameEnv): boolean {
  return !env.idle && !env.barOpen && !env.menuOpen && !env.captionShown && !env.bulletOpen && env.mode > 4;
}

/** The frame's overlay: `Sprite_Set(g_frameSprite, g_mouseX - 0x18, g_mouseY - 0x14, RAMKA)`; null when it is parked. */
export function frameOverlay(image: Surface16 | null, env: FrameEnv, mouseX: number, mouseY: number): { x: number; y: number; image: Surface16 } | null {
  if (!image || !frameVisible(env)) return null;
  return { x: mouseX - 0x18, y: mouseY - 0x14, image };
}
