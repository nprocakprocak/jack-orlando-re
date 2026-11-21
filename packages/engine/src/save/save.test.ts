import { describe, expect, it } from "vitest";
import {
  EMPTY_SIZE, SaveError, TEMP_NAME, VERSION_BYTE, headerText, isCopy, parseSave, writeSave,
} from "../formats/save";
import { Inventory } from "../inventory/model";
import { createSurface, type Surface16 } from "../render/surface";
import { fakeAssets } from "../gui/fixtures";
import {
  BrowserFilePicker, MemoryStore, SLOT_COUNT, SLOT_TEXTS_PL, SaveManager, SlotStore, SlotWindow, TextField, BLINK_ON_MS, BLINK_OFF_MS, VAR_COUNT_DC,
  atoi, autosaveFileName, buildSave, buildTemp, loadedVars, namedVars, pickNewestQuick, putHandAway, quickSaveName, quickScore,
  readSave, serializeSave, slotHeader, withDefaultExtension, type PickerEnv, type SaveState,
} from "./index";

const img = (w: number, h: number, v: number): Surface16 => {
  const s = createSurface(w, h);
  s.pixels.fill(v);
  return s;
};

function state(over: Partial<SaveState> = {}): SaveState {
  const vars = new Array(500).fill(0);
  vars[3] = 7;
  vars[246] = 1;
  const inventory = new Inventory();
  inventory.add("KLUCZYK.BM", img(10, 12, 0x1234));
  return {
    scene: "SC013.CCG", music: "TR05-22.PMS", vars, varCount: VAR_COUNT_DC, inventory, light: false,
    autoInc: { min: 0, max: 200, variable: -1 }, pose: { x: 120.5, y: 300.25, scale: 0.75, dir: 2, facing: -1 },
    sceneSaveable: true, jackPlaced: true, ...over,
  };
}


