import { describe, expect, it } from "vitest";
import { decodeIma, Sound } from "../formats/sound";
import {
  Mixer,
  MUSIC_CHANNEL,
  type AudioBackend,
  type PreparedSound,
  type StreamSource,
  type Voice,
  type VoiceParams,
} from "./index";
import { MUSIC_BUFFER_BYTES, MUSIC_CHUNK_BYTES, MUSIC_RATE, MusicError, MusicPlayer, PmsStream } from "./music";

/** Builds a .PMS: 24-byte codec header + `words` (2 per 8 frames, left then right). */
function makePms(words: number[], loopOffset = 0, init = { pred: 0, index: 0, predR: 0 }): Uint8Array {
  const packed = words.length * 4;
  const out = new Uint8Array(24 + packed);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x33, true);
  v.setUint32(4, packed, true);
  v.setUint32(8, packed * 4, true);
  v.setUint32(12, loopOffset, true);
  v.setInt16(16, init.pred, true);
  v.setUint8(18, init.index);
  v.setInt16(20, init.predR, true);
  words.forEach((w, i) => v.setUint32(24 + i * 4, w >>> 0, true));
  return out;
}

/** deterministic pseudo-random words, `groups` x 8 frames */
function noise(groups: number, seed = 1): number[] {
  const w: number[] = [];
  let s = seed;
  for (let i = 0; i < groups * 2; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    w.push(s);
  }
  return w;
}

/** First pass as interleaved int16 via the independent one-shot decoder. */
function reference(bytes: Uint8Array): Int16Array {
  const s = new Sound(bytes, "PMS");
  return decodeIma(bytes.subarray(24, 24 + s.packedSize), s.unpackedSize, s.predictor, s.index, 2, s.predictorRight);
}

function take(stream: PmsStream, frames: number, chunk = 1000): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  let n = 0;
  while (n < frames) {
    const [a, b] = stream.read(Math.min(chunk, frames - n));
    if (!a.length) break;
    l.set(a, n);
    r.set(b, n);
    n += a.length;
  }
  return { l: l.subarray(0, n), r: r.subarray(0, n) };
}

const f32 = (pcm: Int16Array, ch: number, from = 0, to = pcm.length / 2) =>
  Float32Array.from({ length: to - from }, (_, i) => pcm[(from + i) * 2 + ch] / 32768);

