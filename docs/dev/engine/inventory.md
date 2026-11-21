# The inventory: the coat, combining items, and the dead bar

The inventory the player sees is Jack's coat (F1). The item name appears at the bottom of the screen when the pointer is over a cell. The item bar at the top of the screen is dead code.

Code: `packages/engine/src/inventory/` (`model.ts` is `Inventory`, `layout.ts` is the geometry, `screen.ts` is `CoatScreen`, `assets.ts` loads the pictures). The screen has no DOM. It does not draw the cursor. After each frame the host sets the global cursor (`packages/engine/src/cursor`) to `screen.cursorMode` (4, 0, or 5), `idle` to `screen.cursorIdle`, and, in mode 5, the picture `"item"` to the held image, then draws the cursor after `screen.draw()`.

## 1. The data

One memory of **84 slots** (`0x54`).

| Table | Address | Element | Contents |
|---|---|---|---|
| `g_invOccupied` | `0051fa08` | 1 byte | the slot is taken |
| `g_invNames` | `007bf0d8` | 14 bytes (`0xe`) | the item name, which is **the scene object's name** |
| `g_invImages` | `008ad438` | `0xdd4` bytes | the picture: `u16` width, `u16` height, RGB565 pixels, **color key 0**. Room for at most 1768 pixels |
| `g_invShadowImages` | `00653e10` | `0xdd4` bytes | the shadow, computed when the coat opens |

The name is the only identifier. `ITEMPRESENT`, `NOHAVETOOL`, the macros `<item>-<target>`, and `ELEM.LST` all use it. The picture is **a copy of the scene object's picture** (`Inventory_Add` does `Blit_Copy16` from the object's sprite). The same bitmap therefore lives in the scene and in the coat. The limit of 1768 pixels is not checked.

### 1.1 Two regions: `g_invSplit` is 66, and the variable `MARZECZY`

`g_invSplit` `00503b60` is `0x42`, which is 66 (the value in `.data`. Nothing changes it). The script variable **`MARZECZY`** picks the active region (the initial value in `VARIABLE.ALL` is **1**).

| `MARZECZY` | Region | The coat screen |
|---|---|---|
| not 0 (the start of the game) | slots **0…65** (22 rows of 3) | **scrolls**, five rows at a time |
| 0 | slots **66…83** (6 rows of 3) | a **fixed** view of 5×3 from row 22 (slots 66…80). Scrolling is off |

`Inventory_Add` and `Item_PutBackToBar` put the item in the **first free slot of the active region** (the loop is `0…65` when `MARZECZY` is not 0, otherwise `66…83`). No free slot means nothing happens, and there is no message. The other region stays untouched and invisible.

Scripts change `MARZECZY` only in `SC105`. The take-the-uniform macro ends with `LET MARZECZY` (that is 0). The show-right exit, when `MARZECZY` is 0 and `JACKISWOJ` is 1, does `LET MARZECZY 1`, **`EXTRA 11`**, and `HAVEGUN`. `EXTRA 11` (`Script_ExecStep` case `0x24` / `0xb`) moves every occupied slot from `66…83` into the first free slot of `0…65` (the picture, the name, the occupied flag) and rebuilds the bar (`TopBar_Rebuild`). `SC115` tests `MARZECZY == 1`. A hypothesis from the name: in the uniform Jack does not have his own things with him (he sees a separate, empty coat `INV_M`), and after leaving `SC105` he gets them all back. The old ones in `0…65`, plus whatever he collected in the uniform, land at the end.

Visibility gaps, from the code. When `MARZECZY` is 0, the visible slots are 66…80, so **81…83 are never shown** (a 16th item would be invisible). When `MARZECZY` is not 0, scrolling stops at row 16 (the condition is `g_coatScrollRow < g_invSplit/3 − 6`), so row 21 (slots 63…65) cannot be reached, and **End** jumps to row 16, not 17.

### 1.2 Script commands

