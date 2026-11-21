# The right button: the bullet menu, the verb menu, and the weapon

How the original changes the cursor mode (the verb) with the right mouse button. Cursor modes and their pictures are in [cursor.md](cursor.md). The frame steps are in [game_loop.md](game_loop.md) (steps 12 and 13). The windows are in [gui.md](gui.md). The coat is in [inventory.md](inventory.md).

The right button opens the **bullet menu** (the option to show the bullet, `BulletOnOff` not 0, the default) or the **text window that chooses a verb** (`BulletOnOff` is 0). **There is no code that rotates the modes with the right button.** The proof is in §6.

## 1. When the right button opens a menu (`Game_Run` `0042dbe3`…`0042dc94`)

`g_mouseRight` `0x9d2824` (the window procedure: `WM_RBUTTONDOWN` `0x204` sets 2, `WM_RBUTTONUP` sets 0; DirectInput is 0 or not 0). Every frame (step 12):

1. If `g_mouseRight` is 0, `g_rightReleased` (`0x89829a`) becomes 1.
2. Otherwise, if **all** of these hold: the bullet menu is closed (`g_cursorZoneSuspended` `0x51f919` is 0), the mode is not 5 (no item in hand), the item bar is hidden (`0x6bc294` is 0, always, dead code), `g_rightReleased` is not 0, there is no talk face (`g_faceRight` `0x871a50` is −1 and `g_faceLeft` `0x87165c` is −1), `g_exitToDos` `0x8f6874` is 0, the scene has control (`g_sceneNoControl` `0x653170` is 0), and the cursor is enabled (`g_cursorEnabled` `0x7cde78` is not 0), then the menu follows `g_cfgBulletMenu` (`BulletOnOff`, `0x9fa960`, a 16-bit value).

**`g_rightReleased` never returns to 0.** The only references in the whole executable are the store of 1 (`0042dbec`) and the read (`0042dc2e`). The initial value is 0 (`.data`). The condition "the button was released" therefore works only until the first release after the program starts. After that the menu also opens while the right button is **held**, on every frame in which it is closed. Holding right and choosing an icon with left opens the bullet again on the next frame (the mode goes back to 0). The position is computed again from the current mouse (§2.2), so the bullet appears where the icon was clicked. Play confirms it. The engine reproduces it (the flag is set and never cleared).

With an item in hand (mode 5) the right button opens the **coat** (step 35, `g_coatRequest`, [inventory.md](inventory.md)). The menu does not open then. The middle button opens the coat always, but the coat requires a closed bullet (the check around the coat entry), so with the bullet open it does nothing.

## 2. The bullet menu (`BulletOnOff` is not 0)

### 2.1 Resources (the `Game_Run` prologue, `Cursor_LoadSet1` / `LoadSet2`)

Six sprites are created once at the start of `Game_Run` (`Sprite_Add(img, z, 16.0, 0, 0, 0x3f8, 0x1e0)`) and hidden at once with `Sprite_Set(id, 0, −200, …)`:

| Sprite | z | File with no weapon (`LoadSet1`) | File with the weapon (`LoadSet2`) | Size |
|---|---|---|---|---|
| the bullet `g_bulletSprite` `0x88f640`, picture `g_bulletImg` `0x69ece8` | 950 | `POCISK.BM` | `POCISK2.BM` | 181×182 |
| the lens highlight `0x528984`, `g_bulletIconLook` `0x8a7248` | 951 | `LUPA_1.BM` | `LUPA_2.BM` | 30×42 |
| the pointer highlight `0x652154`, `g_bulletIconPointer` `0x86ffe8` | 952 | `STRZA_1.BM` | `STRZA_2.BM` | 25×40 / 24×41 |
| the hand highlight `0x55b092`, `g_bulletIconTake` `0x8f5dd8` | 953 | `REKA_1.BM` | `REKA_2.BM` | 40×32 |
| the fist highlight `0x51fc5a`, `g_bulletIconHit` `0x7a6e60` | 954 | `PIESC_1.BM` | `PIESC_2.BM` | 37×32 |
| the weapon highlight `0x52a32e`, `g_bulletIconGun` `0x7a77b0` | 955 | — | `SPLUWA_2.BM` (always, `Game_Main`) | 47×32 |

