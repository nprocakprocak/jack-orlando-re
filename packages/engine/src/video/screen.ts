// The 640x480 picture of a movie. Media_DecodeVideo writes every delta straight to
// the screen (Delta_ToScreen, outro: Delta_ToScreenOverBg), so the screen is
// persistent state and not a function of the index buffer: subtitles and the outro cycle
// images stay where they were drawn until a later delta overwrites them.
// src/video/README.md

import { AVX_INDEX_BUFFER, FrameBuffer } from "../formats/media";
import type { AvxFrame } from "../formats/media";
import type { Image16 } from "../formats/bm";
import { SCREEN_H, SCREEN_W } from "../formats/subtitles";
import type { Subtitle } from "../formats/subtitles";

/** Movie modes of Media_Open. */
export const MODE_SCENE = 0; // RUNAVX: Movies\<film>16.AVX
export const MODE_INTRO = 1; // Launcher_PlayIntro: INTRO.AVX, 640x480 8-bit
export const MODE_OUTRO = 2; // OUTRO16.AVX with credits

export type MovieMode = 0 | 1 | 2;

/** Outro: segments with these ranges are special in Media_DecodeVideo. */
export const OUTRO_CREDITS_SEGMENT = 4;
export const OUTRO_CYKL1_SEGMENT = 7;
/** Segment 7, frame index 1..0x4a: the delta is applied to the index buffer but not drawn. */
export const OUTRO_SKIP_LAST = 0x4a;
export const OUTRO_CYKL_FIRST = 7;
export const OUTRO_CYKL_LAST = 0x12;
export const OUTRO_FADE_SEGMENT = 0x13;
/** Cycle images and credits are drawn at x = 0x23 (Blit_Pal8Keyed arguments). */
export const OUTRO_CYKL_X = 0x23;

/** Images of Media_Open mode 2: `<film>.BM`, credits.pbm, cykl1..3.bm. */
export interface OutroImages {
  /** OUTRO16.BM, 640x480 RGB565 (the background behind index 0) */
  background: Image16;
  /** CREDITS.PBM, drawn opaque into the background at the start of segment 4 */
  credits: Image16;
  /** CYKL1..3.BM, 8-bit with colour 0 transparent */
  cykl: [Image16, Image16, Image16];
}

/** FrameBuffer that remembers which pixel runs the last delta(s) wrote (pairs: start, count). */
export class MovieBuffer extends FrameBuffer {
  runs: number[] = [];

  constructor() {
    super(1, 1, true, AVX_INDEX_BUFFER);
  }

  override applyDelta(src: Uint8Array, base = 0): number {
    const stopped = super.applyDelta(src, base);
    // the same walk as FrameBuffer.applyDelta, which has already validated it
    const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const end = base + v.getUint32(base, true);
    let pos = v.getUint32(base + 4, true);
    let p = base + 8;
    const at = (i: number) => (i < src.length ? src[i] : 0);
    while (p < end) {
      pos += at(p);
      const n = at(p + 1);
      p += 2;
      if (!n) continue;
      if (p >= end) break;
      this.runs.push(pos, n);
      pos += n;
      p += n;
    }
    return stopped;
  }
}

/** Copies `img` to (x, y) of `dest` (pitch `pitch`, `rows` rows), clipped; `keyed` skips colour 0. */
export function blitImage(
  dest: Uint16Array,
  pitch: number,
  rows: number,
  img: Image16,
  x: number,
  y: number,
  keyed: boolean,
): void {
  for (let r = 0; r < img.height; r++) {
    const dy = y + r;
    if (dy < 0 || dy >= rows) continue;
    for (let c = 0; c < img.width; c++) {
      const dx = x + c;
      if (dx < 0 || dx >= pitch) continue;
      const px = img.pixels[r * img.width + c];
      if (keyed && px === 0) continue;
      dest[dy * pitch + dx] = px;
    }
  }
}

export class MovieScreen {
  readonly pixels = new Uint16Array(SCREEN_W * SCREEN_H);
  /** outro: background of Delta_ToScreenOverBg */
  readonly background: Uint16Array | null;

  constructor(
    readonly mode: MovieMode,
    private readonly outro?: OutroImages,
  ) {
    if (mode === MODE_OUTRO) {
      if (!outro) throw new Error("outro mode needs the outro images");
      this.background = new Uint16Array(SCREEN_W * SCREEN_H);
      blitImage(this.background, SCREEN_W, SCREEN_H, outro.background, 0, 0, false);
    } else {
      this.background = null;
    }
  }

  /** Draws the decoded frame `af`; `runs` = pixel runs of its delta (MovieBuffer.runs). */
  drawFrame(af: AvxFrame, runs: number[]): void {
    const { fb, header, segment, index } = af;
    const outro = this.mode === MODE_OUTRO;
    if (outro && index === 0) this.segmentStart(segment);
    const skip = outro && segment === OUTRO_CYKL1_SEGMENT && index >= 1 && index <= OUTRO_SKIP_LAST;
    if (!skip) {
      const w = header.width;
      const bg = this.background;
      const screen = this.pixels;
      for (let k = 0; k < runs.length; k += 2) {
        for (let i = runs[k], n = runs[k + 1]; n > 0; i++, n--) {
          const x = i % w;
          const y = (i - x) / w;
          if (x >= SCREEN_W || y >= SCREEN_H) continue;
          const idx = fb.indices[i];
          screen[y * SCREEN_W + x] = outro && idx === 0 ? bg![y * SCREEN_W + x] : fb.palette[idx];
        }
      }
    }
    // INTRO: a palette chunk redraws every row (after the delta)
    if (this.mode === MODE_INTRO && af.frame.palette) {
      for (let y = 0; y < SCREEN_H; y++) {
        const row = fb.pixels.subarray(y * header.width, y * header.width + SCREEN_W);
        this.pixels.set(row, y * SCREEN_W);
      }
    }
    // OUTRO: one of the three cycle images over the picture, by frame counter % 3
    if (outro && segment >= OUTRO_CYKL_FIRST && segment <= OUTRO_CYKL_LAST) {
      blitImage(this.pixels, SCREEN_W, SCREEN_H, this.outro!.cykl[(index + 1) % 3], OUTRO_CYKL_X, 0, true);
    }
  }

  /** Media_DrawSubtitles: keyed blit over the screen (colour 0 is transparent). */
  drawSubtitle(sub: Subtitle): void {
    blitImage(
      this.pixels,
      SCREEN_W,
      SCREEN_H,
      { width: sub.width, height: sub.height, kind: "rgb565", pixels: sub.pixels },
      sub.x,
      sub.y,
      true,
    );
  }

  /** Media_DecodeVideo, first frame of a segment of the outro. */
  private segmentStart(segment: number): void {
    const bg = this.background!;
    const o = this.outro!;
    if (segment === OUTRO_CREDITS_SEGMENT) blitImage(bg, SCREEN_W, SCREEN_H, o.credits, 0, 0, false);
    if (segment === OUTRO_CYKL1_SEGMENT) blitImage(bg, SCREEN_W, SCREEN_H, o.cykl[0], OUTRO_CYKL_X, 0, true);
  }
}
