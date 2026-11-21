import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import { StripeWipe, WIPE_TOTAL_MS } from "../launcher/wipe";
import { blitCopy, blitKeyed, createSurface, type Surface16 } from "../render/surface";
import { SMOKE_X, SMOKE_Y, type MenuSmoke } from "./smoke";
import type { MainMenuTexts } from "./texts";
import {
  fadeInSteps,
  fadeOutSteps,
  INTERLACE_TOTAL_MS,
  interlaceRows,
  interlaceRowsAt,
  MUSIC_STEP_MS,
  REVEAL_TOTAL_MS,
  revealPixels,
  revealPixelsAt,
  TICK_MS,
} from "./timing";
import { MenuWindow, type ButtonName } from "./window";
import {
  LOADING_X,
  LOADING_Y,
  MENU_MUSIC,
  SMOKE_FIRST_DELAY,
  type MainMenuAssets,
  type MainMenuEvent,
  type MainMenuPhase,
  type MainMenuResult,
  type MusicCommand,
} from "./menu";

/** Fields and steps the moved menu methods read. The class keeps them and casts `this`. */
export interface MenuFields {
  phase: MainMenuPhase;
  result: MainMenuResult | null;
  chosen: ButtonName | null;
  readonly screen: Surface16;
  readonly smoke: MenuSmoke;
  readonly assets: MainMenuAssets;
  texts: MainMenuTexts;
  sound: boolean;
  volume: number;
  presentMs: number;
  onEvent?: (e: MainMenuEvent) => void;
  t: number;
  phaseT0: number;
  nextTick: number;
  nextPresent: number;
  done: number;
  wipe: StripeWipe | null;
  still: Surface16;
  window: MenuWindow | null;
  blendStep: number;
  closeFrom: Surface16 | null;
  buttonsShown: boolean;
  pressed: number;
  pressedOver: boolean;
  enterHeld: boolean;
  hook: boolean;
  active: boolean;
  smokeDelay: number;
  smokeShown: boolean;
  truckTicks: number;
  truckShifted: boolean;
  arrowTicks: number;
  discTicks: number;
  arrowFrame: number;
  lastMouseX: number;
  discFrame: number;
  waitCursor: boolean;
  discImage: boolean;
  loadingSprite: boolean;
  mouseX: number;
  mouseY: number;
  mouseInside: boolean;
  level: number;
  readonly pressedButton: number;
  emit(e: MainMenuEvent): void;
  music(command: MusicCommand): void;
  enter(phase: MainMenuPhase): void;
  phaseLength(): number;
  progress(): void;
  finishPhase(): void;
  resetAfterIntro(): void;
  openWindow(): void;
  choose(name: ButtonName | null): void;
  leave(): void;
  finish(result: MainMenuResult): void;
  tick(): void;
  present(): void;
  cursorImage(): Surface16 | null;
  pointerMove(x: number, y: number): void;
}

export function copyScreen(s?: Surface16): Surface16 {
  const out = createSurface(SCREEN_WIDTH, SCREEN_HEIGHT);
  if (s) blitCopy(s, 0, 0, Math.min(SCREEN_WIDTH, s.width), Math.min(SCREEN_HEIGHT, s.height), out, 0, 0);
  return out;
}

const RESULT_OF: Record<ButtonName, MainMenuResult> = {
  Intro: "intro",
  Start: "newGame",
  Load: "load",
  Quit: "quit",
};

export function emit(this: MenuFields, e: MainMenuEvent): void {
  this.onEvent?.(e);
}

export function music(this: MenuFields, command: MusicCommand): void {
  if (this.sound) this.emit({ kind: "music", command });
}

export function enter(this: MenuFields, phase: MainMenuPhase): void {
  this.phase = phase;
  this.phaseT0 = this.t;
  this.done = 0;
  if (phase === "musicIn") {
    // (0) stops channel 5, Music_StartStream, volume 0
    this.music({ op: "stop" });
    this.music({ op: "start", file: MENU_MUSIC });
  }
}

export function phaseLength(this: MenuFields): number {
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
export function advance(this: MenuFields, dtMs: number): void {
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
export function progress(this: MenuFields): void {
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

export function finishPhase(this: MenuFields): void {
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
export function resetAfterIntro(this: MenuFields): void {
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
export function openWindow(this: MenuFields): void {
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
export function choose(this: MenuFields, name: ButtonName | null): void {
  this.chosen = name;
  this.pressed = -1;
  this.pressedOver = false;
  this.enterHeld = false;
  this.active = false;
  this.closeFrom = this.window!.snapshot();
  this.blendStep = 0;
  this.enter("close");
}

export function leave(this: MenuFields): void {
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
  if (result === "quit")
    this.nextTick = Infinity; // Timer_Stop(1)
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

export function finish(this: MenuFields, result: MainMenuResult): void {
  this.result = result;
  this.emit({ kind: "result", result });
}

/**
 * After the intro movie (plays it): Launcher_PlayIntro blackens the last frame with stripes, restarts the
 * music and the smoke, reveals the background and the menu window opens again.
 */
export function returnFromIntro(this: MenuFields, lastFrame?: Surface16): void {
  if (this.phase !== "intro") throw new Error(`returnFromIntro in phase ${this.phase}`);
  this.result = null;
  this.chosen = null;
  this.still = copyScreen(lastFrame);
  this.wipe = new StripeWipe(this.still);
  this.enter("wipe");
}
