# Tester codes: Ctrl plus points on the coat, and the `[TOPWARE]` macros

Hidden shortcuts of the Windows Director's Cut. Source: `Game_Run` `0042b6d0` (the coat loop `004391d3`…`0043b1d6`) and [inventory.md](inventory.md). See also hidden coat points and a click on Jack opens the coat.

## 1. How to invoke them

1. Open the coat (F1, the middle button, or the right button with an item in hand). In scenes whose script zeroes `MENU` (for example the map `SC000D`) the coat cannot be opened, so the points do not work either.
2. Hold **Ctrl** (`Input_IsKeyDown(0x1d)`, `004391da`) and click the **left** button on one of four invisible points. The hit test is a **strict** inequality `x−4 < mouse < x+4` (the same for `y`), so at most **3 px** from the point on each axis. The engine used to use ±4. The condition is checked **every frame at the start of the coat loop**, not on the click edge. Ctrl pressed while the left button is already held over the point also works. Scan code `0x1d` is the **left** Ctrl (the right one is `0x9d`; `Input_IsKeyDown` `0045a770` knows only the combined `0xfc` for both). The points work with an item in hand too (the loop does not distinguish). Leaving through `0043b04a` is the same as an ordinary close of the coat (the cursor returns to the verb, unless an item is held). Nothing on screen marks these places.
3. The coordinates depend on what Jack is wearing: `INV_C.BM` (civilian) or `INV_M.BM` (the uniform, `g_jackUniform`).

| # | Civilian (x, y) | Uniform (x, y) | What it does |
|---|---|---|---|
| 1 | (417, 197) | (405, 211) | starts the scene macro **`[TOPWARE]`** (§3) and adds **`MONEY.BM`** to the inventory, then closes the coat. `push "TOPWARE"` at `0043923c` → `Script_StartMacro`. `push "MONEY.BM"` at `00439249` → `Object_FindByName` `004132d0` plus `Inventory_Add` |
| 2 | (417, 248) | (407, 299) | **end of the game**: leave the scene for the movie `OUTRO.AVX` (screen `OUTRO.BM`). `strcpy(0x5348b0, "OUTRO.AVX")` at `004392bb` |
| 3 | (416, 312) | (411, 393) | **the city map** `SC000D`: sets `LAST` from the chapter of the current scene (1 → 6, 2 → 32, 3 → 75; chapter 4: no change) and changes scene with a **hard cut** (no dissolve). `strcpy(g_sceneName, "SC000D.CCG")` at `00439353`, `g_sceneChange = 1` |
| 4 | (417, 365) | (319, 200) | **toggles `JACKISMENU`** 0 ↔ 1 (the game variable plus `g_jackIsMenu`). At 1, a click on Jack with an empty hand opens the coat. At 0 it does not. Closes the coat. `00439434` / `00439459` |

- **Point 1** works in every scene. `MONEY.BM` always enters the coat. `[TOPWARE]` runs only where the scene has that macro (45 scenes, §3). Elsewhere `Script_StartMacro` finds nothing and nothing else happens. Further clicks add further banknotes and start the macro again. Some macros are toggles (§3).
- **Point 3, the chapter:** `0x6d38ca` is the chapter of the current scene (`Scene_ChapterFromName` `0047e980`: below 31 → 1, below 75 → 2, below 100 → 3, below 200 → 4, otherwise 2). `LAST` says where the car stands on the map (`SC000D [PRE]` tests `LAST` 6, 32, and 75).
- **Point 3, the transition:** beside `g_sceneChange` the code sets `DAT_0086f985 = 1`. That is **not** a dissolve. Only `Cursor_DrawOnPresent` `00426370` reads the flag (the cursor is not drawn until the scene change finishes), and `Game_Run` clears it after `Scene_RefreshBackground`. Only `REFRESHSCREEN` turns on a dissolve (`g_mixingPending`, [transition.md](transition.md)). The big map appears at once. An earlier note that said this transition dissolves was wrong.
- **Point 4** was found later than the first three.

## 2. The map on M is not a tester code

The **M** key without Ctrl opens the small map `MAP2.BM` in the scene (from `GLOBAL.PAK`, a rectangle 0x26c × 0x134 at (10, 0x56)). M or Esc closes it (`Game_Run` `0043824c`…`00438644`). It works only in chapters 2 and 3 (`SC031`…`SC099`), in sub-scenes ≥ 200, and in 9 scenes of chapter 1 or 4 from the list `0x50479c` = {2, 4, 6, 8, 10, 12, 15, 19, 21} (`FUN_00406420`, [keys.md](keys.md)). Ctrl+M does **not** open the map. The screen is [minimap.md](minimap.md).

