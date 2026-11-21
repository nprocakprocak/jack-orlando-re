// Keys, the wheel, and the key step of a frame.

import { debugVerbAllowed } from "../bulletmenu";
import { DIK_COAT } from "../inventory";
import { DIK, keyActions, mapAvailableIn, sceneChapter, sceneNumber, type KeyContext } from "../keys";
import { DIK_MAP, loadMiniMapAssets } from "../minimap";
import { isNoControlScene } from "../map";
import type { GameState } from "./game-state";
import { slotEvents, snapshot } from "./game-save";
import { playerHeld } from "./game-frame";

/** KeyboardEvent.key -> the scan code the coat reads */
const COAT_KEYS: Readonly<Record<string, number>> = {
  Escape: DIK_COAT.ESC, F1: DIK_COAT.F1, Home: DIK_COAT.HOME, ArrowUp: DIK_COAT.UP, PageUp: DIK_COAT.PGUP,
  End: DIK_COAT.END, ArrowDown: DIK_COAT.DOWN, PageDown: DIK_COAT.PGDN,
};

/** KeyboardEvent.key -> DirectInput scan code of the keys `Game_Run` reads */
const KEY_DIK: Readonly<Record<string, number>> = {
  F1: DIK.F1, F2: DIK.F2, F3: DIK.F3, F4: DIK.F4, F5: DIK.F5, F6: DIK.F6, F10: DIK.F10,
  m: DIK.M, M: DIK.M, // the small map
};

/**
 * A key went down (KeyboardEvent.key: "F4", "F10", "Enter", "Escape"...). Returns true when the game takes it (the page then
 * calls preventDefault). With the menu open it goes to the menu; otherwise F1..F6 and F10 are remembered for the next frame
 * (`Input_KeyPressedOnce`), where `keyFrame` decides with the conditions of `Game_Run`.
 */
export function keyDown(this: GameState, key: string, repeat = false): boolean {
    if (key === "m" || key === "M") this.mKeyHeld = true;
    if (this.modal) return true;
    if (this.slotUi) {
      if (!repeat || key.length === 1 || key === "Backspace") slotEvents.call(this, this.slotUi.win.keyDown(key));
      return true;
    }
    if (this.menu?.isOpen) {
      if (!repeat) this.menu.keyDown(key);
      return true;
    }
    if (this.verbWindow) {
      if (!repeat) this.verbWindow.keyDown(key);
      return true;
    }
    if (this.miniMap?.isOpen) {
      // the map polls Input_IsKeyDown(M / Esc) itself
      const code = key === "Escape" ? DIK_MAP.ESC : key === "m" || key === "M" ? DIK_MAP.M : undefined;
      if (code !== undefined && !repeat) this.miniMap.keyDown(code);
      return true;
    }
    if (this.coat?.isOpen) {
      // Input_KeyPressedOnce: the scroll keys and F1 / Esc act on the edge, a held key does not repeat
      const code = COAT_KEYS[key];
      if (code === undefined) return false;
      if (!repeat) this.coat.keyDown(code);
      return true;
    }
    if (key === "Escape" && !repeat) this.escPressed = true; // Input_KeyPressedOnce(Esc) closes the bullet menu (step 12)
    const dik = KEY_DIK[key];
    if (dik === undefined) return false;
    if (!repeat) this.keysPressed.add(dik);
    return true;
  }

/**
 * [deviation: the original has no wheel]: the wheel scrolls the coat by a row (region A) or the item bar by a slot.
 * `deltaY` / `deltaMode` as in WheelEvent; small touchpad deltas are summed to one notch. Returns true when the wheel
 * works here (the page then calls preventDefault); elsewhere it does nothing.
 */
export function wheel(this: GameState, deltaY: number, deltaMode = 0): boolean {
    const coat = this.coat?.isOpen ? this.coat : null;
    const bar = !coat && this.bar?.isOpen ? this.bar : null;
    if (!coat && !bar) {
      this.wheelSum.reset();
      return false;
    }
    if (coat && !coat.scrollable) return false;
    const dir = this.wheelSum.add(deltaY, deltaMode);
    if (dir !== 0) (coat ?? bar)!.wheel(dir);
    return true;
  }

export function keyUp(this: GameState, key: string): void {
    if (key === "m" || key === "M") this.mKeyHeld = false;
    if (this.miniMap?.isOpen) {
      if (key === "Escape") this.miniMap.keyUp(DIK_MAP.ESC);
      else if (key === "m" || key === "M") this.miniMap.keyUp(DIK_MAP.M);
      return;
    }
    if (this.slotUi) slotEvents.call(this, this.slotUi.win.keyUp(key));
    else if (this.menu?.isOpen) this.menu.keyUp(key);
    else if (this.verbWindow) this.verbWindow.keyUp(key);
  }

