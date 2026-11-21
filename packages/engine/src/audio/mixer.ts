// Channel mixer modelled on the original DirectSound code (Sound_Init, Snd_PlayBuffer).
// src/audio/README.md. No DOM / Web Audio here - see AudioBackend.

import type { AudioBackend, EndEvent, EndReason, PreparedSound, StreamSource, Voice, VoiceParams } from "./types";

/** The exe keeps 7 channel structs (index 0..6); Snd_PlayBuffer accepts only 1..6. */
export const CHANNEL_COUNT = 7;
export const FIRST_CHANNEL = 1;
export const LAST_CHANNEL = 6;
/** Channel 5 carries music (Game_Tick14ms fades it, MUSICVOLUME). */
export const MUSIC_CHANNEL = 5;
/** Volume range of the DirectSound wrapper: values above 0x7f are clamped. */
export const MAX_VOLUME = 0x7f;

/**
 * Snd_PlaySound/Sound_SetChannelVolume take a 16-bit "game" volume and double it
 * (`volume << 1`) before the wrapper clamps to 0..0x7f; 0 means silence (-10000 mB).
 */
export function gameVolumeToLevel(gameVolume: number): number {
  return Math.max(0, Math.min(MAX_VOLUME, Math.trunc(gameVolume) * 2));
}

/** DirectSound attenuation in 1/100 dB for a level (Snd_SetVolume); -10000 = silence. */
export const MIN_ATTENUATION = -10000;

/**
 * Snd_SetVolume: level clamped to 0x7f; level < 1 -> -10000; otherwise
 * `__ftol(1600.0 * ln(level * 0.007874))` (fild, fmul m64 = 0.007874 - not exactly 1/127,
 * = ln via fldln2/fyl2x, fmul m64 = 1600.0, truncation toward zero).
 * Result in 1/100 dB for IDirectSoundBuffer::SetVolume; DirectSound floors it at -10000.
 */
export function levelToAttenuation(level: number): number {
  const l = Math.min(MAX_VOLUME, Math.trunc(level));
  if (!(l >= 1)) return MIN_ATTENUATION;
  return Math.max(MIN_ATTENUATION, Math.trunc(1600.0 * Math.log(l * 0.007874)) + 0); // + 0: no -0 at level 127
}

/**
 * Level 0..127 -> linear gain: `10^(attenuation / 2000)` (1/100 dB). Same curve for effects, voices,
 * music (channel 5) and film sound - they all end in Snd_SetVolume. Silence (level 0, or below
 * -100 dB, i.e. never for levels >= 1) gives 0.
 */
export function levelToGain(level: number): number {
  const mB = levelToAttenuation(level);
  return mB <= MIN_ATTENUATION ? 0 : Math.pow(10, mB / 2000);
}

/**
 * Stereo position per channel (Snd_PlaySound passes pan 0 for channels 1 and 3, 0xff for 2 and
 * 4, an uninitialised value for 5 and 6). Channels 1 (TALK LEFT) and 2 (TALK RIGHT) are confirmed by
 * scripts + observation; 3/4 follow the same pan values (hypothesis); 5 and 6 are centred.
 */
export function defaultPan(channel: number): number {
  if (channel === 1 || channel === 3) return -1;
  if (channel === 2 || channel === 4) return 1;
  return 0;
}

export interface PlayOptions {
  /** level 0..127 (see gameVolumeToLevel); default 127 */
  volume?: number;
  /** -1..1; default defaultPan(channel) */
  pan?: number;
  /** ignore the loop range of the sound (play once) */
  noLoop?: boolean;
}

export interface Playback {
  readonly channel: number;
  readonly id: number;
  /** resolves when this playback ends for any reason */
  readonly ended: Promise<EndReason>;
}

interface Slot {
  id: number;
  voice: Voice;
  level: number;
  resolve: (r: EndReason) => void;
}

export class Mixer {
  private readonly slots: (Slot | undefined)[] = new Array(CHANNEL_COUNT);
  private readonly listeners = new Set<(e: EndEvent) => void>();
  private nextId = 1;
  private master = 1;
  private suspended = false;

