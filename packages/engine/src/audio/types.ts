// Audio core types. The mixer logic (mixer.ts) is independent of Web Audio; a backend
// (webaudio.ts, or a fake one in tests) turns PreparedSound into actual output.

/** Decoded, ready to play audio: float samples per channel, loop range in frames. */
export interface PreparedSound {
  /** one array per channel, equal length */
  channels: Float32Array[];
  /** sample rate of the data in Hz */
  rate: number;
  /** loop range in frames; loopLength 0 = play once (as loop_length in the buffer header) */
  loopStart: number;
  loopLength: number;
}

export interface VoiceParams {
  /** linear gain 0..1 */
  gain: number;
  /** stereo position -1 (left) 1 (right) */
  pan: number;
}

/** One playing sound inside a backend. */
export interface Voice {
  stop(): void;
  setGain(gain: number): void;
  setPan(pan: number): void;
}

/**
 * Audio produced on demand (music): the exe decodes ADPCM into a DirectSound ring buffer
 * while the sound plays (Snd_StreamPosTick) instead of holding the whole track.
 */
export interface StreamSource {
  /** sample rate of the produced frames in Hz */
  readonly rate: number;
  readonly channels: number;
  /** Next `frames` frames, one array per channel; fewer frames than asked (even 0) = end of stream. */
  read(frames: number): Float32Array[];
}

export interface AudioBackend {
  /**
 * Starts playing. `onEnded` is called once when playback runs out on its own; it must not
 * be called after `Voice.stop()`.
 */
  start(sound: PreparedSound, params: VoiceParams, onEnded: () => void): Voice;
  /** Like `start`, but pulls frames from `source` shortly before they are heard. */
  startStream(source: StreamSource, params: VoiceParams, onEnded: () => void): Voice;
  setMasterGain(gain: number): void;
  /** Freeze/continue all voices (Sound_SetPaused). */
  setSuspended(suspended: boolean): void;
}

/** Why a playback ended. */
export type EndReason = "finished" | "stopped" | "replaced";

export interface EndEvent {
  channel: number;
  /** id returned by Mixer.play */
  id: number;
  reason: EndReason;
}
