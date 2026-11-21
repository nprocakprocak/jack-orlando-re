// One frame and one logic tick: the cursor, the scroll edge, a click, and idle.

import { ANIM_PERIOD, enableDrawVerb } from "../cursor";
import {
  areaClick,
  areaReaction,
  interpreterPort,
  macroMouseX,
  ROPE_DESCENT_FIX,
  resolveAreaRef,
  reactionExists,
  resolveClick,
  spriteClickTarget,
  spriteReaction,
  startReaction,
  zoneCursorMode,
  cursorHitRect,
  type Action,
} from "../areas";
import { LOGIC_TICK_MS } from "../core/constants";
import type { TickResult } from "../scene";
import { findWalkTriangle } from "../walk";
import { NO_SCROLL_POINT, edgeFrame, noControlDir } from "./edgescroll";
import { isNoControlScene } from "../map";
import { syncJackVars } from "./host";
import { jackClickAsksCoat } from "./predicates";
import type { PlayInput } from "./types";
import { mouseRequests, onClick } from "./game-click";
import type { GameState } from "./game-state";
import { deathSequence, startFilm, beginMovieFade, startMovie } from "./game-film";
import { slotFrame, io } from "./game-save";
import { menuFrame } from "./game-menu";
import { verbFrame, coatFrame, barFrame, bulletFrame } from "./game-inventory";
import { keyFrame } from "./game-keys";
import { refusalFrame } from "./game-dialog";
import { firstSteps, addLog, enter } from "./game-scene";

/** One 15 ms logic tick (Game_TimerTick + the step blocks of Game_Run). */
export function update(this: GameState): void {
  if (this.phase !== "playing" || !this.scene || !this.interpreter || !this.host) return;
  if (this.miniMap?.isOpen) return this.miniMap.tick(LOGIC_TICK_MS); // g_logicFrozen = 1 while the small map is open
  if (this.menu?.isOpen || this.coat?.isOpen || this.bar?.isOpen || this.verbWindow || this.slotUi || this.modal)
    return; // g_logicFrozen = 1 while a menu / the coat / the verb window is open
  this.ticks++;
  this.scene.idleCount(); // g_idleFrames grows while g_logicFrozen == 0 (Game_Run, before ;)
  this.interpreter.logicTick();
  this.host.tick();
  this.dialog?.tick();
  this.captionTimer();
  this.scene.playerLocked = this.interpreter.playerLocked();
  if (!this.scene.playerLocked) this.jackSaved = this.scene.pose(); // Game_Run: g_jackSaved* while the player is free
  if (!this.jackPlaced && this.scene.jackPlaced) this.jackPlaced = true; // g_jackPlaced: Jack_Stand / STAY / the restored pose
  const scrollBefore = this.scene.scrollX;
  const wasWalking = this.scene.walker.walking;
  const result = this.scene.tick();
  // Game_Run (the walk step): g_jackX/Y change -> JACKX / JACKY (script variables) follow while Jack walks
  if ((wasWalking || this.scene.walker.walking) && this.interpreter)
    syncJackVars(this.interpreter.vars, this.scene.walker);
  this.scrolling = this.scene.scrollX !== scrollBefore; // Game_Tick14ms:
  this.host.viewScrolling = this.scrolling; // SHOWFACE waits for the end of a scroll (Script_ExecStep case 0x17)
  playSounds.call(this, result);
  for (const ev of this.scene.events) this.release(ev);
  if (this.cursorCountdown-- < 1) {
    this.cursorCountdown = ANIM_PERIOD;
    this.cursor.setTargets(this.overReaction, this.overObject);
    this.cursor.animate(this.lastInput.x + this.scene.scrollX);
  }
}

/**
 * The sounds the animators ask for in a tick: Jack's footsteps and insertion effects, the persons' walk and insertion
 * effects. All of them end in Sound_PlayIndexed (SfxPlayer.playIndexed): the footsteps with flag 1.
 */
