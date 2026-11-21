// Main menu: synthetic tests only — no game files (user decision 2026-11-04).
import { describe, expect, it } from "vitest";
import { blend565 } from "../cursor/lens";
import { MediaError } from "../formats/media";
import { darkenPixel } from "../gui/darken";
import { blockFont, flat } from "../gui/fixtures";
import { wipeOrder } from "../launcher/wipe";
import { createSurface, type Surface16 } from "../render/surface";
import { deltaChunk, flxHeader, paletteChunk, rectChunk, u32 } from "../video/synthetic";
import {
  BUTTON_H,
  BUTTON_W,
  BUTTON_X,
  BUTTON_YS,
  DEFAULT_MUSIC_VOLUME,
  fadeInSteps,
  fadeOutSteps,
  INTERLACE_TOTAL_MS,
  interlaceRows,
  interlaceRowsAt,
  LOADING_MIN_MS,
  LOADING_X,
  LOADING_Y,
  MAIN_MENU_TEXTS_EN,
  MainMenu,
  MENU_MUSIC,
  menuBytes,
  MenuSmoke,
  MenuWindow,
  MAIN_MENU_TEXTS_PL,
  PRESENT_MS,
  REVEAL_TOTAL_MS,
  revealPixels,
  revealPixelsAt,
  sleepMs,
  SMOKE_X,
  SMOKE_Y,
  tintRect,
  TINT_COLOR,
  TICK_MS,
  TRUCK_X,
  TRUCK_Y,
  WINDOW_H,
  WINDOW_W,
  WINDOW_X,
  WINDOW_Y,
  type MainMenuAssets,
  type MainMenuEvent,
  type MainMenuPhase,
} from "./index";

const BG = 0x8410;
const TRUCK = 0x07e0;
const LADEN = 0xf81f;
const SMOKE = 0xffe0;

/** chunk 2: the delta record stored literally (no 0xFF bytes), so the RLE unpack copies it */
function packedChunk(start: number, runs: [number, number[]][]): number[] {
  const pairs: number[] = [];
  for (const [skip, px] of runs) pairs.push(skip, px.length, ...px);
  const record = [...u32(8 + pairs.length), ...u32(start), ...pairs];
  return [2, 0, ...u32(6 + record.length), ...record];
}

/** 158 x 206 like D1.FLX: [palette, rect, delta], [rect, packed], [delta] = 5 calls a loop, 3 frames */
function smokeFlx(): Uint8Array {
  const w = 158;
  const at = (x: number, y: number) => y * w + x;
  const bytes = [
    ...flxHeader(3, w, 206, 12),
    ...paletteChunk([0, SMOKE, 0x001f]),
    ...rectChunk(0, 0, w, 206),
    ...deltaChunk(at(0, 0), [[0, [1, 1]]]),
    ...rectChunk(0, 0, w, 206),
    ...packedChunk(at(100, 170), [[0, [1]]]),
    ...deltaChunk(at(0, 0), [[0, [2]]]),
  ];
  return new Uint8Array(bytes);
}

function fakeAssets(): MainMenuAssets {
  return {
    background: flat(640, 480, BG),
    truck: flat(20, 10, TRUCK),
    smoke: smokeFlx(),
    arrows: Array.from({ length: 9 }, (_, i) => flat(2, 2, 0x100 + i)),
    discs: Array.from({ length: 40 }, (_, i) => flat(2, 2, 0x200 + i)),
    loading: flat(210, 80, LADEN),
    font: blockFont(),
  };
}

function px(s: Surface16, x: number, y: number): number {
  return s.pixels[y * s.width + x];
}

/** Advances 1 ms at a time until `phase`; returns the ms it took. */
function runUntil(m: MainMenu, phase: MainMenuPhase, max = 10000): number {
  for (let ms = 0; ms <= max; ms++) {
    if (m.phase === phase) return ms;
    m.advance(1);
  }
  throw new Error(`no ${phase} within ${max} ms (at ${m.phase})`);
}

function menuAt(events: MainMenuEvent[] = [], opts = {}): MainMenu {
  const m = new MainMenu(fakeAssets(), { onEvent: (e) => events.push(e), ...opts });
  runUntil(m, "menu");
  return m;
}

const buttonCenter = (i: number): [number, number] => [
  WINDOW_X + BUTTON_X + BUTTON_W / 2,
  WINDOW_Y + BUTTON_YS[i] + BUTTON_H / 2,
];

function click(m: MainMenu, i: number): void {
  const [x, y] = buttonCenter(i);
  m.pointerDown(x, y);
  m.pointerUp(x, y);
}

