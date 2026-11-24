// F toggles the browser's fullscreen on #stage.
//
// The canvas buffer stays 640x480. While the stage is the fullscreen element,
// its CSS box becomes the largest rectangle of that aspect that fits the
// screen, so a click still lands on the same game pixel. The stage background
// is the bar on either side. A second F leaves fullscreen: the :fullscreen
// rules drop off and the page's own canvas size shows again.
//
// A short Esc stays with the game. Holding Esc leaves fullscreen. The browser
// owns that hold. Firefox and Safari take it from requestFullscreen's
// keyboardLock option. Chrome and Edge take it from keyboard.lock once
// fullscreen is up; a rejected option still enters on the plain request.
// Brave hides navigator.keyboard while its fingerprinting protection blocks
// the keyboard API, so that call never runs and a short Esc still leaves.
// Safari leaves on a short Esc unless the page cancels the key, so Esc is
// cancelled while the stage is fullscreen. That listener runs on the way
// down: a slot description stops the key later, and the cancel has to land
// first.
//
// A bare F is required. Repeat and Ctrl/Alt/Shift/Meta stay with the browser,
// and F typed into the ZIP field does not toggle.

import { containDisplay } from "jack-orlando-re/core";

const FIT_W = "--fs-w";
const FIT_H = "--fs-h";
const FIT_RENDER = "--fs-render";

export function bindFullscreen(stage: HTMLElement, canvas: HTMLCanvasElement): () => void {
  const win = stage.ownerDocument.defaultView ?? window;
  const doc = stage.ownerDocument;

  const layout = (): void => {
    if (doc.fullscreenElement !== stage) return;
    if (stage.clientWidth < 2 || stage.clientHeight < 2) return;
    const fitted = containDisplay({
      logicalWidth: canvas.width || 640,
      logicalHeight: canvas.height || 480,
      availCssWidth: stage.clientWidth,
      availCssHeight: stage.clientHeight,
      dpr: win.devicePixelRatio || 1,
    });
    canvas.style.setProperty(FIT_W, `${fitted.cssWidth}px`);
    canvas.style.setProperty(FIT_H, `${fitted.cssHeight}px`);
    canvas.style.setProperty(FIT_RENDER, fitted.smooth ? "auto" : "pixelated");
  };

  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (!bareF(e)) return;
    e.preventDefault();
    void toggle(stage);
  };

  // Capture, so the cancel runs before a slot description stops the key.
  const onEscape = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (!bareEscape(e) || doc.fullscreenElement !== stage) return;
    e.preventDefault();
  };

  const onFullscreen = (): void => {
    if (doc.fullscreenElement !== stage) releaseEscape(doc);
    layout();
    win.requestAnimationFrame(layout);
  };

  const unwatch = watchResolution(win, layout);
  win.addEventListener("keydown", onEscape, true);
  win.addEventListener("keyup", onEscape, true);
  win.addEventListener("keydown", onKey);
  win.addEventListener("resize", layout);
  doc.addEventListener("fullscreenchange", onFullscreen);

  return () => {
    unwatch();
    releaseEscape(doc);
    win.removeEventListener("keydown", onEscape, true);
    win.removeEventListener("keyup", onEscape, true);
    win.removeEventListener("keydown", onKey);
    win.removeEventListener("resize", layout);
    doc.removeEventListener("fullscreenchange", onFullscreen);
  };
}

function bareF(e: KeyboardEvent): boolean {
  if (e.code !== "KeyF" || e.repeat) return false;
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  const t = e.target;
  if (!(t instanceof HTMLElement)) return true;
  return !t.isContentEditable && t.closest("input, textarea, select") === null;
}

function bareEscape(e: KeyboardEvent): boolean {
  return e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
}

async function toggle(stage: HTMLElement): Promise<void> {
  const doc = stage.ownerDocument;
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else await enterFullscreen(stage);
  } catch {
    // The browser refused (no user gesture, or fullscreen blocked). The page stays as it is.
  }
}

// keyboardLock is the Firefox and Safari path. Where the browser rejects that
// option, the plain request still enters. keyboard.lock is the Chrome path,
// and it has to follow a fullscreen that is already up.
async function enterFullscreen(stage: HTMLElement): Promise<void> {
  const doc = stage.ownerDocument;
  try {
    await requestStageFullscreen(stage, { keyboardLock: "browser" });
  } catch {
    if (doc.fullscreenElement !== stage) await requestStageFullscreen(stage);
  }
  if (doc.fullscreenElement === stage) await holdEscape(doc);
}

interface StageFullscreenOptions {
  keyboardLock?: "browser";
}

function requestStageFullscreen(stage: HTMLElement, options?: StageFullscreenOptions): Promise<void> {
  const request = stage.requestFullscreen as (this: HTMLElement, options?: StageFullscreenOptions) => Promise<void>;
  return request.call(stage, options);
}

interface EscapeKeyboard {
  lock(codes?: string[]): Promise<void>;
  unlock(): void;
}

function escapeKeyboard(doc: Document): EscapeKeyboard | null {
  const view = doc.defaultView as (Window & { navigator: Navigator & { keyboard?: EscapeKeyboard } }) | null;
  const keyboard = view?.navigator.keyboard;
  if (typeof keyboard?.lock !== "function" || typeof keyboard.unlock !== "function") return null;
  return keyboard;
}

async function holdEscape(doc: Document): Promise<void> {
  const keyboard = escapeKeyboard(doc);
  if (!keyboard) return;
  try {
    await keyboard.lock(["Escape"]);
  } catch {
    // The browser refused the lock. A short Esc still leaves fullscreen there.
  }
}

function releaseEscape(doc: Document): void {
  escapeKeyboard(doc)?.unlock();
}

function watchResolution(win: Window, apply: () => void): () => void {
  let mq = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
  const onChange = (): void => {
    apply();
    mq.removeEventListener("change", onChange);
    mq = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    mq.addEventListener("change", onChange);
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
