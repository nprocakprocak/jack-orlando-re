// Sound and music commands.

import type { Command, CommandContext, CommandResult } from "../script";
import { JACK } from "../script";
import type { HostState } from "./host-state";

/** The sound commands of SfxPlayer (EFFECT...) with the names of this scene. */
export function sound(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
  const audio = this.env.audio;
  if (!audio) return "unhandled";
  const sc = this.env.scene;
  const r = audio.sfx.command(cmd, {
    person: (n) => sc.persons.find(n),
    anim: (n) => sc.scene.objectAnims.findIndex((x) => x.name === n),
    arg: (i) => ctx.arg(i),
  });
  // the persons module plays the footsteps of the persons from its own table (persons.ts `setWalkEffect`)
  if (cmd.code === 0x42 && cmd.a[3] !== JACK) {
    const p = sc.persons.get(cmd.n1);
    const ref = cmd.refs.find((x) => x[1] === "sound");
    const sound = ref ? (audio.sfx.sounds?.find(String(ref[2])) ?? -1) : -1;
    p?.setWalkEffect(ctx.arg(0), ctx.arg(2) >= 1 ? sound : -1, ctx.arg(5));
  }
  return r === "repeat" ? "repeat" : "done";
}

export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
  const a = cmd.a;
  switch (cmd.code) {
    case 0x3f: {
      // MUSIC name fadeOut fadeIn
      const audio = this.env.audio;
      if (!audio) return "unhandled";
      const track = audio.track(cmd.n1);
      if (!track) {
        // a track that was not read (a missing file) plays nothing; the name is remembered as without sound
        audio.music.trackName = cmd.n1;
        return "done";
      }
      let r = audio.music.command(cmd.n1, a[0], a[1], () => track);
      if (r === "retry" && ctx.synchronous) {
        // [PRE] steps this macro in a loop with the 14 ms timer (Game_Tick14ms) running meanwhile: the fade-out
        // of the old track is over before the scene is shown. Here the loop has no clock, so the fade ticks are run at once.
        for (let n = 0; n < 10000 && audio.music.fadingOut; n++) audio.music.tick14ms();
        r = audio.music.command(cmd.n1, a[0], a[1], () => track);
      }
      return r === "retry" ? "repeat" : "done";
    }
    case 0x91: // MUSICVOLUME f
      if (!this.env.audio) return "unhandled";
      this.env.audio.setMusicScale(cmd.f ?? 1);
      return "done";
    default:
      return "unhandled";
  }
}
