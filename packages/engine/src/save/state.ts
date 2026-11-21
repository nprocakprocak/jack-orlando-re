// Engine state <-> .SAV., writer / reader / copy.
// Pure logic, no DOM. The host fills a `SaveState` from the running game and applies a `LoadedState` back.
import { viewOf } from "../formats/bytes";
import {
  ITEM_PIXELS_MAX,
  SaveError,
  VAR_SLOTS,
  acceptedBy,
  copyTemp,
  currentHeader,
  cstr,
  encodeCstr,
  itemImage,
  itemName,
  itemSize,
  musicName,
  parseSave,
  savedMusic,
  sceneName,
  writeSave,
  type SaveGame,
  type SaveItem,
} from "../formats/save";
import type { Inventory, SavedSlot } from "../inventory/model";
import type { Surface16 } from "../render/surface";
import { createSurface } from "../render/surface";

/** Variables in VARIABLE.ALL of the Director's Cut: every save has exactly this many. */
export const VAR_COUNT_DC = 247;

/** The save tail of the AUTOINCRANGE clock (`AutoIncClock` in play/host.ts); its tick counter is not saved. */
export interface AutoInc {
  /** value after wrap-around */
  min: number;
  max: number;
  /** variable index, -1 = off */
  variable: number;
}

/** The pose of Jack in the file tail (`g_jackSaved*`, refreshed every frame while the player is not locked). */
export interface JackPose {
  x: number;
  y: number;
  scale: number;
  /** 0..4 */
  dir: number;
  /** 1 / -1 */
  facing: number;
}

/** What the host keeps for the save. `vars` has 500 slots like `g_varValues`. */
export interface SaveState {
  scene: string;
  /** current music file, e.g. `TR17-22.PMS` (menu music TR02* is stored as TR17-22.PMS) */
  music: string;
  vars: ArrayLike<number>;
  varCount: number;
  inventory: Inventory;
  /** easy version: `.SVL` and the "light ver" header */
  light: boolean;
  autoInc: AutoInc;
  pose: JackPose;
  /** `g_sceneSaveable`: false in scenes with SAVEABLE 0 (and SC000C, SC002, SC005B in some states) */
  sceneSaveable: boolean;
  /** `g_jackPlaced`: Jack has been drawn on the scene */
  jackPlaced: boolean;
}

/** Item image (RGB565 keyed 0) -> the 0xdd4 B buffer. Images over 1768 pixels do not fit (the game never makes them). */
export function surfaceToItemImage(s: Surface16): Uint8Array {
  const px = new Uint8Array(s.width * s.height * 2);
  const v = new DataView(px.buffer);
  const stride = s.stride ?? s.width;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) v.setUint16((y * s.width + x) * 2, s.pixels[y * stride + x], true);
  }
  return itemImage(s.width, s.height, px);
}

export function itemImageToSurface(it: SaveItem): Surface16 {
  const { width, height } = itemSize(it);
  if (width * height > ITEM_PIXELS_MAX) throw new SaveError(`${width}x${height} image does not fit in a slot`);
  const s = createSurface(width, height);
  const v = viewOf(it.image);
  for (let i = 0; i < width * height; i++) s.pixels[i] = v.getUint16(4 + i * 2, true);
  return s;
}

/** Hand -> coat first (Item_PutBackToBar, as F2 does). Deviation from F5 of the original, see README. */
export function putHandAway(inv: Inventory): void {
  if (inv.held) inv.putBack();
}

/** Save fields of the *current* state (`Save_WriteState(path, 0)`): pose byte 1. */
export function buildSave(s: SaveState): SaveGame {
  if (s.varCount !== VAR_COUNT_DC)
    throw new SaveError(`varCount ${s.varCount}, the game has ${VAR_COUNT_DC} variables`);
  if (s.vars.length < VAR_SLOTS) throw new SaveError(`vars: ${s.vars.length} slots, need ${VAR_SLOTS}`);
  const items: SaveItem[] = s.inventory.snapshot().map((it: SavedSlot) => ({
    slot: it.slot,
    name: encodeCstr(it.name, 14),
    image: surfaceToItemImage(it.image),
  }));
  return {
    header: currentHeader(s.light),
    music: savedMusic(s.music),
    scene: encodeCstr(s.scene, 15),
    varCount: s.varCount,
    varValues: Array.from({ length: VAR_SLOTS }, (_, i) => (i < s.varCount ? s.vars[i] : 0)),
    items,
    autoincMin: s.autoInc.min,
    autoincMax: s.autoInc.max,
    autoincVar: s.autoInc.variable,
    restorePose: 1,
    jackX: s.pose.x,
    jackY: s.pose.y,
    jackScale: s.pose.scale,
    jackDir: s.pose.dir,
    jackFacing: s.pose.facing,
  };
}

