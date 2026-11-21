// Game modes chosen on the start screen and the page option "pause when the game window loses focus".
// No DOM: storage is passed in (same KeyValueStorage as settings/store.ts), so the tests use a fake.
// The original has no such screen: the Director's Cut takes EasyVer from the registry, written by the external
// launcher JackStart.exe ; the other modes are traces of older releases or browser
// conveniences. Wiring into the game: (bar), (easy), (bullet), (saves).
import type { KeyValueStorage } from "../settings/store";

export const MODES_KEY = "jack-orlando.modes";
/** Shared with (src/pause): "1" = pause when the window loses focus (default), "0" = keep running. */
export const PAUSE_ON_BLUR_KEY = "jack-orlando.pauseOnBlur";

export interface GameModes {
  /** "coat": the Director's Cut inventory under the coat ; "bar": the dead top bar of older releases */
  inventory: "coat" | "bar";
  /** g_easyVersion: chosen only here, fixed for the session; a change means a new game */
  easy: boolean;
  /** "files": system file windows like the exe (GetSaveFileNameA); "slots": 10 slots in the browser */
  saves: "files" | "slots";
}

export const DEFAULT_MODES: Readonly<GameModes> = { inventory: "coat", easy: false, saves: "files" };

export type ModeKey = keyof GameModes;

/** The values of each mode in the order a click cycles through them. */
export const MODE_VALUES: { readonly [K in ModeKey]: readonly GameModes[K][] } = {
  inventory: ["coat", "bar"],
  easy: [false, true],
  saves: ["files", "slots"],
};

/**
 * Task that wires each mode into the game; `null` = the game already honours it. Modes still pending are shown
 * greyed out and keep their default value (they would have no effect). Flip an entry when its task lands.
 */
export const MODE_PENDING: { readonly [K in ModeKey]: string | null } = {
  inventory: null,
  easy: null,
  saves: null,
};

export function defaultModes(): GameModes {
  return { ...DEFAULT_MODES };
}

function pick<K extends ModeKey>(key: K, value: unknown): GameModes[K] {
  return (MODE_VALUES[key] as readonly unknown[]).includes(value) ? (value as GameModes[K]) : DEFAULT_MODES[key];
}

/** Unknown keys dropped, bad values replaced by defaults, pending modes forced to their default. */
export function sanitizeModes(raw: unknown, pending: { readonly [K in ModeKey]: string | null } = MODE_PENDING): GameModes {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = defaultModes();
  for (const key of Object.keys(MODE_VALUES) as ModeKey[]) {
    if (pending[key]) continue;
    (out as unknown as Record<string, unknown>)[key] = pick(key, o[key]);
  }
  return out;
}

/** Next value of a mode (a click on its button); a pending mode does not change. */
export function cycleMode(modes: GameModes, key: ModeKey, pending: { readonly [K in ModeKey]: string | null } = MODE_PENDING): GameModes {
  if (pending[key]) return modes;
  const values = MODE_VALUES[key] as readonly unknown[];
  const next = values[(values.indexOf(modes[key]) + 1) % values.length];
  return { ...modes, [key]: next };
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // access can throw when site data is blocked
  }
}

/** Saved modes and the pause option. Works without storage (private mode): defaults, saving returns false. */
export class StartStore {
  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {}

  loadModes(pending = MODE_PENDING): GameModes {
    try {
      const text = this.storage?.getItem(MODES_KEY);
      if (text) return sanitizeModes(JSON.parse(text), pending);
    } catch {
      // unreadable storage or broken JSON
    }
    return defaultModes();
  }

  saveModes(modes: GameModes): boolean {
    return this.set(MODES_KEY, JSON.stringify(modes));
  }

  /** Anything but "0" counts as on (default "1"). */
  loadPauseOnBlur(): boolean {
    try {
      return this.storage?.getItem(PAUSE_ON_BLUR_KEY) !== "0";
    } catch {
      return true;
    }
  }

  savePauseOnBlur(on: boolean): boolean {
    return this.set(PAUSE_ON_BLUR_KEY, on ? "1" : "0");
  }

  private set(key: string, value: string): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * `?scene= ` (agents, and the old links) and `?start=1` start the game at once, without the start screen.
 * `?start=0` shows the screen even with `?scene=` (the scene is then the one Start begins with).
 */
export function skipStartScreen(params: URLSearchParams): boolean {
  if (params.get("start") === "0") return false;
  return params.get("start") === "1" || params.has("scene");
}
