// The sound of the playable game: the mixer, music, effects and speech, with the options
// of the original configuration. No DOM: a backend (WebAudioBackend in the page, a fake one in tests) does the
// playing; without one the game runs as with `g_config == 0` / no sound device (effects and music are
// ignored, lines are timed by their text).
import { gameVolumeToLevel, Mixer, MUSIC_CHANNEL } from "../audio/mixer";
import { MusicPlayer } from "../audio/music";
import { prepareSound, soundDuration } from "../audio/prepare";
import type { AudioBackend, Voice } from "../audio/types";
import { Sound } from "../formats/sound";
import type { Pak } from "../formats/pak";
import type { GameConfig } from "../settings/config";
import { musicVolumeEffect } from "../gui/menu";
import { DEFAULT_SFX_VOLUME, SfxPlayer, swapChannel } from "../sfx";
import type { SceneSounds } from "../sfx";

/**
 * The options of the game (registry "Config", defaults of Sys_InitConfigAndCd): DialogOnOff
 * (g_dialogTextOn), MusicVol, SFXVol (g_optSfxVol), TalkVol (g_optTalkVol), RevStereoOnOff
 * (g_optRevStereo), MusDownOnOff.
 */
export interface PlayConfig {
  dialogText: boolean;
  musicVolume: number;
  sfxVolume: number;
  talkVolume: number;
  revStereo: boolean;
  musicDown: boolean;
}

export const DEFAULT_CONFIG: Readonly<PlayConfig> = {
  dialogText: true,
  musicVolume: 0x23,
  sfxVolume: DEFAULT_SFX_VOLUME,
  talkVolume: 0x40,
  revStereo: false,
  musicDown: true,
};

/** The default track `Game_Run` starts when a scene is loaded after a film. */
export const DEFAULT_TRACK = "TR02-22.PMS";

const SILENT_VOICE: Voice = { stop() {}, setGain() {}, setPan() {} };

/** A backend that plays nothing and never ends a voice (used only behind a disabled mixer). */
class NullBackend implements AudioBackend {
  start(): Voice {
    return SILENT_VOICE;
  }
  startStream(): Voice {
    return SILENT_VOICE;
  }
  setMasterGain(): void {}
  setSuspended(): void {}
}

/** What the page's Web Audio graph offers for the music options (settings/stereo.ts `StereoOptions`); optional. */
export interface StereoFx {
  update(surround: boolean, reverse: boolean): void;
}

export class PlayAudio {
  readonly enabled: boolean;
  readonly mixer: Mixer;
  readonly sfx: SfxPlayer;
  readonly music: MusicPlayer;
  readonly config: PlayConfig;
  private readonly tracks = new Map<string, Uint8Array>();
  private sceneArchive: Pak | null = null;
  /** the second archive of `Sound_PlayTalk` (GLOBAL.PAK): a speech file the scene does not have is looked up here (Jack's refusals `N0n0.S22`) */
  speechFallback: Pak | null = null;
  /** channels that carry speech (g_sndChannelTalk): only they are stopped when a line ends */
  readonly talkChannels = new Set<number>();
  /**
   * "Pseudo surround" / "Swap stereo channels" of the music (Snd_CopyStereo). The page hangs its
   * `StereoOptions` here; the menu's changes reach it through `applySetting`. Null = the music is left as it is.
   */
  stereoFx: StereoFx | null = null;
  private musicMuted = false;
  /** option SurroundOnOff (g_config +0x14); the other options live in `config` */
  surround = true;
  /** the samples of the volume sliders: SFX.S16 and TALK.S16 of RESOURCE.PAK (Game_Main) */
  private readonly previews: {
    sfx?: ReturnType<typeof prepareSound>;
    talk?: ReturnType<typeof prepareSound>;
  } = {};
  /** levels of the effect channels while they are paused (Snd_TogglePauseFx, channels 1..4) */
  private pausedFx: Map<number, number> | null = null;

  constructor(
    readonly backend: AudioBackend | null,
    config: Partial<PlayConfig> = {},
  ) {
    this.enabled = backend !== null;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mixer = new Mixer(backend ?? new NullBackend());
    this.sfx = new SfxPlayer(this.mixer, {
      soundEnabled: this.enabled,
      sfxVolume: this.config.sfxVolume,
      swapChannels: this.config.revStereo,
    });
    this.music = new MusicPlayer(this.mixer, {
      enabled: this.enabled,
      musicVolume: this.config.musicVolume,
      load: (name) => this.tracks.get(name.toUpperCase()),
    });
  }