export function playSounds(this: GameState, r: TickResult): void {
  if (!this.audio.enabled) return;
  const sfx = this.audio.sfx;
  const play = (sound: number | string, channels: number[], volumes: number[], step: boolean) => {
    const index = typeof sound === "number" ? sound : (sfx.sounds?.find(sound) ?? -1);
    channels.forEach((ch, i) => sfx.playIndexed(ch, index, volumes[i], step ? 1 : 0));
  };
  for (const s of r.sounds) play(s.sound, s.channels, s.volumes, s.kind === "step");
  for (const s of r.personSounds) play(s.sound, s.channels, s.volumes, s.kind === "walk");
}

/**
 * The macros hold the player (`Interpreter.playerLocked`, the original) or a death sequence is under way ([engine; approved
 * deviation, ]): the cursor is hidden and clicks / bullet menu / coat are ignored until the death film.
 */
export function playerHeld(this: GameState): boolean {
  return !!this.interpreter && (this.interpreter.playerLocked() || deathSequence.call(this));
}

/** One game frame: cursor, clicks, one command of every active macro, scene changes. */
export function frame(this: GameState, rawInput: PlayInput): void {
  if (this.waitRelease) {
    // after the coat / the verb window the original waits until every button is up: no click reaches the scene before
    if (!rawInput.down && !rawInput.right && !rawInput.middle) this.waitRelease = false;
    else
      rawInput = {
        ...rawInput,
        pressed: false,
        down: false,
        right: false,
        middle: false,
        rightPressed: false,
        middlePressed: false,
      };
  }
  this.lastInput = rawInput;
  if (this.phase !== "playing" || !this.scene || !this.interpreter) return;
  if (this.modal) return;
  if (this.slotUi) return slotFrame.call(this, rawInput);
  if (this.menu?.isOpen) return menuFrame.call(this, rawInput);
  if (this.verbWindow) return verbFrame.call(this, rawInput);
  if (this.coat?.isOpen) return coatFrame.call(this, rawInput);
  if (this.miniMap?.isOpen) return;
  if (this.bar && barFrame.call(this, rawInput)) return;
  idleFrame.call(this, rawInput);
  mouseRequests.call(this, rawInput);
  if (this.autosavePending) {
    // end of the first frame of a scene: a copy of tempjs, always
    this.autosavePending = false;
    io.call(
      this,
      this.opts.save!.autosave().then(() => undefined),
    );
  }
  if (this.notice.shown) {
    if (this.notice.auto) this.notice.tickAuto();
    else this.notice.tickAnim();
  }
  if (keyFrame.call(this)) return;
  const input = dialogFrame.call(this, rawInput);
  if (hotspotFrame.call(this, input) === "verb") return;
  pendingFrame.call(this);
}

/** The answer menu, and a click that ends the line being spoken. The click may be cleared for the rest of the frame. */
function dialogFrame(this: GameState, rawInput: PlayInput): PlayInput {
  const sc = this.scene!;
  let input = rawInput;
  const d = this.dialog;
  answerMenuCursor.call(this, !!d?.menu);
  if (d) {
    d.scrollX = sc.scrollX;
    // a line being spoken ends at the next click; g_clickArmed is cleared when a line starts (Script_ExecStep case 10)
    // and set again once the button is up
    if (d.talking && !this.wasTalking) {
      this.talkArmed = false;
      this.skipLine = false;
    }
    this.wasTalking = d.talking;
    if (!input.down && !input.pressed) this.talkArmed = true;
    if (d.menu) {
      // the answer menu has the mouse: a row is pressed and released ; the scene gets no click
      // rows are hit by the cursor hotspot g_clickX/Y, not the raw mouse
      // Game_Run calls only while g_clickArmed != 0: the click that interrupted the line cleared it and it comes back
      // when the button is up, so a held button does not reach the rows (ReleaseGate)
      const hot = this.cursor.clickPoint(input.x + sc.scrollX, input.y);
      if (d.pointer(hot.x, hot.y, this.menuGate.update(true, input.down)) !== undefined) {
        this.audio.duckMusic(true);
        this.armed = false;
      }
      input = { ...input, pressed: false, down: false };
    } else {
      this.menuGate.update(false, input.down);
      if (d.talking && input.pressed && this.talkArmed && this.settings.talkInterrupt !== 0) {
        // the click stays pending until the face step that reads it (g_clickArmed is a flag of the game)
        this.skipLine = true;
        this.armed = false;
        input = { ...input, pressed: false };
      }
      d.frame(this.skipLine);
      if (!d.talking) this.skipLine = false;
      refusalFrame.call(this);
    }
  }
  return input;
}

