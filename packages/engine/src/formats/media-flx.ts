import { viewOf } from "./bytes";

export class MediaError extends Error {}

export const FLX_HEADER_SIZE = 0x14;
export const CHUNK_HEAD_SIZE = 6;
export const CHUNK_EMPTY = 0;
export const CHUNK_DELTA = 1;
export const CHUNK_PACKED = 2;
export const CHUNK_RECT = 3;
export const CHUNK_PALETTE = 4;
const DELTA_HEAD_SIZE = 8;
const RECT_SIZE = 8;
const RLE_MARK = 0xff;

export interface FlxHeader {
  frames: number;
  width: number;
  height: number;
  /** frame time = floor(200 / fps) ticks of 5 ms (movies); scenes use the ANIMA delay */
  fps: number;
  /** +0x0c: 1 in FLX, 0 in AVX */
  unkC: number;
  /** +0x0d: 2 = cropped frames placed by the rect chunk, 3 = fade variant */
  mode: number;
  /** +0x0e: 1 = palette is 256 x RGB565, 0 = 256 x RGB888 */
  pal16: number;
  unkF: number;
  /** +0x10/+0x12: position in the scene; the game does not read it */
  x: number;
  y: number;
}

export function frameTicks(h: FlxHeader): number {
  return h.fps ? Math.floor(200 / h.fps) : 0;
}

export function parseFlxHeader(data: Uint8Array, pos = 0): FlxHeader {
  if (pos + FLX_HEADER_SIZE > data.length) throw new MediaError(`FLX header truncated at ${pos}`);
  if (data[pos] !== 0x46 || data[pos + 1] !== 0x4c || data[pos + 2] !== 0x58 || data[pos + 3] !== 0) {
    throw new MediaError(`bad FLX magic at ${pos}`);
  }
  const v = viewOf(data);
  const h: FlxHeader = {
    frames: v.getUint16(pos + 4, true),
    width: v.getUint16(pos + 6, true),
    height: v.getUint16(pos + 8, true),
    fps: v.getUint16(pos + 10, true),
    unkC: data[pos + 12],
    mode: data[pos + 13],
    pal16: data[pos + 14],
    unkF: data[pos + 15],
    x: v.getUint16(pos + 16, true),
    y: v.getUint16(pos + 18, true),
  };
  if (!h.width || !h.height) throw new MediaError(`FLX frame size ${h.width}x${h.height}`);
  return h;
}

interface Chunk {
  type: number;
  size: number;
}

function readChunk(data: Uint8Array, pos: number, end: number): Chunk {
  if (pos + CHUNK_HEAD_SIZE > end) throw new MediaError(`chunk head truncated at ${pos}`);
  const type = data[pos];
  const size = viewOf(data).getUint32(pos + 2, true);
  if (size < CHUNK_HEAD_SIZE || pos + size > end)
    throw new MediaError(`chunk type ${type} at ${pos}: bad size ${size}`);
  return { type, size };
}

/**
 * copies the 8-byte delta head, then unpacks (size - 8) bytes:
 * 0xFF v n = n bytes of v, anything else is a literal. Writes into `out` (grown if
 * needed, never cleared) and returns it with the source position after the data.
 */
export function unpackRle(
  data: Uint8Array,
  pos: number,
  end: number,
  out: Uint8Array = new Uint8Array(0),
): { buf: Uint8Array; size: number; next: number } {
  if (pos + DELTA_HEAD_SIZE > end) throw new MediaError(`packed delta head truncated at ${pos}`);
  const size = viewOf(data).getUint32(pos, true);
  let left = size - DELTA_HEAD_SIZE;
  if (left <= 0) throw new MediaError(`packed delta at ${pos}: unpacked size ${size}`);
  if (out.length < size) {
    const grown = new Uint8Array(size);
    grown.set(out);
    out = grown;
  }
  out.set(data.subarray(pos, pos + DELTA_HEAD_SIZE), 0);
  let o = DELTA_HEAD_SIZE;
  let p = pos + DELTA_HEAD_SIZE;
  while (left > 0) {
    if (p >= end) throw new MediaError(`packed delta at ${pos}: data ends with ${left} bytes to unpack`);
    if (data[p] === RLE_MARK) {
      if (p + 3 > end) throw new MediaError(`packed delta at ${pos}: run truncated`);
      const n = data[p + 2];
      if (n > left) throw new MediaError(`packed delta at ${pos}: run of ${n} overflows by ${n - left}`);
      out.fill(data[p + 1], o, o + n);
      o += n;
      left -= n;
      p += 3;
    } else {
      out[o++] = data[p++];
      left--;
    }
  }
  return { buf: out, size, next: p };
}

