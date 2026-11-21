// Single-line text field of the GUI (type 1: Gui_AddTextField / Gui_EditTextField,
// section 5.1): characters up to a limit, Backspace, a blinking cursor, Enter confirms, Esc aborts. Not in the components.
import { encodeMazovia } from "../dialog/caption";
import { ENCODABLE } from "./mazovia";

/** The description lives in the 0x50-byte header with its NUL. */
export const DESCRIPTION_MAX = 79;
/** Blink of the `_` cursor, ms: measured on a 30 fps recording of an older version (~3 frames on, ~4 off; approximate). */
export const BLINK_ON_MS = 100;
export const BLINK_OFF_MS = 133;

export type FieldResult = "none" | "enter" | "escape";

export class TextField {
  text: string;
  private elapsed = 0;

  constructor(
    initial = "",
    readonly max = DESCRIPTION_MAX,
  ) {
    this.text = [...initial].slice(0, max).join("");
  }

  /** The cursor is visible at the start of every period; typing restarts the period. */
  get cursorOn(): boolean {
    return this.elapsed % (BLINK_ON_MS + BLINK_OFF_MS) < BLINK_ON_MS;
  }

  tick(ms: number): void {
    this.elapsed += ms;
  }

  /** `key` = `KeyboardEvent.key`. Characters the font/Mazovia cannot show are ignored. */
  keyDown(key: string): FieldResult {
    if (key === "Enter") return "enter";
    if (key === "Escape") return "escape";
    if (key === "Backspace") {
      this.text = [...this.text].slice(0, -1).join("");
      this.elapsed = 0;
    } else if ([...key].length === 1 && ENCODABLE.has(key) && [...this.text].length < this.max) {
      this.text += key;
      this.elapsed = 0;
    }
    return "none";
  }

  /** What is drawn: the text plus `_` while the cursor is on. */
  display(): Uint8Array {
    return encodeMazovia(this.text + (this.cursorOn ? "_" : ""));
  }
}
