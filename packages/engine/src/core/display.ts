// Display sizing for the 640x480 canvas on HiDPI screens.
// Problem: a canvas shown at 640 CSS px on a screen with devicePixelRatio 1.25 covers 800
// device pixels, i.e. every game pixel is 1.25 device pixels wide. With
// `image-rendering: pixelated` some pixels get 1 device pixel and some 2, so thin text
// (movie subtitles, pressed dialog options) looks uneven. The original game ran in a
// fullscreen DirectDraw mode where the monitor scaled the picture smoothly.
// Fix: choose the CSS size so the canvas covers a whole number of device pixels per game
// pixel (pixelated, crisp). If no integer factor is close enough to the wanted size, show
// the canvas at the wanted size with smooth scaling instead (like the monitor scaler did).

export type ScaleMode = "auto" | "integer" | "smooth";

export interface DisplayInput {
  /** Canvas buffer size (game pixels). */
  logicalWidth: number;
  logicalHeight: number;
  /** Wanted width in CSS px (default look of the page: logicalWidth). */
  targetCssWidth: number;
  /** Largest width available in CSS px. */
  maxCssWidth: number;
  /** window.devicePixelRatio. */
  dpr: number;
  mode?: ScaleMode;
}

export interface DisplayLayout {
  /** CSS size to set on the canvas. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixels per game pixel. */
  scale: number;
  /** true: bilinear (`image-rendering: auto`); false: pixelated. */
  smooth: boolean;
}

/** Smallest acceptable integer-size / wanted-size ratio before auto mode prefers smoothing. */
export const MIN_INTEGER_FILL = 0.75;

const EPS = 1e-6;

export function computeDisplay(input: DisplayInput): DisplayLayout {
  const { logicalWidth: lw, logicalHeight: lh } = input;
  const dpr = input.dpr > 0 && Number.isFinite(input.dpr) ? input.dpr : 1;
  const mode = input.mode ?? "auto";
  const wantedCss = Math.max(1, Math.min(input.targetCssWidth, input.maxCssWidth));
  const wantedDevice = wantedCss * dpr;
  const ratio = wantedDevice / lw;
  const exact = ratio >= 1 - EPS && Math.abs(ratio - Math.round(ratio)) < EPS;

  let scale = Math.floor(ratio + EPS);
  let smooth: boolean;
  if (exact) {
    scale = Math.round(ratio);
    smooth = false;
  } else if (mode === "smooth") {
    smooth = true;
  } else if (mode === "integer") {
    scale = Math.max(1, scale);
    smooth = false;
  } else {
    smooth = scale < 1 || scale / ratio < MIN_INTEGER_FILL;
  }

  if (smooth) {
    // Whole device pixels so the browser does not resample the edges as well.
    const deviceW = Math.max(1, Math.round(wantedDevice));
    const deviceH = Math.max(1, Math.round((deviceW * lh) / lw));
    return { cssWidth: deviceW / dpr, cssHeight: deviceH / dpr, scale: deviceW / lw, smooth: true };
  }
  return { cssWidth: (lw * scale) / dpr, cssHeight: (lh * scale) / dpr, scale, smooth: false };
}

/** Reads `?scale=auto|integer|smooth` (anything else = auto). */
export function parseScaleMode(search: string): ScaleMode {
  const v = new URLSearchParams(search).get("scale");
  return v === "integer" || v === "smooth" ? v : "auto";
}

export interface DisplayOptions {
  mode?: ScaleMode;
  /** Wanted CSS width; default: the canvas buffer width. */
  targetCssWidth?: number;
  /** Horizontal space kept free around the canvas (CSS px). */
  margin?: number;
  /**
   * "contain" sizes the canvas to the largest rect that fits in the window,
   * keeps the buffer's aspect, and centers it. The page background is the bars.
   */
  fit?: "contain";
}

