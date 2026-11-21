// The "PLEASE WAIT" box of Launcher_Run and the startup sequence around it.
// Logic only; the page feeds it time and draws `surface`.
import { textWidth } from "../formats/fnt";
import { encodeMazovia } from "../dialog/caption";
import { centerOffset, COLOR_OUTLINE_BLACK, COLOR_WHITE } from "../gui/draw";
import { GuiWindow, SCREEN_H, SCREEN_W, type WindowAssets } from "../gui/window";
import { createSurface, type Surface16 } from "../render/surface";
import { LogoSequence } from "./logos";
import { StripeWipe } from "./wipe";

/** Lang_InitLauncherStrings, g_language 'P'; German " BITTE WARTEN ", English " PLEASE WAIT ". */
export const WAIT_TEXT_PL = " PROSZĘ CZEKAĆ ";
/**
 * Launcher_Run does _memset(buffer + 4, 0x5ac8, 0x96000): memset takes one byte, so every byte is 0xc8 and every
 * RGB565 pixel 0xc8c8 (red). The window snapshots it; the work buffer is cleared right after, so only the box is red.
 */
export const WAIT_BACKGROUND = 0xc8c8;
/** local_6 = 0x28 (text margin), local_10 = 0x32 (height), the window sits 0x57 below the centre of a 0x120 band. */
export const WAIT_MARGIN = 0x28;
export const WAIT_H = 0x32;
/** Gui_AddLabel(..., local_6 / 2, local_8 / 2 = 0x1a / 2...): the label is centred horizontally, 13 px from the top. */
export const WAIT_LABEL_Y = 13;

export interface WaitBoxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** width = text width + 0x28 rounded up to even; x centred on 640, y = centred in 0x120 + 0x57. */
export function waitBoxGeometry(textW: number): WaitBoxGeometry {
  let w = textW + WAIT_MARGIN;
  if (w % 2) w++;
  return { x: centerOffset(0x280, w), y: centerOffset(0x120, WAIT_H) + 0x57, w, h: WAIT_H };
}

/** The screen at the start: black (the work buffer is cleared right after the window is made) with the box on it. */
export function buildWaitScreen(assets: WindowAssets, text = WAIT_TEXT_PL): Surface16 {
  const bytes = encodeMazovia(text);
  const g = waitBoxGeometry(textWidth(assets.fontBig, bytes));
  const scene = createSurface(SCREEN_W, SCREEN_H);
  scene.pixels.fill(WAIT_BACKGROUND);
  const win = new GuiWindow(assets, scene, g.x, g.y, g.w, g.h, false);
  win.addLabel(text, true, 0, WAIT_LABEL_Y, COLOR_OUTLINE_BLACK, COLOR_WHITE);
  const screen = createSurface(SCREEN_W, SCREEN_H);
  win.draw(screen);
  return screen;
}

/** Shortest time the box is shown. [engine, not from the exe: the original shows it while INTRO.AVX opens] */
export const WAIT_MIN_MS = 600;

export type LaunchPhase = "wait" | "wipe" | "logos" | "abort" | "done";

/**
 * Box -> stripe blackout -> three logos. Escape during the logos starts the same blackout over the frame on screen
 * (Media_Step state 5 calls before the logos; Launcher_PlayIntro after the film).
 * `logos` is null when they could not be loaded: the sequence then ends after the first blackout.
 */
export class LaunchSequence {
  phase: LaunchPhase = "wait";
  surface: Surface16;
  private clock = 0;
  private wipe: StripeWipe | null = null;
  private seq: LogoSequence | null = null;
  private loaded = false;

  constructor(waitScreen: Surface16) {
    this.surface = { ...waitScreen, pixels: waitScreen.pixels.slice() };
  }

  /** The logos finished loading (`null` = failed). */
  setLogos(logos: Uint16Array[] | null): void {
    this.seq = logos ? new LogoSequence(logos) : null;
    this.loaded = true;
  }

  get done(): boolean {
    return this.phase === "done";
  }

  /** Escape: only meaningful while the logos run. */
  skip(): void {
    if (this.phase === "logos") this.startWipe("abort");
  }

  private startWipe(phase: "wipe" | "abort"): void {
    this.phase = phase;
    this.surface = { ...this.surface, pixels: this.surface.pixels.slice() };
    this.wipe = new StripeWipe(this.surface);
  }

  advance(dtMs: number): void {
    if (this.phase === "wait") {
      this.clock += Math.max(0, dtMs);
      if (this.loaded && this.clock >= WAIT_MIN_MS) this.startWipe("wipe");
      return;
    }
    if (this.phase === "wipe" || this.phase === "abort") {
      this.wipe!.advance(dtMs);
      if (!this.wipe!.done) return;
      if (this.phase === "wipe" && this.seq) {
        this.phase = "logos";
        this.surface = this.seq.surface;
        this.seq.advance(0);
      } else this.phase = "done";
      return;
    }
    if (this.phase === "logos") {
      this.seq!.advance(dtMs);
      if (this.seq!.done) this.phase = "done";
    }
  }
}
