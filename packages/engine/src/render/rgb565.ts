// RGB565 blend and mix, one copy for the lens, the film, object glass, notices and the menu.

/**
 * `(0xffff, 0, 1.5f)` as Film_Play calls it for the ring: per channel `ftol((a * (2 - t) + b * t) / 2)` with
 * a = the channel of white (31, 63, 31), b = 0 (black), t = 1.5 (the float code read from the instructions, the
 * constant 2.0): (7, 15, 7) = a dark grey, a quarter of white.
 */
export function mixColour(c1: number, c2: number, t: number): number {
  const ch = (a: number, b: number) => Math.trunc((a * (2 - t) + b * t) / 2);
  const r = ch((c1 >> 11) & 0x1f, (c2 >> 11) & 0x1f);
  const g = ch((c1 >> 5) & 0x3f, (c2 >> 5) & 0x3f);
  const b = ch(c1 & 0x1f, c2 & 0x1f);
  return ((r << 11) | (g << 5) | b) & 0xffff;
}

/** `round(v)` of the x87 (fistp): ties go to the even integer, as in the exe's blend tables (checked on all entries). */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
}

/**
 * The blend: dst + table[level][src - dst] per channel, where the table entry is `round(diff * level / 32)`
 * (red, green, blue, rows of 0x100 bytes per level 1..31).
 */
export function blend565(dst: number, src: number, level: number): number {
  const mix = (d: number, s: number) => d + roundHalfEven(((s - d) * level) / 32);
  const r = mix((dst >> 11) & 0x1f, (src >> 11) & 0x1f);
  const g = mix((dst >> 5) & 0x3f, (src >> 5) & 0x3f);
  const b = mix(dst & 0x1f, src & 0x1f);
  return ((r << 11) | (g << 5) | b) & 0xffff;
}
