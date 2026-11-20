// WebAudioMovieSink against a fake AudioContext. No sound device.
import { describe, expect, it } from "vitest";
import { AVX_RATE } from "../formats/media";
import { WebAudioMovieSink } from "./audio";

interface Started {
  when: number;
  frames: number;
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeSource extends FakeNode {
  buffer: { frames: number } | null = null;
  onended: (() => void) | null = null;
  stopped = 0;
  disconnected = 0;
  constructor(private readonly started: Started[]) {
    super();
  }
  start(when: number): void {
    this.started.push({ when, frames: this.buffer?.frames ?? 0 });
  }
  override disconnect(): void {
    this.disconnected++;
  }
  stop(): void {
    this.stopped++;
  }
}

class FakeContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  readonly destination = new FakeNode();
  readonly started: Started[] = [];
  readonly sources: FakeSource[] = [];
  gain: { value: number } | null = null;

  createGain(): FakeNode & { gain: { value: number } } {
    const gain = { value: 0 };
    this.gain = gain;
    return Object.assign(new FakeNode(), { gain });
  }
  createBuffer(_channels: number, frames: number, _rate: number): { frames: number; copyToChannel(): void } {
    return { frames, copyToChannel() {} };
  }
  createBufferSource(): FakeSource {
    const src = new FakeSource(this.started);
    this.sources.push(src);
    return src;
  }
}

const pcm = (frames: number) => new Int16Array(frames * 2);

describe("WebAudioMovieSink", () => {
  it("schedules the next chunk at the end of the previous one", () => {
    const ctx = new FakeContext();
    const sink = new WebAudioMovieSink(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode);
    sink.start(pcm(2), 64);
    sink.push(pcm(4));
    expect(ctx.started.map((s) => s.when)).toEqual([0, 2 / AVX_RATE]);
    expect(ctx.started.map((s) => s.frames)).toEqual([2, 4]);
  });

  it("restarts at the present when the context has run past the cursor", () => {
    const ctx = new FakeContext();
    const sink = new WebAudioMovieSink(ctx as unknown as AudioContext);
    sink.start(pcm(2), 10);
    ctx.currentTime = 10;
    sink.push(pcm(2));
    expect(ctx.started.at(-1)?.when).toBe(10);
  });

  it("reports played bytes only while the context is running", () => {
    const ctx = new FakeContext();
    const sink = new WebAudioMovieSink(ctx as unknown as AudioContext);
    sink.start(pcm(2), 10);
    expect(sink.playedBytes()).toBeNull();
    ctx.state = "running";
    ctx.currentTime = 0.5;
    expect(sink.playedBytes()).toBe(Math.round(0.5 * AVX_RATE) * 4);
  });

  it("stops and disconnects the sources, and a second stop does not stop them again", () => {
    const ctx = new FakeContext();
    const sink = new WebAudioMovieSink(ctx as unknown as AudioContext);
    sink.start(pcm(2), 10);
    sink.stop();
    expect(ctx.sources[0].stopped).toBe(1);
    expect(ctx.sources[0].disconnected).toBe(1);
    sink.stop();
    expect(ctx.sources[0].stopped).toBe(1);
  });
});
