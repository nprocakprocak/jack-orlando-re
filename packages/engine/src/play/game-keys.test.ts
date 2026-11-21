// Keys and a loaded save. No game files.
import { describe, expect, it } from "vitest";
import { Inventory } from "../inventory/model";
import type { Surface16 } from "../render/surface";
import type { LoadedState } from "../save/state";
import { Variables } from "../script/interpreter";
import { AutoIncClock } from "./host";
import { callPlay, shell } from "./testing";

describe("play: keys and a loaded save (synthetic)", () => {
  function keyStub() {
    const calls: string[] = [];
    const g = shell({
      sceneName: "SC001",
      phase: "playing",
      vars: new Variables(new Map([["MENU", 1]])),
      dialog: null,
      bullet: { open: false },
      bar: null,
      cursor: { mode: 0 },
      notice: { shown: false },
      scrolling: false,
      captionHidden: false,
      optionsRequest: false,
      coatRequest: false,
      takeFlag: false,
      keysPressed: new Set<number>(),
      interpreter: null,
      menu: null,
      coat: null,
      slotUi: null,
      verbWindow: null,
      miniMap: null,
      modal: null,
      host: null,
      log: [],
      ticks: 0,
    });
    g.openMenu = (screen: string) => {
      calls.push(`menu:${screen}`);
      return true;
    };
    g.openCoat = () => {
      calls.push("coat");
      return true;
    };
    g.fileWindow = (kind: string) => {
      calls.push(`file:${kind}`);
      return true;
    };
    g.quickSave = (notice: boolean) => {
      calls.push(`quickSave:${notice}`);
    };
    g.quickLoad = () => {
      calls.push("quickLoad");
    };
    return { g, calls };
  }

  function press(key: string): string[] {
    const { g, calls } = keyStub();
    g.keyDown(key);
    callPlay(g, "keyFrame");
    return calls;
  }

  it("F4, F10, F2, F3, F5 and F6 reach the menu, the file window and the quick save", () => {
    expect(press("F4")).toEqual(["menu:main"]);
    expect(press("F10")).toEqual(["menu:quit"]);
    expect(press("F2")).toEqual(["file:save"]);
    expect(press("F3")).toEqual(["file:load"]);
    expect(press("F5")).toEqual(["quickSave:true"]);
    expect(press("F6")).toEqual(["quickLoad"]);
  });

  it("an open menu or coat eats F4, and a shown face blocks it in keyFrame", () => {
    const menu = keyStub();
    menu.g.menu = { isOpen: true, keyDown() {} };
    expect(menu.g.keyDown("F4")).toBe(true);
    callPlay(menu.g, "keyFrame");
    expect(menu.calls).toEqual([]);

    const coat = keyStub();
    coat.g.coat = { isOpen: true };
    expect(coat.g.keyDown("F4")).toBe(false);
    callPlay(coat.g, "keyFrame");
    expect(coat.calls).toEqual([]);

    // gate() reads the face windows. The answer menu alone does not: F5 has no conditions and F4 still opens.
    const face = keyStub();
    face.g.dialog = { menu: null, caption: null, faceView: () => ({ name: "FACE" }) };
    face.g.keyDown("F4");
    callPlay(face.g, "keyFrame");
    expect(face.calls).toEqual([]);

    const answers = keyStub();
    answers.g.dialog = { menu: { row: 0 }, caption: null, faceView: () => null };
    answers.g.keyDown("F5");
    callPlay(answers.g, "keyFrame");
    expect(answers.calls).toEqual(["quickSave:true"]);
  });

  it("applyLoaded copies the save and enters the scene with the saved pose", async () => {
    const names = ["A", "JACKISWOJ", "MARZECZY"];
    const pix = new Uint16Array([1]);
    const image = { width: 1, height: 1, pixels: pix } as Surface16;
    const savedMusic: string[] = [];
    const paused: boolean[] = [];
    const entered: unknown[][] = [];
    const g = shell({
      defaults: new Map(names.map((n, i) => [n, i === 2 ? 1 : 0])),
      vars: new Variables(new Map(names.map((n) => [n, 0]))),
      inventory: new Inventory(),
      dialog: { jackUniform: false },
      autoInc: new AutoIncClock(),
      bullet: { close() {} },
      coatRequest: true,
      cursor: { mode: 4 },
      verbMode: 2,
      fadeRequested: true,
      pendingScene: "OLD",
      pendingMovie: { film: "X", scene: "Y" },
      pendingFilm: { film: "Y", x: 0, y: 0, mode: 0, global: false },
      audio: {
        music: { loadSaved: (name: string) => savedMusic.push(name) },
        pauseEffects: (on: boolean) => paused.push(on),
      },
      armed: true,
      talkArmed: true,
      log: [],
      ticks: 0,
      sceneName: "SC001",
      phase: "playing",
    });
    g.inventory.held = { name: "OLD", image };
    g.enter = async (...args: unknown[]) => {
      entered.push(args);
    };
    const pose = { x: 10, y: 20, scale: 1, dir: 1, facing: 1 };
    const loaded: LoadedState = {
      scene: "ROOM.CCG",
      music: "TUNE.PMS",
      vars: [4, 1],
      varCount: 2,
      inventory: [{ slot: 0, name: "KEY", image }],
      light: false,
      autoInc: { min: 1, max: 3, variable: 2 },
      restorePose: true,
      pose,
      header: "slot",
    };
    callPlay(g, "applyLoaded", loaded);
    await g.loadPromise;

    expect(g.vars.get("A")).toBe(4);
    expect(g.vars.get("JACKISWOJ")).toBe(1);
    expect(g.vars.get("MARZECZY")).toBe(1);
    expect(g.dialog.jackUniform).toBe(true);
    expect(g.inventory.held).toBeNull();
    expect(g.inventory.slots[0]?.name).toBe("KEY");
    expect(g.inventory.marzeczy).toBe(1);
    expect([g.autoInc.min, g.autoInc.max, g.autoInc.variable]).toEqual([1, 3, 2]);
    expect(g.cursor.mode).toBe(0);
    expect(g.verbMode).toBe(0);
    expect(g.fadeRequested).toBe(false);
    expect(g.pendingScene).toBeNull();
    expect(g.pendingMovie).toBeNull();
    expect(g.pendingFilm).toBeNull();
    expect(savedMusic).toEqual(["TUNE.PMS"]);
    expect(paused).toEqual([false]);
    expect(g.armed).toBe(false);
    expect(g.talkArmed).toBe(false);
    expect(g.phase).toBe("loading");
    expect(entered).toEqual([["ROOM", pose]]);
    expect(g.log).toHaveLength(1);
  });
});
