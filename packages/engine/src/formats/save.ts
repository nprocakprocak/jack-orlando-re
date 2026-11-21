// Save files: SAVEGAME\*.SAV / *.SVL, tempjs, Jacksave.00a.
// Writer (Save_WriteState), reader (Save_LoadState), copy of tempjs
// (Save_CopyTemp). Fixed little-endian layout, no compression:
// 80 B header, 13 B music, 15 B scene, u16 var count, 500 x i16 variables,
// u16 item count, items (u16 slot, 14 B name, 0xdd4 B image), 23 B tail (pose of Jack).

import { MAZOVIA, decodeText } from "./textcrypt";

export const HEADER_SIZE = 0x50; // g_guiStrings[9] (slot 0 description) 008a8db0
export const MUSIC_SIZE = 13; // current music file name 0087123c
export const SCENE_SIZE = 15; // g_sceneName 008a2680
export const VAR_SLOTS = 500; // 1000 bytes of g_varValues
export const INV_SLOTS = 84; // g_invOccupied
export const ITEM_NAME_SIZE = 14; // g_invNames
export const ITEM_IMAGE_SIZE = 0xdd4; // g_invImages: u16 w, u16 h, RGB565
export const ITEM_PIXELS_MAX = (ITEM_IMAGE_SIZE - 4) / 2;
export const ITEM_SIZE = 2 + ITEM_NAME_SIZE + ITEM_IMAGE_SIZE;
export const HEAD_SIZE = HEADER_SIZE + MUSIC_SIZE + SCENE_SIZE + 2 + VAR_SLOTS * 2 + 2; // 1112
export const TAIL_SIZE = 23;
export const EMPTY_SIZE = HEAD_SIZE + TAIL_SIZE; // 1135

export const GAME_TITLE = "Jack Orlando";
export const NORMAL_HEADER = "Jack Orlando - normal ver";
export const LIGHT_HEADER = "Jack Orlando - light ver";
/** compares only this header byte with 'l'. */
export const VERSION_BYTE = 15;
export const MENU_MUSIC_REPLACEMENT = "TR17-22.PMS";
export const TEMP_NAME = "tempjs";

export class SaveError extends Error {}

export interface SaveItem {
  /** inventory slot 0..83 */
  slot: number;
  /** 14 raw bytes: NUL-terminated name plus leftovers of older names */
  name: Uint8Array;
  /** 0xdd4 raw bytes: u16 w, u16 h, RGB565; bytes past w*h pixels are leftovers */
  image: Uint8Array;
}

export interface SaveGame {
  header: Uint8Array; // 80 B
  music: Uint8Array; // 13 B
  scene: Uint8Array; // 15 B
  /** g_varCount; the reader overwrites the game's count with it */
  varCount: number;
  /** 500 x int16 = g_varValues[0..499] */
  varValues: number[];
  items: SaveItem[];
  /** AUTOINCRANGE: value after wrap-around (007cdee4) */
  autoincMin: number;
  /** AUTOINCRANGE: upper bound (0051f84c) */
  autoincMax: number;
  /** AUTOINCRANGE: variable index, -1 = off (0055b278) */
  autoincVar: number;
  /** 0079dfc8: 1 = scene start puts Jack at the saved pose */
  restorePose: number;
  jackX: number; // float32
  jackY: number; // float32
  jackScale: number; // float32
  jackDir: number; // 0..4
  jackFacing: number; // 1 / -1
}

const ENCODE = new Map(MAZOVIA.map((c, b) => [c, b]));

/** Bytes up to the first NUL, Mazovia-decoded. */
export function cstr(raw: Uint8Array): string {
  const end = raw.indexOf(0);
  return decodeText(end < 0 ? raw : raw.subarray(0, end));
}

/** Mazovia bytes + NUL, zero-padded to size (strcpy into a zeroed buffer). */
export function encodeCstr(text: string, size: number): Uint8Array {
  const chars = [...text];
  if (chars.length >= size) throw new SaveError(`"${text}" does not fit in ${size} bytes with its NUL`);
  const out = new Uint8Array(size);
  chars.forEach((c, i) => {
    const b = ENCODE.get(c);
    if (b === undefined) throw new SaveError(`character "${c}" not in Mazovia`);
    out[i] = b;
  });
  return out;
}

