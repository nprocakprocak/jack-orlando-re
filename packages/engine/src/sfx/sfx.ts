// Sound effects of scene scripts on the mixer. No DOM / Web Audio.
// Original: Sound_PlayIndexed, channel choice, EFFECT / EFFECTVOLUME /
// WALKEFFECT / ANIMAEFFECT / WAITWHILEEFFECT / UNLOCKCANAL in Script_ExecStep,
// Jack_PlayStep, per-step person effects in Game_Run.

import { gameVolumeToLevel, type Mixer } from "../audio/mixer";
import { JACK, type Command } from "../script/compiler";
import { SCREEN_WIDTH } from "../core/constants";
import type { SceneSounds } from "./bank";
/** Width of the screen: the pan formula of the footsteps uses it (= 640.0). */
export { SCREEN_WIDTH };
/** Footstep volume of Jack (= 64.0), before the scale. */
export const STEP_VOLUME = 64;
/** SFXVol of a fresh configuration (Sys_InitConfigAndCd: 0x20), range 0..64. */
export const DEFAULT_SFX_VOLUME = 32;
/** Persons with a WALKEFFECT table (17 rows of 18 frames, Game_Run resets them to -1). */
export const WALK_PERSONS = 17;
export const WALK_FRAMES = 18;
/** ANIMAEFFECT entries per animation (arrays of 0x1e shorts). */
export const ANIMA_EFFECTS_MAX = 30;

/** Channel order when a request asks for 1 or 3 channels, then the order for every other request. */
const LEFT_ORDER = [1, 3, 2, 4];
const RIGHT_ORDER = [2, 4, 1, 3];

/** with the option RevStereoOnOff the channels 1/2, 3/4, 5/6 trade places. */
export function swapChannel(ch: number, swapped: boolean): number {
  if (!swapped) return ch;
  return ch >= 1 && ch <= 6 ? (ch % 2 === 1 ? ch + 1 : ch - 1) : ch;
}

/**
 * Volumes of the two footstep channels (Jack_PlayStep, Game_Run): the sound is
 * played twice, on channel 1 (left speaker) and channel 2 (right) with the volume spread by the
 * x of the walker, `x / (scroll + 640)` to the right. `x` is the world x of the feet, `scroll` the
 * left edge of the screen - the original divides by scroll + 640 even though x is a
 * world position, so the pan leans to the left in scrolled scenes (kept). Truncated like __ftol.
 */
export function stereoVolumes(volume: number, scale: number, x: number, scroll: number): { left: number; right: number } {
  const total = volume * scale;
  const width = scroll + SCREEN_WIDTH;
  return {
    left: Math.trunc((total * (SCREEN_WIDTH - x + scroll)) / width),
    right: Math.trunc((total * x) / width),
  };
}

export interface SfxOptions {
  /** false = the machine has no sound, every effect is ignored */
  soundEnabled?: boolean;
  /** option SFXVol, 0..64 */
  sfxVolume?: number;
  /** option RevStereoOnOff */
  swapChannels?: boolean;
}

/** One ANIMAEFFECT entry: plays when the animation shows `image` of REC sequence `rec`. */
export interface AnimaEffect {
  image: number;
  rec: number;
  channel: number;
  sound: number;
  volume: number;
}

/** What `command` needs to know about the scene: names of persons and animations -> indices. */
export interface SfxEnv {
  /** index of a person (-1 if none); Jack is recognised by the compiler (`a[3] == 0x66`) */
  person(name: string): number;
  anim(name: string): number;
  /** value of argument slot (variables are allowed in the volume slots) */
  arg(slot: number): number;
}

/** Result of `command`, same words as script/interpreter CommandResult. */
export type SfxResult = "done" | "repeat";

/** Command codes handled here. MUSIC / MUSICVOLUME belong to MusicPlayer.command. */
export const SFX_COMMANDS = {
  EFFECT: 0x1e,
  EFFECTVOLUME: 0x20,
  WALKEFFECT: 0x42,
  ANIMAEFFECT: 0x54,
  WAITWHILEEFFECT: 0x67,
  UNLOCKCANAL: 0x86,
} as const;