describe("PmsStream (synthetic)", () => {
  it("first pass equals the one-shot decode, whatever the read size", () => {
    const bytes = makePms(noise(50), 0, { pred: 120, index: 9, predR: -300 });
    const ref = reference(bytes);
    for (const chunk of [1, 7, 8, 9, 64, 399, 400, 5000]) {
      const { l, r } = take(new PmsStream(bytes), 400, chunk);
      expect(l).toEqual(f32(ref, 0));
      expect(r).toEqual(f32(ref, 1));
    }
  });

  it("loops from loop_offset with the saved IMA state: later passes repeat the first", () => {
    const loopOffset = 8 * 20; // 20 groups = 160 frames
    const bytes = makePms(noise(50, 5), loopOffset, { pred: -40, index: 30, predR: 77 });
    const s = new PmsStream(bytes);
    expect(s.loops).toBe(true);
    expect(s.loopStartFrame).toBe(160);
    const a = take(s, 400 + 240 * 3 + 13, 77);
    const tail = f32(reference(bytes), 0, 160, 400);
    for (let pass = 0; pass < 3; pass++) {
      expect(a.l.subarray(400 + 240 * pass, 400 + 240 * (pass + 1))).toEqual(tail);
    }
    expect(a.l.length).toBe(400 + 240 * 3 + 13); // never ends
    expect(s.ended).toBe(false);
  });

  it("restores the state saved at the loop point, not the initial one", () => {
    // every nibble 7 climbs, so the state at the loop point differs from the initial one
    const bytes = makePms(new Array(40).fill(0x77777777), 8 * 10);
    const { l } = take(new PmsStream(bytes), 400 + 8, 400);
    expect(l[80]).toBeGreaterThan(l[0]);
    expect(l[400]).toBe(l[80]); // first frame of the second pass = frame at loop start
    expect(l[407]).toBe(l[87]);
  });

  it("loop_offset 0 loops the whole track", () => {
    const s = new PmsStream(makePms(noise(4, 2), 0));
    const { l } = take(s, 32 * 3, 5);
    expect(l.subarray(32, 64)).toEqual(l.subarray(0, 32));
    expect(l.subarray(64, 96)).toEqual(l.subarray(0, 32));
  });

  it("loop_offset == packed_size plays once and then ends", () => {
    const once = makePms(noise(3, 9), 24); // 3 groups = 24 bytes of data
    const s = new PmsStream(once);
    expect(s.loops).toBe(false);
    const { l } = take(s, 100, 10);
    expect(l.length).toBe(24);
    expect(l).toEqual(f32(reference(once), 0));
    expect(s.ended).toBe(true);
    expect(s.read(8)[0].length).toBe(0);
  });

  it("read(0) and partial reads keep the position", () => {
    const bytes = makePms(noise(3), 0);
    const s = new PmsStream(bytes);
    expect(s.read(0)[0].length).toBe(0);
    s.read(3);
    expect(s.framesRead).toBe(3);
    expect(take(s, 21, 4).l).toEqual(f32(reference(bytes), 0, 3, 24));
  });

  it("saturates at full scale like the exe's decoder", () => {
    const { l } = take(new PmsStream(makePms(new Array(60).fill(0x77777777), 0)), 240);
    expect(Math.max(...l)).toBeLessThanOrEqual(32767 / 32768);
    expect(l[239]).toBeCloseTo(32767 / 32768, 5);
  });

  describe("errors", () => {
    it("rejects data that is not a stereo IMA file", () => {
      expect(() => new PmsStream(new Uint8Array(2))).toThrow(MusicError);
      const mono = new Uint8Array([...makePms(noise(2)), ...new Uint8Array(12)]);
      mono[0] = 0x32;
      expect(() => new PmsStream(mono)).toThrow(/not IMA stereo/);
    });
    it("rejects truncated data", () => {
      const bytes = makePms(noise(4));
      expect(() => new PmsStream(bytes.subarray(0, bytes.length - 3))).toThrow(MusicError);
    });
    it("rejects bad sizes and loop offsets", () => {
      const bad = (patch: (v: DataView) => void) => {
        const b = makePms(noise(4));
        patch(new DataView(b.buffer));
        return () => new PmsStream(b);
      };
      expect(bad((v) => v.setUint32(8, 7, true))).toThrow(/4 x packed/);
      expect(bad((v) => v.setUint32(12, 12, true))).toThrow(/loop offset 12/);
      expect(bad((v) => v.setUint32(12, 1 << 20, true))).toThrow(/loop offset/);
      const odd = makePms(noise(1));
      new DataView(odd.buffer).setUint32(4, 4, true);
      new DataView(odd.buffer).setUint32(8, 16, true);
      expect(() => new PmsStream(odd)).toThrow(/multiple of 8/);
    });
  });

  it("keeps the ring buffer constants of", () => {
    expect(MUSIC_RATE).toBe(0xac44);
    expect(MUSIC_BUFFER_BYTES / (MUSIC_RATE * 4)).toBeCloseTo(4, 2);
    expect(MUSIC_CHUNK_BYTES).toBe(2 * 0xac00);
  });
});

// --- player / mixer integration with a fake backend -----------------------------------

class FakeStreamVoice implements Voice {
  stopped = false;
  gain: number;
  constructor(
    readonly source: StreamSource,
    params: VoiceParams,
  ) {
    this.gain = params.gain;
  }
  stop() {
    this.stopped = true;
  }
  setGain(g: number) {
    this.gain = g;
  }
  setPan() {}
}

class FakeBackend implements AudioBackend {
  streams: FakeStreamVoice[] = [];
  start(_s: PreparedSound, _p: VoiceParams, _e: () => void): Voice {
    throw new Error("unused");
  }
  startStream(source: StreamSource, params: VoiceParams): Voice {
    const v = new FakeStreamVoice(source, params);
    this.streams.push(v);
    return v;
  }
  setMasterGain() {}
  setSuspended() {}
}

