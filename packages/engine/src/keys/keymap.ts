// Keyboard shortcuts of Game_Run: which key does what in which state. Pure logic, no DOM.
// Behaviour and addresses:

/** DirectInput scan codes (the `push` before Input_KeyPressedOnce / Input_IsKeyDown). */
export const DIK = {
  ESCAPE: 0x01,
  BACKSPACE: 0x0e,
  CONTROL: 0x1d,
  P: 0x19,
  M: 0x32,
  F1: 0x3b,
  F2: 0x3c,
  F3: 0x3d,
  F4: 0x3e,
  F5: 0x3f,
  F6: 0x40,
  F10: 0x44,
  /** The "Alt" test of the F4 branch (`0xfa`, as read from the asm by ; not a standard DIK code) */
  F4_MODIFIER: 0xfa,
} as const;

/** Mouse-free actions a key press leads to (the engine glue decides how to run them). */
export type KeyAction =
  | { kind: "backspace"; file: string; last: number }
  | { kind: "pause" }
  | { kind: "quickSave"; notice: boolean; useTemp: boolean }
  | { kind: "quickLoad" }
  | { kind: "quit" }
  | { kind: "saveWindow" }
  | { kind: "loadWindow" }
  | { kind: "closeBulletMenu" }
  | { kind: "options" }
  | { kind: "map" }
  | { kind: "coat" };

/** Game state the key conditions read (names of the originals in the comments). */
export interface KeyContext {
  /** `g_sceneNoControl`: SC000D / SC008B */
  sceneNoControl: boolean;
  /** `g_menuOpen`: dialogue answer menu */
  answerMenuOpen: boolean;
  /** a speech caption is on screen */
  captionShown: boolean;
  /** `g_cursorZoneSuspended` = `local_11`: bullet menu open */
  bulletMenuOpen: boolean;
  /** `g_topBarOpen` */
  topBarOpen: boolean;
  /** `g_topBarY < -0x48` */
  topBarFolded: boolean;
  /** `g_macroPlayerLocked` */
  macroPlayerLocked: boolean;
  /** script opcodes 0x64 / 0x65 clear / set it (default 1); Backspace needs it */
  keysEnabled: boolean;
  /** `g_faceLeft != -1 || g_faceRight != -1`: a talking face is shown */
  facesShown: boolean;
  /** Variable `MENU` != 0 */
  menuVar: boolean;
  /** != 0 */
  barFlag: boolean;
  /** `g_noticeShown` */
  noticeShown: boolean;
  /** `Script_AnyMacroActive` */
  macroActive: boolean;
  /** `g_cursorEnabled` */
  cursorEnabled: boolean;
  /** `g_cursorMode` */
  cursorMode: number;
  /** `g_optionsRequest`: the options button was clicked (F4 branch runs without the key) */
  optionsRequest: boolean;
  /** `g_coatRequest`: right click with item in hand, or middle click (opens the coat like F1) */
  coatRequest: boolean;
  /** map allowed in this scene (chapter 2 or 3, or scene number in MAP_SCENES) */
  mapAvailable: boolean;
  /** Backspace result for the current scene (backspaceTarget); undefined = no table entry or no condition holds */
  backspace: { file: string; last: number } | undefined;
  /** `!= 0 && != 0`: scene allows a real save (otherwise F5 copies the temp save) */
  canSave: boolean;
}

/** Scene numbers outside chapters 2 and 3 that still allow the map (9 ints in `.data`). */
export const MAP_SCENES: readonly number[] = [2, 4, 6, 8, 10, 12, 15, 19, 21];

/** for a scene (run for every scene: chapter 2 or 3, or the scene number is in MAP_SCENES). */
export function mapAvailableIn(chapter: number, scene: number): boolean {
  return chapter === 2 || chapter === 3 || MAP_SCENES.includes(scene);
}

export interface KeyInput {
  /** Scan codes with a fresh press this frame (`Input_KeyPressedOnce`; each is consumed by its own check) */
  pressed: ReadonlySet<number>;
  /** Scan codes held down (`Input_IsKeyDown`) */
  down: ReadonlySet<number>;
  /** Character of the last key (`Input_GetLastKey`, result of ToAsciiEx), 0 = none */
  lastChar: number;
}

/** The P test compares this *character*; it equals Ctrl+Y and practically never occurs. */
export const PAUSE_CHAR = 0x19;

const gate = (c: KeyContext) =>
  !c.bulletMenuOpen && !c.facesShown && c.menuVar && !c.barFlag && !c.noticeShown && !c.macroActive;

/**
 * Actions started by the keys of one frame, in the order Game_Run checks them: Backspace, P, F5, F6, F10, F2, F3,
 * Esc (bullet menu), F4 (options), M (map), F1 (coat). The glue must stop after an action that changes the scene or
 * opens a modal screen; the state is read once, so conditions are those at the start of the frame.
 */
export function keyActions(input: KeyInput, c: KeyContext): KeyAction[] {
  const out: KeyAction[] = [];
  const hit = (k: number) => input.pressed.has(k);

  // Backspace (the table entry of the scene decides: backspaceTarget)
  if (
    hit(DIK.BACKSPACE) && !c.sceneNoControl && !c.answerMenuOpen && !c.captionShown &&
    !c.bulletMenuOpen && !c.topBarOpen && !c.macroPlayerLocked && c.keysEnabled && c.backspace
  ) {
    out.push({ kind: "backspace", file: c.backspace.file, last: c.backspace.last });
  }
  // P: a character test, so DIK_P never matches
  if (input.lastChar === PAUSE_CHAR) out.push({ kind: "pause" });
  // F5: no conditions at all
  if (hit(DIK.F5)) out.push({ kind: "quickSave", notice: !c.noticeShown, useTemp: !c.canSave });
  // F6: no conditions
  if (hit(DIK.F6)) out.push({ kind: "quickLoad" });
  // F10: not with an item in hand (cursor mode 5)
  if (hit(DIK.F10) && c.cursorMode !== 5) out.push({ kind: "quit" });
  // F2 / F3
  if (hit(DIK.F2) && !c.optionsRequest && gate(c) && c.topBarFolded) out.push({ kind: "saveWindow" });
  if (hit(DIK.F3) && !c.optionsRequest && gate(c) && c.topBarFolded) out.push({ kind: "loadWindow" });
  // Esc closes the bullet menu
  if (c.bulletMenuOpen && hit(DIK.ESCAPE)) out.push({ kind: "closeBulletMenu" });
  // F4: IsKeyDown (not "once"), without the modifier; the options button (g_optionsRequest) enters directly
  if (c.optionsRequest || (input.down.has(DIK.F4) && !input.down.has(DIK.F4_MODIFIER) && gate(c) && c.topBarFolded)) {
    out.push({ kind: "options" });
  }
  // M: without Ctrl; the map exists only where mapAvailable
  if (!input.down.has(DIK.CONTROL) && hit(DIK.M) && gate(c) && c.mapAvailable) out.push({ kind: "map" });
  // F1 (or a request from the mouse): then the coat opens only when no macro runs and the top bar is closed
  if (
    (hit(DIK.F1) || c.coatRequest) && !c.bulletMenuOpen && !c.facesShown && c.menuVar && c.cursorEnabled && !c.barFlag &&
    !c.noticeShown && !c.macroActive && !c.topBarOpen
  ) {
    out.push({ kind: "coat" });
  }
  return out;
}
