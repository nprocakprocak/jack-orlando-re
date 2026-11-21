import { describe, expect, it } from "vitest";
import type { Image16 } from "../formats/bm";
import { Cursor, motionFrame, type CursorDraw, type ImageSize } from "./cursor";
import {
  allCursorFiles,
  busyName,
  frameName,
  hotspotInImage,
  hotspotOffset,
  imageOrigin,
  isVerbMode,
  isZoneMode,
  lensHotName,
  lensMaskFiles,
  verbName,
} from "./modes";
import { drawCursor, lensMaskName } from "./overlay";

const sizes: ImageSize = (name) => (name === "" ? null : { w: 30, h: 20 });

function stepFrames(c: Cursor, n: number, mouseX = 100): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    c.animate(mouseX);
    out.push(c.animFrame);
  }
  return out;
}

describe("modes", () => {
  it("zone modes are 10..19 only", () => {
    expect([9, 10, 15, 19, 20].map(isZoneMode)).toEqual([false, true, true, true, false]);
  });

  it("verb modes are 0..4 and have the verb names of the original", () => {
    expect([0, 4, 5, -1].map(isVerbMode)).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3, 4, 5, 12].map(verbName)).toEqual([
      "POKAZANIE",
      "PATRZENIE",
      "UDERZENIE",
      "STRZELANIE",
      "BRANIE",
      "POKAZANIE",
      "POKAZANIE",
    ]);
  });

  it("hotspot offsets per mode", () => {
    expect(hotspotOffset(0)).toEqual({ dx: -9, dy: -12 });
    expect(hotspotOffset(1)).toEqual({ dx: -4, dy: -4 });
    expect(hotspotOffset(2)).toEqual({ dx: -7, dy: -10 });
    expect(hotspotOffset(3)).toEqual({ dx: 0, dy: 0 });
    expect(hotspotOffset(4)).toEqual({ dx: -10, dy: 8 });
    expect(hotspotOffset(4, true)).toEqual({ dx: -9, dy: -12 });
    expect(hotspotOffset(5)).toEqual({ dx: 0, dy: 0 });
    expect(hotspotOffset(10)).toEqual({ dx: -9, dy: -12 });
    expect(hotspotOffset(19)).toEqual({ dx: -9, dy: -12 });
    expect(hotspotOffset(20)).toEqual({ dx: 0, dy: 0 });
    expect(hotspotOffset(20, true)).toEqual({ dx: -9, dy: -12 });
  });

  it("the pointing hand's hotspot is the top-left corner of its image (WSK, 18x25)", () => {
    expect(hotspotInImage(0, 18, 25)).toEqual({ x: 0, y: 0 });
    // crosshair KOLT 28x45: the centre
    expect(hotspotInImage(3, 28, 45)).toEqual({ x: 14, y: 22 });
  });

  it("the image is centred on the mouse with integer halves", () => {
    expect(imageOrigin(100, 100, 18, 25)).toEqual({ x: 91, y: 88 });
    expect(imageOrigin(0, 0, 3, 3)).toEqual({ x: -1, y: -1 });
  });

  it("frame names follow Res_MakeNumberedName", () => {
    expect(frameName(0, 0)).toBe("WSK00.BM");
    expect(frameName(0, 8)).toBe("WSK08.BM");
    expect(frameName(1, 0)).toBe("LUPA01.BM");
    expect(frameName(2, 9)).toBe("FIS09.BM");
    expect(frameName(3, 3)).toBe("KOLT04.BM");
    expect(frameName(4, 9)).toBe("HAN10.BM");
    expect(frameName(10, 0)).toBe("LEFT001.BM");
    expect(frameName(11, 14)).toBe("RIGHT15.BM");
    expect(frameName(13, 0)).toBe("STDN0001.BM");
    expect(frameName(14, 0)).toBe("TOIN0001.BM");
    expect(frameName(15, 14)).toBe("STUP0015.BM");
    expect(frameName(17, 0)).toBe("TOUT0001.BM");
    expect(frameName(20, 0)).toBe("SCLF0001.BM");
    expect(frameName(21, 0)).toBe("SCRG0001.BM");
    expect(frameName(12, 0)).toBe("");
    expect(lensHotName(9)).toBe("BLIR00.BM");
    expect(lensHotName(13)).toBe("BLIR04.BM");
    expect(busyName(10)).toBe("CD00.BM");
    expect(busyName(9)).toBe("CD18.BM");
  });

  it("allCursorFiles lists 9+9+10+4+10+8*15+5+10 = 177 names, no empty", () => {
    const all = allCursorFiles();
    expect(all).toHaveLength(9 + 9 + 10 + 4 + 10 + 8 * 15 + 5 + 10);
    expect(all.every((n) => n.endsWith(".BM"))).toBe(true);
  });
});