/** Hotspot, the bullet menu, and the click. `"verb"` is the verb window: the frame stops there. */
function hotspotFrame(this: GameState, rawInput: PlayInput): "verb" | undefined {
  const sc = this.scene!;
  const it = this.interpreter!;
  let input = rawInput;
  const d = this.dialog;
  this.audio.sfx.tick();
  const world = { x: input.x + sc.scrollX, y: input.y };
  const locked = playerHeld.call(this);
  const cursorEnabled = !locked;
  cursorEnableStep.call(this, locked, !!d?.menu);
  let click = this.cursor.clickPoint(world.x, world.y);
  const port = interpreterPort(it);
  // cursor mode of the exit area under the hotspot
  this.cursor.mode = zoneCursorMode(sc.scene.areas, this.areas, {
    mode: this.cursor.mode,
    verbMode: this.verbMode,
    click,
    suspended: this.bullet.open,
  });
  this.cursor.inWindow = input.inWindow;
  scrollEdge.call(this, input, locked);
  // steps 12-13: the right button opens the bullet menu / the verb window, the icons are chosen by the left one
  if (locked) this.bullet.close();
  const opened = bulletFrame.call(this, input, world, locked);
  if (opened === "verb") return "verb";
  if (opened === "blocked") input = { ...input, pressed: false, down: false };
  click = this.cursor.clickPoint(world.x, world.y);
  // Cursor_UpdateHotspot (Game_Run, before the macros run): the script variables MOUSEX / MOUSEY = the hotspot g_clickX/Y,
  // refreshed every frame (scene coordinates: the mouse + scroll + the per-mode offset), not only at a click
  syncMouseVars.call(this, click);
  // the macro prefix is the item in hand, else the verb
  const action: Action = { verb: this.cursor.verb, item: this.inventory.held?.name ?? null };
  // what is under the hotspot (Cursor_DrawOnPresent: sprites first, then areas)
  // pass 1 of the hit tests (a flagged sprite = an opaque pixel anywhere under the cursor image): the rectangle of the redraw
  const size = this.cursor.imageSize();
  const rect = size ? cursorHitRect(world.x, world.y, size.w, size.h, this.prevCursorRect) : null;
  this.prevCursorRect = size ? { x: world.x - (size.w >> 1), y: world.y - (size.h >> 1), w: size.w, h: size.h } : null;
  const cands = sc.spriteCandidates(click.x, click.y, rect);
  const s = spriteReaction(cands, port, this.cursor.mode, action);
  const a = s.over && s.exists ? null : areaReaction(sc.scene.areas, this.areas, port, click, this.cursor.mode, action);
  this.overReaction = s.exists || !!a?.exists;
  this.overObject = s.over || !!a?.over;
  // the click
  if (!input.down && !input.pressed) this.armed = true;
  else if (input.pressed || this.armed) {
    const r = resolveClick({
      mode: this.cursor.mode,
      armed: this.armed || input.pressed,
      cursorEnabled,
      playerLocked: locked,
      walkAllowed: this.host?.walkAllowed ?? true,
      itemInHand: !!this.inventory.held,
      area: () => areaClick(sc.scene.areas, this.areas, port, click, this.cursor.mode, action),
      sprite: () => {
        // (approved deviation): skip hit sprites without a macro, like the cursor test (Cursor_HitTestSprites)
        const idx = spriteClickTarget(cands, this.cursor.mode, (n) => reactionExists(port, action, n, true));
        // Sprite_ClickMacro: the click on Jack's sprite with an empty hand asks for the coat (also when `<verb>-JACK` runs)
        if (idx >= 0 && jackClickAsksCoat(cands[idx].name, !!action.item, this.jackIsMenu)) this.coatRequest = true;
        return idx < 0 ? null : startReaction(port, action, cands[idx].name, true);
      },
      inWalkArea: () => findWalkTriangle(sc.world.walk, click.x, click.y) >= 0,
    });
    this.armed = r.armed;
    onClick.call(this, r.outcome, click, port);
  }
}

