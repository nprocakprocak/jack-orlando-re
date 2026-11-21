// Legacy slot mode: ten slots in browser storage and the slot windows built from the GUI components.
// Load window = the dead ; save window = reconstruction after the user's screenshots
// of an older version (5.4). What is code and what is reconstruction: README.md.
import { LIGHT_HEADER, NORMAL_HEADER, HEADER_SIZE, VERSION_BYTE, cstr, encodeCstr, parseSave, writeSave } from "../formats/save";
import { COLOR_BLUE, COLOR_OUTLINE_BLACK, COLOR_WHITE, COLOR_YELLOW, centerOffset, copyRect, drawButtonFrame, drawText } from "../gui/draw";
import type { GuiEvent, WindowAssets } from "../gui/window";
import { GuiWindow } from "../gui/window";
import type { Surface16 } from "../render/surface";
import type { SaveStore } from "./store";
import { DESCRIPTION_MAX, TextField } from "./textfield";

// Save-slot captions.

export interface SlotTexts {
  /** `g_guiStrings[7]` */
  loadTitle: string;
  /** `g_guiStrings[8]` */
  saveTitle: string;
  /** `g_guiStrings[36]` */
  newGame: string;
  /** `g_guiStrings[19]` */
  cancel: string;
  /** label of an empty slot; angle brackets and '[' are blank glyphs in both fonts */
  empty: string;
}

export const SLOT_TEXTS_PL: SlotTexts = {
  loadTitle: "Którą grę chcesz załadować?",
  saveTitle: "Wybierz pozycję do zapisu:",
  newGame: "Rozpocznij nową grę",
  cancel: "Anuluj",
  empty: "(puste)",
};

export const SLOT_COUNT = 10;
/** Window 460 x 400, slot buttons 386 x 24 at x = 36, y = 60 + i * 28. */
export const WIN_W = 460;
export const WIN_H = 400;
export const SLOT_X = 36;
export const SLOT_Y0 = 60;
export const SLOT_STEP = 28;
export const SLOT_W = 386;
export const SLOT_H = 24;

// --- storage ---------------------------------------------------------------------------------

export const slotFileName = (slot: number, light: boolean) => `slot${slot}.${light ? "svl" : "sav"}`;

/** Description -> 0x50-byte header; the easy version keeps `'l'` at byte 15 so the original also accepts the file. */
export function slotHeader(description: string, light: boolean): Uint8Array {
  const header = encodeCstr(description, HEADER_SIZE);
  if (light && [...description].length < VERSION_BYTE + 1) header[VERSION_BYTE] = 0x6c;
  return header;
}

/** A slot is a normal `.SAV` file; its description is the header (what the older versions listed on the buttons). */
export class SlotStore {
  constructor(
    private readonly store: SaveStore,
    private readonly light: boolean,
  ) {}

  /** Descriptions of the 10 slots; `null` = empty slot. */
  async descriptions(): Promise<(string | null)[]> {
    const out: (string | null)[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const data = await this.store.read(slotFileName(i, this.light));
      out.push(data && data.length >= HEADER_SIZE ? cstr(data.subarray(0, HEADER_SIZE)) : null);
    }
    return out;
  }

  /** `bytes` = a save file (from `serializeSave`); the header is replaced by the description. Empty text: the scene name. */
  async save(slot: number, bytes: Uint8Array, description: string): Promise<void> {
    if (!(slot >= 0 && slot < SLOT_COUNT)) throw new RangeError(`slot ${slot}`);
    const g = parseSave(bytes);
    const text = description.trim() || cstr(g.scene).replace(/\.CCG$/i, "");
    g.header = slotHeader([...text].slice(0, DESCRIPTION_MAX).join(""), this.light);
    await this.store.write(slotFileName(slot, this.light), writeSave(g));
  }

  async read(slot: number): Promise<Uint8Array | null> {
    return this.store.read(slotFileName(slot, this.light));
  }
}

export { NORMAL_HEADER, LIGHT_HEADER };

// --- window ----------------------------------------------------------------------------------

export type SlotEvent =
  | { kind: "load"; slot: number }
  | { kind: "save"; slot: number; description: string }
  | { kind: "newGame" }
  | { kind: "cancel" };

const slotName = (i: number) => `slot${i}`;

/**
 * The slot window. Load: a click on a slot returns `load` (an empty slot does nothing — hypothesis). Save: a click presses
 * the slot and starts editing its description (blinking `_`), Enter saves and the window **stays open** on the list, Esc
 * abandons the editing (the old description stays), a second Esc / "Anuluj" closes; no confirmation (user decisions, README).
 */
