import { describe, expect, it } from "vitest";
import { Mixer, type AudioBackend, type PreparedSound, type Voice, type VoiceParams } from "../audio";
import { JACK, type Command, type Ref } from "../script/compiler";
import { encrypt } from "../formats/textcrypt";
import { loadSceneSounds, psdName, SceneSounds, STEP1_NAME, STEP2_NAME } from "./bank";
import {
  DEFAULT_SFX_VOLUME,
  SFX_COMMANDS,
  SfxPlayer,
  stereoVolumes,
  swapChannel,
  WALK_FRAMES,
  type SfxEnv,
} from "./sfx";

class FakeVoice implements Voice {
  stopped = false;
  gain: number;
  pan: number;
  constructor(
    readonly sound: PreparedSound,
    params: VoiceParams,
    readonly finish: () => void,
  ) {
    this.gain = params.gain;
    this.pan = params.pan;
  }
  stop() {
    this.stopped = true;
  }
  setGain(g: number) {
    this.gain = g;
  }
  setPan(p: number) {
    this.pan = p;
  }
}

class FakeBackend implements AudioBackend {
  voices: FakeVoice[] = [];
  start(sound: PreparedSound, params: VoiceParams, onEnded: () => void): Voice {
    const v = new FakeVoice(sound, params, onEnded);
    this.voices.push(v);
    return v;
  }
  startStream(): Voice {
    throw new Error("no streams here");
  }
  setMasterGain() {}
  setSuspended() {}
}

const tone = (id: number): PreparedSound => ({
  channels: [new Float32Array(100).fill(id / 100)],
  rate: 22050,
  loopStart: 0,
  loopLength: 0,
});

/** a scene with sounds A.SND (0), B.SND (1), KROK1.SND (2), KROK2.SND (3) */
function bankOf(): SceneSounds {
  const b = new SceneSounds();
  for (const n of ["A.SND", "B.SND", STEP1_NAME, STEP2_NAME]) b.add(n, tone(b.length + 1));
  return b;
}

function setup(opts: ConstructorParameters<typeof SfxPlayer>[1] = {}) {
  const backend = new FakeBackend();
  const mixer = new Mixer(backend);
  const sfx = new SfxPlayer(mixer, opts);
  sfx.loadScene(bankOf());
  return { backend, mixer, sfx };
}

const refs = (...r: Ref[]): Ref[] => r;
function cmd(code: number, o: Partial<Command> = {}): Command {
  return { code, word: "", line: 1, n1: "", n2: "", a: [0, 0, 0, 0, 0, 0, 0], f: null, c: null, refs: [], ...o };
}
const env = (a: number[], over: Partial<SfxEnv> = {}): SfxEnv => ({
  person: (n) => ({ POL: 3 })[n as "POL"] ?? -1,
  anim: (n) => ({ DOOR: 7 })[n as "DOOR"] ?? -1,
  arg: (i) => a[i] ?? 0,
  ...over,
});

describe("helpers", () => {
  it("swaps stereo pairs only when asked", () => {
    expect([1, 2, 3, 4, 5, 6].map((c) => swapChannel(c, true))).toEqual([2, 1, 4, 3, 6, 5]);
    expect(swapChannel(2, false)).toBe(2);
    expect(swapChannel(0, true)).toBe(0);
  });

  it("spreads the volume by x like Jack_PlayStep", () => {
    expect(stereoVolumes(64, 1, 0, 0)).toEqual({ left: 64, right: 0 });
    expect(stereoVolumes(64, 1, 640, 0)).toEqual({ left: 0, right: 64 });
    expect(stereoVolumes(64, 1, 320, 0)).toEqual({ left: 32, right: 32 });
    expect(stereoVolumes(64, 0.5, 160, 0)).toEqual({ left: 24, right: 8 });
    // the divisor grows with the scroll but x stays a world position (kept from the original)
    expect(stereoVolumes(64, 1, 320, 640)).toEqual({ left: 48, right: 16 });
    // left screen edge (x = scroll) leans right, right edge (x = scroll + 640) is exact
    expect(stereoVolumes(64, 1, 640, 640)).toEqual({ left: 32, right: 32 });
    expect(stereoVolumes(64, 1, 1280, 640)).toEqual({ left: 0, right: 64 });
  });
});

