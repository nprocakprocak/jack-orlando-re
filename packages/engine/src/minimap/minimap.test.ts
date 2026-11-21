import { describe, expect, it } from "vitest";
import type { Image16 } from "../formats/bm";
import { mapAvailableIn } from "../keys/keymap";
import { createSurface, type Surface16 } from "../render/surface";
import {
  DIK_MAP, FRAME_MS, IMAGE_H, IMAGE_W, MAP_X, MAP_Y, MARKER_FRAMES, MARKER_SETS, MiniMapScreen, markerFileName,
  markerSetFor, type MiniMapAssets,
} from "./index";

const img = (w: number, h: number, fill: (i: number) => number): Image16 => ({
  width: w, height: h, kind: "rgb565", pixels: Uint16Array.from({ length: w * h }, (_, i) => fill(i)),
});
const scene = (v = 0x4208): Surface16 => {
  const s = createSurface(640, 480);
  s.pixels.fill(v);
  return s;
};
/** 20 marker frames of 10x10 pixels; frame k is filled with the colour 0x0100 + k */
const assets = (set: number | null = 0): MiniMapAssets => ({
  map: img(IMAGE_W, IMAGE_H, () => 0x7bef),
  set,
  frames: set === null ? [] : Array.from({ length: MARKER_FRAMES }, (_, k) => img(10, 10, () => 0x0100 + k)),
});
const px = (s: Surface16, x: number, y: number) => s.pixels[y * s.width + x];
const shown = (m: MiniMapScreen): Surface16 => {
  const s = createSurface(640, 480);
  m.draw(s);
  return s;
};
function open(set: number | null = 0, mHeld = true) {
  let exits = 0;
  const m = new MiniMapScreen({ onExit: () => exits++ });
  m.open(assets(set), scene(), mHeld);
  return { m, exits: () => exits };
}

describe("tables", () => {
  it("marker set per chapter", () => {
    expect([1, 2, 3, 4, 0].map(markerSetFor)).toEqual([1, 2, 0, null, null]);
    expect(markerFileName(0, 5)).toBe("haf005.bm");
    expect(markerFileName(1, 19)).toBe("jack19.bm");
    expect(markerFileName(2, 0)).toBe("stad00.bm");
    expect(MARKER_SETS.map((m) => [m.x, m.y])).toEqual([[0x1b2, 100], [0x171, 0x105], [0xb6, 0xaf]]);
  });
  it("the map is open to the chapters the hook gets from keymap", () => {
    expect(mapAvailableIn(2, 40)).toBe(true);
    expect(mapAvailableIn(4, 100)).toBe(false);
    expect(mapAvailableIn(1, 6)).toBe(true); // list
  });
});

describe("MiniMapScreen", () => {
  it("draws the framed window with MAP2 over the scene, the rest of the scene untouched", () => {
    const { m } = open();
    const s = shown(m);
    expect(px(s, MAP_X + 3, MAP_Y + 3)).toBe(0x7bef); // MAP2 starts 3 px inside the window
    expect(px(s, MAP_X + 3 + IMAGE_W - 1, MAP_Y + 3 + IMAGE_H - 1)).toBe(0x7bef);
    expect(px(s, MAP_X + 1, MAP_Y + 40)).not.toBe(0x4208); // frame ring darkens the scene under it
    expect(px(s, MAP_X - 1, MAP_Y + 40)).toBe(0x4208);
    expect(px(s, 0, 0)).toBe(0x4208);
    expect(px(s, MAP_X + 0x26c, MAP_Y + 40)).toBe(0x4208);
  });

  it("waits for M to be released, then shows frame 0 at once and one frame per 30 ms (plain copy at the table position)", () => {
    const { m } = open(0);
    expect(m.phase).toBe("waitOpen");
    m.tick(1000);
    expect(px(shown(m), MARKER_SETS[0].x, MARKER_SETS[0].y)).toBe(0x7bef); // no marker yet
    m.keyUp(DIK_MAP.M);
    expect(m.phase).toBe("showing");
    m.tick(0);
    expect(px(shown(m), MARKER_SETS[0].x, MARKER_SETS[0].y)).toBe(0x0100);
    m.tick(FRAME_MS - 1);
    expect(px(shown(m), MARKER_SETS[0].x, MARKER_SETS[0].y)).toBe(0x0100);
    m.tick(1);
    expect(px(shown(m), MARKER_SETS[0].x, MARKER_SETS[0].y)).toBe(0x0101);
    m.tick(FRAME_MS * 19);
    expect(px(shown(m), MARKER_SETS[0].x, MARKER_SETS[0].y)).toBe(0x0100); // 20 frames, wraps
    expect(m.markerFrame).toBe(0);
  });

  it("scales the marker by 0.63 with Cursor_BoxScale (41x30 -> 25x18)", () => {
    const m = new MiniMapScreen({ onExit() {} });
    const a: MiniMapAssets = { map: img(IMAGE_W, IMAGE_H, () => 1), set: 0, frames: Array.from({ length: 20 }, () => img(41, 30, () => 0x0841)) };
    m.open(a, scene(), false);
    m.tick(0);
    const s = shown(m);
    const { x, y } = MARKER_SETS[0];
    expect(px(s, x + 24, y + 17)).toBe(0x0841);
    expect(px(s, x + 25, y)).toBe(1); // the map behind, size 25 wide
    expect(px(s, x, y + 18)).toBe(1);
  });

  it("without a marker set (chapter 4) only the map is shown", () => {
    const { m } = open(null, false);
    m.tick(500);
    expect(px(shown(m), 400, 200)).toBe(0x7bef);
  });

  for (const key of [DIK_MAP.M, DIK_MAP.ESC]) {
    it(`closes on key ${key}: the scene is redrawn at once, the exit waits for M to be up`, () => {
      const { m, exits } = open(0, false);
      m.tick(100);
      m.keyDown(key);
      expect(m.phase).toBe(key === DIK_MAP.M ? "waitClose" : "closed");
      expect(px(shown(m), 400, 200)).toBe(0x4208);
      if (key === DIK_MAP.M) {
        expect(exits()).toBe(0);
        m.tick(100);
        expect(m.isOpen).toBe(true);
        m.keyUp(DIK_MAP.M);
      }
      expect(m.isOpen).toBe(false);
      expect(exits()).toBe(1);
    });
  }

  it("a closing key already held when the loop starts closes it on the next tick; M held after Esc is waited out", () => {
    const { m, exits } = open(0, true);
    m.keyDown(DIK_MAP.ESC); // ignored while the opening M is down (the loop has not started)
    expect(m.phase).toBe("waitOpen");
    m.keyUp(DIK_MAP.M);
    m.tick(0);
    expect(m.phase).toBe("closed"); // Esc still down: closes, no M to wait for
    expect(exits()).toBe(1);
    m.tick(10);
    expect(exits()).toBe(1);
  });

  it("is inert when closed", () => {
    const m = new MiniMapScreen({ onExit() {} });
    m.tick(100);
    m.keyDown(DIK_MAP.M);
    expect(m.isOpen).toBe(false);
  });
});
