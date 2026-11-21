// Scene sound list: the sounds a script refers to by name.
// Original: Sound_LoadSceneSfx (list <scene>.SSD, buffers [], names []),
// Sound_FindSceneSfx (index of a name, -1 if missing).

import { parseSsd } from "../formats/global";
import { Sound } from "../formats/sound";
import { decrypt } from "../formats/textcrypt";
import { prepareSound } from "../audio/prepare";
import type { PreparedSound } from "../audio/types";

/** Name of the footstep sounds Jack_PlayStep uses (remembered by Sound_LoadSceneSfx). */
export const STEP1_NAME = "KROK1.SND";
export const STEP2_NAME = "KROK2.SND";

/** "SC001.SSD" entry -> name kept in the list: the extension becomes .SND (Path_SetExtension). */
function listName(entry: string): string {
  const dot = entry.indexOf(".");
  return (dot < 0 ? entry : entry.slice(0, dot)) + ".SND";
}

/** Name of the packed file of an entry: the extension becomes .PSD. */
export function psdName(entry: string): string {
  const dot = entry.indexOf(".");
  return (dot < 0 ? entry : entry.slice(0, dot)) + ".PSD";
}

export class SceneSounds {
  /** entry names as the scripts spell them (upper case, extension .SND) */
  readonly names: string[] = [];
  /** decoded sounds; undefined where the .PSD was not found */
  readonly sounds: (PreparedSound | undefined)[] = [];
  /** index of KROK1.SND / KROK2.SND, -1 if the scene has none (g_sndStep1/2) */
  step1 = -1;
  step2 = -1;

  add(name: string, sound: PreparedSound | undefined): number {
    const i = this.names.length;
    this.names.push(name);
    this.sounds.push(sound);
    if (name === STEP1_NAME) this.step1 = i;
    if (name === STEP2_NAME) this.step2 = i;
    return i;
  }

  /** Sound_FindSceneSfx: first entry with exactly this name, -1 if none. */
  find(name: string): number {
    return this.names.indexOf(name);
  }

  get length(): number {
    return this.names.length;
  }
}

/**
 * Builds the list from the contents of `<scene>.SSD` (still encrypted). `readPsd(file)` returns the
 * bytes of a `.PSD` of the scene archive, or undefined; a missing file leaves a silent entry
 * (the exe would play whatever was left in its buffer).
 */
export function loadSceneSounds(ssd: Uint8Array, readPsd: (file: string) => Uint8Array | undefined): SceneSounds {
  const bank = new SceneSounds();
  for (const entry of parseSsd(decrypt(ssd))) {
    const data = readPsd(psdName(entry));
    bank.add(listName(entry), data ? prepareSound(new Sound(data, "PSD")) : undefined);
  }
  return bank;
}
