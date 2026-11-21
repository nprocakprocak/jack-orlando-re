import { describe, expect, it } from "vitest";
import { darkenPixel, darkenRect, formulaTables, LEVELS, setDarkenTables } from "./darken";
import { centerOffset, drawButtonFrame, drawText, drawTextShadowed, drawWindowFrame } from "./draw";
import { blockFont, fakeAssets, flat } from "./fixtures";
import { createSurface } from "../render/surface";
import { GuiWindow, HAND_TIP, sliderThumbX, sliderValue, type GuiEvent } from "./window";

setDarkenTables(formulaTables());
const WHITE = 0xffff;
const px = (s: { pixels: Uint16Array; width: number }, x: number, y: number) => s.pixels[y * s.width + x];

describe("darkening", () => {
  it("level 0 keeps the pixel", () => {
    expect(darkenPixel(WHITE, 0)).toBe(WHITE);
    expect(darkenPixel(0x07e1, 0)).toBe(0x07e1);
    expect(darkenPixel(0xf801, 0)).toBe(0xf801);
    expect(darkenPixel(0x0000, 0)).toBe(0x0001); // B never 0: the key color cannot come out of the tables
  });
  it("level 16 halves each channel", () => {
    expect(darkenPixel(WHITE, 16)).toBe((15 << 11) | (31 << 5) | 15);
  });
  it("level 32 leaves only the minimal blue, so the result is never the color key", () => {
    expect(darkenPixel(WHITE, 32)).toBe(1);
    expect(darkenPixel(0x0001, 32)).toBe(1);
    for (let l = 0; l < LEVELS; l++) expect(darkenPixel(0x0000, l)).not.toBe(0);
  });
  it("brightness falls monotonically with the level", () => {
    let prev = Infinity;
    for (let l = 0; l < LEVELS; l++) {
      const p = darkenPixel(WHITE, l);
      const sum = (p >> 11) + ((p >> 5) & 63) + (p & 31);
      expect(sum).toBeLessThanOrEqual(prev);
      prev = sum;
    }
  });
  it("darkenRect clips and keepKey skips color 0", () => {
    const s = createSurface(4, 2);
    s.pixels.set([WHITE, 0, WHITE, WHITE, WHITE, WHITE, WHITE, WHITE]);
    darkenRect(s, -2, 0, 4, 1, 16, true);
    expect(s.pixels[0]).toBe(darkenPixel(WHITE, 16));
    expect(s.pixels[1]).toBe(0);
    expect(s.pixels[2]).toBe(WHITE);
    expect(s.pixels[4]).toBe(WHITE); // second row untouched
  });
});

describe("window frame", () => {
  it("has light top/left rings, dark bottom/right rings, mid corners and a half-dark interior", () => {
    const s = flat(40, 30, WHITE);
    drawWindowFrame(s, 40, 30);
    expect(px(s, 0, 0)).toBe(darkenPixel(WHITE, 10));
    expect(px(s, 20, 0)).toBe(darkenPixel(WHITE, 10));
    expect(px(s, 0, 15)).toBe(darkenPixel(WHITE, 10));
    expect(px(s, 20, 29)).toBe(darkenPixel(WHITE, 22));
    expect(px(s, 39, 15)).toBe(darkenPixel(WHITE, 22));
    expect(px(s, 39, 0)).toBe(darkenPixel(WHITE, 16)); // top-right pixel
    expect(px(s, 0, 29)).toBe(darkenPixel(WHITE, 16)); // bottom-left pixel
    expect(px(s, 4, 4)).toBe(darkenPixel(WHITE, 10)); // inner ring
    expect(px(s, 5, 5)).toBe(darkenPixel(WHITE, 16)); // interior starts
    expect(px(s, 34, 24)).toBe(darkenPixel(WHITE, 16));
    expect(px(s, 35, 25)).toBe(darkenPixel(WHITE, 22)); // last ring
  });
});

