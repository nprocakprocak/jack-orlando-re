import { describe, expect, it } from "vitest";
import { CODE_TO_DIK, DIK, DIK_ANY_ALT, DIK_ANY_CTRL, DIK_ANY_SHIFT, Keyboard, keyChar } from "./keyboard";

const down = (dik: number, char = 0) => ({ dik, down: true, char });
const up = (dik: number) => ({ dik, down: false, char: 0 });

describe("Keyboard", () => {
  it("applies buffered events only on poll (Input_Poll every 40 ms)", () => {
    const kb = new Keyboard();
    kb.push(down(DIK.A, 0x61));
    expect(kb.isKeyDown(DIK.A)).toBe(false);
    expect(kb.poll()).toBe(1);
    expect(kb.isKeyDown(DIK.A)).toBe(true);
    expect(kb.keys[DIK.A]).toBe(0x80);
    expect(kb.lastKey).toBe(0x61);
    kb.push(up(DIK.A));
    kb.poll();
    expect(kb.isKeyDown(DIK.A)).toBe(false);
    expect(kb.lastKey).toBe(0); // a release clears the last key, as in
  });

  it("keyPressedOnce is true once per press", () => {
    const kb = new Keyboard();
    kb.push(down(DIK.F1));
    kb.poll();
    expect(kb.keyPressedOnce(DIK.F1)).toBe(true);
    expect(kb.keyPressedOnce(DIK.F1)).toBe(false);
    expect(kb.isKeyDown(DIK.F1)).toBe(true);
    // a second down without release (no autorepeat in DirectInput) does not re-arm
    kb.push(down(DIK.F1));
    kb.poll();
    expect(kb.keyPressedOnce(DIK.F1)).toBe(false);
    kb.push(up(DIK.F1));
    kb.push(down(DIK.F1));
    kb.poll();
    expect(kb.keyPressedOnce(DIK.F1)).toBe(true);
  });

  it("a tap shorter than one poll period is lost, as in the original", () => {
    const kb = new Keyboard();
    kb.push(down(DIK.SPACE, 0x20));
    kb.push(up(DIK.SPACE));
    kb.poll();
    expect(kb.isKeyDown(DIK.SPACE)).toBe(false);
    expect(kb.keyPressedOnce(DIK.SPACE)).toBe(false);
    expect(kb.lastKey).toBe(0);
  });

  it("pseudo codes 0xfa/0xfb/0xfc are Alt/Shift/Ctrl, either side", () => {
    const kb = new Keyboard();
    for (const [code, l, r] of [
      [DIK_ANY_ALT, DIK.LMENU, DIK.RMENU],
      [DIK_ANY_SHIFT, DIK.LSHIFT, DIK.RSHIFT],
      [DIK_ANY_CTRL, DIK.LCONTROL, DIK.RCONTROL],
    ]) {
      expect(kb.isKeyDown(code)).toBe(false);
      for (const side of [l, r]) {
        kb.push(down(side));
        kb.poll();
        expect(kb.isKeyDown(code)).toBe(true);
        kb.push(up(side));
        kb.poll();
        expect(kb.isKeyDown(code)).toBe(false);
      }
    }
  });

  it("drops events beyond the 16-entry buffer", () => {
    const kb = new Keyboard();
    for (let i = 0; i < 20; i++) kb.push(down(DIK.Q + (i % 10)));
    expect(kb.buffer).toHaveLength(16);
    expect(kb.overflowCount).toBe(4);
    expect(kb.poll()).toBe(16);
    expect(kb.buffer).toHaveLength(0);
  });

  it("buffer size is configurable", () => {
    const kb = new Keyboard(2);
    kb.push(down(DIK.A));
    kb.push(down(DIK.B));
    kb.push(down(DIK.C));
    kb.poll();
    expect(kb.isKeyDown(DIK.B)).toBe(true);
    expect(kb.isKeyDown(DIK.C)).toBe(false);
  });

  it("unacquired: ignores events and poll; reacquire clears g_keys but not the once table", () => {
    const kb = new Keyboard();
    kb.push(down(DIK.ESCAPE));
    kb.poll();
    kb.push(down(DIK.A));
    kb.setAcquired(false);
    expect(kb.buffer).toHaveLength(0);
    kb.push(down(DIK.B));
    expect(kb.poll()).toBe(0);
    expect(kb.isKeyDown(DIK.B)).toBe(false);
    expect(kb.isKeyDown(DIK.ESCAPE)).toBe(true); // state frozen while unacquired
    kb.setAcquired(true);
    expect(kb.isKeyDown(DIK.ESCAPE)).toBe(false);
    expect(kb.pressed[DIK.ESCAPE]).toBe(2);
    // the stale once-flag still needs the key to be down to report a press
    expect(kb.keyPressedOnce(DIK.ESCAPE)).toBe(false);
  });

  it("masks key codes to a byte", () => {
    const kb = new Keyboard();
    kb.push(down(0x100 + DIK.A));
    kb.poll();
    expect(kb.isKeyDown(DIK.A)).toBe(true);
  });
});

describe("keyChar", () => {
  it("ASCII, control keys, cp1250 Polish letters, others 0", () => {
    expect(keyChar("a")).toBe(0x61);
    expect(keyChar("Z")).toBe(0x5a);
    expect(keyChar("Enter")).toBe(0x0d);
    expect(keyChar("Escape")).toBe(0x1b);
    expect(keyChar("Backspace")).toBe(0x08);
    expect(keyChar("Tab")).toBe(0x09);
    expect(keyChar("ł")).toBe(0xb3);
    expect(keyChar("Ż")).toBe(0xaf);
    expect(keyChar("ś")).toBe(0x9c);
    expect(keyChar("€")).toBe(0);
    expect(keyChar("Shift")).toBe(0);
    expect(keyChar("F1")).toBe(0);
  });
});

describe("CODE_TO_DIK", () => {
  it("maps the keys the game uses", () => {
    expect(CODE_TO_DIK.Escape).toBe(0x01);
    expect(CODE_TO_DIK.F1).toBe(0x3b);
    expect(CODE_TO_DIK.Space).toBe(0x39);
    expect(CODE_TO_DIK.ArrowUp).toBe(0xc8);
    expect(CODE_TO_DIK.NumpadEnter).toBe(0x9c);
  });

  it("is injective", () => {
    const values = Object.values(CODE_TO_DIK);
    expect(new Set(values).size).toBe(values.length);
  });
});
