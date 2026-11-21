// Persistence of the options in localStorage. DELIBERATE DEPARTURE from the original: it saves to HKLM
// (Reg_SaveConfig) and on an ordinary account the save silently fails, so options are lost
//; this engine remembers them. Works without storage (private mode, no window).
import type { GameConfig } from "./config";
import { defaultConfig, sanitizeConfig } from "./config";

export const STORAGE_KEY = "jack-orlando.config";

/** The part of the Web Storage API used here (so tests can pass a fake). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // access can throw when site data is blocked
  }
}

export class ConfigStore {
  constructor(
    private readonly storage: KeyValueStorage | null = browserStorage(),
    private readonly key = STORAGE_KEY,
  ) {}

  /** Saved options; defaults when nothing usable is stored. */
  load(): GameConfig {
    try {
      const text = this.storage?.getItem(this.key);
      if (text) return sanitizeConfig(JSON.parse(text));
    } catch {
      // unreadable storage or broken JSON: start from defaults
    }
    return defaultConfig();
  }

  /** Returns false when it could not be saved (the game goes on). */
  save(config: GameConfig): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(config));
      return true;
    } catch {
      return false;
    }
  }
}
