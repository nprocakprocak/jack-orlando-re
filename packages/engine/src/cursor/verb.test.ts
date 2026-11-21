import { describe, expect, it } from "vitest";
import { Cursor, type ImageSize } from "./cursor";
import { CursorEnable, enableDrawVerb, noHaveGunCursor } from "./verb";

const sizes: ImageSize = (name) => (name === "" ? null : { w: 30, h: 20 });

describe("Cursor_EnableDraw", () => {
  it("mode 0 makes the verb the pointer, other modes keep it", () => {
    expect(enableDrawVerb(0, 4)).toBe(0);
    expect(enableDrawVerb(0, 0)).toBe(0);
    expect([1, 2, 3, 4, 5, 17, 20].map((m) => enableDrawVerb(m, 4))).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });
});

describe("NOHAVEGUN (Script_ExecStep)", () => {
  it("only the gun cursor goes back to the pointer, with its verb", () => {
    expect(noHaveGunCursor({ mode: 3, verbMode: 3 })).toEqual({ mode: 0, verbMode: 0 });
    expect(noHaveGunCursor({ mode: 4, verbMode: 4 })).toEqual({ mode: 4, verbMode: 4 });
    // the scroll edge arrow over the gun verb: the verb stays (the old engine cleared it)
    expect(noHaveGunCursor({ mode: 21, verbMode: 3 })).toEqual({ mode: 21, verbMode: 3 });
    expect(noHaveGunCursor({ mode: 0, verbMode: 0 })).toEqual({ mode: 0, verbMode: 0 });
  });
});

describe("step 21 of Game_Run: g_cursorEnabled", () => {
  it("the first free frame enables the cursor once", () => {
    const e = new CursorEnable();
    expect(e.step(false, false)).toBe(true);
    expect(e.step(false, false)).toBe(false);
  });

  it("a macro holding the player disables it, the unlock enables it again", () => {
    const e = new CursorEnable();
    e.step(false, false);
    expect(e.step(true, false)).toBe(false);
    expect(e.enabled).toBe(false);
    expect(e.step(true, false)).toBe(false);
    expect(e.step(false, false)).toBe(true);
  });

  it("the answer menu keeps it on while a macro holds the player", () => {
    const e = new CursorEnable();
    e.step(false, false);
    expect(e.step(true, true)).toBe(false);
    expect(e.enabled).toBe(true);
    expect(e.step(false, false)).toBe(false);
  });

  it("the scene end disables it", () => {
    const e = new CursorEnable();
    e.step(false, false);
    e.sceneEnd();
    expect(e.enabled).toBe(false);
    expect(e.step(true, false)).toBe(false);
    expect(e.step(false, false)).toBe(true);
  });
});

describe("Cursor.sceneStart (Game_Run l. 440)", () => {
  it("the pointer verb resets the mode", () => {
    const c = new Cursor(sizes);
    c.mode = 17;
    c.sceneStart(0);
    expect(c.mode).toBe(0);
  });

  it("another verb keeps the mode (the hand after the uniform)", () => {
    const c = new Cursor(sizes);
    c.mode = 4;
    c.sceneStart(4);
    expect(c.mode).toBe(4);
    expect(c.verb).toBe("BRANIE");
  });

  it("resets g_cursorModePrev with the mode: no switch zoom at the new scene", () => {
    const settled = (): Cursor => {
      const c = new Cursor(sizes);
      c.mode = 17;
      c.animate(100);
      for (let i = 0; i < 40; i++) c.present(100, 100);
      expect(c.isSwitching).toBe(false);
      return c;
    };
    const c = settled();
    c.sceneStart(0);
    c.present(100, 100);
    expect(c.isSwitching).toBe(false);
    // Cursor_ResetMode alone leaves g_cursorModePrev: the zoom runs
    const r = settled();
    r.reset();
    r.present(100, 100);
    expect(r.isSwitching).toBe(true);
  });
});
