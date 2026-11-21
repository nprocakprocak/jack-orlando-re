// Save slots, quick save and load, and a loaded game.

import { uniformAfterLoad } from "../anim/jack";
import { ANIM_PERIOD } from "../cursor";
import { encodeMazovia } from "../dialog";
import type { Surface16 } from "../render";
import { blitCopy, createSurface } from "../render/surface";
import { VAR_SLOTS } from "../formats/save";
import { NOTICE_Y_QUICKSAVE } from "../keys/notice";
import {
  QUICK_NAME_PL,
  SlotWindow,
  applyInventory,
  loadedVars,
  namedVars,
  type JackPose as SavedPose,
  type LoadedState,
  type ReadResult,
  type SaveState,
} from "../save";
import { ScenePlayer } from "../scene";
import { restoredScroll } from "../scene/scroll";
import type { PlayInput } from "./types";
import type { GameState } from "./game-state";

/** Background work (a store write or read): `settle()` waits for it. */
export function io(this: GameState, p: Promise<void>): void {
    const run = (this.ioPromise ?? Promise.resolve()).then(() => p).catch((e) => this.addLog(`! zapis: ${e instanceof Error ? e.message : String(e)}`));
    const mine = run.finally(() => {
      if (this.ioPromise === mine) this.ioPromise = null;
    });
    this.ioPromise = mine;
  }

/** Copy of the scene picture the windows are drawn over (what the menu freezes). */
export function snapshot(this: GameState): Surface16 {
    const sc = this.scene!;
    const snap = createSurface(640, 480);
    blitCopy(sc.renderer.framebuffer, sc.scrollX, 0, 640, 480, snap, 0, 0);
    return snap;
  }

/**
 * What the file is made. The item in hand goes back to the coat first, every kind of save (F2 does it in the original -
 * `Item_PutBackToBar`, -, F5 loses the item; user decision 2026-11-03).
 */
export function saveState(this: GameState): SaveState {
    if (this.inventory.held) {
      this.inv().putBack();
      this.cursor.mode = this.verbMode = 0;
    }
    const entries = [...this.vars.entries()];
    const vars = new Array<number>(VAR_SLOTS).fill(0);
    entries.forEach(([, v], i) => (vars[i] = v));
    return {
      scene: `${this.sceneName}.CCG`,
      music: this.audio.music.trackName,
      vars,
      varCount: entries.length,
      inventory: this.inv(),
      light: !!this.opts.easy,
      autoInc: this.autoInc.state(),
      pose: this.jackSaved,
      sceneSaveable: this.sceneSaveable,
      jackPlaced: this.jackPlaced,
    };
  }

/** F5: the strip "Szybki Zapis" when no strip is shown, then the file. */
export function quickSave(this: GameState, notice: boolean): void {
    const save = this.opts.save;
    if (!save) return;
    if (notice && this.noticeFont) this.notice.showAuto(NOTICE_Y_QUICKSAVE, encodeMazovia(QUICK_NAME_PL), this.noticeFont);
    const state = saveState.call(this);
    io.call(this, save.quickSave(state).then((r) => this.addLog(`zapis: ${r.name}${r.kind === "copy" ? " (kopia początku sceny)" : ""}`)));
  }

/** F6: the newest quick save; no file = nothing happens, a file of the other version is refused silently. */
export function quickLoad(this: GameState): void {
    const save = this.opts.save;
    if (!save) return;
    io.call(this, save.quickLoad().then((r) => void afterRead.call(this, r)));
  }

/** The result of reading a save: loaded = the scene is entered again (`g_sceneChange`); otherwise the game goes on. */
export function afterRead(this: GameState, r: ReadResult | null): boolean {
    if (!r) return false;
    if (!r.ok) {
      this.addLog(`wczytanie: ${r.reason === "version" ? "zapis innej wersji gry (cicho pominięty)" : r.message}`);
      return false;
    }
    this.applyLoaded(r.state);
    return true;
  }

/**
 * F2 / F3 and the menu's "Save" / "Load" (`Menu_Save`, `Menu_Load`): the system
 * window of the file (`saveMode` "files": the game waits for it) or the slot window ("slots"). The hand goes to the coat,
 * the cursor is mode 0, the effects pause. False = no storage.
 */
export function fileWindow(this: GameState, kind: "save" | "load", fromMenu: boolean): boolean {
    const save = this.opts.save;
    if (!save || !this.scene || this.phase !== "playing") return false;
    this.cursor.mode = 0;
    if (!fromMenu) this.audio.pauseEffects(true);
    const done = () => {
      this.modal = false;
      if (!fromMenu) leaveWindow.call(this);
    };
    this.modal = true;
    if (this.opts.saveMode === "slots") {
      const scene = fromMenu && this.menuScene ? this.menuScene : snapshot.call(this);
      io.call(this, 
        save.slotDescriptions().then(
          (d) => {
            this.modal = false;
            this.slotUi = { win: new SlotWindow(this.menuAssets!, scene, kind, d), kind, scene, screen: createSurface(640, 480), down: false, fromMenu };
          },
          (e) => {
            done();
            throw e;
          },
        ),
      );
      return true;
    }
    const state = kind === "save" ? saveState.call(this) : null;
    io.call(this, 
      (kind === "save" ? save.saveToFile(state!).then(() => null) : save.loadFromFile()).then(
        (r) => {
          done();
          if (kind === "load" && afterRead.call(this, r)) this.menu?.close();
        },
        (e) => {
          done();
          throw e;
        },
      ),
    );
    return true;
  }

/**
 * "Load a game" of the main menu: `Game_Run` with `g_loadOnStart` (set by `Game_Main` for launcher result 3) calls
 * `Menu_Load` in the first frame of SC001. The window opens over the scene; a cancel leaves the plain new game. False = the scene is
 * not playing yet (the page tries again next frame).
 */