describe("button frame", () => {
  it("raised: top/left untouched, bottom/right 13, interior 6", () => {
    const s = flat(30, 20, WHITE);
    drawButtonFrame(s, 0, 0, 30, 20, false);
    expect(px(s, 5, 0)).toBe(WHITE);
    expect(px(s, 0, 5)).toBe(WHITE);
    expect(px(s, 5, 19)).toBe(darkenPixel(WHITE, 13));
    expect(px(s, 29, 5)).toBe(darkenPixel(WHITE, 13));
    expect(px(s, 29, 0)).toBe(darkenPixel(WHITE, 6));
    expect(px(s, 4, 4)).toBe(darkenPixel(WHITE, 6));
  });
  it("pressed: thinner frame, top/left 3, interior 10", () => {
    const s = flat(30, 20, WHITE);
    drawButtonFrame(s, 0, 0, 30, 20, true);
    expect(px(s, 5, 0)).toBe(darkenPixel(WHITE, 3));
    expect(px(s, 5, 19)).toBe(darkenPixel(WHITE, 13));
    expect(px(s, 2, 2)).toBe(darkenPixel(WHITE, 10));
    expect(px(s, 1, 1)).toBe(darkenPixel(WHITE, 3));
  });
});

describe("text", () => {
  const font = blockFont();
  it("draws outline and fill colors and spacing", () => {
    const s = flat(20, 10, 0);
    drawText(s, font, Uint8Array.of(0x41, 0x41), 1, 1, 0x001f, 0xffff);
    expect(px(s, 1, 1)).toBe(0x001f);
    expect(px(s, 3, 3)).toBe(0xffff);
    expect(px(s, 7, 1)).toBe(0x001f); // second glyph at 5 + 1 spacing
  });
  it("shadow darkens the pixels under it (outline 10, fill 6) before the text", () => {
    const s = flat(20, 12, WHITE);
    drawTextShadowed(s, font, Uint8Array.of(0x41), 2, 2, 0x001f, 0xf800);
    expect(px(s, 7, 8)).toBe(darkenPixel(WHITE, 10)); // shadow outline, outside the glyph
    expect(px(s, 5, 5)).toBe(0xf800);
    expect(px(s, 2, 2)).toBe(0x001f);
  });
  it("shadow fill pixels use level 6", () => {
    const s = flat(20, 12, WHITE);
    drawText(s, font, Uint8Array.of(0x41), 3, 3, 0, 0, [10, 6]);
    expect(px(s, 5, 5)).toBe(darkenPixel(WHITE, 6));
    expect(px(s, 3, 3)).toBe(darkenPixel(WHITE, 10));
  });
  it("clips outside the surface", () => {
    const s = flat(4, 4, 0);
    expect(() => drawText(s, font, Uint8Array.of(0x41), -3, -3, 1, 2)).not.toThrow();
  });
});

describe("geometry helpers", () => {
  it("centerOffset", () => {
    expect(centerOffset(640, 440)).toBe(100);
    expect(centerOffset(480, 380)).toBe(50);
    expect(centerOffset(33, 24)).toBe(4);
    expect(centerOffset(10, 10)).toBe(0);
    expect(centerOffset(10, 30)).toBe(0);
  });
  it("slider thumb x and value", () => {
    expect(sliderThumbX(273, 0, 64)).toBe(296);
    expect(sliderThumbX(273, 64, 64)).toBe(466);
    expect(sliderThumbX(273, 35, 64)).toBe(273 + 23 + Math.trunc((35 * 170) / 64));
    expect(sliderThumbX(253, 1, 6)).toBe(253 + 23 + 28);
    expect(sliderValue(296, 296, 64)).toBe(0);
    expect(sliderValue(466, 296, 64)).toBe(64);
    expect(sliderValue(467, 296, 64)).toBe(64); // max + 1 stays at max
    expect(sliderValue(296 + 85, 296, 64)).toBe(32);
  });
});