describe("playIndexed", () => {
  it("doubles the volume (cap 64) and applies SFXVol / 64, then the mixer doubles again", () => {
    const { sfx, mixer } = setup(); // SFXVol 32
    expect(DEFAULT_SFX_VOLUME).toBe(32);
    sfx.playIndexed(1, 0, 10); // 20 * 32 / 64 = 10 -> level 20
    expect(mixer.level(1)).toBe(20);
    sfx.playIndexed(2, 0, 30); // 60 -> 64 cap? 60 < 64: 60 * 32 / 64 = 30 -> level 60
    expect(mixer.level(2)).toBe(60);
    sfx.playIndexed(3, 0, 40); // 80 -> cap 64 -> 32 -> level 64
    expect(mixer.level(3)).toBe(64);
  });

  it("the quietest script volume (1, the sea of SC094) is not rounded to zero", () => {
    // Sound_PlayIndexed: 1 * 2 = 2, 2 * 32 / 64 = 1 (>> 6), Snd_PlaySound << 1 = level 2
    const { sfx, mixer } = setup(); // SFXVol 32
    sfx.playIndexed(13, 0, 1); // EFFECT PORT.SND 13 0 1 1: reserved channel 3
    expect(mixer.isPlaying(3)).toBe(true);
    expect(mixer.level(3)).toBe(2);
    expect(sfx.isReserved(3)).toBe(true);
    // with SFXVol 16 the same call would end at 2 * 16 / 64 = 0 (truncated) - the exe does it too
    const q = setup({ sfxVolume: 16 });
    q.sfx.playIndexed(13, 0, 1);
    expect(q.mixer.level(3)).toBe(0);
  });

  it("scales by the SFXVol option", () => {
    const { sfx, mixer } = setup({ sfxVolume: 64 });
    sfx.playIndexed(1, 0, 20); // 40 * 64 / 64 = 40 -> level 80
    expect(mixer.level(1)).toBe(80);
    const z = setup({ sfxVolume: 0 });
    z.sfx.playIndexed(1, 0, 20);
    expect(z.mixer.level(1)).toBe(0);
  });

  it("ignores volumes above 64, negative ones included (16-bit wrap)", () => {
    const { sfx, mixer } = setup();
    expect(sfx.playIndexed(1, 0, 65)).toBe(false);
    expect(sfx.playIndexed(1, 0, -1)).toBe(false);
    expect(sfx.playIndexed(1, 0, 64)).toBe(true);
    expect(mixer.isPlaying(1)).toBe(true);
  });

  it("ignores a missing sound, a missing .PSD and a machine without sound", () => {
    const { sfx, mixer } = setup();
    expect(sfx.playIndexed(1, -1, 20)).toBe(false);
    const b = new SceneSounds();
    b.add("GONE.SND", undefined);
    sfx.loadScene(b);
    expect(sfx.playIndexed(1, 0, 20)).toBe(false);
    expect(mixer.isPlaying(1)).toBe(false);
    const quiet = setup({ soundEnabled: false });
    expect(quiet.sfx.playIndexed(1, 0, 20)).toBe(false);
    expect(quiet.mixer.isPlaying(1)).toBe(false);
  });

  it("asks for a free channel in the original order", () => {
    const { sfx, mixer } = setup();
    // requests for 1/3 walk 1,3,2,4; anything else 2,4,1,3
    sfx.playIndexed(1, 0, 20);
    sfx.playIndexed(1, 0, 20);
    sfx.playIndexed(1, 0, 20);
    sfx.playIndexed(1, 0, 20);
    expect([1, 2, 3, 4].map((c) => mixer.isPlaying(c))).toEqual([true, true, true, true]);
    expect(sfx.channelOf(0)).toBe(4); // 1, 3, 2, 4
    const r = setup();
    r.sfx.playIndexed(2, 0, 20);
    r.sfx.playIndexed(2, 1, 20);
    expect(r.sfx.channelOf(0)).toBe(2);
    expect(r.sfx.channelOf(1)).toBe(4); // 2 is busy: next of 2,4,1,3
  });

  it("cuts the requested channel when all four are busy", () => {
    const { sfx, mixer, backend } = setup();
    for (let i = 0; i < 4; i++) sfx.playIndexed(1, 0, 20);
    sfx.playIndexed(3, 1, 20);
    expect(sfx.channelOf(1)).toBe(3);
    expect(backend.voices.filter((v) => v.stopped)).toHaveLength(1);
    expect(mixer.isPlaying(3)).toBe(true);
  });

  it("channels 11..16 are exact and reserve the channel until it is idle", () => {
    const { sfx, mixer } = setup();
    sfx.playIndexed(13, 0, 20); // channel 3, reserved
    expect(sfx.channelOf(0)).toBe(3);
    expect(sfx.isReserved(3)).toBe(true);
    sfx.tick(); // still playing
    expect(sfx.isReserved(3)).toBe(true);
    // a request for 1 never gets 3 while it is reserved; with 1 and 2 busy it takes 4
    sfx.playIndexed(1, 1, 20);
    sfx.playIndexed(2, 1, 20);
    sfx.playIndexed(1, 1, 20);
    expect(sfx.channelOf(1)).toBe(4);
    mixer.stop(3);
    sfx.tick();
    expect(sfx.isReserved(3)).toBe(false);
  });

  it("footsteps and plain effects never cut a reserved channel", () => {
    const { sfx, mixer, backend } = setup();
    sfx.playIndexed(14, 0, 20); // channel 4, reserved
    for (let i = 0; i < 6; i++) sfx.effect(1, 1, 20);
    sfx.jackStep(1, 100, 0);
    expect(mixer.isPlaying(4)).toBe(true);
    expect(backend.voices.filter((v) => v.stopped && v.sound === backend.voices[0].sound)).toHaveLength(0);
    expect(sfx.isEffectPlaying(0)).toBe(true);
  });

  it("UNLOCKCANAL and a new scene drop reservations", () => {
    const { sfx } = setup();
    sfx.playIndexed(12, 0, 20);
    expect(sfx.isReserved(2)).toBe(true);
    sfx.unlockChannel(2);
    expect(sfx.isReserved(2)).toBe(false);
    sfx.playIndexed(12, 0, 20);
    sfx.loadScene(bankOf());
    expect(sfx.isReserved(2)).toBe(false);
  });

  it("keeps away from channels that speak", () => {
    const { sfx } = setup();
    sfx.setTalkChannel(1, true);
    sfx.playIndexed(1, 0, 20);
    expect(sfx.channelOf(0)).toBe(3); // 1 speaks: 3 is next in 1,3,2,4
    sfx.setTalkChannel(3, true);
    sfx.playIndexed(1, 1, 20);
    expect(sfx.channelOf(1)).toBe(2);
  });

  it("channels 5 and 6 are asked for a free one of 2,4,1,3 too", () => {
    const { sfx, mixer } = setup();
    sfx.playIndexed(5, 0, 20);
    expect(sfx.channelOf(0)).toBe(2);
    expect(mixer.isPlaying(5)).toBe(false);
  });

  it("swaps the physical channels with RevStereoOnOff", () => {
    const { sfx, mixer } = setup({ swapChannels: true });
    sfx.playIndexed(1, 0, 20);
    expect(sfx.channelOf(0)).toBe(1);
    expect(mixer.isPlaying(2)).toBe(true); // logical 1 plays on 2
    expect(mixer.isPlaying(1)).toBe(false);
    expect(sfx.isEffectPlaying(0)).toBe(true);
  });
});

