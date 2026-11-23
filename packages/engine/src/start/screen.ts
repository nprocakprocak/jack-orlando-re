// The start screen: a window drawn with the in-game menu components (frame, buttons,
// the Resource.pak fonts) over a scene picture. Not a screen of the original (it starts straight into the intro;
// the easy version is chosen in the launcher JackStart.exe). No DOM: the host feeds the input.
import type { Surface16 } from "../render/surface";
import { blitCopy, createSurface } from "../render/surface";
import { darkenRect } from "../gui/darken";
import { COLOR_BLUE, COLOR_OUTLINE_BLACK, COLOR_WHITE, COLOR_YELLOW, centerOffset } from "../gui/draw";
import type { GuiTexts } from "../gui/texts";
import { GuiWindow, SCREEN_H, SCREEN_W, type WindowAssets } from "../gui/window";
import { MODE_PENDING, cycleMode, type GameModes, type ModeKey } from "./modes";

/** What the screen shows and edits.: the bullet row is gone (BulletOnOff stays in "Opcje gry" only). */
export interface StartState {
  modes: GameModes;
  pauseOnBlur: boolean;
}

export type RowKey = ModeKey | "pauseOnBlur";

export type StartAction =
  | { type: "start" }
  /** a value changed; `state` is the new state to persist */
  | { type: "change"; key: RowKey; state: StartState };

export interface StartTexts {
  /** window title; "/2" sets the letter spacing */
  title: string;
  /** the big button; not `newGame` of the F4 menu (user request) */
  start: string;
  inventory: string;
  coat: string;
  bar: string;
  easy: string;
  saves: string;
  saveFiles: string;
  saveSlots: string;
  pauseOnBlur: string;
  pendingNote: string;
  /** small line under the Start button */
  fullscreenHint: string;
}

export const START_TEXTS_PL: StartTexts = {
  title: "/2- Wybierz tryb gry -",
  start: "Start",
  inventory: "Ekwipunek",
  coat: "Płaszcz",
  bar: "Górna belka",
  easy: "Wersja łatwa",
  saves: "Zapis gry",
  saveFiles: "Pliki na dysku",
  saveSlots: "Sloty w grze",
  pauseOnBlur: "Pauza poza oknem gry",
  pendingNote: "Przyciemnione: jeszcze nie działa w grze",
  fullscreenHint: "Użyj F11 by przełączać tryb pełnoekranowy",
};

export const WINDOW_W = 560;
export const WINDOW_H = 356;
export const ROW_Y0 = 62;
export const ROW_DY = 44;
export const VALUE_X = 360;
export const VALUE_W = 180;
export const VALUE_H = 32;
export const LABEL_X = 15;
export const START_W = 370;
export const START_H = 33;
export const START_Y = 256;
/** small-font line under the Start button */
export const HINT_Y = START_Y + START_H + 8;
/** darkening of a pending row (0..32, the window interior uses 16) */
export const PENDING_DARKEN = 20;
/** darkening of the whole background under the window (0..32) **[engine, user requests 2026-11-09, 2026-11-15, 2026-11-16]**:
 * SETUP_OK.BM blended too much with the translucent window; the window snapshots the darkened background, so its interior is
 * darkened by this plus its own 16 */
export const BACKGROUND_DARKEN = 14;

interface Row {
  key: RowKey;
  label: string;
  value: string;
  pending: string | null;
}

export interface StartScreenOptions {
  assets: WindowAssets;
  texts: GuiTexts;
  startTexts?: StartTexts;
  /** 640 x 480 picture under the window */
  background: Surface16;
  state: StartState;
  /** default: MODE_PENDING */
  pending?: { readonly [K in ModeKey]: string | null };
}

export class StartScreen {
  state: StartState;
  /** the background with BACKGROUND_DARKEN applied; the window snapshots it, so its interior is darkened too */
  private readonly dimmed: Surface16;
  private window!: GuiWindow;
  private readonly st: StartTexts;
  private readonly pending: { readonly [K in ModeKey]: string | null };

  constructor(private readonly o: StartScreenOptions) {
    this.state = { ...o.state, modes: { ...o.state.modes } };
    this.st = o.startTexts ?? START_TEXTS_PL;
    this.pending = o.pending ?? MODE_PENDING;
    this.dimmed = this.dimBackground();
    this.build();
  }