export function headerText(s: SaveGame): string {
  return cstr(s.header);
}

/** Easy version: the only thing checks before loading. */
export function isLight(s: SaveGame): boolean {
  return s.header[VERSION_BYTE] === 0x6c; // 'l'
}

/** Written by Save_CopyTemp ("Jack Orlando" + NUL over the rest of the last header). */
export function isCopy(s: SaveGame): boolean {
  return headerText(s) === GAME_TITLE;
}

export function musicName(s: SaveGame): string {
  return cstr(s.music);
}

export function sceneName(s: SaveGame): string {
  return cstr(s.scene);
}

export function itemName(it: SaveItem): string {
  return cstr(it.name);
}

export function itemSize(it: SaveItem): { width: number; height: number } {
  const v = new DataView(it.image.buffer, it.image.byteOffset, it.image.byteLength);
  return { width: v.getUint16(0, true), height: v.getUint16(2, true) };
}

/** RGB565 pixels (width * height * 2 bytes), key 0 = transparent. */
export function itemPixels(it: SaveItem): Uint8Array {
  const { width, height } = itemSize(it);
  const n = Math.min(width * height, ITEM_PIXELS_MAX);
  return it.image.subarray(4, 4 + n * 2);
}

export function parseSave(data: Uint8Array): SaveGame {
  if (data.length < EMPTY_SIZE) throw new SaveError(`too short: ${data.length} bytes, at least ${EMPTY_SIZE}`);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const take = (n: number) => data.slice(pos, (pos += n));
  const header = take(HEADER_SIZE);
  const music = take(MUSIC_SIZE);
  const scene = take(SCENE_SIZE);
  const varCount = v.getUint16(pos, true);
  pos += 2;
  const varValues: number[] = [];
  for (let i = 0; i < VAR_SLOTS; i++, pos += 2) varValues.push(v.getInt16(pos, true));
  const count = v.getUint16(pos, true);
  pos += 2;
  if (count > INV_SLOTS) throw new SaveError(`${count} items, inventory has ${INV_SLOTS} slots`);
  const expected = EMPTY_SIZE + count * ITEM_SIZE;
  if (data.length < expected) {
    throw new SaveError(`truncated: ${count} items need ${expected} bytes, file has ${data.length}`);
  }
  if (data.length > expected) throw new SaveError(`${data.length - expected} bytes after the end of the save`);
  const items: SaveItem[] = [];
  for (let i = 0; i < count; i++) {
    const slot = v.getUint16(pos, true);
    pos += 2;
    if (slot >= INV_SLOTS) throw new SaveError(`item ${i}: slot ${slot} out of range 0..${INV_SLOTS - 1}`);
    items.push({ slot, name: take(ITEM_NAME_SIZE), image: take(ITEM_IMAGE_SIZE) });
  }
  return {
    header,
    music,
    scene,
    varCount,
    varValues,
    items,
    autoincMin: v.getInt16(pos, true),
    autoincMax: v.getInt16(pos + 2, true),
    autoincVar: v.getInt16(pos + 4, true),
    restorePose: v.getUint8(pos + 6),
    jackX: v.getFloat32(pos + 7, true),
    jackY: v.getFloat32(pos + 11, true),
    jackScale: v.getFloat32(pos + 15, true),
    jackDir: v.getInt16(pos + 19, true),
    jackFacing: v.getInt16(pos + 21, true),
  };
}

function checkInt(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SaveError(`${what}: ${value} out of range ${min}..${max}`);
  }
}

function fixed(raw: Uint8Array, size: number, what: string): Uint8Array {
  if (raw.length !== size) throw new SaveError(`${what}: ${raw.length} bytes, expected ${size}`);
  return raw;
}

/**
 * Bytes in the order writes them. Items go out sorted by slot (the writer walks
 * slots 0..83); everything else is written as stored, so parse -> write is exact.
 */
