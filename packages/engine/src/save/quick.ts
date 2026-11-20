// Quick save F5 / quick load F6 / autosave names and the F6 search. and 4.
// Quirks of the original are kept on purpose (see).

import { pad2 } from "../core/pad";

export const QUICK_NAME_PL = "Szybki Zapis";
export const AUTOSAVE_NAME_PL = "AUTO - ZAPIS";

/** `Save_MakeQuickName`: `<name> RRRR-MM-DD GG-MM.sav` (easy version `.svl`), local time, no seconds. */
export function quickSaveName(now: Date, light: boolean, base = QUICK_NAME_PL): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
  return `${base} ${date} ${time}.${light ? "svl" : "sav"}`;
}

export function autosaveFileName(light: boolean, base = AUTOSAVE_NAME_PL): string {
  return `${base}.${light ? "svl" : "sav"}`;
}

/** C `atoi`: optional blanks and sign, then digits; anything else = 0. */
export function atoi(s: string): number {
  const m = /^[ \t]*([+-]?\d+)/.exec(s);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * The value F6 compares (`Game_Run`): the name from `strlen - 20` up to the first dot is `RRRR-MM-DD GG-MM`;
 * minutes = (year - 1900) * 365 * 1440 + month * 30 * 1440 + day * 1440 + hour * 60 + minute.
 * A month counts as 30 days, so 31 January 23:00 beats 1 February 10:00.
 */
export function quickScore(fileName: string): number {
  const start = Math.max(0, fileName.length - 20);
  const dot = fileName.indexOf(".", start);
  const frag = fileName.slice(start, dot < 0 ? undefined : dot);
  const year = atoi(frag.slice(0, 4));
  return (year - 1900) * 525600 + atoi(frag.slice(5)) * 43200 + atoi(frag.slice(8)) * 1440 + atoi(frag.slice(11)) * 60 + atoi(frag.slice(14));
}

/** `Szybki Zapis*.*` — also files of the other version (`.svl` in the normal one): the load then refuses them silently. */
export function isQuickFile(fileName: string, base = QUICK_NAME_PL): boolean {
  return fileName.toLowerCase().startsWith(base.toLowerCase()) && fileName.includes(".");
}

/**
 * F6: the first file (in listing order) with the highest score; strict `>` from 0, so a tie goes to the earlier file and
 * names that score 0 never win. Nothing found = null (the original keeps an uninitialised index; **hypothesis**: no load).
 */
export function pickNewestQuick(names: readonly string[], base = QUICK_NAME_PL): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const n of names) {
    if (!isQuickFile(n, base)) continue;
    const score = quickScore(n);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}
