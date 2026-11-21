// Cursor logic of the original, separate from any canvas: the animation step (Cursor_AnimateStep),
// the per-present decision of what to draw and where (Cursor_DrawOnPresent),
// and the mode-switch zoom.
import { CursorMode, busyName, frameName, hotspotOffset, imageOrigin, isVerbMode, lensHotName, verbName } from "./modes";

/** What to draw on top of the presented frame. */
export interface CursorDraw {
  /** Image file name (see modes.ts), or "item" for the held item (mode 5). */
  image: string;
  /** Top-left in world coordinates (screen position + scroll). */
  x: number;
  y: number;
  /** Width/height after the switch zoom (equal to the image size when scale is 1). */
  w: number;
  h: number;
  /** 1 = unscaled; < 1 while the mode-switch animation runs. */
  scale: number;
}

/** Size lookup for the images; the demo gets it from the decoded .BM files. */
export type ImageSize = (image: string) => { w: number; h: number } | null;

const SWITCH_STEP = Math.fround(0.08);
const SWITCH_MIN = Math.fround(0.25);

/** g_cursorAnimPeriod (00504798): the countdown is reloaded with 2, so a step every 3rd logic tick. */
export const ANIM_PERIOD = 2;

/** Motion-driven frame of the pointing hand/magnifier: leans towards the mouse x movement (0..8). */
export function motionFrame(frame: number, mouseX: number, prevMouseX: number): number {
  if (prevMouseX < mouseX && frame < 8) frame++;
  if (mouseX < prevMouseX && frame > 0) frame--;
  if (mouseX === prevMouseX) {
    if (frame > 4) frame--;
    if (frame < 4) frame++;
  }
  return frame;
}

export class Cursor {
  /** g_cursorMode. */
  mode = 0;
  /** 006bc294 - never set by the shipped code. */
  hotspotFlag = false;
  /** Image of the current mode/frame ("" = none yet), g_cursorImage. */
  image = "";
  /** g_cursorAnimFrame (modes 2-4, 10-21), g_cursorAnimDir. */
  animFrame = 0;
  animDir = 1;
  /** g_cursorMotionFrame (modes 0 and 1, driven by mouse x movement). */
  motion = 4;
  prevMouseX = 0;
  /** g_cursorLensFrame, 9..13 (BLIR) while the magnifier is over a reaction. */
  lensFrame = 9;
  lensDir = 1;
  /** g_cursorAnimCounter. */
  counter = 0;
  /** g_cursorIdle: true = not over something that reacts; the animation of modes 1-4 rests. */
  idle = true;
  /** True while a scene loads: the cursor is the CDxx clock (g_sceneLoadingCursor). */
  busy = false;
  busyFrame = 0;
  /** Mouse inside the client area (g_mouseInWindow); false hides the cursor. */
  inWindow = true;
  /** 009c54a4 != 0 hides the cursor like leaving the window. */
  suspended = false;
  /** Extra states of mode 0 that make the hand follow the mouse (007c7a4c, 0051f919, 008f68d8). */
  followMouse = false;
  /** Mode 4 keeps animating at rest when 00563f20 != 0 && 008f68e0 == 0. */
  takeKeepsMoving = false;

  private switching = false;
  private presents = 0;
  private presentsSeen = 0;
  private scale = 1;
  private step = 0;
  private modeAtLastPresent = 0;
  private prevImage = "";
  private lastImage = "";

  constructor(private readonly sizeOf: ImageSize) {}

  get verb(): string {
    return verbName(this.mode);
  }

  /**
 * g_cursorIdle as Game_Run (l. 779) sees it for RAMKA: the original's Cursor_DrawOnPresent sets it to 1 at the first
 * present after a mode change and for the whole switch zoom; a mode set by the script (TAKE: mode 5) but not yet presented, or while the
 * cursor is not drawn (locked player), must not show the frame - the stale value would draw an empty frame before the item appears.
 */
  get frameIdle(): boolean {
    // no present() since the last read = the cursor was not drawn in this render (player locked by a macro after the click): no item image, so no frame
    const drawn = this.presents !== this.presentsSeen;
    this.presentsSeen = this.presents;
    return this.idle || this.switching || this.mode !== this.modeAtLastPresent || !drawn;
  }