/** One command of every active macro, then a pending film, a movie, or a scene change. */
function pendingFrame(this: GameState): void {
  const it = this.interpreter!;
  it.tick();
  firstSteps.call(this);
  if (this.pendingFilm) startFilm.call(this);
  if (!this.pendingMovie) this.moviePause = null;
  else if (!this.moviePause) this.moviePause = beginMovieFade.call(this);
  if (this.pendingMovie && !this.loadPromise && (this.moviePause?.left ?? 0) <= 0) {
    const m = this.pendingMovie;
    this.pendingMovie = null;
    this.moviePause = null;
    this.phase = "loading";
    this.loadPromise = startMovie
      .call(this, m.film, m.scene)
      .catch(() => undefined)
      .finally(() => {
        this.loadPromise = null;
      });
  } else if (this.pendingScene && !this.loadPromise) {
    const next = this.pendingScene;
    addLog.call(this, `→ GOTOSCENE ${next}${this.fadeRequested ? " (przenikanie)" : ""}`);
    this.phase = "loading";
    this.loadPromise = enter
      .call(this, next)
      .catch(() => undefined)
      .finally(() => {
        this.loadPromise = null;
      });
  }
}

/**
 * Jack's idle reaction, in the frame after the cursor and before the keys and the
 * macros: a held button, a moved mouse (screen x + scroll) or a macro holding the player zeroes `g_idleFrames`, then
 * `ScenePlayer.idleCheck` (the map scenes `g_sceneNoControl` never get one). rand() is the scripts' generator (one stream).
 */
export function idleFrame(this: GameState, input: PlayInput): void {
  const sc = this.scene!;
  const x = input.x + sc.scrollX;
  const moved = this.idleMouse === null || this.idleMouse.x !== x || this.idleMouse.y !== input.y;
  this.idleMouse = { x, y: input.y };
  sc.idleInput(!!input.down || !!input.right || !!input.middle || moved || !!this.interpreter?.playerLocked());
  const c = sc.idleCheck(
    isNoControlScene(this.sceneName),
    () => this.host?.random() ?? 0,
    () => this.vars.get("GUN"),
  );
  if (c?.section || c?.stay) this.addLog(`◦ bezczynność ${c.section ?? `STAY ${c.stay}`}`);
}

/**
 * Scrolling by the mouse at the screen edge (Game_Run and the g_sceneNoControl step; edgescroll.ts).
 * The edge cursor (modes 20 / 21) takes over the mode; a click there starts the scroll and, with SETPOSSCROLL points, a walk.
 */
