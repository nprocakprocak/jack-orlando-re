// Web Audio backend. Browser only; the logic lives in mixer.ts.

import { StereoOptions } from "../settings/stereo";
import type { AudioBackend, PreparedSound, StreamSource, Voice, VoiceParams } from "./types";

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
      void this.unlock().then(() => {
        if (this.ctx.state === "running") events.forEach((e) => target.removeEventListener(e, handler));
      }, () => {});
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
    let at = ctx.currentTime;
    let stopped = false;
    let done = false;
    const finish = () => {
      clearInterval(timer);
      if (!stopped) onEnded();
    };
    const pump = () => {
      if (stopped || done) return;
      at = Math.max(at, ctx.currentTime);
      while (at - ctx.currentTime < STREAM_AHEAD) {
        const data = source.read(chunkFrames);
        const frames = data.length ? data[0].length : 0;
        if (frames) {
          const buf = ctx.createBuffer(source.channels, frames, source.rate);
          data.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
          const node = ctx.createBufferSource();
          node.buffer = buf;
          node.connect(gain);
          node.start(at);
          live.add(node);
          node.onended = () => {
            live.delete(node);
            node.disconnect();
            if (done && !live.size) finish();
          };
          at += frames / source.rate;
        }
        if (frames < chunkFrames) {
          done = true;
          clearInterval(timer);
          if (!live.size) finish();
          return;
        }
      }
    };
    const timer = setInterval(pump, STREAM_POLL_MS);
    pump();
    return {
      stop: () => {
        stopped = true;
        clearInterval(timer);
        for (const n of live) {
          n.onended = null;
          try {
            n.stop();
          } catch {
            // already stopped
          }
          n.disconnect();
        }
        live.clear();
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
