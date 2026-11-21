// Pause policy: pure state, no DOM. dom.ts feeds it the browser events, the rAF timestamps and a watchdog
// timer; tests feed it a fake clock.

/** Why the game is paused. */
export type PauseReason = "hidden" | "blur" | "throttled";

export interface PauseInputs {
  /** the window has the focus (window focus/blur) */
  focused: boolean;
  /** document.hidden: another tab, minimised window, a window the browser reports as occluded */
  hidden: boolean;
  /** the option (settings.ts): pause when the focus is lost */
  pauseOnBlur: boolean;
  /** the browser throttles the page (ThrottleDetector) */
  throttled: boolean;
}

/**
 * The pause decision. A hidden page always pauses (rAF does not run there, sound would run away from the
 * picture). Without the focus the option decides. A throttled page pauses in every state: measured in the
 * desktop app's browser pane, a hidden pane reports `visible` and the focus while rAF runs at 1 Hz
 *
 */
export function pauseReason(s: PauseInputs): PauseReason | null {
  if (s.hidden) return "hidden";
  if (!s.focused && s.pauseOnBlur) return "blur";
  if (s.throttled) return "throttled";
  return null;
}

export interface ThrottleOptions {
  /** an animation-frame gap longer than this is slow (ms); default 250 */
  slowGapMs?: number;
  /** consecutive slow gaps that mean throttling; default 2 (one is a long task: loading, GC) */
  slowFrames?: number;
  /** no animation frame for this long, seen by the watchdog timer, means throttling (ms); default 400 */
  stallMs?: number;
  /**
   * the watchdog counts only when its own previous call was at most this long ago (ms): a late timer means the
   * main thread was busy (a long task delays rAF and timers alike), not that the browser throttles rAF; default 400
   */
  maxCheckGapMs?: number;
  /** consecutive gaps of at most `normalGapMs` needed to call the page normal again; default 3 */
  recoverFrames?: number;
  /** a gap counted as normal (ms); default 50 (20 fps) */
  normalGapMs?: number;
}

/**
 * Watches the requestAnimationFrame timestamps. Browsers run rAF at the display rate in a visible window and
 * slow it down (1 Hz) or stop it for a page they consider in the background, sometimes without telling the
 * page (document.hidden false). Throttling is `slowFrames` slow gaps in a row, or a watchdog check (a regular
 * timer, which keeps its pace while only rAF is throttled) that sees no frame for `stallMs`; `recoverFrames`
 * normal gaps in a row clear it.
 */
export class ThrottleDetector {
  readonly slowGapMs: number;
  readonly slowFrames: number;
  readonly stallMs: number;
  readonly maxCheckGapMs: number;
  readonly recoverFrames: number;
  readonly normalGapMs: number;
  throttled = false;
  /** timestamp of the last animation frame, null before the first one / after reset() */
  lastFrame: number | null = null;
  private lastCheck: number | null = null;
  private slow = 0;
  private normal = 0;

  constructor(opts: ThrottleOptions = {}) {
    this.slowGapMs = opts.slowGapMs ?? 250;
    this.slowFrames = opts.slowFrames ?? 2;
    this.stallMs = opts.stallMs ?? 400;
    this.maxCheckGapMs = opts.maxCheckGapMs ?? 400;
    this.recoverFrames = opts.recoverFrames ?? 3;
    this.normalGapMs = opts.normalGapMs ?? 50;
  }

  /** An animation frame at `t` (ms). Returns the throttled state. */
  frame(t: number): boolean {
    const prev = this.lastFrame;
    this.lastFrame = t;
    if (prev === null) return this.throttled;
    const gap = t - prev;
    if (gap > this.slowGapMs) {
      this.normal = 0;
      if (++this.slow >= this.slowFrames) this.throttled = true;
    } else {
      this.slow = 0;
      if (gap <= this.normalGapMs) {
        if (++this.normal >= this.recoverFrames) this.throttled = false;
      } else {
        this.normal = 0;
      }
    }
    return this.throttled;
  }

  /** Watchdog (a timer, still running when rAF is throttled): no frame since `stallMs`. Returns the throttled state. */
  check(now: number): boolean {
    const prev = this.lastCheck;
    this.lastCheck = now;
    const timerOnTime = prev !== null && now - prev <= this.maxCheckGapMs;
    if (timerOnTime && this.lastFrame !== null && now - this.lastFrame > this.stallMs) {
      this.throttled = true;
      this.normal = 0;
    }
    return this.throttled;
  }

  /** Forget the history (the page got the focus or became visible: the next gap is not a throttling sign). */
  reset(): void {
    this.throttled = false;
    this.lastFrame = null;
    this.lastCheck = null;
    this.slow = 0;
    this.normal = 0;
  }
}

/** One change of the pause state. */
export interface PauseChange {
  paused: boolean;
  reason: PauseReason | null;
  /** time of the change (the clock of the caller) */
  at: number;
}

/**
 * The state machine: browser facts in, pause decisions out. `onChange` is called only when `paused` flips
 * (a change of the reason alone, e.g. blur -> hidden, is reported through `reason`).
 */
export class PauseController {
  readonly detector: ThrottleDetector;
  private readonly inputs: PauseInputs;
  private current: PauseReason | null;
  readonly history: PauseChange[] = [];

  constructor(
    init: { pauseOnBlur: boolean; focused?: boolean; hidden?: boolean },
    private readonly onChange: (paused: boolean, reason: PauseReason | null) => void = () => {},
    opts: ThrottleOptions = {},
  ) {
    this.detector = new ThrottleDetector(opts);
    this.inputs = {
      focused: init.focused ?? true,
      hidden: init.hidden ?? false,
      pauseOnBlur: init.pauseOnBlur,
      throttled: false,
    };
    this.current = pauseReason(this.inputs);
  }

  get paused(): boolean {
    return this.current !== null;
  }

  get reason(): PauseReason | null {
    return this.current;
  }

  get state(): Readonly<PauseInputs> {
    return this.inputs;
  }

  setFocused(focused: boolean, at = 0): void {
    this.inputs.focused = focused;
    if (focused) this.clearThrottle();
    this.apply(at);
  }

  setHidden(hidden: boolean, at = 0): void {
    this.inputs.hidden = hidden;
    // the frames before the page became visible say nothing about the frames after
    if (!hidden) this.clearThrottle();
    this.apply(at);
  }

  setPauseOnBlur(pauseOnBlur: boolean, at = 0): void {
    this.inputs.pauseOnBlur = pauseOnBlur;
    this.apply(at);
  }

  /** An animation frame (rAF timestamp). */
  frame(t: number): void {
    this.inputs.throttled = this.detector.frame(t);
    this.apply(t);
  }

  /** Watchdog tick (timer). */
  check(now: number): void {
    this.inputs.throttled = this.detector.check(now);
    this.apply(now);
  }

  private clearThrottle(): void {
    this.detector.reset();
    this.inputs.throttled = false;
  }

  private apply(at: number): void {
    const next = pauseReason(this.inputs);
    const was = this.current !== null;
    this.current = next;
    if (was !== (next !== null)) {
      this.history.push({ paused: next !== null, reason: next, at });
      this.onChange(next !== null, next);
    }
  }
}
