// The main menu (Launcher_Run) as a time-driven state machine without DOM or Web Audio.
// Two clocks drive it like the original: the 17 ms launcher timer (Launcher_TimerTick) and the screen
// presents (Video_PresentIfDue -> the hook).
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import type { Font } from "../formats/fnt";
import type { StripeWipe } from "../launcher/wipe";
import { createSurface, type Surface16 } from "../render/surface";
import { MenuSmoke } from "./smoke";
import { MAIN_MENU_TEXTS_PL, type MainMenuTexts } from "./texts";
import { DEFAULT_MUSIC_VOLUME, PRESENT_MS } from "./timing";
import * as inputBody from "./menu-input";
import { BLEND_MAX, BLEND_STEP, BLEND_STEPS, type ButtonName, type MenuWindow } from "./window";
import * as frameBody from "./menu-frame";
import * as stateBody from "./menu-state";
import type { MenuFields } from "./menu-state";

export { SCREEN_HEIGHT as SCREEN_H, SCREEN_WIDTH as SCREEN_W };
/**
 * Sprite_Set(truck, 0, 0x143): _SAMOCH1.BM, the background's truck redrawn a few pixels off (cab ~2-3 px higher);
 * shown and hidden in turn it makes the truck shake like a running engine.
 */
export const TRUCK_X = 0;
export const TRUCK_Y = 0x143;
/** Sprite_Set / Blit_ImageToScreen(0xd7, 200, LADEN.BM). */
export const LOADING_X = 0xd7;
export const LOADING_Y = 200;
/** The engine keeps "Loading" on screen at least this long [engine, user's requirement; 200 ms, 1000 ms by the user's decision 2026-11-07]. */
export const LOADING_MIN_MS = 1000;
/** Music of the menu. "TRACK-02.PMS" is only a label and is unused. */
export const MENU_MUSIC = "TR02-22.PMS";
/** Initial: ticks before the first smoke step once the menu is active. */
export const SMOKE_FIRST_DELAY = 10;
/** `= 3` after each smoke step. */
export const SMOKE_DELAY = 3;
/** Truck: the shifted sprite from the 6th tick, the background's truck again on the 12th. */
export const TRUCK_SHIFT_TICK = 6;
export const TRUCK_PERIOD_TICKS = 12;
/** Arrow cursor frame update every 7th tick, disc every 2nd. */
export const ARROW_TICKS = 7;
export const DISC_TICKS = 2;
export const ARROW_FRAMES = 9;
export const DISC_FRAMES = 40;

export interface MainMenuAssets {
  /** JACK2.BM, 640 x 480 */
  background: Surface16;
  /** _SAMOCH1.BM */
  truck: Surface16;
  /** D1.FLX bytes */
  smoke: Uint8Array;
  /** WSK00..WSK08.BM (MENU.PAK: an arrow, tip at the top-left corner) */
  arrows: Surface16[];
  /** CD00..CD39.BM (spinning disc, the wait cursor) */
  discs: Surface16[];
  /** LADEN.BM ("Loading") */
  loading: Surface16;
  /** the big GUI font (JACK from the exe) */
  font: Font;
}

export type MainMenuResult = "intro" | "newGame" | "load" | "quit";

export type MusicCommand = { op: "stop" } | { op: "start"; file: string } | { op: "volume"; value: number };

export type MainMenuEvent = { kind: "result"; result: MainMenuResult } | { kind: "music"; command: MusicCommand };

export type MainMenuPhase =
  /** the previous screen blackened two rows at a time (455 ms) */
  | "blackout"
  /** Launcher_PlayIntro after the movie: stripe blackout of the last frame (855 ms) */
  | "wipe"
  /** music starts, fade-in blocks (volume x 15 ms) */
  | "musicIn"
  /** the background appears stripe by stripe (480 ms) */
  | "reveal"
  /** the window blends in over 11 presents */
  | "open"
  /** Gui_RunWindow: waits for a button */
  | "menu"
  /** the window blends out over 11 presents */
  | "close"
  /** (2): fade-out blocks (15 ms a step), then the music stops */
  | "musicOut"
  /** result "intro": the menu screen with "Loading" and the disc cursor until returnFromIntro() */
  | "intro"
  /** result newGame / load: background, smoke frame, "Loading" */
  | "loading"
  /** Launcher_CloseAnim (455 ms), then the result "quit" */
  | "quitting"
  | "done";

export interface MainMenuOptions {
  texts?: MainMenuTexts;
  /** Launcher_Run's first argument (sound on): without it no music and no fade waits */
  sound?: boolean;
  /** g_optMusicVol (0..64) */
  musicVolume?: number;
  /** the screen when the menu starts (it is blackened first); black if omitted */
  previous?: Surface16;
  presentMs?: number;
  onEvent?: (e: MainMenuEvent) => void;
}

