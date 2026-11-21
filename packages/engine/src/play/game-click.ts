// A click on the scene, and the buttons that ask for the coat.

import type { interpreterPort } from "../areas";
import { type ClickOutcome } from "../areas";
import { planWalk } from "../walk";
import type { GameState } from "./game-state";
import type { PlayInput } from "./types";

export function onClick(
  this: GameState,
  outcome: ClickOutcome,
  click: { x: number; y: number },
  port: ReturnType<typeof interpreterPort>,
): void {
  const sc = this.scene!;
  if (outcome.kind === "ignored") return;
  this.clickX = click.x;
  this.lastClick = { x: click.x, y: click.y, outcome: outcome.kind };
  if (outcome.kind === "walk") {
    port.interruptOutMacros(-1);
    const plan = planWalk(sc.world, sc.walker, { x: Math.trunc(click.x), y: Math.trunc(click.y) });
    if (plan) sc.walkPlan(plan);
  } else if (outcome.kind === "putBack") {
    // (tail): a click with the item on nothing puts it back into the coat; Cursor_ResetMode
    this.inv().putBack();
    this.cursor.mode = this.verbMode = 0;
  } else if (outcome.kind === "refuse") {
    this.jackRefuses(click.x);
  }
}

/** `g_coatRequest` (Game_Run 4150): the right button with an item in hand (mode 5) or the middle one asks for the coat. */
export function mouseRequests(this: GameState, input: PlayInput): void {
  const e = this.edges(input);
  if (this.bar) return; // the bar replaces the coat
  if ((e.right && this.cursor.mode === 5) || e.middle) this.coatRequest = true;
}
