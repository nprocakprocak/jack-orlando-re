import { describe, expect, it } from "vitest";
import type { Pak } from "../formats/pak";
import { darkenPixel } from "../gui/darken";
import { COLOR_WHITE, COLOR_YELLOW } from "../gui/draw";
import { fakeAssets, flat } from "../gui/fixtures";
import { TEXTS_PL } from "../gui/texts";
import type { KeyValueStorage } from "../settings/store";
import { setupBackground } from "./assets";
import {
  DEFAULT_MODES,
  MODES_KEY,
  MODE_PENDING,
  MODE_VALUES,
  PAUSE_ON_BLUR_KEY,
  StartStore,
  cycleMode,
  defaultModes,
  sanitizeModes,
  skipStartScreen,
  type GameModes,
  type ModeKey,
} from "./modes";
import {
  BACKGROUND_DARKEN,
  HINT_Y,
  LABEL_X,
  ROW_DY,
  ROW_Y0,
  START_H,
  START_TEXTS_PL,
  START_W,
  START_Y,
  StartScreen,
  VALUE_H,
  VALUE_W,
  VALUE_X,
  WINDOW_W,
  type StartAction,
  type StartState,
  type StartTexts,
} from "./screen";
import { Disposables } from "./session";

const NONE: { readonly [K in ModeKey]: string | null } = {
  inventory: null,
  easy: null,
  saves: null,
};
/** The pending mechanism stays for future modes; tests exercise it with the inventory row as it was before. */
const PENDING_BAR: { readonly [K in ModeKey]: string | null } = { ...NONE, inventory: "T74" };

class FakeStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

class ThrowingStorage implements KeyValueStorage {
  getItem(): string | null {
    throw new Error("blocked");
  }
  setItem(): void {
    throw new Error("quota");
  }
}

describe("game modes", () => {
  it("defaults: coat, normal version, file windows", () => {
    expect(defaultModes()).toEqual({ inventory: "coat", easy: false, saves: "files" });
    expect(defaultModes()).not.toBe(DEFAULT_MODES);
  });

  it("no mode waits for an integration task any more (landed last)", () => {
    expect(MODE_PENDING).toEqual({ inventory: null, easy: null, saves: null });
  });

  it("sanitize keeps valid values, drops unknown keys and bad values", () => {
    expect(sanitizeModes({ inventory: "bar", easy: true, saves: "slots", junk: 1 }, NONE)).toEqual({
      inventory: "bar",
      easy: true,
      saves: "slots",
    });
    expect(sanitizeModes({ inventory: "pocket", easy: "yes", saves: 3 }, NONE)).toEqual(DEFAULT_MODES);
    expect(sanitizeModes(null, NONE)).toEqual(DEFAULT_MODES);
    expect(sanitizeModes("x", NONE)).toEqual(DEFAULT_MODES);
  });

  it("sanitize forces pending modes to their default", () => {
    expect(sanitizeModes({ inventory: "bar", easy: true, saves: "slots" }, PENDING_BAR)).toEqual({
      ...DEFAULT_MODES,
      easy: true,
      saves: "slots",
    });
    expect(sanitizeModes({ inventory: "bar", easy: true, saves: "slots" }, { ...NONE, easy: "T78" })).toEqual({
      inventory: "bar",
      easy: false,
      saves: "slots",
    });
  });

  it("cycle goes through every value and back; pending modes stay", () => {
    for (const key of Object.keys(MODE_VALUES) as ModeKey[]) {
      let m: GameModes = defaultModes();
      const seen: unknown[] = [];
      for (let i = 0; i < MODE_VALUES[key].length; i++) {
        seen.push(m[key]);
        m = cycleMode(m, key, NONE);
      }
      expect(seen).toEqual(MODE_VALUES[key]);
      expect(m).toEqual(defaultModes());
      const d = defaultModes();
      if (MODE_PENDING[key]) expect(cycleMode(d, key)).toBe(d);
    }
  });

  it("cycle does not mutate its input", () => {
    const m = defaultModes();
    const n = cycleMode(m, "easy", NONE);
    expect(m.easy).toBe(false);
    expect(n.easy).toBe(true);
  });
});