| Command (code) | Effect |
|---|---|
| `HAVETOOL object` (`0x46`, case `0x45`) | `Inventory_Add` of the object's index: a free slot of the active region, a copy of the picture and the name, and a draw onto the bar (dead, section 8). 579 uses, 51 different items. Does not check for duplicates |
| `NOHAVETOOL name` (`0x47`, case `0x46`) | If the hand holds an item of **that name**, `g_verbMode` and `g_cursorMode` become 0 and the hand is empty. Otherwise the **first** occupied slot `0…83` of that name is cleared (and erased from the bar). A missing item does nothing |
| `NOHAVE` (`0x28`) | `Cursor_ResetMode` `00419740`: the hand is empty, the mode is 0, the verb is the pointer. The item in the hand **is lost**. It does not return to the coat |
| `TAKE object` (`0x22`, case `0x21`) | The item goes **into the hand** (the hand is not the coat). If something is already held, `Item_PutBackToBar`. The picture and the name come from the object, `g_cursorMode` is 5, `g_itemInHand` is 1, `g_clickArmed` is 0, and the grow-in animation plays ([cursor.md](cursor.md)). `0x7bf598[macro]` is 1 |
| `MOUSETOTOOL` (`0x89`, case `0x88`) | If something is in the hand, `Item_PutBackToBar` (the first free slot of the region, `Cursor_ResetMode`). One use, the car macro of `SC006` |
| `ITEMPRESENT name variable` (`0x9f`) | `variable = Inventory_Has(name)` `00408c80`: `strcmp` against every occupied slot `0…83`. It does **not** see the item in the hand. Two uses (`SC033` and `SC052`, the money picture into `LOC3`) |
| `CLEARMENUBAR n` (`0x85`) | **nothing** (an empty branch. In the DOS version it probably cleared the bar). Three uses |
| `EXTRA 11` | moves slots 66…83 into 0…65 and rebuilds the bar |
| `EXTRA 6` / `EXTRA 8` | the uniform on and off: `g_jackUniform` (`INV_M`). See [dialog.md](dialog.md). `EXTRA 6` is only `SC105`. `EXTRA 8` is never used |

`Inventory_Has`, and the name search inside `NOHAVETOOL`, walk **all 84** slots. Adding writes only the active region.

An ordinary take (the take macro, then `TAKE`) puts the item **in the hand**. A click on empty scene space puts it back in the coat (`Item_PutBackToBar`, [areas.md](areas.md)). A click with it on a target that has no macro makes Jack refuse, and the item stays in the hand.

## 2. Opening the coat

The condition (`Game_Run`, the coat block): (F1 (`0x3b`) pressed once, or `g_coatRequest`) and the bullet menu is closed (`g_cursorZoneSuspended` is 0) and no dialog face (`g_faceLeft` and `g_faceRight` are both −1) and the variable **`MENU` is not 0** (the index `007cde80`. Scripts clear it for scenes with no control) and `g_cursorEnabled` and `00870cf8` is 0 and the notice bar is hidden (`g_noticeShown` is 0) and no macro is active (`Script_AnyMacroActive`) and the bar is closed (`g_topBarOpen` is 0).

`g_coatRequest` `008f6870` is set by:

- the **right** button, when an item is in the hand (`g_cursorMode` is 5);
- the **middle** button `009d281c`, **always**, even with no item;
- a left click **on Jack** with no item, when `g_jackIsMenu` (`008f687c`) is not 0 (`Sprite_ClickMacro`). `JACKISMENU` defaults to **1** in `VARIABLE.ALL`. See section 6.

The request **is not cleared** until the conditions allow entry (it waits out a macro or the notice bar) and is cleared only on entry (`g_coatRequest` becomes 0). F1 is tested with `Input_KeyPressedOnce` (an edge).

