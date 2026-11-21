// A mixer and a scene bank for effect tests. Used only by tests.
import { Mixer, type AudioBackend, type PreparedSound, type Voice, type VoiceParams } from "../audio";
import { SceneSounds, STEP1_NAME, STEP2_NAME } from "./bank";
import { SfxPlayer } from "./sfx";

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

export const tone = (id: number): PreparedSound => ({
  channels: [new Float32Array(100).fill(id / 100)],
  rate: 22050,
  loopStart: 0,
  loopLength: 0,
});

/** a scene with sounds A.SND (0), B.SND (1), KROK1.SND (2), KROK2.SND (3) */
export function bankOf(): SceneSounds {
  const b = new SceneSounds();
  for (const n of ["A.SND", "B.SND", STEP1_NAME, STEP2_NAME]) b.add(n, tone(b.length + 1));
  return b;
}

export function setup(opts: ConstructorParameters<typeof SfxPlayer>[1] = {}) {
  const backend = new FakeBackend();
  const mixer = new Mixer(backend);
  const sfx = new SfxPlayer(mixer, opts);
  sfx.loadScene(bankOf());
  return { backend, mixer, sfx };
}
