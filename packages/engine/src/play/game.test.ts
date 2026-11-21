// PlayGame behaviour on invented state: menus, scripts and the sound options. No game files.
import { WheelAccumulator } from "../inventory/wheel";
import { describe, expect, it } from "vitest";
import { JACK_REFUSALS } from "./refusals";
import { captionLineX, jackClickAsksCoat, jackRefusal, mapLast, MOVIE_FADE_STEP_MS, PlayGame } from "./game";
import { DialogController } from "../dialog";
import { Variables } from "../script/interpreter";
import { PlayAudio } from "./audio";
import { AreaState } from "../areas";
import { compileMcc, Interpreter } from "../script";
import type { ScenePlayer } from "../scene";
import { AutoIncClock, SceneHost, type HostEnv } from "./host";
import { TimedBackend } from "./testing";
import { DIK, keyActions } from "../keys";
import { defaultConfig } from "../settings/config";
import { Cursor } from "../cursor";
import { Inventory } from "../inventory/model";
import type { LoadedState } from "../save/state";
import type { Surface16 } from "../render/surface";

describe("play: sound options of the menu (without the game files)", () => {
  const prepared = (frames = 4000) => ({ rate: 22050, channels: [new Float32Array(frames)], loopLength: 0, loopStart: 0 });
  const cfg = () => ({ ...defaultConfig() });

  it("applyConfig takes the options into the sound; applySetting stops the music below 5 and restarts it above 5", () => {
    const backend = new TimedBackend();
    const a = new PlayAudio(backend);
    const c = { ...cfg(), sfxVol: 10, talkVol: 20, reverseStereo: 1, musicDown: 0, showText: 0 };
    a.applyConfig(c);
    expect([a.config.sfxVolume, a.config.talkVolume, a.config.revStereo, a.config.musicDown, a.config.dialogText]).toEqual([10, 20, true, false, false]);
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

describe("play: Jack's refusal, the click on Jack and the Ctrl point 3 (without the game files)", () => {
  it("the catalog has three refusals: voice name and the Polish caption width", () => {
    expect(JACK_REFUSALS).toHaveLength(3);
    expect(JACK_REFUSALS.map((x) => x.voice)).toEqual(["N010.SND", "N020.SND", "N030.SND"]);
    expect(JACK_REFUSALS.map((x) => x.width)).toEqual([245, 265, 185]);
  });

  it("the order: counter 0 -> line 2, then 3, then 1 again (counter + 1 mod 3)", () => {
    let c = 0;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      c = jackRefusal(c, 0, 0).index;
      seen.push(c);
    }
    expect(seen).toEqual([1, 2, 0, 1, 2, 0]);
  });

  it("the side follows the click: right of scrollX + 320 = left window and channel 1, else the right window and channel 2", () => {
    expect(jackRefusal(0, 321, 0)).toMatchObject({ side: "L", channel: 1 });
    expect(jackRefusal(0, 320, 0)).toMatchObject({ side: "R", channel: 2 }); // not strictly right of the middle
    expect(jackRefusal(0, 500, 300)).toMatchObject({ side: "R", channel: 2 }); // the scroll counts: 300 + 320 = 620
    expect(jackRefusal(0, 621, 300)).toMatchObject({ side: "L", channel: 1 });
  });

  it("Ctrl point 3: LAST by the chapter (1 -> 6, 2 -> 32, 3 -> 75, 4 -> unchanged)", () => {
    expect([1, 2, 3, 4].map(mapLast)).toEqual([6, 32, 75, null]);
  });

  /** A PlayGame without files: only what jackRefuses / ctrlPoint / refusalFrame touch. */
  function stubGame(scene: string, scrollX = 0) {
    const voices: [number, string][] = [];
    const dialog = new DialogController({
      host: { playVoice: (ch, file) => (voices.push([ch, file]), null), stopVoices: () => undefined, resume: () => undefined },
      tables: {
        lipPair: () => [1, 1],
        mouthCycle: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1],
        blinkOrder: [0, 1, 2, 1, 0],
        speakerColors: Array(17).fill(1),
        textColors: [1, 2, 3, 4, 5, 6],
        menuFill: 7,
      },
      measure: (t) => t.length * 6,
      answers: new Map(),
    });
    const g = Object.create(PlayGame.prototype) as unknown as Record<string, unknown>;
    Object.assign(g, {
      dialog,
      scene: { scrollX },
      sceneName: scene,
      interpreter: {},
      refusals: JACK_REFUSALS,
      refusalCounter: 0,
      refusal: null,
      armed: true,
      vars: new Variables(new Map([["JACKISMENU", 1], ["LAST", 0]])),
      jackIsMenu: true,
      fadeRequested: false,
      pendingScene: null,
      log: [],
    });
    return { g, voices, dialog };
  }
  const call = (g: unknown, name: string, ...a: unknown[]) => (g as Record<string, (...x: unknown[]) => unknown>)[name](...a);

  it("a refusal shows Jack's face, says the line with its voice and the width, spends the click and closes the face when it ends", () => {
    const { g, voices, dialog } = stubGame("SC001");
    call(g, "jackRefuses", 400); // right of the middle
    expect(voices).toEqual([[1, "N020.S22"]]); // the first refusal of a game is the second line
    expect(dialog.faceView("L")?.face.name).toBe("JACK");
    expect(dialog.faceView("R")).toBeNull();
    expect(dialog.caption?.lines.map((l) => l.text).join(" ")).toBe(JACK_REFUSALS[1].text);
    expect((g as { armed: boolean }).armed).toBe(false);
    // a second click while the line is spoken does nothing
    (g as { armed: boolean }).armed = true;
    call(g, "jackRefuses", 100);
    expect(voices.length).toBe(1);
    expect((g as { armed: boolean }).armed).toBe(true);
    // the line ends: the window goes
    for (let i = 0; i < 20000 && dialog.talking; i++) {
      dialog.tick();
      dialog.frame();
    }
    expect(dialog.talking).toBe(false);
    call(g, "refusalFrame");
    expect(dialog.faceView("L")).toBeNull();
    // next click on the other half: third line, right window, channel 2
    call(g, "jackRefuses", 100);
    expect(voices.at(-1)).toEqual([2, "N030.S22"]);
    expect(dialog.faceView("R")?.face.name).toBe("JACK");
    expect(dialog.caption?.lines.map((l) => l.text).join(" ")).toBe(JACK_REFUSALS[2].text);
  });

  it("the uniform shows JACKWOJ in the window", () => {
    const { g, dialog } = stubGame("SC001");
    dialog.jackUniform = true;
    call(g, "jackRefuses", 400);
    expect(dialog.faceView("L")?.face.name).toBe("JACKWOJ");
  });

  it("without refusals it only logs", () => {
    const { g, dialog } = stubGame("SC001");
    (g as { refusals: unknown }).refusals = null;
    (g as { addLog: (t: string) => void }).addLog = () => undefined;
    call(g, "jackRefuses", 400);
    expect(dialog.faceView("L")).toBeNull();
  });

  it("the click on Jack asks for the coat only with an empty hand and JACKISMENU set", () => {
    expect(jackClickAsksCoat("JACK", false, true)).toBe(true);
    expect(jackClickAsksCoat("JACK", true, true)).toBe(false); // an item in hand: <item>-JACK or the refusal
    expect(jackClickAsksCoat("JACK", false, false)).toBe(false); // the Ctrl point 4 turned it off
    expect(jackClickAsksCoat("DRZWI", false, true)).toBe(false);
  });

  it("Ctrl point 3 on the map: scene SC000D as a hard cut (no fade) and LAST from the chapter of the scene", () => {
    for (const [scene, last] of [["SC005", 6], ["SC040", 32], ["SC080", 75]] as const) {
      const { g } = stubGame(scene);
      call(g, "ctrlPoint", 3);
      const s = g as unknown as { pendingScene: string | null; fadeRequested: boolean; vars: Variables };
      expect([s.pendingScene, s.fadeRequested, s.vars.get("LAST")]).toEqual(["SC000D", false, last]);
    }
    const { g } = stubGame("SC150"); // chapter 4: LAST is left alone
    call(g, "ctrlPoint", 3);
    expect((g as unknown as { vars: Variables }).vars.get("LAST")).toBe(0);
    expect((g as unknown as { pendingScene: string }).pendingScene).toBe("SC000D");
  });

  it("Ctrl point 4 toggles JACKISMENU and g_jackIsMenu together", () => {
    const { g } = stubGame("SC001");
    const s = g as unknown as { jackIsMenu: boolean; vars: Variables };
    call(g, "ctrlPoint", 4);
    expect([s.vars.get("JACKISMENU"), s.jackIsMenu]).toEqual([0, false]);
    call(g, "ctrlPoint", 4);
    expect([s.vars.get("JACKISMENU"), s.jackIsMenu]).toEqual([1, true]);
  });
});

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

/** A PlayGame shell with only the fields the helpers touch (no files, no audio device). */
function shell(fields: Record<string, unknown>): any {
  return Object.assign(Object.create(PlayGame.prototype), { menuCursorSaved: null, moviePause: null, ...fields });
}

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

describe("play: the music fade before a film (synthetic)", () => {
  const audio = (volume: number, playing = true, enabled = true) => {
    const set: number[] = [];
    return { set, enabled, music: { volume, playing }, setMusicFade: (v: number) => set.push(v) };
  };

  it("lasts volume x 10 ms (Timer_Sleep(10) per volume step, Game_Run) and is silent without music", () => {
    expect(MOVIE_FADE_STEP_MS).toBe(10);
    expect(shell({ audio: audio(35) }).beginMovieFade()).toEqual({ total: 350, left: 350, volume: 35 });
    expect(shell({ audio: audio(64) }).beginMovieFade().total).toBe(640);
    expect(shell({ audio: audio(35, false) }).beginMovieFade().total).toBe(0);
    expect(shell({ audio: audio(0) }).beginMovieFade().total).toBe(0);
    expect(shell({ audio: audio(35, true, false) }).beginMovieFade().total).toBe(0);
  });

  it("the volume falls linearly to 0 as the time runs out", () => {
    const a = audio(40);
    const g = shell({ audio: a });
    g.moviePause = g.beginMovieFade();
    g.advanceMovieFade(100);
    g.advanceMovieFade(100);
    g.advanceMovieFade(1000);
    expect(a.set).toEqual([30, 20, 0]);
    expect(g.moviePause.left).toBe(0);
  });
});

describe("play: RAMKA around the item cursor (synthetic)", () => {
  const FRAME = { width: 48, height: 41, pixels: new Uint16Array(48 * 41) };
  /** barOverlays on a stand-in WITHOUT the legacy bar (the default inventory mode is the coat): the frame overlay it returns. */
  function overlaysFor(over: { idle?: boolean; mode?: number; barOpen?: boolean; menu?: boolean; caption?: boolean; bullet?: boolean; bar?: boolean; image?: boolean }) {
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
    return (g as unknown as { barOverlays: (sc: unknown) => unknown[] }).barOverlays({ renderer: { framebuffer: null }, scrollX: 0 });
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
    const c = new Cursor(() => ({ w: 20, h: 20, hotspot: 0 } as never));
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

describe("play: the night music at SC007 → SC008 (synthetic)", () => {
  /** The shape of SC008 [PRE]: `If LAST 7 / ActiveMacro MUS20 / EndIf`, then more [PRE] commands; MUS20 is `Music TR20-x 1 1`. */
  const SCRIPT = "[PRE] If LAST 7 ActiveMacro MUS20 EndIf Let AFTER 1 [MUS20] Music TR20-x 1 1";
  const pms = () => {
    const out = new Uint8Array(24 + 80);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x33, true);
    v.setUint32(4, 80, true);
    v.setUint32(8, 320, true);
    return out;
  };

  function setup() {
    const backend = new TimedBackend();
    const audio = new PlayAudio(backend);
    audio.addTrack("TR20-22.PMS", pms());
    audio.music.play("TR22-22.PMS", pms(), 0); // SC005B / SC007: the day track plays
    audio.music.trackName = "TR22-22.PMS";
    for (let i = 0; i < 60; i++) audio.music.tick14ms(); // fade-in over: full volume
    const log: string[] = [];
    const scene = new Proxy({ scene: { areas: [] }, persons: { find: () => -1, get: () => undefined, persons: [] } } as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : () => true),
    });
    const vars = new Variables(new Map([["LAST", 7], ["AFTER", 0]]));
    const env: HostEnv = {
      scene: scene as unknown as ScenePlayer,
      areas: new AreaState(),
      gotoScene: () => undefined,
      requestFade: () => undefined,
      clickX: () => 0,
      answer: () => 0,
      log: (e) => log.push(e.text),
      runFilm: () => undefined,
      audio,
    };
    const host = new SceneHost(env, 3);
    const it = new Interpreter(compileMcc(new Uint8Array([...SCRIPT].map((c) => c.charCodeAt(0)))), host, vars);
    host.interpreter = it;
    return { backend, audio, it, vars, log };
  }

  it("[PRE] hands the loop to MUS20: the day track fades out and the night track starts before the first frame", () => {
    const s = setup();
    expect(s.audio.music.trackName).toBe("TR22-22.PMS");
    s.it.runSynchronous("PRE"); // Game_Run: before Scene_RefreshBackground (the 32-step cross-fade)
    expect(s.audio.music.trackName).toBe("TR20-22.PMS");
    const streams = s.backend.voices.filter((v) => v.kind === "stream");
    expect(streams).toHaveLength(2);
    expect(streams[0].stopped).toBe(true); // the day track is over
    expect(streams[1].stopped).toBe(false); // the night track plays
    expect(s.audio.music.fadingOut).toBe(false);
    expect(s.vars.get("AFTER")).toBe(0); // [PRE]'s own tail waits for the frames, as in the exe (the macro stays active)
    expect(s.it.isActive("PRE")).toBe(true);
    for (let i = 0; i < 3; i++) s.it.tick();
    expect(s.vars.get("AFTER")).toBe(1);
  });

  it("outside [PRE] (in the frames) the fade-out still takes real ticks and the command repeats", () => {
    const s = setup();
    s.it.start("MUS20");
    s.it.tick();
    expect(s.audio.music.trackName).toBe("TR22-22.PMS");
    expect(s.audio.music.fadingOut).toBe(true);
    for (let i = 0; i < 40; i++) {
      s.audio.music.tick14ms();
      s.it.tick();
    }
    expect(s.audio.music.trackName).toBe("TR20-22.PMS");
  });
});

describe("play: caption stays where it started (deviation, synthetic)", () => {
  it("captionLineX is the world x minus the scroll at the start of the line", () => {
    expect(captionLineX(130, 124)).toBe(6);
    expect(captionLineX(206, 200)).toBe(6);
  });
  it("captionTimer remembers the scroll of the moment a caption appears, not later ones", () => {
    const cap = { lines: [{ text: "Line A", x: 130, y: 10 }] };
    const scene = { scrollX: 124 };
    const g = Object.create(PlayGame.prototype) as unknown as Record<string, unknown>;
    Object.assign(g, { dialog: { caption: cap }, scene, captionSeen: null, captionHidden: false, captionTicks: 0, captionScroll: 0 });
    const run = () => (g as unknown as { captionTimer: () => void }).captionTimer();
    run();
    scene.scrollX = 200; // the scene goes on scrolling under the line
    run();
    expect(g.captionScroll).toBe(124);
    expect(captionLineX(cap.lines[0].x, g.captionScroll as number)).toBe(6);
    g.dialog = { caption: { lines: [{ text: "B", x: 300, y: 10 }] } }; // the next line is pinned anew
    run();
    expect(g.captionScroll).toBe(200);
  });
});

describe("play: MOUSEX / MOUSEY follow the cursor hotspot (synthetic)", () => {
  it("are set to the hotspot (scene coordinates), a game without the variables is left alone", () => {
    const vars = new Variables(new Map([["MOUSEX", 0], ["MOUSEY", 0]]));
    const g = Object.create(PlayGame.prototype) as unknown as { vars: Variables; syncMouseVars(c: { x: number; y: number }): void };
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
    const g = Object.create(PlayGame.prototype) as unknown as { vars: Variables; resetMenuVar(): void };
    g.vars = vars;
    expect(vars.get("MENU")).toBe(0); // as left by the map scene
    g.resetMenuVar();
    expect(vars.get("MENU")).toBe(1);
    // the same state read through the key conditions: F1 and F4 are accepted only with MENU != 0
    const base = { bulletMenuOpen: false, facesShown: false, barFlag: false, noticeShown: false, macroActive: false, topBarOpen: false, cursorEnabled: true, topBarFolded: true, optionsRequest: false, coatRequest: false } as never;
    const ctx = (menuVar: boolean) => ({ ...(base as object), menuVar, cursorMode: 0, mapAvailable: false, backspace: undefined }) as never;
    const press = (k: number) => ({ pressed: new Set([k]), down: new Set([k]), lastChar: 0 });
    expect(keyActions(press(DIK.F1), ctx(vars.get("MENU") !== 0)).map((a) => a.kind)).toEqual(["coat"]);
    expect(keyActions(press(DIK.F4), ctx(vars.get("MENU") !== 0)).map((a) => a.kind)).toEqual(["options"]);
    expect(keyActions(press(DIK.F1), ctx(false))).toEqual([]);
  });
});

describe("play: an avoid walk interrupts the action macro (synthetic)", () => {
  it("jackAvoidWalk -> interruptOutMacros(-1) (Jack_WalkTo); the other scene events do not", () => {
    const calls: number[] = [];
    const g = shell({ host: { finish: () => undefined }, interpreter: { interruptOutMacros: (e: number) => calls.push(e) } });
    g.release({ kind: "jackArrived" });
    expect(calls).toEqual([]);
    g.release({ kind: "jackAvoidWalk" });
    expect(calls).toEqual([-1]);
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

describe("play: a stopped animation does not release the waiting macro (synthetic)", () => {
  it("STOPANIMA ends nothing; an animation that finishes releases its slot", () => {
    const finished: string[] = [];
    const g = shell({ host: { finish: (slot: string) => finished.push(slot) } });
    g.release({ kind: "animEnded", anim: "DOOR", reason: "stop" });
    expect(finished).toEqual([]);
    g.release({ kind: "animEnded", anim: "DOOR", reason: "end" });
    expect(finished).toEqual(["anim:DOOR"]);
  });
});

/** Calls a method the shell does not expose (`keyFrame`, `applyLoaded`, `stepFilm`, `stepMovie`). */
const callPlay = (g: unknown, name: string, ...a: unknown[]) => (g as Record<string, (...x: unknown[]) => unknown>)[name](...a);

describe("play: keys, a loaded save and a film (synthetic)", () => {
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

  it("a finished RUNFILMP returns to play and clears the film", () => {
    const g = shell({
      phase: "film",
      film: {
        clockMs: 0,
        name: "CLIP",
        global: false,
        run: { effectsUntil: () => [], finished: (ms: number) => ms >= 20 },
      },
      audio: { enabled: false },
      log: [],
      ticks: 0,
      sceneName: "SC001",
    });
    callPlay(g, "stepFilm", 10);
    expect(g.phase).toBe("film");
    expect(g.film).not.toBeNull();
    callPlay(g, "stepFilm", 10);
    expect(g.phase).toBe("playing");
    expect(g.film).toBeNull();
  });

  it("a finished movie ends the game: the outro finishes, any other film is a death", () => {
    const movie = (film: string, end: string | null) => {
      const g = shell({
        phase: "movie",
        exit: null,
        lastInput: { escape: false },
        log: [],
        ticks: 0,
        sceneName: "SC001",
        opts: {},
        fadeRequested: true,
        movie: {
          clockMs: 0,
          film,
          surface: { width: 1, height: 1, pixels: new Uint16Array(1) },
          player: { step: () => ({ end }) },
        },
      });
      callPlay(g, "stepMovie", 5);
      return g;
    };
    const outro = movie("OUTRO.AVX", "end");
    expect(outro.exit).toBe("finished");
    expect(outro.phase).toBe("finished");
    expect(outro.movie).toBeNull();
    const dead = movie("DEAD.AVX", "end");
    expect(dead.exit).toBe("death");
    expect(dead.phase).toBe("finished");
    const going = movie("DEAD.AVX", null);
    expect(going.phase).toBe("movie");
    expect(going.exit).toBeNull();
    expect(going.movie).not.toBeNull();
  });
});
