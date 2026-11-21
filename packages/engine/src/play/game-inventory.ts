// The coat, the item bar, the bullet menu, and the verb window.

import { ANIM_PERIOD, noHaveGunCursor } from "../cursor";
import { decodeBm, type Image16 } from "../formats/bm";
import { decodePbm } from "../formats/pbm";
import { interpreterPort } from "../areas";
import { blitCopy, createSurface } from "../render/surface";
import { VerbMenu, VERB_TEXTS, type BulletEvent } from "../bulletmenu";
import { Inventory, InventoryError, itemNameLookup, type CoatExit, type CoatHost } from "../inventory";
import type { TopBarHost } from "../inventory/topbar";
import { sceneChapter, sceneNumber } from "../keys";
import { ScenePlayer } from "../scene";
import { isNoControlScene, MAP_SCENE } from "../map";
import type { ItemPort } from "./host";
import { mapLast } from "./predicates";
import type { PlayInput } from "./types";
import type { GameState } from "./game-state";
import { scenePak } from "./game-scene";
import { playerHeld, enableDraw } from "./game-frame";

/** The inventory with MARZECZY applied: `Inventory_Add` chooses the region by the variable at the moment of the call. */
export function inv(this: GameState): Inventory {
    this.inventory.marzeczy = this.vars.has("MARZECZY") ? this.vars.get("MARZECZY") : 1;
    return this.inventory;
  }

/** The item in hand as the cursor image (mode 5). */
export function heldImage(this: GameState): Image16 | null {
    return (this.inventory.held?.image as Image16 | undefined) ?? null;
  }

/** Image of an object by name: the scene's archive, then GLOBAL.PAK and RESOURCE.PAK (items made by the global macros). */
export function objectImage(this: GameState, name: string, sc: ScenePlayer): Image16 | null {
    for (const pak of [scenePak.call(this, sc), this.global, this.resource]) {
      if (!pak.find(name)) continue;
      try {
        const data = pak.read(name);
        const img = name.toUpperCase().endsWith(".PBM") ? decodePbm(data, name) : decodeBm(data); // as ScenePlayer.image
        if (img.width > 0 && img.height > 0) return img;
      } catch {
        // an undecodable file is not an image
      }
    }
    return null;
  }

/** `Inventory_Clear` and `Cursor_ResetMode` (a new game, the return after an exit film). */
export function clearInventory(this: GameState): void {
    this.inventory.clear();
    this.bullet.close();
    this.coatRequest = false;
    this.cursor.mode = this.verbMode = 0;
  }

/** The inventory commands of the scripts (host.ts `ItemPort`;). */
export function itemPort(this: GameState, sc: ScenePlayer): ItemPort {
    const guarded = (action: string, f: () => void): void => {
      try {
        f();
      } catch (e) {
        if (!(e instanceof InventoryError)) throw e;
        this.addLog(`! ${action}: ${e.message}`);
      }
    };
    return {
      haveTool: (object) =>
        guarded(`HAVETOOL ${object}`, () => {
          const img = objectImage.call(this, object, sc);
          if (!img) this.addLog(`! HAVETOOL ${object}: no image`);
          else if (this.inv().add(object, img) < 0) this.addLog(`HAVETOOL ${object}: the coat is full`);
        }),
      noHaveTool: (name) => {
        if (this.inventory.held?.name === name) this.cursor.mode = this.verbMode = 0; // Script_ExecStep case 0x46,
        this.inv().remove(name);
      },
      noHave: () => {
        this.inventory.noHave();
        this.cursor.mode = this.verbMode = 0;
      },
      take: (object) => {
        const img = objectImage.call(this, object, sc);
        if (!img) return false;
        guarded(`TAKE ${object}`, () => this.inv().take(object, img));
        if (this.inventory.held?.name !== object) return false;
        // case 0x21: g_cursorMode = 5, g_clickArmed = 0; the bullet menu closes
        this.cursor.mode = 5;
        this.armed = false;
        this.bullet.close();
        this.takeFlag = true;
        return true;
      },
      mouseToTool: () => {
        if (!this.inventory.held) return;
        this.inv().putBack();
        this.cursor.mode = this.verbMode = 0;
      },
      itemPresent: (name) => this.inventory.has(name),
      moveBigRegion: () => this.inventory.moveBigRegion(),
      setGun: (on) => {
        // HAVEGUN: Cursor_LoadSet2 + GUN = 1; NOHAVEGUN: Cursor_LoadSet1 + GUN = 0, and mode 3 becomes 0
        this.vars.set("GUN", on ? 1 : 0);
        // Script_ExecStep l. 1795: only the gun cursor itself goes back to the pointer, together with the verb
        if (!on) {
          const c = noHaveGunCursor({ mode: this.cursor.mode, verbMode: this.verbMode });
          this.cursor.mode = c.mode;
          this.verbMode = c.verbMode;
        }
      },
      setUniform: (on) => {
        this.jackUniform = on;
      },
    };
  }