export interface ContainInput {
  logicalWidth: number;
  logicalHeight: number;
  /** Window interior, CSS px. */
  availCssWidth: number;
  availCssHeight: number;
  dpr: number;
}

/** Largest aspect-correct size that fits in the window. Integer scales stay pixelated. */
export function containDisplay(input: ContainInput): DisplayLayout {
  const { logicalWidth: lw, logicalHeight: lh } = input;
  const dpr = input.dpr > 0 && Number.isFinite(input.dpr) ? input.dpr : 1;
  const maxW = Math.max(1, Math.floor(Math.max(0, input.availCssWidth) * dpr));
  const maxH = Math.max(1, Math.floor(Math.max(0, input.availCssHeight) * dpr));
  let deviceW = maxW;
  let deviceH = Math.floor((deviceW * lh) / lw);
  if (deviceH > maxH || deviceH < 1) {
    deviceH = maxH;
    deviceW = Math.floor((deviceH * lw) / lh);
  }
  deviceW = Math.max(1, deviceW);
  deviceH = Math.max(1, deviceH);
  const scale = deviceW / lw;
  const exact = Math.abs(scale - Math.round(scale)) < EPS;
  return { cssWidth: deviceW / dpr, cssHeight: deviceH / dpr, scale, smooth: !exact };
}

function layoutCanvas(canvas: HTMLCanvasElement, options: DisplayOptions, doc: Document, win: Window): void {
  const lw = canvas.width || 640;
  const lh = canvas.height || 480;
  const dpr = win.devicePixelRatio;
  const margin = options.margin ?? 34;
  const layout =
    options.fit === "contain"
      ? containDisplay({
          logicalWidth: lw,
          logicalHeight: lh,
          availCssWidth: win.innerWidth,
          availCssHeight: win.innerHeight,
          dpr,
        })
      : computeDisplay({
          logicalWidth: lw,
          logicalHeight: lh,
          targetCssWidth: options.targetCssWidth ?? lw,
          maxCssWidth: doc.documentElement.clientWidth > margin + 64 ? doc.documentElement.clientWidth - margin : Infinity,
          dpr,
          mode: options.mode ?? parseScaleMode(win.location.search),
        });
  const st = canvas.style;
  st.boxSizing = "content-box";
  st.width = `${layout.cssWidth}px`;
  st.height = `${layout.cssHeight}px`;
  st.maxWidth = "none";
  st.imageRendering = layout.smooth ? "auto" : "pixelated";
  if (options.fit === "contain") {
    st.position = "fixed";
    st.left = "50%";
    st.top = "50%";
    st.transform = "translate(-50%, -50%)";
    st.margin = "0";
  }
}

function watchCanvas(canvas: HTMLCanvasElement, win: Window, apply: () => void): () => void {
  const unbinds: Array<() => void> = [];
  win.addEventListener("resize", apply);
  win.addEventListener("load", apply);
  unbinds.push(() => win.removeEventListener("resize", apply));

  let mq: MediaQueryList | undefined;
  const onDpr = (): void => {
    apply();
    watchDpr();
  };
  const watchDpr = (): void => {
    mq?.removeEventListener("change", onDpr);
    mq = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    mq.addEventListener("change", onDpr);
  };
  watchDpr();
  unbinds.push(() => mq?.removeEventListener("change", onDpr));

  if (typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(apply);
    mo.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
    unbinds.push(() => mo.disconnect());
  }
  return () => unbinds.forEach((u) => u());
}

/**
 * Keeps `canvas` sized per computeDisplay: reacts to window resize, devicePixelRatio
 * changes (zoom, moving between monitors) and buffer size changes. Returns a cleanup.
 */
export function attachDisplay(canvas: HTMLCanvasElement, options: DisplayOptions = {}): () => void {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView ?? window;
  const apply = (): void => layoutCanvas(canvas, options, doc, win);
  apply();
  return watchCanvas(canvas, win, apply);
}