const results = (ev: MainMenuEvent[]) => ev.flatMap((e) => (e.kind === "result" ? [e.result] : []));
const music = (ev: MainMenuEvent[]) => ev.flatMap((e) => (e.kind === "music" ? [e.command] : []));

describe("timing", () => {
  it("Timer_Sleep waits more than ms/5 ticks", () => {
    expect([sleepMs(5), sleepMs(10), sleepMs(0x32)]).toEqual([10, 15, 55]);
  });

  it("the interlaced blackout: 40 sleeps after rows 0, 6... then 55 ms", () => {
    expect(INTERLACE_TOTAL_MS).toBe(455);
    expect([0, 9, 10, 390, 399, 400, 455].map(interlaceRowsAt)).toEqual([1, 1, 7, 235, 235, 240, 240]);
  });

  it("blackens row 2r from the top and 479 - 2r from the bottom", () => {
    const s = flat(640, 480, 7);
    interlaceRows(s, 0, 2);
    expect([0, 2, 477, 479].map((y) => px(s, 5, y))).toEqual([0, 0, 0, 0]);
    expect([1, 3, 4, 476, 478].map((y) => px(s, 5, y))).toEqual([7, 7, 7, 7, 7]);
  });

  it("the reveal copies the background in the stripe order, 0x1900 pixels a 10 ms sleep", () => {
    expect(REVEAL_TOTAL_MS).toBe(480);
    expect(revealPixelsAt(0)).toBe(1);
    expect(revealPixelsAt(470)).toBe(47 * 0x1900 + 1);
    expect(revealPixelsAt(480)).toBe(640 * 480);
    const bg = createSurface(640, 480);
    bg.pixels.forEach((_, i) => (bg.pixels[i] = (i % 1000) + 1));
    const s = createSurface(640, 480);
    revealPixels(s, bg, 0, 10);
    const o = wipeOrder();
    expect(s.pixels[o[9]]).toBe(bg.pixels[o[9]]);
    expect(s.pixels[o[10]]).toBe(0);
    revealPixels(s, bg, 10, 640 * 480);
    expect(s.pixels).toEqual(bg.pixels);
  });

  it("music fades: in one step per unit, out by 2 while above 0", () => {
    expect(fadeInSteps(35)).toBe(35);
    expect(fadeInSteps(0)).toBe(0);
    expect([35, 3, 2, 0].map((v) => fadeOutSteps(v))).toEqual([17, 1, 0, 0]);
  });
});

describe("MenuSmoke (Menu_FlxStep)", () => {
  it("one chunk per call (palette with it), a rectangle costs a call, wraps after the frame count", () => {
    const s = new MenuSmoke(smokeFlx());
    s.step(); // palette + rect
    expect([s.frames, px(s.surface, 0, 0)]).toEqual([0, 0]);
    s.step(); // delta
    expect([s.frames, px(s.surface, 0, 0), px(s.surface, 1, 0)]).toEqual([1, SMOKE, SMOKE]);
    s.step(); // rect
    s.step(); // packed
    expect([s.frames, px(s.surface, 100, 170)]).toEqual([2, SMOKE]);
    s.step(); // delta: colour 2
    expect([s.frames, px(s.surface, 0, 0), px(s.surface, 1, 0)]).toEqual([3, 0x001f, SMOKE]);
    s.advance(); // frames == 3 -> back to 0x14, palette + rect
    expect([s.frames, s.pos > 0x14, s.calls]).toEqual([0, true, 6]);
    s.advance();
    // the picture is never cleared: pixel (100, 170) is still there
    expect([s.frames, px(s.surface, 0, 0), px(s.surface, 100, 170)]).toEqual([1, SMOKE, SMOKE]);
  });

  it("errors: bad magic, truncated chunk, short palette", () => {
    expect(() => new MenuSmoke(new Uint8Array(20))).toThrow(MediaError);
    const cut = smokeFlx().slice(0, 0x14 + 3);
    expect(() => new MenuSmoke(cut).step()).toThrow(/truncated/);
    const short = new Uint8Array([...flxHeader(1, 2, 2), 4, 0, ...u32(6 + 4), 1, 2, 3, 4]);
    expect(() => new MenuSmoke(short).step()).toThrow(/palette/);
    const big = new Uint8Array([...flxHeader(1, 2, 2), 1, 0, ...u32(1000)]);
    expect(() => new MenuSmoke(big).step()).toThrow(/bad size/);
  });
});

