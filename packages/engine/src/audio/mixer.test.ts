import { describe, expect, it } from "vitest";
import { Sound, SOUND_RATE } from "../formats/sound";
import {
  CHANNEL_COUNT,
  defaultPan,
  gameVolumeToLevel,
  levelToAttenuation,
  levelToGain,
  Mixer,
  MUSIC_CHANNEL,
  prepareSound,
  soundDuration,
  type AudioBackend,
  type EndEvent,
  type PreparedSound,
  type Voice,
  type VoiceParams,
} from "./index";

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
  master = 1;
  suspended = false;
  start(sound: PreparedSound, params: VoiceParams, onEnded: () => void): Voice {
    const v = new FakeVoice(sound, params, onEnded);
    this.voices.push(v);
    return v;
  }
  startStream(): Voice {
    throw new Error("streams are tested in music.test.ts");
  }
  setMasterGain(g: number) {
    this.master = g;
  }
  setSuspended(s: boolean) {
    this.suspended = s;
  }
}

const tone = (frames = 100, loopStart = 0, loopLength = 0): PreparedSound => ({
  channels: [new Float32Array(frames).fill(0.5)],
  rate: SOUND_RATE,
  loopStart,
  loopLength,
});

function setup() {
  const backend = new FakeBackend();
  const mixer = new Mixer(backend);
  const events: EndEvent[] = [];
  mixer.onEnd((e) => events.push(e));
  return { backend, mixer, events };
}

describe("volume and pan mapping", () => {
  it("doubles the game volume and clamps to 0..127", () => {
    expect(gameVolumeToLevel(0)).toBe(0);
    expect(gameVolumeToLevel(30)).toBe(60);
    expect(gameVolumeToLevel(64)).toBe(127);
    expect(gameVolumeToLevel(1000)).toBe(127);
    expect(gameVolumeToLevel(-5)).toBe(0);
  });

  it("maps level to DirectSound attenuation like Snd_SetVolume", () => {
    // trunc(1600 * ln(level * 0.007874)) computed independently (0.007874 constant read from the exe, not 1/127)
    const table: Array<[number, number]> = [
      [0, -10000],
      [1, -7750],
      [2, -6641],
      [8, -4423],
      [64, -1096],
      [126, -12],
      [127, 0],
    ];
    for (const [level, mB] of table) expect(levelToAttenuation(level), `level ${level}`).toBe(mB);
    expect(levelToAttenuation(500)).toBe(0); // clamped to 0x7f
    expect(levelToAttenuation(-1)).toBe(-10000);
    expect(levelToAttenuation(Number.NaN)).toBe(-10000);
  });

  it("maps level to gain 10^(mB/2000), silence at 0", () => {
    expect(levelToGain(0)).toBe(0);
    expect(levelToGain(-3)).toBe(0);
    expect(levelToGain(127)).toBe(1);
    expect(levelToGain(500)).toBe(1);
    expect(20 * Math.log10(levelToGain(2))).toBeCloseTo(-66.41, 2);
    expect(20 * Math.log10(levelToGain(8))).toBeCloseTo(-44.23, 2);
    expect(levelToGain(1)).toBeGreaterThan(0);
    expect(levelToGain(1)).toBeLessThan(levelToGain(2));
    for (let l = 1; l < 127; l++) expect(levelToGain(l)).toBeLessThan(levelToGain(l + 1));
  });

  it("pans channels 1/3 left, 2/4 right, others centre", () => {
    expect([1, 2, 3, 4, 5, 6].map(defaultPan)).toEqual([-1, 1, -1, 1, 0, 0]);
  });
});

