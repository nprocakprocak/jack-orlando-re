// Music: streamed IMA ADPCM (.PMS) on mixer channel 5.
// Logic only (no DOM / Web Audio): the stream is a StreamSource for Mixer.playStream.

import { IMA_INDEX, IMA_STEP, Sound, SoundError, TYPE_IMA_STEREO } from "../formats/sound";
import { gameVolumeToLevel, MUSIC_CHANNEL, type Mixer } from "./mixer";
import type { StreamSource } from "./types";

/**
 * Music plays at 44100 Hz: / call (5, file, 0, 0, 0x1016,
 * 0xac44, vol) and passes that 0xac44 on to Snd_PlayBuffer as the sample rate
 * (it sets the WAVEFORMAT sample rate and the DirectSound frequency). Flags 0x1016 = 16 bit,
 * stereo, streamed from file (bit 4).
 */
export const MUSIC_RATE = 44100;
/** DirectSound ring buffer of a music channel: 0xac440 bytes = 4 s; refilled in 0x15800 B (~0.5 s) steps. */
export const MUSIC_BUFFER_BYTES = 0xac440;
export const MUSIC_CHUNK_BYTES = 0x15800;

export class MusicError extends Error {}

/** One IMA channel: the state saved at the loop point and restored at the end of the data. */
interface ImaState {
  pred: number;
  index: number;
}

/**
 * Incremental decoder of a `.PMS` file (codec type 0x33, Ima_DecodeStereo) with the loop
 * of the music stream (+ Snd_StreamPosTick):
 *
 * - data is consumed 8 bytes at a time (one 32-bit word per channel = 8 frames);
 * - when the source offset equals `loop_offset` the decoder saves both predictors and indices,
 * when it reaches `packed_size` it restores them and continues at `loop_offset`, so the loop
 * repeats the first pass bit for bit;
 * - `loop_offset == 0` therefore loops the **whole** track (unlike sound buffers, where
 * loop_length 0 means "no loop"); only `loop_offset == packed_size` (no loop range, the
 * stream's loop_length is 0) plays once. No game file does that.
 */
export class PmsStream implements StreamSource {
  readonly rate = MUSIC_RATE;
  readonly channels = 2;
  /** frames of the whole file / of the part that repeats */
  readonly totalFrames: number;
  readonly loopStartFrame: number;
  readonly loops: boolean;
  private readonly payload: Uint8Array;
  private readonly packed: number;
  private readonly loopOffset: number;
  private pos = 0;
  private readonly left: ImaState;
  private readonly right: ImaState;
  private saved: [ImaState, ImaState] | undefined;
  private readonly group = new Int16Array(16);
  private groupPos = 8;
  private finished = false;
  /** frames handed out so far (including loop passes) */
  framesRead = 0;

  constructor(bytes: Uint8Array) {
    let sound: Sound;
    try {
      sound = new Sound(bytes, "PMS");
    } catch (e) {
      throw new MusicError(`not a music file: ${e instanceof SoundError ? e.message : String(e)}`);
    }
    if (sound.type !== TYPE_IMA_STEREO) {
      throw new MusicError(`codec type 0x${(sound.type ?? 0).toString(16)} is not IMA stereo (0x33)`);
    }
    this.packed = sound.packedSize;
    this.loopOffset = sound.loopOffset;
    if (this.packed === 0 || this.packed % 8) {
      throw new MusicError(`packed size ${this.packed} is not a positive multiple of 8`);
    }
    if (sound.unpackedSize !== this.packed * 4) {
      throw new MusicError(`unpacked size ${sound.unpackedSize} is not 4 x packed size ${this.packed}`);
    }
    // the decoder compares the source offset with loop_offset every 8 bytes: an unaligned or
    // overlong value is never matched and the exe would restore a stale state
    if (this.loopOffset % 8 || this.loopOffset > this.packed) {
      throw new MusicError(`loop offset ${this.loopOffset} is not a multiple of 8 within the data`);
    }
    this.payload = bytes.subarray(sound.dataOffset, sound.dataOffset + this.packed);
    this.left = { pred: sound.predictor, index: sound.index };
    this.right = { pred: sound.predictorRight, index: sound.index };
    this.totalFrames = this.packed;
    this.loopStartFrame = this.loopOffset;
    this.loops = this.loopOffset < this.packed;
  }

  /** true once a non-looping stream has produced its last frame */
  get ended(): boolean {
    return this.finished && this.groupPos >= 8;
  }

  /** Next `frames` frames as float stereo; fewer only when a non-looping stream ends. */
  read(frames: number): Float32Array[] {
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    let n = 0;
    while (n < frames) {
      if (this.groupPos >= 8) {
        if (this.finished) break;
        this.decodeGroup();
      }
      l[n] = this.group[this.groupPos * 2] / 32768;
      r[n] = this.group[this.groupPos * 2 + 1] / 32768;
      this.groupPos++;
      n++;
    }
    this.framesRead += n;
    return n === frames ? [l, r] : [l.subarray(0, n), r.subarray(0, n)];
  }