describe("motionFrame", () => {
  it("leans right/left with the mouse and returns to the middle when still", () => {
    expect(motionFrame(4, 110, 100)).toBe(5);
    expect(motionFrame(8, 110, 100)).toBe(8);
    expect(motionFrame(4, 90, 100)).toBe(3);
    expect(motionFrame(0, 90, 100)).toBe(0);
    expect(motionFrame(7, 100, 100)).toBe(6);
    expect(motionFrame(1, 100, 100)).toBe(2);
    expect(motionFrame(4, 100, 100)).toBe(4);
  });
});

describe("Cursor.animate", () => {
  it("zone modes ping-pong 0..14 (past 13 the frame is 14, below 1 it is 0)", () => {
    const c = new Cursor(sizes);
    c.mode = 10;
    const seq = stepFrames(c, 30);
    expect(seq.slice(0, 16)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 13, 12]);
    expect(seq.slice(14, 30)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);
    expect(c.image).toBe("LEFT003.BM");
  });

  it("each zone mode picks its own set; modes without a set keep the image", () => {
    for (const [m, name] of [
      [11, "RIGHT02.BM"],
      [13, "STDN0002.BM"],
      [14, "TOIN0002.BM"],
      [15, "STUP0002.BM"],
      [17, "TOUT0002.BM"],
      [20, "SCLF0002.BM"],
      [21, "SCRG0002.BM"],
    ] as const) {
      const c = new Cursor(sizes);
      c.mode = m;
      c.animate(0);
      expect(c.image).toBe(name);
    }
    const c = new Cursor(sizes);
    c.mode = 12;
    c.image = "X.BM";
    c.animate(0);
    expect(c.image).toBe("X.BM");
  });

  it("mode 0 over nothing follows the mouse movement", () => {
    const c = new Cursor(sizes);
    c.prevMouseX = 100;
    c.animate(110);
    expect(c.image).toBe("WSK05.BM");
    c.animate(110);
    expect(c.image).toBe("WSK04.BM");
  });

  it("mode 0 over a reaction pulses 0..8 independent of the mouse", () => {
    const c = new Cursor(sizes);
    c.setTargets(true);
    c.motion = 6;
    const names: string[] = [];
    for (let i = 0; i < 6; i++) {
      c.animate(0);
      names.push(c.image);
    }
    expect(names).toEqual(["WSK07.BM", "WSK08.BM", "WSK07.BM", "WSK06.BM", "WSK05.BM", "WSK04.BM"]);
  });

  it("mode 2 rests on frame 4 off targets but runs on targets (advances 3 of 4 calls)", () => {
    const c = new Cursor(sizes);
    c.mode = 2;
    c.animFrame = 4;
    c.animate(0);
    expect(c.image).toBe("FIS04.BM");
    c.setTargets(true);
    const seq = stepFrames(c, 4);
    expect(seq).toEqual([5, 6, 7, 7]);
    // leaving the target: runs on until it passes frame 4 on the way down
    c.setTargets(false);
    c.animFrame = 9;
    c.animDir = 1;
    stepFrames(c, 40);
    expect(c.animFrame).toBe(4);
  });

  it("mode 3 rests on 0 and bounces 0..3, 9 of 10 calls advance", () => {
    const c = new Cursor(sizes);
    c.mode = 3;
    c.animate(0);
    expect(c.animFrame).toBe(0);
    c.setTargets(true);
    expect(stepFrames(c, 6)).toEqual([1, 2, 3, 2, 1, 0]);
    expect(c.image).toBe("KOLT01.BM");
  });

  it("mode 4 rests on 0, bounces up to 9, and keeps moving when takeKeepsMoving", () => {
    const c = new Cursor(sizes);
    c.mode = 4;
    c.animate(0);
    expect(c.image).toBe("HAN01.BM");
    expect(c.animFrame).toBe(0);
    c.takeKeepsMoving = true;
    stepFrames(c, 8);
    expect(c.animFrame).toBeGreaterThan(0);
    c.takeKeepsMoving = false;
    c.setTargets(true);
    c.animFrame = 8;
    c.animDir = 1;
    const seq = stepFrames(c, 4);
    expect(seq).toContain(9);
  });

  it("mode 1 shows the BLIR frames 9..13 over a reaction and LUPA by motion otherwise", () => {
    const c = new Cursor(sizes);
    c.mode = 1;
    c.prevMouseX = 100;
    c.animate(100);
    expect(c.image).toBe("LUPA05.BM");
    c.setTargets(true);
    const names = new Set<string>();
    for (let i = 0; i < 40; i++) {
      c.animate(0);
      names.add(c.image);
    }
    expect([...names].sort()).toEqual(["BLIR00.BM", "BLIR01.BM", "BLIR02.BM", "BLIR03.BM", "BLIR04.BM"]);
  });

  it("mode 5 shows the held item; busy shows the clock", () => {
    const c = new Cursor(sizes);
    c.mode = 5;
    c.animate(0);
    expect(c.image).toBe("item");
    c.busy = true;
    c.animate(0);
    expect(c.image).toBe("CD02.BM");
    c.animate(0);
    expect(c.image).toBe("CD04.BM");
  });
});

