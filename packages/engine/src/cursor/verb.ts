// The pair g_cursorMode / g_verbMode: the places where the original writes one of them without the
// other. The exit arrows exist only while g_verbMode == 0, so a mode 0 with another verb left
// over is a cursor that looks like the pointer and never shows the arrows.

/** The cursor mode and the verb picked in the menu. */
export interface CursorVerb {
  mode: number;
  verbMode: number;
}

/** `Cursor_EnableDraw`: in mode 0 the verb becomes the pointer too (`g_verbMode = 0`); any other mode keeps both. */
export function enableDrawVerb(mode: number, verbMode: number): number {
  return mode === 0 ? 0 : verbMode;
}

// The scene start (Game_Run l. 440, mode 0 only with the pointer verb) is `Cursor.sceneStart`: it also resets g_cursorModePrev.

/** `NOHAVEGUN` (`Script_ExecStep` l. 1795): only the gun cursor itself (mode 3) goes back to the pointer, with its verb. */
export function noHaveGunCursor(c: CursorVerb): CursorVerb {
  return c.mode === 3 ? { mode: 0, verbMode: 0 } : { ...c };
}

/**
 * Step 21 of `Game_Run` (l. 1774-1792), `g_cursorEnabled007cde78`: a macro holding the player switches the cursor off (not while
 * the answer menu is open, `g_menuOpen`); the first frame nothing holds it, `Cursor_EnableDraw` switches it on. The scene end clears the
 * flag too (l. 4816), so the first free frame of every scene runs `Cursor_EnableDraw`.
 */
export class CursorEnable {
  enabled = false;

  /** The frame's step; returns true when `Cursor_EnableDraw` runs (the caller applies `enableDrawVerb`). */
  step(locked: boolean, menuOpen: boolean): boolean {
    if (locked && this.enabled && !menuOpen) this.enabled = false;
    if (!locked && !this.enabled) {
      this.enabled = true;
      return true;
    }
    return false;
  }

  /** l. 4816: the scene ends with the cursor switched off. */
  sceneEnd(): void {
    this.enabled = false;
  }
}
