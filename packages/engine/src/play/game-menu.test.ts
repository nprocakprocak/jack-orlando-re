// Menus and the cursor, on invented state. No game files.
import { describe, expect, it } from "vitest";
import { Cursor } from "../cursor";
import { DIK, keyActions } from "../keys";
import { Variables } from "../script/interpreter";
import { defaultConfig } from "../settings/config";
import { PlayAudio } from "./audio";
import { PlayGame } from "./game";
import { TimedBackend, shell } from "./testing";

describe("play: sound options of the menu (without the game files)", () => {
  const prepared = (frames = 4000) => ({
    rate: 22050,
    channels: [new Float32Array(frames)],
    loopLength: 0,
    loopStart: 0,
  });
  const cfg = () => ({ ...defaultConfig() });

  it("applyConfig takes the options into the sound; applySetting stops the music below 5 and restarts it above 5", () => {
    const backend = new TimedBackend();
    const a = new PlayAudio(backend);
    const c = { ...cfg(), sfxVol: 10, talkVol: 20, reverseStereo: 1, musicDown: 0, showText: 0 };
    a.applyConfig(c);
    expect([
      a.config.sfxVolume,
      a.config.talkVolume,
      a.config.revStereo,
      a.config.musicDown,
      a.config.dialogText,
    ]).toEqual([10, 20, true, false, false]);
    expect(a.sfx.options.sfxVolume).toBe(10);
    expect(a.sfx.options.swapChannels).toBe(true);

    a.music.trackName = "TR.PMS";
    a.mixer.playStream(5, { read: () => null } as never, { volume: 40 });
    const music = cfg();
    music.musicVol = 3;
    a.applySetting("musicVol", music);
    expect(a.music.playing).toBe(false); // MusicVol < 5 and the music plays -> Music_Stop
    expect(a.music.musicVolume).toBe(3);
    music.musicVol = 5;
    a.applySetting("musicVol", music);
    expect(a.music.musicVolume).toBe(5); // 5 itself does nothing
  });

  it("the stereo graph hears surround and reverse (Snd_CopyStereo)", () => {
    const calls: [boolean, boolean][] = [];
    const a = new PlayAudio(new TimedBackend());
    a.stereoFx = { update: (s, r) => calls.push([s, r]) };
    const c = cfg();
    c.surround = 0;
    c.reverseStereo = 1;
    a.applySetting("reverseStereo", c);
    expect(calls.at(-1)).toEqual([false, true]);
  });

  it("slider samples: both channels idle -> the sample on 1 and 2; playing -> only the volume follows; music does nothing", () => {
    const backend = new TimedBackend();
    const a = new PlayAudio(backend);
    a.loadPreviews(undefined, undefined);
    a.preview("sfx", 30);
    expect(backend.voices.length).toBe(0); // no sample loaded: silence
    (a as unknown as { previews: Record<string, unknown> }).previews.sfx = prepared();
    a.preview("sfx", 30);
    expect(a.mixer.isPlaying(1) && a.mixer.isPlaying(2)).toBe(true);
    expect([a.mixer.level(1), a.mixer.level(2)]).toEqual([60, 60]); // level = 2 * game volume
    a.preview("sfx", 10);
    expect(backend.voices.filter((v) => v.kind === "sound").length).toBe(2); // not started again
    expect(a.mixer.level(1)).toBe(20);
    a.preview("music", 50);
    expect(backend.voices.length).toBe(2);
  });

  it("the effect channels 1..4 are silent while the menu is open and come back at their level", () => {
    const backend = new TimedBackend();
    const a = new PlayAudio(backend);
    a.mixer.play(1, prepared(), { volume: 50 });
    a.mixer.play(3, prepared(), { volume: 70 });
    a.mixer.playStream(5, { read: () => null } as never, { volume: 40 });
    a.pauseEffects(true);
    expect([a.mixer.level(1), a.mixer.level(3), a.mixer.level(5)]).toEqual([0, 0, 40]); // the music plays on
    a.pauseEffects(true); // twice does not lose the levels
    a.pauseEffects(false);
    expect([a.mixer.level(1), a.mixer.level(3)]).toEqual([50, 70]);
  });
});

