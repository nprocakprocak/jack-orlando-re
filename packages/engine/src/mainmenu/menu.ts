// The main menu (Launcher_Run) as a time-driven state machine without DOM or Web Audio.
// Two clocks drive it like the original: the 17 ms launcher timer (Launcher_TimerTick) and the screen
// presents (Video_PresentIfDue -> the hook).
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import type { Font } from "../formats/fnt";
import { StripeWipe, WIPE_TOTAL_MS } from "../launcher/wipe";
import type { Surface16 } from "../render/surface";
import { blitCopy, blitKeyed, createSurface } from "../render/surface";
import { MenuSmoke, SMOKE_X, SMOKE_Y } from "./smoke";
import { MAIN_MENU_TEXTS_PL, type MainMenuTexts } from "./texts";
import {
  DEFAULT_MUSIC_VOLUME, fadeInSteps, fadeOutSteps, INTERLACE_TOTAL_MS, interlaceRows, interlaceRowsAt, MUSIC_STEP_MS,
  PRESENT_MS, REVEAL_TOTAL_MS, revealPixels, revealPixelsAt, TICK_MS,
} from "./timing";
import { BLEND_MAX, BLEND_STEP, BLEND_STEPS, BUTTON_NAMES, MenuWindow, type ButtonName } from "./window";

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

function copyScreen(s?: Surface16): Surface16 {
  const out = createSurface(SCREEN_WIDTH, SCREEN_HEIGHT);
  if (s) blitCopy(s, 0, 0, Math.min(SCREEN_WIDTH, s.width), Math.min(SCREEN_HEIGHT, s.height), out, 0, 0);
  return out;
}

