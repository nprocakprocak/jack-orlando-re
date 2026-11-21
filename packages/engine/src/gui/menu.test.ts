import { describe, expect, it } from "vitest";
import { defaultConfig, type GameConfig } from "../settings/config";
import { CreditsScroller, PAUSE_TICKS, TICKS_PER_STEP } from "./credits";
import { fakeAssets, flat, FAKE_CREDITS, blockFont } from "./fixtures";
import { GuiMenu, musicVolumeEffect, OPTION_FIELDS, type MenuAction, type MenuScreen } from "./menu";
import { TEXTS_EN, TEXTS_PL } from "./texts";

function setup() {
  const actions: MenuAction[] = [];
  const saved: GameConfig[] = [];
  const config = defaultConfig();
  const menu = new GuiMenu({
    assets: fakeAssets(), texts: TEXTS_PL, config, scene: flat(640, 480, 0xffff),
    onAction: (a) => actions.push(a), persist: (c) => saved.push({ ...c }),
  });
  const click = (x: number, y: number) => {
    menu.pointerDown(x, y);
    menu.pointerUp(x, y);
  };
  return { menu, actions, saved, config, click };
}

// main menu window: (100, 50), 440 x 380, buttons x = 34
const mainBtn = (y: number): [number, number] => [100 + 34 + 20, 50 + y + 10];
const MAIN = { Resume: 325, NewGame: 55, Load: 92, Save: 129, GameCtrl: 166, AudioCtrl: 203, About: 240, Quit: 277 };

describe("main menu", () => {
  it("opens at (100, 50) with the 8 buttons in the original order", () => {
    const { menu } = setup();
    expect(menu.isOpen).toBe(false);
    menu.open();
    expect(menu.screen).toBe("main");
    const screen = flat(640, 480, 0xffff);
    menu.draw(screen);
    expect(screen.pixels[49 * 640 + 100]).toBe(0xffff); // just outside the window
    expect(screen.pixels[50 * 640 + 100]).not.toBe(0xffff);
  });

  for (const [name, y] of Object.entries(MAIN)) {
    it(`clicking ${name} at y=${y}`, () => {
      const { menu, actions, click } = setup();
      menu.open();
      click(...mainBtn(y));
      const expected: Record<string, MenuAction | null> = {
        Resume: { type: "resume" }, NewGame: { type: "newGame" }, Load: { type: "load" }, Save: { type: "save" },
        GameCtrl: null, AudioCtrl: null, About: null, Quit: null,
      };
      expect(actions[0] ?? null).toEqual(expected[name]);
      const screens: Record<string, MenuScreen | null> = {
        Resume: null, NewGame: null, Load: "main", Save: "main", GameCtrl: "gameOptions", AudioCtrl: "audioOptions", About: "about", Quit: "quit",
      };
      expect(menu.screen).toBe(screens[name]);
    });
  }

  it("Load and Save keep the menu open; resume/newGame close it", () => {
    const { menu, actions, click } = setup();
    menu.open();
    click(...mainBtn(MAIN.Load));
    click(...mainBtn(MAIN.Save));
    expect(menu.isOpen).toBe(true);
    click(...mainBtn(MAIN.NewGame));
    expect(menu.isOpen).toBe(false);
    expect(actions.map((a) => a.type)).toEqual(["load", "save", "newGame"]);
  });

  it("Enter = Resume (button 1) and Esc = resume", () => {
    const a = setup();
    a.menu.open();
    a.menu.keyDown("Enter");
    expect(a.actions).toEqual([]); // reported on release
    a.menu.keyUp("Enter");
    expect(a.actions).toEqual([{ type: "resume" }]);
    expect(a.menu.isOpen).toBe(false);
    const b = setup();
    b.menu.open();
    b.menu.keyDown("Escape");
    expect(b.actions).toEqual([{ type: "resume" }]);
  });

  it("clicks and keys do nothing while closed", () => {
    const { menu, actions, click } = setup();
    click(150, 400);
    menu.keyDown("Escape");
    menu.tick(100);
    expect(actions).toEqual([]);
  });

  it("close() ends the menu without an action", () => {
    const { menu, actions } = setup();
    menu.open();
    menu.close();
    expect(menu.isOpen).toBe(false);
    expect(actions).toEqual([]);
  });
});

