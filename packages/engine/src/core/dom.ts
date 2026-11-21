// Browser bindings for EngineLoop: requestAnimationFrame, focus/visibility, keyboard and
// mouse events. Kept thin so the logic in loop.ts / keyboard.ts / mouse.ts stays testable
// without a browser; the functions take minimal structural types and return a cleanup
// function.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./constants";
import { CODE_TO_DIK, DIK, keyChar, type Keyboard } from "./keyboard";
import type { EngineLoop } from "./loop";
import { clientToScreen, domButtonToMask, type Mouse, type Rect } from "./mouse";

type Unbind = () => void;

interface KeyLike extends Event {
  code: string;
  key: string;
  repeat: boolean;
}

interface PointerLike extends Event {
  clientX: number;
  clientY: number;
  button: number;
}

/** Element with a client rectangle (HTMLCanvasElement). */
export interface RectTarget extends EventTarget {
  getBoundingClientRect(): Rect;
}

/** Keys the browser keeps for itself (dev tools, fullscreen). */
const BROWSER_KEYS = new Set<number>([DIK.F11, DIK.F12]);

/**
 * Forwards keydown/keyup to the keyboard buffer as DIK events. Auto-repeat is ignored
 * (DirectInput buffered data has none). Default actions of mapped keys are prevented,
 * except F11/F12.
 */
export function bindKeyboard(target: EventTarget, keyboard: Keyboard): Unbind {
  const handler = (e: Event) => {
    const ev = e as KeyLike;
    const dik = CODE_TO_DIK[ev.code];
    if (dik === undefined) return;
    if (!BROWSER_KEYS.has(dik)) ev.preventDefault();
    if (ev.repeat) return;
    const down = ev.type === "keydown";
    keyboard.push({ dik, down, char: down ? keyChar(ev.key) : 0 });
  };
  target.addEventListener("keydown", handler);
  target.addEventListener("keyup", handler);
  return () => {
    target.removeEventListener("keydown", handler);
    target.removeEventListener("keyup", handler);
  };
}

/**
 * Pointer events on the canvas -> Mouse in 640x480 screen coordinates (CSS scaling of the
 * canvas handled by clientToScreen). The scroll offset is set on the Mouse by the scene
 * (mouse.setScroll). Button releases are listened for on `releaseTarget` (default: the
 * canvas) so a release outside the canvas still clears the button.
 */
export function bindMouse(
  canvas: RectTarget,
  mouse: Mouse,
  releaseTarget: EventTarget = canvas,
  width = SCREEN_WIDTH,
  height = SCREEN_HEIGHT,
): Unbind {
  const pos = (e: PointerLike) => {
    const p = clientToScreen(e.clientX, e.clientY, canvas.getBoundingClientRect(), width, height);
    mouse.move(p.x, p.y);
  };
  const onMove = (e: Event) => pos(e as PointerLike);
  const onDown = (e: Event) => {
    const ev = e as PointerLike;
    ev.preventDefault();
    pos(ev);
    mouse.buttonDown(domButtonToMask(ev.button));
  };
  const onUp = (e: Event) => mouse.buttonUp(domButtonToMask((e as PointerLike).button));
  const onMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("contextmenu", onMenu);
  releaseTarget.addEventListener("pointerup", onUp);
  return () => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("contextmenu", onMenu);
    releaseTarget.removeEventListener("pointerup", onUp);
  };
}

/** Document subset used for the visibility state. */
export interface DocLike extends EventTarget {
  hidden: boolean;
}

/**
 * Pauses the loop when the page is hidden or the window loses focus, resumes when it is
 * visible and focused again (WM_ACTIVATE in the original). The page counts as focused
 * until the first blur: a page opened without focus (e.g. in an embedded preview) still
 * runs, as the original window starts active.
 */
export function bindFocus(win: EventTarget, doc: DocLike, loop: EngineLoop): Unbind {
  let focused = true;
  const update = () => loop.setActive(focused && !doc.hidden);
  const onBlur = () => {
    focused = false;
    update();
  };
  const onFocus = () => {
    focused = true;
    update();
  };
  win.addEventListener("blur", onBlur);
  win.addEventListener("focus", onFocus);
  doc.addEventListener("visibilitychange", update);
  update();
  return () => {
    win.removeEventListener("blur", onBlur);
    win.removeEventListener("focus", onFocus);
    doc.removeEventListener("visibilitychange", update);
  };
}

export interface FrameScheduler {
  request(cb: (timeMs: number) => void): number;
  cancel(id: number): void;
}

/** Runs loop.step() on every animation frame. */
export function runLoop(loop: EngineLoop, scheduler?: FrameScheduler): Unbind {
  const s: FrameScheduler = scheduler ?? {
    request: (cb) => requestAnimationFrame(cb),
    cancel: (id) => cancelAnimationFrame(id),
  };
  let id = 0;
  let running = true;
  const tick = (t: number) => {
    if (!running) return;
    loop.step(t);
    id = s.request(tick);
  };
  id = s.request(tick);
  return () => {
    running = false;
    s.cancel(id);
  };
}