  private decodeGroup(): void {
    const { payload, pos } = this;
    if (pos === this.loopOffset) this.saved = [{ ...this.left }, { ...this.right }];
    const wl = payload[pos] | (payload[pos + 1] << 8) | (payload[pos + 2] << 16) | (payload[pos + 3] << 24);
    const wr = payload[pos + 4] | (payload[pos + 5] << 8) | (payload[pos + 6] << 16) | (payload[pos + 7] << 24);
    for (let i = 0; i < 8; i++) {
      this.group[i * 2] = step(this.left, (wl >>> (4 * i)) & 15);
      this.group[i * 2 + 1] = step(this.right, (wr >>> (4 * i)) & 15);
    }
    this.groupPos = 0;
    this.pos += 8;
    if (this.pos === this.packed) {
      if (this.loops) {
        const [sl, sr] = this.saved!; // saved when pos was loopOffset < packed
        Object.assign(this.left, sl);
        Object.assign(this.right, sr);
        this.pos = this.loopOffset;
      } else {
        this.finished = true;
      }
    }
  }
}

function step(ch: ImaState, code: number): number {
  const s = IMA_STEP[ch.index];
  let diff = s >> 3;
  if (code & 4) diff += s;
  if (code & 2) diff += s >> 1;
  if (code & 1) diff += s >> 2;
  if (code & 8) diff = -diff;
  ch.pred = Math.max(-32768, Math.min(32767, ch.pred + diff));
  ch.index = Math.max(0, Math.min(88, ch.index + IMA_INDEX[code]));
  return ch.pred;
}

export interface MusicOptions {
  /**
 * Music enabled ("a sound device exists"); with it false every command only
 * remembers the track name, like Script_ExecStep case 0x3e with `g_config == 0`.
 */
  enabled?: boolean;
  /** `MusicVol` option in game units ; the channel level is `volume * 2` */
  musicVolume?: number;
  /** Script-set multiplier of the target volume (initial 1.0) */
  scale?: number;
  /** Finds the bytes of `MUSIC\<name>` for restarts after muting. */
  load?: (name: string) => Uint8Array | undefined;
}

type FadeState = "idle" | "out" | "outDone";

/**
 * The music state of the game on channel 5: current track name, the volume
 * variable with its fade step, and the fades of Game_Tick14ms
 *, which the host must call every 14 ms (`tick14ms`).
 */
export class MusicPlayer {
  enabled: boolean;
  musicVolume: number;
  scale: number;
  /** name of the current track (kept after `stop`) */
  trackName = "";
  /** current volume in game units (level = volume * 2) */
  volume = 0;
  /** change per tick of the running fade */
  fadeStep = 0;
  private fadeOutState: FadeState = "idle"; // 0, 1, 2
  private fadingIn = false; //
  /** The old track is fading out (== 1): a MUSIC command repeats until it is over. */
  get fadingOut(): boolean {
    return this.fadeOutState === "out";
  }
  private duckMode: "none" | "down" | "up" = "none"; // /
  private duckTarget = 0; //
  private muted = false; //
  private stream: PmsStream | null = null;
  private readonly load?: (name: string) => Uint8Array | undefined;

  constructor(
    private readonly mixer: Mixer,
    opts: MusicOptions = {},
  ) {
    this.enabled = opts.enabled ?? true;
    this.musicVolume = opts.musicVolume ?? 0x3f;
    this.scale = opts.scale ?? 1;
    this.load = opts.load;
  }

  get playing(): boolean {
    return this.mixer.isPlaying(MUSIC_CHANNEL);
  }

  /** The stream of the track being played (for position displays), null if idle. */
  get current(): PmsStream | null {
    return this.playing ? this.stream : null;
  }

  /**
 * Music_Start: the stream starts silent (`Snd_SetVolume(5, 0)`), but the volume variable is set to
 * `ftol(MusicVol *)` - the full target (bytes `66 a1 62 a9 9f 00 ... db 45 bc d8 0d d0 5d 8f 00 e8 66 a3 f4 8b 7a 00`;
 * the decompiler lost the `__ftol` argument;). So the fade-in of Game_Tick14ms finishes on its first tick
 * (`target <= volume + step`) and sets the full level: there is no audible fade-in, whatever `fadeInStep` (the step only
 * matters later, for the ducking). `fadeInStep` 0 is the same.
 */
  play(name: string, bytes: Uint8Array, fadeInStep = 0): void {
    this.trackName = name;
    const stream = new PmsStream(bytes);
    this.stream = stream;
    this.mixer.playStream(MUSIC_CHANNEL, stream, { volume: 0 });
    this.fadeStep = fadeInStep;
    this.volume = Math.trunc(this.musicVolume * this.scale);
    this.fadingIn = true;
  }

  /** stop the channel and silence it. The track name stays. */
  stop(): void {
    this.mixer.stop(MUSIC_CHANNEL);
    this.volume = 0;
  }