export class SfxPlayer {
  readonly options: Required<SfxOptions>;
  private bank: SceneSounds | null = null;
  /** channel reserved by EFFECT with channel 11..14 (until UNLOCKCANAL / idle / new scene) */
  private readonly reserved: boolean[] = new Array(17).fill(false);
  /** channel carries speech (set by TALK) */
  private readonly talk: boolean[] = new Array(17).fill(false);
  /** channel taken by the first half of a stereo pair (flag 1 plays) */
  private readonly forced: boolean[] = new Array(17).fill(false);
  /** channel of the last playback of each sound */
  private readonly lastChannel: number[] = [];
  /** sound index playing on a channel (-2 = speech, -1 = none) */
  private readonly channelSound: number[] = new Array(17).fill(-1);
  /** volume the channel was started with (after doubling) */
  private readonly channelVolume: number[] = new Array(17).fill(0);
  /** g_personWalkEffectSound / Volume: sound index (-1 = none) and volume per person and frame */
  private readonly walkSound = new Int16Array(WALK_PERSONS * WALK_FRAMES).fill(-1);
  private readonly walkVolume = new Int16Array(WALK_PERSONS * WALK_FRAMES);
  private readonly anima = new Map<number, AnimaEffect[]>();
  /** g_stepToggle: which of the two footstep sounds is next (0 = KROK2, 1 = KROK1) */
  private stepToggle = 0;
  step1 = -1;
  step2 = -1;

  constructor(
    private readonly mixer: Mixer,
    opts: SfxOptions = {},
  ) {
    this.options = {
      soundEnabled: opts.soundEnabled ?? true,
      sfxVolume: opts.sfxVolume ?? DEFAULT_SFX_VOLUME,
      swapChannels: opts.swapChannels ?? false,
    };
  }

  /**
 * New scene: its sound list replaces the old one and the per-scene tables are cleared
 * (Sound_LoadSceneSfx: g_sndStep1/2 = -1, then KROK1/KROK2 found by name; Game_Run start:
 * walk effects -1, reserved and speech flags 1..4 cleared, g_stepToggle = 0; channels 1..4 stopped at
 * the end of Scene_Load, channels 5+ (music) are left alone).
 */
  loadScene(bank: SceneSounds | null): void {
    this.bank = bank;
    this.step1 = bank?.step1 ?? -1;
    this.step2 = bank?.step2 ?? -1;
    this.lastChannel.length = 0;
    this.walkSound.fill(-1);
    this.walkVolume.fill(0);
    this.anima.clear();
    for (let ch = 1; ch <= 4; ch++) {
      this.reserved[ch] = false;
      this.talk[ch] = false;
    }
    this.stepToggle = 0;
    // end of Scene_Load: Snd_StopChannel(1..4) - looped effects (snoring of SC044) die with the scene
    for (let ch = 1; ch <= 4; ch++) {
      this.mixer.stop(ch);
      this.channelSound[ch] = -1;
      this.forced[ch] = false;
    }
  }

  get sounds(): SceneSounds | null {
    return this.bank;
  }

  // ---- channel choice -------------------------------------------------------------------

  private busy(ch: number): boolean {
    return this.mixer.isPlaying(swapChannel(ch, this.options.swapChannels));
  }

  /**
 * the scripts ask for a channel and get a free one. A request for 1 or 3 looks
 * at 1, 3, 2, 4 in this order, anything else at 2, 4, 1, 3; the first one that is idle, not
 * reserved and not speaking wins (or one marked by the first half of a pair, `forced`). With no
 * candidate the requested channel stays and cuts what plays there. A reserved or speaking
 * channel is then traded for the first of the list that is not. `found` is false when nothing
 * better than the request turned up (a footstep then plays nothing).
 */
  private pick(channel: number, flag: number): { channel: number; found: boolean } {
    const order = channel === 1 || channel === 3 ? LEFT_ORDER : RIGHT_ORDER;
    let found = false;
    for (const k of order) {
      if ((!this.busy(k) && !this.reserved[k] && !this.talk[k]) || this.forced[k]) {
        channel = k;
        found = true;
        if (flag === 0) this.forced[k] = false;
        break;
      }
    }
    if (this.reserved[channel]) {
      for (const k of order) {
        if (!this.reserved[k]) {
          channel = k;
          found = true;
          break;
        }
      }
    }
    if (this.talk[channel]) {
      for (const k of order) {
        if (!this.talk[k]) {
          channel = k;
          found = true;
          break;
        }
      }
    }
    return { channel, found };
  }

  // ---- playing --------------------------------------------------------------------------

