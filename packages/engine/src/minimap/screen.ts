// The small map screen (M): state and drawing of Game_Run. No DOM: the host calls open(), feeds key
// events and one tick(dtMs) per frame, draws draw().
import type { Image16 } from "../formats/bm";
import { zoomImage } from "../cursor/lens";
import { drawWindowFrame } from "../gui/draw";
import type { Surface16 } from "../render/surface";
import { blitCopy, createSurface } from "../render/surface";
import {
  DIK_MAP, FRAME_MS, IMAGE_INSET, MAP_X, MAP_Y, MARKER_FRAMES, MARKER_SCALE, MARKER_SETS, WINDOW_H, WINDOW_W,
} from "./layout";

export interface MiniMapAssets {
  /** MAP2.BM (0x266 x 0x12e) */
  map: Image16;
  /** marker set (index in MARKER_SETS) or null: no marker */
  set: number | null;
  /** the MARKER_FRAMES frames of the set, unscaled (null set: empty) */
  frames: Image16[];
}

export interface MiniMapHost {
  /** the screen is gone: the game goes on (effects resume, the scene is drawn again) */
  onExit(): void;
}

/**
 * closed → waitOpen (M still held from the press: `while (Input_IsKeyDown(M))`) → showing (marker loop) →
 * waitClose (scene redrawn by `Render_RedrawAll`, waits until M is up) → closed.
 */
export type MiniMapPhase = "closed" | "waitOpen" | "showing" | "waitClose";

export class MiniMapScreen {
  phase: MiniMapPhase = "closed";
  /** the cursor sprite is removed and `g_renderIdle = 0`: no cursor is drawn while the screen is open */
  readonly cursorHidden = true;
  private snapshot: Surface16 = createSurface(640, 480);
  private canvas: Surface16 = createSurface(640, 480);
  private assets: MiniMapAssets | null = null;
  private scaled: (Image16 | null)[] = [];
  private held = new Set<number>();
  private frame = 0;
  private clock = 0;
  private nextAt = 0;

  constructor(private readonly host: MiniMapHost) {}

  get isOpen(): boolean {
    return this.phase !== "closed";
  }

  /**
 * Entry: `scene` = the visible 640x480 picture without the cursor (`Sprite_Remove` of the cursor
 * sprite, then `Render_ComposeRegion` of the window rectangle). `mHeld` = M is still down (it is, right after the press).
 */
  open(assets: MiniMapAssets, scene: Surface16, mHeld = true): void {
    this.assets = assets;
    this.scaled = new Array(assets.frames.length).fill(null);
    this.snapshot = scene;
    this.canvas = createSurface(640, 480);
    blitCopy(scene, 0, 0, 640, 480, this.canvas, 0, 0);
    // window buffer: the scene under the rectangle, framed (Gui_DrawWindowFrame darkens it), MAP2.BM copied in at (3, 3)
    const win = createSurface(WINDOW_W, WINDOW_H);
    blitCopy(scene, MAP_X, MAP_Y, WINDOW_W, WINDOW_H, win, 0, 0);
    drawWindowFrame(win, WINDOW_W, WINDOW_H);
    blitCopy(assets.map as Surface16, 0, 0, assets.map.width, assets.map.height, win, IMAGE_INSET, IMAGE_INSET);
    blitCopy(win, 0, 0, WINDOW_W, WINDOW_H, this.canvas, MAP_X, MAP_Y);
    this.held = new Set(mHeld ? [DIK_MAP.M] : []);
    this.frame = 0;
    this.clock = 0;
    this.nextAt = 0;
    this.phase = mHeld ? "waitOpen" : "showing";
  }

  keyDown(code: number): void {
    this.held.add(code);
    // the original polls Input_IsKeyDown every 30 ms; a press seen here counts even if it is up again before the next tick
    if (this.phase === "showing" && (code === DIK_MAP.M || code === DIK_MAP.ESC)) this.close();
  }

  keyUp(code: number): void {
    this.held.delete(code);
    this.settle();
  }

  /** One host frame of `dtMs`: starts the marker loop after the release, advances the animation, notices a held closing key. */
  tick(dtMs: number): void {
    if (this.phase === "closed") return;
    this.settle();
    if (this.phase !== "showing") return;
    if (this.held.has(DIK_MAP.M) || this.held.has(DIK_MAP.ESC)) return this.close();
    this.clock += dtMs;
    while (this.phase === "showing" && this.clock >= this.nextAt) {
      this.drawMarker();
      this.nextAt += FRAME_MS;
    }
  }

  /** The picture to show: the window with the marker, or (after the close key) the scene alone. */
  draw(screen: Surface16): void {
    blitCopy(this.phase === "showing" || this.phase === "waitOpen" ? this.canvas : this.snapshot, 0, 0, 640, 480, screen, 0, 0);
  }

  /** Index of the marker frame drawn last (MARKER_FRAMES - 1 before the first one). */
  get markerFrame(): number {
    return (this.frame + MARKER_FRAMES - 1) % MARKER_FRAMES;
  }

  private settle(): void {
    if (this.phase === "waitOpen" && !this.held.has(DIK_MAP.M)) this.phase = "showing";
    else if (this.phase === "waitClose" && !this.held.has(DIK_MAP.M)) {
      this.phase = "closed";
      this.host.onExit();
    }
  }

  private close(): void {
    this.phase = "waitClose";
    this.settle();
  }

  /** scale the frame (Cursor_BoxScale, step 65535/0.63) and copy it (no colour key) to the screen. */
  private drawMarker(): void {
    const a = this.assets;
    if (!a || a.set === null) return;
    const i = this.frame;
    const img = (this.scaled[i] ??= zoomImage(a.frames[i], MARKER_SCALE));
    this.frame = (this.frame + 1) % MARKER_FRAMES;
    if (!img) return;
    const m = MARKER_SETS[a.set];
    blitCopy(img as Surface16, 0, 0, img.width, img.height, this.canvas, m.x, m.y);
  }
}
