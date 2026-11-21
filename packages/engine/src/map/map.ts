// The city map SC000D and the other scene without Jack's control (SC008B).
// The map itself is an ordinary scene: its script (SC000D.MCC) places the markers, drives the cars and
// answers the clicks through the areas HAFFEN / JACKH / COCL. The exe only knows the two scene names.

/** The city map: the Ctrl point 3 of the coat and the drive-off macros (`GOTOSCENE SC000D`) lead here. */
export const MAP_SCENE = "SC000D";

/**
 * `g_sceneNoControl` (Game_Run): `strcmp(g_sceneName, "SC000D.CCG")` or
 * `"SC008B.CCG"`. Such a scene has no edge cursor (modes 20/21), no bullet menu, no idle animation of Jack, no
 * Backspace / save keys; the mouse within 20 px of the screen edge only sets the scroll direction.
 */
export function isNoControlScene(name: string): boolean {
  return name === MAP_SCENE || name === "SC008B";
}

/**
 * The start of a scene without control (Game_Run, right after `g_sceneNoControl` is set): `g_verbMode = 0`,
 * `g_cursorMode = 0`, `Cursor_SetVerbName()` - the map is clicked with the plain pointer (`POKAZANIE- ` macros)
 * whatever verb the player had chosen before, and that verb does not come back after the map.
 */
export function noControlCursor(name: string, mode: number, verbMode: number): { mode: number; verbMode: number } {
  return isNoControlScene(name) ? { mode: 0, verbMode: 0 } : { mode, verbMode };
}