describe("Opcje gry", () => {
  // window (70, 87)
  const open = () => {
    const s = setup();
    s.menu.open();
    s.click(...mainBtn(MAIN.GameCtrl));
    return s;
  };

  it("toggles write the config and report the change", () => {
    const { actions, config, click } = open();
    click(70 + 253 + 5, 87 + 110 + 5); // TalkOnOff: 1 -> 0
    click(70 + 253 + 5, 87 + 154 + 5); // DialogOnOff
    click(70 + 253 + 5, 87 + 198 + 5); // BulletOnOff
    expect(config).toMatchObject({ talkInterrupt: 0, showText: 0, showBullet: 0 });
    expect(actions).toEqual([
      { type: "setting", key: "talkInterrupt", value: 0 },
      { type: "setting", key: "showText", value: 0 },
      { type: "setting", key: "showBullet", value: 0 },
    ]);
  });

  it("the walk speed slider (max 6) sets 0..6", () => {
    const { menu, config } = open();
    const thumb = 87 + 75 - 8 + 5;
    const x0 = 70 + 253 + 23 + 28 + 3; // value 1 -> thumb at +28
    menu.pointerDown(x0, thumb);
    menu.pointerMove(x0 + 29, thumb); // thumb +57 -> 57/170*6 = 2.01 -> 2
    expect(config.walkSpeed).toBe(2);
    menu.pointerMove(x0 + 29 + 113, thumb); // thumb +170 -> 6
    expect(config.walkSpeed).toBe(6);
    menu.pointerUp(x0 + 29 + 113, thumb);
    expect(config.walkSpeed).toBe(6);
  });

  it("'Main menu' and Esc return to the main menu and save the options", () => {
    const { menu, actions, saved, click } = open();
    click(70 + 170 + 5, 87 + 252 + 5);
    expect(menu.screen).toBe("main");
    expect(saved).toHaveLength(1);
    expect(actions.at(-1)).toEqual({ type: "settingsSaved" });
    click(...mainBtn(MAIN.GameCtrl));
    menu.keyDown("Escape");
    expect(menu.screen).toBe("main");
    expect(saved).toHaveLength(2);
  });

  it("the option window starts from the current config", () => {
    const s = setup();
    s.config.showText = 0;
    s.menu.open();
    s.click(...mainBtn(MAIN.GameCtrl));
    s.click(70 + 253 + 5, 87 + 154 + 5); // 0 -> 1
    expect(s.config.showText).toBe(1);
  });
});

describe("Opcje audio", () => {
  // window (60, 50)
  const open = () => {
    const s = setup();
    s.menu.open();
    s.click(...mainBtn(MAIN.AudioCtrl));
    return s;
  };

  it("volume sliders send preview actions while dragging", () => {
    const { menu, actions, config } = open();
    const y = 50 + 119 - 8 + 5; // SFXVol
    const x = 60 + 273 + 23 + Math.trunc((32 * 170) / 64) + 3;
    menu.pointerDown(x, y);
    menu.pointerMove(x + 17, y);
    menu.pointerUp(x + 17, y);
    expect(config.sfxVol).toBe(Math.trunc((((Math.trunc((32 * 170) / 64)) + 17) / 170) * 64));
    expect(actions.some((a) => a.type === "preview" && a.channel === "sfx")).toBe(true);
    expect(actions.every((a) => a.type !== "preview" || a.channel === "sfx")).toBe(true);
  });

  it("volume slider: grabbed on the track, dragged outside the window, clamped, released far away", () => {
    const { menu, actions, config } = open();
    const trackX = 60 + 273;
    const y = 50 + 163 - 8 + 5; // TalkVol
    menu.pointerDown(trackX + 23 + 85 + 7, y - 20); // on the track, above the thumb band (within the margin: y - 6)
    expect(config.talkVol).toBe(0x40); // 20 px above is outside the zone: nothing happens
    menu.pointerDown(trackX + 23 + 85 + 7, y - 5);
    expect(config.talkVol).toBe(32);
    menu.pointerMove(trackX + 5000, y + 700);
    expect(config.talkVol).toBe(64);
    menu.pointerMove(-3000, 0);
    expect(config.talkVol).toBe(0);
    menu.pointerUp(-3000, 0);
    expect(actions.some((a) => a.type === "preview" && a.channel === "talk")).toBe(true);
    menu.pointerMove(trackX + 100, y);
    expect(config.talkVol).toBe(0); // the drag is over
  });

  it("toggles: stereo swap, surround, music ducking", () => {
    const { actions, config, click } = open();
    click(60 + 370 + 5, 50 + 198 + 5);
    click(60 + 370 + 5, 50 + 242 + 5);
    click(60 + 370 + 5, 50 + 288 + 5);
    expect(config).toMatchObject({ reverseStereo: 1, surround: 0, musicDown: 0 });
    expect(actions.map((a) => (a as { key: string }).key)).toEqual(["reverseStereo", "surround", "musicDown"]);
  });

  it("covers all ten option names", () => {
    expect(new Set(Object.values(OPTION_FIELDS)).size).toBe(10);
  });
});