export function openLoadWindow(this: GameState): boolean {
    return this.fileWindow("load", false);
  }

/** Back in the game after a window opened by a key (F2 / F3): effects go on, the click that closed it does not reach the scene. */
export function leaveWindow(this: GameState): void {
    this.audio.pauseEffects(false);
    this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
    this.armed = false;
    this.talkArmed = false;
  }

/** The slot window while open: the mouse of the page drives it; keys come through `keyDown` (so that Esc counts once). */
export function slotFrame(this: GameState, input: PlayInput): void {
    const ui = this.slotUi!;
    if (input.pressed) {
      slotEvents.call(this, ui.win.pointerDown(input.x, input.y));
      ui.down = true;
    } else if (this.slotUi) slotEvents.call(this, ui.win.pointerMove(input.x, input.y));
    if (!input.down && ui.down && this.slotUi) {
      ui.down = false;
      slotEvents.call(this, ui.win.pointerUp(input.x, input.y));
    }
    if (this.slotUi && this.menuCursorCountdown-- < 1) {
      this.menuCursorCountdown = ANIM_PERIOD;
      this.cursor.inWindow = input.inWindow;
      this.cursor.setTargets(false, false);
      this.cursor.animate(input.x);
    }
  }

export function slotEvents(this: GameState, events: ReturnType<SlotWindow["keyDown"]>): void {
    const save = this.opts.save;
    if (!save || !this.slotUi) return;
    for (const e of events) {
      if (!this.slotUi) return;
      if (e.kind === "cancel") closeSlots.call(this);
      else if (e.kind === "newGame") {
        closeSlots.call(this);
        this.menu?.close();
        this.leaveMenu();
        this.newGame();
      } else if (e.kind === "load") {
        io.call(this, 
          save.loadFromSlot(e.slot).then((r) => {
            if (afterRead.call(this, r)) {
              this.slotUi = null;
              this.menu?.close();
            }
          }),
        );
      } else if (e.kind === "save") {
        const state = saveState.call(this);
        // an empty description is the name of the scene
        io.call(this, 
          save
            .saveToSlot(state, e.slot, e.description.trim() ? e.description : this.sceneName)
            .then(() => save.slotDescriptions())
            .then((d) => this.slotUi?.win.setDescriptions(d)),
        );
      }
    }
  }

export function closeSlots(this: GameState): void {
    const ui = this.slotUi;
    if (!ui) return;
    this.slotUi = null;
    if (ui.fromMenu) this.menuInput = { down: false, escape: this.lastInput.escape === true }; // the Esc that closed the window must not close the menu
    else leaveWindow.call(this);
  }

/**
 * Loads a read save (`Save_LoadState` and what Game_Run does after `g_gameLoaded`): the variables
 * (those the file lacks keep their start values), the uniform (`JACKISWOJ`), the coat (the hand is empty), the music is left to
 * the scripts; then the scene is entered again with `PRE` / `INIT`, Jack at the saved pose when the file says so.
 */
export function applyLoaded(this: GameState, l: LoadedState): void {
    const names = [...this.defaults.keys()];
    const values = loadedVars(l, [...this.defaults.values()]);
    names.forEach((n, i) => this.vars.set(n, values[i]));
    const nv = namedVars(values, names);
    this.jackUniform = uniformAfterLoad(this.uniform, nv.jackIsWoj); //
    if (this.dialog) this.dialog.jackUniform = this.jackUniform;
    applyInventory(this.inventory, l, nv.marzeczy);
    this.autoInc.restore(l.autoInc);
    this.bullet.close();
    this.coatRequest = false;
    this.cursor.mode = this.verbMode = 0;
    this.fadeRequested = false;
    this.pendingScene = null;
    this.pendingMovie = null;
    this.pendingFilm = null;
    // a track name different from the playing one stops the music (`Music_Stop(2)`); the same one plays on, uninterrupted.
    // The name stays as it was; the scene's MUSIC command (case 0x3e) compares with it and starts a track only when it differs.
    // The new track is started by `enter` before PRE (`Scene_SetNumberAndMapFlag`); `loadSaved` remembers it.
    this.audio.music.loadSaved(l.music);
    this.audio.pauseEffects(false);
    this.armed = false;
    this.talkArmed = false;
    const scene = l.scene.replace(/\.CCG$/i, "");
    this.addLog(`→ wczytano zapis: ${scene}`);
    this.phase = "loading";
    this.loadPromise = this.enter(scene, l.restorePose ? l.pose : undefined)
      .catch(() => undefined)
      .finally(() => {
        this.loadPromise = null;
      });
  }

/** `g_restoreJackPose`: Jack at the saved place, `Jack_Stand`; the view as `restoredScroll` (right of 650 → right edge, left of 650 → 0;). */
export function restoreJack(this: GameState, sc: ScenePlayer, p: SavedPose): void {
    sc.setJackPosition(p.x, p.y);
    sc.walker.scale = p.scale;
    sc.walker.dir = p.dir as typeof sc.walker.dir;
    sc.walker.mirror = (p.facing < 0 ? -1 : 1) as typeof sc.walker.mirror;
    sc.standJack();
    sc.scrollX = restoredScroll(sc.scrollX, sc.walker.x, sc.bgWidth);
    this.jackSaved = sc.pose();
  }

/** The game is over (OUTRO.AVX or "Quit the game"): the page stops the engine (`onExit`, `exit`). */
export function finish(this: GameState, reason: "quit" | "finished" | "death"): void {
    this.exit = reason;
    this.phase = "finished";
    this.opts.onExit?.(reason);
  }