export class MainMenu {
  phase: MainMenuPhase = "blackout";
  result: MainMenuResult | null = null;
  /** the button that ended the menu; null for Esc (Gui_RunWindow "/0" -> quit) */
  chosen: ButtonName | null = null;
  /** the picture to show; refreshed by frame() */
  readonly screen: Surface16;
  readonly smoke: MenuSmoke;

  private readonly texts: MainMenuTexts;
  private readonly sound: boolean;
  private readonly volume: number;
  private readonly presentMs: number;
  private readonly onEvent?: (e: MainMenuEvent) => void;

  /** ms since the start */
  private t = 0;
  private phaseT0 = 0;
  private nextTick = Infinity;
  private nextPresent: number;
  /** progress of the blocking effect of the phase (rows, pixels, fade steps) */
  private done = 0;
  private wipe: StripeWipe | null = null;
  /** the screen in the effect phases (blackout, wipe, musicIn, reveal) and the static loading/quit screens */
  private still: Surface16;

  private window: MenuWindow | null = null;
  private blendStep = 0;
  private closeFrom: Surface16 | null = null;
  private buttonsShown = false;
  private pressed = -1;
  private pressedOver = false;
  private enterHeld = false;

  // --- the launcher's globals ---
  /** g_onPresent == */
  private hook = false;
  /** the menu runs (smoke and truck animate) */
  private active = false;
  /** */
  private smokeDelay = SMOKE_FIRST_DELAY;
  /** the smoke sprite was Sprite_Set (Menu_FlxStep with == 1) */
  smokeShown = false;
  /** / */
  private truckTicks = 0;
  truckShifted = false;
  /**, */
  private arrowTicks = 0;
  private discTicks = 0;
  /** arrow frame 0..8, last mouse x, disc frame */
  arrowFrame = 0;
  private lastMouseX = 0;
  discFrame = 0;
  /** wait mode (the disc instead of the arrow) */
  waitCursor = false;
  /** the cursor shows the disc (pointer set by the tick in wait mode) */
  private discImage = false;
  /** LADEN sprite (z 18) on the menu screen while the intro loads */
  private loadingSprite = false;
  private mouseX = 0;
  private mouseY = 0;
  private mouseInside = false;

