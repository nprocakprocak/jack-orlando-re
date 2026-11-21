import { viewOf } from "./bytes";
import { imaStep } from "./sound-codec";
import {
  FLX_HEADER_SIZE, Flx, FrameBuffer, MediaError, decodeFrame, parseFlxHeader,
  type FlxHeader, type Frame,
} from "./media-flx";

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
          const stepped = imaStep(st[2 * ch], st[2 * ch + 1], code);
          st[2 * ch] = stepped.pred;
          st[2 * ch + 1] = stepped.index;
          out[o++] = stepped.pred;
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
