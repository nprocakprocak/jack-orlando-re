// Browser counterpart of g_cfgPlayIntro (config +0x12, 009fa96a): "this is the first run, play the intro".
// The original stores it in the registry block g_config; here it is one localStorage key. [engine, not from the exe]
// The original shows the logos and INTRO.AVX together, only on the first run. The engine [not from the original; user
// decision 2026-11-07] shows the logos on every run (skippable) and plays the intro by itself only on the first run;
// later it comes after "Introduction" and "New game" of the main menu (start/flow.ts).
import type { KeyValueStorage } from "../settings/store";

export const INTRO_FLAG_KEY = "jack-orlando.playIntro";
export const LOGOS_PARAM = "logos";
export const INTRO_PARAM = "intro";

export interface StartupOptions {
  /** the studio logos after "Start" */
  logos: boolean;
  /** INTRO.AVX after the logos (first run) */
  intro: boolean;
}

function param(q: URLSearchParams, name: string): boolean | null {
  const p = q.get(name);
  return p === "1" ? true : p === "0" ? false : null;
}

/**
 * The logos: always, `?logos=0` turns them off. The intro: `?intro=1` / `?intro=0` win; then `?logos=0` / `?logos=1`
 * (as before, the switch of the whole first-run sequence); otherwise the stored flag, no value = first run = true
 * (Sys_InitConfigAndCd sets g_cfgPlayIntro = 1 when Reg_LoadConfig finds no saved config). Storage that throws
 * counts as empty.
 */
export function readStartupOptions(search: string, storage: KeyValueStorage | null): StartupOptions {
  const q = new URLSearchParams(search);
  const logos = param(q, LOGOS_PARAM);
  let intro = param(q, INTRO_PARAM) ?? logos;
  if (intro === null) {
    try {
      intro = storage?.getItem(INTRO_FLAG_KEY) !== "0";
    } catch {
      intro = true;
    }
  }
  return { logos: logos !== false, intro };
}

/** Launcher_Run sets g_cfgPlayIntro = 0 after the first intro and Reg_SaveConfigNow stores it. */
export function markIntroShown(storage: KeyValueStorage | null): void {
  try {
    storage?.setItem(INTRO_FLAG_KEY, "0");
  } catch {
    // storage unavailable: the intro comes back next time
  }
}
