# Keys and the message bar

Module `packages/engine/src/keys/` (`keymap.ts` what each key does, `backspace.ts` the Backspace table, `notice.ts` the message bar). Source: `Game_Run` `0042b6d0`. The frame order is [game_loop.md](game_loop.md).

Key codes are DirectInput scan codes. The recovered listing drops the argument of `Input_KeyPressedOnce`, so the call order in `Game_Run` (Backspace, F5, F6, F10, F2, F3, Esc, M, F1) is the confirmation in the code.

## 1. Events: `keyActions(input, ctx)`

`Input_KeyPressedOnce(k)` is a fresh press (an edge). `Input_IsKeyDown(k)` is a key held down. The result is a list of actions in the order `Game_Run` checks them. An action that changes the scene or opens a modal stops the rest of the frame. That is the layer that connects the keys to the game. Conditions come from `KeyContext` (the original names are in the field comments):

| Key | Address | Action | Conditions (all must hold) |
|---|---|---|---|
| Backspace | `0042cff9` | `backspace` — load the scene from the table (§3) | the scene has control (`g_sceneNoControl == 0`), the table has an entry for the current scene, no answer menu (`g_menuOpen`), no speaker caption (`0x8f6924`), the bullet menu is closed, the top bar is closed, a macro has not locked the player, `g_keysEnabled` (`0x51fa5e`; macros `0x64` / `0x65`) |
| P | `0042d239` | `pause` | the **character** from `Input_GetLastKey` equals `0x19`. The P key never produces that, so it never works (pause on P). Reproduced: `PAUSE_CHAR`. A test shows that `DIK_P` and `'p'` do not fire it |
| F5 | `0042d260` | `quickSave` | **no conditions**. The quick-save notice appears only when no notice is already visible (`notice`). A dated file is written when `0x87165e ≠ 0` and `0x7c7dff ≠ 0`. Otherwise it is a copy of the temporary file `Save_CopyTemp` (`useTemp`) |
| F6 | `0042d34d` | `quickLoad` — the newest file in `SAVEGAME\` (the date is in the name) | **no conditions** |
| F10 | `0042d6cc` | `quit` (the leave-the-game window) | the cursor is not in mode 5 (an item in hand) |
| F2 / F3 | `0042d7e5` / `0042d8c4` | `saveWindow` / `loadWindow` | the bullet menu is closed, no talk face, variable `MENU` ≠ 0, `0x870cf8 == 0`, the top bar is folded (`g_topBarY < -0x48`), no message bar, no active macro, `g_optionsRequest == 0` |
| Esc | `0042dbcd` | `closeBulletMenu` | the bullet menu is open |
| F4 | `00438113` | `options` (`Menu_InGameOptions`) | the key is **held** (`Input_IsKeyDown`, not an edge) and modifier `0xfa` (Alt) is not held, conditions as for F2/F3. The options button (`g_optionsRequest ≠ 0`) enters **without** the key and without the other conditions |
| M | `004381d3` | `map` (`MAP2.BM`) | Ctrl (`0x1d`) is not held, conditions as for F2/F3 **without** the bar condition and without `g_optionsRequest`, and the map is allowed in the scene (`0x7cdee8`, §2) |
| F1 or a mouse request | `0043867e` | `coat` | the bullet menu is closed, no face, `MENU` ≠ 0, the cursor is on, `0x870cf8 == 0`, no message bar, no macro, the top bar is closed (`g_topBarOpen == 0`). The mouse request (`g_coatRequest`): the right button with an item in hand (mode 5), or the middle button |

Digit keys **do not appear** in `Game_Run` or in the GUI windows ([bulletmenu.md](bulletmenu.md)). They do not pick a cursor mode or a choice in a window.

F2, F3, F4, M, and F1 fail in scenes without control only indirectly (scripts zero `MENU` there).

**`MENU` on scene entry.** The only script that zeroes `MENU` is `SC000D [PRE]` (`LET MENU`, the map). The `Game_Run` prologue (`0042b6d0`, after `Save_WriteState`, before `[PRE]`) sets `MENU = (g_exitToDos == 0)` = 1 **on entry to every scene**, so the block lasts only on the map. The engine used to skip this. After the map `MENU` stayed 0, and F1–F4, M, and a click on Jack did nothing in the next scene (for example SC006 → the map → SC032), while F5 and F6 (no conditions) still worked. The fix is `PlayGame.resetMenuVar` in `enter`, before `PRE`. The last frame of a macro, a conversation (faces), the message bar, and the answer window block the same keys as in the original.

## 2. The map is allowed (`0x7cdee8`)

`FUN_00406420` `00406420` (on every scene load): the scene number is `atoi` of the characters of the name from index 2 up to the dot (`0047e8b0`: `SC005B.CCG` → 5, `SC039.CCG` → 39). The chapter is `0047e980` (below 31 → 1, below 75 → 2, below 100 → 3, below 200 → 4, otherwise 2). The map is allowed when the chapter is 2 or 3, or the scene number is on the list `0x50479c` = `{2, 4, 6, 8, 10, 12, 15, 19, 21}` (`MAP_SCENES`, read from the executable). The chapter is only a range of scene numbers (there is no separate table): **1 = SC000…SC030, 2 = SC031…SC074, 3 = SC075…SC099, 4 = SC100…SC199**, and numbers ≥ 200 (sub-scenes, for example 0xc9) get 2. The map therefore works everywhere in SC031…SC099 and, through numbers ≥ 200, in sub-scenes 200+. In chapters 1 and 4 it works only in the 9 scenes on the list.

Those scenes are all around Jack's office: `SC002` the alley with the bins (exits SC004, SC006); `SC004` the flat roof (→ SC002); `SC006` the street under the office, the hub (→ SC002, SC008, SC012, SC019, SC000D); `SC008` a dead-end alley (→ SC006, SC010); `SC010` the yard with the parked car (→ SC008); `SC012` the building corridor (→ SC006, SC015); `SC015` Jack's office (→ SC012); `SC019` the street of townhouses (→ SC006, SC021); `SC021` the narrow lane (→ SC019). The observation that the map works from the office through the middle of the game matches this split (chapters 2 and 3). Where the base sits exactly was not confirmed. `mapAvailableIn(chapter, scene)`, `sceneNumber`, `sceneChapter`.

## 3. Backspace — table `0044cb20`

`Game_Main` calls `0044cb20`: 250 slots (the scene number `g_sceneNumber` `0x8f68d0`) × 4 tables filled with `-1`, then 69 entries (`BACKSPACE_TABLE`, order of the calls kept). An entry is a scene number → a **target** (the value of variable `LAST` `0x5046ee`) plus a **scene file** (`SC005B.CCG` and the rest) plus an optional condition "variable == value". Two tables: the main one (`0x856020`, names `0x855468`, condition `0x856408`) and the secondary one (`0x8573a8`, `0x8567f0`, `0x857790`).

What `0042cff9` does: a main entry is required (`!= -1`). When there is no condition, or `Var_Get(variable) == value`, it uses that entry. Otherwise it uses the secondary entry, if one exists and its condition holds. Effect: `g_sceneName` = the file, `g_varValues[LAST]` = the target, `0x79dfc8 = 0`, `0x8f67ec = 0`, `0x86f985 = 1`, `Sprite_Remove`, `SceneObj_RefreshAll`, `g_sceneChange = 1`. The recovered listing of `Var_Get()` drops an argument. The variable name at `0x86f9b0 + n·0x1e` follows from the entry constructor `0044c9e0`.

An entry says "from sub-scene N go to the parent scene (the file) and set `LAST` = X". `LAST` is the same variable the scene scripts read on entry to place Jack at the right exit ([play.md](play.md)). Checked examples: scene 4 (the roof, `SC004`) → `SC006.CCG` with `LAST=2`; 10 (`SC010`) → `SC006` with `LAST=8`; 12 (the corridor) and 15 (Jack's office) → `SC006` (the street under the office) with `LAST=12` / `0xc`, so Jack stands at the building door; 7, 9, 0xb, 0xd, 0xe → `SC005B`; 0xc9…0xcd → `SC039`; 0xcf…0xd2 → `SC061`. Conditional: 3 → `SC005B` (target 0) when `ROZMZINSP == 1`, or `SC000B` (target 3) when `== 0`; 0x37…0x3a → `SC052` when `LANCUCH58 == 1`; 100 → `SC101` when `D100OPEN == 1`. In play, Backspace takes Jack straight out to the street from alleys and from buildings. That matches the table. Whether it is a player feature or a developer shortcut is not marked in the code (it is not in the options).

## 4. The message bar `0x563f20`

`Notice_Show(y, text)` `00429dd0`: bar height `15` (`0x8f693c`), width = `Text_PrintfWidth` of the text rounded up to even. Two 16-bpp buffers: **A** `0x8f6820` (the scene under the bar, plus a shadow) and **B** `0x563f24` (the text alone: outline `1`, fill `0xffff`, `Text_PrintfAt(0,0,1,0xffff…)`). Sprite `g_noticeSprite` with z = `1600` (`0x640`) at `x = Gui_CenterOffset(640, width) + g_scrollX`, `y`. It sets `g_noticeAnim = 1`, `g_noticeWipe = 1`, `g_noticeState = 1`, `g_noticeShown = 1`, `g_noticeSlot = g_invHoverSlot`. The first picture is the scene under the bar with the text **shadow** (`Text_PrintfAtRemapAlt(1,1,10,6)`: darkened at +1/+1, as in the GUI windows) and without the text.

- `Notice_Unroll` `0042a0d0`: `wipe += 2`. While `wipe < 0x21` the scene under the bar is copied again and text B is blended in at level `wipe/32` (`FUN_0046f8e0`: the same mix tables as in [play.md](play.md) — `blend565` from `packages/engine/src/play/film.ts`), then `Sprite_Set`. Otherwise `g_noticeAnim = 0`, `g_noticeState = 2`. Levels: 3, 5, … 31 (15 frames drawn). 33 finishes.
- `Notice_RollUp` `0042a1f0`: `wipe -= 1`. `wipe < 1` → `slot = 0xffff`, `shown = anim = state = 0`, and the sprite and buffers are removed. Otherwise as above at level `wipe` (32 … 1: 32 frames). It does **not** change `g_noticeAnim`. Rolling up from step 6 requires the caller (the coat) to set `anim = 2`.
- Step 6 of `Game_Run` (`0042cc0f`): `anim == 1` → `Notice_Unroll`, `anim == 2` → `Notice_RollUp` (`tickAnim`).
- F5: `g_noticeAuto = 1` plus `Notice_Show(0x1cc, …)`, and its own block (`tickAuto`) in the same frame unrolls and, on reaching state 2, rolls up **at once**. A full cycle is 48 frames (16 of unrolling, including the first frame of rolling up, plus 32), with no time spent at full color. `g_noticeAuto` is cleared at state 0.
- The coat: `Notice_Show(400, name)`, its own Unroll/RollUp calls, and `y = 400` (`NOTICE_Y_COAT`). `slot` is the cell under the cursor. The name is the item caption, not reproduced here.

`NoticeStrip` holds the state (`shown`, `anim`, `state`, `wipe`, `auto`, `slot`) and builds the picture. `picture(scene, scrollX)` returns a `Surface16` (width × 15) to draw at `(x(scrollX), y)`. The text is `renderText` from `packages/engine/src/formats/fnt.ts` (the game-text font, index 1 in `Text_PrintfAt`).

Compared with play: white text with a dark outline and a shadow, no visible bar background (the bar is a copy of the scene), centered horizontally (the middle is about 320). The middle of the text sits at about y = `0x1cc` (460) plus half of the 15-pixel height. Time: 48 frames × 5–10 ms (`g_frameMinMs`, [architecture.md](architecture.md)) is **0.24–0.5 s** at minimum, plus the cost of drawing. An observation of under a second matches.

### Open

- In `Notice_Unroll` / `Notice_RollUp` the recovered listing writes buffer A as `DAT_008f6820 + 4` (in `Notice_Show`, `+ 2`). That may be a shift of 2 pixels (an original bug) or an artifact of the recovery. The module does not shift. After the first step the shadow is not rebuilt (buffer A is composed again). That matches the code. It was left to check in play.
- The bar font is taken to be the same one `Text_PrintfWidth(1, …)` uses. Font index 1 was not settled as `JACK` versus `JACKM`.

## 5. "An active macro" is the TAKE flag, not "a macro is running"

`Script_AnyMacroActive` `0040d850` checks the table `0x7bf598[0x96]`. That table is written in only three places. `Script_ExecStep` `0041a330` clears the macro's entry at the start of its step (`if (0x7bf598[i] == 1) = 0`). `TAKE` (case `0x21`) sets it to 1. `Script_FindMacro` `0040d8b0` clears it when a macro starts. The condition "no active macro" on F1/F2/F3/F4 (the table in §1) therefore blocks the key for about one frame after `TAKE` (until that macro's next step), **not** whenever some macro is running. The engine used to read this as "any macro is running" (`Interpreter.anyActive`). In SC005B the woman-with-a-child loop is a running macro with no `UNLOCK`, so F1–F4 went silent while she walked. The fix is `PlayGame.takeFlag` (set by `TAKE`, cleared after the key step of that frame). The other key conditions (bullet menu, face, `MENU`, the bar, the message bar) are unchanged.
