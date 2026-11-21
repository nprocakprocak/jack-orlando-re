// Script commands of the effect player.

import { JACK, type Command } from "../script/compiler";
import type { SceneSounds } from "./bank";
import type { AnimaEffect, SfxEnv, SfxResult } from "./sfx";

/** Command codes handled here. MUSIC / MUSICVOLUME belong to MusicPlayer.command. */
export const SFX_COMMANDS = {
  EFFECT: 0x1e,
  EFFECTVOLUME: 0x20,
  WALKEFFECT: 0x42,
  ANIMAEFFECT: 0x54,
  WAITWHILEEFFECT: 0x67,
  UNLOCKCANAL: 0x86,
} as const;

/** The player fields `command` reads. The class casts `this` to this shape. */
export interface SfxCommandState {
  sounds: SceneSounds | null;
  effect(channel: number, sound: number, volume: number): void;
  effectVolume(sound: number, volume: number): void;
  isEffectPlaying(sound: number): boolean;
  unlockChannel(channel: number): void;
  setJackStep(slot: number, sound: number): void;
  setWalkEffect(person: number, frame: number, sound: number, volume: number, enabled: boolean): void;
  addAnimaEffect(anim: number, e: AnimaEffect): void;
}

function soundRef(this: SfxCommandState, cmd: Command): number {
  const ref = cmd.refs.find((r) => r[1] === "sound");
  return ref ? (this.sounds?.find(String(ref[2])) ?? -1) : -1;
}

/**
 * Runs one of SFX_COMMANDS; undefined for any other code. WAITWHILEEFFECT answers "repeat"
 * while the sound plays, everything else "done".
 */
export function command(this: SfxCommandState, cmd: Command, env: SfxEnv): SfxResult | undefined {
  switch (cmd.code) {
    case SFX_COMMANDS.EFFECT: // EFFECT sound channel _ volume: a[0] channel, a[2] volume
      this.effect(env.arg(0), soundRef.call(this, cmd), env.arg(2));
      return "done";
    case SFX_COMMANDS.EFFECTVOLUME: // EFFECTVOLUME sound _ volume: a[0] volume
      this.effectVolume(soundRef.call(this, cmd), env.arg(0));
      return "done";
    case SFX_COMMANDS.WAITWHILEEFFECT:
      return this.isEffectPlaying(soundRef.call(this, cmd)) ? "repeat" : "done";
    case SFX_COMMANDS.UNLOCKCANAL:
      this.unlockChannel(env.arg(0));
      return "done";
    case SFX_COMMANDS.WALKEFFECT: {
      const sound = soundRef.call(this, cmd);
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
          sound: soundRef.call(this, cmd),
          volume: env.arg(6),
        });
      }
      return "done";
    }
    default:
      return undefined;
  }
}