describe("Mixer channels", () => {
  it("has the original channel layout", () => {
    expect(CHANNEL_COUNT).toBe(7);
    expect(MUSIC_CHANNEL).toBe(5);
  });

  it("rejects channel 0, 7 and fractions, and empty sounds", () => {
    const { mixer, backend } = setup();
    for (const ch of [0, 7, -1, 1.5, NaN]) expect(mixer.play(ch, tone())).toBeNull();
    expect(mixer.play(1, { ...tone(), channels: [] })).toBeNull();
    expect(mixer.play(1, tone(0))).toBeNull();
    expect(backend.voices).toHaveLength(0);
  });

  it("starts a voice with volume and default pan", () => {
    const { mixer, backend } = setup();
    const p = mixer.play(2, tone(), { volume: 60 })!;
    expect(p.channel).toBe(2);
    expect(mixer.isPlaying(2)).toBe(true);
    expect(backend.voices[0].gain).toBeCloseTo(levelToGain(60));
    expect(backend.voices[0].pan).toBe(1);
  });

  it("cuts off a busy channel and reports 'replaced'", async () => {
    const { mixer, backend, events } = setup();
    const a = mixer.play(3, tone())!;
    const b = mixer.play(3, tone())!;
    expect(backend.voices[0].stopped).toBe(true);
    expect(backend.voices[1].stopped).toBe(false);
    expect(await a.ended).toBe("replaced");
    expect(events).toEqual([{ channel: 3, id: a.id, reason: "replaced" }]);
    expect(mixer.isPlaying(3)).toBe(true);
    expect(b.id).not.toBe(a.id);
  });

  it("channels are independent", () => {
    const { mixer, backend } = setup();
    mixer.play(1, tone());
    mixer.play(2, tone());
    expect(backend.voices.some((v) => v.stopped)).toBe(false);
    mixer.stop(1);
    expect(mixer.isPlaying(1)).toBe(false);
    expect(mixer.isPlaying(2)).toBe(true);
  });

  it("reports natural end once, and ignores a stale end after replacement", async () => {
    const { mixer, backend, events } = setup();
    const a = mixer.play(4, tone())!;
    backend.voices[0].finish();
    expect(await a.ended).toBe("finished");
    expect(mixer.isPlaying(4)).toBe(false);
    expect(backend.voices[0].stopped).toBe(false); // already over, nothing to stop
    const b = mixer.play(4, tone())!;
    backend.voices[0].finish(); // late duplicate callback of the old voice
    expect(mixer.isPlaying(4)).toBe(true);
    expect(events.map((e) => e.reason)).toEqual(["finished"]);
    backend.voices[1].finish();
    expect(await b.ended).toBe("finished");
  });

  it("stop and stopAll end playbacks as 'stopped'", async () => {
    const { mixer, backend } = setup();
    const a = mixer.play(1, tone())!;
    const b = mixer.play(5, tone())!;
    mixer.stop(1);
    mixer.stop(1); // idle: no-op
    expect(await a.ended).toBe("stopped");
    mixer.stopAll();
    expect(await b.ended).toBe("stopped");
    expect(backend.voices.every((v) => v.stopped)).toBe(true);
    expect(mixer.isPlaying(5)).toBe(false);
  });

  it("whenIdle resolves immediately on an idle channel and after the end otherwise", async () => {
    const { mixer, backend } = setup();
    await mixer.whenIdle(1);
    mixer.play(1, tone());
    let done = false;
    const w = mixer.whenIdle(1).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    backend.voices[0].finish();
    await w;
    expect(done).toBe(true);
  });

  it("onEnd returns an unsubscribe function", () => {
    const { mixer } = setup();
    const seen: number[] = [];
    const off = mixer.onEnd((e) => seen.push(e.channel));
    mixer.play(1, tone());
    mixer.stop(1);
    off();
    mixer.play(1, tone());
    mixer.stop(1);
    expect(seen).toEqual([1]);
  });

  it("changes the volume of a playing channel only (music fade)", () => {
    const { mixer, backend } = setup();
    mixer.setChannelVolume(5, 10); // idle: ignored
    mixer.play(5, tone(), { volume: 127 });
    mixer.setChannelVolume(5, 64);
    expect(backend.voices[0].gain).toBeCloseTo(levelToGain(64));
    expect(mixer.level(5)).toBe(64);
    mixer.setChannelVolume(5, 999);
    expect(mixer.level(5)).toBe(127);
    mixer.setChannelVolume(5, -3);
    expect(backend.voices[0].gain).toBe(0);
  });

  it("master volume and pause go to the backend", () => {
    const { mixer, backend } = setup();
    mixer.setMasterVolume(2);
    expect(mixer.masterVolume).toBe(1);
    mixer.setMasterVolume(0.25);
    expect(backend.master).toBe(0.25);
    mixer.setPaused(true);
    expect([mixer.paused, backend.suspended]).toEqual([true, true]);
    mixer.setPaused(false);
    expect(backend.suspended).toBe(false);
  });

  it("passes the loop range through, unless noLoop", () => {
    const { mixer, backend } = setup();
    mixer.play(5, tone(100, 20, 50));
    mixer.play(6, tone(100, 20, 50), { noLoop: true });
    expect([backend.voices[0].sound.loopStart, backend.voices[0].sound.loopLength]).toEqual([20, 50]);
    expect(backend.voices[1].sound.loopLength).toBe(0);
  });
});

// --- prepareSound on synthetic data ---------------------------------------------

/** Raw .S16 buffer: size, loop_start, loop_length (bytes), then 16-bit samples. */
function rawS16(samples: number[], loopStart = 0, loopLength = 0): Uint8Array {
  const out = new Uint8Array(12 + samples.length * 2);
  const v = new DataView(out.buffer);
  v.setUint32(0, samples.length * 2, true);
  v.setUint32(4, loopStart, true);
  v.setUint32(8, loopLength, true);
  samples.forEach((s, i) => v.setInt16(12 + 2 * i, s, true));
  return out;
}

describe("prepareSound", () => {
  it("converts 16-bit samples to floats at 22050 Hz", () => {
    const p = prepareSound(new Sound(rawS16([0, 16384, -32768, 32767]), "S16"));
    expect(p.rate).toBe(22050);
    expect(p.channels).toHaveLength(1);
    expect([...p.channels[0]]).toEqual([0, 0.5, -1, 32767 / 32768]);
    expect(p.loopLength).toBe(0);
    expect(soundDuration(p)).toBeCloseTo(4 / 22050);
  });

  it("converts byte loop offsets to frames", () => {
    const p = prepareSound(new Sound(rawS16([1, 2, 3, 4, 5, 6], 4, 6), "S16"));
    expect([p.loopStart, p.loopLength]).toEqual([2, 3]);
  });

  it("clamps a loop that runs past the data and drops one that starts past it", () => {
    const over = prepareSound(new Sound(rawS16([1, 2, 3, 4], 2, 100), "S16"));
    expect([over.loopStart, over.loopLength]).toEqual([1, 3]);
    const past = prepareSound(new Sound(rawS16([1, 2], 40, 8), "S16"));
    expect(past.loopLength).toBe(0);
  });

  it("allows another sample rate", () => {
    expect(prepareSound(new Sound(rawS16([1, 2]), "S16"), 44100).rate).toBe(44100);
  });
});