On entry the notice bar rolls up (`while (g_noticeShown) Notice_RollUp()`, with `Timer_Sleep` and `Sys_PumpMessages`), `g_logicFrozen` becomes 1, `Snd_TogglePauseFx` pauses the effects, `g_softEdges` is saved and set to 0, the scene scroll `g_scrollX` is saved and **cleared** (the mouse subtracts `scrollX`), the full-screen coat picture is drawn with `Blit_ImageToScreen(0, 0)`, and the render background is replaced (`g_renderBg` becomes `g_guiHeap`. `Sprite_HideWorld` hides the world). The cursor stays enabled. With nothing in the hand, `g_cursorMode` becomes 4 (the hand `HAN`). It waits until every button and key is released.

## 3. The look of the screen

### 3.1 Two pictures, from `g_jackUniform`

| | `g_jackUniform` is 0 (civilian) | `g_jackUniform` is not 0 (the uniform, after `SC105`) |
|---|---|---|
| background (`GLOBAL.PAK`) | `INV_C.BM`, 640×480, the yellow trench coat | `INV_M.BM`, 640×480, the green uniform |
| up and down arrows, rest and pressed | `A_UP1_C` / `A_UP2_C`, `A_DN1_C` / `A_DN2_C` (40×40) | `A_UP1_M` / `A_UP2_M`, `A_DN1_M` / `A_DN2_M` |
| the options button, rest and pressed | `OPT1_C` / `OPT2_C` (152×72) | `OPT1_M` / `OPT2_M` |
| the hidden Ctrl points (section 6) | (417, 197) (417, 248) (416, 312) (417, 365) | (405, 211) (407, 299) (411, 393) (319, 200) |

The grid, the arrows, and the options button are in **the same places** in both versions. Only the bitmaps and the Ctrl points differ. The coat fills the left half. The rest of the picture is Jack. The version depends only on `g_jackUniform` at the moment of entry.

Positions, in screen pixels of 640×480:

- **The grid** is 3 columns by 5 rows. A cell is `0x30` by `0x34` (48×52). The center of a cell is `(0x6e + column·0x30, 200 + row·0x34)`. The hit area is `x` in `(0x56, 0xe6]` and `y` in `(0xae, 0x1b2]` (`column = (mouseX − 0x56)/0x30`, `row = (mouseY − 0xae)/0x34`, and it requires `mouseX−0x56` at least 1 and `mouseY−0xae` at least 1). The item is **centered**: the top-left of the picture is the center minus `(width/2, height/2)`.
- `INV_C` and `INV_M` **do not contain** the arrows or the options caption. On entry `Game_Run` loads `INV_x.BM` into `g_guiHeap`, then **copies into it** (`Blit_Copy16`, no color key) `A_UP1_x` at `(0x21, 0xfc)`, `A_DN1_x` at `(0x21, 0x15a)`, and `OPT1_x` at `(99, 0x42)`. The "2" pictures are the pressed sprites. The arrows and the options button are therefore always visible. The host paints them at `open()`.
- **The cursor:** the coat does not draw it. It sets `g_cursorMode` (4, the hand `HAN`, over the grid; 0 outside it; 5 is the item in the hand) and `g_cursorIdle` (0 over an occupied cell). `Cursor_DrawOnPresent` draws it. See [cursor.md](cursor.md).
- **The up arrow**, inactive, is at `(0x21, 0xfc)`. The active variant is a sprite at z 10, parked at `(0x21, 0x228)` (off screen) and shown at `(0x21, 0xfc)` while pressed. The area is `x` in `[0x22, 0x48]` and `y` in `[0xfd, 0x123]`. **The down arrow** is at `(0x21, 0x15a)`, `y` in `[0x15b, 0x181]`.
- **Options** is painted at `(99, 0x42)`. The pressed sprite is at `(99, 0x42)` (parked at `y = 0x228`). The area is `x` in `[100, 0xfa]` and `y` in `[0x43, 0x89]`.
- An item is two sprites on a cell: the item at z 100, and a **shadow** at z 10 shifted by `(+3, +3)` (`g_itemShadowDx` / `Dy` `00503ba0` / `2`). `Item_BuildShadowImage` `00408f50` takes, for each opaque pixel of the item, the **background** pixel (`g_guiHeap`) at that place and darkens it (`0047d5c0(pixel, 0, 0.5)` is `ftol((a·(2 − t) + b·t) / 2)` per channel, which is **three quarters of the brightness**, not a half. An earlier engine used ×0.5, so the shadows were darker than the original. A result of 0 is a transparent pixel, with no replacement color). Color 0 is transparent. Both sprites clip to `(0x56, 0xae, 0xe6, 0x1b2)`. The shadow is computed **only** when the cell is built.

