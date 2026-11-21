# Click zones and action macros

What happens after a click in a scene: which `.ACE` zones react, which macro starts, when the cursor becomes an exit arrow, and in what order `Game_Run` tries zones, sprites, and a walk. Code: `packages/engine/src/areas/` (`state.ts` for the zone flags, `hit.ts` for the hit tests and the zone and edge cursor modes, `click.ts` for the macro names, the click, and the order of the attempts, `deviations.ts` for the kept departures, `rect.ts` for the cursor rectangle). The `.ACE` format is [scene.md](../formats/scene.md). A walk after a click is [walk.md](walk.md). The cursor is [cursor.md](cursor.md). The macro interpreter is [scripts.md](scripts.md).

## Zone state (flags per scene)

Three byte tables, one entry per zone. The index is the zone's number in the `.ACE`.

| Table | Address | Written by | Meaning |
|---|---|---|---|
| `g_areaEnabled` | `0x871ad8` | `SETAREA zone n state` (`Script_ExecStep` case `0x54`) | "on", for the ordinary cursor (mode 0) and for exits |
| `g_areaSpecEnabled` | `0x6aeefc` | `SETSPECAREA` (case `0x75`) | forced on. Off means the zone reacts to **no** cursor |
| `g_areaIgnore` | `0x6d9824` | `IGNOREAREA zone n` (case `0x9f`; always `1`. There is no reverse command) | the zone does not light the cursor in mode 0 |

`Game_Run` sets the initial values before `[PRE]`, in the loop `0042bfa1`…`0042bfd7`: for zones **0…29**, `enabled = 1`, `special = 1`, `ignore = 0`. Every later entry stays zero (BSS), so a zone with an index of 30 or more would never work. The largest scene has 18 zones, so the limit does not matter. Nothing outside that loop and the three commands touches the flags (the writes were found by reading the whole `.text`). The loop stands immediately before `[PRE]` starts (`0042c836`). It runs on every entry to a scene, so zone state does not carry between scenes. That last point is a hypothesis about the call, and it matches the placement.

Command arguments: `SETAREA NAME dup state` and `IGNOREAREA NAME dup`. The compiler (`Script_CompileMacros` case `0x55` / `0xa0`) turns the pair *name + dup* into a zone index: the first `.ACE` entry whose name matches, and whose count of earlier entries with that name (`g_areaDupIndex` `0x7c7d74`, counted by `Scene_LoadAce` `004475e0`) equals `dup`. One name can have several entries (for example `DRZWI` 0 and `DRZWI` 1). All 261 uses of the commands (70 `SETAREA`, 173 `SETSPECAREA`, 18 `IGNOREAREA`) in 135 scenes resolve. In TypeScript: `AreaState`, `dupIndices`, `resolveAreaRef`, `applyAreaCommand(state, areas, cmd)`. The host calls them from `command()` for those three words.

## The point test: `Area_Contains` `00412e40`

A zone is hit at point *p* in cursor mode *m* (`g_cursorMode` `0x8f68f6`) when `(enabled[a] ≠ 0 or m ≠ 0) and special[a] ≠ 0` **and** the point lies in one of the zone's triangles (half-planes through `Geom_PointBelowLine` `00403430`, with no bounding rectangle; `areaContains` from `packages/engine/src/walk/depth.ts`). Consequences:

- `SETAREA 0` hides the zone only from the **ordinary cursor** (mode 0). With another verb (look, take, strike, shoot, an item in hand) the zone still reacts. Those are doors "closed" to the pointer, but still there to examine.
- `SETSPECAREA 0` hides the zone from everything.
- `Area_IsEnabledExit` `004242e0`: the zone is on the exit list `g_exitAreas` (a name in `g_exitAreaNames`, `Area.exit` from the parser) **and** `enabled ≠ 0`. `special` is not checked here. `Area_Contains` checks it later.
- Modes **10…19** (`Cursor_IsMode10to19` `00424360`): only enabled exits count (`areaUnder`). Other zones are skipped and the scan continues to earlier ones.

Zones are scanned **from the last to the first**. The first hit wins (later ones, for example a larger background underneath, are skipped). Zones can overlap. The `.ACE` author put the details at the end.

## Which cursor mode a zone gets: `Game_Run` `0042da52`…`0042dbad`

These are the writes of modes 10–21 into `g_cursorMode`. The listing of `Game_Run` is incomplete, so the writes were read from the disassembly of `.text` (stores to `0x8f68f6`). Stores of the literals 10–21:

