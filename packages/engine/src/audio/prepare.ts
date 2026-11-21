// Sound (formats/sound.ts) -> PreparedSound.

import { Sound, SOUND_RATE } from "../formats/sound";
import type { PreparedSound } from "./types";

/**
 * Float samples and loop range of a sound. The exe plays every buffer as 16-bit mono 22050 Hz
 * (Snd_PlaySound: flags 0x1811, rate 0x5622); 8-bit and stereo data keep their layout
 * (stereo music is handled by) and are played at the same rate unless `rate` is given.
 */
export function prepareSound(sound: Sound, rate = SOUND_RATE): PreparedSound {
  const frameBytes = (sound.channels * sound.bits) / 8;
  const frames = sound.frames;
  const loopStart = Math.floor(sound.loopStart / frameBytes);
  let loopLength = Math.floor(sound.loopLength / frameBytes);
  // the exe trusts the header; a range beyond the data would make Web Audio misbehave
  if (loopStart >= frames) loopLength = 0;
  else if (loopStart + loopLength > frames) loopLength = frames - loopStart;
  return { channels: sound.channelData(), rate, loopStart, loopLength };
}

/** Duration in seconds of the data (not counting loops). */
export function soundDuration(p: PreparedSound): number {
  return p.channels.length ? p.channels[0].length / p.rate : 0;
}
