// The "pause when the window loses focus" option. Not a setting of the original game (its WndProc always
// pauses on WM_ACTIVATE): it lives outside the game, in localStorage, and the start screen switches it.

/** localStorage key shared with the start screen: "1" = pause on blur, "0" = keep running. */
export const PAUSE_ON_BLUR_KEY = "jack-orlando.pauseOnBlur";
/** URL parameter: `?pause=blur` / `?pause=never`, takes precedence over localStorage. */
export const PAUSE_PARAM = "pause";
/** Default when nothing is stored: pause, as the original does (hypothesis to confirm with the user). */
export const PAUSE_ON_BLUR_DEFAULT = true;

/** The part of Storage used here (localStorage, or a fake in tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `?pause=` value -> option, null for a missing or unknown value. */
export function parsePauseParam(value: string | null): boolean | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "blur") return true;
  if (v === "never") return false;
  return null;
}

/** Stored value -> option, null for a missing or unknown value. */
export function parseStoredPauseOnBlur(value: string | null): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

/**
 * The option in effect: `?pause=blur|never` first, then localStorage, then the default. A storage that throws
 * (private mode, blocked site data) counts as empty.
 */
export function readPauseOnBlur(search: string | URLSearchParams = "", storage?: StorageLike | null): boolean {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const fromUrl = parsePauseParam(params.get(PAUSE_PARAM));
  if (fromUrl !== null) return fromUrl;
  let stored: string | null = null;
  try {
    stored = storage?.getItem(PAUSE_ON_BLUR_KEY) ?? null;
  } catch {
    stored = null;
  }
  return parseStoredPauseOnBlur(stored) ?? PAUSE_ON_BLUR_DEFAULT;
}

/** Saves the option ("1"/"0"). Returns false when the storage refused it. */
export function writePauseOnBlur(storage: StorageLike | null | undefined, value: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PAUSE_ON_BLUR_KEY, value ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

/** window.localStorage, or null where the browser does not allow it. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
