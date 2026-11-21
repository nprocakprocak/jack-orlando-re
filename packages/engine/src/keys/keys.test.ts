import { describe, expect, it } from "vitest";
import { blockFont } from "../gui/fixtures";
import { createSurface } from "../render/surface";
import { BACKSPACE_TABLE, backspaceTarget, sceneChapter, sceneNumber } from "./backspace";
import { DIK, keyActions, mapAvailableIn, PAUSE_CHAR, type KeyContext, type KeyInput } from "./keymap";
import { ANIM_ROLLUP, NOTICE_HEIGHT, NoticeStrip, STATE_NONE, STATE_UNROLLED } from "./notice";

const idle: KeyContext = {
  sceneNoControl: false,
  answerMenuOpen: false,
  captionShown: false,
  bulletMenuOpen: false,
  topBarOpen: false,
  topBarFolded: true,
  macroPlayerLocked: false,
  keysEnabled: true,
  facesShown: false,
  menuVar: true,
  barFlag: false,
  noticeShown: false,
  macroActive: false,
  cursorEnabled: true,
  cursorMode: 0,
  optionsRequest: false,
  coatRequest: false,
  mapAvailable: true,
  backspace: { file: "SC005B.CCG", last: 7 },
  canSave: true,
};
const press = (...keys: number[]): KeyInput => ({
  pressed: new Set(keys),
  down: new Set(keys),
  lastChar: 0,
});
const kinds = (i: KeyInput, c: Partial<KeyContext> = {}) => keyActions(i, { ...idle, ...c }).map((a) => a.kind);

describe("keyActions", () => {
  it("maps each key to its action", () => {
    expect(kinds(press(DIK.F1))).toEqual(["coat"]);
    expect(kinds(press(DIK.F2))).toEqual(["saveWindow"]);
    expect(kinds(press(DIK.F3))).toEqual(["loadWindow"]);
    expect(kinds(press(DIK.F4))).toEqual(["options"]);
    expect(kinds(press(DIK.F5))).toEqual(["quickSave"]);
    expect(kinds(press(DIK.F6))).toEqual(["quickLoad"]);
    expect(kinds(press(DIK.F10))).toEqual(["quit"]);
    expect(kinds(press(DIK.M))).toEqual(["map"]);
    expect(kinds(press(DIK.BACKSPACE))).toEqual(["backspace"]);
    expect(kinds(press())).toEqual([]);
  });

  it("P works only as the character 0x19, never as the P key", () => {
    expect(kinds(press(DIK.P))).toEqual([]);
    expect(kinds({ pressed: new Set([DIK.P]), down: new Set([DIK.P]), lastChar: "p".charCodeAt(0) })).toEqual([]);
    expect(kinds({ pressed: new Set(), down: new Set(), lastChar: PAUSE_CHAR })).toEqual(["pause"]);
  });

  it("F5 and F6 ignore every state; F5 copies the temp save when the scene does not allow saving", () => {
    const busy = {
      macroActive: true,
      noticeShown: true,
      bulletMenuOpen: true,
      sceneNoControl: true,
      menuVar: false,
    };
    expect(kinds(press(DIK.F5), busy)).toEqual(["quickSave"]);
    expect(kinds(press(DIK.F6), busy)).toEqual(["quickLoad"]);
    expect(keyActions(press(DIK.F5), { ...idle, noticeShown: true, canSave: false })).toEqual([
      { kind: "quickSave", notice: false, useTemp: true },
    ]);
    expect(keyActions(press(DIK.F5), idle)).toEqual([{ kind: "quickSave", notice: true, useTemp: false }]);
  });

  it("F10 is blocked by an item in hand (cursor mode 5)", () => {
    expect(kinds(press(DIK.F10), { cursorMode: 5 })).toEqual([]);
    expect(kinds(press(DIK.F10), { cursorMode: 4 })).toEqual(["quit"]);
  });

  it.each([
    ["bulletMenuOpen", true],
    ["facesShown", true],
    ["menuVar", false],
    ["barFlag", true],
    ["noticeShown", true],
    ["macroActive", true],
    ["topBarFolded", false],
    ["optionsRequest", true],
  ] as const)("F2/F3 are blocked by %s = %s", (field, value) => {
    expect(kinds(press(DIK.F2), { [field]: value })).not.toContain("saveWindow");
    expect(kinds(press(DIK.F3), { [field]: value })).not.toContain("loadWindow");
  });

  it("F4 needs the key held and no modifier, but the options request enters without it", () => {
    expect(kinds({ pressed: new Set(), down: new Set([DIK.F4]), lastChar: 0 })).toEqual(["options"]);
    expect(kinds({ pressed: new Set(), down: new Set([DIK.F4, DIK.F4_MODIFIER]), lastChar: 0 })).toEqual([]);
    expect(kinds(press(), { optionsRequest: true })).toEqual(["options"]);
    expect(kinds(press(DIK.F4), { optionsRequest: true, macroActive: true })).toEqual(["options"]);
    expect(kinds(press(DIK.F4), { macroActive: true })).toEqual([]);
  });

  it("M needs map availability and no Ctrl", () => {
    expect(kinds(press(DIK.M), { mapAvailable: false })).toEqual([]);
    expect(kinds({ pressed: new Set([DIK.M]), down: new Set([DIK.M, DIK.CONTROL]), lastChar: 0 })).toEqual([]);
    expect(kinds(press(DIK.M), { topBarFolded: false })).toEqual(["map"]);
  });

  it("F1 and the mouse request open the coat only with the cursor on, no macro and the top bar closed", () => {
    expect(kinds(press(), { coatRequest: true })).toEqual(["coat"]);
    expect(kinds(press(DIK.F1), { cursorEnabled: false })).toEqual([]);
    expect(kinds(press(DIK.F1), { topBarOpen: true })).toEqual([]);
    expect(kinds(press(DIK.F1), { macroActive: true })).toEqual([]);
    expect(kinds(press(DIK.F1), { noticeShown: true })).toEqual([]);
  });

  it("Backspace is blocked by dialogue, captions, locked macros, a disabled flag and scenes without control", () => {
    const blockers: Partial<KeyContext>[] = [
      { sceneNoControl: true },
      { answerMenuOpen: true },
      { captionShown: true },
      { bulletMenuOpen: true },
      { topBarOpen: true },
      { macroPlayerLocked: true },
      { keysEnabled: false },
      { backspace: undefined },
    ];
    for (const c of blockers) expect(kinds(press(DIK.BACKSPACE), c)).toEqual([]);
    expect(keyActions(press(DIK.BACKSPACE), idle)).toEqual([{ kind: "backspace", file: "SC005B.CCG", last: 7 }]);
  });

  it("Esc closes the bullet menu only when it is open", () => {
    expect(kinds(press(DIK.ESCAPE))).toEqual([]);
    expect(kinds(press(DIK.ESCAPE), { bulletMenuOpen: true })).toEqual(["closeBulletMenu"]);
  });

  it("keeps the order of Game_Run when several keys come together", () => {
    expect(kinds(press(DIK.F1, DIK.M, DIK.F5, DIK.F2, DIK.BACKSPACE))).toEqual([
      "backspace",
      "quickSave",
      "saveWindow",
      "map",
      "coat",
    ]);
  });
});