describe("build / serialize", () => {
  it("AUTOINCRANGE tail: a running clock (OCHR 0..60 = index 158), an off clock (-1) and min > 0 survive save -> load", () => {
    const cases = [{ min: 0, max: 60, variable: 158 }, { min: 0, max: 0, variable: -1 }, { min: 5, max: 200, variable: 21 }];
    for (const autoInc of cases) {
      const r = readSave(serializeSave(state({ autoInc }), null).bytes, false);
      expect(r.ok && r.state.autoInc, JSON.stringify(autoInc)).toEqual(autoInc);
    }
  });

  it("round-trips a state through bytes", () => {
    const s = state();
    const { bytes, kind } = serializeSave(s, null);
    expect(kind).toBe("current");
    const r = readSave(bytes, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.scene).toBe("SC013.CCG");
    expect(r.state.music).toBe("TR05-22.PMS");
    expect(r.state.vars[3]).toBe(7);
    expect(r.state.vars[246]).toBe(1);
    expect(r.state.restorePose).toBe(true);
    expect(r.state.pose).toEqual({ x: 120.5, y: 300.25, scale: 0.75, dir: 2, facing: -1 });
    expect(r.state.inventory).toHaveLength(1);
    expect(r.state.inventory[0].name).toBe("KLUCZYK.BM");
    expect(r.state.inventory[0].image.pixels.every((p) => p === 0x1234)).toBe(true);
    expect(r.state.header).toBe("Jack Orlando - normal ver");
    expect(bytes.length).toBe(EMPTY_SIZE + 3556);
    // and the bytes are exactly what the writer produces
    expect(writeSave(parseSave(bytes))).toEqual(bytes);
  });

  it("menu music is saved as TR17-22.PMS", () => {
    const { bytes } = serializeSave(state({ music: "TR02-22.PMS" }), null);
    const r = readSave(bytes, false);
    expect(r.ok && r.state.music).toBe("TR17-22.PMS");
  });

  it("easy version: light header, SVL rules", () => {
    const { bytes } = serializeSave(state({ light: true }), null);
    expect(headerText(parseSave(bytes))).toBe("Jack Orlando - light ver");
    expect(readSave(bytes, true).ok).toBe(true);
    const wrong = readSave(bytes, false);
    expect(wrong).toMatchObject({ ok: false, reason: "version" });
  });

  it("a normal save is refused silently by the easy version", () => {
    const { bytes } = serializeSave(state(), null);
    expect(readSave(bytes, true)).toMatchObject({ ok: false, reason: "version" });
  });

  it("scene without saving (or Jack not placed): a copy of tempjs, not the current state", () => {
    const start = state({ scene: "SC026.CCG" });
    const temp = buildTemp(start);
    const later = state({ scene: "SC026.CCG", sceneSaveable: false });
    (later.vars as number[])[5] = 99;
    const { bytes, kind } = serializeSave(later, temp);
    expect(kind).toBe("copy");
    expect(isCopy(parseSave(bytes))).toBe(true);
    const r = readSave(bytes, false);
    expect(r.ok && r.state.vars[5]).toBe(0);
    expect(r.ok && r.state.restorePose).toBe(false);
    // Jack not placed yet = same
    expect(serializeSave(state({ jackPlaced: false }), temp).kind).toBe("copy");
    // no tempjs: current state
    expect(serializeSave(later, null).kind).toBe("current");
  });

  it("DEVIATION: the item in hand goes to the coat before every save (F5 included)", () => {
    const s = state();
    s.inventory.take("BRONZA.BM", img(8, 8, 0x4321));
    expect(s.inventory.held?.name).toBe("BRONZA.BM");
    const { bytes } = serializeSave(s, null);
    expect(s.inventory.held).toBeNull();
    const r = readSave(bytes, false);
    expect(r.ok && r.state.inventory.map((i) => i.name)).toEqual(["KLUCZYK.BM", "BRONZA.BM"]);
    // loading it gives the item back in the coat, hand empty
    const inv = new Inventory();
    if (r.ok) inv.restore(r.state.inventory);
    expect(inv.has("BRONZA.BM")).toBe(true);
    expect(inv.held).toBeNull();
  });

  it("the hand goes away for a copy of tempjs too, and a full coat loses the item like Item_PutBackToBar", () => {
    const s = state();
    s.inventory.take("BRONZA.BM", img(2, 2, 1));
    putHandAway(s.inventory);
    expect(s.inventory.held).toBeNull();
    const full = new Inventory();
    for (let i = 0; i < 66; i++) full.add(`A${i}.BM`, img(1, 1, 1));
    full.held = { name: "X.BM", image: img(1, 1, 1) };
    putHandAway(full);
    expect(full.has("X.BM")).toBe(false);
  });

  it("refuses a state the original could not read", () => {
    expect(() => buildSave(state({ varCount: 225 }))).toThrow(SaveError);
    expect(() => buildSave(state({ vars: [1, 2, 3] }))).toThrow(SaveError);
    expect(() => buildSave(state({ scene: "SC0123456789ABC.CCG" }))).toThrow(SaveError);
    const big = state();
    big.inventory.add("BIG.BM", img(60, 40, 1));
    expect(() => buildSave(big)).toThrow(SaveError);
  });
});

describe("readSave errors and variables", () => {
  it("format errors are reported, not thrown", () => {
    expect(readSave(new Uint8Array(10), false)).toMatchObject({ ok: false, reason: "format" });
    const { bytes } = serializeSave(state(), null);
    expect(readSave(bytes.slice(0, bytes.length - 5), false)).toMatchObject({ ok: false, reason: "format" });
  });

  it("an old save with 225 variables gets defaults for the rest", () => {
    const g = parseSave(serializeSave(state(), null).bytes);
    g.varCount = 225;
    g.varValues = g.varValues.map((v, i) => (i >= 225 ? 0 : v));
    const r = readSave(writeSave(g), false);
    if (!r.ok) throw new Error("not ok");
    const defaults = new Array(VAR_COUNT_DC).fill(5);
    const v = loadedVars(r.state, defaults);
    expect(v[3]).toBe(7);
    expect(v[224]).toBe(0);
    expect(v[225]).toBe(5);
    expect(v[246]).toBe(5);
  });

  it("namedVars finds the variables by name", () => {
    const names = ["A", "LAST", "GUN", "JACKISWOJ", "MARZECZY"];
    expect(namedVars([0, 4, 1, 1, 0], names)).toEqual({ last: 4, gun: 1, jackIsWoj: 1, marzeczy: 0 });
    expect(namedVars([1], ["X"])).toEqual({ last: 0, gun: 0, jackIsWoj: 0, marzeczy: 0 });
  });
});