export function scrollEdge(this: GameState, input: PlayInput, locked: boolean): void {
  const sc = this.scene!;
  if (!sc.scripted) return;
  const d = this.dialog;
  if (isNoControlScene(this.sceneName)) {
    const dir = noControlDir(input.x, !locked);
    if (dir !== null) sc.scrollDir = dir;
    return;
  }
  const pts = this.host?.scrollPoints ?? {
    L: { x: NO_SCROLL_POINT, y: NO_SCROLL_POINT },
    R: { x: NO_SCROLL_POINT, y: NO_SCROLL_POINT },
  };
  const r = edgeFrame(
    { ...this.edge, mode: this.cursor.mode },
    {
      mouseX: input.x,
      scrollX: sc.scrollX,
      scrollMin: sc.scrollMin,
      scrollMax: sc.scrollMax,
      bgWide: sc.bgWide,
      noControl: false,
      menuOrText: !!d && (!!d.menu || !!d.talking),
      scrolling: this.scrolling,
      cursorEnabled: !locked,
      clickArmed: input.down && this.armed,
      jackTurning: sc.turning.turn !== null,
      jackX: sc.walker.x,
      points: pts,
    },
  );
  this.edge = { mode: r.mode, saved: r.saved, prevScrolling: r.prevScrolling };
  this.cursor.mode = r.mode;
  this.answerMenuCursor(!!d?.menu);
  if (r.dir !== null) sc.scrollDir = r.dir;
  if (r.walkTo) sc.walkJackTo(r.walkTo.x, r.walkTo.y);
}

/**
 * Step 21 of Game_Run (l. 1774-1792): a macro holding the player switches the cursor off (not while the answer menu is open);
 * once nothing holds it, `Cursor_EnableDraw` switches it on again - which in mode 0 also puts the verb back to the pointer.
 */
export function cursorEnableStep(this: GameState, locked: boolean, menuOpen: boolean): void {
  if (this.drawEnabled.step(locked, menuOpen)) enableDraw.call(this);
}

/** `Cursor_EnableDraw`: in mode 0 `g_verbMode` = 0 as well (the pointer); any other mode stays as it is. */
export function enableDraw(this: GameState): void {
  // under the answer menu the engine shows the arrow (deviation); the original's mode is the one saved before it
  this.verbMode = enableDrawVerb(this.menuCursorSaved ?? this.cursor.mode, this.verbMode);
}

/**
 * The cursor over the answer menu: the arrow. The original code shows no switch (Cursor_EnableDraw, called when
 * DIALOG opens the menu, only re-selects WSK in mode 0, and Cursor_AnimateStep is idle while g_menuOpen), but the
 * user's observation [original] is the arrow with a hand, a fist or an item taken before the dialog - so while the menu is open
 * the mode is 0 (picture and hotspot), and the mode before it comes back when the menu closes. A deviation, see.
 */
export function answerMenuCursor(this: GameState, open: boolean): void {
  if (open) {
    if (this.menuCursorSaved === null) this.menuCursorSaved = this.cursor.mode;
    this.cursor.mode = 0;
  } else if (this.menuCursorSaved !== null) {
    this.cursor.mode = this.menuCursorSaved;
    this.menuCursorSaved = null;
  }
}

/** MOUSEX / MOUSEY (script variables, `Cursor_UpdateHotspot`): the hotspot g_clickX/Y of the cursor, short. */
export function syncMouseVars(this: GameState, click: { x: number; y: number }): void {
  // (approved deviation, areas/deviations.ts): while POKAZANIE-DOL of SC087 runs without the rope, it must see the ladder side
  const ropeIdx = this.scene
    ? resolveAreaRef(this.scene.scene.areas, ROPE_DESCENT_FIX.area, ROPE_DESCENT_FIX.ropeDup)
    : -1;
  const ropeOn = ropeIdx >= 0 && this.areas.enabled[ropeIdx] !== 0;
  const active = this.interpreter?.isActive(ROPE_DESCENT_FIX.macro) ? ROPE_DESCENT_FIX.macro : "";
  if (this.vars.has("MOUSEX")) this.vars.set("MOUSEX", macroMouseX(this.sceneName, active, click.x, ropeOn));
  if (this.vars.has("MOUSEY")) this.vars.set("MOUSEY", click.y);
}
