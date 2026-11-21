// Sound reader.SND.S16.S22 and scene .PSD.
// A file is either a raw sound buffer (12-byte header + PCM) or a packed one: a 24-byte
// codec header (type 0x32..0x35), then - except for type 0x33 - the 12-byte buffer header,
// then IMA ADPCM or GSM 6.10 (WAV49) data.

/** always plays at 0x5622 Hz. */
export const SOUND_RATE = 22050;

export const TYPE_IMA_MONO = 0x32;
export const TYPE_IMA_STEREO = 0x33;
export const TYPE_GSM8 = 0x34;
export const TYPE_GSM16 = 0x35;

export type SoundKind = "raw8" | "raw16" | "ima" | "ima-stereo" | "gsm8" | "gsm16";

const KINDS: Record<SoundKind, [channels: number, bits: 8 | 16]> = {
  raw8: [1, 8],
  raw16: [1, 16],
  ima: [1, 16],
  "ima-stereo": [2, 16],
  gsm8: [1, 8],
  gsm16: [1, 16],
};
const TYPE_KIND: Record<number, SoundKind> = {
  [TYPE_IMA_MONO]: "ima",
  [TYPE_IMA_STEREO]: "ima-stereo",
  [TYPE_GSM8]: "gsm8",
  [TYPE_GSM16]: "gsm16",
};
/** What each extension holds in the Steam version (observed on all files). */
const EXT_KINDS: Record<string, SoundKind[]> = {
  SND: ["raw8", "gsm8"],
  S16: ["raw16"],
  S22: ["gsm16"],
  PSD: ["ima"],
};

const CODEC_HEADER_SIZE = 0x18;
const BUFFER_HEADER_SIZE = 12;
export const GSM_BLOCK = 65;

export class SoundError extends Error {}

// --- IMA ADPCM (IMAADPCM.c) ----------------------------------------------------

export const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
export const IMA_STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];

class ImaChannel {
  constructor(
    public pred: number,
    public index: number,
  ) {}

  next(code: number): number {
    const step = IMA_STEP[this.index];
    let diff = step >> 3;
    if (code & 4) diff += step;
    if (code & 2) diff += step >> 1;
    if (code & 1) diff += step >> 2;
    if (code & 8) diff = -diff;
    this.pred = Math.max(-32768, Math.min(32767, this.pred + diff));
    this.index = Math.max(0, Math.min(88, this.index + IMA_INDEX[code]));
    return this.pred;
  }
}

/**
 * One-shot decode like: 32-bit words, low nibble first; stereo alternates one
 * word per channel and both channels start from the same step index.
 */
export function decodeIma(
  src: Uint8Array,
  outBytes: number,
  pred: number,
  index: number,
  channels: 1 | 2 = 1,
  predRight = 0,
): Int16Array {
  if (outBytes % (16 * channels)) {
    throw new SoundError(`IMA output size ${outBytes} is not a multiple of ${16 * channels}`);
  }
  const need = outBytes / 4;
  if (need > src.length) throw new SoundError(`IMA data truncated: need ${need} bytes, have ${src.length}`);
  const out = new Int16Array(outBytes / 2);
  const l = new ImaChannel(pred, index);
  let o = 0;
  if (channels === 1) {
    for (let i = 0; i < need; i++) {
      out[o++] = l.next(src[i] & 15);
      out[o++] = l.next(src[i] >> 4);
    }
  } else {
    const r = new ImaChannel(predRight, index);
    for (let pos = 0; pos < need; pos += 8) {
      for (let i = 0; i < 8; i++) {
        const shift = 4 * (i & 1);
        out[o++] = l.next((src[pos + (i >> 1)] >> shift) & 15);
        out[o++] = r.next((src[pos + 4 + (i >> 1)] >> shift) & 15);
      }
    }
  }
  return out;
}

// --- GSM 6.10, WAV49 framing (GSM610.c, libgsm-derived) --------------------------

const sat = (x: number) => (x > 32767 ? 32767 : x < -32768 ? -32768 : x);
/** (a*b + 0x4000) >> 15, saturating like the exe (only -32768*-32768 overflows). */
const multR = (a: number, b: number) => {
  const p = a * b + 0x4000;
  return (p > 0x3fffffff ? 0x3fffffff : p) >> 15;
};

