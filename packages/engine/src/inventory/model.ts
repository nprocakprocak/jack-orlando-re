// Inventory model (the coat): 84 slots, two regions chosen by MARZECZY, the item in hand.
import type { Surface16 } from "../render/surface";

/** Number of slots (`0x54`) and the split point `g_invSplit00503b60` (region A = 0..65, region B = 66..83). */
export const SLOT_COUNT = 84;
export const INV_SPLIT = 66;
/** Item names live in 14-byte slots (13 characters + NUL); the original does not check, we reject longer ones. */
export const NAME_MAX = 13;

export interface Item {
  /** name of the scene object the item came from (`KLUCZYK.BM`); the only identifier */
  name: string;
  /** copy of the object's image, RGB565, key 0 = transparent */
  image: Surface16;
}

export interface SavedSlot {
  slot: number;
  name: string;
  image: Surface16;
}

export class InventoryError extends Error {}

export class Inventory {
  readonly slots: (Item | null)[] = new Array(SLOT_COUNT).fill(null);
  /** The item on the cursor (`g_cursorMode == 5`: `g_heldItemName` / `g_heldItemImage`). */
  held: Item | null = null;
  /**
   * The item that was in hand when a combine macro started: the cursor is empty again but the macro's
   * `NOHAVETOOL <held name>` still finds and removes it (`Script_ExecStep` case 0x46 compares with `g_heldItemName`).
   */
  limbo: Item | null = null;
  /** Variable MARZECZY: ≠ 0 = region A (0..65, scrollable), 0 = region B (66..83; Jack in the uniform). Start value 1. */
  marzeczy = 1;
  /** `g_coatScrollRow008f68d4` (region A only): first visible row, 0..16. Lasts from the start of the game, not saved. */
  scrollRow = 0;

  /** Slot range of the active region: [first, end). */
  region(): [number, number] {
    return this.marzeczy !== 0 ? [0, INV_SPLIT] : [INV_SPLIT, SLOT_COUNT];
  }

  private checkName(name: string): void {
    if (name.length > NAME_MAX) throw new InventoryError(`item name '${name}' longer than ${NAME_MAX} characters`);
  }

  /** First free slot of the active region or -1. */
  freeSlot(): number {
    const [a, b] = this.region();
    for (let i = a; i < b; i++) if (!this.slots[i]) return i;
    return -1;
  }

  /** Inventory_Add (HAVETOOL): first free slot of the active region; full = nothing happens. No duplicate check. */
  add(name: string, image: Surface16): number {
    this.checkName(name);
    const i = this.freeSlot();
    if (i >= 0) this.slots[i] = { name, image };
    return i;
  }

  /** Inventory_Has (ITEMPRESENT): all 84 slots by name; the item in hand does not count. */
  has(name: string): boolean {
    return this.slots.some((s) => s?.name === name);
  }

  /** NOHAVETOOL: the item in hand (or the one a started macro still "holds") with that name, else the first slot with it. */
  remove(name: string): boolean {
    if (this.held?.name === name) {
      this.held = null;
      return true;
    }
    if (this.limbo?.name === name) {
      this.limbo = null;
      return true;
    }
    const i = this.slots.findIndex((s) => s?.name === name);
    if (i < 0) return false;
    this.slots[i] = null;
    return true;
  }

  /** NOHAVE (`Cursor_ResetMode`): the item in hand is gone, not returned to the coat. */
  noHave(): void {
    this.held = null;
    this.limbo = null;
  }

  /** TAKE: the item goes to the hand; what was in the hand goes back to the coat first (`Item_PutBackToBar`). */
  take(name: string, image: Surface16): void {
    this.checkName(name);
    if (this.held) this.putBack();
    this.held = { name, image };
    this.limbo = null;
  }

  /** Item_PutBackToBar (MOUSETOTOOL, click on empty scene space): hand → first free slot (none: lost), hand empty. */
  putBack(): number {
    const h = this.held;
    this.held = null;
    if (!h) return -1;
    const i = this.freeSlot();
    if (i >= 0) this.slots[i] = h;
    return i;
  }

  /** Pull from the coat into the hand (click on an occupied cell, hand empty). */
  pull(slot: number): boolean {
    const s = this.slots[slot];
    if (!s || this.held) return false;
    this.held = s;
    this.slots[slot] = null;
    this.limbo = null;
    return true;
  }

  /** Put the hand into a specific empty slot (any free slot, not only the first). */
  placeAt(slot: number): boolean {
    if (!this.held || slot < 0 || slot >= SLOT_COUNT || this.slots[slot]) return false;
    this.slots[slot] = this.held;
    this.held = null;
    return true;
  }

  /** EXTRA 11 (SC105, leaving in the uniform): every occupied slot of 66..83 moves to the first free slot of 0..65. */
  moveBigRegion(): void {
    for (let i = INV_SPLIT; i < SLOT_COUNT; i++) {
      const s = this.slots[i];
      if (!s) continue;
      let j = 0;
      while (j < INV_SPLIT && this.slots[j]) j++;
      if (j >= INV_SPLIT) break;
      this.slots[j] = s;
      this.slots[i] = null;
    }
  }

  /** Inventory_Clear (new game). The scroll position is a plain global and stays; the hand is emptied. */
  clear(): void {
    this.slots.fill(null);
    this.held = null;
    this.limbo = null;
  }

  count(): number {
    return this.slots.filter(Boolean).length;
  }

  /** Save file content: occupied slots with index, name and image. The hand and the scroll row are not saved. */
  snapshot(): SavedSlot[] {
    const out: SavedSlot[] = [];
    this.slots.forEach((s, slot) => s && out.push({ slot, name: s.name, image: s.image }));
    return out;
  }

  /** Load: clears all 84, fills the saved ones; hand empty, scroll row 0. */
  restore(saved: readonly SavedSlot[]): void {
    this.clear();
    for (const s of saved) {
      if (s.slot < 0 || s.slot >= SLOT_COUNT) throw new InventoryError(`saved slot ${s.slot} out of range`);
      this.checkName(s.name);
      this.slots[s.slot] = { name: s.name, image: s.image };
    }
    this.scrollRow = 0;
  }
}