  /** Track of a loaded save, started by `startSaved` once the scene is loaded; null = nothing pending. */
  private savedTrack: string | null = null;

  /**
 * `Save_LoadState`, music part: a saved track name different from the current one stops the
 * music (`Music_Stop`); the same one plays on. The original starts the track later, in `Scene_SetNumberAndMapFlag`
 * (`Music_Start(name, fade-in 1)`), when the scene of the save is loaded - `startSaved`. The current name is switched here at
 * once (`Music_Start` copies it first), so a second load before the track started compares with the track about to play, not
 * with the stale old name (the old code left the name and a repeated load of that track stayed silent). Music off: nothing.
 */
  loadSaved(name: string): void {
    if (!this.enabled || name === this.trackName) return;
    this.stop();
    this.trackName = name;
    this.savedTrack = name;
  }

  /** The track `startSaved` will start, if any (the page reads the file before). */
  get pendingSavedTrack(): string | null {
    return this.savedTrack;
  }

  /**
 * `Scene_SetNumberAndMapFlag`, `g_gameLoaded` branch: starts the track of the save with fade-in step 1. `bytes` is the
 * file (undefined = missing: nothing plays, the name stays). The scene's MUSIC commands run after this and compare with the name.
 */
  startSaved(bytes: Uint8Array | undefined): void {
    const name = this.savedTrack;
    this.savedTrack = null;
    if (name === null || !this.enabled || name === "" || !bytes) return;
    this.play(name, bytes, 1);
  }

  /**
 * Script command 0x3e (Script_ExecStep case 0x3e): switch to track `name`.
 * Returns "retry" while the old track fades out (the script re-runs the command: the exe
 * decrements the script counter), "done" otherwise. The same name is a no-op and a track
 * change does nothing at all without music (`enabled`), except remembering the name.
 */
  command(name: string, fadeOutStep: number, fadeInStep: number, bytes: () => Uint8Array): "done" | "retry" {
    if (!this.enabled) {
      this.trackName = name;
      return "done";
    }
    if (name === this.trackName) return "done";
    if (fadeOutStep !== 0 && this.fadeOutState === "idle") {
      this.volume = Math.trunc(this.musicVolume * this.scale); // ftol(MusicVol * scale), bytes at
      this.fadeStep = fadeOutStep;
      this.fadeOutState = "out";
    }
    if (this.fadeOutState === "out") return "retry";
    this.play(name, bytes(), fadeInStep);
    if (this.fadeOutState === "outDone") this.fadeOutState = "idle";
    return "done";
  }

  /**
 * / (dialogue ducking, only with the option MusDownOnOff): fade the
 * volume down or back up to `target` by `step` per tick. The exe computes the target with
 * floating point code the decompiler lost, so the host passes it.
 */
  duck(direction: "down" | "up", step: number, target: number): void {
    this.duckMode = direction;
    this.fadeStep = step;
    this.duckTarget = target;
  }

  /**
 * Option "MusicVol" changed: below 5 the music stops and is remembered as
 * muted; above 5 again it restarts the current track (TR02-22.PMS for the placeholder name).
 */
  setMusicVolume(value: number): void {
    this.musicVolume = value;
    this.volume = value;
    if (value < 5 && !this.muted) {
      this.stop();
      this.muted = true;
      this.volume = 0;
    }
    if (value > 5 && this.muted && this.enabled) {
      const name = this.trackName;
      const bytes = this.load?.(name);
      if (bytes) this.play(name, bytes, 0);
      this.muted = false;
      this.volume = value;
    }
  }

  /** Game_Tick14ms, music branches. Call every 14 ms. */
  tick14ms(): void {
    if (!this.enabled) return;
    const set = (v: number) => this.mixer.setChannelVolume(MUSIC_CHANNEL, gameVolumeToLevel(v));
    const step = this.fadeStep;
    if (this.fadeOutState === "out") {
      if (step === 0 || this.volume - step < 1) {
        this.volume = 0;
        set(0);
        this.fadeOutState = "outDone";
      } else {
        this.volume -= step;
        set(this.volume);
      }
    } else if (this.fadingIn) {
      const target = this.musicVolume * this.scale;
      if (step === 0 || target <= this.volume + step) {
        // the exe leaves at its last value here; we keep it equal to the level
        this.volume = Math.trunc(target);
        set(this.volume);
        this.fadingIn = false;
      } else {
        this.volume += step;
        set(this.volume);
      }
    } else if (this.duckMode === "down" && this.volume > 5) {
      if (step === 0 || this.volume - step <= this.duckTarget) {
        set(this.duckTarget);
        this.duckMode = "none";
      } else {
        this.volume -= step;
        set(this.volume);
      }
    } else if (this.duckMode === "up" && this.volume > 5) {
      if (step === 0 || this.volume + step >= this.duckTarget) {
        set(this.duckTarget);
        this.duckMode = "none";
      } else {
        this.volume += step;
        set(this.volume);
      }
    }
  }
}