The files are in `RESOURCE.PAK`, RGB565, and color 0 is transparent. `POCISK*.BM` is a diagonal brass cartridge with four icons (no weapon) or five (with the revolver). `LUPA`, `REKA`, and `PIESC` `_1` and `_2` are **identical byte for byte**. `STRZA_1` / `_2` and `POCISK` / `POCISK2` differ (in the armed version the revolver overlaps the arrow). `SPLUWA_1.BM` does not exist. The highlights are the same icons drawn brighter, shown only while the left button is held over the icon (§2.3).

### 2.2 Opening (`0042dc9a`…`0042ddb1`)

```
g_cursorZoneSuspended = 1
g_cursorMode = 0
Cursor_EnableDraw() // mode 0 → g_verbMode = 0, the point prefix, picture WSK, g_cursorEnabled = 1
g_cursorImage = 0x69c820 // WSK00
bx = g_mouseX − 0x66 ; by = g_mouseY − 0x61 // (−102, −97); world coordinates (g_mouseX includes the scroll)
if bx < scroll + 10: bx = scroll + 10
if bx > scroll + 0x276 − imgW: bx = scroll + 0x276 − imgW // 630 − 181
if by < 15: by = 15
if by > 0x1d6 − imgH: by = 0x1d6 − imgH // 470 − 182
Sprite_Set(g_bulletSprite, bx, by, g_bulletImg, 16.0)
```

`scroll` is `g_scrollX` `0x8f690c`. `bx` and `by` are stored in `g_popupX/Y` (`0x51f962` / `0x51fc58`, signed 16-bit, shared with the verb menu). There is no open animation and no sound. The bullet appears at once. The only motion is the cursor "zoom" on the change to mode 0 ([cursor.md](cursor.md)). When the position is not clamped, the click point (mouse − (9, 12)) falls in the picture at (93, 85), between the arrow and the revolver.

### 2.3 Icons, the highlight, and the choice (`0042defb`…`0042e763`, step 13)