describe("StartStore", () => {
  it("round-trips the modes as JSON under jack-orlando.modes", () => {
    const s = new FakeStorage();
    const store = new StartStore(s);
    expect(store.saveModes({ inventory: "bar", easy: true, saves: "slots" })).toBe(true);
    expect(JSON.parse(s.data.get(MODES_KEY)!)).toEqual({
      inventory: "bar",
      easy: true,
      saves: "slots",
    });
    expect(store.loadModes(NONE)).toEqual({ inventory: "bar", easy: true, saves: "slots" });
    expect(store.loadModes()).toEqual({ inventory: "bar", easy: true, saves: "slots" }); // nothing pending since
    expect(store.loadModes(PENDING_BAR)).toEqual({ ...DEFAULT_MODES, easy: true, saves: "slots" });
  });

  it("broken JSON, missing key, no storage, throwing storage: defaults", () => {
    const s = new FakeStorage();
    s.data.set(MODES_KEY, "{oops");
    expect(new StartStore(s).loadModes(NONE)).toEqual(DEFAULT_MODES);
    expect(new StartStore(new FakeStorage()).loadModes(NONE)).toEqual(DEFAULT_MODES);
    expect(new StartStore(null).loadModes(NONE)).toEqual(DEFAULT_MODES);
    expect(new StartStore(new ThrowingStorage()).loadModes(NONE)).toEqual(DEFAULT_MODES);
  });

  it("saving fails softly without storage", () => {
    expect(new StartStore(null).saveModes(defaultModes())).toBe(false);
    expect(new StartStore(new ThrowingStorage()).saveModes(defaultModes())).toBe(false);
    expect(new StartStore(null).savePauseOnBlur(false)).toBe(false);
    expect(new StartStore(new ThrowingStorage()).savePauseOnBlur(true)).toBe(false);
  });

  it('pauseOnBlur: "1"/"0" under jack-orlando.pauseOnBlur, default on', () => {
    const s = new FakeStorage();
    const store = new StartStore(s);
    expect(PAUSE_ON_BLUR_KEY).toBe("jack-orlando.pauseOnBlur");
    expect(store.loadPauseOnBlur()).toBe(true);
    expect(store.savePauseOnBlur(false)).toBe(true);
    expect(s.data.get(PAUSE_ON_BLUR_KEY)).toBe("0");
    expect(store.loadPauseOnBlur()).toBe(false);
    store.savePauseOnBlur(true);
    expect(s.data.get(PAUSE_ON_BLUR_KEY)).toBe("1");
    expect(store.loadPauseOnBlur()).toBe(true);
    s.data.set(PAUSE_ON_BLUR_KEY, "garbage");
    expect(store.loadPauseOnBlur()).toBe(true);
    expect(new StartStore(null).loadPauseOnBlur()).toBe(true);
    expect(new StartStore(new ThrowingStorage()).loadPauseOnBlur()).toBe(true);
  });
});

describe("skipStartScreen", () => {
  const p = (q: string) => new URLSearchParams(q);
  it("?scene= and ?start=1 skip, ?start=0 forces the screen", () => {
    expect(skipStartScreen(p(""))).toBe(false);
    expect(skipStartScreen(p("mute=1"))).toBe(false);
    expect(skipStartScreen(p("scene=SC006&LAST=5"))).toBe(true);
    expect(skipStartScreen(p("start=1&mute=1"))).toBe(true);
    expect(skipStartScreen(p("start=0&scene=SC006"))).toBe(false);
    expect(skipStartScreen(p("start=2"))).toBe(false);
  });
});

const STATE: StartState = { modes: defaultModes(), pauseOnBlur: true };

function screen(pending = MODE_PENDING, startTexts?: StartTexts) {
  return new StartScreen({
    assets: fakeAssets(),
    texts: TEXTS_PL,
    background: flat(640, 480, 0x7bef),
    state: STATE,
    pending,
    startTexts,
  });
}

/** Fill pixels of `color` in a window-relative y band. */
function fills(s: StartScreen, color: number, y0: number, y1: number): number {
  const frame = s.render();
  const win = s.win;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < win.w; x++) if (frame.pixels[(win.y + y) * frame.width + win.x + x] === color) n++;
  }
  return n;
}