  get isSwitching(): boolean {
    return this.switching;
  }

  /** g_clickX/g_clickY for a mouse position (Cursor_UpdateHotspot). */
  clickPoint(mouseX: number, mouseY: number): { x: number; y: number } {
    const { dx, dy } = hotspotOffset(this.mode, this.hotspotFlag);
    return { x: mouseX + dx, y: mouseY + dy };
  }

  /** Cursor_ResetMode. */
  reset(): void {
    this.mode = 0;
  }

  /**
 * Game_Run l. 440, at every scene start: `if (g_verbMode == 0) { g_cursorMode = 0; g_cursorModePrev = 0; }`. With another verb
 * picked in the menu (e.g. the take verb whose macro ends in GOTOSCENE, SC105 BRANIE-MUNDUR.PBM) the cursor keeps its mode.
 */
  sceneStart(verbMode: number): void {
    if (verbMode !== 0) return;
    this.mode = 0;
    this.modeAtLastPresent = 0;
  }

  /**
 * Result of the hit tests (Cursor_HitTestSprites/Areas): `overReaction` = a VERB-NAME macro
 * exists for the thing under the click point, `overObject` = any opaque sprite pixel is there.
 * Sets g_cursorIdle as Cursor_DrawOnPresent does.
 */
  setTargets(overReaction: boolean, overObject = overReaction): void {
    const hot = this.mode === 5 ? overObject : isVerbMode(this.mode) && overReaction;
    this.idle = !hot;
  }

  /** Size of the current cursor image (g_cursorImage), null while there is none. */
  imageSize(): { w: number; h: number } | null {
    const size = this.image ? this.sizeOf(this.image) : null;
    return size && size.w > 0 ? size : null;
  }

  /** Starts the zoom of a mode switch (also used for picking up an item: scale 0.2, step 0.1). */
  startSwitch(scale = 1, step = -SWITCH_STEP): void {
    this.switching = true;
    this.scale = Math.fround(scale);
    this.step = Math.fround(step);
  }

  /** Cursor_AnimateStep: one step, called every ANIM_PERIOD+1 logic ticks. */
  animate(mouseX: number): void {
    if (this.busy) {
      this.busyFrame++;
      this.image = busyName(this.busyFrame);
      return;
    }
    const m = this.mode;
    switch (m) {
      case CursorMode.Point:
        this.animatePoint(mouseX);
        break;
      case CursorMode.Look:
        this.animateLook(mouseX);
        break;
      case CursorMode.Hit:
        this.rest(this.animFrame === 4, 8, 9, (c) => (c & 3) !== 0);
        this.image = frameName(CursorMode.Hit, this.animFrame);
        break;
      case CursorMode.Shoot:
        this.rest(this.animFrame === 0, 2, 3, (c) => c % 10 !== 0);
        this.image = frameName(CursorMode.Shoot, this.animFrame);
        break;
      case CursorMode.Take:
        this.rest(this.animFrame === 0 && !this.takeKeepsMoving, 8, 9, (c) => (c & 3) !== 0);
        this.image = frameName(CursorMode.Take, this.animFrame);
        break;
      case CursorMode.Item:
        this.image = "item";
        break;
      case CursorMode.ZoneLeft: case CursorMode.ZoneRight: case CursorMode.ZoneDown: case CursorMode.ZoneIn:
      case CursorMode.ZoneUp: case CursorMode.ZoneOut: case CursorMode.ScrollLeft: case CursorMode.ScrollRight:
        this.zonePingPong();
        this.image = frameName(m, this.animFrame);
        break;
      default:
        // modes 12, 16, 18, 19 and others have no set: the image stays as it was
        break;
    }
  }