  constructor(
    readonly assets: MainMenuAssets,
    options: MainMenuOptions = {},
  ) {
    this.texts = options.texts ?? MAIN_MENU_TEXTS_PL;
    this.sound = options.sound ?? true;
    this.volume = options.musicVolume ?? DEFAULT_MUSIC_VOLUME;
    this.presentMs = options.presentMs ?? PRESENT_MS;
    this.onEvent = options.onEvent;
    this.nextPresent = this.presentMs;
    this.smoke = new MenuSmoke(assets.smoke);
    this.screen = createSurface(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.still = stateBody.copyScreen(options.previous);
    this.retain();
  }

  /** The moved steps read these. A reference keeps the private names in use. */
  private retain(): void {
    void [
      this.texts,
      this.sound,
      this.volume,
      this.onEvent,
      this.nextTick,
      this.nextPresent,
      this.done,
      this.wipe,
      this.still,
      this.discImage,
      this.loadingSprite,
      this.mouseInside,
      this.emit,
      this.music,
      this.phaseLength,
      this.progress,
      this.finishPhase,
      this.resetAfterIntro,
      this.openWindow,
      this.leave,
      this.finish,
      this.tick,
      this.present,
      this.cursorImage,
    ];
  }

  get elapsedMs(): number {
    return this.t;
  }

  /** How long "Loading" has been shown (phases "loading" and "intro"), 0 otherwise. */
  get loadingMs(): number {
    return this.phase === "loading" || this.phase === "intro" ? this.t - this.phaseT0 : 0;
  }

  /**
   * "Loading" has been visible long enough [engine, >= LOADING_MIN_MS = 1000 ms]: newGame / load -> switch to the game once it is loaded
   * too; intro -> start the movie.
   */
  get readyToLeave(): boolean {
    return (this.phase === "loading" || this.phase === "intro") && this.loadingMs >= LOADING_MIN_MS;
  }

  /** Opacity of the window during open/close (0..30 of 32), -1 without a window. */
  get windowLevel(): number {
    return this.window ? this.level : -1;
  }
  private level = 0;

  get buttonsVisible(): boolean {
    return this.buttonsShown;
  }

  /** Index of the drawn-sunken button, -1 = none. */
  get pressedButton(): number {
    return this.pressed >= 0 && this.pressedOver ? this.pressed : -1;
  }

  private emit(e: MainMenuEvent): void {
    stateBody.emit.call(this as unknown as MenuFields, e);
  }

  private music(command: MusicCommand): void {
    stateBody.music.call(this as unknown as MenuFields, command);
  }

  private enter(phase: MainMenuPhase): void {
    stateBody.enter.call(this as unknown as MenuFields, phase);
  }

  private phaseLength(): number {
    return stateBody.phaseLength.call(this as unknown as MenuFields);
  }

  advance(dtMs: number): void {
    stateBody.advance.call(this as unknown as MenuFields, dtMs);
  }

  private progress(): void {
    stateBody.progress.call(this as unknown as MenuFields);
  }

  private finishPhase(): void {
    stateBody.finishPhase.call(this as unknown as MenuFields);
  }

  private resetAfterIntro(): void {
    stateBody.resetAfterIntro.call(this as unknown as MenuFields);
  }

  private openWindow(): void {
    stateBody.openWindow.call(this as unknown as MenuFields);
  }

  choose(name: ButtonName | null): void {
    stateBody.choose.call(this as unknown as MenuFields, name);
  }

  private leave(): void {
    stateBody.leave.call(this as unknown as MenuFields);
  }

  private finish(result: MainMenuResult): void {
    stateBody.finish.call(this as unknown as MenuFields, result);
  }

  returnFromIntro(lastFrame?: Surface16): void {
    stateBody.returnFromIntro.call(this as unknown as MenuFields, lastFrame);
  }

  /** Launcher_TimerTick. */
  private tick(): void {
    if (this.active) {
      this.truckTicks++;
      if (this.smokeDelay !== 0) this.smokeDelay--;
      if (this.truckTicks === TRUCK_SHIFT_TICK) this.truckShifted = true;
      if (this.truckTicks === TRUCK_PERIOD_TICKS) {
        this.truckShifted = false;
        this.truckTicks = 0;
      }
    }
    this.arrowTicks++;
    this.discTicks++;
    if (this.arrowTicks === ARROW_TICKS && !this.waitCursor) {
      const x = this.mouseX;
      if (this.lastMouseX < x && this.arrowFrame < ARROW_FRAMES - 1) this.arrowFrame++;
      if (x < this.lastMouseX && this.arrowFrame !== 0) this.arrowFrame--;
      if (x === this.lastMouseX) {
        if (this.arrowFrame > 4) this.arrowFrame--;
        if (this.arrowFrame < 4) this.arrowFrame++;
      }
      this.lastMouseX = x;
      this.discImage = false;
    }
    if (this.arrowTicks === ARROW_TICKS) this.arrowTicks = 0;
    if (this.discTicks === DISC_TICKS && this.waitCursor) {
      this.discFrame = (this.discFrame + 1) % DISC_FRAMES;
      this.discImage = true;
    }
    if (this.discTicks === DISC_TICKS) this.discTicks = 0;
  }

  /** A screen present: the hook and the open/close loops waiting for it. */
  private present(): void {
    if (this.hook) {
      if (this.active && this.smokeDelay === 0) {
        this.smokeDelay = SMOKE_DELAY;
        this.smoke.advance();
        this.smokeShown = true;
      }
    }
    if (this.phase === "open") {
      this.level = this.blendStep * BLEND_STEP;
      this.window!.showLevel(this.level);
      if (++this.blendStep === BLEND_STEPS) {
        this.active = true;
        this.buttonsShown = true;
        this.enter("menu");
      }
    } else if (this.phase === "close") {
      this.level = BLEND_MAX - this.blendStep * BLEND_STEP;
      this.window!.showLevel(this.level, this.closeFrom!);
      if (++this.blendStep === BLEND_STEPS) {
        // Gui_CloseWindow, then (2)
        this.window = null;
        this.buttonsShown = false;
        this.enter("musicOut");
      }
    }
  }

  // --- input (screen pixels 640 x 480) ---

  pointerMove(x: number, y: number): void {
    this.mouseX = Math.trunc(x);
    this.mouseY = Math.trunc(y);
    this.mouseInside = true;
    if (this.phase === "menu" && this.pressed >= 0 && !this.enterHeld) {
      this.pressedOver = this.window!.hit(this.mouseX, this.mouseY) === this.pressed;
    }
  }

  /** g_mouseInWindow = 0: the cursor sprite is removed. */
  pointerLeave(): void {
    this.mouseInside = false;
  }

  pointerDown(x: number, y: number): void {
    return inputBody.pointerDown.call(this as unknown as MenuFields, x, y);
  }

  /** Released over the pressed button -> its name; elsewhere the press is cancelled. */
  pointerUp(x: number, y: number): void {
    return inputBody.pointerUp.call(this as unknown as MenuFields, x, y);
  }

  /** Enter = button 1 ("Introduction"), sunken until released; Esc = "/0" -> quit. KeyboardEvent.key names. */
  keyDown(key: string): void {
    return inputBody.keyDown.call(this as unknown as MenuFields, key);
  }

  keyUp(key: string): void {
    return inputBody.keyUp.call(this as unknown as MenuFields, key);
  }

  private cursorImage(): Surface16 | null {
    return frameBody.cursorImage.call(this as unknown as MenuFields);
  }

  frame(): Surface16 {
    return frameBody.frame.call(this as unknown as MenuFields);
  }
}
