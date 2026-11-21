// g_config (0x26 bytes): the game options. Fields, ranges and defaults:
// (defaults from Sys_InitConfigAndCd).

export interface GameConfig {
  /** +0x00 "there is sound" (WinMain overwrites it) */
  sound: number;
  /** +0x02 TalkOnOff: a click ends the current line */
  talkInterrupt: number;
  /** +0x04 DialogOnOff: show subtitles */
  showText: number;
  /** +0x06 WalkSpeed 0..6 (step period = frame delay - speed, min 1) */
  walkSpeed: number;
  /** +0x08 BulletOnOff: right button opens the "bullet" menu instead of the verb menu */
  showBullet: number;
  /** +0x0a MusicVol 0..64 */
  musicVol: number;
  /** +0x0c SFXVol 0..64 */
  sfxVol: number;
  /** +0x0e TalkVol 0..64 */
  talkVol: number;
  /** +0x10 RevStereoOnOff */
  reverseStereo: number;
  /** +0x12 play the intro at start (not an in-game option) */
  intro: number;
  /** +0x14 SurroundOnOff */
  surround: number;
  /** +0x16 MusDownOnOff: duck the music during dialogue */
  musicDown: number;
}

export const DEFAULT_CONFIG: Readonly<GameConfig> = {
  sound: 1, talkInterrupt: 1, showText: 1, walkSpeed: 1, showBullet: 1,
  musicVol: 0x23, sfxVol: 0x20, talkVol: 0x40, reverseStereo: 0, intro: 1, surround: 1, musicDown: 1,
};

export const WALK_SPEED_MAX = 6;
export const VOLUME_MAX = 64;

type Range = readonly [number, number];
const BOOL: Range = [0, 1];
const RANGES: Record<keyof GameConfig, Range> = {
  sound: BOOL, talkInterrupt: BOOL, showText: BOOL, walkSpeed: [0, WALK_SPEED_MAX], showBullet: BOOL,
  musicVol: [0, VOLUME_MAX], sfxVol: [0, VOLUME_MAX], talkVol: [0, VOLUME_MAX], reverseStereo: BOOL,
  intro: BOOL, surround: BOOL, musicDown: BOOL,
};

export function defaultConfig(): GameConfig {
  return { ...DEFAULT_CONFIG };
}

/** Takes what a store returned (any JSON): known numeric fields are clamped, everything else falls back to defaults. */
export function sanitizeConfig(raw: unknown): GameConfig {
  const out = defaultConfig();
  if (typeof raw !== "object" || raw === null) return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(RANGES) as (keyof GameConfig)[]) {
    const v = src[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const [lo, hi] = RANGES[key];
    out[key] = Math.min(hi, Math.max(lo, Math.trunc(v)));
  }
  return out;
}