describe("MenuWindow", () => {
  const bg = flat(640, 480, BG);
  const w = new MenuWindow(blockFont(), bg, MAIN_MENU_TEXTS_PL);

  it("geometry of Launcher_Run: 230 x 235 at (205, 190), buttons 180 x 34 at x 24", () => {
    expect([WINDOW_X, WINDOW_Y, WINDOW_W, WINDOW_H, BUTTON_X, BUTTON_W, BUTTON_H]).toEqual([
      205, 190, 230, 235, 24, 180, 34,
    ]);
    expect([...BUTTON_YS]).toEqual([60, 98, 136, 174]);
  });

  it("tint: frame interior moved 2/32 to blue, the last 4 columns and rows untinted", () => {
    const inner = darkenPixel(BG, 16);
    expect(px(w.built, 100, 150)).toBe(blend565(inner, TINT_COLOR, 2));
    expect(px(w.built, 100, 150)).not.toBe(inner);
    // x = 226 is inside the 5 px frame on the right (level 22), not tinted
    expect(px(w.built, 226, 100)).toBe(darkenPixel(BG, 22));
    expect(px(w.built, 100, 231)).toBe(darkenPixel(BG, 22));
  });

  it("tintRect leaves the colour key alone", () => {
    const s = flat(3, 1, 0x1234);
    s.pixels[1] = 0;
    tintRect(s, 0, 0, 3, 1, TINT_COLOR, 2);
    expect(s.pixels[1]).toBe(0);
    expect(s.pixels[0]).toBe(blend565(0x1234, TINT_COLOR, 2));
  });

  it("hit test on the buttons with the raw mouse", () => {
    expect(w.hit(...buttonCenter(2))).toBe(2);
    expect(w.hit(WINDOW_X + BUTTON_X - 1, WINDOW_Y + 70)).toBe(-1);
    expect(w.hit(WINDOW_X + BUTTON_X, WINDOW_Y + 60)).toBe(0);
    expect(w.hit(WINDOW_X + BUTTON_X + BUTTON_W - 1, WINDOW_Y + 60 + BUTTON_H - 1)).toBe(0);
    expect(w.hit(WINDOW_X + 100, WINDOW_Y + 95)).toBe(-1);
  });

  it("open blend: level 0 is the background, 30 almost the window", () => {
    w.showLevel(0);
    expect(px(w.body, 100, 150)).toBe(BG);
    w.showLevel(30);
    expect(px(w.body, 100, 150)).toBe(blend565(BG, px(w.built, 100, 150), 30));
  });

  it("texts: PL from the exe, the title's diamonds are glyph 4", () => {
    expect(MAIN_MENU_TEXTS_PL).toMatchObject({
      intro: "Wprowadzenie",
      newGame: "Nowa gra",
      load: "Załaduj grę",
      quit: "Wyjście z gry",
    });
    expect([...menuBytes(MAIN_MENU_TEXTS_PL.title)]).toEqual([
      0x2f,
      0x32,
      4,
      0x3d,
      ...[..."MENU GRY"].map((c) => c.charCodeAt(0)),
      0x3d,
      4,
    ]);
    expect([...menuBytes("ł")]).toEqual([0x92]);
  });
});

