import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./constants";

/**
 * Mouse as the original sees it. The mouse does not go through DirectInput: WndProc
 * handles the window messages directly:
 * - WM_MOUSEMOVE: g_mouseX = LOWORD + g_scrollX, g_mouseY = HIWORD + g_scrollY
 * ; the raw client position is kept in.
 * The scroll offset is added when the message arrives, so the world position is not
 * refreshed when only the scroll changes.
 * - WM_{L,R,M}BUTTON{DOWN,UP}: mask g_mouseButtons (bit0 L, bit1 R, bit2 M) and
 * per-button flags (L: 1), (R: 2), (M: 4).
 */

export const MOUSE_LEFT = 1;
export const MOUSE_RIGHT = 2;
export const MOUSE_MIDDLE = 4;

/** Bounding rectangle of the canvas in client pixels (DOMRect subset). */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps a pointer position in page client pixels to the 640x480 game screen, taking the
 * CSS scaling and position of the canvas into account. Positions outside are clamped to
 * the screen (the window only receives WM_MOUSEMOVE inside its 640x480 client area).
 */
export function clientToScreen(
  clientX: number,
  clientY: number,
  rect: Rect,
  width = SCREEN_WIDTH,
  height = SCREEN_HEIGHT,
): { x: number; y: number } {
  const sx = rect.width > 0 ? width / rect.width : 1;
  const sy = rect.height > 0 ? height / rect.height : 1;
  const x = Math.floor((clientX - rect.left) * sx);
  const y = Math.floor((clientY - rect.top) * sy);
  return {
    x: Math.min(width - 1, Math.max(0, x)),
    y: Math.min(height - 1, Math.max(0, y)),
  };
}

/** DOM MouseEvent.button -> game button bit. */
export function domButtonToMask(button: number): number {
  switch (button) {
    case 0:
      return MOUSE_LEFT;
    case 1:
      return MOUSE_MIDDLE;
    case 2:
      return MOUSE_RIGHT;
    default:
      return 0;
  }
}

export class Mouse {
  /** g_mouseX / g_mouseY: world position (screen + scroll at the time of the move). */
  x = 0;
  y = 0;
  /** Raw screen position 0..639 / 0..479. */
  screenX = 0;
  screenY = 0;
  /** g_mouseButtons. */
  buttons = 0;
  /** g_scrollX / g_scrollY: set by the scene (scrolling) from outside. */
  scrollX = 0;
  scrollY = 0;

  setScroll(x: number, y: number): void {
    this.scrollX = x;
    this.scrollY = y;
  }

  /** WM_MOUSEMOVE with a position on the 640x480 screen. */
  move(screenX: number, screenY: number): void {
    this.screenX = screenX;
    this.screenY = screenY;
    this.x = screenX + this.scrollX;
    this.y = screenY + this.scrollY;
  }

  /** WM_xBUTTONDOWN; `mask` is MOUSE_LEFT / MOUSE_RIGHT / MOUSE_MIDDLE. */
  buttonDown(mask: number): void {
    this.buttons |= mask & 7;
  }

  /** WM_xBUTTONUP. */
  buttonUp(mask: number): void {
    this.buttons &= ~mask & 7;
  }

  isDown(mask: number): boolean {
    return (this.buttons & mask) !== 0;
  }

  /**
   * Input_SetAcquired(1) zeroes the button mask and flags when focus returns.
   * [hypothesis: it does so only when the DirectInput device exists; here always,
   * since a browser may never deliver the button-up that happened outside the page.]
   */
  setAcquired(acquired: boolean): void {
    if (acquired) this.buttons = 0;
  }
}