/** The state the key conditions of `Game_Run` read. */
export function keyContext(this: GameState): KeyContext {
    const d = this.dialog;
    const locked = playerHeld.call(this);
    return {
      sceneNoControl: isNoControlScene(this.sceneName),
      answerMenuOpen: !!d?.menu,
      captionShown: !!d?.caption && !this.captionHidden,
      bulletMenuOpen: this.bullet.open,
      topBarOpen: this.bar?.isOpen ?? false,
      topBarFolded: true,
      macroPlayerLocked: locked,
      keysEnabled: true,
      facesShown: !!d && (d.faceView("L") !== null || d.faceView("R") !== null),
      menuVar: this.vars.get("MENU") !== 0,
      barFlag: this.scrolling,
      noticeShown: this.notice.shown,
      // Script_AnyMacroActive reads the TAKE flags, not "a macro is running"
      macroActive: this.takeFlag,
      cursorEnabled: !locked,
      cursorMode: this.cursor.mode,
      optionsRequest: this.optionsRequest,
      coatRequest: this.coatRequest,
      mapAvailable: mapAvailableIn(sceneChapter(sceneNumber(this.sceneName)), sceneNumber(this.sceneName)), //
      backspace: undefined,
      canSave: this.sceneSaveable && this.jackPlaced,
    };
  }

/**
 * The key step of the frame: F4 (menu) and F10 (leave the game?) open the menu, F1 (or the mouse) the coat; the rest (F2/F3/F5/F6 saves -
 *, M map, Backspace) is read and dropped. F4 is read as a *held* key in the original (`Input_IsKeyDown`); here it counts
 * for the frame after the press only, so closing the menu with F4 still held does not open it again (deviation).
 */
export function keyFrame(this: GameState): boolean {
    const pressed = new Set(this.keysPressed);
    this.keysPressed.clear();
    const ctx = keyContext.call(this);
    this.takeFlag = false; // clears the flag at the macro's next step, which follows this key step
    const down = new Set<number>(pressed.has(DIK.F4) ? [DIK.F4] : []);
    for (const a of keyActions({ pressed, down, lastChar: 0 }, ctx)) {
      if (a.kind === "options") return this.openMenu("main");
      if (a.kind === "quit") return this.openMenu("quit");
      if (a.kind === "coat") return this.openCoat();
      if (a.kind === "map") return openMiniMap.call(this);
      if (a.kind === "saveWindow") return this.fileWindow("save", false);
      if (a.kind === "loadWindow") return this.fileWindow("load", false);
      if (a.kind === "quickSave") this.quickSave(a.notice);
      if (a.kind === "quickLoad") this.quickLoad();
    }
    return false;
  }

/**
 * A developer aid for the host (the original has no digit keys):
 * the cursor mode is set only if the verb window would offer it - mode 3 only with `GUN = 1`, none with an item
 * in hand or under an open menu. Returns whether the mode changed.
 */
export function setDebugVerb(this: GameState, verb: number): boolean {
    const menuOpen = this.bullet.open || !!this.verbWindow || !!this.menu?.isOpen || !!this.coat?.isOpen || !!this.bar?.isOpen || !!this.slotUi || !!this.modal;
    if (!debugVerbAllowed(verb, { gun: this.vars.get("GUN") === 1, itemInHand: !!this.inventory.held, menuOpen })) return false;
    this.verbMode = verb;
    this.cursor.mode = verb;
    this.cursor.startSwitch();
    return true;
  }

/** M: the scene stands, the effects pause, the music goes on, no cursor. */
export function openMiniMap(this: GameState): boolean {
    const mm = this.miniMap;
    if (!mm || !this.scene || this.phase !== "playing") return false;
    mm.open(loadMiniMapAssets(this.global, sceneChapter(sceneNumber(this.sceneName))), snapshot.call(this), this.mKeyHeld);
    this.bullet.close();
    this.audio.pauseEffects(true); // Snd_TogglePauseFx
    return true;
  }

/** The end of the small map: the effects go on; like the coat, no click reaches the scene before the buttons are up. */
export function onMiniMapExit(this: GameState): void {
    this.audio.pauseEffects(false);
    this.armed = false;
    this.talkArmed = false;
    this.waitRelease = true;
  }