describe("play: the cursor over the answer menu (synthetic)", () => {
  it("the arrow while the menu is open, whatever the mode was; the mode comes back when it closes", () => {
    for (const mode of [0, 1, 2, 3, 4, 5]) {
      const g = shell({ cursor: { mode } });
      g.answerMenuCursor(false); // no menu: nothing is touched
      expect(g.cursor.mode).toBe(mode);
      g.answerMenuCursor(true);
      expect(g.cursor.mode).toBe(0);
      g.cursor.mode = 4; // something else (the zone code) writes the mode in the same frame: the arrow again
      g.answerMenuCursor(true);
      expect(g.cursor.mode).toBe(0);
      g.answerMenuCursor(false);
      expect(g.cursor.mode).toBe(mode);
      g.answerMenuCursor(false);
      expect(g.cursor.mode).toBe(mode);
    }
  });
});

describe("play: RAMKA around the item cursor (synthetic)", () => {
  const FRAME = { width: 48, height: 41, pixels: new Uint16Array(48 * 41) };
  /** barOverlays on a stand-in WITHOUT the legacy bar (the default inventory mode is the coat): the frame overlay it returns. */
  function overlaysFor(over: {
    idle?: boolean;
    mode?: number;
    barOpen?: boolean;
    menu?: boolean;
    caption?: boolean;
    bullet?: boolean;
    bar?: boolean;
    image?: boolean;
  }) {
    const g = Object.create(PlayGame.prototype) as unknown as Record<string, unknown>;
    Object.assign(g, {
      bar: over.bar ? { isOpen: over.barOpen ?? false, overlays: () => [] } : null,
      frameImage: over.image === false ? null : FRAME,
      cursor: { frameIdle: over.idle ?? false, mode: over.mode ?? 5 },
      dialog: { menu: over.menu ? {} : null, caption: over.caption ? {} : null },
      captionHidden: false,
      bullet: { open: over.bullet ?? false },
      lastInput: { x: 100, y: 80 },
    });
    return (g as unknown as { barOverlays: (sc: unknown) => unknown[] }).barOverlays({
      renderer: { framebuffer: null },
      scrollX: 0,
    });
  }
  it("is drawn in the default (coat) mode, at the mouse minus (0x18, 0x14)", () => {
    expect(overlaysFor({})).toEqual([{ x: 100 - 0x18, y: 80 - 0x14, image: FRAME }]);
    expect(overlaysFor({ bar: true })).toEqual([{ x: 100 - 0x18, y: 80 - 0x14, image: FRAME }]);
  });
  it("shows only with the item cursor over something usable and nothing else open", () => {
    expect(overlaysFor({ idle: true })).toEqual([]);
    expect(overlaysFor({ mode: 0 })).toEqual([]);
    expect(overlaysFor({ mode: 4 })).toEqual([]);
    expect(overlaysFor({ bar: true, barOpen: true })).toEqual([]);
    expect(overlaysFor({ menu: true })).toEqual([]);
    expect(overlaysFor({ caption: true })).toEqual([]);
    expect(overlaysFor({ bullet: true })).toEqual([]);
    expect(overlaysFor({ image: false })).toEqual([]);
  });
  it("no empty frame after TAKE - hidden until the item cursor has been presented and its zoom is over", () => {
    const c = new Cursor(() => ({ w: 20, h: 20, hotspot: 0 }) as never);
    c.inWindow = true;
    c.setTargets(true, true); // idle = false, as before the click on the object
    c.mode = 5; // TAKE: g_cursorMode = 5, nothing presented yet (player locked by the pick-up macro)
    expect(c.frameIdle).toBe(true);
    c.present(100, 80); // first present: the switch zoom starts, g_cursorIdle = 1
    expect(c.frameIdle).toBe(true);
    for (let i = 0; i < 60 && c.isSwitching; i++) c.present(100, 80);
    expect(c.isSwitching).toBe(false);
    c.setTargets(true, true);
    expect(c.frameIdle).toBe(false); // the item image is there: the frame may show
  });
});

