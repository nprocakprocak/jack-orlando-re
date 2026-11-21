// Synthetic assets for the GUI tests (no game files): solid-block glyphs and flat bitmaps.
import type { Font } from "../formats/fnt";
import type { CreditLine } from "../formats/text";
import type { Surface16 } from "../render/surface";
import { createSurface } from "../render/surface";
import type { MenuAssets } from "./menu";

/** Every glyph is a 5 x `height` block: outline frame (1) around fill (2). */
export function blockFont(height = 7): Font {
  const pixels = Uint8Array.from({ length: 5 * height }, (_, i) => {
    const x = i % 5;
    const y = Math.floor(i / 5);
    return x === 0 || x === 4 || y === 0 || y === height - 1 ? 1 : 2;
  });
  return {
    dataEnd: 0,
    glyphs: Array.from({ length: 256 }, (_, code) => ({
      code,
      offset: 0,
      width: 5,
      height,
      pixels,
    })),
  };
}

export function flat(w: number, h: number, color: number): Surface16 {
  const s = createSurface(w, h);
  s.pixels.fill(color);
  return s;
}

export const FAKE_CREDITS: CreditLine[] = [
  { kind: "=", style: "1", text: "TITLE" },
  { kind: "#", style: "2", text: "line one" },
  { kind: "#", style: "!", text: "pause here" },
  { kind: "=", style: "2", text: "BIG" },
];

export function fakeAssets(): MenuAssets {
  return {
    fontBig: blockFont(),
    fontSmall: blockFont(5),
    track: flat(230, 13, 0x2222),
    thumb: flat(14, 29, 0x5555),
    logo: flat(396, 98, 0x3333),
    copyright: flat(340, 27, 0x4444),
    credits: FAKE_CREDITS,
  };
}
