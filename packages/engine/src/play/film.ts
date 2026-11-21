// RUNAVX (Script_ExecStep case 0x82): the film `Movies\<name>16.AVX` with its
// subtitles `<name>16.DLG`, played by the movie player. No DOM.
import { decodeBm, type Image16 } from "../formats/bm";
import type { FcmEffect, FcmFilm } from "../formats/global";
import { Avx } from "../formats/media";
import { decodePbm } from "../formats/pbm";
import { isIntro, parseSubtitles, SubtitleTrack } from "../formats/subtitles";
import { blend565, mixColour } from "../render/rgb565";
import { MoviePlayer, MODE_OUTRO, MODE_SCENE, type MovieSoundSink, type OutroImages } from "../video";
import type { GameFiles } from "./types";

export { blend565, mixColour };

/** The name the script gives (`ONCAR.AVX`) -> the file on disk (`Movies\ONCAR16.AVX`); the DLG has the same base. */
export function movieBase(film: string): string {
  const dot = film.indexOf(".");
  return `${(dot < 0 ? film : film.slice(0, dot)).toUpperCase()}16`;
}

/** `g_gameFinished` is set when the film is OUTRO.AVX (Game_Run, 4861): the film plays in mode 2, the game ends. */
export const isOutro = (film: string) => film.toUpperCase() === "OUTRO.AVX";

export interface MovieSettings {
  /** DialogOnOff */
  dialogText: boolean;
  sound: MovieSoundSink | null;
  /** level 0..127 of channel 1 */
  level: number;
}

/** Opens the film; null when the file is missing or damaged (Media_Open fails: the game closes it and goes on). */
export async function openMovie(files: GameFiles, film: string, s: MovieSettings): Promise<MoviePlayer | null> {
  const base = movieBase(film);
  const mode = isOutro(film) ? MODE_OUTRO : MODE_SCENE;
  let avx: Avx;
  try {
    avx = new Avx(await files.read(`Movies/${base}.AVX`));
  } catch {
    return null;
  }
  let subtitles: SubtitleTrack | null = null;
  const dlg = `Movies/${base}.DLG`;
  if (await (files.exists?.(dlg) ?? Promise.resolve(false))) {
    try {
      subtitles = new SubtitleTrack(parseSubtitles(await files.read(dlg), isIntro(dlg)), isIntro(dlg));
    } catch {
      subtitles = null;
    }
  }
  let outro: OutroImages | undefined;
  if (mode === MODE_OUTRO) {
    const f = (n: string) => files.read(`Movies/${n}`);
    outro = {
      background: decodeBm(await f("OUTRO16.BM")),
      credits: decodePbm(await f("CREDITS.PBM"), "CREDITS.PBM"),
      cykl: [decodeBm(await f("CYKL1.BM")), decodeBm(await f("CYKL2.BM")), decodeBm(await f("CYKL3.BM"))],
    };
  }
  return new MoviePlayer(avx, { mode, outro, subtitles, dialogTextOn: s.dialogText, sound: s.sound, level: s.level });
}

// --- RUNFILMP (Script_ExecStep case 0x22 -> Film_Play, global = 0): a `.FCM` film in a window of the scene ---

/** Film_Play's `switch (width of the first frame)`: index of the mask `CM<w>.BIN` and of the ring `IM<w>.PBM` (default 0). */
export const MASK_WIDTHS = [220, 240, 260, 280, 300, 310, 316];

/** Part of the screen the film covers: RGB565, 0 = transparent (the scene shows). `x`, `y` are world coordinates. */
export interface FilmWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint16Array;
}

export interface FilmSource {
  film: FcmFilm;
  /** the pictures of `film.frames`, in order (frames[0] is the background) */
  images: Image16[];
  /** the scene as it stands when the film starts (Render_ComposeRegion: without cursor) */
  scene: { pixels: Uint16Array; width: number; height?: number; stride?: number };
  /** circle mode: the rows of `CM<w>.BIN` of the first picture's width */
  mask: number[] | null;
  /** circle mode: the ring picture `IM<w>.PBM`, bigger than the film by 2 * margin */
  ring: Image16 | null;
}