describe("quick save names and F6", () => {
  const d = (y: number, mo: number, da: number, h: number, mi: number) => new Date(y, mo - 1, da, h, mi);

  it("names", () => {
    expect(quickSaveName(d(2026, 11, 3, 14, 5), false)).toBe("Szybki Zapis 2026-11-03 14-05.sav");
    expect(quickSaveName(d(2026, 1, 9, 0, 0), true)).toBe("Szybki Zapis 2026-01-09 00-00.svl");
    expect(quickSaveName(d(2026, 11, 3, 14, 5), false, "Quick Save")).toBe("Quick Save 2026-11-03 14-05.sav");
    expect(autosaveFileName(false)).toBe("AUTO - ZAPIS.sav");
    expect(autosaveFileName(true)).toBe("AUTO - ZAPIS.svl");
  });

  it("atoi", () => {
    expect([atoi("03"), atoi("14-05"), atoi(" 7x"), atoi("-2"), atoi("abc"), atoi("")]).toEqual([3, 14, 7, -2, 0, 0]);
  });

  it("score is minutes with 30-day months", () => {
    expect(quickScore("Szybki Zapis 2026-11-03 14-05.sav")).toBe(126 * 525600 + 11 * 43200 + 3 * 1440 + 14 * 60 + 5);
  });

  it("F6 picks the newest", () => {
    const names = ["AUTO - ZAPIS.sav", "Szybki Zapis 2026-11-03 14-05.sav", "Szybki Zapis 2026-11-03 18-45.sav", "Szybki Zapis 2026-10-30 23-59.sav", "cela.SAV"];
    expect(pickNewestQuick(names)).toBe("Szybki Zapis 2026-11-03 18-45.sav");
  });

  it("QUIRK: 31 January 23:00 beats 1 February 10:00 (month = 30 days)", () => {
    const names = ["Szybki Zapis 2026-02-01 10-00.sav", "Szybki Zapis 2026-01-31 23-00.sav"];
    expect(pickNewestQuick(names)).toBe("Szybki Zapis 2026-01-31 23-00.sav");
  });

  it("a tie goes to the first file; files of the other version take part; none = null", () => {
    expect(pickNewestQuick(["Szybki Zapis 2026-11-03 14-05.svl", "Szybki Zapis 2026-11-03 14-05.sav"])).toBe("Szybki Zapis 2026-11-03 14-05.svl");
    expect(pickNewestQuick(["AUTO - ZAPIS.sav", "tempjs"])).toBeNull();
    expect(pickNewestQuick([])).toBeNull();
    expect(pickNewestQuick(["szybki zapis 2026-11-03 14-05.SAV"])).toBe("szybki zapis 2026-11-03 14-05.SAV");
  });
});