export class SlotWindow {
  private win!: GuiWindow;
  private descriptions: (string | null)[];
  private editing: { slot: number; field: TextField } | null = null;

  constructor(
    private readonly assets: WindowAssets,
    private readonly scene: Surface16,
    readonly mode: "load" | "save",
    descriptions: readonly (string | null)[],
    private readonly texts: SlotTexts = SLOT_TEXTS_PL,
  ) {
    this.descriptions = [...descriptions];
    this.build();
  }

  private build(): void {
    const { assets, scene, mode, texts, descriptions } = this;
    const w = (this.win = new GuiWindow(assets, scene, 0, 0, WIN_W, WIN_H, true));
    w.addLabel(mode === "save" ? texts.saveTitle : texts.loadTitle, true, 0, 16, COLOR_OUTLINE_BLACK, COLOR_YELLOW);
    for (let i = 0; i < SLOT_COUNT; i++) {
      w.addButton(slotName(i), descriptions[i] ?? texts.empty, SLOT_X, SLOT_Y0 + i * SLOT_STEP, SLOT_W, SLOT_H, false, false);
    }
    if (mode === "load") w.addButton("NewGame", texts.newGame, 20, 350, 220, 32);
    w.addButton("Cancel", texts.cancel, 340, 350, 100, 32);
  }

  /** New slot descriptions (e.g. after a save, from the store); the window stays open and shows them. */
  setDescriptions(descriptions: readonly (string | null)[]): void {
    this.descriptions = [...descriptions];
    this.build();
  }

  get editingSlot(): number {
    return this.editing ? this.editing.slot : -1;
  }

  get editText(): string | null {
    return this.editing ? this.editing.field.text : null;
  }

  private handle(events: GuiEvent[]): SlotEvent[] {
    const out: SlotEvent[] = [];
    for (const e of events) {
      if (e.kind === "escape") {
        if (this.editing) this.editing = null;
        else out.push({ kind: "cancel" });
      } else if (e.kind === "press") this.onPress(e.name, out);
    }
    return out;
  }

  private onPress(name: string, out: SlotEvent[]): void {
    if (name === "Cancel") out.push({ kind: "cancel" });
    else if (name === "NewGame") out.push({ kind: "newGame" });
    else if (name.startsWith("slot")) this.onSlot(Number(name.slice(4)), out);
  }

  private onSlot(slot: number, out: SlotEvent[]): void {
    if (this.mode === "load") {
      if (this.descriptions[slot] !== null) out.push({ kind: "load", slot });
    } else if (this.editing?.slot !== slot) {
      this.editing = { slot, field: new TextField(this.descriptions[slot] ?? "") };
    }
  }

  pointerDown(x: number, y: number): SlotEvent[] {
    return this.handle(this.win.pointerDown(x, y));
  }
  pointerMove(x: number, y: number): SlotEvent[] {
    return this.handle(this.win.pointerMove(x, y));
  }
  pointerUp(x: number, y: number): SlotEvent[] {
    return this.handle(this.win.pointerUp(x, y));
  }

  keyDown(key: string): SlotEvent[] {
    if (this.editing) {
      if (key === "Escape") {
        this.editing = null;
        return [];
      }
      const r = this.editing.field.keyDown(key);
      if (r === "enter") {
        const { slot, field } = this.editing;
        this.editing = null;
        // the window stays open on the list (user decision); the button shows the new description
        this.descriptions[slot] = field.text.trim() ? field.text : this.descriptions[slot];
        this.build();
        return [{ kind: "save", slot, description: field.text }];
      }
      return [];
    }
    return this.handle(this.win.keyDown(key));
  }

  keyUp(key: string): SlotEvent[] {
    return this.editing ? [] : this.handle(this.win.keyUp(key));
  }

  tick(ms: number): void {
    this.editing?.field.tick(ms);
  }

  draw(screen: Surface16): void {
    this.win.draw(screen);
    const e = this.editing;
    if (!e) return;
    const x = this.win.x + SLOT_X;
    const y = this.win.y + SLOT_Y0 + e.slot * SLOT_STEP;
    copyRect(this.scene, screen, x, y, SLOT_W, SLOT_H);
    drawButtonFrame(screen, x, y, SLOT_W, SLOT_H, true);
    // pressed button text: no shadow, shifted by 1 (GuiWindow.render)
    drawText(screen, this.assets.fontSmall, e.field.display(), x + 8 + 1, y + centerOffset(SLOT_H, 16) + 1 + 1, COLOR_BLUE, COLOR_WHITE);
  }
}