### 3.2 The cell map

`g_coatCells` `0088f318`: the index `column·10 + row` (stored at `row·4 + column·0x28`) is the slot shown in the cell, or −1. The slot for a cell is `column + (row + g_coatScrollRow)·3`. `g_coatScrollRow` `008f68d4`: when `MARZECZY` is 0 it is set to `g_invSplit/3`, which is 22, on entry, and restored on exit. When `MARZECZY` is not 0 it **keeps its value between openings** (it starts at 0. Loading a save clears it, `004095db`).

`g_coatScrollRow` is an ordinary global. Only the coat entry and exit (and only when `MARZECZY` is 0), the scroll keys and arrows, and a load (`004095db`) write it. A scene change does **not** reset it, and the save file does not store it, so after a load it is always 0. The scroll condition checks only the row bounds (0…16), **not** whether slots are occupied. An empty coat scrolls the same way. An item taken later goes to the first free slot of the region (`Inventory_Add`), independent of the view, so it appears in the already-scrolled coat on whatever row it lands on, which may be off screen. The coat scrolls from the start of the game, including while it is empty.

## 4. The screen loop (`004391d3`…`0043b1d6`, every frame)

The order in a frame: `Timer_MarkFrameStart`, the Ctrl points, the cell under the mouse (the name, a take, a put-down, or a use), `g_clickArmed` becomes 1 when the left button is up, `Cursor_AnimateStep`, the scroll keys, the arrow sprites and the scroll, the options button, the exit condition, `Sys_PumpMessages`, `Timer_WaitSinceFrameStart`.

### 4.1 The name on hover

For an occupied cell (`g_coatCells` at least 0): `g_cursorIdle` is 0. If the cell differs from the previous one and the bar is already visible, it rolls up. When `g_noticeState` is 0, `Item_LookupName` `00429ce0` looks up the slot's name as the third token of `ELEM.LST`. The result is the second token, with `_` turned into a space. **A missing record shows three question marks** (`004f7ec8`), not an empty string. `Notice_Show(400, text)` puts the bar at `y = 400` (15 px tall). When `g_noticeState` is 1, `Notice_Unroll` opens it by 2 px a frame up to `0x20`. The name is shown **even when another item is in the hand** (mode 5). It hints at the combine target. Off an occupied cell the bar rolls up (`Notice_RollUp`) and `g_cursorIdle` is 1. With no item, the mode is 4 over the grid and 0 outside it. With an item, mode 5 does not change. All 51 items used by `HAVETOOL` have a record in `ELEM.LST`.

### 4.2 The left button on a cell

`g_clickArmed` and the left button. After the click, `g_clickArmed` stays 0 until the release.

| State | Cell | Effect |
|---|---|---|
| the hand is empty | occupied | **a pull**: the held image becomes the slot's picture, `g_cursorMode` is 5, `g_itemInHand` is 1, the cursor picture is the image, the held name is the name. Both sprites are removed. `g_invOccupied[slot]` is 0. The cell is −1. There is **no** grow-in animation (only `TAKE` has that). The screen stays open |
| an item is in the hand | empty, inside the grid | **a put-down**: the slot is `column + (row+scroll)·3` (**any free cell**, not only the first). The picture and the name are copied (`memmove` and `strcpy`), occupied becomes 1, new sprites and a shadow are built, the mode is 4, and the hand is empty |
| an item is in the hand | occupied | **a combine, or a use on the item**: the macro name is the held name, a hyphen, and the slot's name. `Script_StartMacro` (`004247c0` then `Script_FindMacro`). If it was found (`g_macroStarted` at least 0): the mode is 4, the hand is empty, and **the screen closes** (the macro runs in the scene). If it was not found, **nothing happens**: the item stays in the hand, the screen stays open, Jack does not refuse, and there is no catch-all macro |

