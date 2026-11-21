// The cigarette smoke of the main menu: MENU.PAK:D1.FLX played one chunk per call by Menu_FlxStep.
import {
  CHUNK_DELTA, CHUNK_HEAD_SIZE, CHUNK_PACKED, CHUNK_PALETTE, FLX_HEADER_SIZE, FrameBuffer, MediaError, parseFlxHeader,
  unpackRle,
} from "../formats/media";
import type { FlxHeader } from "../formats/media";
import type { Surface16 } from "../render/surface";

/** Sprite_Set(0x135, 0x27) in Menu_FlxStep: the smoke is always drawn at (309, 39). */
export const SMOKE_X = 0x135;
export const SMOKE_Y = 0x27;
/** Menu_FlxStep copies 0x200 bytes of a palette chunk: 256 x RGB565. */
const PALETTE_BYTES = 0x200;

function chunkAt(data: Uint8Array, pos: number): { type: number; size: number } {
  if (pos + CHUNK_HEAD_SIZE > data.length) throw new MediaError(`menu FLX: chunk head truncated at ${pos}`);
  const size = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(pos + 2, true);
  if (size < CHUNK_HEAD_SIZE || pos + size > data.length) throw new MediaError(`menu FLX: chunk at ${pos} has bad size ${size}`);
  return { type: data[pos], size };
}

/**
 * Menu_FlxStep: one call = an optional palette chunk (4) plus exactly one more chunk; only 2 (packed delta) and
 * 1 (delta) count as frames, a rectangle (3) or empty frame (0) is skipped as a whole call. The picture buffer
 * (zeroed once by Launcher_Run) is never cleared; deltas write palette[index] (0 = transparent).
 */
export class MenuSmoke {
  readonly header: FlxHeader;
  /** offset of the next chunk */
  pos = FLX_HEADER_SIZE;
  /** image chunks applied since the start of the loop */
  frames = 0;
  /** calls since the start (for tests) */
  calls = 0;
  private readonly fb: FrameBuffer;
  readonly surface: Surface16;

  constructor(readonly data: Uint8Array) {
    this.header = parseFlxHeader(data);
    this.fb = new FrameBuffer(this.header.width, this.header.height);
    this.surface = { width: this.header.width, height: this.header.height, pixels: this.fb.pixels };
  }

  /** Menu_FlxStep. */
  step(): void {
    const d = this.data;
    let c = chunkAt(d, this.pos);
    if (c.type === CHUNK_PALETTE) {
      if (c.size - CHUNK_HEAD_SIZE < PALETTE_BYTES) throw new MediaError(`menu FLX: palette chunk at ${this.pos} too short`);
      this.fb.setPalette(d, this.pos + CHUNK_HEAD_SIZE, 1);
      this.pos += c.size;
      c = chunkAt(d, this.pos);
    }
    if (c.type === CHUNK_PACKED) {
      const { buf } = unpackRle(d, this.pos + CHUNK_HEAD_SIZE, this.pos + c.size, this.fb.unpacked);
      this.fb.unpacked = buf;
      this.fb.applyDelta(buf);
      this.frames++;
    } else if (c.type === CHUNK_DELTA) {
      this.fb.applyDelta(d, this.pos + 2);
      this.frames++;
    }
    this.pos += c.size;
    this.calls++;
  }

  /** The step of the present hook: after the last frame the position goes back to 0x14, then a step. */
  advance(): void {
    if (this.frames >= this.header.frames) this.restart();
    this.step();
  }

  /** `= 0x14; = 0` (Launcher_Run, Launcher_PlayIntro). */
  restart(): void {
    this.pos = FLX_HEADER_SIZE;
    this.frames = 0;
  }
}