/**
 * `tempjs` (`Save_WriteState(path, 1)` at scene start): the same fields, pose byte 0. The host calls it when a scene starts
 * (before PRE/INIT run), and keeps the bytes for scenes where saving is blocked.
 */
export function buildTemp(s: SaveState): Uint8Array {
  return writeSave({ ...buildSave(s), restorePose: 0 });
}

export type SaveKind = "current" | "copy";

export interface SaveBytes {
  bytes: Uint8Array;
  kind: SaveKind;
}

/**
 * What F2 / menu / F5 write: the current state when `sceneSaveable && jackPlaced`,
 * otherwise a copy of `tempjs` (`temp`, from `buildTemp`). Without `temp` the current state is written anyway.
 *
 * Deviation (user decision 2026-11-03): the item in hand goes back to the coat *first*, for every kind of save,
 * F5 included (the original F5 does not, and the item is lost on load). The file stays in the original format.
 */
export function serializeSave(s: SaveState, temp: Uint8Array | null): SaveBytes {
  putHandAway(s.inventory);
  if ((!s.sceneSaveable || !s.jackPlaced) && temp) return { bytes: copyTemp(temp), kind: "copy" };
  return { bytes: writeSave(buildSave(s)), kind: "current" };
}

/** A save read back into engine terms. */
export interface LoadedState {
  scene: string;
  music: string;
  /** values of VARIABLE.ALL indexes (500 slots, as stored) */
  vars: number[];
  /** `var_count` of the file; 225 in `Jacksave.00a` */
  varCount: number;
  inventory: SavedSlot[];
  light: boolean;
  autoInc: AutoInc;
  /** true = scene start puts Jack at `pose` */
  restorePose: boolean;
  pose: JackPose;
  /** description (the 0x50-byte header, Mazovia-decoded up to NUL) */
  header: string;
}

export type ReadResult =
  { ok: true; state: LoadedState } | { ok: false; reason: "version" | "format"; message: string };

/**
 * `Save_LoadState`: a file of the other version (easy / normal) is refused silently (`reason: "version"`);
 * a damaged file is an error here (the original reads whatever it can). `checkVersion: false` is for slots, which
 * hold their own description in the header (see slots.ts).
 */
export function readSave(data: Uint8Array, light: boolean, checkVersion = true): ReadResult {
  let g: SaveGame;
  try {
    g = parseSave(data);
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, reason: "format", message: e.message };
    throw e;
  }
  if (checkVersion && !acceptedBy(g, light))
    return { ok: false, reason: "version", message: "save of the other game version" };
  return {
    ok: true,
    state: {
      scene: sceneName(g),
      music: musicName(g),
      vars: g.varValues.slice(),
      varCount: g.varCount,
      inventory: g.items.map((it) => ({
        slot: it.slot,
        name: itemName(it),
        image: itemImageToSurface(it),
      })),
      light,
      autoInc: { min: g.autoincMin, max: g.autoincMax, variable: g.autoincVar },
      restorePose: g.restorePose === 1,
      pose: { x: g.jackX, y: g.jackY, scale: g.jackScale, dir: g.jackDir, facing: g.jackFacing },
      header: cstr(g.header),
    },
  };
}

/**
 * Variable values after a load. The original overwrites `g_varCount` with the file's number (225 in the old
 * `Jacksave.00a`, which hides the last 22 variables); the engine keeps all `defaults.length` variables and fills
 * those the file does not have from `defaults` (VARIABLE.ALL start values).
 */
export function loadedVars(l: LoadedState, defaults: readonly number[]): number[] {
  const out = l.vars.slice();
  for (let i = l.varCount; i < defaults.length; i++) out[i] = defaults[i];
  return out;
}

/** Variables the engine reads out of a load (by VARIABLE.ALL name): uniform (JACKISWOJ), weapon (GUN), LAST, MARZECZY. */
export interface NamedVars {
  jackIsWoj: number;
  gun: number;
  last: number;
  marzeczy: number;
}

export function namedVars(vars: ArrayLike<number>, names: readonly string[]): NamedVars {
  const at = (n: string) => {
    const i = names.indexOf(n);
    return i >= 0 ? vars[i] : 0;
  };
  return { jackIsWoj: at("JACKISWOJ"), gun: at("GUN"), last: at("LAST"), marzeczy: at("MARZECZY") };
}

/** Puts the loaded coat into `inv` (hand empty, scroll row 0 — `Inventory.restore`) and sets MARZECZY. */
export function applyInventory(inv: Inventory, l: LoadedState, marzeczy?: number): void {
  inv.restore(l.inventory);
  if (marzeczy !== undefined) inv.marzeczy = marzeczy;
}
