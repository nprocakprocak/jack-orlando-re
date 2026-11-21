import { describe, expect, it } from "vitest";
import { clientToScreen, domButtonToMask, Mouse, MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT } from "./mouse";

describe("clientToScreen", () => {
  it("identity for an unscaled canvas at the origin", () => {
    expect(clientToScreen(10, 20, { left: 0, top: 0, width: 640, height: 480 })).toEqual({ x: 10, y: 20 });
  });

  it("subtracts the canvas position and undoes CSS scaling", () => {
    const rect = { left: 100, top: 50, width: 1280, height: 960 };
    expect(clientToScreen(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToScreen(101, 51, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToScreen(102, 52, rect)).toEqual({ x: 1, y: 1 });
    expect(clientToScreen(100 + 1279, 50 + 959, rect)).toEqual({ x: 639, y: 479 });
  });

  it("non-uniform and fractional scaling", () => {
    const rect = { left: 0.5, top: 0, width: 800, height: 480 };
    expect(clientToScreen(400.5, 240, rect)).toEqual({ x: 320, y: 240 });
  });

  it("clamps positions outside the canvas", () => {
    const rect = { left: 10, top: 10, width: 640, height: 480 };
    expect(clientToScreen(0, 0, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToScreen(10 + 640, 10 + 480, rect)).toEqual({ x: 639, y: 479 });
    expect(clientToScreen(5000, -5000, rect)).toEqual({ x: 639, y: 0 });
  });

  it("degenerate rect does not divide by zero", () => {
    expect(clientToScreen(3, 4, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 3, y: 4 });
  });

  it("custom logical size", () => {
    expect(clientToScreen(512, 240, { left: 0, top: 0, width: 1024, height: 480 }, 1024, 480)).toEqual({ x: 512, y: 240 });
  });
});

describe("Mouse", () => {
  it("adds the scroll offset at move time (WM_MOUSEMOVE)", () => {
    const m = new Mouse();
    m.setScroll(200, 0);
    m.move(100, 50);
    expect([m.x, m.y, m.screenX, m.screenY]).toEqual([300, 50, 100, 50]);
    // scrolling alone does not refresh g_mouseX, as in the original
    m.setScroll(250, 10);
    expect([m.x, m.y]).toEqual([300, 50]);
    m.move(100, 50);
    expect([m.x, m.y]).toEqual([350, 60]);
  });

  it("button mask: bit0 L, bit1 R, bit2 M", () => {
    const m = new Mouse();
    m.buttonDown(MOUSE_LEFT);
    m.buttonDown(MOUSE_MIDDLE);
    expect(m.buttons).toBe(5);
    expect(m.isDown(MOUSE_RIGHT)).toBe(false);
    m.buttonUp(MOUSE_LEFT);
    expect(m.buttons).toBe(4);
    m.buttonDown(MOUSE_RIGHT);
    m.buttonUp(MOUSE_MIDDLE);
    expect(m.buttons).toBe(2);
    m.buttonDown(0); // unknown DOM button
    expect(m.buttons).toBe(2);
  });

  it("reacquire clears buttons", () => {
    const m = new Mouse();
    m.buttonDown(MOUSE_LEFT);
    m.setAcquired(false);
    expect(m.buttons).toBe(1);
    m.setAcquired(true);
    expect(m.buttons).toBe(0);
  });

  it("DOM button numbers", () => {
    expect([0, 1, 2, 3].map(domButtonToMask)).toEqual([MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT, 0]);
  });
});
