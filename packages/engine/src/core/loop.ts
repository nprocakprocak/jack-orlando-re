import { GameTimer, TickCounter, type LogicTick } from "./clock";
import { FRAME_MIN_MS, INPUT_POLL_MS, LOGIC_TICK_MS, TICK_MS } from "./constants";
import { Keyboard } from "./keyboard";
import { Mouse } from "./mouse";

/**
 * Engine main loop modelled on the original:
 *
 * - a global 5 ms tick counter (g_ticks5ms) advanced from real time;
 * - on every tick: the keyboard poll timer (40 ms) and Game_TimerTick, which
 * runs the 15 ms logic tick -> `update(tick)`;
 * - game frames are paced by Timer_WaitSinceFrameStart
 * a new frame starts only when more than FRAME_MIN_MS / 5 ticks passed since
 * the previous one started -> `frame(info)` then `render(alpha, info)`;
 * - losing focus pauses everything (WndProc WM_ACTIVATE -> Timer_SetPaused(0),
 * Input_SetAcquired(0); Sys_PumpMessages spins until reactivated and then
 * reacquires input). In the browser the decision is pause/policy.ts (the option,
 * hidden page, throttled rAF); it calls setActive(). Time spent inactive is not counted and
 * not caught up: FrameInfo.elapsedMs is the game time for real-time consumers.
 *
 * The loop has no DOM dependency: step(nowMs) is fed by requestAnimationFrame (see dom.ts)
 * or by a fake clock in tests.
 */

/** Data passed to the per-frame hooks. */
export interface FrameInfo {
  /** g_frameCounter before the increment at the end of this frame. */
  frame: number;
  /** g_ticks5ms at the frame start (g_frameStartTick). */
  ticks5ms: number;
  /** Number of logic ticks executed so far. */
  logicTicks: number;
  /** Real time (ms) passed to step(). */
  nowMs: number;
  /**
   * Game time (ms) since the previous frame: the real time the loop consumed, without the time spent
   * inactive (pause) and without what maxStepMs dropped. Feed real-time consumers (films, fades,
   * music fades) with this instead of performance.now() differences, so a pause does not make them catch up.
   */
  elapsedMs: number;
  /** Total game time (ms) consumed so far (sum of elapsedMs). */
  gameMs: number;
}

/** Game hooks. All are optional; the renderer plugs into `render`. */
export interface GameHooks {
  /** 15 ms logic tick: countdowns etc. (body of Game_TimerTick). */
  update?(tick: LogicTick): void;
  /** One iteration of the game frame loop: per-frame logic, input handling. */
  frame?(info: FrameInfo): void;
  /**
   * Draw and present. `alpha` (0 <= alpha < 1) is the progress towards the next logic tick
   * for optional interpolation; the original does not interpolate.
   */
  render?(alpha: number, info: FrameInfo): void;
  /** Focus lost (false) / regained (true), e.g. to pause sound (Sound_SetPaused). */
  activeChanged?(active: boolean): void;
}

export interface LoopOptions {
  /**
   * Upper bound of real time consumed by one step(); the rest is dropped. Protects against
   * a burst of catch-up ticks after the tab was throttled without a visibility event.
   * Not in the original (its mm-timer does not queue missed ticks). Default 100 ms.
   */
  maxStepMs?: number;
  /** g_frameMinMs; default FRAME_MIN_MS (5). */
  frameMinMs?: number;
  /** Emulate the double logic tick on every 11th tick (default true, as in the original). */
  doubleEvery11th?: boolean;
  keyboard?: Keyboard;
  mouse?: Mouse;
}

export interface LoopStats {
  /** Real time dropped by the maxStepMs limit. */
  droppedMs: number;
  /** step() calls that did not start a frame because of the minimum frame time. */
  skippedFrames: number;
}

