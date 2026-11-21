import { describe, expect, it } from "vitest";
import { type Face } from "../formats/dialog";
import type { Surface16 } from "../render/surface";
import { type FaceView } from "./controller";
import { composeFace, FACE_WINDOW, faceWindowX, overlayPos } from "./face";

const img = (width: number, height: number, f: (x: number, y: number) => number): Surface16 => ({
  width,
  height,
  pixels: Uint16Array.from({ length: width * height }, (_, i) => f(i % width, Math.floor(i / width))),
});
const at = (s: Surface16, x: number, y: number) => s.pixels[y * s.width + x];

// face 4x3, mouth frames 2x1 (frame 1 is 3x1: drawn 2 wide), eye frames 1x1 with a transparent one
const IMAGES: Record<string, Surface16> = {
  F: img(4, 3, (x, y) => 100 + y * 4 + x),
  M0: img(2, 1, (x) => 200 + x),
  M1: img(3, 1, (x) => 210 + x),
  E0: img(2, 1, (x) => 300 + x),
  E1: img(2, 1, (x) => (x === 0 ? 0 : 311)),
};
const face: Face = {
  name: "T",
  face: "F",
  eyesPos: [10, 20],
  eyes: ["E0", "E1", "E0"],
  mouthPos: [5, 6],
  mouth: ["M0", "M1", "M0", "M0", "M0"],
};
const view = (o: Partial<FaceView>): FaceView => ({
  slot: 2,
  face,
  source: "scene",
  mirrored: false,
  mouth: null,
  eyes: [],
  ...o,
});
const compose = (v: FaceView) => composeFace(v, (n) => IMAGES[n]);

describe("composeFace (synthetic)", () => {
  it("window position: scrollX + 2 / + 0x1fa", () => {
    expect(faceWindowX("L", 100)).toBe(102);
    expect(faceWindowX("R", 0)).toBe(0x1fa);
  });

  it("anchors the face at the inner bottom-right corner (0x82 - w, 0x82 - h)", () => {
    const s = compose(view({}));
    expect(s.width).toBe(FACE_WINDOW);
    expect(at(s, 126, 127)).toBe(100);
    expect(at(s, 129, 129)).toBe(111);
    expect(at(s, 125, 127)).toBe(0);
    expect(s.pixels.filter((p) => p).length).toBe(12);
  });

  it("mirrored: the face is flipped in the same place", () => {
    const s = compose(view({ mirrored: true }));
    expect(at(s, 126, 127)).toBe(103);
    expect(at(s, 129, 127)).toBe(100);
  });

  it("overlays sit at .FCC position + 2, unmirrored", () => {
    const s = compose(view({ mouth: 0, eyes: [0] }));
    expect([at(s, 7, 8), at(s, 8, 8), at(s, 9, 8)]).toEqual([200, 201, 0]);
    expect([at(s, 12, 22), at(s, 13, 22)]).toEqual([300, 301]);
  });

  it("mirrored overlays are flipped and placed at 0x82 - w - x", () => {
    expect(overlayPos([5, 6], 2, true)).toEqual([0x82 - 2 - 5, 8]);
    const s = compose(view({ mirrored: true, mouth: 0, eyes: [0] }));
    expect([at(s, 123, 8), at(s, 124, 8)]).toEqual([201, 200]);
    expect([at(s, 118, 22), at(s, 119, 22)]).toEqual([301, 300]);
    // window column X maps to 0x83 - X: the same as flipping the unmirrored window
    const u = compose(view({ mouth: 0, eyes: [0] }));
    expect(at(s, 0x83 - 7, 8)).toBe(at(u, 7, 8));
  });

  it("every frame is drawn with the size of frame 0", () => {
    const s = compose(view({ mouth: 1 }));
    expect([at(s, 7, 8), at(s, 8, 8), at(s, 9, 8)]).toEqual([210, 211, 0]);
    const m = compose(view({ mouth: 1, mirrored: true }));
    expect([at(m, 123, 8), at(m, 124, 8), at(m, 122, 8)]).toEqual([211, 210, 0]);
  });

  it("eye frames are keyed over each other in order; no mouth when none was drawn", () => {
    const s = compose(view({ eyes: [0, 1] }));
    expect([at(s, 12, 22), at(s, 13, 22)]).toEqual([300, 311]);
    expect(at(s, 7, 8)).toBe(0);
  });

  it("clips at the window edge; a negative x is drawn from 0 (Blit_Pal8Keyed clamps)", () => {
    const wide: Face = { ...face, mouthPos: [-5, 0] };
    const s = composeFace({ ...view({ mouth: 0 }), face: wide }, (n) => IMAGES[n]);
    expect([at(s, 0, 2), at(s, 1, 2)]).toEqual([200, 201]);
    const edge: Face = { ...face, mouthPos: [0x81, 0] }; // drawn at 0x83: one column fits
    expect(composeFace({ ...view({ mouth: 0 }), face: edge }, (n) => IMAGES[n]).pixels[2 * FACE_WINDOW + 0x83]).toBe(
      200,
    );
  });
});