const RESULT_OF: Record<ButtonName, MainMenuResult> = { Intro: "intro", Start: "newGame", Load: "load", Quit: "quit" };

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

  constructor(readonly assets: MainMenuAssets, options: MainMenuOptions = {}) {
    this.texts = options.texts ?? MAIN_MENU_TEXTS_PL;
    this.sound = options.sound ?? true;
    this.volume = options.musicVolume ?? DEFAULT_MUSIC_VOLUME;
    this.presentMs = options.presentMs ?? PRESENT_MS;
    this.onEvent = options.onEvent;
    this.nextPresent = this.presentMs;
    this.smoke = new MenuSmoke(assets.smoke);
    this.screen = createSurface(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.still = copyScreen(options.previous);
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
    this.onEvent?.(e);
  }

  private music(command: MusicCommand): void {
    if (this.sound) this.emit({ kind: "music", command });
  }

  private enter(phase: MainMenuPhase): void {
    this.phase = phase;
    this.phaseT0 = this.t;
    this.done = 0;
    if (phase === "musicIn") {
      // (0) stops channel 5, Music_StartStream, volume 0
      this.music({ op: "stop" });
      this.music({ op: "start", file: MENU_MUSIC });
    }
  }

  private phaseLength(): number {
    switch (this.phase) {
      case "blackout":
      case "quitting":
        return INTERLACE_TOTAL_MS;
      case "wipe":
        return WIPE_TOTAL_MS;
      case "musicIn":
        return this.sound ? fadeInSteps(this.volume) * MUSIC_STEP_MS : 0;
      case "reveal":
        return REVEAL_TOTAL_MS;
      case "musicOut":
        return this.sound ? fadeOutSteps(this.volume) * MUSIC_STEP_MS : 0;
      default:
        return Infinity;
    }
  }

  /** Runs the menu for `dtMs` of game time. */
  advance(dtMs: number): void {
    const end = this.t + Math.max(0, dtMs);
    for (let guard = 0; guard < 100000; guard++) {
      const phaseEnd = this.phaseT0 + this.phaseLength();
      const next = Math.min(phaseEnd, this.nextTick, this.nextPresent);
      if (next > end) break;
      this.t = next;
      this.progress();
      if (next === phaseEnd) this.finishPhase();
      else if (next === this.nextTick) {
        this.nextTick += TICK_MS;
        this.tick();
      } else {
        this.nextPresent += this.presentMs;
        this.present();
      }
    }
    this.t = end;
    this.progress();
  }

  /** Blocking effects driven by time within the phase. */
  private progress(): void {
    const ms = this.t - this.phaseT0;
    switch (this.phase) {
      case "blackout":
      case "quitting": {
        const rows = interlaceRowsAt(ms);
        interlaceRows(this.still, this.done, rows);
        this.done = rows;
        break;
      }
      case "wipe":
        this.wipe!.advance(ms - this.wipe!.elapsedMs);
        break;
      case "reveal": {
        const px = revealPixelsAt(ms);
        revealPixels(this.still, this.assets.background, this.done, px);
        this.done = px;
        break;
      }
      case "musicIn": {
        if (!this.sound) break;
        // volume 0, 1... vol - 1, one per 15 ms step
        const steps = Math.min(fadeInSteps(this.volume), Math.floor(ms / MUSIC_STEP_MS) + 1);
        for (; this.done < steps; this.done++) this.music({ op: "volume", value: this.done });
        break;
      }
      case "musicOut": {
        if (!this.sound) break;
        const n = fadeOutSteps(this.volume);
        const steps = Math.min(n, Math.floor(ms / MUSIC_STEP_MS) + 1);
        for (; this.done < steps; this.done++) this.music({ op: "volume", value: this.volume - 2 * this.done });
        break;
      }
    }
  }

  private finishPhase(): void {
    switch (this.phase) {
      case "blackout":
        // Timer_Start(1, 17 ms) — then the branch for g_cfgPlayIntro == 0: Menu_FlxStep (sprite not shown yet)
        this.nextTick = this.t + TICK_MS;
        this.smoke.step();
        this.enter("musicIn");
        break;
      case "wipe":
        this.resetAfterIntro();
        this.enter("musicIn");
        break;
      case "musicIn":
        this.music({ op: "volume", value: this.volume });
        this.enter("reveal");
        break;
      case "reveal":
        this.openWindow();
        break;
      case "musicOut":
        this.music({ op: "stop" });
        this.leave();
        break;
      case "quitting":
        this.enter("done");
        this.still.pixels.fill(0);
        this.finish("quit");
        break;
    }
  }

  /** Launcher_PlayIntro after Media_Close: variables back to the start values, Menu_FlxStep. */
  private resetAfterIntro(): void {
    this.smokeDelay = SMOKE_FIRST_DELAY;
    this.truckTicks = 0;
    this.arrowFrame = 0;
    this.lastMouseX = 0;
    this.discFrame = 0;
    this.arrowTicks = 0;
    this.discTicks = 0;
    this.waitCursor = false;
    this.discImage = false;
    this.smoke.restart();
    this.smoke.step();
  }

  /** The loop of Launcher_Run: Gui_CreateWindow + buttons, then the open blend. */
  private openWindow(): void {
    this.loadingSprite = false;
    this.hook = true;
    this.window = new MenuWindow(this.assets.font, this.assets.background, this.texts);
    this.blendStep = 0;
    this.level = 0;
    this.buttonsShown = false;
    this.closeFrom = null;
    this.enter("open");
  }

  /** Gui_RunWindow returned: name (or Esc). */
  private choose(name: ButtonName | null): void {
    this.chosen = name;
    this.pressed = -1;
    this.pressedOver = false;
    this.enterHeld = false;
    this.active = false;
    this.closeFrom = this.window!.snapshot();
    this.blendStep = 0;
    this.enter("close");
  }

  private leave(): void {
    const result: MainMenuResult = this.chosen ? RESULT_OF[this.chosen] : "quit";
    if (result === "intro") {
      // Sprite_Set(LADEN, 0xd7, 200), Launcher_PlayIntro: = 1 (disc cursor)
      this.loadingSprite = true;
      this.waitCursor = true;
      this.discImage = true; // [engine, user decision] the disc at once (the original switches on the next 2nd tick)
      this.enter("intro");
      this.finish("intro");
      return;
    }
    // Sprite_Remove (cursor, truck, smoke), Blit_KeyedToScreen of the smoke picture, then LADEN for Start/Load
    this.hook = false;
    if (result === "quit") this.nextTick = Infinity; // Timer_Stop(1)
    else {
      // [engine, not original; user decision 2026-11-06] the original stops the timer and removes the cursor; the engine
      // keeps the 17 ms clock for a spinning disc cursor while "Loading" is shown
      this.waitCursor = true;
      this.discImage = true;
    }
    const s = copyScreen(this.assets.background);
    blitKeyed(this.smoke.surface, 0, 0, this.smoke.surface.width, this.smoke.surface.height, s, SMOKE_X, SMOKE_Y);
    if (result !== "quit") {
      const l = this.assets.loading;
      blitCopy(l, 0, 0, l.width, l.height, s, LOADING_X, LOADING_Y);
      this.still = s;
      this.enter("loading");
      this.finish(result);
    } else {
      this.still = s;
      this.enter("quitting");
    }
  }

  private finish(result: MainMenuResult): void {
    this.result = result;
    this.emit({ kind: "result", result });
  }

  /**
 * After the intro movie (plays it): Launcher_PlayIntro blackens the last frame with stripes, restarts the
 * music and the smoke, reveals the background and the menu window opens again.
 */
  returnFromIntro(lastFrame?: Surface16): void {
    if (this.phase !== "intro") throw new Error(`returnFromIntro in phase ${this.phase}`);
    this.result = null;
    this.chosen = null;
    this.still = copyScreen(lastFrame);
    this.wipe = new StripeWipe(this.still);
    this.enter("wipe");
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
    this.pointerMove(x, y);
    if (this.phase !== "menu" || this.enterHeld) return;
    const i = this.window!.hit(this.mouseX, this.mouseY);
    if (i < 0) return;
    this.pressed = i;
    this.pressedOver = true;
  }

  /** Released over the pressed button -> its name; elsewhere the press is cancelled. */
  pointerUp(x: number, y: number): void {
    this.pointerMove(x, y);
    if (this.phase !== "menu" || this.pressed < 0 || this.enterHeld) return;
    const i = this.pressed;
    this.pressed = -1;
    this.pressedOver = false;
    if (this.window!.hit(this.mouseX, this.mouseY) === i) this.choose(BUTTON_NAMES[i]);
  }

  /** Enter = button 1 ("Introduction"), sunken until released; Esc = "/0" -> quit. KeyboardEvent.key names. */
  keyDown(key: string): void {
    if (this.phase !== "menu") return;
    if (key === "Escape") this.choose(null);
    else if (key === "Enter" && !this.enterHeld) {
      this.enterHeld = true;
      this.pressed = 0;
      this.pressedOver = true;
    }
  }

  keyUp(key: string): void {
    if (this.phase !== "menu" || key !== "Enter" || !this.enterHeld) return;
    this.choose(BUTTON_NAMES[0]);
  }

  // --- picture ---

  private cursorImage(): Surface16 | null {
    if (!this.mouseInside || !this.hook) return null;
    return this.discImage ? this.assets.discs[this.discFrame] : this.assets.arrows[this.arrowFrame];
  }

  /** Composes the current picture into `screen` and returns it. */
  frame(): Surface16 {
    const s = this.screen;
    switch (this.phase) {
      case "blackout":
      case "wipe":
      case "musicIn":
      case "reveal":
      case "quitting":
      case "done":
        s.pixels.set(this.still.pixels);
        return s;
      case "loading": {
        s.pixels.set(this.still.pixels);
        // [engine, user decision] the disc cursor over "Loading" (the original removed the cursor sprite)
        const d = this.assets.discs[this.discFrame];
        if (this.mouseInside) blitKeyed(d, 0, 0, d.width, d.height, s, this.mouseX, this.mouseY);
        return s;
      }
    }
    const a = this.assets;
    s.pixels.set(a.background.pixels);
    // z order: LADEN 18, window 1050 and its buttons, truck 1750, smoke 1800, cursor 1950
    if (this.loadingSprite) blitKeyed(a.loading, 0, 0, a.loading.width, a.loading.height, s, LOADING_X, LOADING_Y);
    if (this.window) {
      this.window.drawBody(s);
      if (this.buttonsShown) this.window.drawButtons(s, this.pressedButton);
    }
    if (this.hook && this.truckShifted) blitKeyed(a.truck, 0, 0, a.truck.width, a.truck.height, s, TRUCK_X, TRUCK_Y);
    if (this.smokeShown) {
      const f = this.smoke.surface;
      blitKeyed(f, 0, 0, f.width, f.height, s, SMOKE_X, SMOKE_Y);
    }
    const c = this.cursorImage();
    if (c) blitKeyed(c, 0, 0, c.width, c.height, s, this.mouseX, this.mouseY);
    return s;
  }
}
