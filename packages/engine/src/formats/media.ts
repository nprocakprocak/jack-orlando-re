// Video: movies Movies\*.AVX and animations *.FLX (MENU.PAK:D1.FLX, Action\*.PHK).
// FLX is the game's own format (not Autodesk FLIC): a 0x14-byte header and chunks
// [type u8, pad u8, size u32] with 8-bit delta frames, an RGB565 palette and dirty
// rectangles. AVX is a container: 4-byte header, 2.5 s of IMA ADPCM stereo sound,
// then blocks of records; each record = one FLX frame + the sound for that frame.
// Frames are decoded one at a time (generators), so a player never holds a whole movie.

import { viewOf } from "./bytes";
import { IMA_INDEX, IMA_STEP } from "./sound";

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

export const AVX_HEADER_SIZE = 4;
export const CODEC_SIZE = 0x18;
/** case 1: codec header + 0x1aea8 bytes of IMA (2.5 s). */
export const AVX_PREROLL = 0x1aec0;
/** The ring write position starts at 0x6baa8, 8 bytes after the decoded preroll. */
export const AVX_GAP = 8;
export const AVX_RATE = 44100;
/** = operator_new: index buffer of the movie player. */
export const AVX_INDEX_BUFFER = 0x12c000;
export const TICK_MS = 5;
const TYPE_IMA_STEREO = 0x33;

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
  if (size < CHUNK_HEAD_SIZE || pos + size > end) throw new MediaError(`chunk type ${type} at ${pos}: bad size ${size}`);
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
    if (base + DELTA_HEAD_SIZE > src.length) throw new MediaError(`delta head truncated at ${base}`);
    const v = viewOf(src);
    const size = v.getUint32(base, true);
    let pos = v.getUint32(base + 4, true);
    const limit = this.capacity;
    if (pos > limit) throw new MediaError(`delta start ${pos} outside the buffer (${limit})`);
    const { indices, pixels, palette } = this;
    const at = (i: number) => (i < src.length ? src[i] : 0);
    let p = base + DELTA_HEAD_SIZE;
    const end = base + size;
    while (p < end) {
      pos += at(p);
      const n = at(p + 1);
      p += 2;
      if (!n) continue;
      if (p >= end) break; // a count with no bytes left: the game stops here
      if (p + n > end) this.overruns++;
      if (pos + n > limit) throw new MediaError(`delta writes pixel ${pos + n - 1} outside the buffer (${limit})`);
      for (let k = 0; k < n; k++) {
        const c = at(p + k);
        indices[pos + k] = c;
        pixels[pos + k] = palette[c];
      }
      pos += n;
      p += n;
    }
    return p - base;
  }
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
        frame.rect = [v.getInt16(body, true), v.getInt16(body + 2, true), v.getInt16(body + 4, true), v.getInt16(body + 6, true)];
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
        if (next !== pos + size) throw new MediaError(`packed chunk at ${pos}: ${pos + size - next} bytes left after unpacking`);
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

// --- sound -------------------------------------------------------------------

export interface Codec {
  type: number;
  packedSize: number;
  unpackedSize: number;
  loopOffset: number;
  predictor: number;
  index: number;
  predictorR: number;
}

export function parseCodec(data: Uint8Array, pos: number): Codec {
  const v = viewOf(data);
  return {
    type: v.getUint32(pos, true),
    packedSize: v.getUint32(pos + 4, true),
    unpackedSize: v.getUint32(pos + 8, true),
    loopOffset: v.getUint32(pos + 12, true),
    predictor: v.getInt16(pos + 16, true),
    index: data[pos + 18],
    predictorR: v.getInt16(pos + 20, true),
  };
}

/**
 * Ima_DecodeStereo keeping its state between calls: per 8 source bytes
 * one 32-bit word for the left and one for the right channel, low nibble first.
 * Counts source bytes like the game: at 0 a call loads the start state from the
 * codec header, at loopOffset the state is saved, at packedSize the saved state
 * (zeros if never saved) comes back and the counter jumps to loopOffset.
 */
export class ImaStereoStream {
  pos = 0;
  /** left pred, left index, right pred, right index */
  state = [0, 0, 0, 0];
  saved = [0, 0, 0, 0];
  resets = 0;

  constructor(readonly codec: Codec) {}

