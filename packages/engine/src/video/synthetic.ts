// Builders of tiny FLX / AVX files for tests (bytes in code, not game files).

import { AVX_PREROLL } from "../formats/media";

export function u16(v: number): number[] {
  return [v & 255, (v >> 8) & 255];
}
export function u32(v: number): number[] {
  return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
}

export function flxHeader(frames: number, width: number, height: number, fps = 10, mode = 0, pal16 = 1): number[] {
  return [0x46, 0x4c, 0x58, 0, ...u16(frames), ...u16(width), ...u16(height), ...u16(fps), 1, mode, pal16, 0, ...u16(0), ...u16(0)];
}

/** chunk 4 with the given RGB565 colours (the rest 0) */
export function paletteChunk(colors: number[]): number[] {
  const body: number[] = [];
  for (let i = 0; i < 256; i++) body.push(...u16(colors[i] ?? 0));
  return [4, 0, ...u32(6 + 512), ...body];
}

export function rectChunk(x: number, y: number, w: number, h: number): number[] {
  const s = (v: number) => u16(v & 0xffff);
  return [3, 0, ...u32(14), ...s(x), ...s(y), ...s(w), ...s(h)];
}

export function emptyChunk(): number[] {
  return [0, 0, ...u32(6)];
}

/** chunk 1: record at +2 (its size = chunk size), start pixel, then [skip, bytes] pairs */
export function deltaChunk(start: number, runs: [number, number[]][]): number[] {
  const pairs: number[] = [];
  for (const [skip, px] of runs) pairs.push(skip, px.length, ...px);
  const size = 6 + 4 + pairs.length;
  return [1, 0, ...u32(size), ...u32(start), ...pairs];
}

export interface SynthFrame {
  chunks: number[][];
  /** IMA bytes of the record (multiple of 8) */
  sound?: number;
}

export interface SynthSegment {
  width: number;
  height: number;
  fps: number;
  mode?: number;
  pal16?: number;
  frames: SynthFrame[];
}

/** AVX: header, zero preroll (silence), one block holding every record. */
export function buildAvx(segments: SynthSegment[], soundBytes = 8): Uint8Array {
  const out: number[] = [...u16(segments.length), 4, 16];
  const codec = [...u32(0x33), ...u32(0x7fffffff), ...u32(0x7fffffff), ...u32(0x7fffffff), ...u16(0), 0, 0, ...u16(0), 0, 0];
  out.push(...codec);
  out.push(...new Array(AVX_PREROLL - codec.length).fill(0));
  const records: number[] = [];
  for (const seg of segments) {
    seg.frames.forEach((f, i) => {
      const body: number[] = [];
      if (i === 0) body.push(...flxHeader(seg.frames.length, seg.width, seg.height, seg.fps, seg.mode ?? 0, seg.pal16 ?? 1));
      for (const c of f.chunks) body.push(...c);
      const n = f.sound ?? soundBytes;
      body.push(...u32(4 + n));
      for (let k = 0; k < n; k++) body.push(0);
      records.push(...u32(body.length));
      for (const b of body) records.push(b); // no spread: long records would overflow the call stack

    });
  }
  out.push(...u32(4 + records.length));
  for (const b of records) out.push(b);
  return new Uint8Array(out);
}

export function buildFlx(width: number, height: number, mode: number, frames: number[][][]): Uint8Array {
  const out = [...flxHeader(frames.length, width, height, 10, mode)];
  for (const f of frames) for (const c of f) out.push(...c);
  return new Uint8Array(out);
}
