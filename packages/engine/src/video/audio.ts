// Sound sink of the movie player. The AVX sound is one continuous IMA stream (preroll + one chunk
// per frame, 44100 Hz stereo) that the game writes into a 5 s ring buffer on channel 1
// (Media_Step state 5, Media_QueueSound). The mixer plays finished buffers only, so the
// movie gets its own streaming sink; it takes the same channel-1 level (0..127).

import { levelToGain } from "../audio/mixer";
import { AVX_RATE } from "../formats/media";

export interface MovieSoundSink {
  /** Starts playing `pcm` (interleaved stereo Int16, preroll + gap) at once; chunks follow via push(). */
  start(pcm: Int16Array, level: number): void;
  push(pcm: Int16Array): void;
  /**
 * PCM bytes played since start() (4 per sample frame) — the play cursor of the DirectSound buffer.
 * null: nothing is playing (a suspended AudioContext), the player keeps its nominal clock.
 */
  playedBytes(): number | null;
  /** Snd_SetVolume(1, level), 0..127 */
  setLevel(level: number): void;
  /** Media_Close: Snd_StopChannel(1) */
  stop(): void;
}

/** Web Audio implementation: one AudioBufferSourceNode per pushed chunk, scheduled back to back. */
export class WebAudioMovieSink implements MovieSoundSink {
  private gain: GainNode | null = null;
  private t0 = 0;
  private next = 0;
  private sources: AudioBufferSourceNode[] = [];

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode = ctx.destination,
  ) {}

  start(pcm: Int16Array, level: number): void {
    this.stop();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = levelToGain(level);
    this.gain.connect(this.destination);
    this.t0 = this.next = this.ctx.currentTime;
    this.push(pcm);
  }

  push(pcm: Int16Array): void {
    const gain = this.gain;
    if (!gain || !pcm.length) return;
    const frames = pcm.length / 2;
    const buf = this.ctx.createBuffer(2, frames, AVX_RATE);
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      l[i] = pcm[2 * i] / 32768;
      r[i] = pcm[2 * i + 1] / 32768;
    }
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    // an underrun (suspended tab) restarts at the present, like a DirectSound buffer that ran dry
    if (this.next < this.ctx.currentTime) this.next = this.ctx.currentTime;
    src.start(this.next);
    this.next += frames / AVX_RATE;
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      src.disconnect();
    };
    this.sources.push(src);
  }

  playedBytes(): number | null {
    if (this.ctx.state !== "running") return null;
    return Math.max(0, Math.round((this.ctx.currentTime - this.t0) * AVX_RATE)) * 4;
  }

  setLevel(level: number): void {
    if (this.gain) this.gain.gain.value = levelToGain(level);
  }

  stop(): void {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // not started yet
      }
      s.disconnect();
    }
    this.sources = [];
    this.gain?.disconnect();
    this.gain = null;
  }
}

/** Test/headless sink: counts bytes, plays nothing; `played` is set by the test or by a fake clock. */
export class FakeMovieSink implements MovieSoundSink {
  started = false;
  written = 0;
  played: number | null = 0;
  level = -1;
  levels: number[] = [];
  stopped = false;

  start(pcm: Int16Array, level: number): void {
    this.started = true;
    this.written = pcm.length * 2;
    this.level = level;
  }
  push(pcm: Int16Array): void {
    this.written += pcm.length * 2;
  }
  playedBytes(): number | null {
    return this.played;
  }
  setLevel(level: number): void {
    this.level = level;
    this.levels.push(level);
  }
  stop(): void {
    this.stopped = true;
  }
}
