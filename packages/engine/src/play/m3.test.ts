// the dialog layer, sound, music, films and FLX animations in the play host. Tests use stubs for
// the dialog controller and the audio, so the commands must reach the right module.
import { describe, expect, it } from "vitest";
import { AreaState } from "../areas";
import type { DialogController } from "../dialog";
import type { ScenePlayer } from "../scene";
import { compileMcc, Interpreter, type LogEntry } from "../script";
import { DEFAULT_CONFIG, PlayAudio } from "./audio";
import { faceWindowPixels, frameWindow, REMAP_LEVELS, remapPixel } from "./facewin";
import { SceneHost, type HostEnv } from "./host";
import { TimedBackend } from "./testing";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const VARS = () =>
  new Map([
    ["LAST", 0],
    ["A", 0],
    ["B", 0],
    ["RAND", 0],
  ]);

/** The things of ScenePlayer the host touches here; calls are recorded. */
function fakeScene() {
  const calls: string[] = [];
  const flxAnim = {
    active: false,
    stop() {
      this.active = false;
    },
  };
  const scene = {
    calls,
    scene: { areas: [], objectAnims: [{ name: "ANI" }, { name: "FLX0" }] },
    world: { walk: [], perspective: {} },
    walker: { x: 100, y: 200 },
    turning: { pointRotate: false, pointRotateSaved: false, uniform: false },
    persons: { find: (n: string) => (n === "BOB" ? 0 : -1), get: () => undefined, persons: [] },
    speakerPoint: (p: number | null) => ({ x: p === null ? 11 : 22, y: 33 }),
    objectAnim: (n: string) => (n === "FLX0" ? flxAnim : null),
    startFlxAnim(n: string, mode: number, delay: number, rec: number) {
      calls.push(`flx ${n} ${mode} ${delay} ${rec}`);
      return n === "FLX0";
    },
  };
  return { scene };
}

function stubDialog() {
  const calls: string[] = [];
  const d = {
    calls,
    talking: false,
    dcn: null,
    jackUniform: false,
    talk: (...a: unknown[]) => (calls.push(`talk ${JSON.stringify(a.slice(0, 4))}`), true),
    talkOption: (...a: unknown[]) => (calls.push(`option ${JSON.stringify(a.slice(0, 5))}`), true),
    startDialog: (...a: unknown[]) => (calls.push(`dialog ${JSON.stringify(a.slice(0, 2))}`), true),
    showFace: (...a: unknown[]) => (calls.push(`show ${JSON.stringify(a)}`), a[0] !== "NOBODY"),
    hideFace: (s: string) => calls.push(`hide ${s}`),
    hideFaceAt: (s: string) => calls.push(`hideAt ${s}`),
    setDialogOption: (...a: unknown[]) => calls.push(`set ${JSON.stringify(a)}`),
  };
  return d;
}

function setup(text: string, opts: { audio?: PlayAudio } = {}) {
  const { scene } = fakeScene();
  const dialog = stubDialog();
  const log: LogEntry[] = [];
  const movies: string[][] = [];
  const env: HostEnv = {
    scene: scene as unknown as ScenePlayer,
    areas: new AreaState(),
    gotoScene: () => {},
    requestFade: () => {},
    clickX: () => 0,
    answer: () => 0,
    log: (e) => log.push(e),
    dialog: dialog as unknown as DialogController,
    audio: opts.audio,
    runMovie: (film, sc) => movies.push([film, sc]),
  };
  const host = new SceneHost(env);
  const it = new Interpreter(compileMcc(bytes(text)), host, VARS());
  host.interpreter = it;
  return { host, it, scene, dialog, log, movies };
}

const step = (s: ReturnType<typeof setup>) => {
  s.it.tick();
  s.it.logicTick();
  s.host.tick();
};

