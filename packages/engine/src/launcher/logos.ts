// Studio logos shown before the first intro: Media_Step state 5.
// Logic only (no DOM): LogoSequence turns elapsed time into the RGB565 frame the original had on screen.
import { decodeBm } from "../formats/bm";
import { Pak } from "../formats/pak";
import { mixStep } from "../render/transition";
import { createSurface, type Surface16 } from "../render/surface";

export const LOGO_W = 640;
export const LOGO_H = 480;
/** Order in Media_Step case 5; all three are 640x480 RGB565 .BM files in MENU.PAK. */
export const LOGO_FILES = ["LOGOTT.BM", "LOGO.BM", "LOGOJW.BM"] as const;
/** `local_c < 0x20` in every loop of Media_Step case 5. */
export const LOGO_STEPS = 32;
/** The game timer (Timer_Start(1...), g_ticks5ms) ticks every 5 ms. */
export const TICK_MS = 5;
/** Timer_WaitSinceFrameStart(0x32): returns when more than 50 / 5 ticks passed -> 11 ticks per fade-in step. */
export const FADE_IN_TICKS = 11;
/** Timer_WaitSinceFrameStart(0x1e): more than 30 / 5 ticks -> 7 ticks per fade-out step. */
export const FADE_OUT_TICKS = 7;
/** Timer_Sleep(500): returns when g_ticks5ms exceeds start + 100 -> 101 ticks. */
export const HOLD_TICKS = 101;

export const LOGO_TICKS = LOGO_STEPS * FADE_IN_TICKS + HOLD_TICKS + LOGO_STEPS * FADE_OUT_TICKS;
export const TOTAL_TICKS = LOGO_FILES.length * LOGO_TICKS;
export const TOTAL_MS = TOTAL_TICKS * TICK_MS;

export type LogoPhase = "in" | "hold" | "out" | "done";

export interface LogoPosition {
  logo: number;
  phase: LogoPhase;
  /** completed mixing passes of this phase that are on screen (1..32 for "in"/"out", 0 for "hold") */
  step: number;
}

/**
 * What the original shows `ticks` 5-ms ticks after the sequence began. A pass is mixed and blitted at the start of
 * its wait, so during step k (0-based) the screen holds the result of k + 1 passes.
 */
export function positionAtTick(ticks: number): LogoPosition {
  if (ticks >= TOTAL_TICKS) return { logo: LOGO_FILES.length - 1, phase: "done", step: LOGO_STEPS };
  const t0 = Math.max(0, Math.floor(ticks));
  const logo = Math.floor(t0 / LOGO_TICKS);
  let t = t0 - logo * LOGO_TICKS;
  if (t < LOGO_STEPS * FADE_IN_TICKS) return { logo, phase: "in", step: Math.floor(t / FADE_IN_TICKS) + 1 };
  t -= LOGO_STEPS * FADE_IN_TICKS;
  if (t < HOLD_TICKS) return { logo, phase: "hold", step: 0 };
  t -= HOLD_TICKS;
  return { logo, phase: "out", step: Math.floor(t / FADE_OUT_TICKS) + 1 };
}

/** Loads the three logos (RGB565 pixels, 640x480) from the bytes of MENU.PAK. */
export function loadLogos(menuPak: Uint8Array): Uint16Array[] {
  const pak = new Pak(menuPak);
  return LOGO_FILES.map((name) => {
    const img = decodeBm(pak.read(name));
    if (img.width !== LOGO_W || img.height !== LOGO_H) throw new Error(`${name}: ${img.width}x${img.height}, expected 640x480`);
    return img.pixels;
  });
}

export async function fetchLogos(read: (rel: string) => Promise<Uint8Array>): Promise<Uint16Array[]> {
  return loadLogos(await read("menu.PAK"));
}

/**
 * The sequence as a clock-driven state machine. `advance(ms)` moves time (no catch-up logic: the caller passes game
 * time without pauses); `surface` always holds the frame for the current position.
 * Fade-in mixes a black screen toward the logo, fade-out mixes the logo toward black, both with mixStep.
 */
export class LogoSequence {
  readonly surface: Surface16 = createSurface(LOGO_W, LOGO_H);
  private ms = 0;
  private logo = -1;
  private phase: LogoPhase = "in";
  private step = 0;
  private readonly black = new Uint16Array(LOGO_W * LOGO_H);

  constructor(private readonly logos: Uint16Array[]) {
    if (logos.length !== LOGO_FILES.length) throw new Error(`expected ${LOGO_FILES.length} logos, got ${logos.length}`);
    for (const l of logos) if (l.length !== LOGO_W * LOGO_H) throw new Error("logo is not 640x480");
  }

  get elapsedMs(): number {
    return this.ms;
  }
  get done(): boolean {
    return this.ms >= TOTAL_MS;
  }
  get position(): LogoPosition {
    return positionAtTick(Math.floor(this.ms / TICK_MS));
  }

  advance(dtMs: number): void {
    this.ms = Math.min(TOTAL_MS, this.ms + Math.max(0, dtMs));
    const pos = this.position;
    const px = this.surface.pixels;
    if (pos.phase === "done") {
      px.fill(0);
      this.logo = pos.logo;
      this.phase = "done";
      return;
    }
    if (pos.logo !== this.logo) {
      // a new logo starts from black: the original memsets the work buffer before the fade-in
      this.logo = pos.logo;
      this.phase = "in";
      this.step = 0;
      px.fill(0);
    }
    const target = this.logos[this.logo];
    // bring the screen to the position by running the missing passes (also after a long gap: every pass is cheap)
    if (pos.phase === "hold") {
      if (this.phase !== "hold") {
        // all fade-in passes are done by now; 32 passes always converge, so the logo is shown as is
        px.set(target);
        this.phase = "hold";
        this.step = 0;
      }
      return;
    }
    if (pos.phase === "out" && this.phase !== "out") {
      px.set(target);
      this.phase = "out";
      this.step = 0;
    }
    const goal = pos.phase === "in" ? target : this.black;
    while (this.step < pos.step) {
      mixStep(px, goal);
      this.step++;
    }
  }
}
