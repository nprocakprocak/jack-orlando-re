// The options menu, its settings, and a new game.

import { ANIM_PERIOD } from "../cursor";
import type { MenuAction } from "../gui";
import type { GameConfig } from "../settings/config";
import type { PlayInput } from "./types";
import type { GameState } from "./game-state";
import { snapshot, finish } from "./game-save";
import { clearInventory } from "./game-inventory";

/** Game_Run: the scene stands, the effects pause, the pointer is the cursor of mode 0. */
export function openMenu(this: GameState, screen: "main" | "quit" = "main"): boolean {
    const sc = this.scene;
    const menu = this.menu;
    if (!menu || !sc || this.phase !== "playing") return false;
    this.optionsRequest = false;
    const snap = snapshot.call(this);
    this.menuScene = snap;
    this.menuInput = { down: false, escape: false };
    this.cursor.mode = 0;
    this.cursor.inWindow = true;
    this.audio.pauseEffects(true);
    menu.setScene(snap);
    menu.open(screen);
    return true;
  }

/** The menu while open: the mouse of the page and Esc (`PlayInput.escape`) drive it; the scene is not touched. */
export function menuFrame(this: GameState, input: PlayInput): void {
    const menu = this.menu!;
    const st = this.menuInput;
    if (input.pressed) {
      menu.pointerDown(input.x, input.y);
      st.down = true;
    } else if (menu.isOpen) menu.pointerMove(input.x, input.y);
    if (!input.down && st.down && menu.isOpen) {
      st.down = false;
      menu.pointerUp(input.x, input.y);
    }
    const esc = input.escape === true;
    if (esc !== st.escape && menu.isOpen) {
      st.escape = esc;
      if (esc) menu.keyDown("Escape");
      else menu.keyUp("Escape");
    }
    if (menu.isOpen && this.menuCursorCountdown-- < 1) {
      this.menuCursorCountdown = ANIM_PERIOD;
      this.cursor.inWindow = input.inWindow;
      this.cursor.setTargets(false, false);
      this.cursor.animate(input.x);
    }
  }

/** Back in the game: effects go on, the pointer returns to the chosen verb. */
export function leaveMenu(this: GameState): void {
    this.audio.pauseEffects(false);
    this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
    // the click that pressed the button must not reach the scene
    this.armed = false;
    this.talkArmed = false;
  }

export function onMenuAction(this: GameState, a: MenuAction): void {
    switch (a.type) {
      case "resume":
        return this.leaveMenu();
      case "newGame":
        this.leaveMenu();
        return this.newGame();
      case "quit":
        this.endSurface = this.menuScene;
        return finish.call(this, "quit");
      case "load":
      case "save":
        if (!this.fileWindow(a.type, true)) this.addLog(`menu: ${a.type === "load" ? "Załaduj" : "Zapisz"} grę — bez magazynu zapisów`);
        return;
      case "setting":
        return applySetting.call(this, a.key);
      case "preview":
        return this.audio.preview(a.channel, a.value);
      case "settingsSaved":
        return;
    }
  }

/** An option of the menu changed (`this.settings` already holds the value). */
export function applySetting(this: GameState, key: keyof GameConfig): void {
    this.audio.applySetting(key, this.settings);
    if (key === "showText" && this.dialog) this.dialog.textOn = this.settings.showText !== 0;
    if (key === "walkSpeed" && this.scene) this.scene.walkSpeed = this.settings.walkSpeed;
  }

/**
 * "Start a new game" (Menu_InGameOptions and Game_Run): `Cursor_LoadSet1`, `Inventory_Clear`,
 * `Var_LoadAll` (every variable back to VARIABLE.ALL), the uniform off; the easy version then gets `Cursor_LoadSet2` + `GUN = 1`.
 * `Game_Run` loads `SC001.CCG` without a fade. **Hypothesis:** the sound is stopped (the code that does this was not found).
 */
export function newGame(this: GameState): void {
    this.fadeRequested = false;
    this.pendingScene = null;
    this.pendingMovie = null;
    this.pendingFilm = null;
    clearInventory.call(this);
    this.opts.onNewGame?.();
    for (const [k, v] of this.defaults) this.vars.set(k, v);
    this.jackUniform = false;
    this.refusalCounter = 0; // Game_Run prologue
    this.refusal = null;
    if (this.dialog) this.dialog.jackUniform = false;
    if (this.opts.easy) this.vars.set("GUN", 1);
    this.audio.silence();
    this.audio.music.trackName = "";
    this.history.length = 0;
    this.addLog("→ nowa gra: SC001");
    this.phase = "loading";
    this.loadPromise = this.enter("SC001")
      .catch(() => undefined)
      .finally(() => {
        this.loadPromise = null;
      });
  }