describe("SceneHost: TALK, DIALOG and faces go to the dialog layer", () => {
  it("TALK '-' hands the line over with its speaker, channel and macro, and waits until talkEnded", () => {
    const s = setup("[A] Talk LEFT 245 1 - Let A 1");
    s.it.start("A");
    step(s);
    expect(s.dialog.calls).toEqual(['talk ["LEFT",245,1,"-"]']);
    for (let i = 0; i < 5; i++) step(s);
    expect(s.it.vars.get("A")).toBe(0);
    s.host.talkEnded(0);
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("TALK '+' goes on at once; RIGHT forces channel 2", () => {
    const s = setup("[A] Talk RIGHT 5 9 + Let A 1");
    s.it.start("A");
    step(s);
    step(s);
    expect(s.dialog.calls).toEqual(['talk ["RIGHT",5,2,"+"]']);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("the speaker of a caption: Jack and persons give a point of the scene, POS the SETPOSXY point, an unknown name skips", () => {
    const s = setup("[A] Talk JACK 1 1 + Talk BOB 2 1 + SetPosXY 440 130 Talk POS 3 1 + Talk NOBODY 4 1 +");
    s.it.start("A");
    for (let i = 0; i < 5; i++) step(s);
    expect(s.dialog.calls).toEqual([
      'talk [{"x":11,"y":33},1,1,"+"]',
      'talk [{"x":22,"y":33},2,1,"+"]',
      'talk [{"x":440,"y":130},3,1,"+"]',
    ]);
    expect(s.host.skipped.get("TALK")).toBe(1);
  });

  it("a line started over a running one releases the macro of the first (the game would leave it waiting)", () => {
    const s = setup("[A] Talk LEFT 1 1 - Let A 1\n[B] Talk RIGHT 2 2 - Let B 1");
    s.it.start("A");
    step(s);
    s.dialog.talking = true;
    s.it.start("B");
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
    expect(s.it.vars.get("B")).toBe(0);
  });

  it("DIALOG opens the menu and blocks the macro until the answer was spoken", () => {
    const s = setup("[A] Dialog LEFT 1200 Let A 1");
    s.it.start("A");
    step(s);
    expect(s.dialog.calls).toEqual(['dialog ["LEFT",1200]']);
    for (let i = 0; i < 4; i++) step(s);
    expect(s.it.vars.get("A")).toBe(0);
    s.host.talkEnded(0);
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });

  it("SHOWFACE / HIDEFACE / SETDIALOG / EXTRA 6 reach the controller", () => {
    const s = setup(
      "[A] ShowFace POL1 L ShowFace KOT R* HideFace R HideFaceAt L SetDialog 1100 2 0 Extra 6 ShowFace NOBODY L",
    );
    s.it.start("A");
    for (let i = 0; i < 9; i++) step(s);
    expect(s.dialog.calls).toEqual([
      'show ["POL1","L",false]',
      'show ["KOT","R",true]',
      "hide R",
      "hideAt L",
      "set [1100,2,0]",
      'show ["NOBODY","L",false]',
    ]);
    expect(s.dialog.jackUniform).toBe(true);
    expect(s.host.skipped.get("SHOWFACE")).toBe(1);
  });

  it("without a dialog layer a talk line still waits a fixed time", () => {
    const s = setup("[A] Talk LEFT 1 1 - Let A 1");
    (s.host as unknown as { env: HostEnv }).env.dialog = undefined;
    s.it.start("A");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.it.vars.get("A")).toBe(0);
    for (let i = 0; i < 120; i++) step(s);
    expect(s.it.vars.get("A")).toBe(1);
  });
});

describe("SceneHost: films, FLX animations, music", () => {
  it("RUNAVX hands the film and the scene to the game", () => {
    const s = setup("[A] RunAvx ONCAR.AVX NULL");
    s.it.start("A");
    step(s);
    expect(s.movies).toEqual([["ONCAR.AVX", "NULL"]]);
  });

  it("ANIMA mode 5 starts an FLX animation and waits for its end, mode 6 does not wait; an unknown one is skipped", () => {
    const s = setup(
      "[A] Anima FLX0 0 4 5 0 - Let A 1\n[B] Anima FLX0 0 3 6 1 - Let B 1\n[C] Anima NOPE 0 4 5 0 - Let LAST 2",
    );
    s.it.start("A");
    s.it.start("B");
    s.it.start("C");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.scene.calls).toContain("flx FLX0 5 4 0");
    expect(s.scene.calls).toContain("flx FLX0 6 3 1");
    expect(s.it.vars.get("A")).toBe(0);
    expect(s.it.vars.get("B")).toBe(1);
    expect(s.host.skipped.get("ANIMA")).toBe(1);
    expect(s.it.vars.get("LAST")).toBe(2);
  });

  it("ACTIVEMACROANIMA: a macro per animation and image (the later one replaces), started by the frame of the animation", () => {
    const s = setup("[A] ActiveMacroAnima M1 FLX0 0 5 ActiveMacroAnima M2 FLX0 0 5\n[M2] Let A 1\n[M1] Let B 1");
    s.it.start("A");
    for (let i = 0; i < 3; i++) step(s);
    expect(s.host.animaMacros).toHaveLength(1);
    s.host.animFrame("FLX0", 4, 0);
    s.host.animFrame("FLX0", 5, 1); // another record
    step(s);
    expect(s.it.vars.get("A")).toBe(0);
    s.host.animFrame("FLX0", 5, 0);
    step(s);
    step(s);
    expect(s.it.vars.get("A")).toBe(1);
    expect(s.it.vars.get("B")).toBe(0);
  });

  it("MUSIC, MUSICVOLUME and the sound commands are skipped without audio and play with it", () => {
    const plain = setup("[A] Music TR02-x 1 1 MusicVolume 0.5 Effect X.SND 0 0 5");
    plain.it.start("A");
    for (let i = 0; i < 4; i++) step(plain);
    expect([...plain.host.skipped.keys()].sort()).toEqual(["EFFECT", "MUSIC", "MUSICVOLUME"]);

    const backend = new TimedBackend();
    const audio = new PlayAudio(backend);
    audio.music.trackName = "TR02-22.PMS"; // the same track: the command is a no-op (a track file would be needed to start one)
    const s = setup("[A] Music TR02-x 0 0 MusicVolume 0.5 Let A 1", { audio });
    s.it.start("A");
    for (let i = 0; i < 4; i++) step(s);
    expect(s.host.skipped.size).toBe(0);
    expect(audio.music.trackName).toBe("TR02-22.PMS");
    expect(audio.music.scale).toBe(0.5);
    expect(s.it.vars.get("A")).toBe(1);
  });
});

describe("PlayAudio", () => {
  it("the defaults are those of Sys_InitConfigAndCd", () => {
    expect(DEFAULT_CONFIG).toEqual({
      dialogText: true,
      musicVolume: 0x23,
      sfxVolume: 0x20,
      talkVolume: 0x40,
      revStereo: false,
      musicDown: true,
    });
  });

  it("without a backend nothing plays and a line has no voice (a game without a sound device)", () => {
    const a = new PlayAudio(null);
    expect(a.enabled).toBe(false);
    expect(a.playVoice(1, "T001.S22")).toBeNull();
    expect(a.music.enabled).toBe(false);
  });

  it("talk channels: the first idle one of the side, the request itself when both are busy; RevStereoOnOff swaps", () => {
    const backend = new TimedBackend();
    const a = new PlayAudio(backend);
    const snd = { channels: [new Float32Array(22050)], rate: 22050, loopStart: 0, loopLength: 0 };
    expect(a.pickTalkChannel(1)).toBe(1);
    expect(a.pickTalkChannel(2)).toBe(2);
    a.mixer.play(1, snd);
    expect(a.pickTalkChannel(1)).toBe(3);
    a.mixer.play(3, snd);
    expect(a.pickTalkChannel(1)).toBe(1);
    a.mixer.play(2, snd); // an effect: the end of a line leaves it playing (Snd_StopChannel only for g_sndChannelTalk)
    a.talkChannels.add(1);
    a.talkChannels.add(3);
    a.stopVoices();
    expect(a.mixer.isPlaying(1)).toBe(false);
    expect(a.mixer.isPlaying(3)).toBe(false);
    expect(a.mixer.isPlaying(2)).toBe(true);
    const swapped = new PlayAudio(new TimedBackend(), { revStereo: true });
    swapped.mixer.play(2, snd);
    expect(swapped.pickTalkChannel(1)).toBe(3); // logical 1 is physical 2 (busy), logical 3 is physical 4
  });

  it("ducking only with MusDownOnOff; MUSICVOLUME sets the multiplier and the channel level", () => {
    const off = new PlayAudio(new TimedBackend(), { musicDown: false });
    off.duckMusic(true);
    off.music.tick14ms();
    expect(off.music.volume).toBe(0);
    const on = new PlayAudio(new TimedBackend());
    on.music.volume = 35;
    on.duckMusic(true);
    on.music.tick14ms();
    expect(on.music.volume).toBe(34);
    on.setMusicScale(0.5);
    expect(on.music.volume).toBe(17);
  });

  it("a film's sound level is MusicVol doubled", () => {
    expect(new PlayAudio(null).movieLevel).toBe(0x23 * 2);
    expect(new PlayAudio(null, { musicVolume: 100 }).movieLevel).toBe(127);
  });

  it("TimedBackend ends a voice when its clock has passed the length", () => {
    const b = new TimedBackend();
    let ended = 0;
    b.start(
      { channels: [new Float32Array(22050)], rate: 22050, loopStart: 0, loopLength: 0 },
      { gain: 1, pan: 0 },
      () => ended++,
    );
    b.advance(0.5);
    expect(ended).toBe(0);
    b.advance(0.6);
    expect(ended).toBe(1);
  });
});

describe("face window", () => {
  // tables whose result encodes the level in the blue bits: shows which level every pixel went through
  const t = {
    blue: Uint8Array.from({ length: REMAP_LEVELS * 0x80 }, (_, i) => Math.floor(i / 0x80)),
    green: new Uint16Array(REMAP_LEVELS * 64),
    red: new Uint16Array(REMAP_LEVELS * 64),
  };

  it("the bevel: corners and inside 0x10, top and left edge 10, bottom and right edge 0x16, two rings", () => {
    const px = new Uint16Array(132 * 132).fill(0xffff);
    frameWindow(px, t);
    const at = (x: number, y: number) => px[y * 132 + x];
    expect(at(50, 0)).toBe(10);
    expect(at(0, 50)).toBe(10);
    expect(at(0, 0)).toBe(10);
    expect(at(50, 131)).toBe(0x16);
    expect(at(131, 50)).toBe(0x16);
    expect(at(131, 131)).toBe(0x16);
    expect(at(131, 0)).toBe(0x10);
    expect(at(0, 131)).toBe(0x10);
    expect(at(50, 1)).toBe(10);
    expect(at(130, 50)).toBe(0x16);
    expect(at(2, 2)).toBe(0x10);
    expect(at(129, 129)).toBe(0x10);
    expect(at(66, 66)).toBe(0x10);
  });

  it("the window copies the scene behind it and the portrait covers it where it is not transparent", () => {
    const scene = { width: 200, pixels: new Uint16Array(200 * 200).fill(0x07e0) };
    const face = new Uint16Array(132 * 132);
    face[60 * 132 + 60] = 0x1234;
    const px = faceWindowPixels(scene, 10, 10, face, t);
    expect(px[60 * 132 + 60]).toBe(0x1234);
    expect(px[61 * 132 + 60]).toBe(0x10); // scene copied and darkened (green is 0 in these tables)
    expect(remapPixel(0xffff, 3, t)).toBe(3);
  });
});