  decode(src: Uint8Array): Int16Array {
    if (src.length % 8) throw new MediaError(`IMA stereo data of ${src.length} bytes is not a multiple of 8`);
    const c = this.codec;
    if (this.pos === 0) this.state = [c.predictor, c.index, c.predictorR, c.index];
    const st = this.state;
    let pos = this.pos;
    const out = new Int16Array(src.length * 2);
    let o = 0;
    for (let w = 0; w < src.length; w += 8) {
      if (pos === c.loopOffset) this.saved = st.slice();
      for (let i = 0; i < 8; i++) {
        for (let ch = 0; ch < 2; ch++) {
          const byte = src[w + 4 * ch + (i >> 1)];
          const code = (byte >> (4 * (i & 1))) & 15;
          let pred = st[2 * ch];
          let index = st[2 * ch + 1];
          const step = IMA_STEP[index];
          let diff = step >> 3;
          if (code & 4) diff += step;
          if (code & 2) diff += step >> 1;
          if (code & 1) diff += step >> 2;
          if (code & 8) diff = -diff;
          pred = Math.max(-32768, Math.min(32767, pred + diff));
          index = Math.max(0, Math.min(88, index + IMA_INDEX[code]));
          st[2 * ch] = pred;
          st[2 * ch + 1] = index;
          out[o++] = pred;
        }
      }
      pos = (pos + 8) >>> 0;
      if (pos === c.packedSize) {
        for (let k = 0; k < 4; k++) st[k] = this.saved[k];
        pos = c.loopOffset;
        this.resets++;
      }
    }
    this.pos = pos;
    return out;
  }
}

// --- AVX -----------------------------------------------------------------------

export interface AvxRecord {
  block: number;
  /** offset of the record's length field */
  offset: number;
  /** first chunk (or FLX header) of the frame */
  video: number;
  /** offset of the sound chunk's size field, -1 until the frame is decoded */
  audio: number;
  end: number;
}

export interface AvxFrame {
  /** frame number in the whole movie */
  number: number;
  segment: number;
  /** frame index inside the segment */
  index: number;
  header: FlxHeader;
  frame: Frame;
  fb: FrameBuffer;
  record: AvxRecord;
}

/** A movie Movies\*.AVX: record index up front (cheap), frames and sound on demand. */
export class Avx {
  readonly segments: number;
  readonly unk2: number;
  readonly bits: number;
  readonly codec: Codec;
  readonly records: AvxRecord[] = [];
  readonly blocks: [number, number][] = [];

  constructor(readonly data: Uint8Array) {
    const d = data;
    if (d.length < AVX_HEADER_SIZE + AVX_PREROLL) throw new MediaError("AVX shorter than header and sound preroll");
    const v = viewOf(d);
    this.segments = v.getUint16(0, true);
    this.unk2 = d[2];
    this.bits = d[3];
    if (this.bits !== 16) throw new MediaError(`AVX bits ${this.bits}, the game plays only 16`);
    this.codec = parseCodec(d, AVX_HEADER_SIZE);
    if (this.codec.type !== TYPE_IMA_STEREO) {
      throw new MediaError(`AVX sound codec ${this.codec.type}, expected IMA stereo 0x33`);
    }
    let pos = AVX_HEADER_SIZE + AVX_PREROLL;
    while (pos < d.length) {
      if (pos + 4 > d.length) throw new MediaError(`block size truncated at ${pos}`);
      const size = v.getUint32(pos, true);
      if (size < 4 || pos + size > d.length) throw new MediaError(`block at ${pos}: bad size ${size}`);
      this.blocks.push([pos, size]);
      const end = pos + size;
      let r = pos + 4;
      while (r < end) {
        if (r + 4 > end) throw new MediaError(`record length truncated at ${r}`);
        const rend = r + 4 + v.getUint32(r, true);
        if (rend > end) throw new MediaError(`record at ${r} runs past its block`);
        this.records.push({ block: this.blocks.length - 1, offset: r, video: r + 4, audio: -1, end: rend });
        r = rend;
      }
      pos = end;
    }
  }

  get preroll(): Uint8Array {
    return this.data.subarray(AVX_HEADER_SIZE + CODEC_SIZE, AVX_HEADER_SIZE + AVX_PREROLL);
  }