describe("MainMenu flow", () => {
  it("blackout 455 ms -> music fade-in -> reveal 480 ms -> 11 presents of the window", () => {
    const ev: MainMenuEvent[] = [];
    const prev = flat(640, 480, 0x1111);
    const m = new MainMenu(fakeAssets(), { previous: prev, onEvent: (e) => ev.push(e) });
    m.advance(10);
    let f = m.frame();
    expect([px(f, 3, 0), px(f, 3, 12), px(f, 3, 14), px(f, 3, 467)]).toEqual([0, 0, 0x1111, 0]);
    expect(prev.pixels[0]).toBe(0x1111); // the caller's screen is not touched
    expect(runUntil(m, "musicIn")).toBe(INTERLACE_TOTAL_MS - 10);
    expect(music(ev).slice(0, 2)).toEqual([{ op: "stop" }, { op: "start", file: MENU_MUSIC }]);
    expect(runUntil(m, "reveal")).toBe(35 * 15);
    const vols = music(ev)
      .filter((c) => c.op === "volume")
      .map((c) => (c as { value: number }).value);
    expect(vols).toEqual([...Array.from({ length: 35 }, (_, i) => i), 35]);
    expect(runUntil(m, "open")).toBe(REVEAL_TOTAL_MS);
    f = m.frame();
    expect(px(f, 0, 0)).toBe(BG);
    const t0 = m.elapsedMs;
    runUntil(m, "menu");
    // 11 presents: the first one after the reveal, then 10 more
    const presents = Math.ceil(t0 / PRESENT_MS);
    expect(m.elapsedMs).toBe(Math.ceil((presents + 10) * PRESENT_MS));
    expect([m.windowLevel, m.buttonsVisible]).toEqual([30, true]);
  });

  it("without sound: no music and no fade waits", () => {
    const ev: MainMenuEvent[] = [];
    const m = new MainMenu(fakeAssets(), { sound: false, onEvent: (e) => ev.push(e) });
    runUntil(m, "reveal");
    expect(m.elapsedMs).toBe(INTERLACE_TOTAL_MS);
    click(menuAfter(m), 3);
    runUntil(m, "done");
    expect(ev).toEqual([{ kind: "result", result: "quit" }]);
  });

  it("smoke: first step 10 ticks after the menu starts, then every 3 ticks at a present; drawn over the window", () => {
    const m = menuAt();
    expect(m.smokeShown).toBe(false);
    const calls0 = m.smoke.calls; // the step before the music (sprite not shown)
    expect(calls0).toBe(1);
    m.advance(9 * TICK_MS - 1); // at most 9 of the 10 ticks
    expect(m.smokeShown).toBe(false);
    m.advance(2 * TICK_MS + PRESENT_MS);
    expect([m.smokeShown, m.smoke.calls]).toEqual([true, 2]);
    m.advance(1000);
    // about 3 ticks + up to a present per step
    expect(m.smoke.calls).toBeGreaterThanOrEqual(2 + Math.floor(1000 / (4 * TICK_MS + PRESENT_MS)));
    expect(m.smoke.calls).toBeLessThanOrEqual(2 + Math.ceil(1000 / (3 * TICK_MS)));
    // (409, 209) is inside the window and under the smoke pixel (100, 170)
    expect(px(m.frame(), SMOKE_X + 100, SMOKE_Y + 170)).toBe(SMOKE);
  });

  it("truck: shifted sprite for 6 ticks, background truck for 6 (shaking), only while the menu runs", () => {
    const m = menuAt();
    const lit: boolean[] = [];
    for (let i = 0; i < 24 * TICK_MS; i++) {
      m.advance(1);
      if (i % TICK_MS === TICK_MS - 1) lit.push(m.truckShifted);
    }
    const flips = lit.filter((v, i) => i > 0 && v !== lit[i - 1]).length;
    expect(flips).toBeGreaterThanOrEqual(3);
    expect(lit.filter(Boolean).length).toBeGreaterThanOrEqual(11);
    expect(lit.filter(Boolean).length).toBeLessThanOrEqual(13);
    while (!m.truckShifted) m.advance(1);
    m.advance(PRESENT_MS);
    expect(px(m.frame(), TRUCK_X + 1, TRUCK_Y + 1)).toBe(TRUCK);
  });

  it("arrow cursor: drawn with its top-left at the mouse; frame follows horizontal motion every 7 ticks", () => {
    const m = menuAt();
    expect(m.arrowFrame).toBe(4); // the mouse stood still at x 0 since the timer started
    m.pointerMove(600, 20);
    m.advance(7 * TICK_MS);
    expect(m.arrowFrame).toBe(5);
    const f = m.frame();
    expect(px(f, 600, 20)).toBe(0x100 + m.arrowFrame);
    expect(px(f, 599, 20)).toBe(BG);
    for (let x = 600; x < 640; x++) {
      m.pointerMove(x, 20);
      m.advance(7 * TICK_MS);
    }
    expect(m.arrowFrame).toBe(8);
    m.advance(7 * TICK_MS * 6);
    expect(m.arrowFrame).toBe(4);
    m.pointerLeave();
    expect(px(m.frame(), 639, 20)).toBe(BG);
  });

  it("New game: close blend, music fade-out, then LADEN and the result; ready after LOADING_MIN_MS (1000 ms)", () => {
    const ev: MainMenuEvent[] = [];
    const m = menuAt(ev);
    ev.length = 0;
    const [x, y] = buttonCenter(1);
    m.pointerDown(x, y);
    expect(m.pressedButton).toBe(1);
    m.pointerUp(x, y);
    expect([m.phase, m.chosen]).toEqual(["close", "Start"]);
    runUntil(m, "musicOut");
    expect([m.windowLevel, m.buttonsVisible]).toEqual([-1, false]);
    runUntil(m, "loading");
    const vols = music(ev)
      .filter((c) => c.op === "volume")
      .map((c) => (c as { value: number }).value);
    expect(vols[0]).toBe(DEFAULT_MUSIC_VOLUME);
    expect(vols).toHaveLength(17);
    expect(music(ev).at(-1)).toEqual({ op: "stop" });
    expect(results(ev)).toEqual(["newGame"]);
    const f = m.frame();
    expect(px(f, LOADING_X, LOADING_Y)).toBe(LADEN);
    expect(px(f, TRUCK_X + 1, TRUCK_Y + 1)).toBe(BG); // the truck sprite is removed (background truck)
    // [engine, user decision] a spinning disc at the mouse instead of no cursor
    m.pointerMove(50, 60);
    const d0 = m.discFrame;
    m.advance(2 * TICK_MS * 3);
    expect(m.discFrame).toBe((d0 + 3) % 40);
    expect(px(m.frame(), 50, 60)).toBe(0x200 + m.discFrame);
    m.pointerLeave();
    expect(px(m.frame(), 50, 60)).toBe(BG);
    expect(m.readyToLeave).toBe(m.loadingMs >= LOADING_MIN_MS);
    m.advance(LOADING_MIN_MS - m.loadingMs - 1);
    expect(m.readyToLeave).toBe(false);
    m.advance(1);
    expect(m.readyToLeave).toBe(true);
  });

  it("Load a game gives load; a press released elsewhere is cancelled", () => {
    const ev: MainMenuEvent[] = [];
    const m = menuAt(ev);
    const [x, y] = buttonCenter(2);
    m.pointerDown(x, y);
    m.pointerMove(x, y + BUTTON_H);
    expect(m.pressedButton).toBe(-1);
    m.pointerUp(x, y + BUTTON_H);
    expect(m.phase).toBe("menu");
    click(m, 2);
    runUntil(m, "loading");
    expect(results(ev)).toEqual(["load"]);
  });

  it("Esc and Exit z gry quit after the closing animation; the screen ends black", () => {
    for (const how of ["esc", "button"]) {
      const ev: MainMenuEvent[] = [];
      const m = menuAt(ev);
      if (how === "esc") m.keyDown("Escape");
      else click(m, 3);
      expect(m.chosen).toBe(how === "esc" ? null : "Quit");
      runUntil(m, "quitting");
      expect(results(ev)).toEqual([]);
      expect(runUntil(m, "done")).toBe(INTERLACE_TOTAL_MS);
      expect(results(ev)).toEqual(["quit"]);
      expect(m.frame().pixels.every((p) => p === 0)).toBe(true);
    }
  });

  it("Enter presses button 1 (Introduction) until released -> intro, disc cursor, then back to the menu", () => {
    const ev: MainMenuEvent[] = [];
    const m = menuAt(ev);
    m.advance(500);
    m.pointerMove(10, 10);
    m.keyDown("Enter");
    expect([m.phase, m.pressedButton]).toEqual(["menu", 0]);
    m.keyUp("Enter");
    expect(m.chosen).toBe("Intro");
    runUntil(m, "intro");
    expect(results(ev)).toEqual(["intro"]);
    expect(m.waitCursor).toBe(true);
    const d0 = m.discFrame;
    m.advance(2 * TICK_MS * 5);
    expect(m.discFrame).toBe((d0 + 5) % 40);
    const f = m.frame();
    expect(px(f, LOADING_X, LOADING_Y)).toBe(LADEN);
    expect(px(f, 10, 10)).toBe(0x200 + m.discFrame);
    expect(m.readyToLeave).toBe(m.loadingMs >= LOADING_MIN_MS);
    while (!m.readyToLeave) m.advance(1);
    expect(m.loadingMs).toBeGreaterThanOrEqual(LOADING_MIN_MS);
    expect(m.loadingMs).toBeLessThan(LOADING_MIN_MS + 1);
    expect(() => menuAt().returnFromIntro()).toThrow(/phase menu/);
    m.returnFromIntro(flat(640, 480, 0x3333));
    expect(m.phase).toBe("wipe");
    expect(m.result).toBe(null);
    runUntil(m, "musicIn");
    expect(m.waitCursor).toBe(false);
    runUntil(m, "menu");
    expect(px(m.frame(), LOADING_X, LOADING_Y)).not.toBe(LADEN);
    expect(m.smokeShown).toBe(true); // the sprite stays shown from the first visit
  });

  it("input before the menu runs is ignored", () => {
    const m = new MainMenu(fakeAssets());
    runUntil(m, "open");
    click(m, 1);
    m.keyDown("Escape");
    expect(m.phase).toBe("open");
    runUntil(m, "menu");
    expect(m.chosen).toBe(null);
  });

  it("English texts can be used", () => {
    const m = menuAt([], { texts: MAIN_MENU_TEXTS_EN });
    expect(m.phase).toBe("menu");
  });
});

function menuAfter(m: MainMenu): MainMenu {
  runUntil(m, "menu");
  return m;
}
