// Texts of the main menu window, from Lang_InitLauncherStrings (read from the exe, Mazovia).
import { encodeMazovia } from "../dialog/caption";

export interface MainMenuTexts {
  /** window title; `/2` = 2 px spacing, `\u0004` = the diamond glyph of the font, `=` = 3 px gap */
  title: string;
  intro: string;
  newGame: string;
  load: string;
  quit: string;
}

/** g_language 'P' (the Steam release). */
export const MAIN_MENU_TEXTS_PL: MainMenuTexts = {
  title: "/2\u0004=MENU GRY=\u0004",
  intro: "Wprowadzenie",
  newGame: "Nowa gra",
  load: "Załaduj grę",
  quit: "Wyjście z gry",
};

/** g_language 'D'. */
export const MAIN_MENU_TEXTS_DE: MainMenuTexts = {
  title: "/2\u0004=SPIEL MENÜ=\u0004",
  intro: "Einführung",
  newGame: "Neues Spiel",
  load: "Spiel laden",
  quit: "Spiel beenden",
};

/** Any other language. */
export const MAIN_MENU_TEXTS_EN: MainMenuTexts = {
  title: "/2\u0004=MAIN MENU=\u0004",
  intro: "Introduction",
  newGame: "New game",
  load: "Load game",
  quit: "Exit",
};

/** Mazovia bytes; control characters (the diamond 0x04) are passed through as their code. */
export function menuBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 ? code : encodeMazovia(c)[0];
  });
}