  /** Frames in playback order (->); sets record.audio. */
  *frames(fb?: FrameBuffer): Generator<AvxFrame> {
    const d = this.data;
    const buf = fb ?? new FrameBuffer(1, 1, true, AVX_INDEX_BUFFER);
    let seg = -1;
    let header: FlxHeader | undefined;
    let left = 0;
    let number = 0;
    for (const rec of this.records) {
      let pos = rec.video;
      if (left === 0) {
        if (seg + 1 === this.segments) throw new MediaError(`record at ${rec.offset} after the last segment`);
        header = parseFlxHeader(d, pos);
        if (!header.frames) throw new MediaError(`segment ${seg + 1}: 0 frames`);
        seg++;
        left = header.frames;
        buf.resize(header.width, header.height);
        pos += FLX_HEADER_SIZE;
      } else if (d[pos] === 0x46 && d[pos + 1] === 0x4c && d[pos + 2] === 0x58 && d[pos + 3] === 0) {
        throw new MediaError(`FLX header inside segment ${seg} at ${pos}`);
      }
      const h = header as FlxHeader;
      const r = decodeFrame(buf, d, pos, rec.end, h.pal16, false);
      rec.audio = r.next;
      yield { number: number++, segment: seg, index: h.frames - left, header: h, frame: r.frame, fb: buf, record: rec };
      left--;
    }
    if (seg + 1 !== this.segments || left) {
      throw new MediaError(`movie ends in segment ${seg} with ${left} frames missing (${this.segments} segments in header)`);
    }
  }

  /** IMA bytes of a record's sound (record.audio is set by frames()). */
  audioChunk(rec: AvxRecord): Uint8Array {
    if (rec.audio < 0) throw new MediaError("record not decoded yet");
    if (rec.audio + 4 > rec.end) throw new MediaError(`record at ${rec.offset}: no sound chunk`);
    const size = viewOf(this.data).getUint32(rec.audio, true);
    if (size < 4 || rec.audio + size !== rec.end) {
      throw new MediaError(`record at ${rec.offset}: sound chunk size ${size} does not fill the record`);
    }
    return this.data.subarray(rec.audio + 4, rec.end);
  }

  /** Sound track: preroll, 2 silent sample frames, then each record (all or the first `records`). */
  pcm(records?: number): Int16Array {
    const ima = new ImaStereoStream(this.codec);
    const parts: Int16Array[] = [ima.decode(this.preroll), new Int16Array(AVX_GAP / 2)];
    if (records !== 0) {
      for (const f of this.frames()) {
        if (records !== undefined && f.number === records) break;
        parts.push(ima.decode(this.audioChunk(f.record)));
      }
    }
    const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

// --- checks (same rules as verify() in the external checker) -------------------------

/** Rect rules seen on all files; see rect_problems() in the external checker. */
export function rectProblems(h: FlxHeader, i: number, rect: [number, number, number, number]): string[] {
  const [x, y, w, hh] = rect;
  if (w <= 0 || hh <= 0) return [];
  const ok =
    h.mode === 2
      ? w <= h.width && hh <= h.height
      : x >= 0 && y >= 0 && x + w <= h.width + 1 && y + hh <= h.height;
  return ok ? [] : [`frame ${i}: rect ${rect.join(",")} does not fit ${h.width}x${h.height} (mode ${h.mode})`];
}

export function isAvx(name: string): boolean {
  return name.toUpperCase().endsWith(".AVX");
}

export function verifyMedia(name: string, data: Uint8Array): string[] {
  const problems: string[] = [];
  try {
    if (isAvx(name)) {
      const avx = new Avx(data);
      for (const f of avx.frames()) {
        if (avx.audioChunk(f.record).length % 8) problems.push(`record at ${f.record.offset}: sound not a multiple of 8 bytes`);
      }
      return problems;
    }
    const flx = new Flx(data);
    const h = flx.header;
    if (h.pal16 !== 1) problems.push(`palette flag ${h.pal16}`);
    for (const { index, frame } of flx.frames()) {
      if (index === 0 && !frame.palette) problems.push("first frame has no palette");
      if (index && frame.palette) problems.push(`palette in frame ${index}`);
      if (frame.rect) problems.push(...rectProblems(h, index, frame.rect));
    }
  } catch (e) {
    if (!(e instanceof MediaError)) throw e;
    problems.push(e.message);
  }
  return problems;
}