  /**
 * Sound_PlayIndexed: sound `sound` of the scene list on `channel` (1..10: asks for a free
 * channel; 11..16: exactly channel - 10, and reserves it), `volume` 0..64 (anything above is
 * dropped, the 16-bit wrap of negative values included), `flag` 1 = footstep (nothing plays when
 * no channel was found; the channel is then marked for the second half of the pair).
 * Returns true when something started.
 */
  playIndexed(channel: number, sound: number, volume: number, flag = 0): boolean {
    if (sound < 0 || !this.options.soundEnabled) return false;
    volume &= 0xffff;
    if (volume > 64) return false; // cmp ax, 0x41 / jge
    volume = Math.min(volume * 2, 64);
    channel &= 0xff;
    if (channel > 10) {
      channel -= 10;
      this.reserved[channel] = true;
    } else {
      const p = this.pick(channel, flag);
      channel = p.channel;
      if (flag === 1) {
        if (!p.found) return false;
        this.forced[channel] = true;
      }
    }
    const pcm = this.bank?.sounds[sound];
    const level = gameVolumeToLevel(Math.trunc((volume * this.options.sfxVolume) / 64));
    // the exe plays whatever buffer the index names; a missing .PSD (undefined) is silence
    const started = pcm
      ? this.mixer.play(swapChannel(channel, this.options.swapChannels), pcm, { volume: level }) !== null
      : false;
    this.lastChannel[sound] = channel;
    this.channelSound[channel] = sound;
    this.channelVolume[channel] = volume;
    return started;
  }

  /**
 * EFFECT: channel 0 = both stereo channels (1 and 2, one after the other), otherwise the given one.
 * Insertion frames (`insertionFrame`) and ANIMAEFFECT (`animFrameShown`) use the same rule.
 */
  effect(channel: number, sound: number, volume: number): void {
    if (channel === 0) {
      this.playIndexed(1, sound, volume);
      this.playIndexed(2, sound, volume);
    } else this.playIndexed(channel, sound, volume);
  }

  /** Sound of an insertion frame (ICS fields +0x1c/+0x1e/+0x20, Game_Run): -1 = none. */
  insertionFrame(sound: number, channel: number, volume: number): void {
    if (sound >= 0) this.effect(channel, sound, volume);
  }

  /** Channel the sound was last started on, as stored (before the stereo swap). */
  channelOf(sound: number): number {
    return this.lastChannel[sound] ?? 0;
  }

  /**
 * EFFECTVOLUME: volume 0 stops the channel of the sound, any other value sets its volume (a
 * "game volume" doubled like in EFFECT, but neither capped at 64 nor scaled by SFXVol). It does
 * not check that the sound is still the one on the channel.
 */
  effectVolume(sound: number, volume: number): void {
    const ch = swapChannel(this.channelOf(sound), this.options.swapChannels);
    if (volume === 0) this.mixer.stop(ch);
    else this.mixer.setChannelVolume(ch, gameVolumeToLevel(volume));
  }

  /**
 * WAITWHILEEFFECT: true while the sound plays on the channel it started on and that channel
 * still carries this sound (not replaced by another one); the command then runs again on the
 * next tick (case 0x66). Always false without sound.
 */
  isEffectPlaying(sound: number): boolean {
    if (!this.options.soundEnabled || sound < 0) return false;
    const ch = this.channelOf(sound);
    return this.busy(ch) && this.channelSound[ch] === sound;
  }

  /** UNLOCKCANAL: `[ch] = 0`. */
  unlockChannel(channel: number): void {
    this.reserved[channel] = false;
  }

  isReserved(channel: number): boolean {
    return this.reserved[channel] === true;
  }

  /** TALK: Sound_PlayTalk marks its channel, Talk_FaceStep clears it when the line ends. */
  setTalkChannel(channel: number, speaking: boolean): void {
    this.talk[channel] = speaking;
  }

  /**
 *, called once per Game_Run pass: reservations and pair marks of the channels 1..4
 * that are no longer playing are dropped.
 */
  tick(): void {
    for (let ch = 1; ch <= 4; ch++) {
      if (!this.busy(ch)) {
        this.reserved[ch] = false;
        this.forced[ch] = false;
      }
    }
  }

  // ---- steps ----------------------------------------------------------------------------

  /** WALKEFFECT of a person other than Jack (case 0x41). */
  setWalkEffect(person: number, frame: number, sound: number, volume: number, enabled: boolean): void {
    if (person < 0 || person >= WALK_PERSONS || frame < 0 || frame >= WALK_FRAMES) return;
    const i = person * WALK_FRAMES + frame;
    this.walkSound[i] = enabled ? sound : -1;
    if (enabled) this.walkVolume[i] = volume;
  }

  walkEffectOf(person: number, frame: number): { sound: number; volume: number } {
    const i = person * WALK_FRAMES + frame;
    return { sound: this.walkSound[i] ?? -1, volume: this.walkVolume[i] ?? 0 };
  }

  /**
 * WALKEFFECT JACK slot sound: slot 0 sets KROK1's index, any other slot KROK2's (a[0] == 0 in
 * case 0x41).
 */
  setJackStep(slot: number, sound: number): void {
    if (slot === 0) this.step1 = sound;
    else this.step2 = sound;
  }