/** Film_Play before its loop: the window is centred on (x, y) (C short division), the upper bound follows the scroll, the lower bound 6 does not. */
export function filmPlace(x: number, y: number, w: number, h: number, scrollX: number): { x: number; y: number } {
  let px = x - Math.trunc(w / 2);
  let py = y - Math.trunc(h / 2);
  if (scrollX - w + 0x276 < px) px = scrollX - w + 0x276;
  if (px < 6) px = 6;
  if (0x1d6 - h < py) py = 0x1d6 - h;
  if (py < 6) py = 6;
  return { x: px, y: py };
}

/**
 * The window of Film_Play: modes 1 and 3 mirror the pictures, 2 and 3 cut a circle (mask `CM*.BIN`) with a ring
 * `IM*.PBM` around it. The clock is the film's own, in ms: picture i (1..n-1) shows from `(i-1) * frameMs`, the
 * last one stays until `(n-1) * frameMs` and then 3 more (`Timer_Sleep`). The call blocks the game meanwhile.
 */
export class FilmRun {
  readonly mirrored: boolean;
  readonly circle: boolean;
  readonly width: number;
  readonly height: number;
  /** top-left of the picture, world coordinates */
  readonly place: { x: number; y: number };
  /** the decoration around the picture: the ring of a circle, the 4-pixel frame otherwise */
  readonly margin: number;
  /** length of the film, ms */
  readonly total: number;
  private readonly base: Uint16Array;
  private readonly baseWidth: number;
  private readonly background: Image16;
  private nextEffect = 0;
  private lastFrame = 0;

  constructor(
    private readonly src: FilmSource,
    mode: number,
    x: number,
    y: number,
    scrollX: number,
  ) {
    const { film, images } = src;
    this.circle = mode === 2 || mode === 3;
    this.mirrored = mode === 1 || mode === 3;
    // the size is that of the picture after the background (`g_fileBuf` read for uVar2 / uVar3)
    this.width = images[1].width;
    this.height = images[1].height;
    this.place = filmPlace(x, y, this.width, this.height, scrollX);
    const ring = this.circle ? src.ring : null;
    this.margin = this.circle ? (ring ? Math.trunc((ring.width - this.width) / 2) : 0) : 4;
    this.baseWidth = this.width + 2 * this.margin;
    const baseHeight = this.height + 2 * this.margin;
    this.base = new Uint16Array(this.baseWidth * baseHeight);
    this.copyScene(baseHeight);
    if (ring) this.drawRing(ring);
    else if (!this.circle) this.drawBevel(baseHeight);
    this.background = this.mirrored ? mirror(images[0]) : images[0];
    this.total = (film.frames.length - 1) * film.frameMs + 3 * film.frameMs;
  }

  private copyScene(baseHeight: number): void {
    const s = this.src.scene;
    const stride = s.stride ?? s.width;
    const height = s.height ?? Math.trunc(s.pixels.length / stride);
    for (let r = 0; r < baseHeight; r++) {
      const sy = this.place.y - this.margin + r;
      if (sy < 0 || sy >= height) continue;
      for (let c = 0; c < this.baseWidth; c++) {
        const sx = this.place.x - this.margin + c;
        if (sx >= 0 && sx < s.width) this.base[r * this.baseWidth + c] = s.pixels[sy * stride + sx];
      }
    }
  }

  /**
 * `(colour, ring, picture)`: the palette entry of every ring pixel gives a level (its blue part, 0..31); the
 * scene pixel moves `level / 32` of the way to `colour` (`RING_COLOUR`), through the tables at / /
 * A level of 0 leaves the pixel alone.
 */
  private drawRing(ring: Image16): void {
    const n = Math.min(ring.pixels.length, this.base.length);
    for (let i = 0; i < n; i++) {
      const level = ring.pixels[i] & 0x1f;
      if (level) this.base[i] = blend565(this.base[i], RING_COLOUR, level);
    }
  }

  /** `(w+8, h+8, 4)`: four rings of a bevel; its colour tables are not read, so a light top/left and a dark bottom/right edge stand in (**approximation**). */
  private drawBevel(baseHeight: number): void {
    const W = this.baseWidth;
    for (let c = 0; c <= 4; c++) {
      for (let i = c; i < W - c; i++) {
        this.base[c * W + i] = lighten(this.base[c * W + i]);
        this.base[(baseHeight - 1 - c) * W + i] = darken(this.base[(baseHeight - 1 - c) * W + i], 12);
      }
      for (let j = c; j < baseHeight - c; j++) {
        this.base[j * W + c] = lighten(this.base[j * W + c]);
        this.base[j * W + W - 1 - c] = darken(this.base[j * W + W - 1 - c], 12);
      }
    }
  }