A click on an empty cell or on empty space **outside** the grid, with an item in the hand, does nothing.

## 5. Combining items

The mechanism is only the one above: **a macro named `A-B`**, with no recipe table in the code. The macro must exist in the current scene's macro table. Macros from `GLOBAL.MCC` are attached to every scene, so the combinations work in **every** scene. A check of every macro of every scene whose name is `A-B`, where `A` and `B` are keys of `ELEM.LST`, finds **exactly two combinations**, each in both orders (`A-B` activates `B-A`).

| Combination | What the macros do |
|---|---|
| the boxing gloves and the horseshoe (`REKAWI.BM` and `IPODK.BM`) | one order only activates the other. The other removes both items, plays the global film `PODKOWA`, puts the steel gloves (`REKAWI_S.BM`) in the coat, and sets `SILNY` to 1 |
| the rope and the anchor (`89LINA_I.BM` and `KOTWIC_I.095`) | one order only activates the other. The other does `NOHAVE`, plays the global film `WIAZKOTW`, removes both items, and puts the anchor tied to the rope (`95KTZW_I.BM`) in the coat |

The second macro removes both items: the one in the hand by the "held, and the name matches" branch of `NOHAVETOOL` (or by `NOHAVE` for the rope), and the one in the coat by a search on the name. The result of `HAVETOOL` goes to the first free slot of the active region, after the screen has closed. The films `PODKOWA` and `WIAZKOTW` are entries of `GLOBAL.FCM`. They are the only purpose of that file. There is no third combination. No scene macro named `A-B` has both sides as items.

The same naming is used to use an item on a zone or a sprite: `<item>-<NAME>`, with the catch-all `<catch-all>-<NAME>` as a fallback ([areas.md](areas.md)). **The coat has no fallback macro.** For the screen, "item A dropped on B" is the event `startMacro("A-B")`. When the macro is missing, nothing happens. In play, with no combination, nothing happens and Jack is silent.

A left click on Jack with no item opens the coat (the default `JACKISMENU` is 1). In `SC105`, after the change into the uniform, the coat is empty (`MARZECZY` is 0, so the region is 66…83), and the things come back after the return and the walk to the right (the show-right macro plus `EXTRA 11`).

## 6. The rest of the screen

### 6.1 Scrolling (only when `MARZECZY` is not 0)

Keys (`Input_KeyPressedOnce`, scan codes): down `0xd0`, up `0xc8`, page down `0xd1`, page up `0xc9`, End `0xcf`, Home `0xc7`. "Down" is down, page down, or End. "Up" is up, page up, or Home. Page up and page down are **4 repeats** of a single step, with no animation. End and Home jump to the extreme row (`g_coatScrollRow` becomes `g_invSplit/3 − 6`, which is 16, or 0). The mouse arrows: a left press in the arrow's area shows the "2" sprite and, once (an edge), steps in that direction. A step is allowed downward when `g_coatScrollRow` is below 16, and upward when it is above 0.

The animation of a single step is 8 frames (`t` is 0, 7, …, 49 px, with `Timer_Sleep` after each). The rows move by `t` px vertically, and the row entering or leaving at the edge is scaled (`Cursor_BoxScale`, float coefficients, **not reproduced exactly**). The cells are then built again. The engine uses a linear shift of 52 px in 8 frames. When `MARZECZY` is 0 the arrows only highlight. They do not scroll.

