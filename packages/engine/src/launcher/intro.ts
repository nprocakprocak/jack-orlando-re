// INTRO.AVX with the subtitles INTRO.DLG: Launcher_PlayIntro (Media_Open mode 1). No DOM.
import { Avx } from "../formats/media";
import { parseSubtitles, SubtitleTrack } from "../formats/subtitles";
import { MODE_INTRO, MoviePlayer, type MovieSoundSink } from "../video";

export const INTRO_AVX = "Movies/INTRO.AVX";
export const INTRO_DLG = "Movies/INTRO.DLG";

export interface IntroSettings {
  /** DialogOnOff (`g_dialogTextOn`): the subtitles are drawn when it is on (or when there is no sound) */
  dialogText: boolean;
  sound: MovieSoundSink | null;
  /** level 0..127 of channel 1 */
  level: number;
}

/**
 * Opens the intro; null when INTRO.AVX is missing or damaged (the menu then goes on without it). A missing or damaged
 * INTRO.DLG only means no subtitles.
 */
export async function openIntro(
  read: (rel: string) => Promise<Uint8Array>,
  s: IntroSettings,
): Promise<MoviePlayer | null> {
  let avx: Avx;
  try {
    avx = new Avx(await read(INTRO_AVX));
  } catch {
    return null;
  }
  let subtitles: SubtitleTrack | null;
  try {
    subtitles = new SubtitleTrack(parseSubtitles(await read(INTRO_DLG), true), true);
  } catch {
    subtitles = null;
  }
  return new MoviePlayer(avx, {
    mode: MODE_INTRO,
    subtitles,
    dialogTextOn: s.dialogText,
    sound: s.sound,
    level: s.level,
  });
}

/**
 * Esc ends the intro (`Input_IsKeyDown(1)`, Launcher_PlayIntro). A key that was already down when the movie started
 * (the Esc that skipped the logos) does not count until it is released **[engine]**.
 */
export class IntroEscape {
  private armed = false;

  /** `down` = the state of Esc now; returns what to hand to `MoviePlayer.step`. */
  update(down: boolean): boolean {
    if (!down) this.armed = true;
    return down && this.armed;
  }
}

/**
 * A left click that ends a skippable film like Esc does (**[engine, user request]**: the original reads only the key).
 * `press()` on pointerdown, `take()` once per frame: true exactly once per click. The click is consumed by the film (the
 * page must not pass it on to the scene), and a click made while nothing skippable runs is dropped by `take(false)`.
 */
export class ClickSkip {
  private pending = false;

  press(): void {
    this.pending = true;
  }

  /** `active` = a skippable film runs now; a pending click is cleared either way. */
  take(active: boolean): boolean {
    const p = this.pending && active;
    this.pending = false;
    return p;
  }
}