/**
 * Decoder state shared by FLX and AVX: 8-bit index buffer (pixel offsets are
 * linear, stride = width), palette and 16-bit picture.
 *
 * rerender = false: scene/menu path — a delta writes palette[index]
 * of that moment, untouched pixels stay 0 (transparent). rerender = true: movie
 * path — a palette chunk redraws the whole frame.
 * capacity: pixels the game's buffer holds; writes past the frame up to there are
 * invisible, past it an error.
 */
export class FrameBuffer {
  width: number;
  height: number;
  readonly capacity: number;
  readonly indices: Uint8Array;
  readonly pixels: Uint16Array;
  palette = new Uint16Array(256);
  /** delta runs that read past their record (see) */
  overruns = 0;
  /** unpack buffer of chunk type 2, never cleared */
  unpacked: Uint8Array = new Uint8Array(0);

  constructor(
    width: number,
    height: number,
    readonly rerender = false,
    capacity = 0,
  ) {
    this.width = width;
    this.height = height;
    this.capacity = Math.max(capacity, width * height);
    this.indices = new Uint8Array(this.capacity);
    this.pixels = new Uint16Array(this.capacity);
  }

  resize(width: number, height: number): void {
    if (width * height > this.capacity) {
      throw new MediaError(`frame ${width}x${height} larger than the buffer (${this.capacity} pixels)`);
    }
    this.width = width;
    this.height = height;
  }

  /** Current picture (width x height) as RGB565. */
  frame(): Uint16Array {
    return this.pixels.subarray(0, this.width * this.height);
  }

  setPalette(data: Uint8Array, pos: number, pal16: number): void {
    const pal = this.palette;
    if (pal16) {
      const v = viewOf(data);
      for (let i = 0; i < 256; i++) pal[i] = v.getUint16(pos + 2 * i, true);
    } else {
      // R, G, B bytes -> RGB565
      for (let i = 0; i < 256; i++) {
        const q = pos + 3 * i;
        pal[i] = ((data[q] & 0xf8) << 8) | ((data[q + 1] & 0xfc) << 3) | (data[q + 2] >> 3);
      }
    }
    if (this.rerender) {
      const n = this.width * this.height;
      for (let i = 0; i < n; i++) this.pixels[i] = pal[this.indices[i]];
    }
  }

  /**
   * /: head (size, start pixel), then pairs: skip u8,
   * count u8, count index bytes, until the walk reaches base + size. A run may read
   * past that end like in the game; bytes past the end of src read as 0.
   * Returns the offset (from base) where the walk stopped.
   */
  applyDelta(src: Uint8Array, base = 0): number {
    const limit = this.capacity;
    const at = (i: number) => (i < src.length ? src[i] : 0);
    const { indices, pixels, palette } = this;
    return walkDelta(
      src,
      base,
      (start) => {
        if (start > limit) throw new MediaError(`delta start ${start} outside the buffer (${limit})`);
      },
      (pos, n, p, end) => {
        if (p + n > end) this.overruns++;
        if (pos + n > limit) throw new MediaError(`delta writes pixel ${pos + n - 1} outside the buffer (${limit})`);
        for (let k = 0; k < n; k++) {
          const c = at(p + k);
          indices[pos + k] = c;
          pixels[pos + k] = palette[c];
        }
      },
    );
  }
}

/**
 * Header walk of a delta: size and start pixel, then skip, count and the pointer advance.
 * `onStart` sees the start pixel before any pair. `visit` sees each non-empty run
 * (source offset `p` of its index bytes, record end `end`) before the pointer moves on.
 * A count with no bytes left stops the walk. Bytes past the end of `src` read as 0.
 * Returns the offset from `base` where the walk stopped.
 */