## 3. `[TOPWARE]` scene by scene

45 scenes have a `[TOPWARE]` macro. Only Ctrl point 1 starts it, plus dead code `IF TESTING 1` then `ACTIVEMACRO TOPWARE` in `[INIT]` of `SC075` and `SC077`. `TESTING` is always 0 ([chapter3.md](chapter3.md)). The macro gives what that scene's puzzle needs, or it moves the scene's state. `HAVETOOL` puts an item in the coat. `LET X` with no value sets `X = 0`. `HAVEGUN` is the revolver. Where a chapter note does not describe a variable, the command is given as itself.

### Chapter 1 (SC000–SC030)

| Scene | `[TOPWARE]` | Effect |
|---|---|---|
| SC000 | `HAVETOOL KORBA_I.BM` | the crank |
| SC005B | `LET UMYTY 1` | Jack counts as washed: Alice's door (SC011) is open, and the policeman leaves the alley (`SC005B [PRE]`) |
| SC009 | `LET SILNY 1` | Jack counts as strong, as after the steel gloves: he wins the fight, with no `ONCAR.AVX` |
| SC011 | `HAVETOOL KEY2.011`, `LET UMYTY 1` | the door keys, and washed |
| SC013 | `HAVETOOL ZMIOT.BM`, `HAVETOOL 026LYZ_I.BM` | the whisk and the spoon |
| SC014 | `HAVETOOL KEY1.BM` | the key |
| SC015 | `HAVETOOL KEY1.BM` | the key |
| SC018 | `HAVETOOL JABLKO.BM` | the apple |
| SC020 | if `LOC2` is 0: the broom and the boxing gloves, `LET LOC2 1`, `DEACTIVESELF`; then `ACTIVEMACRO MIOT.BM-PODK.PBM` | first click: broom and gloves; second: the broom is used on the horseshoe at once |

### Chapter 2 (SC031–SC074)

| Scene | `[TOPWARE]` | Effect |
|---|---|---|
| SC032 | `HAVETOOL 41WAZO_I.BM` | the small vase |
| SC033 | `HAVETOOL 34FAJK_I.BM` | the cigarette pack |
| SC037 | `HAVETOOL KLUCZ_I.035` | the room key |
| SC039 | `ACTIVEMACRO UDERZ` | the desk is kicked at once (`UDERZ`: Jack walks up, insertion `JKOPDES1`, the desk goes from `DESK1` to `DESK6`; only when `KOPNAL` is 0) |
| SC042 | if the bat flag is 0, grant `PALKA_I.BM` and set the flag; if it is 1, take the bat away and clear the flag | **a toggle for the baseball bat**. The fight with the drifter (`Z42.AVX`) depends on it |
| SC047B | `HAVETOOL GAZ_I.047` | the newspaper |
| SC047C | `HAVETOOL GAZ_I.047` | the newspaper |
| SC051 | `HAVETOOL LINA_I.BM` | the rope |
| SC051A | `HAVETOOL LINA_I.BM` | the rope |
| SC053 | `HAVETOOL CASINO_I.053` | the casino pass |
| SC054 | `LET ZWIAZUJESM 1`, `ACTIVEMACRO JACK_OCHR_WYCH` | the guard counts as tied, and Jack is led out at once (scene `SC055`, no death movie `Z58B.AVX`) |
| SC057 | `HAVETOOL LOM_I.057` | the crowbar |
| SC063 | `HAVETOOL 32MANU_I.BM`, `HAVETOOL 65WACH_I.BM` | the manuscript and the fan |
| SC071B | `HAVETOOL 73WHIS_I.BM`, `HAVETOOL KLUCZ_I.BM` | the whisky and key M-17 |
| SC072 | hide `KORBA.PBM`, move area `KORBA`, grant `2KORBA_I.BM`, `LET KORBA72 0` | the crank is taken off the scene and given to Jack |
| SC073 | `HAVETOOL 71KLFR_I.BM` | the wrench |

### Chapter 3 (SC075–SC099)

