import { LOGIC_EXTRA_EVERY, LOGIC_TICK_DIVIDER, TICK_MS } from "./constants";

/**
 * The global 5 ms tick counter g_ticks5ms. In the original a multimedia timer
 * increments it every 5 ms (Timer_TickCallback) unless g_timersPaused
 * is set. Here real time is fed in explicitly and converted into whole ticks; the
 * fractional rest is carried over to the next call.
 */
export class TickCounter {
  /** g_ticks5ms. */
  ticks = 0;
  /** Real time (ms) accumulated towards the next tick, 0 <= carryMs < TICK_MS. */
  carryMs = 0;
  /** g_timersPaused: while set, time fed in is discarded (Timer_TickCallback skips). */
  paused = false;

  /** Feeds `ms` of real time; returns the number of new ticks. */
  advance(ms: number): number {
    if (this.paused || !(ms > 0)) return 0;
    const total = this.carryMs + ms;
    // the epsilon absorbs float error of fractional frame times (16.7 + 3.3 must be 4 ticks)
    const n = Math.floor(total / TICK_MS + 1e-9);
    this.carryMs = Math.max(0, total - n * TICK_MS);
    this.ticks += n;
    return n;
  }
}

/** One execution of the logic body of Game_TimerTick. */
export interface LogicTick {
  /** Running number of executed logic bodies (0-based). */
  index: number;
  /** g_ticks5ms at the moment of the tick. */
  ticks5ms: number;
  /** True for the second body run of a double logic tick (see LOGIC_EXTRA_EVERY). */
  extra: boolean;
}

/**
 * Game_TimerTick state machine: called on every 5 ms tick, runs the logic
 * body on every 3rd call; the 11th such call and then every 10th one runs it twice.
 */
export class GameTimer {
  /** 5 ms calls since the last logic tick (0..2). */
  subTick = 0;
  /** logic ticks since the last double tick (0..10). */
  extraCounter = 0;
  /** Number of logic bodies executed so far. */
  count = 0;

  /** When false the every-11th double tick is not emulated (plain 15 ms ticks). */
  constructor(readonly doubleEvery11th = true) {}

  /** One 5 ms call; invokes `body` 0, 1 or 2 times. */
  tick(ticks5ms: number, body: (t: LogicTick) => void): void {
    this.subTick++;
    if (this.subTick < LOGIC_TICK_DIVIDER) return;
    this.subTick = 0;
    let extra = false;
    for (;;) {
      body({ index: this.count++, ticks5ms, extra });
      if (!this.doubleEvery11th) return;
      this.extraCounter++;
      if (this.extraCounter < LOGIC_EXTRA_EVERY) return;
      this.extraCounter = 0;
      extra = true;
    }
  }
}
