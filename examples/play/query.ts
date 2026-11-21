// Query string for the dev page.
//
// mountPlayer does not read the URL. This file is the whole translation from
// location.search into the options a host passes in. Copy it when your page
// should honor the same links, or drop it and pass MountOptions yourself.
//
// A key that is absent is left unset. The player then keeps the value already
// stored in localStorage (modes, volumes, the intro flag). A key that is
// present replaces only that one value.
//
// `scale` is deliberately not handled here. attachDisplay, which mountPlayer
// calls, reads ?scale= from the page URL on its own.
//
// The first mount may skip the start screen. A later mount (a ZIP chosen
// while a session is already up) must not: the running session returns to
// the start screen, and the stored modes stay in force. Pass remount = true
// for that second call so `direct` is omitted.

import type { MountOptions } from "jack-orlando-browser";
import { readStartupOptions } from "jack-orlando-re/launcher";
import { browserStorage, readPauseOnBlur } from "jack-orlando-re/pause";
import { skipStartScreen } from "jack-orlando-re/start";

// Keys that belong to the host, not to the game's own variables.
// Anything else numeric is passed through as a variable (see below).
const OPTION_KEYS = new Set([
  "scene",
  "start",
  "talk",
  "mute",
  "dialogtext",
  "musicvol",
  "sfxvol",
  "talkvol",
  "revstereo",
  "musdown",
  "dialogs",
  "pause",
  "logos",
  "intro",
  "easy",
  "saves",
  "inventory",
  "scale",
]);

function finiteNumber(params: URLSearchParams, key: string): number | undefined {
  if (!params.has(key)) return undefined;
  const n = Number(params.get(key));
  return Number.isFinite(n) ? n : undefined;
}

// 0 and a non-numeric value are off. Any other number is on.
// The fallback matches the old page when the value cannot be parsed.
function flag(params: URLSearchParams, key: string, fallback: 0 | 1): 0 | 1 {
  return (finiteNumber(params, key) ?? fallback) !== 0 ? 1 : 0;
}

/**
 * Options for one mountPlayer call, taken from `search` (the query, including "?").
 * `remount` drops the direct-scene shortcut. See the file comment.
 */
export function mountOptionsFromQuery(
  search: string,
  remount: boolean,
): Omit<MountOptions, "canvas" | "files" | "onStatus"> {
  const params = new URLSearchParams(search);
  const opts: Omit<MountOptions, "canvas" | "files" | "onStatus"> = {
    // ?pause=blur or ?pause=never wins over the stored checkbox.
    // The start screen still shows the stored value; this is the live binding.
    pauseOnBlur: readPauseOnBlur(search, browserStorage()),
  };

  // ?mute=1 starts without an audio context. Omitting the field leaves sound on.
  if (params.get("mute") === "1") opts.audio = false;

  // ?start=1 or ?scene=NAME skips the start screen. ?start=0 shows it even
  // when a scene is named. The scene name defaults to SC001, as the old page did.
  // skipStartScreen is the engine's own rule for those two keys.
  if (!remount && skipStartScreen(params)) {
    opts.direct = { scene: (params.get("scene") ?? "SC001").toUpperCase() };
  }

  // Logos and the intro. Passed only when the URL mentions them, so a link
  // with neither key still lets the player read the stored "first run" flag
  // at the moment Start is clicked, not at page load.
  if (params.has("logos") || params.has("intro")) {
    opts.startup = readStartupOptions(search, browserStorage());
  }

  const saves = params.get("saves");
  if (saves === "slots" || saves === "files") opts.saves = saves;

  // ?easy=0 is off. Any other number is on. Absent: leave the stored mode.
  if (params.has("easy")) opts.easy = flag(params, "easy", 0) === 1;

  const inventory = params.get("inventory");
  if (inventory === "bar" || inventory === "coat") opts.inventory = inventory;

  // Dialogs stay on unless the link says ?dialogs=0.
  if (params.get("dialogs") === "0") opts.dialogs = false;

  if (params.has("talk")) {
    const talk = finiteNumber(params, "talk");
    if (talk !== undefined) opts.talkTicks = talk;
  }

  // Volumes and the related switches. Only keys that appear in the URL are
  // copied. The player fills the rest from its saved config.
  // Non-numeric text falls back the way the old page did: dialog text on,
  // reverse stereo off, music ducking on.
  const settings: NonNullable<MountOptions["settings"]> = {};
  if (params.has("dialogtext")) settings.showText = flag(params, "dialogtext", 1);
  const musicVol = finiteNumber(params, "musicvol");
  if (params.has("musicvol") && musicVol !== undefined) settings.musicVol = musicVol;
  const sfxVol = finiteNumber(params, "sfxvol");
  if (params.has("sfxvol") && sfxVol !== undefined) settings.sfxVol = sfxVol;
  const talkVol = finiteNumber(params, "talkvol");
  if (params.has("talkvol") && talkVol !== undefined) settings.talkVol = talkVol;
  if (params.has("revstereo")) settings.reverseStereo = flag(params, "revstereo", 0);
  if (params.has("musdown")) settings.musicDown = flag(params, "musdown", 1);
  if (Object.keys(settings).length > 0) opts.settings = settings;

  // Every other numeric key is a game variable. Names are uppercased because
  // that is how the scripts spell them. `scale` is in OPTION_KEYS so it is
  // not turned into a variable by accident.
  const vars: Record<string, number> = {};
  for (const [key, value] of params) {
    if (OPTION_KEYS.has(key)) continue;
    const n = Number(value);
    if (!Number.isNaN(n)) vars[key.toUpperCase()] = n;
  }
  if (Object.keys(vars).length > 0) opts.vars = vars;

  return opts;
}
