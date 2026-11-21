// the dialog layer, sound, music, films and FLX animations in the play host. Tests use stubs for
// the dialog controller and the audio, so the commands must reach the right module.
import { describe, expect, it } from "vitest";
import { AreaState } from "../areas";
import type { DialogController } from "../dialog";
import type { ScenePlayer } from "../scene";
import { compileMcc, Interpreter, type LogEntry } from "../script";
import { DEFAULT_CONFIG, PlayAudio } from "./audio";
import { faceWindowPixels, frameWindow, REMAP_LEVELS, remapPixel } from "./facewin";
import { blend565, FilmRun, filmPlace, isOutro, mixColour, movieBase, RING_COLOUR, type FilmSource } from "./film";
import type { Image16 } from "../formats/bm";
import { SceneHost, type HostEnv } from "./host";
import { drawOverlays } from "./overlay";
import { TimedBackend } from "./testing";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const VARS = () => new Map([["LAST", 0], ["A", 0], ["B", 0], ["RAND", 0]]);

/** The things of ScenePlayer the host touches here; calls are recorded. */
function fakeScene() {
  const calls: string[] = [];
  const flxAnim = { active: false, stop() { this.active = false; } };
  const scene = {
    calls,
    scene: { areas: [], objectAnims: [{ name: "ANI" }, { name: "FLX0" }] },
    world: { walk: [], perspective: {} },
    walker: { x: 100, y: 200 },
    tj: { pointRotate: false, pointRotateSaved: false, uniform: false },
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
    const s = setup("[A] ShowFace POL1 L ShowFace KOT R* HideFace R HideFaceAt L SetDialog 1100 2 0 Extra 6 ShowFace NOBODY L");
    s.it.start("A");
    for (let i = 0; i < 9; i++) step(s);
    expect(s.dialog.calls).toEqual(['show ["POL1","L",false]', 'show ["KOT","R",true]', "hide R", "hideAt L", "set [1100,2,0]", 'show ["NOBODY","L",false]']);
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
    const s = setup("[A] Anima FLX0 0 4 5 0 - Let A 1\n[B] Anima FLX0 0 3 6 1 - Let B 1\n[C] Anima NOPE 0 4 5 0 - Let LAST 2");
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
    expect(DEFAULT_CONFIG).toEqual({ dialogText: true, musicVolume: 0x23, sfxVolume: 0x20, talkVolume: 0x40, revStereo: false, musicDown: true });
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
    b.start({ channels: [new Float32Array(22050)], rate: 22050, loopStart: 0, loopLength: 0 }, { gain: 1, pan: 0 }, () => ended++);
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

/** A 4x4 picture; `fill` everywhere, or 0 (transparent) where `hole(x, y)` says so */
function pic(fill: number, hole: (x: number, y: number) => boolean = () => false): Image16 {
  const pixels = new Uint16Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) pixels[y * 4 + x] = hole(x, y) ? 0 : fill;
  return { width: 4, height: 4, kind: "rgb565", pixels };
}

function filmSource(over: Partial<FilmSource> = {}): FilmSource {
  return {
    film: {
      name: "T",
      frameMs: 100,
      positioned: false,
      frames: [{ file: "BG", x: 0, y: 0 }, { file: "A", x: 0, y: 0 }, { file: "B", x: 0, y: 0 }, { file: "C", x: 0, y: 0 }],
      effects: [
        { frame: 1, sound: "X.SND", channel: 0, unused: 0, volume: 40 },
        { frame: 3, sound: "Y.SND", channel: 2, unused: 0, volume: 50 },
      ],
    },
    images: [pic(0x1111), pic(0x2222, (x) => x < 2), pic(0x3333, (x) => x < 2), pic(0x4444, (x) => x < 2)],
    scene: { pixels: new Uint16Array(64 * 64).fill(0x0abc), width: 64, height: 64 },
    mask: null,
    ring: null,
    ...over,
  };
}

describe("RUNFILMP: Film_Play", () => {
  it("the ring colour: (0xffff, 0, 1.5f) = (a * (2 - t) + b * t) / 2 per channel = (7, 15, 7), a dark grey", () => {
    expect(mixColour(0xffff, 0, 1.5)).toBe((7 << 11) | (15 << 5) | 7);
    expect(RING_COLOUR).toBe(0x39e7);
    expect(mixColour(0xffff, 0, 0)).toBe(0xffff); // t = 0: the first colour
    expect(mixColour(0xffff, 0xffff, 1)).toBe(0xffff);
  });

  it("the ring blend rounds like the tables: diff * level / 32, ties to even", () => {
    // blue: 16 * 1/32 = 0.5 -> 0, 16 * 3/32 = 1.5 -> 2, -16 * 3/32 = -1.5 -> -2, 16 * 5/32 = 2.5 -> 2
    expect(blend565(0, 16, 1)).toBe(0);
    expect(blend565(0, 16, 3)).toBe(2);
    expect(blend565(16, 0, 3)).toBe(14);
    expect(blend565(0, 16, 5)).toBe(2);
    // all channels: black toward white at level 16 is half of each channel
    expect(blend565(0, 0xffff, 16)).toBe((16 << 11) | (32 << 5) | 16);
    expect(blend565(0x1234, 0x5678, 0)).toBe(0x1234);
    expect(blend565(0xffff, 0xffff, 20)).toBe(0xffff);
    // toward a darker colour the scene darkens, toward a lighter one it lightens
    const ring = blend565(0x2104, RING_COLOUR, 16);
    expect(ring).toBeGreaterThan(0x2104);
  });

  it("the window is centred on (x, y) (C short division) and clamped to [6, scroll - w + 0x276] x [6, 0x1d6 - h]", () => {
    expect(filmPlace(510, 310, 240, 240, 0)).toEqual({ x: 390, y: 190 });
    expect(filmPlace(490, 310, 241, 240, 0)).toEqual({ x: 490 - 120, y: 190 });
    expect(filmPlace(0, 0, 240, 240, 0)).toEqual({ x: 6, y: 6 });
    expect(filmPlace(900, 900, 240, 240, 0)).toEqual({ x: 390, y: 0x1d6 - 240 });
    // the upper bound follows the scroll, the lower bound 6 does not
    expect(filmPlace(900, 100, 240, 240, 100)).toEqual({ x: 490, y: 6 });
    expect(filmPlace(10, 100, 240, 240, 300).x).toBe(6);
  });

  it("time: picture i shows from (i-1)*frameMs, the last stays one pass plus 3*frameMs; the film is n-1 passes + 300 ms long", () => {
    const run = new FilmRun(filmSource(), 0, 20, 20, 0);
    expect([0, 99, 100, 199, 200, 299, 5000].map((t) => run.frameAt(t))).toEqual([1, 1, 2, 2, 3, 3, 3]);
    expect(run.total).toBe(3 * 100 + 300);
    expect(run.finished(599)).toBe(false);
    expect(run.finished(600)).toBe(true);
  });

  it("effects fire once, in the pass of their frame; channel 0 is for both channels (the game decides), a skipped pass still fires", () => {
    const run = new FilmRun(filmSource(), 0, 20, 20, 0);
    expect(run.effectsUntil(0).map((e) => e.sound)).toEqual(["X.SND"]);
    expect(run.effectsUntil(50)).toEqual([]);
    expect(run.effectsUntil(250).map((e) => e.sound)).toEqual(["Y.SND"]);
    expect(run.effectsUntil(600)).toEqual([]);
  });

  it("an effect of frame 0 never fires and blocks the rest of the table (the pointer waits for `frame == pass`)", () => {
    const src = filmSource();
    src.film.effects.unshift({ frame: 0, sound: "Z.SND", channel: 1, unused: 0, volume: 1 });
    const run = new FilmRun(src, 0, 20, 20, 0);
    expect(run.effectsUntil(1000)).toEqual([]);
  });

  it("plain mode: the scene is copied with a 4-pixel frame around; background and picture are keyed over it", () => {
    const run = new FilmRun(filmSource(), 0, 30, 30, 0);
    expect(run.margin).toBe(4);
    const w = run.windowAt(0);
    expect([w.x, w.y, w.width, w.height]).toEqual([filmPlace(30, 30, 4, 4, 0).x - 4, filmPlace(30, 30, 4, 4, 0).y - 4, 12, 12]);
    const at = (x: number, y: number) => w.pixels[(y + 4) * 12 + x + 4];
    expect(at(0, 0)).toBe(0x1111); // background where the picture is transparent
    expect(at(3, 0)).toBe(0x2222); // the picture over it
    expect(w.pixels[0]).not.toBe(0x0abc); // the corner of the frame was changed by the bevel
    expect(w.pixels[6 * 12 + 6]).toBe(0x2222);
    expect(run.windowAt(250).pixels[(0 + 4) * 12 + 3 + 4]).toBe(0x4444);
  });

  it("mirror mode (1, 3) flips background and pictures; circle mode (2, 3) cuts the rows by the mask", () => {
    const run = new FilmRun(filmSource({ mask: [1, 0] }), 3, 30, 30, 0);
    expect(run.mirrored && run.circle).toBe(true);
    expect(run.margin).toBe(0);
    const w = run.windowAt(0);
    // mirrored: the transparent half of the picture is on the right now, the picture on the left
    expect(w.pixels[1 * 4 + 0]).toBe(0x2222);
    expect(w.pixels[1 * 4 + 3]).toBe(0x1111);
    // rows 0 and 3: one pixel off the background at each end (the picture covers the left half only)
    expect(w.pixels[0 * 4 + 3]).toBe(0x0abc);
    expect(w.pixels[3 * 4 + 3]).toBe(0x0abc);
    expect(w.pixels[0 * 4 + 2]).toBe(0x1111);
    expect(w.pixels[0 * 4 + 0]).toBe(0x2222);
    const plain = new FilmRun(filmSource({ mask: [1, 0] }), 1, 30, 30, 0);
    expect(plain.circle).toBe(false);
    expect(plain.windowAt(0).pixels[(0 + 4) * 12 + 3 + 4]).toBe(0x1111);
  });

  it("a ring picture sets the margin and blends the scene toward the grey RING_COLOUR by the blue level of its pixels", () => {
    const ring: Image16 = { width: 8, height: 8, kind: "rgb565", pixels: new Uint16Array(64).fill(0x1f) };
    const run = new FilmRun(filmSource({ ring, mask: [0, 0] }), 2, 30, 30, 0);
    expect(run.margin).toBe(2);
    const w = run.windowAt(0);
    expect(w.width).toBe(8);
    // level 31 of 32 of the way from 0x0abc (r 1, g 21, b 28) to (7, 15, 7)
    expect(w.pixels[0]).toBe(blend565(0x0abc, RING_COLOUR, 31));
    expect(w.pixels[0]).toBe((7 << 11) | (15 << 5) | 8); // 31/32 of the way, blue 28 -> 8
    expect(w.pixels[3 * 8 + 3]).toBe(0x1111); // the background covers the middle
  });

  it("positioned films copy a w x h part of the background at the picture's offset (from the right when mirrored)", () => {
    const bg: Image16 = { width: 6, height: 4, kind: "rgb565", pixels: Uint16Array.from({ length: 24 }, (_, i) => 100 + (i % 6)) };
    const src = filmSource({ images: [bg, pic(0x2222, () => true), pic(0x2222, () => true), pic(0x2222, () => true)] });
    src.film.positioned = true;
    src.film.frames[1] = { file: "A", x: 1, y: 0 };
    src.film.frames[2] = { file: "B", x: 2, y: 0 };
    const run = new FilmRun(src, 0, 30, 30, 0);
    expect(run.windowAt(0).pixels[4 * 12 + 4]).toBe(101);
    expect(run.windowAt(100).pixels[4 * 12 + 4]).toBe(102);
    const mirrored = new FilmRun(src, 1, 30, 30, 0);
    // mirrored background: columns 5,4,3,2,1,0 -> value at x of the window is 100 + (5 - (6 - 4 - fx + x))
    expect(mirrored.windowAt(0).pixels[4 * 12 + 4]).toBe(100 + (5 - (6 - 4 - 1)));
  });
});

describe("films and overlays", () => {
  it("the file of a film: the script name plus 16; only OUTRO.AVX ends the game", () => {
    expect(movieBase("ONCAR.AVX")).toBe("ONCAR16");
    expect(movieBase("83jc.avx")).toBe("83JC16");
    expect(isOutro("OUTRO.AVX")).toBe(true);
    expect(isOutro("Z38.AVX")).toBe(false);
  });

  it("overlays are keyed blits clipped to the screen", () => {
    const rgba = new Uint8ClampedArray(640 * 480 * 4);
    drawOverlays(rgba, [{ x: -1, y: 479, image: { width: 2, height: 2, pixels: new Uint16Array([0xf800, 0, 0x07e0, 0x001f]) } }]);
    // of the 2x2 image only (0, 479) lies on the screen, and its value 0 is transparent
    const px = (x: number, y: number) => [...rgba.slice((y * 640 + x) * 4, (y * 640 + x) * 4 + 4)];
    expect(px(0, 479)).toEqual([0, 0, 0, 0]); // pixel value 0 stays transparent
    expect(px(0, 478)).toEqual([0, 0, 0, 0]);
    drawOverlays(rgba, [{ x: 5, y: 5, image: { width: 1, height: 1, pixels: new Uint16Array([0xf800]) } }]);
    expect(px(5, 5)[3]).toBe(255);
    expect(px(5, 5)[0]).toBeGreaterThan(200);
  });
});
