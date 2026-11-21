// WebAudioBackend against a fake AudioContext (no browser): the pause and the autoplay unlock.
import { describe, expect, it } from "vitest";
import { WebAudioBackend } from "./webaudio";

class FakeNode {
  /** nodes this one feeds (the graph, for the routing tests) */
  readonly out: FakeNode[] = [];
  connect<T>(n: T): T {
    this.out.push(n as unknown as FakeNode);
    return n;
  }
  disconnect(): void {}
}

/** `to` is reachable from `from` along connections */
function reaches(from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.out.some((n) => reaches(n, to, seen));
}

class FakeContext {
  state: "suspended" | "running" = "suspended";
  calls: string[] = [];
  /** the browser allows resume() (a user gesture happened) */
  allowed = false;
  destination = new FakeNode();
  createGain() {
    return Object.assign(new FakeNode(), { gain: { value: 1 } });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: { value: 0 } });
  }
  createChannelSplitter() {
    return new FakeNode();
  }
  createChannelMerger() {
    return new FakeNode();
  }
  createBuffer() {
    return { copyToChannel() {} };
  }
  createBufferSource() {
    return Object.assign(new FakeNode(), {
      buffer: null,
      loop: false,
      onended: null,
      start() {},
      stop() {},
    });
  }
  suspend(): Promise<void> {
    this.calls.push("suspend");
    this.state = "suspended";
    return Promise.resolve();
  }
  resume(): Promise<void> {
    this.calls.push("resume");
    if (!this.allowed) return Promise.reject(new Error("not allowed"));
    this.state = "running";
    return Promise.resolve();
  }
}

function make() {
  const ctx = new FakeContext();
  const backend = new WebAudioBackend(ctx as unknown as AudioContext);
  return { ctx, backend };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("WebAudioBackend pause", () => {
  it("setSuspended suspends and resumes the context", async () => {
    const { ctx, backend } = make();
    ctx.allowed = true;
    await backend.unlock();
    expect(ctx.state).toBe("running");
    backend.setSuspended(true);
    expect(backend.suspended).toBe(true);
    expect(ctx.state).toBe("suspended");
    backend.setSuspended(false);
    await flush();
    expect(ctx.state).toBe("running");
    expect(ctx.calls).toEqual(["resume", "suspend", "resume"]);
  });

  it("a gesture during the pause does not resume the sound", async () => {
    const { ctx, backend } = make();
    const target = new EventTarget();
    backend.unlockOnGesture(target);
    backend.setSuspended(true);
    ctx.allowed = true;
    target.dispatchEvent(new Event("pointerdown"));
    await flush();
    expect(ctx.state).toBe("suspended");
    backend.setSuspended(false);
    await flush();
    expect(ctx.state).toBe("running");
  });

  it("resume() refused before the first gesture is not an unhandled error; the gesture unlocks later", async () => {
    const { ctx, backend } = make();
    const target = new EventTarget();
    backend.unlockOnGesture(target);
    backend.setSuspended(true);
    backend.setSuspended(false); // refused: no gesture yet
    await flush();
    expect(ctx.state).toBe("suspended");
    target.dispatchEvent(new Event("keydown")); // still refused
    await flush();
    expect(ctx.state).toBe("suspended");
    ctx.allowed = true;
    target.dispatchEvent(new Event("keydown"));
    await flush();
    expect(ctx.state).toBe("running");
    const n = ctx.calls.length;
    target.dispatchEvent(new Event("keydown")); // listeners removed once running
    await flush();
    expect(ctx.calls.length).toBe(n);
  });
});

describe("WebAudioBackend music bus", () => {
  const gainsOf = (b: WebAudioBackend) =>
    (b.stereoFx as unknown as { gains: { gain: { value: number } }[] }).gains.map((g) => g.gain.value);
  const endSource = { rate: 22050, channels: 2, read: () => [] as Float32Array[] };
  const sound = { channels: [new Float32Array(4)], rate: 22050, loopStart: 0, loopLength: 0 };

  it("a music stream passes through the stereo options, an effect goes straight to the master", () => {
    const { ctx, backend } = make();
    // the voices' own nodes are the ones created after the constructor's graph (master, bus, 4 gains)
    const created: FakeNode[] = [];
    const orig = ctx.createGain.bind(ctx);
    ctx.createGain = () => {
      const g = orig();
      created.push(g);
      return g;
    };
    const master = backend.output as unknown as FakeNode;
    const split = (backend.stereoFx as unknown as { gains: FakeNode[] }).gains;
    backend.startStream(endSource, { gain: 1, pan: 0 }, () => {});
    const musicGain = created[0];
    expect(reaches(musicGain, master)).toBe(true);
    split.forEach((g) => expect(reaches(musicGain, g)).toBe(true)); // through the splitter and the 4 gains
    backend.start(sound, { gain: 1, pan: 0 }, () => {});
    const fxGain = created[1];
    // the effect's chain ends in master without crossing any of the stereo gains
    expect(fxGain.out[0].out).toContain(master);
    split.forEach((g) => expect(reaches(fxGain, g)).toBe(false));
    // the music's chain ends in the music bus, not in master
    expect(musicGain.out[0].out).not.toContain(master);
  });

  it("update(surround, reverse) sets the matrix of the bus; the master volume stays on the master", () => {
    const { backend } = make();
    expect(gainsOf(backend)).toEqual([1, 0, 0, 1]); // plain stereo
    backend.stereoFx.update(true, false);
    expect(gainsOf(backend)).toEqual([-1, 0, 0, 1]);
    backend.stereoFx.update(false, true);
    expect(gainsOf(backend)).toEqual([0, 1, 1, 0]);
    backend.stereoFx.update(true, true);
    expect(gainsOf(backend)).toEqual([0, 1, -1, 0]);
    backend.setMasterGain(0.25);
    expect((backend.output as unknown as { gain: { value: number } }).gain.value).toBe(0.25);
    expect(gainsOf(backend)).toEqual([0, 1, -1, 0]);
  });

  it("the pause still suspends the whole context (the bus lives in it)", async () => {
    const { ctx, backend } = make();
    backend.setSuspended(true);
    expect(ctx.state).toBe("suspended");
    expect(backend.suspended).toBe(true);
  });
});