function win(scene = flat(640, 480, WHITE)) {
  return new GuiWindow(fakeAssets(), scene, 0, 0, 300, 200, true);
}

describe("GuiWindow", () => {
  it("rounds odd widths up and centers", () => {
    const w = new GuiWindow(fakeAssets(), flat(640, 480, 0), 0, 0, 301, 200, true);
    expect([w.x, w.y, w.w, w.h]).toEqual([169, 140, 302, 200]);
    expect(new GuiWindow(fakeAssets(), flat(640, 480, 0), 5, 6, 100, 100, false).x).toBe(5);
  });

  it("button: release over it returns its name; leaving cancels", () => {
    const w = win();
    w.addButton("A", "A", 10, 10, 100, 30);
    const [x, y] = [w.x + 20, w.y + 20];
    expect(w.pointerDown(x, y)).toEqual([]);
    expect(w.pointerUp(x, y)).toEqual([{ kind: "press", name: "A" }]);
    w.pointerDown(x, y);
    w.pointerMove(x + 150, y);
    expect(w.pointerUp(x + 150, y)).toEqual([]);
    expect(w.pointerDown(w.x + 250, w.y + 150)).toEqual([]); // empty area
    expect(w.pointerUp(w.x + 250, w.y + 150)).toEqual([]);
  });

  it("button looks pressed only while the mouse is down and over it", () => {
    const w = win();
    w.addButton("A", "A", 10, 10, 100, 30);
    const raised = w.render().pixels.slice();
    w.pointerDown(w.x + 20, w.y + 20);
    const pressed = w.render().pixels.slice();
    expect(pressed).not.toEqual(raised);
    w.pointerMove(w.x + 250, w.y + 150);
    expect(w.render().pixels).toEqual(raised);
    w.pointerMove(w.x + 20, w.y + 20);
    expect(w.render().pixels).toEqual(pressed);
  });

  it("toggle flips on press and reports on release or when the mouse leaves", () => {
    const w = win();
    w.addToggle("T", 10, 10, 1, "Nie", "Tak");
    expect(w.getValue("T")).toBe(1);
    w.pointerDown(w.x + 20, w.y + 20);
    expect(w.getValue("T")).toBe(0);
    expect(w.pointerUp(w.x + 20, w.y + 20)).toEqual([{ kind: "press", name: "T", value: 0 }]);
    w.pointerDown(w.x + 20, w.y + 20);
    expect(w.pointerMove(w.x + 200, w.y + 20)).toEqual([{ kind: "press", name: "T", value: 1 }]);
    expect(w.pointerUp(w.x + 200, w.y + 20)).toEqual([]);
  });

  it("toggle looks different in the two states (Tak is pressed)", () => {
    const w = win();
    w.addToggle("T", 10, 10, 0, "Nie", "Tak");
    const off = w.render().pixels.slice();
    w.pointerDown(w.x + 20, w.y + 20);
    expect(w.render().pixels).not.toEqual(off);
  });

  it("slider: a press on the track centres the thumb under the mouse and starts a drag", () => {
    const w = win();
    w.addSlider("S", 20, 40, 64, 0);
    // the track is x 20..250; the thumb's band is y 32..61; 6 px of room above and below
    const ev = w.pointerDown(w.x + 20 + 23 + 85 + 7, w.y + 45);
    expect(ev).toEqual([{ kind: "slide", name: "S", value: 32, final: false }]);
    expect(w.thumbX("S")).toBe(43 + 85);
    expect(w.pointerMove(w.x + 20 + 23 + 170 + 7, w.y + 45)).toEqual([
      { kind: "slide", name: "S", value: 64, final: false },
    ]);
    expect(w.pointerUp(w.x + 20 + 23 + 170 + 7, w.y + 200)).toEqual([
      { kind: "slide", name: "S", value: 64, final: true },
    ]); // released below the track
  });

  it("slider: the grab zone is the track plus the margin, nothing outside it", () => {
    const w = win();
    w.addSlider("S", 20, 40, 64, 0);
    const x = w.x + 100;
    expect(w.hit(x, w.y + 32 - 6)).toBe(0);
    expect(w.hit(x, w.y + 32 + 29 + 5)).toBe(0);
    expect(w.hit(x, w.y + 32 - 7)).toBe(-1);
    expect(w.hit(x, w.y + 32 + 29 + 6)).toBe(-1);
    expect(w.hit(w.x + 19, w.y + 45)).toBe(-1);
    expect(w.hit(w.x + 20 + 230, w.y + 45)).toBe(-1);
    expect(w.pointerDown(x, w.y + 32 + 29 + 6)).toEqual([]); // outside: no drag
    expect(w.pointerMove(x + 20, w.y + 45)).toEqual([]);
  });

  it("slider: relative drag, value truncated, stops at the ends", () => {
    const w = win();
    w.addSlider("S", 20, 40, 64, 0);
    const sx = w.x + 43 + 5;
    const sy = w.y + 40 - 8 + 10;
    w.pointerDown(sx, sy);
    const ev = w.pointerMove(sx + 85, sy);
    expect(ev).toEqual([{ kind: "slide", name: "S", value: 32, final: false }]);
    expect(w.thumbX("S")).toBe(43 + 85);
    // the right end allows max + 1 (value stays 64), further moves are ignored
    w.pointerMove(sx + 171, sy);
    expect(w.getValue("S")).toBe(64);
    const before = w.thumbX("S");
    w.pointerMove(sx + 175, sy);
    expect(w.thumbX("S")).toBe(before);
    expect(w.pointerUp(sx + 175, sy)).toEqual([{ kind: "slide", name: "S", value: 64, final: true }]);
  });

  it("slider: leaving the old rectangle does not end the drag, only the release does (also outside the window)", () => {
    const w = win();
    w.addSlider("S", 20, 40, 64, 10);
    const sx = w.thumbX("S") + w.x + 3;
    const sy = w.y + 40;
    expect(w.pointerDown(sx, sy)).toEqual([]);
    // far below the track: the drag goes on, the thumb follows the mouse's x
    const ev = w.pointerMove(sx + 40, sy + 300);
    expect(ev).toEqual([
      {
        kind: "slide",
        name: "S",
        value: Math.trunc(((w.thumbX("S") - 43) / 170) * 64),
        final: false,
      },
    ]);
    expect(w.thumbX("S")).toBe(43 + Math.trunc((10 * 170) / 64) + 40);
    // far left beyond the track and the window (negative coordinates): clamped to 0
    expect(w.pointerMove(-500, sy)).toEqual([{ kind: "slide", name: "S", value: 0, final: false }]);
    expect(w.thumbX("S")).toBe(43);
    expect(w.pointerMove(-900, sy)).toEqual([]); // nothing changes at the end
    // beyond the right end: clamped to max, then the release outside the window
    w.pointerMove(5000, sy);
    expect(w.getValue("S")).toBe(64);
    expect(w.thumbX("S")).toBe(43 + 170);
    expect(w.pointerUp(9000, 9000)).toEqual([{ kind: "slide", name: "S", value: 64, final: true }]);
    expect(w.pointerMove(sx, sy)).toEqual([]); // no drag any more
  });

  it("slider: the value at the left end is 0 and the thumb does not go below it", () => {
    const w = win();
    w.addSlider("S", 20, 40, 6, 1);
    const sx = w.thumbX("S") + w.x + 2;
    const sy = w.y + 40;
    w.pointerDown(sx, sy);
    w.pointerMove(sx - 28, sy);
    expect(w.getValue("S")).toBe(0);
    const t = w.thumbX("S");
    w.pointerMove(sx - 40, sy);
    expect(w.thumbX("S")).toBe(t);
  });

  it("Enter presses button 1 and reports on release; Esc reports at once", () => {
    const w = win();
    w.addButton("First", "1", 10, 10, 100, 30);
    w.addButton("Second", "2", 10, 60, 100, 30);
    expect(w.keyDown("Enter")).toEqual([]);
    const events: GuiEvent[] = [...w.keyUp("Enter")];
    expect(events).toEqual([{ kind: "press", name: "First" }]);
    expect(w.keyUp("Enter")).toEqual([]);
    expect(w.keyDown("Escape")).toEqual([{ kind: "escape" }]);
    expect(w.keyDown("a")).toEqual([]);
  });

  it("Enter does nothing when button 1 is not a button", () => {
    const w = win();
    w.addSlider("S", 20, 40, 6, 1);
    expect(w.keyDown("Enter")).toEqual([]);
    expect(w.keyUp("Enter")).toEqual([]);
  });

  it("getValue / thumbX reject unknown names", () => {
    expect(() => win().getValue("nope")).toThrow();
    expect(() => win().thumbX("nope")).toThrow();
  });

  it("draw puts the darkened window over the scene and leaves the rest alone", () => {
    const w = win();
    const screen = flat(640, 480, WHITE);
    w.draw(screen);
    expect(px(screen, 0, 0)).toBe(WHITE);
    expect(px(screen, w.x + 100, w.y + 100)).toBe(darkenPixel(WHITE, 16));
    expect(px(screen, w.x, w.y)).toBe(darkenPixel(WHITE, 10));
  });
});