  constructor(private readonly backend: AudioBackend) {}

  /**
   * Plays on a channel 1..6. A busy channel is cut off first: Snd_PlayBuffer calls
   * (stop + release the DirectSound buffer) when the channel already has one.
   * Returns null where the exe returns an error (bad channel, empty sound).
   */
  play(channel: number, sound: PreparedSound, opts: PlayOptions = {}): Playback | null {
    if (!Number.isInteger(channel) || channel < FIRST_CHANNEL || channel > LAST_CHANNEL) return null;
    if (!sound.channels.length || sound.channels[0].length === 0) return null;
    const prepared = opts.noLoop && sound.loopLength ? { ...sound, loopLength: 0 } : sound;
    return this.install(channel, opts, (params, onEnded) => this.backend.start(prepared, params, onEnded));
  }

  /**
   * Like `play`, for a stream produced on demand (music). Same channel rules: a busy
   * channel is cut off, `null` for a bad channel.
   */
  playStream(channel: number, source: StreamSource, opts: PlayOptions = {}): Playback | null {
    if (!Number.isInteger(channel) || channel < FIRST_CHANNEL || channel > LAST_CHANNEL) return null;
    return this.install(channel, opts, (params, onEnded) => this.backend.startStream(source, params, onEnded));
  }

  private install(
    channel: number,
    opts: PlayOptions,
    start: (params: VoiceParams, onEnded: () => void) => Voice,
  ): Playback {
    this.release(channel, "replaced");
    const level = Math.max(0, Math.min(MAX_VOLUME, opts.volume ?? MAX_VOLUME));
    const id = this.nextId++;
    let resolve!: (r: EndReason) => void;
    const ended = new Promise<EndReason>((r) => (resolve = r));
    const voice = start({ gain: levelToGain(level), pan: opts.pan ?? defaultPan(channel) }, () => {
      if (this.slots[channel]?.id === id) this.release(channel, "finished");
    });
    this.slots[channel] = { id, voice, level, resolve };
    return { channel, id, ended };
  }

  stop(channel: number): void {
    this.release(channel, "stopped");
  }

  stopAll(): void {
    for (let ch = 0; ch < CHANNEL_COUNT; ch++) this.release(ch, "stopped");
  }

  isPlaying(channel: number): boolean {
    return this.slots[channel] !== undefined;
  }

  /** Current level of a playing channel, undefined if idle. */
  level(channel: number): number | undefined {
    return this.slots[channel]?.level;
  }

  /** Sound_SetChannelVolume: no effect on an idle channel (the buffer pointer is null). */
  setChannelVolume(channel: number, level: number): void {
    const s = this.slots[channel];
    if (!s) return;
    s.level = Math.max(0, Math.min(MAX_VOLUME, level));
    s.voice.setGain(levelToGain(s.level));
  }

  setPan(channel: number, pan: number): void {
    this.slots[channel]?.voice.setPan(pan);
  }

  /** Global volume 0..1 (not in the exe; for a future options screen). */
  setMasterVolume(gain: number): void {
    this.master = Math.max(0, Math.min(1, gain));
    this.backend.setMasterGain(this.master);
  }

  get masterVolume(): number {
    return this.master;
  }

  /** Sound_SetPaused: true freezes all channels, false continues them. */
  setPaused(paused: boolean): void {
    this.suspended = paused;
    this.backend.setSuspended(paused);
  }

  get paused(): boolean {
    return this.suspended;
  }

  /** Subscribe to the end of any playback (WAITWHILEEFFECT). Returns an unsubscribe function. */
  onEnd(fn: (e: EndEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves when the channel is idle (immediately if it already is). */
  whenIdle(channel: number): Promise<void> {
    if (!this.slots[channel]) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.onEnd((e) => {
        if (e.channel === channel) {
          off();
          resolve();
        }
      });
    });
  }

  private release(channel: number, reason: EndReason): void {
    const s = this.slots[channel];
    if (!s) return;
    this.slots[channel] = undefined;
    if (reason !== "finished") s.voice.stop();
    s.resolve(reason);
    for (const fn of [...this.listeners]) fn({ channel, id: s.id, reason });
  }
}