describe("map availability and chapters", () => {
  it("chapter 2 and 3 or the listed scenes", () => {
    expect(mapAvailableIn(1, 5)).toBe(false);
    expect(mapAvailableIn(1, 2)).toBe(true);
    expect(mapAvailableIn(1, 21)).toBe(true);
    expect(mapAvailableIn(2, 40)).toBe(true);
    expect(mapAvailableIn(3, 80)).toBe(true);
    expect(mapAvailableIn(4, 150)).toBe(false);
  });
  it("chapters by scene number", () => {
    expect([0, 30, 31, 74, 75, 99, 100, 199, 200, 250].map(sceneChapter)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 2, 2]);
  });
});

describe("sceneNumber", () => {
  it("is atoi of the characters after SC", () => {
    expect(sceneNumber("SC039.CCG")).toBe(39);
    expect(sceneNumber("SC005B.CCG")).toBe(5);
    expect(sceneNumber("SC000.CCG")).toBe(0);
    expect(sceneNumber("SCXYZ.CCG")).toBe(0);
  });
});

describe("backspaceTarget", () => {
  const none = () => 0;
  it("table has 69 entries, unique per (scene, table)", () => {
    expect(BACKSPACE_TABLE.length).toBe(69);
    const keys = BACKSPACE_TABLE.map((e) => `${e.scene}${e.secondary ? "s" : ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("plain entries ignore the variables", () => {
    expect(backspaceTarget(9, none)).toEqual({ file: "SC005B.CCG", last: 7 });
    expect(backspaceTarget(1, none)).toBeUndefined();
    expect(backspaceTarget(0xf9, none)).toBeUndefined();
  });
  it("scene 3 depends on ROZMZINSP: 1 -> primary, 0 -> secondary, else nothing", () => {
    expect(backspaceTarget(3, () => 1)).toEqual({ file: "SC005B.CCG", last: 0 });
    expect(backspaceTarget(3, () => 0)).toEqual({ file: "SC000B.CCG", last: 3 });
    expect(backspaceTarget(3, () => 2)).toBeUndefined();
  });
  it("every secondary entry has a primary one (the key needs the primary)", () => {
    for (const e of BACKSPACE_TABLE.filter((x) => x.secondary)) {
      expect(BACKSPACE_TABLE.some((p) => !p.secondary && p.scene === e.scene)).toBe(true);
    }
  });
});

describe("NoticeStrip", () => {
  const font = blockFont(7); // glyph 5 wide, advance 6
  const text = Uint8Array.from([65, 66, 67]);
  const scene = createSurface(1280, 480);
  scene.pixels.fill(0x4208);

  it("show: width rounded up to even, level 1, state unrolling", () => {
    const n = new NoticeStrip();
    n.show(0x1cc, text, font, 4);
    expect(n).toMatchObject({
      shown: true,
      anim: 1,
      state: 1,
      wipe: 1,
      slot: 4,
      y: 0x1cc,
      width: 18,
    });
    n.show(400, Uint8Array.from([65]), font);
    expect(n.width).toBe(6);
    n.show(400, Uint8Array.from([65, 0x2f, 0x32, 65]), font); // "A/2A": 6 + 7 + ... odd total
    expect(n.width % 2).toBe(0);
  });

  it("unroll: levels 3, 5, 31 change the picture, 33 ends it", () => {
    const n = new NoticeStrip();
    n.show(400, text, font);
    const levels: number[] = [];
    while (n.unrollStep()) levels.push(n.wipe);
    expect(levels).toEqual(Array.from({ length: 15 }, (_, i) => 3 + 2 * i));
    expect(n.wipe).toBe(33);
    expect(n).toMatchObject({ anim: 0, state: STATE_UNROLLED, shown: true });
  });

  it("roll-up: 32 changing steps (levels 32 1), then the strip is gone", () => {
    const n = new NoticeStrip();
    n.show(400, text, font, 7);
    while (n.unrollStep());
    let steps = 0;
    while (n.rollUpStep()) steps++;
    expect(steps).toBe(32);
    expect(n).toMatchObject({ shown: false, state: STATE_NONE, anim: 0, slot: 0xffff });
    expect(n.picture(scene, 0)).toBeNull();
  });

  it("tickAnim follows g_noticeAnim", () => {
    const n = new NoticeStrip();
    expect(n.tickAnim()).toBe(false);
    n.show(400, text, font);
    expect(n.tickAnim()).toBe(true);
    expect(n.wipe).toBe(3);
    n.anim = ANIM_ROLLUP;
    expect(n.tickAnim()).toBe(true);
    expect(n.wipe).toBe(2);
  });

  it("the F5 path unrolls and folds by itself: 48 frames, then the flag is cleared", () => {
    const n = new NoticeStrip();
    n.showAuto(0x1cc, text, font);
    expect(n.auto).toBe(true);
    let frames = 0;
    while (n.auto) {
      n.tickAuto();
      frames++;
    }
    expect(frames).toBe(48);
    expect(n.shown).toBe(false);
  });

  it("showAuto does nothing while a strip is shown", () => {
    const n = new NoticeStrip();
    n.show(400, text, font);
    n.showAuto(0x1cc, text, font);
    expect(n.y).toBe(400);
    expect(n.auto).toBe(false);
  });

  it("picture: first the scene with a shadow, then the text blended by level / 32", () => {
    const n = new NoticeStrip();
    n.show(400, text, font);
    const first = n.picture(scene, 0)!;
    expect(first.width).toBe(18);
    expect(first.height).toBe(NOTICE_HEIGHT);
    expect(first.pixels.some((p) => p !== 0x4208)).toBe(true); // shadow darkens
    n.unrollStep();
    const mid = n.picture(scene, 0)!;
    n.wipe = 32;
    const full = n.picture(scene, 0)!;
    // glyph A at x 0..4, y 0..6: (2, 3) is fill (white), (0, 0) is outline
    expect(full.pixels[3 * 18 + 2]).toBe(0xffff);
    expect(mid.pixels[3 * 18 + 2]).not.toBe(0xffff);
    expect(mid.pixels[3 * 18 + 2]).not.toBe(0x4208);
    expect(full.pixels[15 * 18 - 1]).toBe(0x4208); // below the text the scene shows through
  });

  it("picture copies the scene under the strip, centred and scrolled", () => {
    const n = new NoticeStrip();
    const s = createSurface(1280, 480);
    n.show(100, Uint8Array.from([65, 66, 67, 68]), font); // width 24, x = (640 - 24) / 2 = 308
    expect(n.x(0)).toBe(308);
    expect(n.x(320)).toBe(628);
    s.pixels[110 * 1280 + 628 + 23] = 0x1234; // row 10, last column: below the 7-row text
    n.unrollStep();
    expect(n.picture(s, 320)!.pixels[10 * 24 + 23]).toBe(0x1234);
  });
});