export function walkDelta(
  src: Uint8Array,
  base: number,
  onStart: (start: number) => void,
  visit: (pos: number, n: number, p: number, end: number) => void,
): number {
  if (base + DELTA_HEAD_SIZE > src.length) throw new MediaError(`delta head truncated at ${base}`);
  const v = viewOf(src);
  const size = v.getUint32(base, true);
  let pos = v.getUint32(base + 4, true);
  onStart(pos);
  const at = (i: number) => (i < src.length ? src[i] : 0);
  let p = base + DELTA_HEAD_SIZE;
  const end = base + size;
  while (p < end) {
    pos += at(p);
    const n = at(p + 1);
    p += 2;
    if (!n) continue;
    if (p >= end) break; // a count with no bytes left: the game stops here
    visit(pos, n, p, end);
    pos += n;
    p += n;
  }
  return p - base;
}

export interface Frame {
  /** image chunk type: 0 none, 1 delta, 2 packed delta */
  kind: number;
  /** x, y, w, h from chunk 3 (signed) */
  rect?: [number, number, number, number];
  palette: boolean;
}

/** One frame: [palette 4] [rect 3] image (0/1/2). */
export function decodeFrame(
  fb: FrameBuffer,
  data: Uint8Array,
  pos: number,
  end: number,
  pal16: number,
  allowRect = true,
): { frame: Frame; next: number } {
  const frame: Frame = { kind: -1, palette: false };
  const v = viewOf(data);
  for (;;) {
    const { type, size } = readChunk(data, pos, end);
    const body = pos + CHUNK_HEAD_SIZE;
    switch (type) {
      case CHUNK_PALETTE: {
        if (frame.palette || frame.rect) throw new MediaError(`palette chunk out of order at ${pos}`);
        const need = pal16 ? 512 : 768;
        if (size - CHUNK_HEAD_SIZE !== need) {
          throw new MediaError(`palette chunk at ${pos}: ${size - CHUNK_HEAD_SIZE} bytes, expected ${need}`);
        }
        fb.setPalette(data, body, pal16);
        frame.palette = true;
        break;
      }
      case CHUNK_RECT:
        if (!allowRect || frame.rect) throw new MediaError(`unexpected rect chunk at ${pos}`);
        if (size !== CHUNK_HEAD_SIZE + RECT_SIZE) throw new MediaError(`rect chunk at ${pos}: size ${size}`);
        frame.rect = [
          v.getInt16(body, true),
          v.getInt16(body + 2, true),
          v.getInt16(body + 4, true),
          v.getInt16(body + 6, true),
        ];
        break;
      case CHUNK_EMPTY:
        if (size !== CHUNK_HEAD_SIZE) throw new MediaError(`empty frame chunk at ${pos}: size ${size}`);
        break;
      case CHUNK_DELTA:
        // the delta record starts at +2, its size field is the chunk size: the
        // game's end pointer is 2 bytes past the chunk
        fb.applyDelta(data, pos + 2);
        break;
      case CHUNK_PACKED: {
        const { buf, next } = unpackRle(data, body, pos + size, fb.unpacked);
        fb.unpacked = buf;
        if (next !== pos + size)
          throw new MediaError(`packed chunk at ${pos}: ${pos + size - next} bytes left after unpacking`);
        fb.applyDelta(buf);
        break;
      }
      default:
        throw new MediaError(`unknown chunk type ${type} at ${pos}`);
    }
    pos += size;
    if (type <= CHUNK_PACKED) {
      frame.kind = type;
      return { frame, next: pos };
    }
  }
}

export interface FlxFrame {
  index: number;
  frame: Frame;
  fb: FrameBuffer;
}

/** A standalone .FLX animation (scenes, menu). */
export class Flx {
  readonly header: FlxHeader;

  constructor(readonly data: Uint8Array) {
    this.header = parseFlxHeader(data);
  }

  /** Yields after each frame; fb holds the picture. Decodes lazily. */
  *frames(fb?: FrameBuffer): Generator<FlxFrame> {
    const h = this.header;
    const buf = fb ?? new FrameBuffer(h.width, h.height);
    let pos = FLX_HEADER_SIZE;
    for (let i = 0; i < h.frames; i++) {
      const r = decodeFrame(buf, this.data, pos, this.data.length, h.pal16);
      pos = r.next;
      yield { index: i, frame: r.frame, fb: buf };
    }
    if (pos !== this.data.length) throw new MediaError(`${this.data.length - pos} bytes after frame ${h.frames}`);
  }
}
