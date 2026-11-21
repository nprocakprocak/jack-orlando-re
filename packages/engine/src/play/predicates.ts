// Pure checks the playable game calls: a death film, a caption's screen x, Jack's refusal, the coat.
import type { Side } from "../dialog";
import { ENDIF, IF_CODES } from "../script/compiler";
import type { Interpreter } from "../script";

/** The film of `RUNAVX` that ends the game as a death (every one except `OUTRO.AVX`, `Game_Run`). */
export function isDeathFilm(film: string): boolean {
  return !/^OUTRO(\.AVX)?$/i.test(film);
}

/**
 * [engine]: does an active macro run, without a condition in between, to a `RUNAVX` of a death film? Scans the commands from
 * each active macro's next one. An `IF var value` block is entered when the variable has that value now (`GANGSTERZY`: `IF GUN 0` ...
 * `DONOTHING 180`, `RUNAVX Z32A`; `POKAZANIE-PRAWO` of SC038: `IF BYLAPRZEBITKA 1`); any other condition counts as not entered. `GOTOSCENE` /
 * `DEACTIVESELF` end the scan. `CZEKAJ` of SC051 (`DONOTHING 400`, the player may still act) is not a death; it starts with `ZABJACK`.
 * Evaluated every frame, nothing is remembered: a variable that changes ends the sequence at once.
 */
export function deathAhead(it: Pick<Interpreter, "macros" | "program" | "vars">): boolean {
  const cmds = it.program.commands;
  for (const m of it.macros) {
    if (!m.active) continue;
    let skip = 0; // depth inside a block that is not entered
    for (let pc = m.pc; pc < m.start + m.count; pc++) {
      const c = cmds[pc];
      if (skip > 0) {
        if (IF_CODES.includes(c.code)) skip++;
        else if (c.code === ENDIF) skip--;
      } else if (IF_CODES.includes(c.code)) {
        // `IF var value` (0x1b) is decided by the variable now; every other condition (answers, mouse, IFF) is unknown = not entered
        const ref = c.code === 0x1b ? c.refs.find((r) => r[0] === 2 && r[1] === "var") : undefined;
        if (!ref || it.vars.get(ref[2] as string) !== c.a[0]) skip = 1;
      } else if (c.word === "RUNAVX" && isDeathFilm(c.n1)) return true;
      else if (c.word === "GOTOSCENE" || c.word === "DEACTIVESELF") break;
    }
  }
  return false;
}

/**
 * Screen x of a caption line. The original draws the caption in world coordinates (`Caption_Draw`), so a line that starts while
 * the view still scrolls rides away with the scene. (deviation, user's request): the line stays at the screen position it had when it
 * started (`scrollAtStart`). With SHOWFACE waiting for the end of a scroll (`Script_ExecStep` case 0x17) this only matters for a TALK that
 * starts during a scroll without a face.
 */
export function captionLineX(worldX: number, scrollAtStart: number): number {
  return worldX - scrollAtStart;
}

/**
 * Which refusal comes next and where it is shown: the counter goes up by one mod 3 (it is 0 at the start of a game,
 * so the first refusal is the second line); a click right of the middle of the screen (`clickX > scrollX + 320`) opens Jack's face in the
 * left window (channel 1), else in the right one (channel 2); the caption is on that side.
 */
export function jackRefusal(
  counter: number,
  clickX: number,
  scrollX: number,
): { index: number; side: Side; channel: number } {
  const left = scrollX + 0x140 < clickX;
  return { index: (counter + 1) % 3, side: left ? "L" : "R", channel: left ? 1 : 2 };
}

/** `LAST` that the Ctrl point 3 gives for the chapter (Game_Run, the Ctrl points of the coat): 1 -> 6, 2 -> 32, 3 -> 75; chapter 4 leaves it as it is. */
export function mapLast(chapter: number): number | null {
  return chapter === 1 ? 6 : chapter === 2 ? 0x20 : chapter === 3 ? 0x4b : null;
}

/** `Sprite_ClickMacro`: the target is Jack's sprite, the hand is empty and `g_jackIsMenu` is set: `g_coatRequest = 1`. */
export function jackClickAsksCoat(target: string, itemInHand: boolean, jackIsMenu: boolean): boolean {
  return target === "JACK" && !itemInHand && jackIsMenu;
}
