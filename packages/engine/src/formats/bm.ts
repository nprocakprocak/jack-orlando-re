// .BM image reader (uncompressed: 16-bit RGB565 or 8-bit with palette).

export class BmError extends Error {}

export type ImageKind = "rgb565" | "pal8" | "pal8rle";

/** Decoded image: one RGB565 value per pixel, row-major. 0 is the transparent color key. */
export interface Image16 {
  width: number;
  height: number;
  kind: ImageKind;
  pixels: Uint16Array;
}

const HEADER_SIZE = 4;
/** 128 RGB565 colors; pixel bytes are byte offsets into it (always even). */
export const PALETTE_SIZE = 256;

export function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** Maps palette byte offsets to colors; throws on odd offsets (they would read half of two entries). */
export function applyPalette(data: Uint8Array, indices: Uint8Array, onOdd: (offset: number) => Error): Uint16Array {
  const view = viewOf(data);
  const out = new Uint16Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const b = indices[i];
    if (b & 1) throw onOdd(b);
    out[i] = view.getUint16(HEADER_SIZE + b, true);
  }
  return out;
}

export function decodeBm(data: Uint8Array): Image16 {
  if (data.length < HEADER_SIZE) throw new BmError("too short");
  const view = viewOf(data);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const n = width * height;
  if (data.length === HEADER_SIZE + 2 * n) {
    const pixels = new Uint16Array(n);
    for (let i = 0; i < n; i++) pixels[i] = view.getUint16(HEADER_SIZE + 2 * i, true);
    return { width, height, kind: "rgb565", pixels };
  }
  if (data.length === HEADER_SIZE + PALETTE_SIZE + n) {
    const indices = data.subarray(HEADER_SIZE + PALETTE_SIZE);
    const pixels = applyPalette(data, indices, (b) => new BmError(`odd palette offset ${b}`));
    return { width, height, kind: "pal8", pixels };
  }
  throw new BmError(
    `size ${data.length} fits neither ${width}x${height} RGB565 (${HEADER_SIZE + 2 * n}) ` +
      `nor 8-bit (${HEADER_SIZE + PALETTE_SIZE + n})`,
  );
}

/** Problems found; empty means the file matches the documented format. */
export function verifyBm(data: Uint8Array): string[] {
  let img: Image16;
  try {
    img = decodeBm(data);
  } catch (e) {
    if (e instanceof BmError) return [e.message];
    throw e;
  }
  if (img.kind === "pal8" && viewOf(data).getUint16(HEADER_SIZE, true) !== 0) {
    return ["palette entry 0 is not 0 (transparent)"];
  }
  return [];
}

/**
 * RGBA bytes for a canvas ImageData. 5/6-bit channels are widened by bit replication;
 * color 0 becomes transparent like in the game's blitters.
 */
export function rgb565ToRgba(pixels: Uint16Array, transparentZero = true): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const r = p >> 11;
    const g = (p >> 5) & 0x3f;
    const b = p & 0x1f;
    out[4 * i] = (r << 3) | (r >> 2);
    out[4 * i + 1] = (g << 2) | (g >> 4);
    out[4 * i + 2] = (b << 3) | (b >> 2);
    out[4 * i + 3] = p === 0 && transparentZero ? 0 : 255;
  }
  return out;
}