| Scene | `[TOPWARE]` | Effect |
|---|---|---|
| SC075 | `SETAREA TO_IN 0 1`, `LET DALFLASZ 1`; toggle `LANCUCH58` | entrance `TO_IN` is on, and the bottle-given flag is 1. Each click flips `LANCUCH58` (the workshop variant and the exits of `SC052` / `SC058`) |
| SC076 | `HAVETOOL MONETA_I.077` | the coin |
| SC077 | if `LOC1` is 1, play `RUNFILMP JACK_LANCUCH`; place `MONETA.077`, turn area `MONETA` on, grant the snips, set `LOC1` | the snips, and the coin placed on the ground. The second click plays the chain-cutting cutaway |
| SC079 | `LET MAPAPIER79 0` | clears `MAPAPIER79` (a script sets it to 1 elsewhere; the effect was not checked) |
| SC084 | place `DRZWI.PBM` at (444, 169), show it, `SETAREA TO_IN` | the door as in the second `[PRE]` variant, and area `TO_IN` moved. The effect was not checked |
| SC089 | grant the rum and `HAVEGUN`; if the anchor flag is 0, grant the anchor once | the rum, **the revolver**, and the anchor (once) |
| SC093 | `HAVETOOL LOM_I.BM` | the crowbar |
| SC094 | `HAVETOOL DESKA_I.BM` | the plank |
| SC095 | the rope once if it was not taken, plus the wrench | the rope (once) and the wrench |

### Chapter 4 and the cellars (SC100+, SC2xx)

| Scene | `[TOPWARE]` | Effect |
|---|---|---|
| SC100 | the axe and the wire | `100SI_I.BM`, `104DRU_I.BM` |
| SC104 | the lockpick, the key, `MAKLUCZ103`, area `TO_IN` on | `100WYT_I.BM`, `KEY103_I.BM` |
| SC107 | the dog tag | `105NIE_I.BM` |
| SC112 | the pass flag | `MAPRZEPUSTKE` is checked in `SC112` |
| SC114 | the phone book | `115PHO_I.BM` |
| SC116 | the briefcase | `TECZKA_I.BM` |
| SC117 | the briefcase | `TECZKA_I.BM` |
| SC201A | the matches | `003ZAP_I.BM` |
| SC205 | the book | `63KSIA_I.BM` |
| SC209 | the matches | `003ZAP_I.BM` |

- The macros are written for puzzle tests. They grant an item from another scene (SC089 grants the anchor from SC095, SC095 grants the rope from SC089) or they set a "done" flag at once (`UMYTY`, `SILNY`, `ZWIAZUJESM`, `DALFLASZ`).
- Four macros are **toggles** (SC020, SC042, SC075, and partly SC077). The next click does something else.
- The other 90 scenes (of 135) have no `[TOPWARE]`. Point 1 there only gives banknotes.

Checked on all 45 scenes: start the scene, hit point 1 twice, and watch items, variables, skipped commands, and hangs. Result: nothing skipped, no hangs, `TOPWARE` finishes in every scene, and `MONEY.BM` is always added. Items match the tables (the revolver goes from `GUN` 0 to 1 in SC089, SC042 toggles the bat, and SC020's second click starts `MIOT.BM-PODK.PBM`).

- SC079: clearing `MAPAPIER79` does something only when the variable is 1 (it is 0 at the start of the scene).
- SC084: the three commands run. No variable changes. Only the door object and the area change. Starting the scene with `LAST` below 85 starts the patrol and the death movie `84JC.AVX`. The check uses `LAST` 85 and clicks after 40 ticks.
- SC054: `JACK_OCHR_WYCH` changes the scene to `SC055` (`LAST` 5 becomes 54, the tied flag is 1). There is no second click.
- SC051 and SC112 need the right `LAST` (50 and 110), or the scene starts with a movie. SC112 sets the pass flag. SC075 and SC093 also change `OCHR` (the patrol loop, not the macro).
- Macros that stay active after the click are background loops of the scene (animations), not `TOPWARE`.

## 4. In the engine

- Ctrl points 1–4: `packages/engine/src/inventory/layout.ts` `ctrlPointAt`, `packages/engine/src/inventory/screen.ts`, `packages/engine/src/play/game.ts` `ctrlPoint`.
- Point 3 cuts with no dissolve (`fadeRequested = false`). The hit radius is ±3 px. The level is checked (`CoatScreen.ctrlHeld`). Points 1, 2, and 4 and the coordinates (civilian and uniform) match `Game_Run`. Hiding the cursor (`DAT_0086f985`): while a scene loads, the engine shows a busy cursor (an hourglass, `cursor.busy`) on every scene change. That is a browser departure (loading is asynchronous). It was not changed here.
- Left and right Ctrl: the page sets `input.ctrl` from either Control key. The original reacts only to the left one.
- The map on M is [minimap.md](minimap.md). Availability is `mapAvailableIn` in `packages/engine/src/keys/keymap.ts`.