describe("Cursor.setTargets / clickPoint", () => {
  it("idle depends on the mode kind", () => {
    const c = new Cursor(sizes);
    c.setTargets(true);
    expect(c.idle).toBe(false);
    c.mode = 10;
    c.setTargets(true);
    expect(c.idle).toBe(true);
    c.mode = 5;
    c.setTargets(false, true);
    expect(c.idle).toBe(false);
    c.setTargets(true, false);
    expect(c.idle).toBe(true);
  });

  it("clickPoint adds the per-mode offset to the mouse", () => {
    const c = new Cursor(sizes);
    expect(c.clickPoint(100, 100)).toEqual({ x: 91, y: 88 });
    c.mode = 3;
    expect(c.clickPoint(100, 100)).toEqual({ x: 100, y: 100 });
    c.reset();
    expect(c.mode).toBe(0);
    expect(c.verb).toBe("POKAZANIE");
  });
});

describe("Cursor.present", () => {
  it("draws centred on the mouse, nothing before the first image", () => {
    const c = new Cursor(sizes);
    expect(c.present(100, 100)).toBeNull();
    c.prevMouseX = 100;
    c.animate(100);
    const d = c.present(100, 100) as CursorDraw;
    expect(d).toMatchObject({ image: "WSK04.BM", x: 85, y: 90, w: 30, h: 20, scale: 1 });
  });

  it("is hidden outside the window or when suspended", () => {
    const c = new Cursor(sizes);
    c.animate(100);
    c.inWindow = false;
    expect(c.present(100, 100)).toBeNull();
    c.inWindow = true;
    c.suspended = true;
    expect(c.present(100, 100)).toBeNull();
    c.suspended = false;
    expect(c.present(100, 100)).not.toBeNull();
  });

  it("a mode change shrinks the old image to <0.25, grows the new one back, then ends", () => {
    const c = new Cursor(sizes);
    c.prevMouseX = 100;
    c.animate(100);
    c.present(100, 100);
    c.mode = 2;
    c.animFrame = 4;
    c.animate(100);
    const first = c.present(100, 100) as CursorDraw;
    expect(first.image).toBe("WSK04.BM");
    expect(first.scale).toBeCloseTo(0.92, 5);
    const scales = [first.scale];
    const images = [first.image];
    for (let i = 0; i < 40; i++) {
      const d = c.present(100, 100);
      if (!d) break;
      scales.push(d.scale);
      images.push(d.image);
    }
    expect(Math.min(...scales)).toBeLessThan(0.25);
    expect(Math.min(...scales)).toBeGreaterThan(0.1);
    const turn = scales.indexOf(Math.min(...scales));
    expect(images[turn - 1]).toBe("WSK04.BM");
    expect(images[turn + 1]).toBe("FIS04.BM");
    expect(images[images.length - 1]).toBe("FIS04.BM");
    expect(c.isSwitching).toBe(false);
    // normal drawing afterwards
    const d = c.present(100, 100) as CursorDraw;
    expect(d.image).toBe("FIS04.BM");
    expect(d.scale).toBe(1);
  });

  it("picking up an item grows it from 0.2 in steps of 0.1", () => {
    const c = new Cursor(sizes);
    c.mode = 5;
    c.animate(0);
    c.present(0, 0);
    c.startSwitch(0.2, 0.1);
    const scales: number[] = [];
    for (let i = 0; i < 12; i++) {
      const d = c.present(50, 50);
      if (!d) break;
      scales.push(d.scale);
    }
    expect(scales[0]).toBeCloseTo(0.3, 5);
    expect(scales).toHaveLength(7);
    expect(scales[scales.length - 1]).toBeCloseTo(0.9, 5);
  });

  it("scaled draws truncate the size and skip zero-width images", () => {
    const c = new Cursor((n) => (n === "WSK04.BM" ? { w: 3, h: 3 } : null));
    c.prevMouseX = 100;
    c.animate(100);
    c.present(10, 10);
    c.mode = 3;
    c.animate(0);
    for (let i = 0; i < 12; i++) {
      const d = c.present(10, 10);
      if (d) expect(d.w).toBe(Math.trunc(3 * d.scale));
    }
  });
});

