// The verb window of BulletOnOff = 0: Cursor_VerbMenu + Gui_ChoiceWindow.
import { textWidth } from "../formats/fnt";
import { encodeMazovia } from "../dialog/caption";
import { centerOffset, COLOR_OUTLINE_BLACK, COLOR_YELLOW } from "../gui/draw";
import type { Surface16 } from "../render/surface";
import { GuiWindow, type GuiEvent, type WindowAssets } from "../gui/window";

// Verb-window captions.
// The Polish pointer label uses z-acute.

export interface VerbTexts {
  /** Items in list order; the revolver item only with GUN == 1. */
  pointer: string;
  take: string;
  hit: string;
  look: string;
  gun: string;
  /** Window title. The "/3" prefix sets letter spacing 3. */
  title: string;
}

/** Captions by language code. */
export const VERB_TEXTS: Readonly<Record<"P" | "E" | "D", VerbTexts>> = {
  P: {
    pointer: "Wskaźnik",
    take: "Zabierz",
    hit: "Uderz",
    look: "Sprawdź",
    gun: "Colt",
    title: "/3WYBIERZ",
  },
  E: {
    pointer: "Pointer",
    take: "Take",
    hit: "Hit",
    look: "Examine",
    gun: "Colt",
    title: "/3SELECT",
  },
  D: {
    pointer: "Gehe zu, Sprechen",
    take: "Nehmen",
    hit: "Schlagen",
    look: "Betrachten",
    gun: "Waffe",
    title: "/3AUSWAHL",
  },
};

/** Cursor modes of the list items in order (g_verbMenuList): pointer 0, take 4, hit 2, look 1, gun 3. */
export function verbMenuModes(gun: boolean): number[] {
  return gun ? [0, 4, 2, 1, 3] : [0, 4, 2, 1];
}

export function verbMenuItems(texts: VerbTexts, gun: boolean): string[] {
  const items = [texts.pointer, texts.take, texts.hit, texts.look];
  if (gun) items.push(texts.gun);
  return items;
}

/** Button name of item i: "Btn A", "Btn B"... */
export function buttonName(i: number): string {
  return `Btn ${String.fromCharCode(65 + i)}`;
}

/**
 * Gui_ChoiceWindow: width = widest item (by character count, first on ties) + 80, rounded up to even;
 * height = n * 27 + 50; title at y 13 (centred, yellow on outline 6); buttons at x 19, y 38 + 27 i, (Wo - 40) x 24.
 * All text uses font 1, which is the small JACKM font (font != 0 = JACKM).
 */
export function buildVerbWindow(
  assets: WindowAssets,
  scene: Surface16,
  x: number,
  y: number,
  items: readonly string[],
  title: string,
): GuiWindow {
  let widest = items[0];
  for (const s of items) if (s.length > widest.length) widest = s;
  let wo = textWidth(assets.fontSmall, encodeMazovia(widest)) + 80;
  wo += wo % 2;
  const ho = items.length * 27 + 50;
  const w = new GuiWindow(assets, scene, x, y, wo, ho, false);
  w.addLabel(title, true, 20, 13, COLOR_OUTLINE_BLACK, COLOR_YELLOW, false);
  items.forEach((text, i) =>
    w.addButton(buttonName(i), text, centerOffset(wo, wo - 40) - 1, 38 + 27 * i, wo - 40, 24, true, false),
  );
  return w;
}

/** Result of the modal window: the chosen cursor mode, or null (Esc: mode stays 0). */
export type VerbResult = { mode: number } | null;

/** Event-driven Gui_RunChoiceWindow. `done` becomes true when the window ended; `result` then holds the outcome. */
export class VerbMenu {
  readonly win: GuiWindow;
  readonly modes: number[];
  done = false;
  result: VerbResult = null;

  constructor(
    assets: WindowAssets,
    scene: Surface16,
    x: number,
    y: number,
    gun: boolean,
    texts: VerbTexts = VERB_TEXTS.P,
  ) {
    this.modes = verbMenuModes(gun);
    this.win = buildVerbWindow(assets, scene, x, y, verbMenuItems(texts, gun), texts.title);
  }

  private handle(events: GuiEvent[]): void {
    if (this.done) return;
    for (const e of events) {
      if (e.kind === "escape") {
        this.done = true;
        this.result = null;
        return;
      }
      if (e.kind === "press") {
        const i = this.modes.findIndex((_, k) => buttonName(k) === e.name);
        if (i >= 0) {
          this.done = true;
          this.result = { mode: this.modes[i] };
          return;
        }
      }
    }
  }

  pointerDown(x: number, y: number): void {
    this.handle(this.win.pointerDown(x, y));
  }
  pointerMove(x: number, y: number): void {
    this.handle(this.win.pointerMove(x, y));
  }
  pointerUp(x: number, y: number): void {
    this.handle(this.win.pointerUp(x, y));
  }
  keyDown(key: string): void {
    this.handle(this.win.keyDown(key));
  }
  /** Enter acts on release (Enter = button 1 = "Pointer"). */
  keyUp(key: string): void {
    this.handle(this.win.keyUp(key));
  }
  draw(screen: Surface16): void {
    this.win.draw(screen);
  }
}
