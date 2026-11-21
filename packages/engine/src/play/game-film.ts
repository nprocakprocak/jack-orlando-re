// Films, the fade before a movie, and a death sequence.

import { gameVolumeToLevel } from "../audio/mixer";
import { prepareSound } from "../audio/prepare";
import { Sound } from "../formats/sound";
import { fcmEffectFile, parseFcm, parseCm } from "../formats/global";
import { decodePbm } from "../formats/pbm";
import { decrypt } from "../formats/textcrypt";
import { swapChannel } from "../sfx";
import { DEFAULT_TRACK } from "./audio";
import { FilmRun, isOutro, MASK_WIDTHS, openMovie } from "./film";
import { deathAhead, isDeathFilm } from "./predicates";
import { MOVIE_FADE_STEP_MS } from "./types";
import type { GameState } from "./game-state";
import { scenePak, loadTrack } from "./game-scene";
import { finish } from "./game-save";

/** `IM<w>.PBM` ring of each mask index (Game_Main loads five; index 0, width 220, has none) */
const RING_FILES = [null, "IM240.PBM", "IM260.PBM", "IM280.PBM", "IM300.PBM", "IM312.PBM", "IM312.PBM"];

/** A death is certain: the film is pending, or an active macro runs straight to a `RUNAVX` of a death film (`deathAhead`). */
export function deathSequence(this: GameState): boolean {
  if (this.phase !== "playing" || !this.interpreter) return false;
  if (this.pendingMovie) return isDeathFilm(this.pendingMovie.film);
  return deathAhead(this.interpreter);
}

/**
 * Real time (`dtMs`): the music fades (Game_Tick14ms, every 14 ms), a film's frames (Media_Step, 5 ms ticks) and the
 * fade between scenes.
 */
export function advance(this: GameState, dtMs: number): void {
  this.musicClock += dtMs;
  for (let n = 0; this.musicClock >= 14 && n < 200; n++) {
    this.musicClock -= 14;
    this.audio.music.tick14ms();
  }
  this.musicClock = Math.min(this.musicClock, 14);
  this.menu?.tick(dtMs);
  this.slotUi?.win.tick(dtMs);
  if (this.moviePause && this.moviePause.left > 0) advanceMovieFade.call(this, dtMs);
  if (this.phase === "movie") return stepMovie.call(this, dtMs);
  if (this.phase === "film") return stepFilm.call(this, dtMs);
  if (this.phase !== "fading" || !this.transition) return;
  this.transition.advance(dtMs);
  if (this.transition.finished) {
    this.transition = null;
    this.phase = "playing";
  }
}

/**
 * Film_Play: the film `film` of `<scene>.FCM` (RUNFILMP, global = 0) or the section of `GLOBAL.FCM` (RUNGLOBALFILMP,
 * global = 1: `Fcm_LoadSection`, pictures from Global.pak) is looked up (`Film_Find`; the game stops with
 * "No Film!!" when there is none, here the command is logged and skipped), the cursor sprites are removed and the film
 * plays in a window of the scene picture; the game loop does not run meanwhile.
 */
