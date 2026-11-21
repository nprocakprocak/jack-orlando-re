// Browser bindings of the pause policy: window focus/blur, visibilitychange, an own rAF chain that watches
// the frame gaps and a watchdog timer for a stopped rAF. Thin on purpose: the decisions are in policy.ts.
// Replaces core/dom.ts bindFocus on the game page.

import { PauseController, type PauseReason, type ThrottleOptions } from "./policy";

type Unbind = () => void;

/** Document subset used here. */
export interface PauseDoc extends EventTarget {
  hidden: boolean;
}

/** What gets paused: EngineLoop (setActive) — logic, animations, scripts, counters, films' frames. */
export interface Pausable {
  setActive(active: boolean): void;
}

export interface PauseEnv {
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
  now(): number;
}

export interface BindPauseOptions {
  /** the option (settings.ts readPauseOnBlur) */
  pauseOnBlur: boolean;
  /**
 * Called when the pause flips, after loop.setActive: suspend/resume the sound here
 * (`game.audio.mixer.setPaused(paused)` -> AudioContext.suspend/resume: music, effects, speech, the film's sound).
 */
  onChange?(paused: boolean, reason: PauseReason | null): void;
  /** watchdog period (ms), default 250 */
  watchdogMs?: number;
  throttle?: ThrottleOptions;
  env?: PauseEnv;
}

export interface PauseBinding {
  readonly controller: PauseController;
  /** the start screen can switch the option while the game runs */
  setPauseOnBlur(on: boolean): void;
  unbind: Unbind;
}

function browserEnv(): PauseEnv {
  return {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    setInterval: (cb, ms) => setInterval(cb, ms) as unknown as number,
    clearInterval: (id) => clearInterval(id),
    now: () => performance.now(),
  };
}

/**
 * Pauses `loop` (and through onChange the sound) according to the policy. The page counts as focused until the
 * first blur, as bindFocus does: a page opened without the focus (an embedded preview) still runs, as the
 * original window starts active.
 */
export function bindPause(win: EventTarget, doc: PauseDoc, loop: Pausable, opts: BindPauseOptions): PauseBinding {
  const env = opts.env ?? browserEnv();
  const controller = new PauseController(
    { pauseOnBlur: opts.pauseOnBlur, focused: true, hidden: doc.hidden },
    (paused, reason) => {
      loop.setActive(!paused);
      opts.onChange?.(paused, reason);
    },
    opts.throttle,
  );
  if (controller.paused) {
    loop.setActive(false);
    opts.onChange?.(true, controller.reason);
  }
  const onBlur = () => controller.setFocused(false, env.now());
  const onFocus = () => controller.setFocused(true, env.now());
  const onVisibility = () => controller.setHidden(doc.hidden, env.now());
  win.addEventListener("blur", onBlur);
  win.addEventListener("focus", onFocus);
  doc.addEventListener("visibilitychange", onVisibility);
  let running = true;
  let frameId = 0;
  const onFrame = (t: number) => {
    if (!running) return;
    controller.frame(t);
    frameId = env.requestFrame(onFrame);
  };
  frameId = env.requestFrame(onFrame);
  const timer = env.setInterval(() => controller.check(env.now()), opts.watchdogMs ?? 250);
  return {
    controller,
    setPauseOnBlur: (on) => controller.setPauseOnBlur(on, env.now()),
    unbind: () => {
      running = false;
      env.cancelFrame(frameId);
      env.clearInterval(timer);
      win.removeEventListener("blur", onBlur);
      win.removeEventListener("focus", onFocus);
      doc.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
