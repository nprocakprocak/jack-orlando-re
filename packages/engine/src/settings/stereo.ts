// "Pseudo surround" and "reverse stereo" of the music: Snd_CopyStereo.
// Surround inverts the phase of the left channel, reverse swaps the channels; both together give
// L' = R, R' = -L. Pure description for the Web Audio graph (used by the game integration).

/** Output = matrix * input: L' = ll*L + lr*R, R' = rl*L + rr*R. */
export interface StereoMatrix {
  ll: number;
  lr: number;
  rl: number;
  rr: number;
}

export function stereoMatrix(surround: boolean, reverse: boolean): StereoMatrix {
  if (surround && reverse) return { ll: 0, lr: 1, rl: -1, rr: 0 };
  if (reverse) return { ll: 0, lr: 1, rl: 1, rr: 0 };
  if (surround) return { ll: -1, lr: 0, rl: 0, rr: 1 };
  return { ll: 1, lr: 0, rl: 0, rr: 1 };
}

/** The same transform on interleaved 16-bit samples, as the original does it (-(-32768) wraps like int16). */
export function copyStereo(samples: Int16Array, surround: boolean, reverse: boolean): Int16Array {
  const m = stereoMatrix(surround, reverse);
  const out = new Int16Array(samples.length);
  for (let i = 0; i + 1 < samples.length; i += 2) {
    const l = samples[i];
    const r = samples[i + 1];
    out[i] = m.ll * l + m.lr * r;
    out[i + 1] = m.rl * l + m.rr * r;
  }
  return out;
}

/**
 * Web Audio graph: input -> splitter -> 4 gains (ll, lr, rl, rr) -> merger -> output. `update` changes
 * the gains without rebuilding the graph (the options can change while the music plays).
 */
export class StereoOptions {
  private readonly gains: GainNode[];

  constructor(ctx: BaseAudioContext, readonly input: AudioNode, readonly output: AudioNode) {
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    this.gains = [0, 1, 2, 3].map(() => ctx.createGain());
    input.connect(splitter);
    // gains[0]: L->L', [1]: R->L', [2]: L->R', [3]: R->R'
    splitter.connect(this.gains[0], 0);
    splitter.connect(this.gains[1], 1);
    splitter.connect(this.gains[2], 0);
    splitter.connect(this.gains[3], 1);
    this.gains[0].connect(merger, 0, 0);
    this.gains[1].connect(merger, 0, 0);
    this.gains[2].connect(merger, 0, 1);
    this.gains[3].connect(merger, 0, 1);
    merger.connect(output);
    this.update(false, false);
  }

  update(surround: boolean, reverse: boolean): void {
    const m = stereoMatrix(surround, reverse);
    [m.ll, m.lr, m.rl, m.rr].forEach((v, i) => (this.gains[i].gain.value = v));
  }
}