  /**
   * Takes the options of the game (the menu's `GameConfig`) into the sound: start of a game and every change of an option.
   * The music level is set without the stop/restart rule of the audio window (that one belongs to a change, `applySetting`).
   */
  applyConfig(c: Readonly<GameConfig>): void {
    this.config.dialogText = c.showText !== 0;
    this.config.musicVolume = c.musicVol;
    this.config.sfxVolume = c.sfxVol;
    this.config.talkVolume = c.talkVol;
    this.config.revStereo = c.reverseStereo !== 0;
    this.config.musicDown = c.musicDown !== 0;
    this.surround = c.surround !== 0;
    this.sfx.options.sfxVolume = c.sfxVol;
    this.sfx.options.swapChannels = this.config.revStereo;
    this.music.musicVolume = c.musicVol;
    this.stereoFx?.update(this.surround, this.config.revStereo);
  }

  /**
   * One option changed in the "Opcje audio" window (Menu_AudioOptions): `MusicVol` stops the
   * music below 5 and restarts it above 5 (`setMusicVolume`), `RevStereoOnOff` / `SurroundOnOff` reach the stereo graph.
   * `c` already holds the new value.
   */
  applySetting(key: keyof GameConfig, c: Readonly<GameConfig>): void {
    this.applyConfig(c);
    if (key !== "musicVol" || !this.enabled) return;
    // MusicPlayer keeps ("muted") private; this mirrors its rule (below 5 -> muted, above 5 -> restarted)
    const effect = musicVolumeEffect(c.musicVol, true, this.musicMuted);
    this.music.setMusicVolume(c.musicVol);
    if (effect === "stop") this.musicMuted = true;
    else if (effect === "resume") this.musicMuted = false;
    if (effect === null && this.music.playing && !this.musicMuted) {
      this.mixer.setChannelVolume(MUSIC_CHANNEL, gameVolumeToLevel(c.musicVol)); // Sound_SetChannelVolume(5, value) while dragging
    }
  }

  /** Loads the slider samples (`SFX.S16`, `TALK.S16`); a missing or broken one just plays nothing. */
  loadPreviews(sfx: Uint8Array | undefined, talk: Uint8Array | undefined): void {
    const prep = (b: Uint8Array | undefined) => {
      if (!b) return undefined;
      try {
        return prepareSound(new Sound(b, "S16"));
      } catch {
        return undefined;
      }
    };
    this.previews.sfx = prep(sfx);
    this.previews.talk = prep(talk);
  }

  /**
   * Dragging a volume slider (`Gui_RunWindow`): `MusicVol` sets the music channel (that is
   * `applySetting`); `SFXVol` / `TalkVol` play their sample on the channels 1 and 2 when both are idle, otherwise only the
   * volume of the two channels follows. Volume `value` is in game units (level = 2 * value).
   */
  preview(channel: "music" | "sfx" | "talk", value: number): void {
    if (channel === "music" || !this.enabled) return;
    const sample = this.previews[channel];
    const level = gameVolumeToLevel(value);
    if (!this.mixer.isPlaying(1) && !this.mixer.isPlaying(2)) {
      if (!sample) return;
      this.mixer.play(1, sample, { volume: level });
      this.mixer.play(2, sample, { volume: level });
    } else {
      this.mixer.setChannelVolume(1, level);
      this.mixer.setChannelVolume(2, level);
    }
  }

  /**
   * Snd_TogglePauseFx / Snd_TogglePauseFx2 around a modal window: the effect channels 1..4 stop
   * sounding. **Deviation:** the original pauses the DirectSound buffers; the backend has no per-voice pause, so the channels
   * are muted and their sounds run on silently (a long effect may be over when the game goes on).
   */
  pauseEffects(paused: boolean): void {
    if (!this.enabled) return;
    if (paused && !this.pausedFx) {
      this.pausedFx = new Map();
      for (let ch = 1; ch <= 4; ch++) {
        const level = this.mixer.level(ch);
        if (level === undefined) continue;
        this.pausedFx.set(ch, level);
        this.mixer.setChannelVolume(ch, 0);
      }
    } else if (!paused && this.pausedFx) {
      for (const [ch, level] of this.pausedFx) if (this.mixer.isPlaying(ch)) this.mixer.setChannelVolume(ch, level);
      this.pausedFx = null;
    }
  }