  /** Picture shown at film time `ms` (1..n-1): pass 1 starts at 0, every pass takes `frameMs`. */
  frameAt(ms: number): number {
    const n = this.src.film.frames.length;
    return Math.min(n - 1, Math.floor(Math.max(0, ms) / this.src.film.frameMs) + 1);
  }

  /** Sounds that became due up to film time `ms`: the loop pass i fires `while (i == effects[next].frame)`, so an effect of frame 0 would stop the table for good. */
  effectsUntil(ms: number): FcmEffect[] {
    const out: FcmEffect[] = [];
    const frame = this.frameAt(ms);
    const effects = this.src.film.effects;
    for (let i = this.lastFrame + 1; i <= frame; i++) {
      while (this.nextEffect < effects.length && effects[this.nextEffect].frame === i) out.push(effects[this.nextEffect++]);
    }
    this.lastFrame = Math.max(this.lastFrame, frame);
    return out;
  }

  finished(ms: number): boolean {
    return ms >= this.total;
  }

  /** The window at film time `ms`: scene copy with ring or frame, the background and the picture keyed over it. */
  windowAt(ms: number): FilmWindow {
    const { film, images } = this.src;
    const frame = this.frameAt(ms);
    const w = this.width;
    const h = this.height;
    const bg = this.background;
    const fr = film.frames[frame];
    // positioned films copy a w x h part of the background at the picture's offset (from the right when mirrored)
    const sx = film.positioned ? (this.mirrored ? bg.width - w - fr.x : fr.x) : 0;
    const sy = film.positioned ? fr.y : 0;
    const buf = new Uint16Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) buf[r * w + c] = pixelAt(bg, sx + c, sy + r);
    if (this.circle && this.src.mask) this.cutCorners(buf, this.src.mask);
    const img = this.mirrored ? mirror(images[frame]) : images[frame];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const p = pixelAt(img, c, r);
        if (p) buf[r * w + c] = p;
      }
    }
    const pixels = this.base.slice();
    const m = this.margin;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (buf[r * w + c]) pixels[(r + m) * this.baseWidth + c + m] = buf[r * w + c];
    return { x: this.place.x - m, y: this.place.y - m, width: this.baseWidth, height: h + 2 * m, pixels };
  }

  /** The memsets of Film_Play: row i and the mirrored row from the bottom lose `mask[i]` pixels at both ends. */
  private cutCorners(buf: Uint16Array, mask: number[]): void {
    const w = this.width;
    const h = this.height;
    for (let i = 0; i < Math.trunc(h / 2); i++) {
      const n = mask[i] ?? 0;
      for (const row of [i, h - i - 1]) {
        for (let k = 0; k < n; k++) {
          buf[row * w + k] = 0;
          buf[row * w + w - n + k] = 0;
        }
      }
    }
  }
}

function mirror(img: Image16): Image16 {
  const pixels = new Uint16Array(img.pixels.length);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) pixels[y * img.width + x] = img.pixels[y * img.width + img.width - 1 - x];
  return { ...img, pixels };
}

function pixelAt(img: Image16, x: number, y: number): number {
  return x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.pixels[y * img.width + x];
}

/** The colour the ring picture blends over the scene (`(0xffff, 0)`). */
export const RING_COLOUR = mixColour(0xffff, 0, 1.5);

/** The pixel `level`/32 of the way to black. */
function darken(p: number, level: number): number {
  const k = 32 - level;
  return (((((p >> 11) & 0x1f) * k) >> 5) << 11) | (((((p >> 5) & 0x3f) * k) >> 5) << 5) | ((((p & 0x1f) * k) >> 5) & 0x1f);
}

function lighten(p: number): number {
  return (Math.min(31, ((p >> 11) & 0x1f) + 6) << 11) | (Math.min(63, ((p >> 5) & 0x3f) + 12) << 5) | Math.min(31, (p & 0x1f) + 6);
}
