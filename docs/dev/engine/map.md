# The city map `SC000D`

The map is an ordinary scene (`SC000D.PHK`): the background `DEKORA.BM` (scrolled, the view width runs 0…376), 48 objects, three `.ACE` zones, and the macros `SC000D.MCC`. The executable knows only its name: the **no-control scene** flag, and Ctrl point 3 of the coat. Everything else (the markers, the drives, the choice of a destination) is the script, which the engine runs with the commands in [scripts.md](scripts.md).

Code: `packages/engine/src/map/map.ts` (`isNoControlScene`, `noControlCursor`), `packages/engine/src/play/game.ts` (`startNoControl`, `scrollEdge`, `ctrlPoint`), `packages/engine/src/play/edgescroll.ts` (`noControlDir`).

## 1. A scene with no control (`g_sceneNoControl` `0x653170`)

`Game_Run` `0042b6d0`: `strcmp(g_sceneName, "SC000D.CCG")` or `"SC008B.CCG"` sets `0x653170 = 1`, and then immediately `g_verbMode = 0`, `g_cursorMode = 0`, `Cursor_SetVerbName()`. What the flag does, all of it in `Game_Run`:

| What | Where | The engine |
|---|---|---|
| the cursor and the verb are cleared at the start of the scene. The map is clicked with the pointer. A verb chosen earlier (for example the lens) **does not come back** after the map | the start | `PlayGame.startNoControl` |
| Jack's position is not restored after a load | | `enter()` |
| no idle animation of Jack | | Jack stands off screen (`SETPOSITION JACK 0 -100`) |
| no keys (Backspace, save, and the rest) | | `keyContext.sceneNoControl` |
| no bullet menu and no verb window (the right button) | | `bulletFrame`: `blocked` |
| no edge cursors 20 and 21 | | `scrollEdge` |
| a mouse below `scroll + 0x14` gives direction −1, above `scroll + 0x26c` gives +1 (when `g_cursorEnabled`) | | `noControlDir` |

The script itself blocks the coat (F1, the middle button, the Ctrl points): `[PRE]` does `Let MENU 0`, and the coat and key condition reads the variable `MENU` (`Game_Run`). `MENU = 1` returns in the prologue of the next scene. The item macros `REKAWI.BM-IPODK.BM` and `KOTWIC_I.095-89LINA_I.BM` in `SC000D.MCC` are therefore unreachable on the map (copies of combinations from other scenes).

**Scrolling.** The direction `g_noControlDir` `0x55347c` is **not** cleared when the mouse leaves the edge. `Game_Tick14ms` `00426c10` moves the view by 4 px per tick (and `g_mouseX` with it) until the limit `SETSCROLLX1` / `SETSCROLLX2`. Only a scene load (`Scene_LoadCcg` `004486d0`), entering the coat (`Game_Run`), and the verb window (for the duration of the window) clear it. Touching an edge scrolls the map all the way. The script also scrolls by itself (`SCROLLLEFT` / `SCROLLRIGHT`, commands `0x2e` / `0x2f`, `Script_ExecStep` `0041a330`).

## 2. Entries (`[PRE]`, `[INIT]`)