**The mouse wheel is a departure from the original, kept on purpose.** The original does not handle a wheel. There is no trace of it in the code. In the engine one wheel notch is one arrow click. `CoatScreen.wheel(dir)` calls the same `step` as `arrowPress` (the same 8-frame animation and the bounds 0…16, with no pressed-arrow sprite and no sound). Wheel down is the down arrow. Only while the coat is open and `MARZECZY` is not 0. In the other region the wheel does nothing. A notch during the animation is **ignored** (there is no queue). `deltaY` is summed by `WheelAccumulator` (`packages/engine/src/inventory/wheel.ts`): a threshold of 100 px (a line delta is 100/3 px, a page is 300 px), one notch per event, the sum returns to zero after a notch, and a change of direction clears the sum, so a trackpad does not scroll several rows at once. The logic is `PlayGame.wheel(deltaY, deltaMode)`.

### 6.2 The options button

A left press in the area shows `OPT2` (pressed). **A release** in the area (`99 < x < 0xfb`, `0x42 < y < 0x8a`) sets `g_optionsRequest` to 1 and **closes the coat**. On the next frame `Game_Run` opens the options menu (F4, `Menu_InGameOptions`). A release outside the area only hides the pressed sprite.

### 6.3 Leaving

The loop ends (`0043b004`…`0043b04a`) when **F1** (`0x3b`) or **Esc** (`1`) is down (`Input_IsKeyDown`), or the right or middle button is down, or the left button is down with `mouseX` at least `0xf1` (the right part of the screen, where Jack is. The options button's strip `x` in `[0xf1, 0xfa]` also closes). The Ctrl points (below) end the loop differently. The cleanup rolls up the notice bar, removes the sprites (3 buttons plus 2 per cell), sets `g_cursorEnabled` to 0, restores `g_scrollX`, the background, and `g_renderBg`, calls `Sprite_RestoreWorld` and `Render_RedrawAll`, waits for the buttons to be released, restores `g_logicFrozen`, and calls `Snd_TogglePauseFx`. The cursor: if you are not holding an item (the mode is not 5) it returns to the remembered verb mode (`g_verbMode`), and mode 4 becomes 0. An item in the hand **stays** (mode 5).

### 6.4 Hidden points with Ctrl

`Input_IsKeyDown(0x1d)` is the left Ctrl key in the original. The engine sets the flag from either Control key. The left button, held (checked every frame, not on an edge), within ±3 px (`x−4 < mouse < x+4`, the inequalities are strict). See [cheats.md](cheats.md).

| # | Civilian / uniform | Effect |
|---|---|---|
| 1 | (417, 197) / (405, 211) | `Script_StartMacro("TOPWARE")` plus `HAVETOOL` of the money picture (`Object_FindByName` and `Inventory_Add`). Closes the coat |
| 2 | (417, 248) / (407, 299) | leave the scene for the movie `OUTRO.AVX` (the end of the game) |
| 3 | (416, 312) / (411, 393) | the scene `SC000D.CCG` (the city map) by a **hard cut** (`g_sceneChange`. `DAT_0086f985` set to 1 only hides the cursor until the scene change ends, `Cursor_DrawOnPresent` `00426370`. It is not a dissolve. Confirmed in the original). `LAST` from `0x6d38ca` (1 becomes 6, 2 becomes 32, 3 becomes 75. Chapter 4: no change). **`0x6d38ca` is the chapter number of the current scene** (1…4). `004063e0` stores it as `Scene_ChapterFromName` `0047e980` (a scene number below 31 is 1, below 75 is 2, below 100 is 3, below 200 is 4, otherwise 2), called for every scene from `Scene_SetNumberAndMapFlag` `00406420` (that is also the map flag: chapter 2 or 3). `Game_Main` clears it. `Game_Run` checks `== 3` at the start. The engine: `sceneChapter(sceneNumber(scene))` in `packages/engine/src/keys/backspace.ts`, and `mapLast` in `packages/engine/src/play/game.ts` |
| 4 | (417, 365) / (319, 200) | **the `JACKISMENU` switch**: `Var_Set("JACKISMENU", …)` and `g_jackIsMenu` toggles between 0 and 1, and the coat closes |

**`JACKISMENU`** is a variable stored in the save (1 by default. At the start of a scene `g_jackIsMenu` is `Var_Get("JACKISMENU") != 0`, `0042bbaf`). When it is not 0, a left click **on Jack's sprite** with nothing in the hand opens the coat (`Sprite_ClickMacro` sets `g_coatRequest` to 1). The macro `<verb>-JACK` is still searched as usual (the engine: `ScenePlayer.spriteCandidates` includes Jack as `JACK`, and `PlayGame` sets `coatRequest`. The uniform and the trench coat behave the same). With an item in the hand, a click on Jack is a use of the item on the target `JACK`. With no `<item>-JACK` and no catch-all for `JACK`, Jack refuses.

## 7. What a save stores

The inventory in a save file (`00408560` writes, `00409090` reads): a `u16` count of occupied slots, then for each occupied slot a `u16` slot index, 14 bytes of name, and `0xdd4` bytes of picture, in that order, then the variables (`MARZECZY`, `JACKISWOJ`, and `JACKISMENU` are ordinary game variables in `g_varValues`). The read clears all 84 occupied flags, loads the slots, and rebuilds the bar (`TopBar_Rebuild`, plus the pictures). A new game calls `Inventory_Clear` `00408c30`. **Not saved:** the item in the hand (F2 and F3 put it back first, through `Item_PutBackToBar`), and `g_coatScrollRow`. After a load, `00409090` restores `g_jackUniform` from `JACKISWOJ`. The rule is in [animation.md](animation.md). The engine is `uniformAfterLoad`.

The model: `slots[84]` is `{name, image}` or null, the region comes from `MARZECZY`, and the pictures come from scene objects. `snapshot` and `restore` are for the save. The hand and `scrollRow` are not in the snapshot. `limbo` is the item that was in the hand when a macro started. `moveBigRegion` is `EXTRA 11`.

## 8. The item bar at the top of the screen is dead code

Everything is gated by `g_topBarOpen` `006bc294` not being 0. The writes are only `0` (`0042c6c9`, `0042e839`, `0042f22d`, `0042f9e5`). **Nothing sets it to 1**, and the code that would open the bar is missing. The designed behavior is read from the close and the handling. The opening is a hypothesis (the mouse in the top `0x5a` pixels, because the close is `mouseY > 0x5a`).

`Game_Main` loads, from `RESOURCE.PAK`: the bar background `TOPMGR.BM` (640×71) at z 500, the options button `OPTGR.BM` (131×34), the arrows `L_ARROW.BM` and `R_ARROW.BM`, and the item strip `g_topBarImg` `008ab8c4`, which is **3 copies** of `BELKA.BM` (792×48) side by side, 2376 px (`TopBar_Rebuild` `00408af0`). A bar slot is **44 px** (`0x2c`). The copy from `BELKA.BM` uses `(slot·0x2c) % 792`. Slots 0…53 fit in 2376 px.

`RAMKA.BM` (48×41, four corners) is **not** part of the bar. It is a frame that follows the cursor at `(mouseX−0x18, mouseY−0x14)`, and **only when `g_cursorIdle` is 0** (mode 5: under the hotspot there is a sprite pixel, or a zone with a macro `<item>-<name>`, `Cursor_DrawOnPresent`), the mode is at least 5, and nothing is open (the bar, the answer menu, a caption, the bullet menu). The engine used to draw it whenever an item was in the hand. That was wrong. It is parked at `(0, 500)` otherwise.

The engine can still run the bar as a legacy mode. It is not the path the original Windows build takes.

## The host

```ts
screen.open(uniform); // g_jackUniform
// inv.marzeczy is the variable MARZECZY
// each frame: screen.tick(); screen.draw(dst); then the cursor
// pointerDown / Move / Up, keyDown(scan code), wheel(dir)
// onExit is close, options, macro, or ctrl
```

After a `macro` exit the host runs the macro in the scene (`HAVETOOL` and `NOHAVETOOL` become `inv.add` and `inv.remove`, `NOHAVE` is `inv.noHave()`, `TAKE` is `inv.take`).