describe("file windows", () => {
  const fs = (over: Partial<PickerEnv> = {}) => {
    const calls: string[] = [];
    const written: Uint8Array[] = [];
    const env: PickerEnv = {
      showSaveFilePicker: async (o) => {
        calls.push(`save ${(o as { suggestedName: string }).suggestedName}`);
        return { name: "x.SAV", createWritable: async () => ({ write: async (d) => void written.push(d), close: async () => {} }) };
      },
      showOpenFilePicker: async () => [{ name: "y.SAV", getFile: async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) }],
      ...over,
    };
    return { env, calls, written };
  };

  it("adds the default extension only when there is none", () => {
    expect(withDefaultExtension("zapis", false)).toBe("zapis.SAV");
    expect(withDefaultExtension("zapis", true)).toBe("zapis.SVL");
    expect(withDefaultExtension("zapis.sav", false)).toBe("zapis.sav");
  });

  it("File System Access: save and open", async () => {
    const { env, calls, written } = fs();
    const p = new BrowserFilePicker(env);
    expect(p.native).toBe(true);
    expect(await p.save(new Uint8Array([9]), "Jack", false)).toBe(true);
    expect(calls).toEqual(["save Jack.SAV"]);
    expect(written[0]).toEqual(new Uint8Array([9]));
    expect(await p.open(false)).toEqual({ name: "y.SAV", data: new Uint8Array([1, 2, 3]) });
  });

  it("cancel (AbortError) is false / null; other errors pass", async () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    const p = new BrowserFilePicker({ showSaveFilePicker: async () => Promise.reject(abort), showOpenFilePicker: async () => Promise.reject(abort) });
    expect(await p.save(new Uint8Array(1), "a", false)).toBe(false);
    expect(await p.open(false)).toBeNull();
    const bad = new BrowserFilePicker({ showSaveFilePicker: async () => Promise.reject(new Error("disk")), showOpenFilePicker: async () => [] });
    await expect(bad.save(new Uint8Array(1), "a", false)).rejects.toThrow("disk");
    expect(await bad.open(false)).toBeNull();
  });

  it("fallback (Firefox): <input type=file> and a download", async () => {
    const downloads: string[] = [];
    const accepts: string[] = [];
    const p = new BrowserFilePicker({
      chooseFile: async (a) => (accepts.push(a), { name: "z.svl", bytes: new Uint8Array([7]) }),
      download: (n) => void downloads.push(n),
    });
    expect(p.native).toBe(false);
    expect(await p.save(new Uint8Array(1), "Jack", true)).toBe(true);
    expect(downloads).toEqual(["Jack.SVL"]);
    expect(await p.open(true)).toEqual({ name: "z.svl", data: new Uint8Array([7]) });
    expect(accepts).toEqual([".SVL,.svl"]);
    expect(await new BrowserFilePicker({ chooseFile: async () => null }).open(false)).toBeNull();
    expect(await new BrowserFilePicker({}).save(new Uint8Array(1), "a", false)).toBe(false);
  });
});