  /** Mode 0: the hand follows the mouse, or pulses 0..8 over a reaction. */
  private animatePoint(mouseX: number): void {
    if (this.idle || this.followMouse) {
      this.motion = motionFrame(this.motion, mouseX, this.prevMouseX);
      this.prevMouseX = mouseX;
    } else {
      // over a reaction: the hand pulses 0..8
      this.motion += this.animDir;
      if (this.motion > 7) {
        this.animDir = -1;
        this.motion = 8;
      }
      if (this.motion < 1) {
        this.animDir = 1;
        this.motion = 0;
      }
    }
    this.image = frameName(CursorMode.Point, this.motion % 9);
  }

  /** Mode 1: the magnifier pulses over a reaction, otherwise the lens follows the mouse. */
  private animateLook(mouseX: number): void {
    if (!this.idle) {
      this.counter++;
      if ((this.counter & 1) !== 0) this.lensFrame += this.lensDir;
      if (this.lensFrame > 13) {
        this.lensDir = -1;
        this.lensFrame = 13;
      }
      if (this.lensFrame < 9) {
        this.lensDir = 1;
        this.lensFrame = 9;
      }
      this.image = lensHotName(this.lensFrame);
    } else {
      this.motion = motionFrame(this.motion, mouseX, this.prevMouseX);
      this.prevMouseX = mouseX;
      this.image = frameName(CursorMode.Look, this.motion % 9);
    }
  }

  /** Modes 10-21 share one ping-pong of the frame 0..14. */
  private zonePingPong(): void {
    this.animFrame += this.animDir;
    if (this.animFrame > 13) {
      this.animDir = -1;
      this.animFrame = 14;
    }
    if (this.animFrame < 1) {
      this.animDir = 1;
      this.animFrame = 0;
    }
  }

  /**
 * Shared body of modes 2-4: when not over a reaction and on the rest frame the animation holds
 * (direction forced up), otherwise it advances on the calls `advance(counter)` accepts and
 * ping-pongs between 0 and `turn` (past `over` the frame is set to `turn` and the direction reverses).
 */
  private rest(atRest: boolean, over: number, turn: number, advance: (c: number) => boolean): void {
    if (this.idle && atRest) {
      this.animDir = 1;
      return;
    }
    this.counter++;
    if (advance(this.counter)) this.animFrame += this.animDir;
    if (this.animFrame > over) {
      this.animDir = -1;
      this.animFrame = turn;
    }
    if (this.animFrame < 1) {
      this.animDir = 1;
      this.animFrame = 0;
    }
  }

  /**
 * Cursor_DrawOnPresent: what to draw for this present, or null for nothing (outside the window,
 * paused, no image yet, or the last step of the switch animation).
 */
  present(mouseX: number, mouseY: number): CursorDraw | null {
    if (!this.inWindow || this.suspended) return null;
    this.presents++;
    if (this.mode !== this.modeAtLastPresent) {
      this.startSwitch();
      this.prevImage = this.lastImage;
    }
    let image = this.image;
    let scale = 1;
    if (this.switching) {
      this.idle = true;
      this.scale = Math.fround(this.scale + this.step);
      if (this.scale < SWITCH_MIN) this.step = SWITCH_STEP;
      if (this.step > 0) this.prevImage = this.image;
      if (this.scale >= 1) {
        this.switching = false;
        this.commit();
        return null;
      }
      image = this.prevImage;
      scale = this.scale;
    }
    this.commit();
    if (!image) return null;
    const size = this.sizeOf(image);
    if (!size || size.w === 0) return null;
    const w = scale === 1 ? size.w : Math.trunc(size.w * scale);
    const h = scale === 1 ? size.h : Math.trunc(size.h * scale);
    if (w === 0) return null;
    const { x, y } = imageOrigin(mouseX, mouseY, w, h);
    return { image, x, y, w, h, scale };
  }

  private commit(): void {
    this.lastImage = this.image;
    this.modeAtLastPresent = this.mode;
  }
}
