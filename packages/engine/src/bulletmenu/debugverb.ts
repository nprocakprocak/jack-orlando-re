// A developer aid for setting the cursor verb from the host, not a key of the original.
// The exe has no digit shortcuts anywhere: Game_Run reads only the keys, Gui_RunWindow
// only Enter, Esc and the window hotkeys, and Gui_SetHotkeys is called once, by
// Gui_MessageBox, with Esc. Gui_ChoiceWindow sets none.
import { verbMenuModes } from "./verbmenu";

export interface DebugVerbState {
  /** g_varValues[GUN] == 1 */
  gun: boolean;
  /** mode 5: an item is in the hand */
  itemInHand: boolean;
  /** the bullet menu, the verb window or another modal window is open */
  menuOpen: boolean;
}

/**
 * Whether the play page may switch the cursor to `verb` now. Mode 3 (Colt) exists only with the revolver
 * (the same set as the verb window, `verbMenuModes`); the pointer modes do not replace an item in hand
 * and are not set under an open menu.
 */
export function debugVerbAllowed(verb: number, s: DebugVerbState): boolean {
  if (s.itemInHand || s.menuOpen) return false;
  return verbMenuModes(s.gun).includes(verb);
}