describe("O grze", () => {
  it("opens over the menu, 'Ok' goes back to the main menu", () => {
    const { menu, click } = setup();
    menu.open();
    click(...mainBtn(MAIN.About));
    expect(menu.screen).toBe("about");
    click(90 + 180 + 5, 70 + 290 + 5);
    expect(menu.screen).toBe("main");
  });

  it("Esc closes the whole menu (the original quirk, confirmed in the game)", () => {
    const { menu, actions } = setup();
    menu.open();
    menu.pointerDown(...mainBtn(MAIN.About));
    menu.pointerUp(...mainBtn(MAIN.About));
    menu.keyDown("Escape");
    expect(menu.isOpen).toBe(false);
    expect(actions).toEqual([{ type: "resume" }]);
  });

  it("the credits scroller runs with real time and stops with the window", () => {
    const { menu, click } = setup();
    menu.open();
    click(...mainBtn(MAIN.About));
    const frame = () => {
      const s = flat(640, 480, 0);
      menu.draw(s);
      return s.pixels.slice();
    };
    const before = frame();
    menu.tick(1000);
    expect(frame()).toEqual(before); // still in the 1.5 s pause
    menu.tick(1000);
    expect(frame()).not.toEqual(before);
    click(90 + 180 + 5, 70 + 290 + 5);
    expect(() => menu.tick(100)).not.toThrow();
  });
});

describe("quit confirmation", () => {
  // buttons: 'Tak' left, 'Nie' right
  function quitButtons(menu: GuiMenu) {
    const s = flat(640, 480, 0xffff);
    menu.draw(s);
    return s;
  }

  it("from the menu: Nie and Esc go back to the main menu", () => {
    const { menu, actions, click } = setup();
    menu.open();
    click(...mainBtn(MAIN.Quit));
    expect(menu.screen).toBe("quit");
    menu.keyDown("Escape");
    expect(menu.screen).toBe("main");
    click(...mainBtn(MAIN.Quit));
    quitButtons(menu);
    expect(actions).toEqual([]);
  });

  it("layout: 40 px margin, buttons side by side", () => {
    // Polish text width in the block font: 5 + 1 per character, "/N" and '=' aside; just check the formula
    const assets = fakeAssets();
    const { menu } = setup();
    menu.open("quit");
    const s = flat(640, 480, 0xffff);
    menu.draw(s);
    const font = blockFont();
    const textW = (t: string) => t.length * 6; // all glyphs 5 wide + 1 spacing
    expect(font.glyphs[65].width).toBe(5);
    const bw = textW(" Tak ") + 20; // 50 -> even
    const W = Math.max(textW(TEXTS_PL.confirmQuit) + 40, 40 + 30 + 2 * bw);
    const x = Math.trunc((640 - W - (W % 2)) / 2);
    const H = 0x56 + 22;
    const y = Math.trunc((480 - H) / 2);
    expect(s.pixels[y * 640 + x]).not.toBe(0xffff);
    expect(s.pixels[(y - 1) * 640 + x]).toBe(0xffff);
    expect(s.pixels[y * 640 + x - 1]).toBe(0xffff);
    expect(assets.credits).toBe(FAKE_CREDITS);
  });

  it("F10: 'Tak' quits (Enter = button 1 = Tak), 'Nie' resumes the game", () => {
    const a = setup();
    a.menu.open("quit");
    a.menu.keyDown("Enter");
    a.menu.keyUp("Enter");
    expect(a.actions).toEqual([{ type: "quit" }]);
    expect(a.menu.isOpen).toBe(false);

    const b = setup();
    b.menu.open("quit");
    b.menu.keyDown("Escape");
    expect(b.actions).toEqual([{ type: "resume" }]);
    expect(b.menu.isOpen).toBe(false);
  });

  it("clicking the right button ('Nie') after F10 resumes; the left one quits", () => {
    for (const [side, expected] of [["left", "quit"], ["right", "resume"]] as const) {
      const { menu, actions, click } = setup();
      menu.open("quit");
      // block font: text width 6/char: " Tak " = 30 -> bw 50; W = max(36*6+40, 140) = 256 -> x = 192; H = 108 -> y = 186
      const bw = 50;
      const W = 256;
      const x0 = 192 + (side === "left" ? Math.trunc((W - 2) / 2) - 14 - bw : Math.trunc((W - 2) / 2) + 15) + 5;
      click(x0, 186 + 108 - 13 - 32 + 5);
      expect(actions.map((a) => a.type)).toEqual([expected]);
    }
  });
});