/** Clicks the centre of a window-relative rectangle. */
function click(s: StartScreen, x: number, y: number, w: number, h: number): StartAction[] {
  const sx = s.win.x + x + (w >> 1);
  const sy = s.win.y + y + (h >> 1);
  return [...s.pointerDown(sx, sy), ...s.pointerUp(sx, sy)];
}
const clickRow = (s: StartScreen, i: number) => click(s, VALUE_X, ROW_Y0 + i * ROW_DY, VALUE_W, VALUE_H);

describe("StartScreen", () => {
  it("rows in order, values from the state", () => {
    const s = screen(PENDING_BAR);
    expect(s.rows().map((r) => [r.key, r.label, r.value, r.pending])).toEqual([
      ["inventory", "Ekwipunek", "Płaszcz", "T74"],
      ["easy", "Wersja łatwa", "Nie", null],
      ["saves", "Zapis gry", "Pliki na dysku", null],
      ["pauseOnBlur", START_TEXTS_PL.pauseOnBlur, "Tak", null],
    ]);
  });

  it("has no bullet row (BulletOnOff is only in the options window)", () => {
    expect(
      screen()
        .rows()
        .map((r) => r.key),
    ).toEqual(["inventory", "easy", "saves", "pauseOnBlur"]);
  });

  it("does not share the caller's state object", () => {
    const s = screen();
    s.press("pauseOnBlur");
    expect(STATE.pauseOnBlur).toBe(true);
  });

  it("the title asks for a mode, and a line under Start names F11", () => {
    expect(START_TEXTS_PL.title).toBe("/2- Wybierz tryb gry -");
    expect(START_TEXTS_PL.fullscreenHint).toBe("Użyj F11 by przełączać tryb pełnoekranowy");
    expect(fills(screen(), COLOR_YELLOW, 0, START_Y)).toBeGreaterThan(0);
    expect(fills(screen(MODE_PENDING, { ...START_TEXTS_PL, title: "" }), COLOR_YELLOW, 0, START_Y)).toBe(0);
    expect(fills(screen(), COLOR_WHITE, HINT_Y, HINT_Y + 8)).toBeGreaterThan(0);
    expect(
      fills(screen(MODE_PENDING, { ...START_TEXTS_PL, fullscreenHint: "" }), COLOR_WHITE, HINT_Y, HINT_Y + 8),
    ).toBe(0);
  });

  it("the Start button and Enter start", () => {
    const s = screen();
    expect(click(s, (WINDOW_W - START_W) / 2 - 1, START_Y, START_W, START_H)).toEqual([{ type: "start" }]);
    expect([...s.keyDown("Enter"), ...s.keyUp("Enter")]).toEqual([{ type: "start" }]);
  });

  it("a press released outside the button does nothing", () => {
    const s = screen();
    const sx = s.win.x + VALUE_X + 5;
    const sy = s.win.y + ROW_Y0 + 3 * ROW_DY + 5;
    expect(s.pointerDown(sx, sy)).toEqual([]);
    expect(s.pointerMove(sx, sy - 100)).toEqual([]);
    expect(s.pointerUp(sx, sy - 100)).toEqual([]);
    expect(s.state.pauseOnBlur).toBe(true);
  });

  it("the pause row toggles and reports the new state; the label follows", () => {
    const s = screen();
    const a = clickRow(s, 3);
    expect(a).toEqual([{ type: "change", key: "pauseOnBlur", state: { ...STATE, pauseOnBlur: false } }]);
    expect(s.rows()[3].value).toBe("Nie");
    expect(clickRow(s, 3)[0]).toMatchObject({ state: { pauseOnBlur: true } });
  });

  it("pending rows ignore clicks", () => {
    const s = screen(PENDING_BAR);
    expect(clickRow(s, 0)).toEqual([]);
    expect(s.state).toEqual(STATE);
    expect(s.press("inventory")).toEqual([]);
  });

  it("ready rows cycle their values", () => {
    const s = screen({ inventory: null, easy: null, saves: null });
    expect(clickRow(s, 0)[0]).toMatchObject({
      key: "inventory",
      state: { modes: { inventory: "bar" } },
    });
    expect(clickRow(s, 1)[0]).toMatchObject({ key: "easy", state: { modes: { easy: true } } });
    expect(clickRow(s, 2)[0]).toMatchObject({ key: "saves", state: { modes: { saves: "slots" } } });
    expect(s.rows().map((r) => r.value)).toEqual(["Górna belka", "Tak", "Sloty w grze", "Tak"]);
  });

  it("pending rows are darkened, ready rows are not", () => {
    const pending = screen(PENDING_BAR).render();
    const ready = screen({ inventory: null, easy: null, saves: null }).render();
    const win = screen().win;
    // a pixel of the label area of row 0 (left of any text) and of row 3
    const at = (s: typeof pending, row: number) =>
      s.pixels[(win.y + ROW_Y0 + row * ROW_DY + VALUE_H) * s.width + win.x + LABEL_X - 2];
    expect(at(pending, 0)).not.toBe(at(ready, 0));
    expect(at(pending, 3)).toBe(at(ready, 3));
  });

  it("background outside the window is darkened slightly (BACKGROUND_DARKEN, user request)", () => {
    const f = screen().render();
    const dark = darkenPixel(0x7bef, BACKGROUND_DARKEN);
    expect(BACKGROUND_DARKEN).toBeGreaterThan(0);
    expect(BACKGROUND_DARKEN).toBeLessThan(16);
    expect(dark).not.toBe(0x7bef);
    expect(f.pixels[0]).toBe(dark);
    expect(f.pixels[f.pixels.length - 1]).toBe(dark);
  });
});