| Address | Store | Condition |
|---|---|---|
| `0042dadb` | 10 (`LEWO`) | the enabled exit under the hotspot is named `LEWO` |
| `0042db00` | 11 | `PRAWO` |
| `0042db25` | 13 | `DOL` |
| `0042db47` | 14 | `TO_IN` |
| `0042db69` | 15 | `UP` |
| `0042db8b` | 17 | `TO_OUT` |
| `0042dba7` | `g_verbMode` (`0x8f68ea`) | none of the above. Return to the mode from the menu |
| `0042fbed` / `0042fc2c` | 20 / 21 | the screen edges (below) |

Every frame (the block `0042da52`), provided `0x51f919` is clear (set by `0042dc9a`; the meaning is unknown, a hypothesis is "the cursor is suspended"), `g_verbMode` is 0 (the pointer was chosen in the menu), the mode is not 5, not 20 or 21, and `0x851d02` is 0: `FUN_00424820` (reached through the thunk `0040143d`) returns the **name of the enabled exit under the hotspot** (`g_clickX/Y`; empty when there is none). The name is compared with `strcmp` against the strings `LEWO PRAWO DOL TO_IN UP TO_OUT` (addresses `0x4f80c4`, `0x4f80bc`, `0x4f80b8`, `0x4f80b0`, `0x4f80ac`, `0x4f80a4`) and becomes mode 10, 11, 13, 14, 15, or 17. Otherwise `g_cursorMode = g_verbMode`. Modes **12, 16, 18, and 19 are never set** (and they have no pictures). They match the four empty slots of the exit-name table. `g_verbMode` (`0x8f68ea`) is the mode chosen in the verb menu (`Cursor_VerbMenu` `00416780` writes it together with `g_cursorMode`; `Cursor_ResetMode` clears it). The result: exit arrows are visible **only with the pointer**, never with the lens, the hand, the fist, the gun, or an item.

Mode 0 with a verb other than 0 (for example after a take macro that changes the scene) therefore shows no arrows. When the original clears the verb (the start of a scene, `Cursor_EnableDraw`) is in [cursor.md](cursor.md).

In TypeScript: `zoneCursorMode(areas, state, {mode, verbMode, click, suspended?, busy?})` returns the new mode. `EXIT_CURSOR_MODE`. Write the result into `Cursor.mode`.

### The edge cursors (20 / 21), `0042fb91`…`0042fd43`

When `0x653170` is 0, `0x8a7c62` is not 0, `0x851d02` is 0, there is no text on screen (`0x8f6924` is 0), and the mode is not 20 or 21: a mouse (`g_mouseX` `0x9d2804`, in the world) below `scrollX + 0x1e` while `scrollX > g_bgScrollMin` (`0x8f68e8`) sets mode **20** (`SCLF`, scroll left). A mouse above `scrollX + 0x262` while `scrollX < g_bgScrollMax` (`0x504686`) sets **21** (`SCRG`). The previous mode is saved in `0x8f68ec`. Leaving the edge strip (the mouse is outside the strip, **or** the scroll has ended — the flags `0x7c72f0` / `0x870cf8` are set by `Game_Tick14ms`) restores the saved mode (or 0, when `0x51f919`). In modes 20 and 21 **a click is ignored** (`0042fde2`…`0042fdfc`). In TypeScript: `edgeScrollMode(env, saved, canScroll)`. The end-of-scroll condition is simplified to `canScroll`. That simplification is a hypothesis.

## The macro name: the verb, the item, `PIERDOLA`

The action prefix: with no item, `g_verbName` (`POKAZANIE`, `PATRZENIE`, `UDERZENIE`, `STRZELANIE`, `BRANIE`, [cursor.md](cursor.md)). With an item in hand (`g_itemInHand` `0x57a982` is not 0), the item's name `g_heldItemName`. Item names are the names of their icons, with a number or an extension: `KLUCZ_I.035`, `KORBA_I.BM`, `PALKA_I.BM`, `MONEY.BM`, `JABLKO.BM` (several dozen different prefixes in the scene macros). A macro looks like `KLUCZ_I.BM-DRZWI`. There is also `~POKAZANIE` (a destructor suffix; `Script_InterruptOutMacros` builds `"~" + name`).

`Area_ClickMacro` `004243a0` (a click), after the zone is chosen:

1. It builds `<prefix>-<zone NAME>` and calls `Script_FindMacro` `0040d8b0` (it **starts** the first macro of that name that is not `BLOCKMACRO`, and it sets `g_macroStarted`).
2. **With `WALKAREA`**, `g_clickOnWalkArea` (`0x7c7d1c`) becomes 1 and the function returns 0 (the click is not "used up", but a walk from the click is blocked; the macro, if there was one, has started). There is no substitute macro and no interrupt of `OUTMACRO`.
3. Otherwise, when an item is in hand and there is no macro, it tries **`PIERDOLA-<NAME>`** (the authors' catch-all for "nothing happens"). **With no item there is no substitute macro.** A click with no macro is simply empty.
4. A found macro: `g_clickArmed` (`0x8979ce`) becomes 0, and `Script_InterruptOutMacros(started)` `00427800` runs. Every running `OUTMACRO` macro (for example walking around the scene with `WalkTo`) is interrupted, and its destructor (`MACRODESTRUCTOR` or `~NAME`) starts.
5. When an item is in hand and **nothing was found** (neither `<item>-X` nor `PIERDOLA-X`), `0x7a83f8` becomes 1. When `<item>-X` or `PIERDOLA-X` was found, `0x69ea08` becomes 1.

A zone wins **even when it has no macro**. The loop ends on the first zone that was hit, so a click on a zone with no macro does not fall through to the zones underneath. It continues to the sprites and the walk (`kind: "nothing"` or `"walk"` in `resolveClick`).

In TypeScript: `startReaction(port, action, target, fallback)` (steps 1, 3, 4, and 5), `areaClick(areas, state, port, p, mode, action)` returns `AreaClick` (`handled` is the original's return, `walkArea`, `itemMacroFound` is `0x69ea08`, `itemFailed` is `0x7a83f8`). `MacroPort` is a thin interface on the interpreter (`interpreterPort(it)`): `exists` is `Macro_Exists` `0040d7d0` (blocked macros too), `start` is `Script_FindMacro` (only unblocked ones, with no "missing-macro" entry in the log), `interruptOutMacros`.

## The cursor test, every frame

The hook `Cursor_DrawOnPresent` `00426370`, after every presentation: `g_cursorOverReaction = 0`, then `Cursor_HitTestSprites` `00424f10`. If nothing, `Cursor_HitTestAreas` `00424640`. "A reaction" means one of them returned 1.

- **Zones** (`areaReaction`): the same scan as a click, but zones with `IGNOREAREA` are skipped **in mode 0** (the scan continues). A hit zone **always** lights `g_cursorOverReaction` (even with no macro), and the return is `Macro_Exists("<prefix>-<NAME>")`. Only that exact macro, **without** `PIERDOLA`. `IGNOREAREA` exists so that a zone with no interesting reaction does not light the hand. It does not disable the click. 18 commands in 15 scenes, including `WALKAREA` in SC085 and SC086.
- The name `<prefix>-<NAME>` also goes to the status bar (`0x563f98`). That is `label` in the result.
- In `Cursor`: `setTargets(overReaction = sprite.exists || area.exists, overObject = sprite.over || area.over)`. The pointer animation pulses when `exists` is set. See [cursor.md](cursor.md).

## Sprites: `FUN_004248d0` (a click) and `Cursor_HitTestSprites` `00424f10`

They are not zones, but they always occur together with them, so `click.ts` contains their logic. The scene's sprite list (`0xa00dc8`, the draw order) is scanned **from the top**:

- **Pass 0** is a non-zero pixel of the sprite's picture under the hotspot (`Blit_Copy16` / `0046ec80` for type `0x10` / `8`). **Pass 1** is the flag `0xa00bf8[i]` not 0 (see "The cursor rectangle flag" below). Jack's sprite `0x551558` is skipped. Pass 1 runs: on a **click**, only for modes other than 0 and 1; on the **cursor test**, for every mode other than 1 (an asymmetry: in mode 0 a flagged sprite lights the cursor but does not react to a click). `spritePasses`.
- The target's name: `JACK` for Jack's sprite (`g_jackSprite`), a person's name from the `.PCS` (`0x871ba0`, 20 bytes per entry), or a scene object's name (`Object_FindBySprite` `00413370`, `g_sceneObjName`). The macro is `<prefix>-<target>`, and with an item in hand also `PIERDOLA-<target>`.
- A **click** stops on the first sprite that was hit (`spriteClickTarget`). The **cursor test** continues downward until it finds a sprite with an existing macro (`spriteReaction`). A top sprite with no macro "covers" a lower one on a click, but the cursor lights over the lower one.

The host supplies `SpriteCandidate[]` with `pixelHit` and `flagged` already computed. `startReaction` does the rest.

## The cursor rectangle flag: why the hand hits small items easily

The sprite list `0xa00dc8` and the flags `0xa00bf8` are not computed in the cursor test. They are computed while **drawing the cursor**. `Sprite_SetOverlay` `00479540` calls `Render_RedrawRectOverlay` `00477c00` (param_5 = 1) for the cursor picture's rectangle, and for every visible scene sprite that intersects that rectangle (apart from the cursor itself) it stores the sprite's id and a flag equal to the result of blitting the sprite into the work buffer (`FUN_0046df60` types `0x10` / `0x12`, `FUN_0046f070` / `0046ec80` type 8; they return the OR of the destination pixels overwritten by the sprite's non-zero pixels). A flag other than 0 means **the sprite has a non-zero pixel anywhere in the cursor picture's rectangle** (not only under the hotspot). Pass 1 of the hit tests (`spritePasses`) treats such a sprite as hit: on a click, in modes other than 0 and 1 (the hand, 50×33 `HAN`, and an item); on the cursor test, in every mode other than 1. That is why a small item (the kit, the glove, the apple in SC013) is easy to hit with the hand, and why a sprite with no macro that lies higher in the list still "catches" the click (the loop ends on the first hit; a macro is not a condition). The rectangle (`packages/engine/src/areas/rect.ts`, `cursorHitRect`): the cursor picture at `mouse − (w/2, h/2)`. When the previous rectangle is no farther than its own size (`|dx| ≤ old width`, `|dy| ≤ old height`), the union of both (`Sprite_SetOverlay`: the path with no "second call"). Otherwise only the new one. The width is rounded up to even, minimum 4 (`Render_RedrawRectOverlay`). A pixel under a sprite pixel is sometimes zero (black), and then the original does not set the flag. The engine does not model that. Clipping to the screen is omitted, because pixels off screen belong to no sprite. The engine: `ScenePlayer.spriteCandidates(x, y, rect)` returns `flagged`. `PlayGame` supplies the rectangle from `Cursor.imageSize()`. Play matches the code: the kit in SC013 is easy to hit.

### The spoon in SC026: the highlight yes, the click no

In the cell `SC026` the hand cursor (mode 4) lights over a large area around the spoon (`LYZKA.PBM`, 35×14 px), and a click hits only the spoon itself. A grid around the spoon: the cursor reacts on about 13×6 cells, and a click starts `BRANIE-LYZKA.PBM` only on a few. **The cause is not a rectangle-versus-point difference** (both use the same candidate list and the same cursor rectangle). It is the **order of the passes**. Under the spoon lies a large table sprite `STOL.PBM` (216×234, the tabletop over the whole area around the spoon), non-empty under the hotspot. Pass 0 of a click (`Sprite_ClickMacro` `004248d0`) stops on the first sprite that was hit **without checking for a macro**. `BRANIE-STOL.PBM` does not exist, so nothing happens (Jack does not even walk: the sprite "handled" the click in the sense of the loop, but `g_macroRunnable` is 0, so the result is `nothing`). The cursor test (`Cursor_HitTestSprites` `00424f10`) in the same situation continues, hits the spoon with the flag in pass 1, and lights the hand. The engine reproduces both, so according to the listing **the original has the same asymmetry**, unless in the original the table is not a sprite with non-zero pixels under the spoon. That cannot be settled from the code alone. Play confirms that the spoon is hard to hit in the original too. **A departure kept on purpose:** the hand should work where it lights. `spriteClickTarget(list, mode, hasMacro)` with a predicate (`reactionExists`, as in `Cursor_HitTestSprites` `00424f10`) **skips sprites that have no macro** instead of stopping on the first hit (`Sprite_ClickMacro` `004248d0`). When no hit sprite has a macro, the result is as in the original (the top hit). Jack's refusal with an item in hand depends on that. Mode 0 (the arrow) keeps a single click pass. On the data the differences are only where a sprite with no macro covered an object with a macro under the hand: SC026 (`STOL` / `MISKA` → `LYZKA`), SC013 (a click with the hand beside Jack takes the apple instead of opening the coat), SC011, and SC006. In the other scenes there is no difference. No sprite that covers on purpose, and has no macro, was found. The call is `spriteClickTarget` in the `sprite` callback of `resolveClick` in `packages/engine/src/play/game.ts`.

### The car in SC070: the hand after the pass is taken

In `SC070`, after `BRANIE-AUTO` (`JACK_KARTA`, `MAKARTE = 1`), the hand over the car still lights, and a click does nothing. The hand's activity is the mere existence of the macro `<verb>-<target>` (`Macro_Exists` `0040d7d0` in `Cursor_HitTestAreas` `00424640` and `Cursor_HitTestSprites` `00424f10`). `BRANIE-AUTO` always exists, and its whole body is `IF MAKARTE … ENDIF`, so after `MAKARTE` is 1 the macro starts and ends at once. The original has the same asymmetry. **A departure kept on purpose:** `packages/engine/src/areas/deviations.ts` (`INERT_MACROS`, the only place with the list: scene, macro, variable, condition). `interpreterPort(…).exists()` returns `false` for `BRANIE-AUTO` when `MAKARTE` is not 0. It affects only the cursor tests (`exists`). `start()` is unchanged, and a click starts the macro as in the original. `PATRZENIE-AUTO` is unchanged. The port does not know the scene, so the entry recognizes it by the variable: `MAKARTE` occurs only in `SC070`. A general rule ("a macro with no effect at the current variables") was not implemented.

### The rope descent in SC087 with no anchor: the right edge of `DOL` #0

Confirmed in the original. `SC087` has two `DOL` zones: `#0` (x 210–338, the cornice with the ladder) and `#3`, which in the `.ACE` indexes is "`DOL` dup 1" (x 322–365, the rope). `[PRE]` turns the rope zone off (`SETAREA DOL 1`) and turns it on only in `95KTZW_I.BM-GZYMS.PBM` (`SETAREA DOL 1 1`). `POKAZANIE-DOL` chooses the rope descent through `IFF MOUSEX > 320`, so the right edge of `#0` (x 321–338) descends with no rope. **A departure kept on purpose:** the condition is the state of the rope `DOL` zone (dup 1) in `AreaState.enabled`. There is no script variable set by tying the anchor (the macro sets only the zone and the animations), so the zone's state is the only trace. With no rope the script sees `MOUSEX = min(MOUSEX, 320)` (the ladder branch). With the rope, unchanged. Only the `MOUSEX` value read by that macro is changed, for as long as the macro is active (`macroMouseX`, `ROPE_DESCENT_FIX` in `packages/engine/src/areas/deviations.ts`). The scripts and the zone outlines are unchanged. The wiring is `PlayGame.syncMouseVars` (the value is refreshed every frame, so setting it only at `start` is not enough). After the wiring, the two checked paths end by entering `SC086` and the `PLECY` movie (the ladder; in the original the same effect as a click to the left of x = 320), not by the descent.

## The order of a click: `Game_Run` `0042fd7e`…`0043013a`

`resolveClick(env)` reproduces this block. The preconditions (otherwise nothing, and the flag `g_clickArmed` stays): the left button is down (`0x9d2820`), `g_clickArmed` is 1, `g_cursorEnabled` (`0x7cde78`), `0x7a849c` is 0 (Jack's turn animation), `0x8f6874` is 0, `0x6bc294` is 0 (never set), and the cursor mode is not 20 or 21. `g_clickArmed` returns to 1 when the button is released (`0043013a`). Then:

1. `0x6bb278` (`g_macroPlayerLocked`, `Interpreter.playerLocked()`) not 0 → everything up to the tail is skipped.
2. **Zones.** `Area_ClickMacro(x, y)` (the point is `Cursor.clickPoint()`). If `handled`, stop.
3. `g_clickOnWalkArea` not 0 (a `WALKAREA` was hit) → stop (no walk).
4. **Sprites.** `FUN_004248d0`. If a macro started, stop.
5. **A walk.** It requires `0x51fa5e` (`LOCKWALK` / `UNLOCKWALK`, [scripts.md](scripts.md)), a point in the walk area (`Walk_FindTriangle`), cursor mode **0**, and `0x851d02` equal to 0. Then `g_clickArmed = 0` and **`Script_InterruptOutMacros(-1)`** (this also interrupts `OUTMACRO` macros). The rest is [walk.md](walk.md). A walk with an item in hand is impossible (mode 5).
6. **The tail** `004300f4`: if `0x7a83f8` (an item, no reaction) and `0x69ea08` is 0, `FUN_00423fb0` runs. **Jack refuses.** One of three lines, picked by the counter `0x6da6a8` modulo 3, from the buffer `0x504528 + 100·n`, with the voice `N010` / `N020` / `N030.SND` (turned into `.S22` by `Sound_PlayTalk`) and a caption beside Jack. The buffer's initial contents are the German sentences. `Game_Main` overwrites them according to `g_language`. The wording is not reproduced here. Otherwise `0x7a83f8` becomes 0, and if an item is in hand and `0x69ea08` is 0, `FUN_00419ba0` runs (the command `MOUSETOTOOL`: **the item goes back to the bar**) and `g_clickArmed` becomes 0. A click with an item "into empty space" puts it away. Using it on a target with no reaction makes Jack refuse, and the item stays in hand.

`ClickOutcome`: `ignored | macro(area|sprite) | walk | refuse | putBack | nothing`. The host carries out the effect (plan the walk, play the line, put the item away).

**Dead code:** before the walk, `0042feac`…`0042fed1` is `xor eax, eax; test eax, eax; je`. It never jumps to "walk straight to the click" (`Jack_WalkToPoint`). Described in [walk.md](walk.md).

## What the scene host calls

```ts
const areaState = new AreaState(); // on a scene: areaState.reset() BEFORE [PRE] (Game_Run 0042bfa1)
// host.command(cmd): applyAreaCommand(areaState, scene.areas, cmd) → "done"
const port = interpreterPort(interpreter);
const action = { verb: cursor.verb, item: heldItemName ?? null };

const p = cursor.clickPoint(mouseWorldX, mouseY);
cursor.mode = zoneCursorMode(scene.areas, areaState, { mode: cursor.mode, verbMode, click: p });
const s = spriteReaction(candidates, port, cursor.mode, action);
const a = s.over && s.exists ? null : areaReaction(scene.areas, areaState, port, p, cursor.mode, action);
cursor.setTargets(s.exists || !!a?.exists, s.over || !!a?.over);

const r = resolveClick({ mode, armed, cursorEnabled, playerLocked: interpreter.playerLocked(),
  walkAllowed, itemInHand, area: () => areaClick(scene.areas, areaState, port, p, mode, action),
  sprite: () => /* spriteClickTarget + startReaction, or null */,
  inWalkArea: () => findWalkTriangle(walk, p.x, p.y) >= 0 });
```

`Cursor.mode` is an ordinary field. The host assigns it the result of `zoneCursorMode` and `edgeScrollMode` (the order matches the blocks in `Game_Run`: zones `0042da52`, edges `0042fb91`). `Cursor` notices a mode change itself (`modeAtLastPresent`) and starts the switch "zoom".

## Tests

`packages/engine/src/areas/areas.test.ts`: the zone flags (the initial state, the byte, resolving names with `dup`, commands from the compiler), the `Area_Contains` gate (mode × `enabled` × `special`), the scan from the last zone, modes 10–19, `IGNOREAREA` (the cursor yes, the click no), the exit and edge cursor modes, `startReaction` (an empty hand, an item, `PIERDOLA`, a blocked macro), `WALKAREA`, sprites (the passes, a click versus the cursor), `resolveClick` (every result), and an adapter on a real interpreter. The tests build their own bytes. On the game's scenes the same checks are: at most 18 zones, the 261 zone commands resolve, 21 zones have no verb macro and no `PIERDOLA`, every named exit has `POKAZANIE-<NAME>`, `WALKAREA` only in SC085 and SC086 (both `IGNOREAREA`), and in SC002 a click on `LEWO` starts `POKAZANIE-LEWO` while the cursor over it has mode 10.

## Open

- `0x51f919` (it blocks a change to a zone mode) and the exact condition for the end of an edge scroll (`0x7c72f0` / `0x870cf8`) were not settled. The logic is approximate.
- `0xa00bf8[i]` (pass 1 of the sprites) and `0x8f6870` / `0x8f687c` (a flag in a click on Jack) have no settled meaning beyond the rectangle flag above.
- The loop `0042bfa1` in `Game_Run` has only 30 entries. No scene reaches further.
- Whether `PIERDOLA-<ZONE>` is reachable in the game with no item: **no** (the code). The `PIERDOLA-*` macros for zones are in the data, but they fire only with an item in hand.
