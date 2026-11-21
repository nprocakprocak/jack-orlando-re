// The face window as the game composes it (Face_Show, Talk_FaceStep, idle
// blink in Game_Run).
import { s16 } from "../formats/global";
import { blitScaled, createSurface, type Surface16 } from "../render/surface";
import type { Side, FaceView } from "./controller";

/** 0x84: the window sprite is 132x132; the face and its overlays sit inside a 2-px frame. */
export const FACE_WINDOW = 0x84;
/** Window position: scrollX + 2 (left) / scrollX + 0x1fa (right), y = 2. */
export const faceWindowX = (side: Side, scrollX: number) => scrollX + (side === "L" ? 2 : 0x1fa);
export const FACE_WINDOW_Y = 2;

const EDGE = 0x82; // FACE_WINDOW - 2: the inner right / bottom edge

/** Where an overlay frame of width `w` at .FCC position (x, y) is drawn inside the window. */
export function overlayPos(pos: [number, number], w: number, mirrored: boolean): [number, number] {
  return [s16(mirrored ? EDGE - w - pos[0] : pos[0] + 2), s16(pos[1] + 2)];
}

/**
 * The 132x132 window of `view` (pixels inside the frame; 0 = not drawn, the frame and what is
 * behind it are the renderer's). Blit_Pal8Keyed with step +-1: the face is anchored at the
 * inner bottom-right corner (0x82 - w, 0x82 - h); a mirrored overlay is flipped and placed at
 * 0x82 - w - x. Every frame of a set is drawn with the size of its first frame (the game reads
 * the PBM header of frame 0 only).
 */
export function composeFace(view: FaceView, image: (file: string) => Surface16): Surface16 {
  const out = createSurface(FACE_WINDOW, FACE_WINDOW);
  const step = { int: view.mirrored ? -1 : 1, frac: 0 };
  const face = image(view.face.face);
  blitScaled(face, step, 0, 0, face.width, face.height, out, s16(EDGE - face.width), s16(EDGE - face.height));
  const overlay = (files: string[], frame: number, pos: [number, number]) => {
    const { width: w, height: h } = image(files[0]);
    const [x, y] = overlayPos(pos, w, view.mirrored);
    blitScaled(image(files[frame]), step, 0, 0, w, h, out, x, y);
  };
  if (view.mouth !== null) overlay(view.face.mouth, view.mouth, view.face.mouthPos);
  for (const e of view.eyes) overlay(view.face.eyes, e, view.face.eyesPos);
  return out;
}