describe("EFFECT", () => {
  it("channel 0 plays on 1 and 2", () => {
    const { sfx, mixer } = setup();
    sfx.effect(0, 0, 20);
    expect(mixer.isPlaying(1) && mixer.isPlaying(2)).toBe(true);
    expect(sfx.channelOf(0)).toBe(2);
  });

  it("a given channel is only a wish: 4 plays on the free 2 first, 14 exactly on 4", () => {
    const { sfx, mixer } = setup();
    sfx.effect(4, 1, 20);
    expect(mixer.isPlaying(2)).toBe(true);
    expect(mixer.isPlaying(4)).toBe(false);
    sfx.effect(14, 1, 20);
    expect(mixer.isPlaying(4)).toBe(true);
    expect(mixer.isPlaying(1)).toBe(false);
  });
});

describe("EFFECTVOLUME and WAITWHILEEFFECT", () => {
  it("sets the volume of the channel the sound is on; 0 stops it", () => {
    const { sfx, mixer } = setup();
    sfx.effect(1, 0, 10);
    sfx.effectVolume(0, 45);
    expect(mixer.level(1)).toBe(90);
    sfx.effectVolume(0, 100);
    expect(mixer.level(1)).toBe(127);
    sfx.effectVolume(0, 0);
    expect(mixer.isPlaying(1)).toBe(false);
  });

  it("does nothing for a sound that never played", () => {
    const { sfx, mixer } = setup();
    sfx.effectVolume(0, 0); // channel 0 is no channel
    expect(mixer.isPlaying(0)).toBe(false);
  });

  it("waits while the sound plays and not after it ends or is replaced", () => {
    const { sfx, backend } = setup();
    expect(sfx.isEffectPlaying(0)).toBe(false);
    sfx.effect(1, 0, 20);
    expect(sfx.isEffectPlaying(0)).toBe(true);
    backend.voices[0].finish();
    expect(sfx.isEffectPlaying(0)).toBe(false);
    sfx.effect(1, 0, 20);
    sfx.effect(1, 1, 20); // channel 1 is busy: B goes to 3, A still waits
    expect(sfx.isEffectPlaying(0)).toBe(true);
    // all four busy with other sounds: B cuts channel 1 that carried A
    sfx.effect(2, 1, 20);
    sfx.effect(4, 1, 20);
    sfx.effect(1, 1, 20);
    expect(sfx.isEffectPlaying(0)).toBe(false);
  });

  it("never waits without sound", () => {
    const { sfx } = setup({ soundEnabled: false });
    sfx.effect(1, 0, 20);
    expect(sfx.isEffectPlaying(0)).toBe(false);
  });
});

