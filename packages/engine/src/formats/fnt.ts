// Bitmap fonts. The engine reads JACK.FNT and JACKM.FNT from Resource.pak.

export class FntError extends Error {}

const ENTRY_SIZE = 4;
export const GLYPHS = 256;
export const TABLE_SIZE = GLYPHS * ENTRY_SIZE;
export const OUTLINE = 1;
const ESCAPE = 0x2f;
export const DEFAULT_SPACING = 1;

export interface Glyph {
  code: number;
  offset: number;
  width: number;
  height: number;
  /** width*height values: 0 transparent, 1 outline color, 2 fill color; rows from the top */
  pixels: Uint8Array;
}

export interface Font {
  /** 256 glyphs; unused codes share the default glyph (a blank one) */
  glyphs: Glyph[];
  /** end of the highest-reaching glyph data = size of a complete font */
  dataEnd: number;
}

export function parseFnt(data: Uint8Array): Font {
  if (data.length < TABLE_SIZE) throw new FntError("too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const glyphs: Glyph[] = [];
  let dataEnd = TABLE_SIZE;
  for (let code = 0; code < GLYPHS; code++) {
    const offset = view.getUint16(code * ENTRY_SIZE, true);
    const width = data[code * ENTRY_SIZE + 2];
    const height = data[code * ENTRY_SIZE + 3];
    if (offset < TABLE_SIZE || offset + width * height > data.length) {
      throw new FntError(`glyph ${code} data ${offset}+${width}x${height} out of range`);
    }
    dataEnd = Math.max(dataEnd, offset + width * height);
    glyphs.push({ code, offset, width, height, pixels: data.slice(offset, offset + width * height) });
  }
  return { glyphs, dataEnd };
}

export function verifyFnt(data: Uint8Array): string[] {
  let font: Font;
  try {
    font = parseFnt(data);
  } catch (e) {
    if (e instanceof FntError) return [e.message];
    throw e;
  }
  const problems: string[] = [];
  if (font.dataEnd !== data.length) problems.push(`glyph data ends at ${font.dataEnd}, file has ${data.length} bytes`);
  const bad = new Set<number>();
  for (const g of font.glyphs) for (const v of g.pixels) if (v > 2) bad.add(v);
  if (bad.size) problems.push(`pixel values [${[...bad].sort((a, b) => a - b).join(", ")}] (only 0, 1, 2 are known)`);
  const wide = font.glyphs.filter((g) => g.width > 127).map((g) => g.code);
  if (wide.length) problems.push(`glyphs [${wide.join(", ")}] wider than 127 (the blitter uses width & 0x7f)`);
  return problems;
}

export interface PlacedGlyph {
  x: number;
  glyph: Glyph;
}

/**
 * Glyph positions and total width: advance = glyph width + spacing;
 * "/N" sets spacing N (default 1, any character works as a digit) and draws nothing.
 * `text` holds Mazovia bytes; a NUL ends it, and so does a trailing "/".
 */
export function layoutText(font: Font, text: Uint8Array): { glyphs: PlacedGlyph[]; width: number } {
  let spacing = DEFAULT_SPACING;
  let x = 0;
  const glyphs: PlacedGlyph[] = [];
  for (let i = 0; i < text.length && text[i] !== 0; ) {
    const c = text[i];
    if (c === ESCAPE) {
      if (i + 1 >= text.length || text[i + 1] === 0) break;
      spacing = (text[i + 1] - 0x30) & 0xff;
      i += 2;
      continue;
    }
    const glyph = font.glyphs[c];
    glyphs.push({ x, glyph });
    x += glyph.width + spacing;
    i++;
  }
  return { glyphs, width: x };
}

export function textWidth(font: Font, text: Uint8Array): number {
  return layoutText(font, text).width;
}

export interface TextImage {
  width: number;
  height: number;
  /** RGB565, 0 = transparent */
  pixels: Uint16Array;
}

/** Renders text with outline/fill colors (RGB565). Height = tallest drawn glyph. */
export function renderText(font: Font, text: Uint8Array, outline: number, fill: number): TextImage {
  const { glyphs, width } = layoutText(font, text);
  const height = glyphs.reduce((h, p) => Math.max(h, p.glyph.height), 0);
  const pixels = new Uint16Array(width * height);
  for (const { x, glyph } of glyphs) {
    glyph.pixels.forEach((v, i) => {
      if (v) pixels[Math.floor(i / glyph.width) * width + x + (i % glyph.width)] = v === OUTLINE ? outline : fill;
    });
  }
  return { width, height, pixels };
}