export class EngineLoop {
  readonly clock = new TickCounter();
  readonly timer: GameTimer;
  readonly keyboard: Keyboard;
  readonly mouse: Mouse;
  readonly maxStepMs: number;
  readonly frameMinMs: number;
  readonly stats: LoopStats = { droppedMs: 0, skippedFrames: 0 };
  /** g_frameCounter. */
  frameCount = 0;
  /** g_appActive. */
  active = true;
  /** Game time (ms): real time fed into the tick counter while active (FrameInfo.gameMs). */
  gameMs = 0;

  private lastNow: number | null = null;
  private frameStartTick: number | null = null;
  private pollTicks = 0;
  private frameGameMs = 0;

  constructor(
    readonly hooks: GameHooks = {},
    opts: LoopOptions = {},
  ) {
    this.maxStepMs = opts.maxStepMs ?? 100;
    this.frameMinMs = opts.frameMinMs ?? FRAME_MIN_MS;
    this.timer = new GameTimer(opts.doubleEvery11th ?? true);
    this.keyboard = opts.keyboard ?? new Keyboard();
    this.mouse = opts.mouse ?? new Mouse();
  }

  /** g_ticks5ms. */
  get ticks(): number {
    return this.clock.ticks;
  }

  /** Number of logic ticks executed. */
  get logicTicks(): number {
    return this.timer.count;
  }

  /** Progress towards the next logic tick, 0 <= alpha < 1. */
  get alpha(): number {
    const a = (this.timer.subTick * TICK_MS + this.clock.carryMs) / LOGIC_TICK_MS;
    return Math.min(a, 1 - Number.EPSILON);
  }

  /**
   * Advances the engine to real time `nowMs` (e.g. the requestAnimationFrame timestamp).
   * Returns true when a frame was run.
   */
  step(nowMs: number): boolean {
    const prev = this.lastNow;
    this.lastNow = nowMs;
    if (!this.active) return false;
    if (prev !== null) {
      let dt = nowMs - prev;
      if (!(dt > 0)) dt = 0;
      if (dt > this.maxStepMs) {
        this.stats.droppedMs += dt - this.maxStepMs;
        dt = this.maxStepMs;
      }
      this.advance(dt);
    }
    return this.runFrameIfDue(nowMs);
  }

  /** Feeds `ms` of real time into the tick counter and runs the timers for each new tick. */
  advance(ms: number): void {
    if (!this.clock.paused && ms > 0) this.gameMs += ms;
    const n = this.clock.advance(ms);
    const pollEvery = INPUT_POLL_MS / TICK_MS;
    const first = this.clock.ticks - n;
    for (let i = 1; i <= n; i++) {
      const t = first + i;
      if (++this.pollTicks >= pollEvery) {
        this.pollTicks = 0;
        this.keyboard.poll();
      }
      this.timer.tick(t, (tick) => this.hooks.update?.(tick));
    }
  }

  /** Focus/visibility change (WM_ACTIVATE). */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.clock.paused = !active;
    this.keyboard.setAcquired(active);
    this.mouse.setAcquired(active);
    // time spent inactive is not counted: the next step() starts measuring afresh
    this.lastNow = null;
    this.hooks.activeChanged?.(active);
  }

  private runFrameIfDue(nowMs: number): boolean {
    const minTicks = Math.floor(this.frameMinMs / TICK_MS);
    if (this.frameStartTick !== null && minTicks !== 0 && this.clock.ticks - this.frameStartTick <= minTicks) {
      this.stats.skippedFrames++;
      return false;
    }
    this.frameStartTick = this.clock.ticks;
    const info: FrameInfo = {
      frame: this.frameCount,
      ticks5ms: this.clock.ticks,
      logicTicks: this.timer.count,
      nowMs,
      elapsedMs: this.gameMs - this.frameGameMs,
      gameMs: this.gameMs,
    };
    this.frameGameMs = this.gameMs;
    this.hooks.frame?.(info);
    this.hooks.render?.(this.alpha, info);
    this.frameCount++;
    return true;
  }
}
