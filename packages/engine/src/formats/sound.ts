// Sound reader.SND.S16.S22 and scene .PSD.
// A file is either a raw sound buffer (12-byte header + PCM) or a packed one: a 24-byte
// codec header (type 0x32..0x35), then - except for type 0x33 - the 12-byte buffer header,
// then IMA ADPCM or GSM 6.10 (WAV49) data.
import { viewOf } from "./bytes";
import { parseCodec } from "./media-avx";
import { GSM_BLOCK, SoundError, decodeGsm, decodeIma } from "./sound-codec";
export { GSM_BLOCK, IMA_INDEX, IMA_STEP, SoundError, decodeGsm, decodeIma } from "./sound-codec";

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

/** size, loop start and loop length: the 12-byte buffer header at `pos`. */
function readBufferHeader(view: DataView, pos: number): { size: number; loopStart: number; loopLength: number } {
  return {
    size: view.getUint32(pos, true),
    loopStart: view.getUint32(pos + 4, true),
    loopLength: view.getUint32(pos + 8, true),
  };
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
    const view = viewOf(data);
    if (data.length < 4) throw new SoundError("too short");
    const tag = view.getUint32(0, true);
    let pos: number;
    if (tag in TYPE_KIND) {
      this.kind = TYPE_KIND[tag];
      if (data.length < CODEC_HEADER_SIZE) throw new SoundError("codec header truncated");
      const codec = parseCodec(data, 0);
      this.type = codec.type;
      this.packedSize = codec.packedSize;
      this.unpackedSize = codec.unpackedSize;
      this.loopOffset = codec.loopOffset;
      this.predictor = codec.predictor;
      this.index = codec.index;
      this.predictorRight = codec.predictorR;
      pos = CODEC_HEADER_SIZE;
      if (tag === TYPE_IMA_STEREO) {
        this.size = this.unpackedSize;
        this.loopStart = this.loopLength = 0;
      } else {
        if (data.length < pos + BUFFER_HEADER_SIZE) throw new SoundError("buffer header truncated");
        const header = readBufferHeader(view, pos);
        this.size = header.size;
        this.loopStart = header.loopStart;
        this.loopLength = header.loopLength;
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
      const header = readBufferHeader(view, 0);
      this.size = header.size;
      this.loopStart = header.loopStart;
      this.loopLength = header.loopLength;
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
        const v = viewOf(p);
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
      if (this.size !== this.unpackedSize)
        problems.push(`buffer size ${this.size} != unpacked size ${this.unpackedSize}`);
    }
    if ((this.kind === "gsm8" || this.kind === "gsm16") && this.packedSize % GSM_BLOCK) {
      problems.push(`GSM data size ${this.packedSize} is not a multiple of ${GSM_BLOCK}`);
    }
    try {
      if (this.decodedBytes < this.size)
        problems.push(`decodes to ${this.decodedBytes} bytes, buffer size is ${this.size}`);
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