  /** Rows top to bottom. */
  rows(): Row[] {
    const { texts } = this.o;
    const st = this.st;
    const s = this.state;
    const yesNo = (v: boolean) => (v ? texts.yes : texts.no);
    return [
      {
        key: "inventory",
        label: st.inventory,
        value: s.modes.inventory === "coat" ? st.coat : st.bar,
        pending: this.pending.inventory,
      },
      { key: "easy", label: st.easy, value: yesNo(s.modes.easy), pending: this.pending.easy },
      {
        key: "saves",
        label: st.saves,
        value: s.modes.saves === "files" ? st.saveFiles : st.saveSlots,
        pending: this.pending.saves,
      },
      { key: "pauseOnBlur", label: st.pauseOnBlur, value: yesNo(s.pauseOnBlur), pending: null },
    ];
  }

  get win(): GuiWindow {
    return this.window;
  }

  private dimBackground(): Surface16 {
    const s = createSurface(SCREEN_W, SCREEN_H);
    blitCopy(this.o.background, 0, 0, SCREEN_W, SCREEN_H, s, 0, 0);
    darkenRect(s, 0, 0, SCREEN_W, SCREEN_H, BACKGROUND_DARKEN);
    return s;
  }

  private build(): void {
    const { assets } = this.o;
    const w = new GuiWindow(assets, this.dimmed, 0, 0, WINDOW_W, WINDOW_H, true);
    w.addLabel(this.st.title, true, 0, 14, COLOR_OUTLINE_BLACK, COLOR_YELLOW);
    // button 1, so Enter starts (Gui_RunWindow: Enter presses button 1)
    w.addButton("Start", this.st.start, centerOffset(WINDOW_W, START_W) - 1, START_Y, START_W, START_H);
    this.rows().forEach((r, i) => {
      const y = ROW_Y0 + i * ROW_DY;
      w.addLabel(r.label, false, LABEL_X, y + 6, COLOR_BLUE, COLOR_WHITE);
      w.addButton(r.key, r.value, VALUE_X, y, VALUE_W, VALUE_H);
    });
    w.addLabel(this.st.fullscreenHint, true, 0, HINT_Y, COLOR_BLUE, COLOR_WHITE, false);
    if (this.rows().some((r) => r.pending))
      w.addLabel(this.st.pendingNote, true, 0, HINT_Y + 18, COLOR_BLUE, COLOR_WHITE, false);
    this.window = w;
  }

  /** Applies a click on a row; a pending row does nothing. */
  press(key: RowKey): StartAction[] {
    const row = this.rows().find((r) => r.key === key);
    if (!row || row.pending) return [];
    const s = this.state;
    if (key === "pauseOnBlur") s.pauseOnBlur = !s.pauseOnBlur;
    else s.modes = cycleMode(s.modes, key, this.pending);
    this.build();
    return [{ type: "change", key, state: { ...s, modes: { ...s.modes } } }];
  }

  private handle(events: ReturnType<GuiWindow["pointerUp"]>): StartAction[] {
    const out: StartAction[] = [];
    for (const e of events) {
      if (e.kind !== "press") continue;
      if (e.name === "Start") out.push({ type: "start" });
      else out.push(...this.press(e.name as RowKey));
    }
    return out;
  }

  pointerDown(x: number, y: number): StartAction[] {
    return this.handle(this.window.pointerDown(x, y));
  }

  pointerMove(x: number, y: number): StartAction[] {
    return this.handle(this.window.pointerMove(x, y));
  }

  pointerUp(x: number, y: number): StartAction[] {
    return this.handle(this.window.pointerUp(x, y));
  }

  keyDown(key: string): StartAction[] {
    return this.handle(this.window.keyDown(key));
  }

  keyUp(key: string): StartAction[] {
    return this.handle(this.window.keyUp(key));
  }

  /** Background, window, pending rows darkened. */
  draw(screen: Surface16): void {
    blitCopy(this.dimmed, 0, 0, SCREEN_W, SCREEN_H, screen, 0, 0);
    this.window.draw(screen);
    const w = this.window;
    this.rows().forEach((r, i) => {
      if (r.pending)
        darkenRect(
          screen,
          w.x + LABEL_X - 4,
          w.y + ROW_Y0 + i * ROW_DY - 2,
          WINDOW_W - 2 * (LABEL_X - 4),
          VALUE_H + 4,
          PENDING_DARKEN,
        );
    });
  }

  /** A fresh 640 x 480 frame. */
  render(): Surface16 {
    const s = createSurface(SCREEN_W, SCREEN_H);
    this.draw(s);
    return s;
  }
}
