// Dialog tables.

export interface DialogTables {
  /** (value, count) per signed char: lip-sync table */
  lipPair(signedChar: number): [number, number];
  /** mouth frames of a line without a voice */
  mouthCycle: number[];
  /** eye frame per blink step (5 steps) */
  blinkOrder: number[];
  /** filled by: caption colour per face slot 0..16 (RGB565) */
  speakerColors: number[];
  /** three pairs of flag, colour; scenes overwrite them */
  textColors: number[];
  /** menu text colour (RGB565 yellow) */
  menuFill: number;
}

/** Lip pair for a signed character in -128..127. */
function lipPair(signedChar: number): [number, number] {
  const i = (signedChar + 128) * 2;
  return [LIP_PAIRS[i], LIP_PAIRS[i + 1]];
}

/** Lip-sync pairs for signed characters -128..127. Two bytes each: value, then count. */
export const LIP_PAIRS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 66, 0, 0, 0, 1, 80, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
  0, 244, 253, 84, 60, 66, 96, 101, 60, 145, 0, 0, 0, 158, 0, 0, 0, 185, 0, 0, 0, 54, 0, 70, 0, 90, 0, 111, 0, 74, 0,
  49, 0, 121, 0, 90, 0, 71, 0, 80, 0, 0, 0, 128, 0, 3, 0, 3, 0, 1, 3, 2, 4, 2, 4, 1, 3, 6, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0,
  1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
  0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
  1, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 2,
  0, 1, 0, 1, 0, 1, 4, 2, 0, 1, 1, 1, 2, 1, 4, 2, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 1, 0, 1, 1, 1, 4, 2, 0, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 3, 2, 0, 1, 0, 1, 1, 1, 2, 2, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 4, 2, 0, 1, 1, 1, 2, 1,
  4, 2, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 1, 0, 1, 1, 1, 4, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 2, 0, 1, 0, 1, 1,
  1, 2, 2, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
] as const;

/** Mouth frames of a line that has no voice. */
export const MOUTH_CYCLE = [0, 2, 4, 3, 1, 2, 4, 3, 1, 3] as const;

/** Eye frame for each blink step. */
export const BLINK_ORDER = [0, 1, 2, 1, 0] as const;

/** Caption colour for each face slot 0..16, RGB565. */
export const SPEAKER_COLORS = [
  65535, 65535, 44572, 64648, 40817, 64648, 44572, 40817, 64648, 44572, 40817, 64648, 44572, 40817, 64648, 44572, 40817,
] as const;

/** Three pairs of flag, colour. Scenes overwrite them. */
export const TEXT_COLORS = [1, 65504, 1, 63480, 1, 63480] as const;

/** Menu text colour, RGB565. */
export const MENU_FILL = 65504;

export const DIALOG_TABLES: DialogTables = {
  lipPair,
  mouthCycle: [...MOUTH_CYCLE],
  blinkOrder: [...BLINK_ORDER],
  speakerColors: [...SPEAKER_COLORS],
  textColors: [...TEXT_COLORS],
  menuFill: MENU_FILL,
};