describe("footsteps", () => {
  it("Jack: KROK2 first, then KROK1, right channel before left, volume by x", () => {
    const { sfx, mixer } = setup();
    sfx.jackStep(1, 160, 0); // left 48, right 16
    expect(sfx.channelOf(3)).toBe(1);
    expect(mixer.level(2)).toBe(Math.trunc(Math.min(16 * 2, 64) * 32 / 64) * 2);
    expect(mixer.level(1)).toBe(Math.trunc(Math.min(48 * 2, 64) * 32 / 64) * 2);
    sfx.jackStep(1, 160, 0);
    expect(sfx.channelOf(2)).not.toBe(0);
  });

  it("Jack: skipped when no channel is free (flag 1 never cuts a playing sound)", () => {
    const { sfx, backend } = setup();
    for (let i = 0; i < 4; i++) sfx.effect(1, 0, 20);
    sfx.jackStep(1, 160, 0);
    expect(backend.voices).toHaveLength(4);
    expect(backend.voices.some((v) => v.stopped)).toBe(false);
  });

  it("decides the step frames like Game_Run", () => {
    const { sfx } = setup();
    expect([0, 3, 6].map((f) => sfx.jackStepFrame(f))).toEqual([true, false, true]);
    sfx.setJackStep(0, -1);
    expect(sfx.jackStepFrame(0)).toBe(false);
    sfx.setJackStep(1, -1);
    expect(sfx.jackStepFrame(6)).toBe(false);
  });

  it("a scene without KROK sounds has no steps", () => {
    const { sfx } = setup();
    const b = new SceneSounds();
    b.add("A.SND", tone(1));
    sfx.loadScene(b);
    expect(sfx.step1).toBe(-1);
    expect([0, 6].map((f) => sfx.jackStepFrame(f))).toEqual([false, false]);
  });

  it("persons: sound and volume per frame, spread by scale and x", () => {
    const { sfx, mixer } = setup();
    sfx.setWalkEffect(3, 4, 1, 64, true);
    expect(sfx.walkEffectOf(3, 4)).toEqual({ sound: 1, volume: 64 });
    sfx.walkStep(3, 3, 1, 320, 0); // frame without effect
    expect(mixer.isPlaying(1)).toBe(false);
    sfx.walkStep(3, 4, 0.5, 320, 0); // 16 each
    expect(mixer.level(1)).toBe(Math.trunc((32 * 32) / 64) * 2);
    expect(mixer.level(2)).toBe(Math.trunc((32 * 32) / 64) * 2);
    sfx.setWalkEffect(3, 4, 1, 64, false);
    expect(sfx.walkEffectOf(3, 4).sound).toBe(-1);
  });

  it("persons: sound slot 0 is a sound (KROK1L of POL1 in SC001), not \"effect off\"", () => {
    const { sfx, mixer } = setup();
    sfx.setWalkEffect(5, 0, 0, 64, true);
    expect(sfx.walkEffectOf(5, 0).sound).toBe(0);
    sfx.walkStep(5, 0, 0.7, 400, 0);
    expect([mixer.isPlaying(1), mixer.isPlaying(2)]).toEqual([true, true]);
  });

  it("persons: a second pair of steps while the first still sounds takes over its channels (pair marks)", () => {
    // the mark of the first pair makes channels 1 and 2 eligible although they play: a second person
    // stepping in the same frame cuts the first one's step instead of going to 3 and 4 [original behaviour]
    const { sfx, mixer, backend } = setup();
    sfx.setWalkEffect(5, 0, 0, 64, true);
    sfx.setWalkEffect(8, 0, 1, 64, true);
    sfx.walkStep(5, 0, 1, 320, 0);
    sfx.walkStep(8, 0, 1, 320, 0);
    expect(backend.voices).toHaveLength(4);
    expect(backend.voices.filter((v) => v.stopped)).toHaveLength(2);
    expect([mixer.isPlaying(3), mixer.isPlaying(4)]).toEqual([false, false]);
    // once the pair has ended the marks go with the next tick and the channels are plain free ones again
    backend.voices.forEach((v) => v.finish());
    sfx.tick();
    sfx.walkStep(5, 0, 1, 320, 0);
    expect(mixer.isPlaying(1) && mixer.isPlaying(2)).toBe(true);
  });

  it("ignores persons and frames out of range", () => {
    const { sfx, mixer } = setup();
    sfx.setWalkEffect(17, 0, 1, 64, true);
    sfx.setWalkEffect(0, WALK_FRAMES, 1, 64, true);
    sfx.walkStep(17, 0, 1, 0, 0);
    sfx.walkStep(-1, 0, 1, 0, 0);
    expect(mixer.isPlaying(1)).toBe(false);
  });
});

