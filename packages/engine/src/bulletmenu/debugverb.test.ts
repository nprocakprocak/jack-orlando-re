// no digit shortcut picks a verb (the exe has none); the play page's verb buttons offer only what the verb window offers.
import { describe, expect, it } from "vitest";
import { formulaTables, setDarkenTables } from "../gui/darken";
import { fakeAssets } from "../gui/fixtures";
import { createSurface } from "../render/surface";
import { BulletMenu, type BulletFrameInput } from "./bullet";
import { debugVerbAllowed } from "./debugverb";
import { verbMenuModes, VerbMenu } from "./verbmenu";

setDarkenTables(formulaTables());

const assets = fakeAssets();
const scene = createSurface(640, 480);
const KEYS = ["0", "1", "2", "3", "4", "5", "6", "Digit3", "Numpad3"];

describe("debugVerbAllowed", () => {
  for (const gun of [false, true]) {
    for (const itemInHand of [false, true]) {
      it(`GUN ${gun ? 1 : 0}, ${itemInHand ? "item in hand" : "empty hand"}, no menu`, () => {
        for (const verb of [0, 1, 2, 3, 4, 5]) {
          const expected = !itemInHand && verbMenuModes(gun).includes(verb);
          expect(debugVerbAllowed(verb, { gun, itemInHand, menuOpen: false }), `verb ${verb}`).toBe(expected);
        }
      });
    }
  }
  it("Colt (3) only with GUN = 1, and never mode 5 or an unknown mode", () => {
    expect(debugVerbAllowed(3, { gun: false, itemInHand: false, menuOpen: false })).toBe(false);
    expect(debugVerbAllowed(3, { gun: true, itemInHand: false, menuOpen: false })).toBe(true);
    expect(debugVerbAllowed(5, { gun: true, itemInHand: false, menuOpen: false })).toBe(false);
    expect(debugVerbAllowed(9, { gun: true, itemInHand: false, menuOpen: false })).toBe(false);
  });
  it("nothing under an open menu", () => {
    for (const gun of [false, true]) for (const verb of [0, 1, 2, 3, 4]) {
      expect(debugVerbAllowed(verb, { gun, itemInHand: false, menuOpen: true })).toBe(false);
    }
  });
});

describe("the verb window has no digit shortcuts (Gui_RunWindow, Gui_ChoiceWindow set no hotkeys)", () => {
  for (const gun of [false, true]) {
    it(`GUN ${gun ? 1 : 0}: digits do nothing, Enter picks the pointer, Esc nothing`, () => {
      for (const k of KEYS) {
        const v = new VerbMenu(assets, scene, 100, 100, gun);
        v.keyDown(k);
        v.keyUp(k);
        expect(v.done, `key ${k}`).toBe(false);
        expect(v.result, `key ${k}`).toBeNull();
      }
      const e = new VerbMenu(assets, scene, 100, 100, gun);
      e.keyDown("Enter");
      e.keyUp("Enter");
      expect(e.result).toEqual({ mode: 0 });
      const x = new VerbMenu(assets, scene, 100, 100, gun);
      x.keyDown("Escape");
      expect(x.done).toBe(true);
      expect(x.result).toBeNull();
    });
  }
});

describe("the bullet menu takes no keys but Esc (it reads only the mouse)", () => {
  const frame = (p: Partial<BulletFrameInput> = {}): BulletFrameInput => ({
    mouseX: 300, mouseY: 240, scrollX: 0, clickX: 291, clickY: 228, leftDown: false, rightDown: false, esc: false,
    cursorMode: 0, gun: false, showBullet: true, blocked: false, cursorEnabled: true, ...p,
  });
  for (const gun of [false, true]) {
    for (const cursorMode of [0, 5]) {
      it(`GUN ${gun ? 1 : 0}, cursor mode ${cursorMode}: opens only with an empty hand; Esc closes, the mode stays 0`, () => {
        const m = new BulletMenu();
        m.rightReleased = true;
        m.frame(frame({ rightDown: true, gun, cursorMode }));
        expect(m.open).toBe(cursorMode !== 5);
        if (m.open) {
          m.frame(frame({ gun, cursorMode: 0, esc: true }));
          expect(m.open).toBe(false);
        }
      });
    }
  }
});