describe("Disposables", () => {
  it("runs disposers last-first, once, and keeps going after a failure", async () => {
    const d = new Disposables();
    const order: string[] = [];
    d.add("loop", () => void order.push("loop"));
    d.add("audio", async () => {
      order.push("audio");
      throw new Error("closed twice");
    });
    d.add("game", () => void order.push("game"));
    expect(d.size).toBe(3);
    expect(await d.dispose()).toEqual(["audio: closed twice"]);
    expect(order).toEqual(["game", "audio", "loop"]);
    expect(d.size).toBe(0);
    expect(await d.dispose()).toEqual([]);
    expect(order).toHaveLength(3);
  });

  it("non-Error throws are reported as strings", async () => {
    const d = new Disposables();
    d.add("x", () => {
      throw "nope";
    });
    expect(await d.dispose()).toEqual(["x: nope"]);
  });
});

function fakePak(name: string | null, data: Uint8Array): Pak {
  return { entries: name ? [{ name }] : [], read: () => data } as unknown as Pak;
}

function bmData(w: number, h: number, px: number): Uint8Array {
  // 4-byte header (width, height as u16) + RGB565 pixels, see
  const d = new Uint8Array(4 + w * h * 2);
  const v = new DataView(d.buffer);
  v.setUint16(0, w, true);
  v.setUint16(2, h, true);
  for (let i = 0; i < w * h; i++) v.setUint16(4 + i * 2, px, true);
  return d;
}

describe("setupBackground", () => {
  it("no SETUP_OK.BM gives a black screen", () => {
    const s = setupBackground(fakePak(null, new Uint8Array()));
    expect([s.width, s.height]).toEqual([640, 480]);
    expect(s.pixels.every((p) => p === 0)).toBe(true);
  });

  it("an undecodable file gives a black screen", () => {
    const s = setupBackground(fakePak("SETUP_OK.BM", new Uint8Array(3)));
    expect(s.pixels.every((p) => p === 0)).toBe(true);
  });

  it("the picture is copied onto black; color 0 stays black; smaller pictures leave black around", () => {
    const s = setupBackground(fakePak("setup_ok.bm", bmData(4, 2, 0x7bef)));
    expect(s.pixels[0]).toBe(0x7bef);
    expect(s.pixels[3]).toBe(0x7bef);
    expect(s.pixels[4]).toBe(0);
    expect(s.pixels[640 * 2]).toBe(0);
    const z = setupBackground(fakePak("SETUP_OK.BM", bmData(4, 2, 0)));
    expect(z.pixels.every((p) => p === 0)).toBe(true);
  });
});