describe("MusicPlayer", () => {
  const track = () => makePms(noise(10), 0);
  const setup = (opts = {}) => {
    const backend = new FakeBackend();
    const mixer = new Mixer(backend);
    return { backend, mixer, music: new MusicPlayer(mixer, { musicVolume: 40, ...opts }) };
  };

  it("starts silent on channel 5; the first 14 ms tick sets the full MusicVol - no fade-in (Music_Start)", () => {
    const { mixer, music, backend } = setup();
    music.play("TR02-22.PMS", track(), 10);
    expect(mixer.isPlaying(MUSIC_CHANNEL)).toBe(true);
    expect(backend.streams[0].gain).toBe(0);
    expect(music.volume).toBe(40); // ftol(MusicVol * scale), not 0
    const levels: number[] = [];
    for (let i = 0; i < 3; i++) {
      music.tick14ms();
      levels.push(mixer.level(MUSIC_CHANNEL)!);
    }
    expect(levels).toEqual([80, 80, 80]);
  });

  it("the fade-in step makes no difference: 0, 1 and 2 all reach the target on the first tick", () => {
    for (const step of [0, 1, 2]) {
      const { mixer, music } = setup({ musicVolume: 35 });
      music.play("a.pms", track(), step);
      expect(mixer.level(MUSIC_CHANNEL)).toBe(0);
      music.tick14ms();
      expect(mixer.level(MUSIC_CHANNEL)).toBe(70);
    }
  });

  it("the script multiplier scales the start volume", () => {
    const { mixer, music } = setup({ scale: 0.5 });
    music.play("a.pms", track(), 1);
    music.tick14ms();
    expect(mixer.level(MUSIC_CHANNEL)).toBe(40);
  });

  it("a new track replaces the old one without a queue", () => {
    const { mixer, music, backend } = setup();
    music.play("a.pms", track());
    music.play("b.pms", track());
    expect(backend.streams[0].stopped).toBe(true);
    expect(backend.streams[1].stopped).toBe(false);
    expect(music.trackName).toBe("b.pms");
    expect(mixer.isPlaying(MUSIC_CHANNEL)).toBe(true);
  });

  it("stop silences channel 5 but remembers the name", () => {
    const { mixer, music } = setup();
    music.play("a.pms", track());
    music.stop();
    expect(mixer.isPlaying(MUSIC_CHANNEL)).toBe(false);
    expect(music.trackName).toBe("a.pms");
    music.tick14ms(); // no effect on an idle channel
    expect(mixer.level(MUSIC_CHANNEL)).toBeUndefined();
  });

  it("command: same name is a no-op; a change with a fade-out first retries, then switches", () => {
    const { mixer, music, backend } = setup();
    expect(music.command("a.pms", 0, 0, track)).toBe("done");
    expect(backend.streams.length).toBe(1);
    music.tick14ms();
    expect(music.command("a.pms", 20, 0, track)).toBe("done");
    expect(backend.streams.length).toBe(1);
    expect(music.command("b.pms", 20, 0, track)).toBe("retry");
    expect(music.volume).toBe(40);
    music.tick14ms(); // 40 -> 20
    expect(mixer.level(MUSIC_CHANNEL)).toBe(40);
    expect(music.command("b.pms", 20, 0, track)).toBe("retry");
    music.tick14ms(); // 20 - 20 < 1: silent, fade-out done
    expect(mixer.level(MUSIC_CHANNEL)).toBe(0);
    expect(music.command("b.pms", 20, 0, track)).toBe("done");
    expect(music.trackName).toBe("b.pms");
    expect(backend.streams.length).toBe(2);
    expect(music.command("c.pms", 20, 0, track)).toBe("retry"); // fade state was reset
  });

  it("command without a fade-out switches immediately", () => {
    const { music, backend } = setup();
    music.command("a.pms", 0, 0, track);
    expect(music.command("b.pms", 0, 3, track)).toBe("done");
    expect(backend.streams.length).toBe(2);
  });

  it("when music is disabled a command only remembers the name", () => {
    const { music, backend } = setup({ enabled: false });
    const never = (): Uint8Array => {
      throw new Error("must not load");
    };
    expect(music.command("a.pms", 5, 5, never)).toBe("done");
    expect(music.trackName).toBe("a.pms");
    expect(backend.streams.length).toBe(0);
    music.tick14ms();
  });

  it("MusicVol below 5 stops the music, above 5 restarts the current track", () => {
    const names: string[] = [];
    const { mixer, music, backend } = setup({
      load: (n: string) => {
        names.push(n);
        return track();
      },
    });
    music.play("a.pms", track());
    music.setMusicVolume(3);
    expect(mixer.isPlaying(MUSIC_CHANNEL)).toBe(false);
    music.setMusicVolume(2); // already muted: nothing more happens
    music.setMusicVolume(50);
    expect(names).toEqual(["a.pms"]);
    expect(mixer.isPlaying(MUSIC_CHANNEL)).toBe(true);
    expect(backend.streams.length).toBe(2);
    music.tick14ms();
    expect(mixer.level(MUSIC_CHANNEL)).toBe(100);
  });

  it("ducking fades down to the target and back up", () => {
    const { mixer, music } = setup();
    music.play("a.pms", track());
    music.tick14ms(); // volume 40
    music.duck("down", 10, 10);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      music.tick14ms();
      seen.push(mixer.level(MUSIC_CHANNEL)!);
    }
    expect(seen).toEqual([60, 40, 20, 20, 20]);
    music.duck("up", 10, 40);
    for (let i = 0; i < 5; i++) music.tick14ms();
    expect(mixer.level(MUSIC_CHANNEL)).toBe(80);
  });
});