describe("GuiWindow hit under the tip of the hand", () => {
  // button A: window-relative x 10..109, y 10..39; the mouse passed in is the centre of the hand image, the tip is mouse + HAND_TIP
  const withTip = (f: () => void) => {
    GuiWindow.tipShift = HAND_TIP;
    try {
      f();
    } finally {
      GuiWindow.tipShift = { dx: 0, dy: 0 };
    }
  };
  const hitsAt = (w: GuiWindow, tipX: number, tipY: number) => {
    const [mx, my] = [tipX - HAND_TIP.dx, tipY - HAND_TIP.dy]; // the mouse that puts the tip at (tipX, tipY)
    w.pointerDown(mx, my);
    return w.pointerUp(mx, my).length === 1;
  };

  it("the tip one pixel inside the edge presses, one pixel outside does not (all four edges)", () => {
    withTip(() => {
      const w = win();
      w.addButton("A", "A", 10, 10, 100, 30);
      const [l, t, r, b] = [w.x + 10, w.y + 10, w.x + 109, w.y + 39];
      expect(hitsAt(w, l, t)).toBe(true);
      expect(hitsAt(w, r, b)).toBe(true);
      expect(hitsAt(w, l - 1, t + 5)).toBe(false);
      expect(hitsAt(w, l + 5, t - 1)).toBe(false);
      expect(hitsAt(w, r + 1, t + 5)).toBe(false);
      expect(hitsAt(w, l + 5, b + 1)).toBe(false);
    });
  });

  it("the report: tip above and right of the control, the hand centre inside it - does not react", () => {
    withTip(() => {
      const w = win();
      w.addButton("A", "A", 10, 10, 100, 30);
      // the hand centre at the control's top edge (y + 0), the tip 12 px above it
      const [mx, my] = [w.x + 100, w.y + 10];
      w.pointerDown(mx, my);
      expect(w.pointerUp(mx, my)).toEqual([]);
    });
  });

  it("without the shift (start screen, system cursor) the raw position is tested", () => {
    const w = win();
    w.addButton("A", "A", 10, 10, 100, 30);
    w.pointerDown(w.x + 10, w.y + 10);
    expect(w.pointerUp(w.x + 10, w.y + 10)).toEqual([{ kind: "press", name: "A" }]);
    expect(GuiWindow.tipShift).toEqual({ dx: 0, dy: 0 });
  });
});