describe("ANIMAEFFECT", () => {
  it("plays the first entry that fits the image and REC sequence", () => {
    const { sfx, mixer } = setup();
    sfx.addAnimaEffect(7, { image: 4, rec: 1, channel: 3, sound: 0, volume: 20 });
    sfx.addAnimaEffect(7, { image: 4, rec: 1, channel: 4, sound: 1, volume: 20 });
    sfx.addAnimaEffect(7, { image: 5, rec: 0, channel: 0, sound: 1, volume: 20 });
    expect(sfx.animFrameShown(7, 4, 0)).toBe(false);
    expect(sfx.animFrameShown(8, 4, 1)).toBe(false);
    expect(sfx.animFrameShown(7, 4, 1)).toBe(true);
    expect(mixer.isPlaying(1)).toBe(true); // wished 3, the free one of 1,3,2,4
    expect(mixer.isPlaying(2) || mixer.isPlaying(3) || mixer.isPlaying(4)).toBe(false); // first match only
    sfx.animFrameShown(7, 5, 0); // channel 0 = both
    expect(mixer.isPlaying(1) && mixer.isPlaying(2)).toBe(true);
  });

  it("is forgotten with the scene", () => {
    const { sfx } = setup();
    sfx.addAnimaEffect(7, { image: 4, rec: 1, channel: 3, sound: 0, volume: 20 });
    sfx.loadScene(bankOf());
    expect(sfx.animaEffects(7)).toEqual([]);
  });
});

