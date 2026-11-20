// .PAK archive reader.

import { viewOf } from "./bytes";

export interface PakEntry {
  name: string;
  offset: number;
  size: number;
}

export class PakError extends Error {}

const MAGIC = "PAK\0";
const HEADER_SIZE = 16;
const ENTRY_FIXED_SIZE = 12;
const MAX_NAME = 0x104;

const cp1250 = new TextDecoder("windows-1250");

export class Pak {
  readonly entries: PakEntry[] = [];
  readonly dataStart: number;
  readonly reserved: number;
  readonly directoryEnd: number;
  private readonly byName = new Map<string, PakEntry>();
  private readonly bytes: Uint8Array;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const view = viewOf(this.bytes);
    if (this.bytes.length < HEADER_SIZE) throw new PakError("too short");

    const magic = String.fromCharCode(...this.bytes.subarray(0, 4));
    if (magic !== MAGIC) throw new PakError(`bad magic ${JSON.stringify(magic)}`);
    const count = view.getUint32(4, true);
    this.dataStart = view.getUint32(8, true);
    this.reserved = view.getUint32(12, true);

    let pos = HEADER_SIZE;
    for (let i = 0; i < count; i++) {
      if (pos + ENTRY_FIXED_SIZE > this.bytes.length) throw new PakError(`directory truncated at entry ${i}`);
      const offset = view.getUint32(pos, true);
      const size = view.getUint32(pos + 4, true);
      const nameLen = view.getUint32(pos + 8, true);
      pos += ENTRY_FIXED_SIZE;
      if (nameLen === 0 || nameLen > MAX_NAME) throw new PakError(`entry ${i} has name length ${nameLen}`);
      const raw = this.bytes.subarray(pos, pos + nameLen);
      pos += nameLen;
      const nul = raw.indexOf(0);
      const name = cp1250.decode(nul >= 0 ? raw.subarray(0, nul) : raw);
      const entry = { name, offset, size };
      this.entries.push(entry);
      // repeated names are identical copies; the game's linear search takes the first
      const key = name.toUpperCase();
      if (!this.byName.has(key)) this.byName.set(key, entry);
    }
    this.directoryEnd = pos;
  }

  /** Case-insensitive, like the game (it strupr()s the requested name). */
  find(name: string): PakEntry | undefined {
    return this.byName.get(name.toUpperCase());
  }

  read(entry: PakEntry | string): Uint8Array {
    const e = typeof entry === "string" ? this.find(entry) : entry;
    if (!e) throw new PakError(`not found: ${entry as string}`);
    return this.bytes.subarray(e.offset, e.offset + e.size);
  }

  /** Problems found; empty means the archive matches the documented format. */
  verify(): string[] {
    const problems: string[] = [];
    if (this.dataStart !== this.directoryEnd) {
      problems.push(`data_start ${this.dataStart} != directory end ${this.directoryEnd}`);
    }
    if (this.reserved !== 0) problems.push(`reserved field is ${this.reserved}`);
    let expected = this.dataStart;
    for (const e of [...this.entries].sort((a, b) => a.offset - b.offset)) {
      if (e.offset !== expected) problems.push(`${e.name}: offset ${e.offset}, expected ${expected}`);
      if (e.offset + e.size > this.bytes.length) problems.push(`${e.name}: runs past end of file`);
      expected = e.offset + e.size;
    }
    if (expected !== this.bytes.length) problems.push(`last entry ends at ${expected}, file size ${this.bytes.length}`);
    return problems;
  }
}