const GSM_B = [0, 0, 2048, -2560, 94, -1792, -341, -1144];
const GSM_MIC = [-32, -32, -16, -16, -8, -8, -4, -4];
const GSM_INVA = [13107, 13107, 13107, 13107, 19223, 17476, 31454, 29708];
const GSM_QLB = [3277, 11469, 21299, 32767];
const GSM_FAC = [18431, 20479, 22527, 24575, 26623, 28671, 30719, 32767];
const LAR_BITS = [6, 6, 5, 5, 4, 4, 3, 3];
const LAR_INTERVALS: [start: number, end: number][] = [
  [0, 13],
  [13, 27],
  [27, 40],
  [40, 160],
];

/** LSB-first reader over one 65-byte WAV49 block (two 260-bit frames). */
class BitReader {
  private pos = 0;
  constructor(
    private readonly src: Uint8Array,
    private readonly base: number,
  ) {}

  take(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) {
      v |= ((this.src[this.base + (this.pos >> 3)] >> (this.pos & 7)) & 1) << i;
    }
    return v;
  }
}

/** One GSM 6.10 decoder state (zeroes it and sets nrp = 40). */
class GsmDecoder {
  private readonly dp = new Int32Array(280); // dp[120..239] history, new samples at 240..279
  private nrp = 40;
  private larpp = new Int32Array(8);
  private readonly v = new Int32Array(9);
  private msr = 0;
  private readonly wt = new Int32Array(160);
  private readonly erp = new Int32Array(40);
  private readonly sr = new Int32Array(160);

  frame(bits: BitReader, out: Int16Array, o: number): void {
    const lar = LAR_BITS.map((n) => bits.take(n));
    const { dp, erp, wt } = this;
    for (let j = 0; j < 4; j++) {
      const nc = bits.take(7);
      const bc = bits.take(2);
      const mc = bits.take(2);
      const xmaxc = bits.take(6);
      // RPE decoding
      let exp = xmaxc > 15 ? (xmaxc >> 3) - 1 : 0;
      let mant = xmaxc - (exp << 3);
      if (mant === 0) {
        exp = -4;
        mant = 7;
      } else {
        while (mant <= 7) {
          mant = (mant << 1) | 1;
          exp--;
        }
        mant -= 8;
      }
      const fac = GSM_FAC[mant];
      const t2 = 6 - exp;
      const t3 = t2 > 0 ? 1 << (t2 - 1) : 0;
      erp.fill(0);
      for (let i = 0; i < 13; i++) {
        const x = bits.take(3);
        erp[mc + 3 * i] = sat(multR(fac, ((x << 1) - 7) << 12) + t3) >> t2;
      }
      // long-term synthesis
      const nr = nc < 40 || nc > 120 ? this.nrp : nc;
      this.nrp = nr;
      const brp = GSM_QLB[bc];
      for (let k = 0; k < 40; k++) dp[240 + k] = sat(erp[k] + multR(brp, dp[240 + k - nr]));
      wt.set(dp.subarray(240, 280), j * 40);
      dp.copyWithin(120, 160, 280);
    }
    // LAR decoding and interpolation
    const cur = new Int32Array(8);
    for (let i = 0; i < 8; i++) {
      const t = sat(sat(lar[i] + GSM_MIC[i]) << 10);
      cur[i] = sat(multR(GSM_INVA[i], sat(t - (GSM_B[i] << 1))) * 2);
    }
    const prev = this.larpp;
    const larp = new Int32Array(8);
    LAR_INTERVALS.forEach(([a, b], interp) => {
      for (let i = 0; i < 8; i++) {
        const p = prev[i];
        const c = cur[i];
        if (interp === 0) larp[i] = sat(sat((p >> 2) + (c >> 2)) + (p >> 1));
        else if (interp === 1) larp[i] = sat((p >> 1) + (c >> 1));
        else if (interp === 2) larp[i] = sat(sat((p >> 2) + (c >> 2)) + (c >> 1));
        else larp[i] = c;
      }
      this.synth(larToRp(larp), a, b);
    });
    this.larpp = cur;
    // postprocessing: deemphasis, upscaling, truncation
    let msr = this.msr;
    for (let k = 0; k < 160; k++) {
      msr = sat(this.sr[k] + multR(msr, 28180));
      out[o + k] = sat(msr + msr) & ~7;
    }
    this.msr = msr;
  }

  /** Short-term synthesis filter. */
  private synth(rrp: Int32Array, a: number, b: number): void {
    const v = this.v;
    for (let k = a; k < b; k++) {
      let sri = this.wt[k];
      for (let i = 7; i >= 0; i--) {
        sri = sat(sri - multR(rrp[i], v[i]));
        v[i + 1] = sat(v[i] + multR(rrp[i], sri));
      }
      v[0] = sri;
      this.sr[k] = sri;
    }
  }
}