export function writeSave(s: SaveGame): Uint8Array {
  if (s.varValues.length !== VAR_SLOTS) {
    throw new SaveError(`varValues: ${s.varValues.length} values, expected ${VAR_SLOTS}`);
  }
  const items = [...s.items].sort((a, b) => a.slot - b.slot);
  if (items.length > INV_SLOTS) throw new SaveError(`${items.length} items, inventory has ${INV_SLOTS} slots`);
  if (new Set(items.map((it) => it.slot)).size !== items.length) throw new SaveError("two items in the same slot");
  const out = new Uint8Array(EMPTY_SIZE + items.length * ITEM_SIZE);
  const v = new DataView(out.buffer);
  let pos = 0;
  const put = (raw: Uint8Array) => {
    out.set(raw, pos);
    pos += raw.length;
  };
  const u16 = (x: number, what: string) => {
    checkInt(x, 0, 0xffff, what);
    v.setUint16(pos, x, true);
    pos += 2;
  };
  const i16 = (x: number, what: string) => {
    checkInt(x, -0x8000, 0x7fff, what);
    v.setInt16(pos, x, true);
    pos += 2;
  };
  put(fixed(s.header, HEADER_SIZE, "header"));
  put(fixed(s.music, MUSIC_SIZE, "music"));
  put(fixed(s.scene, SCENE_SIZE, "scene"));
  u16(s.varCount, "varCount");
  s.varValues.forEach((x, i) => i16(x, `variable ${i}`));
  u16(items.length, "item count");
  for (const it of items) {
    checkInt(it.slot, 0, INV_SLOTS - 1, "slot");
    u16(it.slot, "slot");
    put(fixed(it.name, ITEM_NAME_SIZE, `item ${it.slot} name`));
    put(fixed(it.image, ITEM_IMAGE_SIZE, `item ${it.slot} image`));
  }
  i16(s.autoincMin, "autoincMin");
  i16(s.autoincMax, "autoincMax");
  i16(s.autoincVar, "autoincVar");
  checkInt(s.restorePose, 0, 0xff, "restorePose");
  v.setUint8(pos++, s.restorePose);
  for (const f of [s.jackX, s.jackY, s.jackScale]) {
    v.setFloat32(pos, f, true);
    pos += 4;
  }
  i16(s.jackDir, "jackDir");
  i16(s.jackFacing, "jackFacing");
  return out;
}

// --- building fields the way the game does -------------------------------------

/** Header: strcpy into the (zeroed) slot-0 buffer. */
export function currentHeader(light = false): Uint8Array {
  return encodeCstr(light ? LIGHT_HEADER : NORMAL_HEADER, HEADER_SIZE);
}

/**
 * Header of Save_CopyTemp: "Jack Orlando" + NUL over the buffer left by the last
 * (always the tempjs written at scene start), so the version byte survives.
 */
export function copyHeader(previous: Uint8Array): Uint8Array {
  fixed(previous, HEADER_SIZE, "header");
  const out = previous.slice();
  out.set(encodeCstr(GAME_TITLE, GAME_TITLE.length + 1), 0);
  return out;
}

/** Music field: menu music TR02* is saved as TR17-22.PMS. */
export function savedMusic(current: string): Uint8Array {
  const raw = encodeCstr(current, MUSIC_SIZE);
  const menu = raw[0] === 0x54 && raw[1] === 0x52 && raw[2] === 0x30 && raw[3] === 0x32; // "TR02"
  return menu ? encodeCstr(MENU_MUSIC_REPLACEMENT, MUSIC_SIZE) : raw;
}

/** 0xdd4-byte inventory image: u16 w, u16 h, RGB565 pixels, zero padding. */
export function itemImage(width: number, height: number, pixels: Uint8Array): Uint8Array {
  if (width * height > ITEM_PIXELS_MAX) {
    throw new SaveError(`${width}x${height} image has more than ${ITEM_PIXELS_MAX} pixels`);
  }
  if (pixels.length !== width * height * 2) throw new SaveError(`${pixels.length} pixel bytes for ${width}x${height}`);
  const out = new Uint8Array(ITEM_IMAGE_SIZE);
  const v = new DataView(out.buffer);
  v.setUint16(0, width, true);
  v.setUint16(2, height, true);
  out.set(pixels, 4);
  return out;
}