export function coatHost(this: GameState): CoatHost {
    const names = this.resource.find("ELEM.LST") ? itemNameLookup(this.resource.read("ELEM.LST")) : () => null;
    return {
      startMacro: (name) => !!this.interpreter && interpreterPort(this.interpreter).start(name) >= 0,
      itemName: names,
      onExit: (e) => onCoatExit.call(this, e),
    };
  }

/** Button edges of this frame (the page latches them, else they come from the change of the level). */
export function edges(this: GameState, input: PlayInput): { right: boolean; middle: boolean } {
    const right = input.rightPressed ?? (!!input.right && !this.prevRight);
    const middle = input.middlePressed ?? (!!input.middle && !this.prevMiddle);
    this.prevRight = !!input.right;
    this.prevMiddle = !!input.middle;
    return { right, middle };
  }

/** Game_Run: the scene stands, effects pause, the coat of the current uniform opens. */
export function openCoat(this: GameState): boolean {
    const coat = this.coat;
    if (!coat || this.bar || this.phase !== "playing") return false;
    this.inv();
    this.coatRequest = false;
    this.bullet.close();
    coat.open(this.uniform);
    this.coatWait = !!(this.lastInput.down || this.lastInput.right || this.lastInput.middle); // opened by a button: it waits until they are up
    this.coatLeftDown = false;
    this.audio.pauseEffects(true);
    this.cursor.mode = coat.cursorMode;
    this.cursor.inWindow = true;
    return true;
  }

/** The coat while open: the mouse of the page drives it; the scene is not touched. */
export function coatFrame(this: GameState, input: PlayInput): void {
    const coat = this.coat!;
    const e = this.edges(input);
    if (this.coatWait && !input.down && !input.right && !input.middle) this.coatWait = false;
    coat.pointerMove(input.x, input.y);
    if (!this.coatWait) {
      // the Ctrl points are a level check of Game_Run: Ctrl pressed while the button is already held over a point works too
      if (input.ctrl && input.down && !input.pressed && coat.ctrlHeld(input.x, input.y)) return;
      if (input.pressed) {
        this.coatLeftDown = true;
        coat.pointerDown(input.x, input.y, 0, input.ctrl === true);
      }
      if (coat.isOpen && e.middle) coat.pointerDown(input.x, input.y, 1);
      if (coat.isOpen && e.right) coat.pointerDown(input.x, input.y, 2);
      if (coat.isOpen && !input.down && this.coatLeftDown) {
        this.coatLeftDown = false;
        coat.pointerUp(input.x, input.y, 0);
      }
    }
    if (!coat.isOpen) return;
    coat.tick();
    this.cursor.mode = coat.cursorMode;
    this.cursor.inWindow = input.inWindow;
    if (this.coatCursorCountdown-- < 1) {
      this.coatCursorCountdown = ANIM_PERIOD;
      this.cursor.setTargets(!coat.cursorIdle, !coat.cursorIdle);
      this.cursor.animate(input.x);
    }
  }

