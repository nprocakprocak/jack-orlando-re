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
