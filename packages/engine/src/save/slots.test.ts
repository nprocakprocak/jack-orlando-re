import { describe, expect, it } from "vitest";
import { createSurface } from "../render/surface";
import { fakeAssets } from "../gui/fixtures";
import { SLOT_TEXTS_PL, SlotWindow } from "./index";

describe("slot window", () => {
  const scene = createSurface(640, 480);
  const descs = ["LP4", null, "3", null, null, null, null, null, null, null];
  const make = (mode: "load" | "save") => new SlotWindow(fakeAssets(), scene, mode, descs, SLOT_TEXTS_PL);
  // window 460 x 400 centred: x0 = 90, y0 = 40; slot i at (126, 100 + 28 i)
  const slotXY = (i: number): [number, number] => [126 + 20, 40 + 60 + i * 28 + 10];
  const click = (w: SlotWindow, x: number, y: number) => [...w.pointerDown(x, y), ...w.pointerUp(x, y)];

  it("load: a filled slot loads, an empty one does nothing", () => {
    const w = make("load");
    expect(click(w, ...slotXY(2))).toEqual([{ kind: "load", slot: 2 }]);
    expect(click(w, ...slotXY(1))).toEqual([]);
  });

  it("load: new game and cancel", () => {
    const w = make("load");
    expect(click(w, 90 + 30, 40 + 360)).toEqual([{ kind: "newGame" }]);
    expect(click(w, 90 + 350, 40 + 360)).toEqual([{ kind: "cancel" }]);
    expect(w.keyDown("Escape")).toEqual([{ kind: "cancel" }]);
  });

  it("save: click presses the slot, typing + Enter saves, nothing else (no confirmation)", () => {
    const w = make("save");
    expect(click(w, ...slotXY(0))).toEqual([]);
    expect(w.editingSlot).toBe(0);
    expect(w.editText).toBe("LP4");
    w.keyDown("x");
    w.keyDown("Backspace");
    w.keyDown("Backspace");
    expect(w.keyDown("Enter")).toEqual([{ kind: "save", slot: 0, description: "LP" }]);
    expect(w.editingSlot).toBe(-1);
  });

  it("save: Enter leaves the window open on the list, the button shows the new description", () => {
    const w = make("save");
    const screen = createSurface(640, 480);
    w.draw(screen);
    const before = screen.pixels.slice();
    click(w, ...slotXY(0));
    w.keyDown("Z");
    w.keyDown("Enter");
    expect(w.editingSlot).toBe(-1);
    const after = createSurface(640, 480);
    w.draw(after);
    expect(after.pixels).not.toEqual(before);
    w.setDescriptions(["LP4Z", null, "3", null, null, null, null, null, null, null]);
    const again = createSurface(640, 480);
    w.draw(again);
    expect(again.pixels).toEqual(after.pixels);
    expect(w.keyDown("Escape")).toEqual([{ kind: "cancel" }]); // only on the list does Esc close
  });

  it("save: Esc is two-step; the abandoned edit does not change the slot", () => {
    const w = make("save");
    const screen = createSurface(640, 480);
    w.draw(screen);
    const before = screen.pixels.slice();
    click(w, ...slotXY(0));
    w.keyDown("Q");
    expect(w.keyDown("Escape")).toEqual([]); // first Esc: back to the list
    expect(w.editingSlot).toBe(-1);
    const after = createSurface(640, 480);
    w.draw(after);
    expect(after.pixels).toEqual(before);
    expect(w.keyDown("Escape")).toEqual([{ kind: "cancel" }]); // second Esc closes
  });

  it("empty slots are labelled (puste), without < > [ glyphs", () => {
    expect(SLOT_TEXTS_PL.empty).toBe("(puste)");
    expect(SLOT_TEXTS_PL.empty).not.toMatch(/[<>[\]]/);
    const a = new SlotWindow(fakeAssets(), scene, "load", descs, SLOT_TEXTS_PL);
    const b = new SlotWindow(fakeAssets(), scene, "load", descs, { ...SLOT_TEXTS_PL, empty: "" });
    const sa = createSurface(640, 480);
    const sb = createSurface(640, 480);
    a.draw(sa);
    b.draw(sb);
    expect(sa.pixels).not.toEqual(sb.pixels);
  });

  it("save: an empty slot starts with an empty field; Esc leaves the editing, then closes the window", () => {
    const w = make("save");
    click(w, ...slotXY(1));
    expect(w.editText).toBe("");
    expect(w.keyDown("Escape")).toEqual([]);
    expect(w.editingSlot).toBe(-1);
    expect(w.keyDown("Escape")).toEqual([{ kind: "cancel" }]);
  });

  it("save: Cancel button closes; clicking another slot while editing switches", () => {
    const w = make("save");
    click(w, ...slotXY(0));
    click(w, ...slotXY(2));
    expect(w.editingSlot).toBe(2);
    expect(click(w, 90 + 350, 40 + 360)).toEqual([{ kind: "cancel" }]);
  });

  it("draws without errors in every state (editing row pressed)", () => {
    const w = make("save");
    const screen = createSurface(640, 480);
    w.draw(screen);
    const before = screen.pixels.slice();
    click(w, ...slotXY(0));
    w.tick(10);
    w.draw(screen);
    expect(screen.pixels).not.toEqual(before);
  });
});