/** The end of the coat: effects go on, the cursor returns to the verb unless an item is held. */
export function onCoatExit(this: GameState, e: CoatExit): void {
    this.audio.pauseEffects(false);
    this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
    this.armed = false;
    this.talkArmed = false;
    this.waitRelease = true;
    switch (e.kind) {
      case "close":
      case "macro":
        return;
      case "options":
        this.openMenu("main");
        return;
      case "ctrl":
        return this.ctrlPoint(e.point);
    }
  }

export function barHost(this: GameState): TopBarHost {
    const names = this.resource.find("ELEM.LST") ? itemNameLookup(this.resource.read("ELEM.LST")) : () => null;
    return {
      startMacro: (name) => !!this.interpreter && interpreterPort(this.interpreter).start(name) >= 0,
      macroActive: (name) => !!this.interpreter?.isActive(name),
      itemName: names,
      requestOptions: () => this.openMenu("main"),
    };
  }

/** One frame of the bar; true while it holds the mouse (the scene stands still, update() is frozen). */
export function barFrame(this: GameState, input: PlayInput): boolean {
    const bar = this.bar!;
    this.inv();
    const was = bar.isOpen;
    const e = this.edges(input);
    const free = !playerHeld.call(this) && !this.dialog?.talking && !this.dialog?.menu && !this.bullet.open &&
      !this.notice.shown && !this.pendingScene && !this.pendingMovie && !this.pendingFilm;
    bar.frame({ x: input.x, y: input.y, down: !!input.down, pressed: !!input.pressed, right: !!input.right, rightPressed: e.right, inWindow: input.inWindow }, free);
    if (bar.isOpen) {
      if (!was) this.bullet.close();
      this.cursor.mode = bar.cursorMode;
      this.cursor.inWindow = input.inWindow;
      if (this.barCursorCountdown-- < 1) {
        this.barCursorCountdown = ANIM_PERIOD;
        this.cursor.setTargets(!bar.cursorIdle, !bar.cursorIdle);
        this.cursor.animate(input.x);
      }
      return true;
    }
    if (was && this.menu?.isOpen) {
      // the options button opened the F4 menu in this frame (openMenu set the pointer, mode 0): keep it; leaveMenu restores the verb cursor
      this.armed = false;
      this.talkArmed = false;
      return true;
    }
    if (was) {
      // the bar is gone: the cursor returns to the verb unless an item is held; the click that ended it does not reach the scene
      this.cursor.mode = this.inventory.held ? 5 : this.verbMode;
      this.armed = false;
      this.talkArmed = false;
      this.waitRelease = true;
      return true;
    }
    return false;
  }

/** The hidden Ctrl points of the coat (debug features of the original). */
export function ctrlPoint(this: GameState, point: number): void {
    const sc = this.scene;
    if (!sc || !this.interpreter) return;
    switch (point) {
      case 1: // TOPWARE + MONEY.BM (Inventory_Add)
        interpreterPort(this.interpreter).start("TOPWARE");
        itemPort.call(this, sc).haveTool("MONEY.BM");
        this.addLog("Ctrl + płaszcz: TOPWARE i MONEY.BM");
        return;
      case 2: // strcpy("OUTRO.AVX"): the exit film, the end of the game
        this.pendingMovie = { film: "OUTRO.AVX", scene: "NULL" };
        return;
      case 3: {
        // the city map SC000D, a hard cut (g_sceneChange; = 1 only hides the cursor until the change ends, Cursor_DrawOnPresent ; fading comes only from REFRESHSCREEN); `LAST` by the chapter of the current scene (Scene_ChapterFromName, Scene_SetNumberAndMapFlag)
        const last = mapLast(sceneChapter(sceneNumber(this.sceneName)));
        if (last !== null) this.vars.set("LAST", last);
        this.fadeRequested = false;
        this.pendingScene = MAP_SCENE;
        return;
      }
      case 4: // the JACKISMENU toggle: Var_Set and g_jackIsMenu together
        this.vars.set("JACKISMENU", this.vars.get("JACKISMENU") !== 0 ? 0 : 1);
        this.jackIsMenu = this.vars.get("JACKISMENU") !== 0;
        return;
    }
  }