describe("texts", () => {
  it("Polish and English tables have the same keys, English differs only where the exe has English", () => {
    expect(Object.keys(TEXTS_EN)).toEqual(Object.keys(TEXTS_PL));
    expect(TEXTS_PL.load).toBe("Załaduj grę");
    expect(TEXTS_EN.load).toBe("Load a game");
    expect(TEXTS_EN.yes).toBe(TEXTS_PL.yes);
  });
});

describe("musicVolumeEffect", () => {
  it("stops below 5 when playing, resumes above 5 when muted, 5 does nothing", () => {
    expect(musicVolumeEffect(4, true, false)).toBe("stop");
    expect(musicVolumeEffect(4, false, false)).toBeNull();
    expect(musicVolumeEffect(6, false, true)).toBe("resume");
    expect(musicVolumeEffect(6, true, false)).toBeNull();
    expect(musicVolumeEffect(5, true, true)).toBeNull();
  });
});

describe("CreditsScroller", () => {
  const fonts = { big: blockFont(13), small: blockFont(9) };
  const make = () => new CreditsScroller(FAKE_CREDITS, fonts);
  const rowOf = (s: CreditsScroller, y: number) => s.view().pixels.slice(y * 400, (y + 1) * 400);
  const ticks = (s: CreditsScroller, n: number) => {
    for (let i = 0; i < n; i++) s.tick();
  };

  it("does nothing before it runs", () => {
    const s = make();
    const before = s.view().pixels.slice();
    ticks(s, 1000);
    expect(s.view().pixels).toEqual(before);
    expect(s.pausedTicks).toBe(PAUSE_TICKS);
  });

  it("pauses 300 ticks (1.5 s), then moves 2 rows every 5th tick (80 px/s)", () => {
    const s = make();
    s.running = true;
    const before = s.view().pixels.slice();
    ticks(s, PAUSE_TICKS - 1);
    expect(s.view().pixels).toEqual(before);
    ticks(s, 1); // pause hits 0, 1st counting tick
    expect(s.view().pixels).toEqual(before);
    ticks(s, TICKS_PER_STEP - 1);
    expect(s.view().pixels).not.toEqual(before);
    // the first text row (title, "=" kind, drawn at y = 0..12) moved up by 2 rows and is darkened at the top
    const moved = rowOf(s, 4);
    expect(moved.some((p) => p !== 0)).toBe(true);
  });

  it("is 40 steps (80 rows) per second", () => {
    const s = new CreditsScroller([{ kind: "#", style: "2", text: "x" }], fonts);
    s.running = true;
    ticks(s, PAUSE_TICKS);
    s.view().pixels[120 * 400 + 7] = 0x1234;
    ticks(s, 200); // 1 s of 5 ms ticks = 40 steps = 80 rows
    expect(s.view().pixels[40 * 400 + 7]).not.toBe(0); // darkened later at the top, but moved up by 80
  });

  it("a '!' line draws a new pause", () => {
    const s = make();
    s.running = true;
    let seen = false;
    for (let i = 0; i < 20000 && !seen; i++) {
      s.tick();
      if (i > PAUSE_TICKS + 5 && s.pausedTicks === PAUSE_TICKS) seen = true;
    }
    expect(seen).toBe(true);
  });

  it("loops over the credits text without end", () => {
    const s = make();
    s.running = true;
    expect(() => ticks(s, 400_000)).not.toThrow();
  });
});
