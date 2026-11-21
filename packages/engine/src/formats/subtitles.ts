// Movie subtitles Movies\*.DLG.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import { viewOf } from "./bytes";

export { SCREEN_HEIGHT as SCREEN_H, SCREEN_WIDTH as SCREEN_W };

export class SubtitlesError extends Error {}

const INTRO_HEADER = 24; // w, h, x, y, first, last, segment (u16), colour RGB, 7 bytes padding
const RGB565_HEADER = 14; // first, last, x, y, unk, w, h (u16)

export const SUBS_BUFFER = 0x64000; // Media_Open: memset + read into g_movieSubs
export const INTRO_PIXELS_MAX = 0x19000 / 2; // the mapped-picture buffer of mode 1

const INTRO_OUTLINE = 0x0001; // palette entry 0, set by Media_DrawSubtitles
const INTRO_BODY = 255; // palette entry 255 = the record's colour
const INTRO_CLEAR = 128; // entry 128 stays 0 = transparent

export interface Subtitle {
  /** shown when the frame counter equals this ... */
  first: number;
  /** ... hidden when it equals this */
  last: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** INTRO only: the segment both counters refer to */
  segment: number | null;
  /** INTRO only: RGB888 of palette entry 255 */
  color: [number, number, number] | null;
  /** RGB565 words, row-major, 0 = transparent (INTRO: already mapped) */
  pixels: Uint16Array;
  /** RGB565 layout: field at offset 8, always 0 */
  unk: number;
  /** INTRO only: distinct raw picture bytes (verify) */
  rawValues: Set<number> | null;
}

/** The game picks the layout by movie mode; mode 1 is the intro, the file INTRO.DLG. */
export function isIntro(name: string): boolean {
  return (name.split(/[\\/]/).pop() ?? "").toUpperCase() === "INTRO.DLG";
}

/** Pal_Rgb888To565. */
export function rgb888To565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

function readSubtitleHeader(
  v: DataView,
  data: Uint8Array,
  pos: number,
  intro: boolean,
): { sub: Subtitle; w: number; h: number } {
  let sub: Subtitle;
  let w: number;
  let h: number;
  if (intro) {
    w = v.getUint16(pos, true);
    h = v.getUint16(pos + 2, true);
    sub = {
      first: v.getUint16(pos + 8, true),
      last: v.getUint16(pos + 10, true),
      x: v.getUint16(pos + 4, true),
      y: v.getUint16(pos + 6, true),
      width: w,
      height: h,
      segment: v.getUint16(pos + 12, true),
      color: [data[pos + 14], data[pos + 15], data[pos + 16]],
      pixels: new Uint16Array(0),
      unk: 0,
      rawValues: null,
    };
  } else {
    w = v.getUint16(pos + 10, true);
    h = v.getUint16(pos + 12, true);
    sub = {
      first: v.getUint16(pos, true),
      last: v.getUint16(pos + 2, true),
      x: v.getUint16(pos + 4, true),
      y: v.getUint16(pos + 6, true),
      width: w,
      height: h,
      segment: null,
      color: null,
      pixels: new Uint16Array(0),
      unk: v.getUint16(pos + 8, true),
      rawValues: null,
    };
  }
  return { sub, w, h };
}

function readSubtitlePixels(
  sub: Subtitle,
  v: DataView,
  data: Uint8Array,
  pos: number,
  n: number,
  intro: boolean,
): void {
  const pixels = new Uint16Array(n);
  if (intro) {
    const lut = new Uint16Array(256);
    lut[0] = INTRO_OUTLINE;
    lut[INTRO_BODY] = rgb888To565(...sub.color!);
    const raw = new Set<number>();
    for (let i = 0; i < n; i++) {
      const b = data[pos + i];
      raw.add(b);
      pixels[i] = lut[b];
    }
    sub.rawValues = raw;
  } else {
    for (let i = 0; i < n; i++) pixels[i] = v.getUint16(pos + 2 * i, true);
  }
  sub.pixels = pixels;
}

