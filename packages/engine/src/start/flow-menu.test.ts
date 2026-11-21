// GameFlow driven by the real MainMenu on synthetic pictures: the same events a host would feed. No game files.
import { describe, expect, it } from "vitest";
import { blockFont, flat } from "../gui/fixtures";
import {
  BUTTON_H,
  BUTTON_W,
  BUTTON_X,
  BUTTON_YS,
  LOADING_MIN_MS,
  MainMenu,
  WINDOW_X,
  WINDOW_Y,
  type MainMenuAssets,
  type MainMenuEvent,
} from "../mainmenu";
import { deltaChunk, flxHeader, paletteChunk, rectChunk, u32 } from "../video/synthetic";
import { GameFlow, type FlowCommand, type FlowEvent } from "./flow";

/** chunk 2: the delta record stored literally (no 0xFF bytes), so the RLE unpack copies it (as in mainmenu.test.ts) */
function packedChunk(start: number, runs: [number, number[]][]): number[] {
  const pairs: number[] = [];
  for (const [skip, px] of runs) pairs.push(skip, px.length, ...px);
  const record = [...u32(8 + pairs.length), ...u32(start), ...pairs];
  return [2, 0, ...u32(6 + record.length), ...record];
}

/** 158 x 206 like D1.FLX, 3 frames */
function smokeFlx(): Uint8Array {
  const w = 158;
  return new Uint8Array([
    ...flxHeader(3, w, 206, 12),
    ...paletteChunk([0, 0xffe0, 0x001f]),
    ...rectChunk(0, 0, w, 206),
    ...deltaChunk(0, [[0, [1, 1]]]),
    ...rectChunk(0, 0, w, 206),
    ...packedChunk(100 + 170 * w, [[0, [1]]]),
    ...deltaChunk(0, [[0, [2]]]),
  ]);
}

const assets = (): MainMenuAssets => ({
  background: flat(640, 480, 0x8410),
  truck: flat(20, 10, 0x07e0),
  smoke: smokeFlx(),
  arrows: Array.from({ length: 9 }, (_, i) => flat(2, 2, 0x100 + i)),
  discs: Array.from({ length: 40 }, (_, i) => flat(2, 2, 0x200 + i)),
  loading: flat(210, 80, 0xf81f),
  font: blockFont(),
});

/** What a host does: results go to the flow, readyToLeave becomes menuReady, "done" after quit becomes menuDone. */
class Driver {
  flow = new GameFlow();
  commands: FlowCommand[] = [];
  menu: MainMenu | null = null;
  constructor() {
    this.send({ type: "begin", logos: false, intro: false });
  }
  send(e: FlowEvent): void {
    for (const c of this.flow.handle(e)) {
      this.commands.push(c);
      if (c.type === "openMenu")
        this.menu = new MainMenu(assets(), {
          sound: false,
          onEvent: (m: MainMenuEvent) => m.kind === "result" && this.send({ type: "menuResult", result: m.result }),
        });
      if (c.type === "menuReturnFromIntro") this.menu!.returnFromIntro();
    }
  }
  step(ms: number): void {
    for (let t = 0; t < ms; t++) {
      this.menu!.advance(1);
      if (this.menu!.readyToLeave) this.send({ type: "menuReady" });
      if (this.menu!.phase === "done" && this.menu!.result === "quit") this.send({ type: "menuDone" });
    }
  }
  until(stage: string, max = 5000): void {
    for (let t = 0; t < max && this.flow.stage !== stage; t++) this.step(1);
    expect(this.flow.stage).toBe(stage);
  }
  press(i: number): void {
    this.until("menu");
    this.step(1500); // the window is open
    const m = this.menu!;
    const x = WINDOW_X + BUTTON_X + BUTTON_W / 2;
    const y = WINDOW_Y + BUTTON_YS[i] + BUTTON_H / 2;
    m.pointerMove(x, y);
    m.pointerDown(x, y);
    m.pointerUp(x, y);
  }
  last(): FlowCommand[] {
    return this.commands.splice(0);
  }
}

describe("GameFlow with the real MainMenu", () => {
  it("New game: the intro only after 'Loading' was shown for LOADING_MIN_MS (1 s), then the game", () => {
    const d = new Driver();
    d.press(1);
    d.last();
    d.until("loading");
    expect(d.last()).toEqual([{ type: "prepareIntro" }, { type: "prepareGame" }]);
    d.send({ type: "gameReady", ok: true }); // the game and the movie are ready at once
    d.send({ type: "introReady", ok: true });
    d.step(LOADING_MIN_MS - 5);
    expect(d.flow.stage).toBe("loading");
    d.step(10);
    expect(d.flow.stage).toBe("intro");
    expect(d.last()).toEqual([{ type: "playIntro", from: "newGame" }]);
    d.send({ type: "introEnded" });
    expect(d.flow.stage).toBe("wipe");
    expect(d.last()).toEqual([{ type: "wipe" }]);
    d.send({ type: "wipeDone" });
    expect(d.flow.stage).toBe("game");
    expect(d.last()).toEqual([{ type: "enterGame", openLoad: false }]);
  });

  it("Introduction: movie after 'Loading', then the menu opens again", () => {
    const d = new Driver();
    d.press(0);
    d.until("loading");
    d.send({ type: "introReady", ok: true });
    d.until("intro");
    expect(d.last().at(-1)).toEqual({ type: "playIntro", from: "menu" });
    d.send({ type: "introEnded" });
    expect(d.menu!.phase).toBe("wipe");
    d.until("menu");
    d.step(3000);
    expect(d.menu!.phase).toBe("menu");
  });

  it("Load a game: the game starts at once, the load window comes with it", () => {
    const d = new Driver();
    d.press(2);
    d.until("loading");
    expect(d.last().at(-1)).toEqual({ type: "prepareGame" });
    d.send({ type: "gameReady", ok: true });
    d.step(LOADING_MIN_MS - 5);
    expect(d.flow.stage).toBe("loading");
    d.until("game");
    expect(d.last().at(-1)).toEqual({ type: "enterGame", openLoad: true });
  });

  it("Exit z gry and Esc: the closing animation, then the start screen", () => {
    for (const quit of [
      (d: Driver) => d.press(3),
      (d: Driver) => (d.until("menu"), d.step(1500), d.menu!.keyDown("Escape")),
    ]) {
      const d = new Driver();
      quit(d);
      d.until("start");
      expect(d.last().at(-1)).toEqual({ type: "showStart" });
    }
  });

  it("Enter chooses 'Introduction'", () => {
    const d = new Driver();
    d.until("menu");
    d.step(1500);
    d.menu!.keyDown("Enter");
    d.menu!.keyUp("Enter");
    d.until("loading");
    expect(d.last().at(-1)).toEqual({ type: "prepareIntro" });
  });
});