  /**
 * A person (not Jack) shows walk frame `frame`: its WALKEFFECT sound plays
 * as a stereo pair, volume `volume * scale` spread by `x`, flag 1.
 */
  walkStep(person: number, frame: number, scale: number, x: number, scroll: number): void {
    if (person < 0 || person >= WALK_PERSONS || frame < 0 || frame >= WALK_FRAMES) return;
    const { sound, volume } = this.walkEffectOf(person, frame);
    if (sound < 0) return;
    const v = stereoVolumes(volume, scale, x, scroll);
    this.playIndexed(1, sound, v.left, 1);
    this.playIndexed(2, sound, v.right, 1);
  }

  /**
 * Jack_PlayStep: footstep of Jack, `scale` = g_jackScale (half of the scale at that call).
 * KROK2 and KROK1 alternate, starting with KROK2; right channel first, then left. The caller
 * decides when: see `jackStepFrame`.
 */
  jackStep(scale: number, jackX: number, scroll: number): void {
    const sound = this.stepToggle === 0 ? this.step2 : this.step1;
    const v = stereoVolumes(STEP_VOLUME, scale, jackX, scroll);
    this.playIndexed(2, sound, v.right, 1);
    this.playIndexed(1, sound, v.left, 1);
    this.stepToggle = this.stepToggle === 0 ? 1 : 0;
  }

  /** Whether Jack's walk frame makes a step. */
  jackStepFrame(walkFrame: number): boolean {
    return (walkFrame === 0 && this.step1 >= 0) || (walkFrame === 6 && this.step2 >= 0);
  }

  // ---- animation sounds -----------------------------------------------------------------

  /** ANIMAEFFECT: one more entry of the animation (the exe keeps 30 per animation, no check). */
  addAnimaEffect(anim: number, e: AnimaEffect): void {
    const list = this.anima.get(anim) ?? [];
    list.push(e);
    this.anima.set(anim, list);
  }

  animaEffects(anim: number): readonly AnimaEffect[] {
    return this.anima.get(anim) ?? [];
  }

  /**
 * An object animation advances to `image` while it plays REC sequence `rec` (Game_Run,
 * once per frame change): the first entry with this image and sequence plays.
 */
  animFrameShown(anim: number, image: number, rec: number): boolean {
    for (const e of this.anima.get(anim) ?? []) {
      if (e.image === image && e.rec === rec) {
        this.effect(e.channel, e.sound, e.volume);
        return true;
      }
    }
    return false;
  }

  // ---- script commands ------------------------------------------------------------------

  private soundRef(cmd: Command): number {
    const ref = cmd.refs.find((r) => r[1] === "sound");
    return ref ? (this.bank?.find(String(ref[2])) ?? -1) : -1;
  }

  /**
 * Runs one of SFX_COMMANDS; undefined for any other code. WAITWHILEEFFECT answers "repeat"
 * while the sound plays, everything else "done".
 */
  command(cmd: Command, env: SfxEnv): SfxResult | undefined {
    switch (cmd.code) {
      case SFX_COMMANDS.EFFECT: // EFFECT sound channel _ volume: a[0] channel, a[2] volume
        this.effect(env.arg(0), this.soundRef(cmd), env.arg(2));
        return "done";
      case SFX_COMMANDS.EFFECTVOLUME: // EFFECTVOLUME sound _ volume: a[0] volume
        this.effectVolume(this.soundRef(cmd), env.arg(0));
        return "done";
      case SFX_COMMANDS.WAITWHILEEFFECT:
        return this.isEffectPlaying(this.soundRef(cmd)) ? "repeat" : "done";
      case SFX_COMMANDS.UNLOCKCANAL:
        this.unlockChannel(env.arg(0));
        return "done";
      case SFX_COMMANDS.WALKEFFECT: {
        const sound = this.soundRef(cmd);
        if (cmd.a[3] === JACK) this.setJackStep(env.arg(0), sound);
        else this.setWalkEffect(env.person(cmd.n1), env.arg(0), sound, env.arg(5), env.arg(2) >= 1);
        return "done";
      }
      case SFX_COMMANDS.ANIMAEFFECT: {
        const anim = env.anim(cmd.n1);
        if (anim >= 0) {
          this.addAnimaEffect(anim, {
            image: env.arg(0),
            rec: env.arg(5),
            channel: env.arg(1),
            sound: this.soundRef(cmd),
            volume: env.arg(6),
          });
        }
        return "done";
      }
      default:
        return undefined;
    }
  }
}