/** What Save_CopyTemp writes: tempjs with its header replaced by copyHeader(). */
export function copyTemp(temp: Uint8Array, previousHeader?: Uint8Array): Uint8Array {
  if (temp.length < HEADER_SIZE) throw new SaveError("tempjs shorter than its header");
  const out = temp.slice();
  out.set(copyHeader(previousHeader ?? temp.subarray(0, HEADER_SIZE)), 0);
  return out;
}

/** Whether accepts the file in this game version (it rejects silently otherwise). */
export function acceptedBy(s: SaveGame, light: boolean): boolean {
  return isLight(s) === light;
}

// --- checks (same rules as verify() in the external checker) ---------------------------

export const PATTERNS = ["*.SAV", "*.SVL", "TEMPJS", "JACKSAVE.*"];

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function verifySave(name: string, data: Uint8Array): string[] {
  let s: SaveGame;
  try {
    s = parseSave(data);
  } catch (e) {
    if (e instanceof SaveError) return [e.message];
    throw e;
  }
  const problems: string[] = [];
  if (!equalBytes(writeSave(s), data)) problems.push("writeSave(parseSave(data)) differs from the file");
  if (s.header.indexOf(0) < 0) problems.push("header has no NUL");
  const upper = name.toUpperCase();
  // tempjs / Jacksave.00a carry the version byte of the mode that wrote them (no extension to match)
  if ((upper.endsWith(".SAV") || upper.endsWith(".SVL")) && upper.endsWith(".SVL") !== isLight(s)) {
    problems.push(`extension does not match version byte 0x${s.header[VERSION_BYTE].toString(16)}`);
  }
  const text = headerText(s);
  if (text.startsWith(GAME_TITLE)) {
    if (![GAME_TITLE, NORMAL_HEADER, LIGHT_HEADER].includes(text)) problems.push(`unknown header "${text}"`);
    if (isCopy(s) && !equalBytes(s.header.subarray(13), currentHeader(isLight(s)).subarray(13))) {
      problems.push("copy header: rest differs from the current header");
    }
    const want = isCopy(s) || upper === TEMP_NAME.toUpperCase() ? 0 : 1;
    if (s.restorePose !== want) problems.push(`restore_pose ${s.restorePose}, expected ${want}`);
  }
  if (!musicName(s).toUpperCase().endsWith(".PMS")) problems.push(`music "${musicName(s)}" is not a .PMS`);
  if (musicName(s).startsWith("TR02")) problems.push("menu music TR02 saved (the writer replaces it)");
  if (!sceneName(s).toUpperCase().endsWith(".CCG")) problems.push(`scene "${sceneName(s)}" is not a .CCG`);
  if (!(s.varCount > 0 && s.varCount <= VAR_SLOTS)) problems.push(`var_count ${s.varCount}`);
  else if (s.varValues.slice(s.varCount).some((x) => x !== 0)) problems.push("nonzero values past var_count");
  const slots = s.items.map((it) => it.slot);
  if (slots.some((x, i) => i > 0 && x <= slots[i - 1])) problems.push(`item slots not strictly increasing: ${slots}`);
  for (const it of s.items) {
    if (!itemName(it) || it.name.indexOf(0) < 0) problems.push(`slot ${it.slot}: bad name`);
    const { width, height } = itemSize(it);
    if (!(width > 0 && height > 0 && width * height <= ITEM_PIXELS_MAX)) {
      problems.push(`slot ${it.slot}: image ${width}x${height}`);
    }
  }
  if (!(s.autoincVar === -1 || (s.autoincVar >= 0 && s.autoincVar < s.varCount))) {
    problems.push(`autoinc_var ${s.autoincVar}`);
  }
  if (s.restorePose !== 0 && s.restorePose !== 1) problems.push(`restore_pose ${s.restorePose}`);
  if (!(s.jackDir >= 0 && s.jackDir <= 4)) problems.push(`jack_dir ${s.jackDir}`);
  if (s.jackFacing !== 1 && s.jackFacing !== -1) problems.push(`jack_facing ${s.jackFacing}`);
  if (!(s.jackScale > 0 && s.jackScale <= 1)) problems.push(`jack_scale ${s.jackScale}`);
  return problems;
}