The icon-position table `g_bulletIconPos` `0x503b88` (16-bit x and y relative to the bullet's top-left corner; constants in `.data`, nobody changes them) and the rectangle sizes (constants in the code):

| Icon | Mode / verb prefix | Position (x, y) | Rectangle w×h | Condition |
|---|---|---|---|---|
| the arrow (the pointer) | 0 `POKAZANIE` | (54, 70) | 22×38 | always |
| the lens | 1 `PATRZENIE` | (90, 111) | 20×26 | always |
| the hand | 4 `BRANIE` | (74, 49) | 42×34 | always |
| the fist | 2 `UDERZENIE` | (121, 90) | 32×32 | always |
| the revolver | 3 `STRZELANIE` | (71, 80) | 36×23 | `g_varValues[GUN]` is 1 |

A hit: `Click_InRect(l, t, r, b)` `004271f0` uses the **click point** `g_clickX/Y` (in mode 0 that is mouse − (9, 12)). The inequalities are **strict**: `l < x < r`, `t < y < b`, where `l = bx + ix`, `t = by + iy`, `r = l + w`, `b = t + h`. The arrow and revolver rectangles overlap (x 72–75, y 81–102). A press in that area shows both highlights, and on release the choice runs in the order below. **The last one wins** (the revolver, mode 3).

Every frame, while the bullet is open:

1. `blockLeft = 1` (a local). It blocks a left click in step 19 of **this** frame and the key of step 9 on the next. Releasing over an icon does not send Jack walking.
2. For each icon, `pressed[i] = g_mouseLeftDown && Click_InRect(rect_i)` (the revolver also requires `GUN` is 1).
3. In the order **lens, arrow, hand, fist, revolver**, when `pressed[i]` differs from `prev[i]`:
  - `pressed[i]` becomes 1 → `Sprite_Set` of the highlight at `bx + ix`, `by + iy` (exactly in the corner of the rectangle);
  - `pressed[i]` becomes 0 → hide the highlight: `Sprite_Set` at `bx + k_i`, −60 (k is 0x4b, 0x2d, 0x3e, 0x6c, off the top of the screen). For the revolver, `Sprite_Remove`. Then, if `Click_InRect(rect_i)` (the cursor is **still** over the icon, so the left button was released over it) → the **choice**: hide the bullet at (0, −200), `g_cursorZoneSuspended = 0`, `g_cursorMode = g_verbMode = the mode`, `Cursor_SetVerbName(mode)`, and `0x8979d0[0] = 0` (the exit name under the cursor);
  - `prev[i] = pressed[i]`.

So: **press left on an icon to highlight it; release on it to choose it; slide off it while held to cancel the highlight, and the menu stays.** A click beside the icons does nothing. Right, while the bullet is open, does nothing. `prev[]` are locals of `Game_Run` (cleared at the start of a scene). Closing the menu does not clear them.

While the bullet is open: the cursor in mode 0 does not pulse over a reaction (`Cursor_AnimateStep`, the mouse-motion branch); the exit modes (step 11) do not turn on; F4, M, F1 and the coat, and step 9 are blocked. The hit tests and the `<VERB> <name>` caption in the status bar keep working (`Cursor_DrawOnPresent` does not look at the flag).

### 2.4 Closing with no choice: `BulletMenu_Close` `00419f50`

It hides all 6 sprites (`Sprite_Set(id, 0, −200, g_bulletImg)`; the highlights receive the bullet's picture in the process) and clears `g_cursorZoneSuspended`. The mode stays 0 (set on opening). Callers:

| From | When |
|---|---|
| `Game_Run` `0042dbde` (step 12) | **Esc** (`Input_KeyPressedOnce(1)`) |
| `Game_Run` `00430271` (step 21) | a macro blocks the player (`g_macroPlayerLocked`) and the cursor is turned off |
| `0042aef0` / `0042afb0` | a left click at the left or right edge of a scrolled scene (cursor 0x14 / 0x15, [play.md](play.md)). With the bullet open the edge cursor appears too |
| `Script_ExecStep` | `RUNFILM` (0x09), `TAKE` (0x22), `RUNFILMP` (0x23) |

With the bullet open, leaving the scroll edge sets the mode to **0** instead of the saved mode (`g_cursorModeSaved`).

**A quirk of `prev[]`.** Esc while left is held over an icon leaves `prev[i] = 1`. After opening again (left released) the first frame takes the "release" branch and, if the click point is over that icon, chooses it at once. It is rare. The engine can reproduce it by keeping `prev[]` outside the menu.

## 3. The verb menu (`BulletOnOff` is 0)

### 3.1 The call (`0042ddb6`…`0042def2`)

```
g_cursorMode = 0
W = 0x503b7c // a 32-bit value in .data, 145; overwritten: 'E' → 145, 'D' → 240 ('P' stays 145)
x = g_mouseX − 7 − W/2 − scroll ; y = g_mouseY − 0x3f
x clamped: x < 10 → 10; x > 630 − W → 630 − W
y clamped: y < 15 → 15; y > 470 − H → 470 − H
H = GUN == 1 ? 0x503b84 (185) : 0x503b80 (158)
Snd_TogglePauseFx(); Cursor_VerbMenu(x, y); Snd_TogglePauseFx()
```

`W` and `H` match what the window computes (`H = n·27 + 50`, exactly). The window is placed so that the click point (mouse − (9, 12)) falls on the **first button**. The center of the window in x is mouse − 7.

### 3.2 `Cursor_VerbMenu(x, y)` `00416780`

It saves and clears `0x870cf8` and `g_noControlDir`, and sets `0x8f68d8 = 1` (the cursor keeps animating in `Cursor_DrawOnPresent` inside the window too). It builds `g_verbMenuList` `0x722e18` as four items (pointer, take, strike, examine) plus a fifth, the revolver, when `g_varValues[GUN]` is 1. It calls `Gui_ChoiceWindow(x, y, list, 0, g_verbMenuTitle)` `004655c0` and `Gui_RunChoiceWindow` `00465a80`, closes the window (`Gui_CloseWindow`), and compares the result (`strcmp`) with the captions.

The five items map to modes 0, 4, 2, 1, and 3, in that order. The fifth is present only with the weapon. `Game_Main` (`0044ed0a` and on) sets the captions for the build's language. Polish letters are stored as Mazovia bytes. The fifth item in the Polish build is the word Colt, not a word for "weapon". An early listing's comment that said otherwise is wrong. Then `g_verbMode = g_cursorMode`, `Cursor_SetVerbName`, and the flags are restored. No match (Esc) leaves the mode at **0** (set before the call). The title is a letter-spaced caption. The `/3` prefix is a letter spacing of 3 px ([fnt.md](../formats/fnt.md), `0046e6b0`).

### 3.3 The window `Gui_ChoiceWindow(x, y, "A|B|…", center, title)` `004655c0`

A general choice window from a list split on `|`. The only caller is `Cursor_VerbMenu`. The GUI is [gui.md](gui.md):

- the longest item **by character count** (the first one on a tie). `tw = Text_PrintfWidth(font 1, …)`. The width is `Wo = tw + 80`, rounded up to even. The height is `Ho = n·27 + 50`;
- `Gui_CreateWindow(x, y, Wo, Ho, 0)` (`center` other than 0 would center on the screen; here it is 0);
- the title: `Gui_AddLabel(window, center = 1, 20, 13, 6, 0xffe0, font 1, title)`. Font 1 is the small JACKM font;
- buttons `i = 0…n−1`: `Gui_AddButton` at `x = Gui_CenterOffset(Wo, Wo − 40) − 1 = 19`, `y = 38 + 27·i`, `w = Wo − 40`, `h = 24`, centered, font 1, the item's text, and the name `"Btn A"`, `"Btn B"`, and so on.

`Gui_RunChoiceWindow` `00465a80`: `Gui_RunWindow` (a modal loop, [gui.md](gui.md): a click is press and release over the button, Enter is button number 1, the first one added, which is the pointer). Play confirms that Enter chooses the pointer. If the result is not `"Exit"` and `g_guiKeepGoing` is not 0, it returns the **text** of the button with that name. Otherwise (Esc → `"/0"`, `g_guiKeepGoing = 0`) it returns `""`. It always sets `g_guiKeepGoing = 1`.

## 4. The revolver: the variable `GUN`

- `g_varIdxGun` `0x5046ec` is the index of the variable `GUN` in the variable table (found while loading the variable file, `Var_LoadAll` `0044a600`: `strcmp` of the name with `"GUN"`). The value is `g_varValues[GUN]` (`0x8a27d8`).
- `Cursor_LoadSet1` `00408990` waits until `0x8f6890` is ≤ 0, loads set `_1` plus `POCISK.BM`, and sets **`GUN = 0`**. `Cursor_LoadSet2` `00408a40` loads set `_2` plus `POCISK2.BM` and sets **`GUN = 1`**. The icon set and the variable always move together.
- Callers: the script `HAVEGUN` → set 2, `NOHAVEGUN` → set 1 and mode 3 becomes 0 (`0041eaf7`, [scripts.md](scripts.md)). Loading a game (`00409090`) and `Game_Main` follow `Var_Get("GUN")`. A new game (`Menu_InGameOptions`, and the dead slot window `004098f0`) uses set 1, and in the easy version then set 2 plus `GUN = 1`. The start of `Game_Run` in the easy version (`g_easyVersion` `0x5348ac`, `0042bb69`) uses set 2 plus `Var_Set("GUN", 1)`. After the end movie (`Game_Run`, before `g_optionsRequest = 1`) it uses set 1, `Inventory_Clear`, and `Cursor_ResetMode`.
- With no weapon (`GUN` is not 1): the bullet is `POCISK.BM` with no revolver and no rectangle for it. The verb menu has 4 items and `H` is 158. With the weapon: the revolver is on the bullet, there is a fifth item, and `H` is 185.
- Mode 3 with no weapon can be reached only by the script command `CURSORAS` (unused in the data, [cursor.md](cursor.md)).
- **Digit keys choose nothing.** `Game_Run` `0042b6d0` reads only the keys in [keys.md](keys.md). `Gui_RunWindow` `00462620` reads Enter, Esc, and the window shortcuts (`Gui_SetHotkeys` `0045e1c0` is called only by `Gui_MessageBox` `004649f0`, with Esc). `Gui_ChoiceWindow` `004655c0` sets no shortcut, and neither does `Cursor_VerbMenu` `00416780`. The choice window's items are chosen with the mouse or with Enter (the first one is the pointer), not with a number, regardless of `GUN` and of an item in hand. The bullet menu reads no keyboard except Esc. A helper that sets a verb from outside the game (`packages/engine/src/bulletmenu/debugverb.ts`, `PlayGame.setDebugVerb` / `debugVerbAllowed`) accepts only modes from `verbMenuModes(GUN)`. The revolver only when `GUN` is 1, and nothing with an item in hand or while a menu is open.

The easy version does not change the menus themselves. It only gives the weapon from the start (`GUN` is 1, set `_2`). See [easy.md](easy.md).

## 5. An item in hand

Mode 5: right opens the coat (§1). Opening the bullet or the verb menu always sets mode 0 first (`Cursor_EnableDraw`, or a direct store), so a menu never starts with an item in hand. An item is not lost through the bullet. The bullet cannot be reached from mode 5.

## 6. Rotating the cursor with the right button: it is not in the executable

Every reference to `g_cursorMode` `0x8f68f6` as a memory operand was read. Completeness: all **127** occurrences of the bytes `f6 68 8f 00` in `.text` lie in disassembled instructions that refer to `0x8f68f6`. In `.data` and `.rdata` there is no pointer to `g_cursorMode` or `g_verbMode` (no indirect store). **57 stores**, all `mov` (no `inc`, `dec`, or `add`, and no wrapping arithmetic):

| Where | Addresses | Value |
|---|---|---|
| `Cursor_VerbMenu` | `004168cc`, `eb`, `90a`, `929`, `948` | 0, 4, 2, 1, 3 (the choice from the list) |
| `Cursor_ResetMode`, `Cursor_EnableDraw` | `00419757`, `00429af4` | 0 |
| `Script_ExecStep` | `0041d3b3` (`TAKE`), `0041eb12` (`NOHAVEGUN`: 3, and `g_verbMode = 0`), `0041ebbe` (`NOHAVETOOL`), `0041f016` (`CURSORAS`) | 5, 0, 0, 3 |
| the `Game_Run` prologue / SC000D | `0042b9eb`, `0042bdd0`, `0042c919` | 0 |
| step 9 (the F-key windows) | `0042d74c`, `0042d896`, `0042d989` | 0 (then restored from a local copy at `0042d7c1`) |
| step 11 (exits) | `0042dadb`…`0042db8b`, `0042dba7` | 10, 11, 13, 14, 15, 17, or `g_verbMode` |
| steps 12–13 (the menu) | `0042dca1`, `0042ddb6`, `0042e265`, `0042e3a4`, `0042e4e3`, `0042e622`, `0042e747` | 0, 0, 1, 0, 4, 2, 3 |
| steps 14–15 (the dead bar) | `0042e7b1`, `0042e9d7`, `0042eaed`, `0042eb6c`, `0042ec75`, `0042ec86`, `0042ed83`, `0042edb4`, `0042ee74`, `0042f239`, `0042f396` | 0, 4, 5, or `g_verbMode` |
| step 18 (the edge) | `0042fbed`, `0042fc2c`, `0042fc84`, `0042fc95`, `0042fd2c`, `0042fd3d` | 0x14, 0x15, 0, or `g_cursorModeSaved` |
| steps 32 and 35 (a load, the coat) | `0043805a`, `00439176`, `00439565`, `00439570`, `004396e7`, `00439837`, `0043992a`, `0043b229`, `0043b25b` | 0, 4, or 5, and a restore of the copy |

Stores from a register come only from `g_verbMode` `0x8f68ea`, `g_cursorModeSaved` `0x8f68ec`, or local copies (`[ebp−0x1cc]`, `[ebp−0x224]`), and those in turn only from constants or from `g_cursorMode` (a store and a read around the windows). Nowhere is it `mode + 1`. `g_mouseRight` is read only by step 12 (the menu), `Script_ExecStep` (`ANYKEY`, waiting for a click), step 8 (the idle counter), the dead bar (faster scrolling), and the coat (open, close, faster scrolling). None of them changes the mode. The mask `0x9d2828` (bit 2 is the right button) is read only by the input handling (`WndProc`, DirectInput, `Game_Tick14ms`). The registry has no option for this. The only cursor option in `g_config` is `BulletOnOff` ([gui.md](gui.md)).

There is no rotation from walk to fist to lens to shoot, neither in the live code nor in the dead code of the Director's Cut, and no uncalled function that would do it.

## 7. What the engine reproduces

1. State: `bulletOpen`, `rightReleased` (only ever set), `prev[5]` (it persists), `popupX` and `popupY`.
2. A frame: Esc and `bulletOpen` closes it (§2.4). Then §1 (the right button) leads to §2.2 or §3. Then §2.3 and `blockLeft`.
3. The order in a frame: step 11 (the exit cursors) is **before** step 12. Step 19 (the left click) is **after** 13.
4. Pictures: set `_1` or `_2` according to `GUN`. The revolver highlight is always `SPLUWA_2`.
5. The verb menu: a modal GUI window (`Gui_ChoiceWindow`). Effect sounds are suspended for the duration of the window.
6. The click hotspot is the click point of mode 0 (`Cursor.clickPoint()`), not the raw mouse.

## 8. Open

- `Wo` (the width from the font) against the constant `W` (145 / 240). Whether they match for each language was not checked (it needs the width of font 1). A mismatch would only move the clamp.
- The draw order of z 950…955. A larger z is assumed to be higher (the highlight above the bullet). That matches the look.