describe("play: MOUSEX / MOUSEY follow the cursor hotspot (synthetic)", () => {
  it("are set to the hotspot (scene coordinates), a game without the variables is left alone", () => {
    const vars = new Variables(
      new Map([
        ["MOUSEX", 0],
        ["MOUSEY", 0],
      ]),
    );
    const g = Object.create(PlayGame.prototype) as unknown as {
      vars: Variables;
      syncMouseVars(c: { x: number; y: number }): void;
    };
    g.vars = vars;
    g.syncMouseVars({ x: 455, y: 301 });
    expect([vars.get("MOUSEX"), vars.get("MOUSEY")]).toEqual([455, 301]);
    g.vars = new Variables(new Map([["A", 5]]));
    g.syncMouseVars({ x: 1, y: 2 });
    expect(g.vars.get("A")).toBe(5);
  });
});

describe("play: MENU is 1 at every scene start (synthetic)", () => {
  it("resetMenuVar undoes SC000D's `LET MENU`, so the key conditions of the next scene hold", () => {
    const vars = new Variables(new Map([["MENU", 0]]));
    const g = Object.create(PlayGame.prototype) as unknown as {
      vars: Variables;
      resetMenuVar(): void;
    };
    g.vars = vars;
    expect(vars.get("MENU")).toBe(0); // as left by the map scene
    g.resetMenuVar();
    expect(vars.get("MENU")).toBe(1);
    // the same state read through the key conditions: F1 and F4 are accepted only with MENU != 0
    const base = {
      bulletMenuOpen: false,
      facesShown: false,
      barFlag: false,
      noticeShown: false,
      macroActive: false,
      topBarOpen: false,
      cursorEnabled: true,
      topBarFolded: true,
      optionsRequest: false,
      coatRequest: false,
    } as never;
    const ctx = (menuVar: boolean) =>
      ({
        ...(base as object),
        menuVar,
        cursorMode: 0,
        mapAvailable: false,
        backspace: undefined,
      }) as never;
    const press = (k: number) => ({ pressed: new Set([k]), down: new Set([k]), lastChar: 0 });
    expect(keyActions(press(DIK.F1), ctx(vars.get("MENU") !== 0)).map((a) => a.kind)).toEqual(["coat"]);
    expect(keyActions(press(DIK.F4), ctx(vars.get("MENU") !== 0)).map((a) => a.kind)).toEqual(["options"]);
    expect(keyActions(press(DIK.F1), ctx(false))).toEqual([]);
  });
});

describe("play: an open menu freezes the scene (synthetic)", () => {
  /** update() with only the fields Game_Run's tick touches. */
  function ticking(locked: boolean, menuOpen: boolean) {
    const scene = {
      idleCount() {},
      playerLocked: false,
      scrollX: 0,
      walker: { walking: false },
      tick: () => ({ sounds: [], personSounds: [] }),
      events: [] as unknown[],
      pose: () => ({ x: 1, y: 2 }),
    };
    const g = shell({
      phase: "playing",
      scene,
      interpreter: { logicTick() {}, playerLocked: () => locked },
      host: { tick() {}, viewScrolling: false },
      ticks: 0,
      menu: { isOpen: menuOpen },
      audio: { enabled: false },
      jackPlaced: true,
      cursorCountdown: 5,
    });
    g.update();
    return { g, scene };
  }

  it("the scene does not tick while the menu is open", () => {
    const { g, scene } = ticking(false, true);
    expect(g.ticks).toBe(0);
    expect(scene.playerLocked).toBe(false);
  });

  it("the player lock of the scripts reaches the scene on the next tick", () => {
    const held = ticking(true, false);
    expect(held.g.ticks).toBe(1);
    expect(held.scene.playerLocked).toBe(true);
    const free = ticking(false, false);
    expect(free.scene.playerLocked).toBe(false);
  });
});
