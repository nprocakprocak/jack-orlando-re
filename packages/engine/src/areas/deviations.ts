// Approved deviations of the hand cursor from the original. One list, one place.
// ("Auto w SC070 ")

/** A macro that exists but does nothing under the condition: the hand must not light up over its target. */
export interface InertMacro {
  /** scene the entry belongs to (documentation; the interpreter does not know its scene, see `isInertMacro`) */
  scene: string;
  /** exact macro name "<VERB>-<TARGET>" */
  macro: string;
  /** variable that decides; the entry applies only when it exists (in the original it is used by this scene only) */
  variable: string;
  /** the macro does nothing when the variable's value is not 0 */
  inertWhenSet: boolean;
}

/**
 * SC070 `BRANIE-AUTO`: `IF MAKARTE ... ENDIF` around the whole body (the card is taken once, `MAKARTE = 1`
 * afterwards). Verb PATRZENIE-AUTO is not listed: it still plays.
 * Matching without the scene name: MAKARTE occurs in SC070 only (checked on the .MCC of all scenes).
 */
export const INERT_MACROS: readonly InertMacro[] = [
  { scene: "SC070", macro: "BRANIE-AUTO", variable: "MAKARTE", inertWhenSet: true },
];

/** True when the cursor test must treat `name` as having no reaction. `get` returns undefined for an unknown variable. */
export function isInertMacro(name: string, get: (variable: string) => number | undefined): boolean {
  return INERT_MACROS.some((d) => {
    if (d.macro !== name) return false;
    const v = get(d.variable);
    return v !== undefined && (v !== 0) === d.inertWhenSet;
  });
}

/**
 * SC087 `POKAZANIE-DOL`: the macro picks the rope descent with `IFF MOUSEX > 320`, but the ladder area `DOL #0` reaches x = 338,
 * so its right edge (x 321-338) starts the rope descent even when the anchor with the rope was never placed. Fix: without the rope
 * (the area `DOL #1`, x 322-365, is enabled by `95KTZW_I.BM-GZYMS.PBM` with `SETAREA DOL 1 1`; `[PRE]` disables it) the macro sees MOUSEX = 320,
 * i.e. the ladder branch. With the rope nothing changes. Only the value read by this macro is changed; the scripts and the area outlines are not.
 */
export const ROPE_DESCENT_FIX = { scene: "SC087", macro: "POKAZANIE-DOL", area: "DOL", ropeDup: 1, branchX: 320 } as const;

/**
 * The MOUSEX the started macro must see. `ropeAreaEnabled` = the state of `DOL` dup 1 (`AreaState.enabled`). Other macros/scenes: `mouseX` unchanged.
 * Call right after `start(macro)` returned >= 0, before the interpreter ticks (the variable is refreshed at the start of the next frame).
 */
export function macroMouseX(scene: string, macro: string, mouseX: number, ropeAreaEnabled: boolean): number {
  const f = ROPE_DESCENT_FIX;
  if (scene !== f.scene || macro !== f.macro || ropeAreaEnabled) return mouseX;
  return Math.min(mouseX, f.branchX);
}