/** */
function larToRp(larp: Int32Array): Int32Array {
  const rp = new Int32Array(8);
  for (let i = 0; i < 8; i++) {
    const x = larp[i];
    const t = x === -32768 ? 32767 : Math.abs(x);
    const r = t < 11059 ? t << 1 : t < 20070 ? t + 11059 : sat((t >> 2) + 26112);
    rp[i] = x < 0 ? -r : r;
  }
  return rp;
}

/** Decodes whole 65-byte blocks like (nothing if <= 0x40 bytes). */
export function decodeGsm(src: Uint8Array): Int16Array {
  const blocks = src.length > 0x40 ? Math.floor(src.length / GSM_BLOCK) : 0;
  const out = new Int16Array(blocks * 320);
  const dec = new GsmDecoder();
  for (let b = 0; b < blocks; b++) {
    const bits = new BitReader(src, b * GSM_BLOCK);
    dec.frame(bits, out, b * 320);
    dec.frame(bits, out, b * 320 + 160);
  }
  return out;
}

// --- container -------------------------------------------------------------------

export class Sound {
  readonly kind: SoundKind;
  readonly channels: number;
  readonly bits: 8 | 16;
  /** codec header fields; only for packed files */
  readonly type?: number;
  readonly packedSize: number = 0;
  readonly unpackedSize: number = 0;
  readonly loopOffset: number = 0;
  readonly predictor: number = 0;
  readonly index: number = 0;
  readonly predictorRight: number = 0;
  /** buffer header: playable bytes and loop range (loop_length 0 = no loop) */
  readonly size: number;
  readonly loopStart: number;
  readonly loopLength: number;
  readonly dataOffset: number;
  readonly trailing: number;
  private readonly payload: Uint8Array;
  private decoded?: Uint8Array | Int16Array;

