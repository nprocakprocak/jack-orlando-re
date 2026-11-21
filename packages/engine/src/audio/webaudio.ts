// Web Audio backend. Browser only; the logic lives in mixer.ts.

import { StereoOptions } from "../settings/stereo";
import type { AudioBackend, PreparedSound, StreamSource, Voice, VoiceParams } from "./types";

interface StreamPump {
  ctx: AudioContext;
  source: StreamSource;
  chunkFrames: number;
  gain: GainNode;
  live: Set<AudioBufferSourceNode>;
  at: number;
  stopped: boolean;
  done: boolean;
  timer: ReturnType<typeof setInterval>;
  finish(): void;
}

function pumpStream(p: StreamPump): void {
  if (p.stopped || p.done) return;
  p.at = Math.max(p.at, p.ctx.currentTime);
  while (p.at - p.ctx.currentTime < STREAM_AHEAD) {
    const data = p.source.read(p.chunkFrames);
    const frames = data.length ? data[0].length : 0;
    if (frames) {
      const buf = p.ctx.createBuffer(p.source.channels, frames, p.source.rate);
      data.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      const node = p.ctx.createBufferSource();
      node.buffer = buf;
      node.connect(p.gain);
      node.start(p.at);
      p.live.add(node);
      node.onended = () => {
        p.live.delete(node);
        node.disconnect();
        if (p.done && !p.live.size) p.finish();
      };
      p.at += frames / p.source.rate;
    }
    if (frames < p.chunkFrames) {
      p.done = true;
      clearInterval(p.timer);
      if (!p.live.size) p.finish();
      return;
    }
  }
}

/** Seconds kept scheduled ahead / granularity of a refill / poll period (the exe: 4 s ring, 0.5 s, 50 ms). */
const STREAM_AHEAD = 4;
const STREAM_CHUNK = 0.5;
const STREAM_POLL_MS = 50;

export class WebAudioBackend implements AudioBackend {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  /** the music's own bus: streams -> musicBus -> StereoOptions -> master (the effects go straight to master) */
  private readonly musicBus: GainNode;
  /**
   * "Pseudo surround" / "Swap stereo channels" (Snd_CopyStereo): only the music, the one stream the
   * mixer plays (`startStream`); the effects are mono and the exe does not touch them. `update(surround, reverse)`.
   */
  readonly stereoFx: StereoOptions;
  private paused = false;

  constructor(ctx: AudioContext = new AudioContext({ latencyHint: "interactive" })) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.stereoFx = new StereoOptions(ctx, this.musicBus, this.master);
  }

  /**
   * The master node every voice ends in (setMasterGain, setSuspended): a film's sound sink
   * (video/audio.ts `WebAudioMovieSink(ctx, backend.output)`) joins it to follow the master volume and the pause.
   */
  get output(): AudioNode {
    return this.master;
  }

  /**
   * Browsers keep a new AudioContext suspended until a user gesture. Call from a click/key
   * handler, or use unlockOnGesture(). Resolves when the context is running.
   */
  unlock(): Promise<void> {
    // a paused game (setSuspended(true)) stays silent: the gesture is remembered by the browser and
    // setSuspended(false) resumes the context later
    if (this.paused || this.ctx.state === "running") return Promise.resolve();
    return this.ctx.resume();
  }

  /** Resumes the context on the first pointer/key event on `target`. */
  unlockOnGesture(target: EventTarget = window): void {
    const events = ["pointerdown", "keydown", "touchend"];
    const handler = () => {
      void this.unlock().then(
        () => {
          if (this.ctx.state === "running") events.forEach((e) => target.removeEventListener(e, handler));
        },
        () => {},
      );
    };
    events.forEach((e) => target.addEventListener(e, handler));
  }

  start(sound: PreparedSound, params: VoiceParams, onEnded: () => void): Voice {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(sound.channels.length, sound.channels[0].length, sound.rate);
    sound.channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (sound.loopLength) {
      src.loop = true;
      src.loopStart = sound.loopStart / sound.rate;
      src.loopEnd = (sound.loopStart + sound.loopLength) / sound.rate;
    }
    const gain = ctx.createGain();
    gain.gain.value = params.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = params.pan;
    src.connect(gain).connect(pan).connect(this.master);
    let stopped = false;
    src.onended = () => {
      if (!stopped) onEnded();
      src.disconnect();
    };
    src.start();
    return {
      stop: () => {
        stopped = true;
        try {
          src.stop();
        } catch {
          // already stopped
        }
      },
      setGain: (g) => {
        gain.gain.value = g;
      },
      setPan: (p) => {
        pan.pan.value = p;
      },
    };
  }

  startStream(source: StreamSource, params: VoiceParams, onEnded: () => void): Voice {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = params.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = params.pan;
    gain.connect(pan).connect(this.musicBus);
    const chunkFrames = Math.round(STREAM_CHUNK * source.rate);
    const live = new Set<AudioBufferSourceNode>();
    const state: StreamPump = {
      ctx,
      source,
      chunkFrames,
      gain,
      live,
      at: ctx.currentTime,
      stopped: false,
      done: false,
      timer: 0 as unknown as ReturnType<typeof setInterval>,
      finish() {
        clearInterval(this.timer);
        if (!this.stopped) onEnded();
      },
    };
    state.timer = setInterval(() => pumpStream(state), STREAM_POLL_MS);
    pumpStream(state);
    return {
      stop: () => {
        state.stopped = true;
        clearInterval(state.timer);
        for (const n of state.live) {
          n.onended = null;
          try {
            n.stop();
          } catch {
            // already stopped
          }
          n.disconnect();
        }
        state.live.clear();
        gain.disconnect();
      },
      setGain: (g) => {
        gain.gain.value = g;
      },
      setPan: (p) => {
        pan.pan.value = p;
      },
    };
  }

  setMasterGain(gain: number): void {
    this.master.gain.value = gain;
  }

  /**
   * Sound_SetPaused / the pause: AudioContext.suspend() stops every voice, the streams and a film's sound
   * (its sink ends in `output`) at the same sample, and currentTime with them; resume() continues from there.
   * The streams' pump keeps polling but has nothing to do while currentTime stands.
   */
  setSuspended(suspended: boolean): void {
    this.paused = suspended;
    const p = suspended ? this.ctx.suspend() : this.ctx.resume();
    // resume() before the first gesture is refused or waits (autoplay policy); unlockOnGesture retries
    void p.catch(() => {});
  }

  /** setSuspended(true) is in effect. */
  get suspended(): boolean {
    return this.paused;
  }
}
