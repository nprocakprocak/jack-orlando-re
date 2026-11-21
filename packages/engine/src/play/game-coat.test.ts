// The coat and the item bar. No game files.
import { describe, expect, it } from "vitest";
import { WheelAccumulator } from "../inventory/wheel";
import { PlayGame } from "./game";

describe("play: the options button of the item bar keeps the pointer (without the game files)", () => {
  function barGame(menuOpensOnClose: boolean) {
    const state = { barOpen: true };
    const cursor = { mode: 1, inWindow: false, setTargets: () => undefined, animate: () => undefined };
    const menu = { isOpen: false };
    const bar = {
      get isOpen() {
        return state.barOpen;
      },
      cursorMode: 1,
      cursorIdle: false,
      frame: () => {
        // the button was released over "Opcje": the bar folds at once and the host opens the menu in the same frame
        state.barOpen = false;
        if (menuOpensOnClose) {
          menu.isOpen = true;
          cursor.mode = 0; // openMenu
        }
      },
    };
    const g = Object.create(PlayGame.prototype) as unknown as Record<string, unknown>;
    Object.assign(g, {
      bar,
      menu,
      cursor,
      verbMode: 1,
      inventory: { held: null },
      armed: true,
      talkArmed: true,
      barCursorCountdown: 0,
      interpreter: { playerLocked: () => false },
      dialog: null,
      bullet: { open: false, close: () => undefined },
      notice: { shown: false },
      pendingScene: null,
      pendingMovie: null,
      pendingFilm: null,
      inv: () => undefined,
      edges: () => ({ right: false }),
    });
    return { g, cursor, menu };
  }
  const input = { x: 50, y: 20, down: false, pressed: false, inWindow: true };

  it("the pointer stays mode 0 while the menu is open; the click does not reach the scene", () => {
    const { g, cursor } = barGame(true);
    expect((g as unknown as { barFrame: (i: unknown) => boolean }).barFrame(input)).toBe(true);
    expect(cursor.mode).toBe(0);
    expect((g as unknown as { armed: boolean }).armed).toBe(false);
  });
  it("closing the bar without the menu returns the verb cursor (mode of the verb)", () => {
    const { g, cursor } = barGame(false);
    (g as unknown as { barFrame: (i: unknown) => boolean }).barFrame(input);
    expect(cursor.mode).toBe(1);
  });
  it("leaving the menu restores the verb cursor, or the item cursor with an item in hand", () => {
    const { g, cursor } = barGame(true);
    (g as unknown as { audio: unknown }).audio = { pauseEffects: () => undefined };
    cursor.mode = 0;
    (g as unknown as { leaveMenu: () => void }).leaveMenu();
    expect(cursor.mode).toBe(1);
    (g as unknown as { inventory: unknown }).inventory = { held: { name: "X" } };
    (g as unknown as { leaveMenu: () => void }).leaveMenu();
    expect(cursor.mode).toBe(5);
  });
});

describe("play: the mouse wheel scrolls the coat and the item bar (deviation, synthetic)", () => {
  function wheelGame(over: { coat?: object | null; bar?: object | null }) {
    const g = Object.create(PlayGame.prototype) as any;
    Object.assign(g, { wheelSum: new WheelAccumulator(), coat: null, bar: null, ...over });
    return g as PlayGame;
  }
  const mkCoat = (scrollable = true, isOpen = true) => {
    const steps: number[] = [];
    return { isOpen, scrollable, wheel: (d: number) => (steps.push(d), true), steps };
  };
  const mkBar = (isOpen = true) => {
    const steps: number[] = [];
    return { isOpen, wheel: (d: number) => (steps.push(d), true), steps };
  };

  it("the open coat takes a notch: down = +1, up = -1", () => {
    const coat = mkCoat();
    const g = wheelGame({ coat });
    expect(g.wheel(100)).toBe(true);
    expect(g.wheel(-100)).toBe(true);
    expect(coat.steps).toEqual([1, -1]);
  });
  it("touchpad deltas are summed: one row per 100 px", () => {
    const coat = mkCoat();
    const g = wheelGame({ coat });
    for (let i = 0; i < 8; i++) g.wheel(30);
    expect(coat.steps).toEqual([1, 1]);
  });
  it("region B: not taken, nothing scrolls", () => {
    const coat = mkCoat(false);
    const g = wheelGame({ coat });
    expect(g.wheel(100)).toBe(false);
    expect(coat.steps).toEqual([]);
  });
  it("the open bar takes the wheel when the coat is closed", () => {
    const bar = mkBar();
    const g = wheelGame({ coat: mkCoat(true, false), bar });
    expect(g.wheel(100)).toBe(true);
    expect(bar.steps).toEqual([1]);
  });
  it("coat and bar closed: not taken, and the partial sum is dropped", () => {
    const g = wheelGame({ bar: mkBar(false) });
    expect(g.wheel(100)).toBe(false);
    const coat = mkCoat();
    const h = wheelGame({ coat });
    h.wheel(60);
    coat.isOpen = false;
    h.wheel(10);
    coat.isOpen = true;
    h.wheel(60);
    expect(coat.steps).toEqual([]);
  });
});
