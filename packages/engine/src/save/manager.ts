// Save manager: ties the engine state, the SAVEGAME directory (virtual, IndexedDB), the system file windows and the slots.
// No DOM, no timing; the host calls it on F2/F3/F5/F6, scene start and from the menu.
import { TEMP_NAME, SaveError } from "../formats/save";
import { copyTemp } from "../formats/save";
import type { FilePicker } from "./files";
import { AUTOSAVE_NAME_PL, QUICK_NAME_PL, autosaveFileName, pickNewestQuick, quickSaveName } from "./quick";
import { SlotStore } from "./slots";
import { buildTemp, readSave, serializeSave, type ReadResult, type SaveKind, type SaveState } from "./state";
import type { SaveStore } from "./store";

export interface SaveManagerOptions {
  /** the virtual SAVEGAME directory */
  store: SaveStore;
  /** legacy slots (own store); without it the slot methods throw */
  slots?: SaveStore;
  picker: FilePicker;
  light: boolean;
  now?: () => Date;
  /** `g_quickSaveName`, `g_autosaveName` (language dependent) */
  quickName?: string;
  autosaveName?: string;
}

export interface QuickSaveResult {
  name: string;
  kind: SaveKind;
}

export class SaveManager {
  /** `tempjs`: the state at scene start, kept in memory and in the store */
  temp: Uint8Array | null = null;

  constructor(private readonly o: SaveManagerOptions) {}

  private get quickBase() {
    return this.o.quickName ?? QUICK_NAME_PL;
  }

  /** Scene start (`Game_Run`): writes `tempjs`. Call before PRE/INIT of the scene run. */
  async sceneStart(state: SaveState): Promise<void> {
    this.temp = buildTemp(state);
    await this.o.store.write(TEMP_NAME, this.temp);
  }

  /** Autosave (end of the first frame of a scene): always a copy of `tempjs`. */
  async autosave(): Promise<string | null> {
    if (!this.temp) return null;
    const name = autosaveFileName(this.o.light, this.o.autosaveName ?? AUTOSAVE_NAME_PL);
    await this.o.store.write(name, copyTemp(this.temp));
    return name;
  }

  /** F5: `Szybki Zapis RRRR-MM-DD GG-MM.sav`. The item in hand goes to the coat first (deviation, see README). */
  async quickSave(state: SaveState): Promise<QuickSaveResult> {
    const { bytes, kind } = serializeSave(state, this.temp);
    const name = quickSaveName((this.o.now ?? (() => new Date()))(), this.o.light, this.quickBase);
    await this.o.store.write(name, bytes);
    return { name, kind };
  }

  /** F6: the newest quick save by the original's date rule. `null` = no file (nothing happens, no message). */
  async quickLoad(): Promise<ReadResult | null> {
    const name = pickNewestQuick(await this.o.store.list(), this.quickBase);
    const data = name ? await this.o.store.read(name) : null;
    return data ? readSave(data, this.o.light) : null;
  }

  /** F2 / menu "Save" in the default mode. `false` = the window was cancelled. */
  async saveToFile(state: SaveState, suggestedName = "Jack Orlando"): Promise<boolean> {
    const { bytes } = serializeSave(state, this.temp);
    return this.o.picker.save(bytes, suggestedName, this.o.light);
  }

  /** F3 / menu "Load". `null` = cancelled. A file of the other version is refused (`reason: "version"`). */
  async loadFromFile(): Promise<ReadResult | null> {
    const f = await this.o.picker.open(this.o.light);
    return f ? readSave(f.data, this.o.light) : null;
  }

  private slotStore(): SlotStore {
    if (!this.o.slots) throw new SaveError("slot mode without a slot store");
    return new SlotStore(this.o.slots, this.o.light);
  }

  async slotDescriptions(): Promise<(string | null)[]> {
    return this.slotStore().descriptions();
  }

  /** Slot mode: same data rules as F2 (current state or copy of tempjs), description into the header. */
  async saveToSlot(state: SaveState, slot: number, description: string): Promise<SaveKind> {
    const { bytes, kind } = serializeSave(state, this.temp);
    await this.slotStore().save(slot, bytes, description);
    return kind;
  }

  async loadFromSlot(slot: number): Promise<ReadResult | null> {
    const data = await this.slotStore().read(slot);
    // the header of a slot is its description, so the original's version byte is not checked
    return data ? readSave(data, this.o.light, false) : null;
  }
}
