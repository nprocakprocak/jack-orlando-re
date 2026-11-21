// Mouth animation of a spoken line (without a voice, with one) and the
// pace of the face steps (case 0xa of Script_ExecStep).

import type { DialogTables } from "./tables";
import { encodeMazovia } from "./caption";

export interface Lip {
  /** mouth frame (0..4, used `% 5`) per step */
  frames: number[];
  /** number of steps; the line ends when the step counter reaches it */
  steps: number;
  /** the length the pace is derived from (seconds) */
  seconds: number;
}

/** TALK uses 0.014, the answer lines and TALKRANDOM 0.013. */
export const PACE_TALK = Math.fround(0.014);
export const PACE_ANSWER = Math.fround(0.013);

/**
 * no voice file. The mouth cycles through the 10 values, one step per
 * character; the length is `strlen / 10` s.
 */
export function lipWithoutVoice(text: string, t: DialogTables): Lip {
  const n = encodeMazovia(text).length;
  return {
    frames: Array.from({ length: n }, (_, i) => t.mouthCycle[i % t.mouthCycle.length]),
    steps: n,
    seconds: Math.fround(n / 10),
  };
}

/**
 * with a voice. Steps 0 and 1 are closed; every character then adds the pair
 * (value, count) of the table indexed by the SIGNED char (so Mazovia letters >= 0x80
 * read below the table); 10 closed steps are appended. `seconds` = length of the sound.
 */
export function lipWithVoice(text: string, voiceSeconds: number, t: DialogTables): Lip {
  const frames = [0, 0];
  for (const b of encodeMazovia(text)) {
    const [value, count] = t.lipPair((b << 24) >> 24);
    for (let i = 0; i < count; i++) frames.push(value);
  }
  for (let i = 0; i < 10; i++) frames.push(0);
  return { frames, steps: frames.length, seconds: Math.fround(voiceSeconds) };
}

/** = seconds / (steps * pace), single precision like the game's floats. */
export const stepInterval = (lip: Lip, pace: number) =>
  Math.fround(lip.seconds / Math.fround(Math.fround(lip.steps) * pace));