describe("insertion frames", () => {
  it("play like EFFECT, -1 is none", () => {
    const { sfx, mixer } = setup();
    sfx.insertionFrame(-1, 0, 20);
    expect(mixer.isPlaying(1)).toBe(false);
    sfx.insertionFrame(0, 0, 20);
    expect(mixer.isPlaying(1) && mixer.isPlaying(2)).toBe(true);
  });
});

describe("script commands", () => {
  const sound = (n: string) => refs([1, "sound", n]);

  it("EFFECT", () => {
    const { sfx, mixer } = setup();
    const c = cmd(SFX_COMMANDS.EFFECT, { n1: "B.SND", a: [4, 1, 20, 20, 0, 0, 0], refs: sound("B.SND") });
    expect(sfx.command(c, env([4, 1, 20]))).toBe("done");
    expect(mixer.isPlaying(2)).toBe(true);
    expect(mixer.level(2)).toBe(40);
  });

  it("EFFECT with an unknown sound is a no-op", () => {
    const { sfx, mixer } = setup();
    const c = cmd(SFX_COMMANDS.EFFECT, { refs: sound("NOPE.SND") });
    expect(sfx.command(c, env([1, 1, 20]))).toBe("done");
    expect(mixer.isPlaying(1)).toBe(false);
  });

  it("EFFECTVOLUME and WAITWHILEEFFECT", () => {
    const { sfx, mixer, backend } = setup();
    sfx.command(cmd(SFX_COMMANDS.EFFECT, { refs: sound("A.SND") }), env([1, 0, 10]));
    sfx.command(cmd(SFX_COMMANDS.EFFECTVOLUME, { refs: sound("A.SND") }), env([45]));
    expect(mixer.level(1)).toBe(90);
    const wait = cmd(SFX_COMMANDS.WAITWHILEEFFECT, { refs: sound("A.SND") });
    expect(sfx.command(wait, env([]))).toBe("repeat");
    backend.voices[0].finish();
    expect(sfx.command(wait, env([]))).toBe("done");
  });

  it("WAITWHILEEFFECT of an unknown sound does not wait", () => {
    const { sfx } = setup();
    expect(sfx.command(cmd(SFX_COMMANDS.WAITWHILEEFFECT, { refs: sound("NOPE.SND") }), env([]))).toBe("done");
  });

  it("UNLOCKCANAL", () => {
    const { sfx } = setup();
    sfx.playIndexed(11, 0, 20);
    expect(sfx.isReserved(1)).toBe(true);
    sfx.command(cmd(SFX_COMMANDS.UNLOCKCANAL), env([1]));
    expect(sfx.isReserved(1)).toBe(false);
  });

  it("WALKEFFECT of a person and of Jack", () => {
    const { sfx } = setup();
    const person = cmd(SFX_COMMANDS.WALKEFFECT, { n1: "POL", a: [4, 2, 64, 3, 0, 40, 0], refs: [[4, "sound", "A.SND"]] });
    sfx.command(person, env([4, 2, 64, 3, 0, 40]));
    expect(sfx.walkEffectOf(3, 4)).toEqual({ sound: 0, volume: 40 });
    const off = cmd(SFX_COMMANDS.WALKEFFECT, { n1: "POL", a: [4, 2, 0, 3, 0, 0, 0], refs: [[4, "sound", "A.SND"]] });
    sfx.command(off, env([4, 2, 0, 3, 0, 0]));
    expect(sfx.walkEffectOf(3, 4).sound).toBe(-1);
    const jack = (slot: number, n: string) =>
      cmd(SFX_COMMANDS.WALKEFFECT, { n1: "JACK", a: [slot, 0, 0, JACK, 0, 0, 0], refs: [[4, "sound", n]] });
    sfx.command(jack(0, "B.SND"), env([0]));
    sfx.command(jack(1, "A.SND"), env([1]));
    expect([sfx.step1, sfx.step2]).toEqual([1, 0]);
  });

  it("ANIMAEFFECT", () => {
    const { sfx } = setup();
    const c = cmd(SFX_COMMANDS.ANIMAEFFECT, { n1: "DOOR", refs: [[4, "sound", "B.SND"]] });
    sfx.command(c, env([4, 1, 12, 7, 0, 1, 12]));
    expect(sfx.animaEffects(7)).toEqual([{ image: 4, rec: 1, channel: 1, sound: 1, volume: 12 }]);
    sfx.command(cmd(SFX_COMMANDS.ANIMAEFFECT, { n1: "NO_SUCH" }), env([]));
    expect(sfx.animaEffects(-1)).toEqual([]);
  });

  it("other codes are not ours", () => {
    const { sfx } = setup();
    expect(sfx.command(cmd(0x3f), env([]))).toBeUndefined();
  });
});

