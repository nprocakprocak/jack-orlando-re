# Script and scene-data changes in the engine

Places where the engine **changes what a `.MCC` script or scene data does** (`.ACE`, sprites) instead of running it as the original does.

The engine runs scripts and scene data as the original does, **including the original bugs**. Fixes of script bugs belong in a separate mechanism that rewrites scripts or data **before they run** (a patch applied to a macro or to scene areas at load), not in the engine itself. Until that mechanism exists, the changes below stay in the engine.

## 1. Script and scene-data changes

| Scene | What the engine overrides | Where |
|---|---|---|
| `SC087` | The show-macro for `DOL`, when the rope is not fitted (duplicate area `DOL` 1 is off), sees `MOUSEX` ≤ 320, so it always takes the ladder branch. In the original the right edge of `DOL #0` (x 321–338) starts the rope descent with no anchor. | `packages/engine/src/areas/deviations.ts` (`ROPE_DESCENT_FIX`, `macroMouseX`), hooked from `packages/engine/src/play/game.ts`. See [areas.md](areas.md) |
| `SC070` | When `MAKARTE ≠ 0` the hand cursor does not light up over the car. The take-macro for the car does nothing in that case anyway (the whole macro is inside `IF MAKARTE`). The script runs unchanged. Only the cursor reaction changes. | `packages/engine/src/areas/deviations.ts` (`INERT_MACROS`, `isInertMacro`), used by `packages/engine/src/areas/click.ts`. See [areas.md](areas.md) |
| `SC000D` (the map) | Click areas from `.ACE` are replaced by rectangles in which the `CZYxxx` macros light the caption. In the original the port reacts on half the frame and the whole top band of the map, and the center only through the sprite `STAD13.BM`. This changes which macro a click starts. | `packages/engine/src/map/clickzones.ts` (`mapClickAreas`), hooked from `packages/engine/src/play/game.ts`. See [map.md](map.md) |

## 2. A boundary case

| Scene | What the engine changes | Where |
|---|---|---|
| general (reported from `SC026`) | A click skips sprites that have no macro, matching the cursor test `Cursor_HitTestSprites` `00424f10`. The original (`Sprite_ClickMacro` `004248d0`) stops on the first sprite it hits, without checking for a macro. In `SC026` the table `STOL.PBM` under the spoon swallows the click. The cause is the scene's data, but the fix changes the executable's logic for **every** scene. | `packages/engine/src/play/game.ts`, `packages/engine/src/areas/click.ts`. See [areas.md](areas.md) |

Worth deciding later: restore the executable's logic and, if needed, patch only `SC026`.

## 3. Departures that are not script fixes

These stay. They are interface or executable behavior, not a rewrite of a script:

- The cursor hides before a death movie (`deathAhead` in `packages/engine/src/play/game.ts`).
- F5 puts the item in hand back into the coat (`packages/engine/src/save/state.ts`, `packages/engine/src/save/manager.ts`). See [save.md](../formats/save.md).
- A gesture after idle plays through (`packages/engine/src/gestures/`). See [gestures.md](gestures.md).
- The mouse wheel, the intro and bars after a new game, the sliders, a spoken caption pinned to the screen, the logos and intro, and a click that aborts a `RUNAVX` movie.
- `packages/engine/src/play/host.ts`: when a new line starts during the previous one, the macro waiting on the first line is released. In the original it would wait forever. Reachable only when a line's timing differs from the original (for example with no sound). This is a guard in the engine, not a script patch.

## 4. How the list was made

A search for deviation, workaround, and original-bug notes in `packages/engine/src/**/*.ts` (tests excluded), and for scene names and macro names written into the code. Apart from the two entries in `packages/engine/src/areas/deviations.ts`, scene names in the engine appear in `packages/engine/src/map/map.ts` (`SC000D`, `SC008B`, recognizing the map) and in `hardNoSave` (`packages/engine/src/play/game.ts` — values written into the executable, not a patch).