export function startFilm(this: GameState): void {
  const p = this.pendingFilm!;
  this.pendingFilm = null;
  const sc = this.scene!;
  const command = p.global ? "RUNGLOBALFILMP" : "RUNFILMP";
  try {
    const phk = p.global ? this.global : scenePak.call(this, sc);
    const entry = phk.find(p.global ? "GLOBAL.FCM" : `${this.sceneName}.FCM`);
    const wanted = p.film.toUpperCase();
    const film = entry ? parseFcm(decrypt(phk.read(entry))).find((f) => f.name.toUpperCase() === wanted) : undefined;
    if (!film) {
      this.addLog(`! ${command} ${p.film}: No Film!!`);
      return;
    }
    const images = film.frames.map((f) => decodePbm(phk.read(f.file), f.file));
    const circle = p.mode === 2 || p.mode === 3;
    let index = MASK_WIDTHS.indexOf(images[1].width);
    if (index < 0) index = 0;
    const maskFile = `CM${MASK_WIDTHS[index]}.BIN`;
    const ringFile = RING_FILES[index];
    const mask = circle ? parseCm(maskFile, this.resource.read(this.resource.find(maskFile)!)) : null;
    const ring =
      circle && ringFile && this.resource.find(ringFile) ? decodePbm(this.resource.read(ringFile), ringFile) : null;
    const run = new FilmRun({ film, images, scene: sc.renderer.framebuffer, mask, ring }, p.mode, p.x, p.y, sc.scrollX);
    this.film = { run, name: film.name, clockMs: 0, global: p.global };
    this.phase = "film";
    this.addLog(`▶ ${command} ${film.name} (${p.x}, ${p.y}) tryb ${p.mode}`);
    filmSounds.call(this, 0);
  } catch (e) {
    this.addLog(
      `! ${p.global ? "RUNGLOBALFILMP" : "RUNFILMP"} ${p.film}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * The effects of the passes up to film time `ms`: channel 0 plays on channels 1 and 2 (Film_Play). A scene film uses
 * Sound_PlayIndexed (index in the scene's sound list of the name as written); a global one Sound_PlayTalk(1): the raw `.S16` file of Global.pak,
 * a free channel of the requested side, volume as given (no doubling) scaled by SFXVol / 64.
 */
export function filmSounds(this: GameState, ms: number): void {
  const f = this.film;
  if (!f) return;
  const sfx = this.audio.sfx;
  for (const e of f.run.effectsUntil(ms)) {
    if (!this.audio.enabled) continue;
    if (f.global) {
      for (const ch of e.channel === 0 ? [1, 2] : [e.channel])
        playGlobalSound.call(this, ch, fcmEffectFile(e), e.volume);
      continue;
    }
    // Scene_LoadFcm: Sound_FindSceneSfx(name as written, `001-06.SND`; only Fcm_LoadSection changes it to .S16)
    const index = sfx.sounds?.find(e.sound) ?? -1;
    for (const ch of e.channel === 0 ? [1, 2] : [e.channel]) sfx.playIndexed(ch, index, e.volume, 0);
  }
}

/** Sound_PlayTalk(channel, file, volume, 1): `file` of Global.pak, nothing when it is missing or sound is off. */
export function playGlobalSound(this: GameState, channel: number, file: string, volume: number): void {
  const audio = this.audio;
  const entry = this.global.find(file);
  if (!audio.enabled || !entry) return;
  let prepared;
  try {
    prepared = prepareSound(new Sound(this.global.read(entry), "S16"));
  } catch {
    return;
  }
  const ch = audio.pickTalkChannel(channel);
  const level = gameVolumeToLevel(Math.trunc((volume * audio.config.sfxVolume) / 64));
  audio.mixer.play(swapChannel(ch, audio.config.revStereo), prepared, { volume: level });
}

export function stepFilm(this: GameState, dtMs: number): void {
  const f = this.film;
  if (!f) return;
  f.clockMs += dtMs;
  filmSounds.call(this, f.clockMs);
  if (!f.run.finished(f.clockMs)) return;
  this.addLog(`■ RUNFILMP ${f.name}`);
  this.film = null;
  this.phase = "playing";
}

/**
 * At the end of the frame the music stops, the film `Movies\<name>16.AVX` plays
 * until it ends or Esc is down, then the scene is loaded again (`g_sceneChange` stays 1) and starts the default
 * track. `scene` is what the script gave as the second word (`NULL` in the data): a scene that exists is entered,
 * otherwise the current one is loaded again (**hypothesis**: the code that copies the name was lost in the decompiler).
 */
/**
 * Game_Run (the scene change with g_movieOnExit): `while (0 < g_musicVolume) { g_musicVolume--;
 * Sound_SetChannelVolume(5, g_musicVolume); Timer_Sleep(10); }` - the music volume (game units, up to 64) falls by 1 every 10 ms,
 * so the pause before the film lasts `volume x 10 ms` (350 ms at MusicVol 35, less while the music is ducked) and is silent
 * when no music plays. The face windows are already gone then, the scene stands on its last frame. (the user saw a clear
 * pause after Biff's line and his face going away, before ONCAR.AVX; the engine used to stop the music at once.)
 */
export function beginMovieFade(this: GameState): { total: number; left: number; volume: number } | null {
  const music = this.audio.music;
  if (!this.audio.enabled || !music.playing || music.volume <= 0) return { total: 0, left: 0, volume: 0 };
  const total = music.volume * MOVIE_FADE_STEP_MS;
  return { total, left: total, volume: music.volume };
}

export function advanceMovieFade(this: GameState, dtMs: number): void {
  const f = this.moviePause;
  if (!f) return;
  f.left = Math.max(0, f.left - dtMs);
  this.audio.setMusicFade(Math.floor((f.volume * f.left) / f.total));
}

export async function startMovie(this: GameState, film: string, _scene: string): Promise<void> {
  this.addLog(`▶ RUNAVX ${film}`);
  this.audio.silence();
  this.defaultMusic = true;
  if (this.audio.enabled) await loadTrack.call(this, DEFAULT_TRACK);
  this.pendingScene = null;
  const sink = this.audio.enabled ? (this.opts.movieSink?.() ?? null) : null;
  const player = await openMovie(this.files, film, {
    dialogText: this.audio.config.dialogText,
    sound: sink,
    level: this.audio.movieLevel,
  });
  if (!player) {
    this.addLog(`! film ${film} cannot be opened`);
    afterMovie.call(this, film);
    return;
  }
  player.start(0);
  this.movie = {
    player,
    film,
    clockMs: 0,
    surface: { width: 640, height: 480, pixels: player.screen.pixels },
  };
  this.phase = "movie";
}

export function stepMovie(this: GameState, dtMs: number): void {
  const m = this.movie;
  if (!m) return;
  m.clockMs += dtMs;
  const s = m.player.step(Math.floor(m.clockMs / 5), this.lastInput.escape === true);
  if (!s.end) return;
  this.addLog(`■ ${m.film}: ${s.end}`);
  this.endSurface = m.surface;
  this.movie = null;
  afterMovie.call(this, m.film);
}

/**
 * After the film (Game_Run, the exit-film branch): `OUTRO.AVX` sets `g_gameFinished` and the
 * game ends. Every other film (the death films `ONCAR16`, `83JC16`...) is a death. The original then loads `SC001.CCG`
 * (string xref), `Cursor_LoadSet1`, `Inventory_Clear`, sets `g_optionsRequest = 1` and opens the F4 menu on SC001
 * with the old variables. [engine; user decision 2026-11-06] The engine instead ends the game with `exit = "death"` and the
 * page returns to the main menu ; "New game" then starts from zero. The faithful return is a FUTURE.md option.
 */
export function afterMovie(this: GameState, film: string): void {
  this.fadeRequested = false;
  if (isOutro(film)) {
    finish.call(this, "finished");
    this.addLog("■ koniec gry (OUTRO.AVX)");
    return;
  }
  finish.call(this, "death");
  this.addLog(`■ śmierć Jacka (${film}) — powrót do menu głównego`);
}
