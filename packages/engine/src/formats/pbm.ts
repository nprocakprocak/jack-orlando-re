// .PBM image reader (8-bit with palette, RLE-compressed).
import { viewOf } from "./bytes";
import { applyPalette, PALETTE_SIZE, type Image16 } from "./bm";

export class PbmError extends Error {}

const HEADER_SIZE = 4;
const DATA_START = HEADER_SIZE + PALETTE_SIZE; // 0x104

/**
 * Action\SC076.PHK and SC089.PHK: a 1-byte stand-in that .ACI animation lists use as an
 * empty frame. The game has no special case for it (see): it would
 * read the header from uninitialised memory. We decode it as an empty 0x0 image.
 */
export const PLACEHOLDER_NAME = "PUSTY.PBM";
const PLACEHOLDER_BYTE = 0x91;

export interface PbmStream {
  width: number;
  height: number;
  /** palette byte offsets, one per pixel */
  indices: Uint8Array;
  /** offset just past the last RLE byte the decoder needed */
  streamEnd: number;
}

/**
 * RLE stream -> palette offsets. Mirrors: an odd byte b starts a run of
 * (next byte) copies of b-1, an even byte is a single pixel.
 */
export function unpackPbm(data: Uint8Array): PbmStream {
  if (data.length < DATA_START) throw new PbmError("too short");
  const view = viewOf(data);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const n = width * height;
  // the game's loop would never terminate on an empty image
  if (n === 0) throw new PbmError(`empty image ${width}x${height}`);
  const indices = new Uint8Array(n);
  let out = 0;
  let pos = DATA_START;
  while (out < n) {
    if (pos >= data.length) throw new PbmError(`data truncated at pixel ${out} of ${n}`);
    const b = data[pos++];
    if (b & 1) {
      if (pos >= data.length) throw new PbmError(`data truncated in run at pixel ${out}`);
      const count = data[pos++];
      if (out + count > n) throw new PbmError(`run of ${count} at pixel ${out} overruns ${n} pixels`);
      indices.fill(b - 1, out, out + count);
      out += count;
    } else {
      indices[out++] = b;
    }
  }
  return { width, height, indices, streamEnd: pos };
}

/**
 * Pixels encoded by data[pos..] if it is a complete RLE stream ending exactly at the end
 * of the file, else null. Used for bytes the game never reads (after w*h pixels).
 */
export function tailPixels(data: Uint8Array, pos: number): number | null {
  let n = 0;
  while (pos < data.length) {
    const b = data[pos++];
    if (b & 1) {
      if (pos >= data.length) return null;
      n += data[pos++];
    } else n++;
  }
  return n;
}

/** name may be a bare file name or a path/label ending in it. */
export function isPlaceholder(data: Uint8Array, name = ""): boolean {
  const base = name
    .split(/[\\/:]/)
    .pop()!
    .toUpperCase();
  return base === PLACEHOLDER_NAME && data.length === 1 && data[0] === PLACEHOLDER_BYTE;
}

export function decodePbm(data: Uint8Array, name = ""): Image16 {
  if (isPlaceholder(data, name)) return { width: 0, height: 0, kind: "pal8rle", pixels: new Uint16Array(0) };
  const s = unpackPbm(data);
  // RLE output is always even, so applyPalette cannot fail here
  const pixels = applyPalette(data, s.indices, (b) => new PbmError(`odd palette offset ${b}`));
  return { width: s.width, height: s.height, kind: "pal8rle", pixels };
}

/** Problems found; empty means the file matches the documented format. */
export function verifyPbm(data: Uint8Array, name = ""): string[] {
  if (isPlaceholder(data, name)) return [];
  let s: PbmStream;
  try {
    s = unpackPbm(data);
  } catch (e) {
    if (e instanceof PbmError) return [e.message];
    throw e;
  }
  const problems: string[] = [];
  // stops after w*h pixels, so later bytes are never read; the 16 such files
  // (SC082 GZGR*, GNOB*) hold a well-formed continuation of the stream. Anything else
  // after the stream is reported.
  if (s.streamEnd !== data.length && tailPixels(data, s.streamEnd) === null) {
    problems.push(`${data.length - s.streamEnd} bytes after the RLE stream are not a valid RLE continuation`);
  }
  if (viewOf(data).getUint16(HEADER_SIZE, true) !== 0) problems.push("palette entry 0 is not 0 (transparent)");
  return problems;
}