describe("scene sound list", () => {
  /** type 0x32 IMA file with 8 + 8 samples */
  function psd(): Uint8Array {
    const b = new Uint8Array(0x24 + 4);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, 0x32, true);
    dv.setUint32(4, 4, true);
    dv.setUint32(8, 16, true);
    dv.setUint32(12, 4, true);
    dv.setUint32(0x18, 16, true); // size
    return b;
  }

  it("loads <name>.PSD for every entry and remembers KROK1/KROK2", () => {
    const text = new TextEncoder().encode("a.snd\r\nkrok1.snd\r\nkrok2.snd\r\nmissing.snd\r\n");
    const asked: string[] = [];
    const bank = loadSceneSounds(encrypt(text), (f) => {
      asked.push(f);
      return f === "MISSING.PSD" ? undefined : psd();
    });
    expect(asked).toEqual(["A.PSD", "KROK1.PSD", "KROK2.PSD", "MISSING.PSD"]);
    expect(bank.names).toEqual(["A.SND", "KROK1.SND", "KROK2.SND", "MISSING.SND"]);
    expect([bank.step1, bank.step2]).toEqual([1, 2]);
    expect(bank.find("KROK2.SND")).toBe(2);
    expect(bank.find("NOPE.SND")).toBe(-1);
    expect(bank.sounds[0]?.channels[0].length).toBe(8);
    expect(bank.sounds[3]).toBeUndefined();
  });

  it("keeps the first of two equal names", () => {
    const b = new SceneSounds();
    b.add("A.SND", undefined);
    b.add("A.SND", undefined);
    expect(b.find("A.SND")).toBe(0);
  });

  it("rejects an empty list", () => {
    expect(() => loadSceneSounds(encrypt(new Uint8Array(0)), () => undefined)).toThrow("empty sound list");
  });

  it("names the packed file", () => {
    expect(psdName("KROK1.SND")).toBe("KROK1.PSD");
    expect(psdName("X")).toBe("X.PSD");
  });
});


describe("scene change stops the effect channels (Scene_Load)", () => {
  it("channels 1..4 are silent after loadScene, the music channel is not touched", () => {
    const { mixer, sfx } = setup();
    sfx.effect(0, 0, 32); // channels 1 and 2
    sfx.playIndexed(13, 1, 32); // reserved channel 3
    expect(mixer.isPlaying(1) && mixer.isPlaying(2) && mixer.isPlaying(3)).toBe(true);
    expect(sfx.isReserved(3)).toBe(true);
    mixer.play(5, tone(9), { volume: 1 });
    sfx.loadScene(bankOf());
    for (let ch = 1; ch <= 4; ch++) expect(mixer.isPlaying(ch)).toBe(false);
    expect(mixer.isPlaying(5)).toBe(true);
    expect(sfx.isReserved(3)).toBe(false);
    expect(sfx.isEffectPlaying(0)).toBe(false);
  });
});
