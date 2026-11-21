// A sound backend for tests: no output, voices end by a clock the test advances (`advance(seconds)`), so that
// WAITWHILEEFFECT, speech lengths and channel use behave as with a sound card. Used only by tests.
import type { AudioBackend, PreparedSound, StreamSource, Voice, VoiceParams } from "../audio/types";

export interface FakeVoice {
  /** "sound" (a buffer) or "stream" (music) */
  kind: "sound" | "stream";
  params: VoiceParams;
  /** seconds on the backend clock at which it ends, Infinity = loops / streams */
  end: number;
  stopped: boolean;
  ended: boolean;
  /** frames of the sound (0 for streams) */
  frames: number;
}

export class TimedBackend implements AudioBackend {
  now = 0;
  readonly voices: FakeVoice[] = [];
  master = 1;
  suspended = false;
  private readonly callbacks = new Map<FakeVoice, () => void>();

  start(sound: PreparedSound, params: VoiceParams, onEnded: () => void): Voice {
    const frames = sound.channels[0].length;
    return this.add({ kind: "sound", params: { ...params }, end: sound.loopLength ? Infinity : this.now + frames / sound.rate, stopped: false, ended: false, frames }, onEnded);
  }

  startStream(_source: StreamSource, params: VoiceParams, onEnded: () => void): Voice {
    return this.add({ kind: "stream", params: { ...params }, end: Infinity, stopped: false, ended: false, frames: 0 }, onEnded);
  }

  private add(v: FakeVoice, onEnded: () => void): Voice {
    this.voices.push(v);
    this.callbacks.set(v, onEnded);
    return {
      stop: () => {
        v.stopped = true;
      },
      setGain: (g) => {
        v.params.gain = g;
      },
      setPan: (p) => {
        v.params.pan = p;
      },
    };
  }

  setMasterGain(gain: number): void {
    this.master = gain;
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  /** Moves the clock; voices that ran out report their end. */
  advance(seconds: number): void {
    if (this.suspended) return;
    this.now += seconds;
    for (const v of this.voices) {
      if (v.stopped || v.ended || v.end > this.now) continue;
      v.ended = true;
      this.callbacks.get(v)?.();
    }
  }

  /** Voices that were started and not stopped or ended. */
  get playing(): FakeVoice[] {
    return this.voices.filter((v) => !v.stopped && !v.ended);
  }
}