describe("manager", () => {
  function make(light = false, at = new Date(2026, 10, 3, 14, 5)) {
    const store = new MemoryStore();
    const slots = new MemoryStore();
    const saved: Uint8Array[] = [];
    const picker = { save: async (d: Uint8Array) => (saved.push(d), true), open: async () => ({ name: "a.SAV", data: saved[0] }) };
    const m = new SaveManager({ store, slots, picker, light, now: () => at });
    return { m, store, slots, saved };
  }

  it("sceneStart writes tempjs, autosave is its copy", async () => {
    const { m, store } = make();
    expect(await m.autosave()).toBeNull();
    await m.sceneStart(state());
    const temp = await store.read(TEMP_NAME);
    expect(temp).not.toBeNull();
    expect(parseSave(temp!).restorePose).toBe(0);
    expect(await m.autosave()).toBe("AUTO - ZAPIS.sav");
    const auto = parseSave((await store.read("auto - zapis.sav"))!);
    expect(isCopy(auto)).toBe(true);
    expect(auto.restorePose).toBe(0);
  });

  it("F5 then F6 (current state), hand item kept", async () => {
    const { m, store } = make();
    await m.sceneStart(state());
    const s = state();
    (s.vars as number[])[10] = 42;
    s.inventory.take("PUDEL.BM", img(4, 4, 5));
    const r = await m.quickSave(s);
    expect(r).toEqual({ name: "Szybki Zapis 2026-11-03 14-05.sav", kind: "current" });
    expect(await store.list()).toContain("Szybki Zapis 2026-11-03 14-05.sav");
    const loaded = await m.quickLoad();
    expect(loaded?.ok && loaded.state.vars[10]).toBe(42);
    expect(loaded?.ok && loaded.state.inventory.some((i) => i.name === "PUDEL.BM")).toBe(true);
  });

  it("F6 with no quick save does nothing; a file of the other version is refused", async () => {
    const a = make();
    expect(await a.m.quickLoad()).toBeNull();
    const light = make(true);
    await light.m.sceneStart(state({ light: true }));
    await light.m.quickSave(state({ light: true }));
    const bytes = (await light.store.read("Szybki Zapis 2026-11-03 14-05.svl"))!;
    await a.store.write("Szybki Zapis 2026-11-03 14-05.svl", bytes);
    expect(await a.m.quickLoad()).toMatchObject({ ok: false, reason: "version" });
  });

  it("file windows: save and load through the picker, bad file reported", async () => {
    const { m, saved } = make();
    expect(await m.saveToFile(state())).toBe(true);
    const r = await m.loadFromFile();
    expect(r?.ok).toBe(true);
    saved[0] = new Uint8Array(30);
    expect(await m.loadFromFile()).toMatchObject({ ok: false, reason: "format" });
    const cancel = new SaveManager({ store: new MemoryStore(), picker: { save: async () => false, open: async () => null }, light: false });
    expect(await cancel.saveToFile(state())).toBe(false);
    expect(await cancel.loadFromFile()).toBeNull();
  });

  it("slot mode without a slot store is an error", async () => {
    const m = new SaveManager({ store: new MemoryStore(), picker: { save: async () => false, open: async () => null }, light: false });
    await expect(m.slotDescriptions()).rejects.toThrow(SaveError);
  });

  it("slots: description in the header, load back, copy rule applies", async () => {
    const { m, slots } = make();
    expect((await m.slotDescriptions()).every((d) => d === null)).toBe(true);
    expect(await m.loadFromSlot(3)).toBeNull();
    await m.sceneStart(state());
    expect(await m.saveToSlot(state(), 3, "LP4")).toBe("current");
    expect(await m.saveToSlot(state({ sceneSaveable: false }), 4, "")).toBe("copy");
    const d = await m.slotDescriptions();
    expect(d[3]).toBe("LP4");
    expect(d[4]).toBe("SC013");
    expect(d.filter((x) => x === null)).toHaveLength(SLOT_COUNT - 2);
    const r = await m.loadFromSlot(3);
    expect(r?.ok && r.state.scene).toBe("SC013.CCG");
    expect(await slots.list()).toEqual(["slot3.sav", "slot4.sav"]);
    await expect(m.saveToSlot(state(), 10, "x")).rejects.toThrow(RangeError);
  });

  it("slot header keeps the easy-version byte and the length limit", async () => {
    expect(slotHeader("LP4", true)[VERSION_BYTE]).toBe(0x6c);
    expect(slotHeader("LP4", false)[VERSION_BYTE]).toBe(0);
    const store = new SlotStore(new MemoryStore(), false);
    await store.save(0, serializeSave(state(), null).bytes, "x".repeat(200));
    expect((await store.descriptions())[0]).toHaveLength(79);
  });
});

describe("text field", () => {
  it("types, deletes, confirms", () => {
    const f = new TextField("LP4");
    expect(f.cursorOn).toBe(true);
    f.keyDown("1");
    f.keyDown("ą");
    expect(f.text).toBe("LP41ą");
    f.keyDown("Backspace");
    expect(f.text).toBe("LP41");
    expect(f.keyDown("Enter")).toBe("enter");
    expect(f.keyDown("Escape")).toBe("escape");
  });

  it("ignores unknown keys and respects the limit", () => {
    const f = new TextField("", 3);
    for (const k of ["a", "b", "c", "d", "Shift", "F1", "€", "ArrowLeft"]) f.keyDown(k);
    expect(f.text).toBe("abc");
    new TextField("").keyDown("Backspace");
    expect(new TextField("abcdef", 3).text).toBe("abc");
  });

  it("the cursor blinks and typing restarts it", () => {
    const f = new TextField("x");
    expect(f.cursorOn).toBe(true);
    f.tick(BLINK_ON_MS - 1);
    expect(f.cursorOn).toBe(true);
    f.tick(1);
    expect(f.cursorOn).toBe(false);
    f.tick(BLINK_OFF_MS - 1);
    expect(f.cursorOn).toBe(false);
    f.tick(1);
    expect(f.cursorOn).toBe(true); // period ~233 ms (~4.3 Hz), measured from a recording
    f.tick(150);
    f.keyDown("y");
    expect(f.cursorOn).toBe(true);
  });
});

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