  /** Bytes of `MUSIC\<name>` for MUSIC commands (the files are read ahead: the command itself cannot wait). */
  addTrack(name: string, bytes: Uint8Array): void {
    this.tracks.set(name.toUpperCase(), bytes);
  }

  track(name: string): Uint8Array | undefined {
    return this.tracks.get(name.toUpperCase());
  }

  /** A scene was loaded: its sound list and the archive the `.S22` speech files come from. */
  loadScene(bank: SceneSounds | null, archive: Pak): void {
    this.sfx.loadScene(bank);
    this.sceneArchive = archive;
  }

  // --- speech -----------------------------------------------------------------------------------

  /**
   * Sound_PickTalkChannel: of the two channels of the requested side (1/3 left, else 2/4 right) the first one
   * that is idle and not reserved; none free = the request itself. The right branch tests the reservation of the
   * *left* list entries (1, 3) - kept.
   */
  pickTalkChannel(channel: number): number {
    const left = channel === 1 || channel === 3;
    const order = left ? [1, 3] : [2, 4];
    for (let i = 0; i < 2; i++) {
      if (
        !this.mixer.isPlaying(swapChannel(order[i], this.config.revStereo)) &&
        !this.sfx.isReserved(left ? order[i] : [1, 3][i])
      ) {
        return order[i];
      }
    }
    return channel;
  }

  /**
   * Sound_PlayTalk (volume 0x40 of the call, scaled by TalkVol / 64): plays `<file>` (.S22) from the scene
   * archive on a free channel of the requested side and returns its length in seconds; null = no sound (no device,
   * or the scene has no such file), the line then runs on its text.
   */
  playVoice(channel: number, file: string): number | null {
    if (!this.enabled) return null;
    let archive = this.sceneArchive;
    let entry = archive?.find(file);
    if (!entry) {
      archive = this.speechFallback;
      entry = archive?.find(file);
    }
    if (!archive || !entry) return null;
    let prepared;
    try {
      prepared = prepareSound(new Sound(archive.read(entry), "S22"));
    } catch {
      return null;
    }
    const ch = this.pickTalkChannel(channel);
    this.sfx.setTalkChannel(ch, true);
    this.talkChannels.add(ch);
    const volume = Math.trunc((0x40 * this.config.talkVolume) / 64);
    this.mixer.play(swapChannel(ch, this.config.revStereo), prepared, {
      volume: gameVolumeToLevel(volume),
    });
    return soundDuration(prepared);
  }

  /** End of a line (Talk_FaceStep): Snd_StopChannel of the channels 1..4 that carry speech; the marks go. */
  stopVoices(): void {
    for (let ch = 1; ch <= 4; ch++) {
      if (!this.talkChannels.has(ch)) continue;
      this.mixer.stop(swapChannel(ch, this.config.revStereo));
      this.sfx.setTalkChannel(ch, false);
    }
    this.talkChannels.clear();
  }

  // --- music ------------------------------------------------------------------------------------

  /**
   * Music_DuckDown (Caption_ShowSpeaker, a line in a face window) / Music_DuckUp (end of a line),
   * only with MusDownOnOff. The target is computed by code the decompiler lost (`__ftol()` without argument):
   * **hypothesis** - half of the music volume down, the full volume up.
   */
  duckMusic(down: boolean): void {
    if (!this.enabled || !this.config.musicDown) return;
    const full = this.music.musicVolume * this.music.scale;
    this.music.duck(down ? "down" : "up", 1, Math.trunc(down ? full / 2 : full));
  }

  /** MUSICVOLUME (Script_ExecStep case 0x90): the multiplier and the channel volume at once. */
  setMusicScale(scale: number): void {
    this.music.scale = scale;
    const volume = Math.trunc(this.music.musicVolume * scale);
    this.music.volume = volume;
    this.mixer.setChannelVolume(MUSIC_CHANNEL, gameVolumeToLevel(volume));
  }

  /** The music volume while it fades before a film (Sound_SetChannelVolume(5, v) in the loop), game units. */
  setMusicFade(volume: number): void {
    this.music.volume = volume;
    this.mixer.setChannelVolume(MUSIC_CHANNEL, gameVolumeToLevel(volume));
  }

  /** Before a film: the music fades to 0 and stops, the channels 1..4 are stopped. */
  silence(): void {
    this.music.stop();
    this.stopVoices();
    this.mixer.stopAll();
  }

  /** Volume level of a film's sound (channel 1 at `<< 1`). */
  get movieLevel(): number {
    return gameVolumeToLevel(this.config.musicVolume);
  }
}
