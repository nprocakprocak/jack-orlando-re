// F toggles the browser's fullscreen on #stage.
//
// The canvas buffer stays 640x480. While the stage is the fullscreen element,
// its CSS box becomes the largest rectangle of that aspect that fits the
// screen, so a click still lands on the same game pixel. The stage background
// is the bar on either side. A second F, or Esc, leaves fullscreen: the
// :fullscreen rules drop off and the page's own canvas size shows again.
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

  const onFullscreen = (): void => {
    layout();
    win.requestAnimationFrame(layout);
  };

  const unwatch = watchResolution(win, layout);
  win.addEventListener("keydown", onKey);
  win.addEventListener("resize", layout);
  doc.addEventListener("fullscreenchange", onFullscreen);

  return () => {
    unwatch();
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

async function toggle(stage: HTMLElement): Promise<void> {
  const doc = stage.ownerDocument;
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {
    // The browser refused (no user gesture, or fullscreen blocked). The page stays as it is.
  }
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