/**
 * Steps 12-13 of Game_Run: the right button opens the bullet menu or the verb window, the left one chooses an icon.
 * "verb" = the modal window opened (the frame ends), "blocked" = the bullet is open and this frame's left click must not reach the scene.
 */
export function bulletFrame(this: GameState, input: PlayInput, world: { x: number; y: number }, locked: boolean): "none" | "verb" | "blocked" {
    const sc = this.scene!;
    const d = this.dialog;
    const esc = this.escPressed;
    this.escPressed = false;
    const click = this.cursor.clickPoint(world.x, world.y);
    const gun = this.vars.get("GUN") === 1;
    const events = this.bullet.frame({
      mouseX: world.x,
      mouseY: world.y,
      scrollX: sc.scrollX,
      clickX: click.x,
      clickY: click.y,
      leftDown: input.down,
      rightDown: input.right === true,
      esc,
      cursorMode: this.cursor.mode,
      gun,
      showBullet: this.showBullet,
      blocked: (!!d && (d.faceView("L") !== null || d.faceView("R") !== null)) || isNoControlScene(this.sceneName),
      cursorEnabled: !locked,
      language: "P",
    });
    let verb: Extract<BulletEvent, { type: "verbMenu" }> | null = null;
    for (const ev of events) {
      if (ev.type === "open") {
        // g_cursorMode = 0, then Cursor_EnableDraw - the verb is the pointer again
        this.cursor.mode = 0;
        enableDraw.call(this);
      }
      else if (ev.type === "select") this.cursor.mode = this.verbMode = ev.mode;
      else if (ev.type === "verbMenu") verb = ev;
    }
    if (verb) {
      this.cursor.mode = 0;
      return openVerbWindow.call(this, verb.x, verb.y, gun) ? "verb" : "none";
    }
    return this.bullet.blockLeft ? "blocked" : "none";
  }

/** `Cursor_VerbMenu`: the modal list of verbs at the screen position; the effects pause meanwhile. */
export function openVerbWindow(this: GameState, x: number, y: number, gun: boolean): boolean {
    const sc = this.scene;
    if (!sc || !this.menuAssets) return false;
    const snap = createSurface(640, 480);
    blitCopy(sc.renderer.framebuffer, sc.scrollX, 0, 640, 480, snap, 0, 0);
    this.verbScene = snap;
    this.verbWindow = new VerbMenu(this.menuAssets, snap, x, y, gun, VERB_TEXTS.P);
    this.verbLeftDown = false;
    this.audio.pauseEffects(true);
    return true;
  }

export function verbFrame(this: GameState, input: PlayInput): void {
    const v = this.verbWindow!;
    if (!v.done) {
      if (input.pressed) {
        v.pointerDown(input.x, input.y);
        this.verbLeftDown = true;
      } else v.pointerMove(input.x, input.y);
      if (!input.down && this.verbLeftDown && !v.done) {
        this.verbLeftDown = false;
        v.pointerUp(input.x, input.y);
      }
    }
    if (v.done) return finishVerb.call(this);
    if (this.menuCursorCountdown-- < 1) {
      this.menuCursorCountdown = ANIM_PERIOD;
      this.cursor.inWindow = input.inWindow;
      this.cursor.setTargets(false, false);
      this.cursor.animate(input.x);
    }
  }

/** The window ended: the chosen mode becomes the verb; Esc leaves mode 0. */
export function finishVerb(this: GameState): void {
    const r = this.verbWindow!.result;
    this.verbWindow = null;
    this.verbScene = null;
    this.audio.pauseEffects(false);
    this.cursor.mode = r ? (this.verbMode = r.mode) : 0;
    this.armed = false;
    this.talkArmed = false;
    this.waitRelease = true;
  }