/** List of subtitles in file order. Throws SubtitlesError on truncated data. */
export function parseSubtitles(data: Uint8Array, intro: boolean): Subtitle[] {
  if (data.length > SUBS_BUFFER) {
    throw new SubtitlesError(`${data.length} bytes do not fit the 0x${SUBS_BUFFER.toString(16)}-byte subtitle buffer`);
  }
  const v = viewOf(data);
  const headSize = intro ? INTRO_HEADER : RGB565_HEADER;
  const out: Subtitle[] = [];
  let pos = 0;
  while (pos < data.length) {
    const at = pos;
    if (pos + headSize > data.length) throw new SubtitlesError(`record header truncated at 0x${pos.toString(16)}`);
    const { sub, w, h } = readSubtitleHeader(v, data, pos, intro);
    pos += headSize;
    const n = w * h;
    const size = intro ? n : 2 * n;
    if (intro && n > INTRO_PIXELS_MAX) {
      throw new SubtitlesError(`record at 0x${at.toString(16)}: ${w}x${h} exceeds the mapped-picture buffer`);
    }
    if (pos + size > data.length) {
      throw new SubtitlesError(
        `record at 0x${at.toString(16)}: pixels truncated (${size} bytes needed, ${data.length - pos} left)`,
      );
    }
    readSubtitlePixels(sub, v, data, pos, n, intro);
    pos += size;
    out.push(sub);
  }
  return out;
}

/** Media_DrawSubtitles as a state machine: call step() once per displayed frame. */
export class SubtitleTrack {
  private index = 0;
  private visible = false;

  constructor(
    readonly subs: Subtitle[],
    readonly intro: boolean,
  ) {}

  /**
   * Subtitle to draw after video frame `frame` (1-based counter) of `segment`, or null.
   * Past the last record the game reads zero-filled memory, which never matches.
   */
  step(segment: number, frame: number): Subtitle | null {
    const subs = this.subs;
    const matches = (s: Subtitle, f: number) => frame === f && (!this.intro || segment === s.segment);
    let cur: Subtitle | undefined = subs[this.index];
    if (cur && this.visible && matches(cur, cur.last)) {
      this.visible = false;
      cur = subs[++this.index];
    }
    if (cur && !this.visible && matches(cur, cur.first)) this.visible = true;
    return cur && this.visible ? cur : null;
  }

  get position(): number {
    return this.index;
  }

  get isVisible(): boolean {
    return this.visible;
  }
}

export function verifySubtitles(name: string, data: Uint8Array): string[] {
  const intro = isIntro(name);
  let subs: Subtitle[];
  try {
    subs = parseSubtitles(data, intro);
  } catch (e) {
    if (e instanceof SubtitlesError) return [e.message];
    throw e;
  }
  const problems: string[] = [];
  if (!subs.length) problems.push("no records");
  subs.forEach((s, i) => {
    const where = `record ${i}`;
    if (s.width <= 0 || s.height <= 0) problems.push(`${where}: empty picture ${s.width}x${s.height}`);
    if (s.first >= s.last) problems.push(`${where}: first ${s.first} >= last ${s.last}`);
    if (s.x + s.width > SCREEN_WIDTH || s.y + s.height > SCREEN_HEIGHT) {
      problems.push(
        `${where}: ${s.width}x${s.height} at ${s.x},${s.y} leaves the ${SCREEN_WIDTH}x${SCREEN_HEIGHT} screen`,
      );
    }
    if (s.unk) problems.push(`${where}: unk ${s.unk} (documented as 0)`);
    if (intro && [...s.rawValues!].some((b) => b !== 0 && b !== INTRO_CLEAR && b !== INTRO_BODY)) {
      problems.push(`${where}: pixel values other than 0, 128, 255`);
    }
    if (!s.pixels.some((p) => p)) problems.push(`${where}: fully transparent`);
  });
  if (intro) {
    const sorted = subs.every(
      (s, i) =>
        i === 0 ||
        s.segment! > subs[i - 1].segment! ||
        (s.segment === subs[i - 1].segment && s.first >= subs[i - 1].first),
    );
    if (!sorted) problems.push("records not sorted by (segment, first)");
  }
  return problems;
}