  constructor(
    data: Uint8Array,
    readonly ext = "",
  ) {
    ext = ext.toUpperCase();
    this.ext = ext;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length < 4) throw new SoundError("too short");
    const tag = view.getUint32(0, true);
    let pos: number;
    if (tag in TYPE_KIND) {
      this.kind = TYPE_KIND[tag];
      if (data.length < CODEC_HEADER_SIZE) throw new SoundError("codec header truncated");
      this.type = tag;
      this.packedSize = view.getUint32(4, true);
      this.unpackedSize = view.getUint32(8, true);
      this.loopOffset = view.getUint32(12, true);
      this.predictor = view.getInt16(16, true);
      this.index = view.getUint8(18);
      this.predictorRight = view.getInt16(20, true);
      pos = CODEC_HEADER_SIZE;
      if (tag === TYPE_IMA_STEREO) {
        this.size = this.unpackedSize;
        this.loopStart = this.loopLength = 0;
      } else {
        if (data.length < pos + BUFFER_HEADER_SIZE) throw new SoundError("buffer header truncated");
        this.size = view.getUint32(pos, true);
        this.loopStart = view.getUint32(pos + 4, true);
        this.loopLength = view.getUint32(pos + 8, true);
        pos += BUFFER_HEADER_SIZE;
      }
      this.payload = data.subarray(pos, pos + this.packedSize);
      if (this.payload.length < this.packedSize) {
        throw new SoundError(`data truncated: ${this.payload.length} of ${this.packedSize} bytes`);
      }
      this.trailing = data.length - pos - this.packedSize;
    } else {
      // raw buffer: loaded as is and played by
      this.kind = ext === "SND" ? "raw8" : "raw16";
      if (data.length < BUFFER_HEADER_SIZE) throw new SoundError("buffer header truncated");
      this.size = view.getUint32(0, true);
      this.loopStart = view.getUint32(4, true);
      this.loopLength = view.getUint32(8, true);
      pos = BUFFER_HEADER_SIZE;
      this.payload = data.subarray(pos);
      if (this.size > this.payload.length) {
        throw new SoundError(`data truncated: ${this.payload.length} of ${this.size} bytes`);
      }
      this.trailing = this.payload.length - this.size;
    }
    this.dataOffset = pos;
    [this.channels, this.bits] = KINDS[this.kind];
  }

  /** Decoded buffer as the game builds it: unsigned bytes for 8-bit, Int16Array for 16-bit. */
  get pcm(): Uint8Array | Int16Array {
    if (!this.decoded) this.decoded = this.decode();
    return this.decoded;
  }

  private decode(): Uint8Array | Int16Array {
    const p = this.payload;
    switch (this.kind) {
      case "raw8":
        return p.slice(0, this.size);
      case "raw16": {
        const n = this.size >> 1;
        const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
        const out = new Int16Array(n);
        for (let i = 0; i < n; i++) out[i] = v.getInt16(2 * i, true);
        return out;
      }
      case "ima":
        return decodeIma(p, this.unpackedSize, this.predictor, this.index);
      case "ima-stereo":
        return decodeIma(p, this.unpackedSize, this.predictor, this.index, 2, this.predictorRight);
      case "gsm16":
        return decodeGsm(p);
      case "gsm8": {
        // keeps the high byte, minus 0x80
        const s = decodeGsm(p);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = ((s[i] >> 8) & 0xff) ^ 0x80;
        return out;
      }
    }
  }

  get decodedBytes(): number {
    return this.pcm.byteLength;
  }

  /** Playable frames (samples per channel). */
  get frames(): number {
    return Math.floor(this.size / ((this.channels * this.bits) / 8));
  }

  /** Playable part as float samples in [-1, 1), one array per channel (for Web Audio). */
  channelData(): Float32Array[] {
    const pcm = this.pcm;
    const n = this.frames;
    const out = Array.from({ length: this.channels }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.channels; c++) {
        const s = pcm[i * this.channels + c];
        out[c][i] = this.bits === 8 ? (s - 128) / 128 : s / 32768;
      }
    }
    return out;
  }

  /** The playable part of the buffer (size bytes), little-endian. */
  pcmBytes(): Uint8Array {
    const pcm = this.pcm;
    if (pcm instanceof Uint8Array) return pcm.subarray(0, this.size);
    const out = new Uint8Array(Math.min(this.size, pcm.length * 2));
    const v = new DataView(out.buffer);
    for (let i = 0; i < out.length >> 1; i++) v.setInt16(2 * i, pcm[i], true);
    if (out.length & 1) out[out.length - 1] = pcm[out.length >> 1] & 0xff;
    return out;
  }

  wav(): Uint8Array {
    const block = (this.channels * this.bits) / 8;
    const pcm = this.pcmBytes().subarray(0, this.frames * block);
    const out = new Uint8Array(44 + pcm.length);
    const v = new DataView(out.buffer);
    const tag = (o: number, s: string) => [...s].forEach((ch, i) => (out[o + i] = ch.charCodeAt(0)));
    tag(0, "RIFF");
    v.setUint32(4, 36 + pcm.length, true);
    tag(8, "WAVE");
    tag(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, this.channels, true);
    v.setUint32(24, SOUND_RATE, true);
    v.setUint32(28, SOUND_RATE * block, true);
    v.setUint16(32, block, true);
    v.setUint16(34, this.bits, true);
    tag(36, "data");
    v.setUint32(40, pcm.length, true);
    out.set(pcm, 44);
    return out;
  }

  /** Problems found; empty means the file matches the documented format. */
  verify(): string[] {
    const problems: string[] = [];
    const allowed = EXT_KINDS[this.ext];
    if (allowed && !allowed.includes(this.kind)) problems.push(`unexpected ${this.kind} data in a .${this.ext} file`);
    if (this.loopLength && this.loopStart + this.loopLength > this.size) {
      problems.push(`loop ${this.loopStart}+${this.loopLength} past size ${this.size}`);
    }
    if (this.trailing) problems.push(`${this.trailing} bytes after the sound data`);
    const block = (this.channels * this.bits) / 8;
    if (this.size % block) problems.push(`size ${this.size} is not a multiple of ${block}`);
    if (this.kind === "ima" || this.kind === "ima-stereo") {
      if (this.unpackedSize !== 4 * this.packedSize) {
        problems.push(`IMA unpacked size ${this.unpackedSize} != 4 * packed ${this.packedSize}`);
      }
      if (this.size !== this.unpackedSize) problems.push(`buffer size ${this.size} != unpacked size ${this.unpackedSize}`);
    }
    if ((this.kind === "gsm8" || this.kind === "gsm16") && this.packedSize % GSM_BLOCK) {
      problems.push(`GSM data size ${this.packedSize} is not a multiple of ${GSM_BLOCK}`);
    }
    try {
      if (this.decodedBytes < this.size) problems.push(`decodes to ${this.decodedBytes} bytes, buffer size is ${this.size}`);
    } catch (e) {
      if (!(e instanceof SoundError)) throw e;
      problems.push(e.message);
    }
    return problems;
  }
}

/** Extension of a file name, upper case, without the dot. */
export function soundExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toUpperCase();
}
