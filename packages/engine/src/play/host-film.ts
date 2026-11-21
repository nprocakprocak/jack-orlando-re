// Films the script starts in a window of the scene, or as a movie that replaces it.

import type { Command, CommandContext, CommandResult } from "../script";
import type { HostState } from "./host-state";

/**
 * RUNGLOBALFILMP's place (Script_ExecStep case 0x6d, instructions): `x = y = -100` means "at Jack":
 * x = ftol(g_jackX), y = ftol(g_jackY - 100) (a short each), otherwise the script's numbers.
 */
export function globalFilmTarget(x: number, y: number, jack: { x: number; y: number }): [number, number] {
  if (x !== -100 || y !== -100) return [x, y];
  const s16 = (v: number) => (Math.trunc(v) << 16) >> 16;
  return [s16(jack.x), s16(jack.y - 100)];
}

export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
    switch (cmd.code) {
      case 0x23: // RUNFILMP film x y mode (Film_Play: blocks the whole game, the script goes on afterwards)
        if (!this.env.runFilm) return "unhandled";
        this.env.runFilm(cmd.n1, ctx.arg(0), ctx.arg(1), ctx.arg(2));
        return "done";
      case 0x6e: {
        // RUNGLOBALFILMP film x y mode (Script_ExecStep case 0x6d -> Film_Play(1): the film is a section of GLOBAL.FCM)
        if (!this.env.runFilm) return "unhandled";
        const [x, y] = globalFilmTarget(ctx.arg(0), ctx.arg(1), this.env.scene.pose());
        this.env.runFilm(cmd.n1, x, y, ctx.arg(2), true);
        return "done";
      }
      case 0x83: // RUNAVX film scene
        if (!this.env.runMovie) return "unhandled";
        this.env.runMovie(cmd.n1, cmd.n2);
        return "done";
      default:
        return "unhandled";
    }
}