describe("drawCursor", () => {
  const img = (w: number, h: number, px: number[]): Image16 => ({
    width: w,
    height: h,
    kind: "rgb565",
    pixels: Uint16Array.from(px),
  });
  const screen = () => new Uint8ClampedArray(640 * 480 * 4);

  it("keys colour 0 and writes opaque pixels", () => {
    const out = screen();
    drawCursor(out, img(2, 1, [0, 0xf800]), { image: "x", x: 10, y: 5, w: 2, h: 1, scale: 1 });
    const o = (5 * 640 + 10) * 4;
    expect(out[o + 3]).toBe(0);
    expect([...out.slice(o + 4, o + 8)]).toEqual([255, 0, 0, 255]);
  });

  it("subtracts the scroll and clips at every screen edge", () => {
    const out = screen();
    const px = new Array(16).fill(0xffff);
    drawCursor(out, img(4, 4, px), { image: "x", x: 402, y: 478, w: 4, h: 4, scale: 1 }, 400, 0);
    expect(out[(478 * 640 + 2) * 4 + 3]).toBe(255);
    expect(out[(479 * 640 + 5) * 4 + 3]).toBe(255);
    drawCursor(out, img(4, 4, px), { image: "x", x: -2, y: -2, w: 4, h: 4, scale: 1 });
    expect(out[(0 * 640 + 1) * 4 + 3]).toBe(255);
    expect(out[(1 * 640 + 2) * 4 + 3]).toBe(0);
    drawCursor(out, img(4, 4, px), { image: "x", x: 638, y: 100, w: 4, h: 4, scale: 1 });
    expect(out[(100 * 640 + 639) * 4 + 3]).toBe(255);
  });

  it("scales with the box filter of the original (see overlay.test.ts)", () => {
    const out = screen();
    drawCursor(out, img(2, 2, [0xf800, 0xf800, 0xf800, 0xf800]), {
      image: "x",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      scale: 0.5,
    });
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });
});

describe("lensMaskFiles", () => {
  it("lists MASKA01..09 and M00..M04, one for every lens image", () => {
    const names = lensMaskFiles();
    expect(names).toHaveLength(14);
    for (let i = 1; i <= 9; i++) expect(names).toContain(lensMaskName(`LUPA0${i}.BM`));
    for (let i = 0; i <= 4; i++) expect(names).toContain(lensMaskName(lensHotName(9 + i)));
  });
});

describe("no empty frame while the item cursor is not drawn", () => {
  it("item in hand, click on a zone with a macro: the frame hides while the player is locked and returns with the item", () => {
    const c = new Cursor(() => ({ w: 20, h: 20 }));
    c.mode = 5;
    for (let i = 0; i < 60 && (i === 0 || c.isSwitching); i++) c.present(100, 80);
    c.setTargets(true, true); // over the zone: g_cursorIdle = 0
    expect(c.frameIdle).toBe(false); // render 1: item drawn + frame
    c.present(100, 80);
    expect(c.frameIdle).toBe(false);
    // the click starts <item>-<zone>: the player is locked, the game skips present() in the next renders
    expect(c.frameIdle).toBe(true);
    expect(c.frameIdle).toBe(true);
    // macro over, cursor drawn again
    c.present(100, 80);
    expect(c.frameIdle).toBe(false);
  });

  it("the item consumed / back in the coat (mode changes) keeps the frame hidden until the new image is presented", () => {
    const c = new Cursor(() => ({ w: 20, h: 20 }));
    c.mode = 5;
    for (let i = 0; i < 60 && (i === 0 || c.isSwitching); i++) c.present(100, 80);
    c.setTargets(true, true);
    c.present(100, 80);
    c.mode = 0;
    expect(c.frameIdle).toBe(true);
  });
});
