// PlayGame behaviour on invented state: a refusal, night music, a caption and a released macro. No game files.
import { describe, expect, it } from "vitest";
import { AreaState } from "../areas";
import { DialogController } from "../dialog";
import type { ScenePlayer } from "../scene";
import { compileMcc, Interpreter } from "../script";
import { Variables } from "../script/interpreter";
import { PlayAudio } from "./audio";
import { captionLineX, jackClickAsksCoat, jackRefusal, mapLast, PlayGame } from "./game";
import { SceneHost, type HostEnv } from "./host";
import { JACK_REFUSALS } from "./refusals";
import { TimedBackend, shell } from "./testing";

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