`[PRE]`: `MENU = 0`; Jack at (0, −100); `LOC1`…`LOC5 = 0` (cars 1–4 occupied, and `LOC5` means a drive is in progress); `AutoIncRange LOC7 0 200` (a comment in the script says this simulates the little figures leaving at random; see the counter that survives scenes); `Inc CITYCOUNT`, and at 8 it becomes 1 (a cycle 1…7, which picks the drive's cars). Every arrow marker is moved to (0, 500), then one of them according to `LAST`:

| `LAST` | From | Marker (the arrow under the place) | `SETSHIFTX` | `[INIT]` |
|---|---|---|---|---|
| 6 | `SC006` (driving off from the office), Ctrl 3 in chapter 1 | `UJH00.PBM` at (516, 262), the office | — | `Anima UJH00.PBM 0 6 4 0 +` |
| 32 | `SC032` / `SC032B` (the car `32LAST.PBM`), Ctrl 3 in chapter 2 | `UCC00.PBM` at (328, 139), the club | — | `Anima UCC00.PBM …` |
| 69 | `SC069` (the car, when `DALFLASZ` is 1, the end of chapter 2) | `UFR00.PBM` at (29, 306), the workshop | — | `Anima UFR00.PBM …`, and when `CITYCOUNT` is 4 or above 5 the lamp `LB01.BM` |
| 75 | Ctrl 3 in chapter 3 | `USH00.PBM` at (685, 42), the port | 180 | `Anima USH00.PBM …` |
| 87 | the port `SC087` (chapter 3) | `CIEZ.PBM` at (900, 61), the truck | 376 | `AUTO2`, 200 ticks, `FLX0` drive 5, `GOTOSCENE SC100` (no click; only recorded) |

Then always: `MUSIC` (`TR03-22.PMS`), `CZYHAF` / `CZYJACK` / `CZYSTAD` (lighting the place names), `OKIENKA` (lighting 27 windows `O*1.BM` in turn, `Anima … 0 100 4 0 +` with gaps of 5–105 ticks), `HUMANBEING` (the little figure `LA00.BM` back and forth, gaps from `LOC7`, `REACTIVESELF`).

**The highlight.** `CZYxxx`: `UnLock`; `If LOC5 1` then `DeactiveSelf`; when `MOUSEX` / `MOUSEY` (the cursor point in the scene) lies in the place's rectangle, `Anima <label> 0 3 3 0 -`; then `ActiveMacro CALL_CZYxxx`, which turns `CZYxxx` on again (a loop every tick, and the player is never blocked). The rectangles: the port 590…770 × 2…75 (`HAF013.BM`), the office 541…641 × 254…314 (`JACK13.BM`), the center 238…347 × 123…185 (`STAD13.BM`). The workshop name is painted on the background itself. It has no zone and no macro.

## 3. Exits (a click)

The `.ACE` zones: `HAFFEN`, `JACKH`, `COCL`. A click with the pointer (mode 0) starts `POKAZANIE-HAFFEN` and `POKAZANIE-JACKH`. `COCL` has no macro, so the click continues to the sprite `STAD13.BM` → `POKAZANIE-STAD13.BM` (the order is area, then sprite, `resolveClick`). Each macro sets `LOC5 = 1` (the highlights stop), lights the place name with `Anima … +`, then branches on `LAST`: a drive with the arrow and a car, and at the end `GOTOSCENE`.

1. `StopAnimaNeg <marker>` plus `WaitWhileAnima` (the arrow hides down to frame 0), and `DoNothing 50` in some branches.
2. `ActiveMacroAnima HIDExx FLX0 <anim> 1` (the marker disappears on the first frame of the drive). The background cars `AUTO1`…`4` are in frames that depend on `CITYCOUNT`, and sometimes the view scrolls during the drive (`PRZES` is `SETSCROLLX2 250`, `SCROSH` is `SETSCROLLX2 376`).
3. `ClearAnimaBuffer FLX0`, `SetPositionE FLX0 x y`, `Anima FLX0 0 5 5 <number> -`. The drive is animation `FLX0` number 1…12. Comments in the script name the route.
4. Sometimes `LET LAST` and `GOTOSCENE`.

| Click | `LAST` 6 | 32 | 69 | 75 | Destination |
|---|---|---|---|---|---|
| the port (`HAFFEN`) | drive 2 | 1 | 7 | 12, `LAST = 6` | **`SC075` always** (`LAST` stays, except 75 → 6) |
| the office (`JACKH`) | 11, `LAST = 32` | 3 | 6 | 8 | `SC006` |
| the center (`STAD13.BM`) | 4 | 10 (club to club), `LAST = 6` | 5 | 9 | `SC032` when `ODJECHAL69` is 0 (the start of chapter 2), otherwise `SC032B` (after chapter 2) |

`AUTOn` (`UNLOCK`; if `LOCn` is 0: `LOCn = 1`, `Anima <car> 0 6 1 0 -`, `LOCn = 0`). The cars `3AU000.PBM`, `4FJH000.PBM`, `4AUT007.PBM`, and `INNE011.PBM` (the last one is `SHOWE` / `HIDEE`) drive once, when the drive reaches that frame.

Entering `SC032` from `LAST` 6, 69, or 75 ends in `SC032` with `LAST = 6` (the script of `SC032` sets it). That matches [chapter2.md](chapter2.md).

**Which places are active.** All three, always. The script does not turn zones off (`SETAREA`, `IGNOREAREA`) and does not check the chapter. In particular **the west port (`SC075`, chapter 3) is clickable already in chapter 2** (the name is visible after scrolling right), and `ODJECHAL69` only distinguishes the version of the street in front of the club. Play confirms it: after driving off from the office you can go straight to the port.

**Hitting the zones is an original quirk, replaced by §3a.** `Area_Contains` `00412e40` is not a full triangle test. It only checks which side of edges 1–3 vertex 2 lies on, then the side of the point against the three lines ("below the line", `Geom_PointBelowLine` `00403430`), with no bounding rectangle. For the triangles in `SC000D.ACE` that gives (the engine computes it the same way, `packages/engine/src/walk/geometry.ts` `insideTriangleSides`):

- `JACKH` is exactly the office rectangle.
- `HAFFEN` is only the upper-right half of the port frame (a click under the frame's diagonal does nothing, even though the name lights up), but the first triangle catches the whole **top strip of the map** to the left of x = 591 (y about 78 and below).
- `COCL`: both triangles reach far (the left part of the map: x ≤ 346 from y = 123 downward, x ≤ 239 at the top), but **the zone has no macro**. `Area_ClickMacro` `004243a0` returns 0 and the click goes to the sprites (`Cursor_HitTestSprites` `00424f10`). Only `STAD13.BM` (the center name) drives to the club. A click in the empty left part of the map outside it **does nothing** (the map has no walk area).

The result matches the listing and matches play: the upper-left corner of the map drives to the port, and the lower-left corner does not react. Tests: `packages/engine/src/map/map.test.ts` (the geometry and the click order).

## 3a. The engine's departure: a click is the highlight rectangle

A departure from the original, kept on purpose. The original (§3) clicks differently from the way the name lights up. The port reacts to half the frame and the whole top strip of the map, and the center only through the sprite `STAD13.BM`. In the engine the click area of each place is **exactly the rectangle in which the macro `CZYxxx` lights the name** (§2), and the hand cursor lights at the same points (the same `areaUnder` test for the click and the cursor):

| Place | Highlight macro | Rectangle (cursor points) | A click starts |
|---|---|---|---|
| the port | `CZYHAF` | x 591…769, y 3…74 | `POKAZANIE-HAFFEN` |
| the office | `CZYJACK` | x 542…640, y 255…313 | `POKAZANIE-JACKH` |
| the center | `CZYSTAD` | x 239…346, y 124…184 | `POKAZANIE-STAD13.BM` |

A click outside those rectangles does nothing (the map has no walk area). The bounds come from the script's conditions. `IfF MOUSEX < 770`, `> 590`, and the rest are **strict**, and the cursor has integer coordinates, so the rectangle is exclusive of `(lower, upper)`.

Implementation: `packages/engine/src/map/clickzones.ts`. The rectangles **are not hardcoded**. `hoverBox` reads them from the four `IfF MOUSEX` / `MOUSEY` of the macros `CZYHAF` / `CZYJACK` / `CZYSTAD` in the compiled `SC000D.MCC`. Only the mapping from macro to destination is fixed (`HOVER_TARGETS`). `mapClickAreas(areas, program)` returns the scene's area list in which the triangles `HAFFEN` and `JACKH` are replaced by two triangles that cover exactly the rectangle (`rectTriangles`, vertices chosen so that `Area_Contains` hits exactly its points, checked by a brute-force test), and the area `COCL` (which has no macro in the original) is renamed to `STAD13.BM` with the center's rectangle. An ordinary `Area_ClickMacro` then finds `POKAZANIE-STAD13.BM` and the click does not have to go through the sprite. The sprite `STAD13.BM` lies entirely inside the rectangle, so no "dead" point is left outside it. The number of areas and their order do not change (`AreaState` stays consistent).

After the map scene loads (`name === MAP_SCENE`), its areas are replaced: `sc.scene.areas = mapClickAreas(sc.scene.areas, the scene's MCC program)`, before the first frame, where `this.areas.reset()` runs. `zoneCursorMode`, `areaReaction`, and `areaClick` all read `sc.scene.areas`.

## 4. Ctrl point 3 of the coat

`Game_Run` (the coat loop `004391d3`…): `LAST` follows the chapter of the current scene (`0x6d38ca`, `Scene_ChapterFromName` `0047e980`: below 31 → 1, below 75 → 2, below 100 → 3, below 200 → 4, otherwise 2, so the cellars `SC201`…`SC210` are chapter 2). Chapter 1 → 6, 2 → 32, 3 → 75, 4 leaves `LAST` unchanged. Then `SC000D` with a **hard cut**, not a dissolve. See [cheats.md](cheats.md). The engine: `PlayGame.ctrlPoint(3)`, `mapLast`. The coat cannot be opened on the map itself (`MENU = 0`). Chapter 4 leaves `LAST`, so the map shows the marker of the last value, or none.

## 5. What was checked

Driving off from `SC006` reaches the map (`LAST` is 6, `MENU` is 0). A click on the center plays the drive and arrives at `SC032`. After the entry macro `MENU` is 1 and F1 opens the coat. From `SC069` with the bottle-given flag the map has `LAST` 69 and the arrow under the workshop, and the center goes to `SC032B`. From `LAST` 32 the office goes to `SC006` (`LAST` 32) and the port goes to `SC075`. Entries with `LAST` 75 and 87 toward `SC100` skip no commands and do not hang.

## 6. Open

- The west port is clickable in chapter 2, and the zones are wide (§3). Play confirms it, and it matches the code.
- `DEACTIVESELF` in `CZYxxx`: the engine's interpreter ends the macro but still runs the next step (`ActiveMacro CALL_…`), so after a click the highlight loops can last until the scene changes. There is no visible effect (the names light through `+` anyway). The order in `Script_ExecStep` was not checked.

## 7. The zone overlay

`packages/engine/src/map/zones.ts` and `packages/engine/src/map/zonesScene.ts` (no DOM). Tests on stand-ins are in `packages/engine/src/map/zones.test.ts`. The overlay colors what **actually** reacts to a click at each point (a grid every 2 px, the order `resolveClick`: an `.ACE` zone with a `POKAZANIE-…` macro, then a sprite with a macro, the pixel test `ScenePlayer.spriteCandidates`). A grey hatch is a zone with no macro (`COCL`), which the click passes through and then does nothing. Frames are the zone rectangles, and for a sprite the area where its macro works.

Nothing is hardcoded:

- the zones come from `parseScene` passed through `mapClickAreas` (§3a, so the page shows the click that matches the departure). Sprites are the objects for which a macro `POKAZANIE-<name>` exists;
- destinations: `runClick` runs the macro on a stand-in host and takes the first `GOTOSCENE` (one command per tick; the scene changes right after it);
- conditions: `destinations` tries every combination of the values the macro's `IF` / `IFF` tests and keeps the variables that change the destination (on the map only `ODJECHAL69` for the center);
- the state switch: the chapter sets `LAST` the way Ctrl point 3 does (`mapLast`). The other variables are the ones the macros test.
