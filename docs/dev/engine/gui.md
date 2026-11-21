# Windows, the in-game menu, and settings

Code: `packages/engine/src/gui/` (`darken.ts` is the darkening tables, `draw.ts` is the frame and the text, `window.ts` is `GuiWindow`, `credits.ts` is the about scroller, `menu.ts` is `GuiMenu`, `texts.ts` is the caption set, `assets.ts` loads the fonts and the pictures). The module has no DOM. A window is a snapshot of the scene, darkened, with a frame. The scene stands still while a menu is open (`g_logicFrozen`).

The string table is filled from the build's language. The engine uses the Polish set and keeps an English fallback. This note names the controls by their identifiers. A caption is an effect of that identifier, not a line to copy. `=` in a caption is an empty glyph of 3×1, so a mark before punctuation is a gap. See [fnt.md](../formats/fnt.md).

## 1. A window and its controls

`Gui_CreateWindow` `0045e2f0` and the control list live in ten slots of `0x14e0` bytes from `0x9d3638`. A control has a type: 0 a button, 1 a text field, 2 a slider, 3 a yes/no toggle, 4 a hit that returns on the press. The name is compared as a prefix (`Gui_NameIs`). In the menus the names are not prefixes of each other, so a full-string compare is the same. The engine compares the whole name.

`Gui_RunWindow` `00462620` blocks and returns a pointer to the **name** of the control that was pressed (`+0x4f`), or:

- `"KEY "` when `Input_GetLastKey()` matches one of the window's `hotkeys[0..9]`;
- `"/0"` (`004fd28c`), and `DAT_009e3350` becomes 0, when **Esc** is down (`Input_IsKeyDown(1)`) or the pump reported the end of the program.

At the start `DAT_009e3350` is 1. The window sprite and the button sprites are moved onto their positions, which shows them. The flag `DAT_009e33fa` set to 1 holds the about-screen credits still during that move. Then the loop. **Every turn** yields to the pump (`DAT_009e335c`), which draws a frame and reads the mouse and the keyboard.

The mouse: `DAT_009d2820` is the left button down. `Gui_ButtonUnderMouse` finds a control whose sprite (`+0x02`) is in the list of sprites under the cursor (`0xa00dc8`, the count `0xa31bd8`) and whose `mouseX` and `mouseY` are at least the window origin plus the control origin. **A hit is the sprite under the cursor, not the rectangle alone.** A slider hits only the 14×29 knob, not the track.

- **A button (0):** a press over the button draws the pressed state and waits while the mouse is down and the cursor is over that button. **A release over it returns the name.** Leaving the button draws the normal state and returns to the loop (a cancel).
- **Enter** (`0x0d`) is treated as a press of **button number 1** (in the main menu that is resume, in the about screen it is the ok button, in the yes/no window it is yes, `BtOk`). The button stays drawn pressed until Enter is released, then the name is returned.
- **Esc:** the result is `"/0"`, and `DAT_009e3350` becomes 0.
- **A toggle (3):** a press immediately draws the **opposite** state (`state` becomes 0), then waits for a release over it. The result is the name. The value is `Gui_GetValue` (the new state, 0 or 1).
- **A slider (2):** section 6.
- **Type 4:** returns the name on the press itself, inside the rectangle.

There is no wheel, no arrows, and no Tab. The keyboard is Enter and Esc, plus the window's hotkeys. The verb-choice window (`Gui_ChoiceWindow` `004655c0`) sets no hotkeys, so the digits do nothing there. See [bulletmenu.md](bulletmenu.md).

## 2. Drawing: a "translucent" window is a darkened snapshot

**Everything that looks translucent is a table darkening, not an alpha blend.**

`Blit_Darken16` (`0046e370`) maps an RGB565 pixel `p` at level `L` (0..32) through tables in `.data` (`0x504ae8 + L*0x80` is blue, `+0x1080` is green, `+0x2100` is red). The values are about **`channel · (32 − L) / 32`**, exactly `floor(v·(32−L)/32 + 0.49)`, with one exception: the **blue table has a minimum of 1** (never 0), so the result does not become color 0, the sprite color key. Checked on the whole table: about 4200 entries, a difference of 1 LSB in 14 places (all `L` at least 17, channel values near the maximum). Relative brightness `(32−L)/32`: L of 0 is 100%, 3 is 91%, 6 is 81%, 10 is 69%, 13 is 59%, 16 is 50%, 22 is 31%.

`Gui_CreateWindow(x, y, w, h, center)` `0045e2f0`:

1. An odd `w` becomes `w+1`. When `center` is not 0, `x` is `Gui_CenterOffset(640, w)` and `y` is `Gui_CenterOffset(480, h)`. A size at least the screen becomes 0. `g_scrollX` is added to `x` and `g_scrollY` to `y` (0 in the game). The window lies in the **1024×480 buffer**, so when `scrollX` is not 0 the window moves with the screen. Pass the 640×480 view, not the wide buffer.
2. It stores the slot (`id`, `x, y, w, h`, `z = n*50 + 1000`) and `nButtons` is 0.
3. **The background snapshot:** `Render_ComposeRegion(x, y, w, h, maxZ = 1000, …)`. The scene plus sprites with `z` at most 1000. Window 2 **does not see** window 1 (`z` of 1050 is above 1000). Its background is the scene alone, and it covers window 1 opaquely.
4. **The frame and the inside,** `Gui_DrawWindowFrame(w, h, 4, …)` `004662e0`. For `c` from 0 to 4, five rings (5 px thick): the top and left lines are level **10** (bright, 69%), the bottom and right are level **22** (dark, 31%), two corner pixels (top-right, bottom-left) are level 16, and **the inside `(5, 5, w−10, h−10)` is level 16 (50%)**. The result is a half-darkened snapshot with a raised frame of 5 px.
5. `Sprite_AddRaw` of the buffer (kind `0x12`). The window is an ordinary sprite above the scene. Around it the scene keeps drawing.

The alternate branch (`g_renderBg` differs from `DAT_00b2bd78`) adds 4×4, takes a buffer from `operator_new`, and builds a simpler frame. In the game both pointers are equal (`Scene_Load` `0044ba80` sets both. The coat screen replaces both at once). The launcher does not split them either. The main menu takes the **ordinary** branch. See [mainmenu.md](mainmenu.md). Who uses the alternate branch was not settled. When `DAT_009fc088` is not 0 the buffer also comes from `new`.

A button (`Gui_DrawButton` `0045d4d0`) first **composes the scene again** in the button's rectangle (a snapshot **without** the window's darkening), then the frame.

| State | Function | Rings | Top and left | Bottom and right | Corners | Inside |
|---|---|---|---|---|---|---|
| normal (0) | `00465bc0`, thickness 4 | 4 | L = 0 (100%) | L = 13 (59%) | L = 6 | `(4, 4, w−8, h−8)` L = 6 (81%) |
| pressed (1) | `00465f50`, thickness 2 | 2 | L = 3 (91%) | L = 13 (59%) | L = 6 | `(2, 2, w−4, h−4)` L = 10 (69%) |

Buttons are therefore **brighter** than the window (the window is 50%), and a pressed button is darker, with a thinner frame. A toggle: state 0 (no) is the normal frame, state 1 (yes) is the pressed frame.

Text (`Text_PrintfAt`) uses the bitmap font. Pixel 1 is the outline. Any other non-zero pixel is the fill. `/N` in the text is a gap of N px (1 px by default). The default colors in `.data` (a function at `00466970` could replace them, and **nothing calls it**):

| Variable | Value | Role |
|---|---|---|
| `0x504aac` / `0x504aae` | `0x001F` (blue) / `0xFFFF` (white) | a button and a label: outline / fill |
| `0x504ab0` / `0x504ab2` | `0x001F` / `0xFFFF` | a pressed button (the same) |
| `0x504ab6` / `0x504aba` | `0xFFFF` / `0xFFE0` | the about screen: fill of style 2 and of `!` (white), and of style `1` (yellow) |
| the title, in the code | outline `1`, fill `0xFFE0` | the window title |

The shadow is always `Text_PrintfAtRemap(x+1, y+1, 10, 6, …)`: outline pixels darken the background at level 10, fill pixels at level 6, then the text itself is drawn at `(x, y)`.

`Gui_AddLabel` draws the scene, then a darkening at level 16, then the shadow, then the text. The field is 22 px tall (14 when the font is not 0). A centered label sets `x` from the text width.

A caption on a button (type 0 or 3): `x` is centered when `centered` is 1, otherwise 8. `y` is the vertical center of 24 or 16, plus 1. Normal: the shadow and the text at `(x, y)`. **Pressed: no shadow, and the text at `(x+1, y+1)`.**

## 3. The string table

`Game_Main` `0044d1d0` fills the table at `0x8a8ae0`, a stride of `0x50`, from `g_language` (`'P'` in the Polish build, `'D'` or anything else for German and English). The indices the menus use:

| Index | Role |
|---|---|
| 0 | the menu title |
| 1, 2 | load, save |
| 3, 4 | game options, audio options |
| 5, 6 | quit playing, resume |
| 7, 8 | the slot-window titles. See [savegame.md](savegame.md) |
| 9–18 | the ten slot descriptions, empty until a file is read |
| 19 | cancel |
| 20–23 | the game-options title, walk speed, talk interruption, dialogue text |
| 24, 25 | yes, no |
| 26 | the main-menu label used as a button back to the menu |
| 27–30 | the audio title, and the three volumes |
| 31–33 | the quit question, and the yes and no answers with padding spaces |
| 34, 35 | about, ok |
| 36 | a new game |
| 37 | show the bullet |
| 38, 45 | reverse stereo, pseudo surround |
| 39–43 | file errors: a failed open, a failed write, a failed read, retry, and quit |
| 44 | duck the music during dialogue |

A `\|` in a message box is a line break. The German and English strings exist in the code. The Polish build is the one this engine follows.

## 4. The in-game menu, `Menu_InGameOptions` `0040b580`

`Game_Run` opens it on **F4** (`Input_IsKeyDown(0x3e)`) with no Ctrl (`0x1d`), **or** on `g_optionsRequest` (the coat's options button, and after the exit films). The conditions: the cursor zone is not suspended, there is no conversation (both faces are −1), control is on (`g_varValues[DAT_007cde80]` is not 0), no macro is active, the item bar is hidden, and `g_noticeShown` is clear. Before the menu the item in the hand is put away, `g_cursorMode` becomes 0, `Snd_TogglePauseFx` **pauses the effects** (on return, `Snd_TogglePauseFx2`), and **`g_logicFrozen` and `g_renderIdle` are 1**. The scene stands still. The whole action happens in the window loops. Each iteration is a frame through the pump. The cursor is the animated arrow (`Cursor_DrawOnPresent`, `DAT_007c7a4c` is 1). See [cursor.md](cursor.md). Beside the menu: **F2** saves (`Menu_Save` `0040b330`), **F3** loads (`Menu_Load` `0040b430`), **F10** asks before quitting (`Menu_ConfirmQuit`). F5 and F6 are the quick save and the quick load. See [savegame.md](savegame.md) and [keys.md](keys.md).

The window is centered, `Gui_CreateWindow(0, 0, 0x1b8, 0x17c, 1)`: **440 × 380**, the top-left at **(100, 50)** plus the scroll. The title is a centered label at `y` 14, colors 1 and `0xFFE0`, font 0, index 0. The buttons are 370 × 33, `x` is 34, centered, font 0.

| Order | y | Identifier | Role |
|---|---|---|---|
| 1 | 325 (`0x145`) | `Resume` | back to the game. This is button 1, so Enter is resume |
| 2 | 55 (`0x37`) | `NewGame` | a new game |
| 3 | 92 (`0x5c`) | `Load` | load |
| 4 | 129 | `Save` | save |
| 5 | 166 | `GameCtrl` | game options |
| 6 | 203 | `AudioCtrl` | audio options |
| 7 | 240 | `About` | about |
| 8 | 277 | `Quit` | quit |

The pitch is 37 (`0x25`). The gap down to resume is 48 px.

The loop is `do … while (DAT_009e3350 && !g_gameLoaded && !g_newGameRequest && !DAT_0079dee8)`. `Gui_RunWindow` returns a name:

| Name | Action |
|---|---|
| `Load` | `Menu_Load` `0040b430`. `DAT_009e3350` is set back to 1. After a load, `g_gameLoaded` ends the menu. The original load from this menu used to open the dead slot window. The engine opens the file dialog, or the slot window in the legacy mode. See [savegame.md](savegame.md) |
| `Save` | `Menu_Save` `0040b330`. The menu stays open |
| `GameCtrl` | `Menu_GameOptions`, then `Gui_CloseWindow(2)`, and `DAT_009e3350` is 1 |
| `AudioCtrl` | `Menu_AudioOptions`, the same |
| `About` | `Gui_ShowAbout` (section 8) |
| `NewGame` | `g_newGameRequest` is 1, `Cursor_LoadSet1`, the inventory is cleared (`00408c30`, which is the bar rebuild plus 0x54 bytes cleared from `0x51fa08`), `Var_LoadAll`, and if `g_jackUniform` the civilian walk frames are loaded. The loop ends |
| `Quit` | `Menu_ConfirmQuit` (section 9). Yes ends the process |
| `Resume`, Esc, or Enter | leave the loop |

After the loop, if `g_newGameRequest` and `g_easyVersion` (the registry value `EasyVer`): `Cursor_LoadSet2` and `Var_Set("GUN", 1)`. The easy version starts with the gun. See [easy.md](easy.md). `Game_Run` on `g_newGameRequest` loads the scene from `g_sceneName` (`SC001`). At the end it closes window 1 and `Timer_Sleep(10)`.

**Esc** in the main menu is resume. **Esc in a sub-window** (the options) closes the sub-window and returns to the main menu (`9e3350` is restored to 1). **Esc in the about screen closes the sub-window and the whole menu** (`9e3350` stays 0). That is what the code does, and it matches play: Esc in the about screen returns straight to the game.

The `Resume` branch that reads `DAT_0055b27a` (a new game after resume) is **dead**. The flag is never set.

Buttons and menus play no sounds. The only sounds are the volume-slider previews (section 6).

## 5. Sliders and toggles

`Gui_AddSlider(window, x, y, max, value, name)` `0045fcc0`:

- The track is `RAMA.BM` (230 × 13), pasted into the window buffer at `(x, y)`. The scene under it is darkened at level 16. The minus and the plus are pixels of the bitmap.
- The knob is `SUWAK.BM` (14 × 29), its own sprite, at **`(x + 0x17 + value·170 / max)`**, `y − 8` (integer division). The position range is `[x+23, x+23+170]`. The travel is 170 px. The step is `170/max` px. Values are integers `0..max`.
- **Dragging** (type 2): a press **on the knob**. Then a **relative** move. Each turn, `dx` is `mouseX` minus the previous x. If `min ≤ x + dx ≤ max + 1`, then `x += dx` and **`value = ftol((x − min) / 170.0 · max)`** (truncation toward zero). The knob sprite moves. The previous x becomes `mouseX` always, so at the end the knob stands still but keeps counting from the new mouse position. The drag lasts while the left button is down **and** the mouse is inside the rectangle of the track plus the knob. Leaving that rectangle ends the drag, the same as a release. **A click on the track does nothing.** The name is returned when the drag ends.
- **A departure, on purpose.** `GuiWindow` (`packages/engine/src/gui/window.ts`) grabs the slider on the **whole track** of `RAMA.BM` (230 px from `x`) and 6 px above and below the knob band (`GRAB_MARGIN_Y`). A press off the sprite sets the knob's center under the mouse (the original does nothing). A press on the sprite keeps the grab point. The drag is **absolute** (the position is the mouse minus the grab point, clamped to `[x+23, x+23+170]`, so the value is `0..max`. The original allows `max+1`, and the value is still max) and lasts **until the button is released**, wherever the mouse is. The live effects are unchanged.
- Live effects, while dragging, by the slider's name:
  - `MusicVol`: `Sound_SetChannelVolume(5, value)` (times 2 inside, so the channel level is `2·value`), unless the music is muted (`DAT_008f6894` is 0).
  - `SFXVol`: the sample **`SFX.S16`** on **channels 1 and 2** at that volume, if neither channel is playing. If they are playing, only `Sound_SetChannelVolume`.
  - `TalkVol`: the same with **`TALK.S16`**, channels 1 and 2. Both samples are loaded in `Game_Main`. Playback repeats on each change once the previous sample has finished.

`musicVolumeEffect(value, playing, muted)` is the pure form of the music rule: below 5 it stops, above 5 it resumes.

A yes/no toggle, `Gui_AddToggle` `0045f4b0`, is 52 × 28, centered, font 0. State 0 is no, state 1 is yes (indices 25 and 24). The initial state is the value from the configuration. A click toggles and **immediately** draws the new state (raised for no, pressed for yes).

Options windows end with `Reg_SaveConfig(g_config, 0x26)`. **The registry is written only on leaving the window** (the button back to the menu, or Esc), not on every change. In practice that write fails on a normal account. See section 7 and settings need an administrator.

## 6. Game options and audio options

Both windows are centered. The title is a centered label at `y` 16, yellow, plus labels at `x` 15. The loop is `Gui_RunWindow`. After each name, `Gui_GetValue` goes into the configuration, and `DAT_009e3350` is 1. The exit is the `MainMenu` button, or `9e3350` not equal to 1 (Esc, or the program closing). The registry is written at the end. The button back to the menu is 160 × 32, centered.

Game options, `Menu_GameOptions` `00409c60`. The window is 500 × 306 (`0x1f4 × 0x132`), at (70, 87).

| Control | y of the label | Widget | Name | Field of `g_config` | Range, default |
|---|---|---|---|---|---|
| walk speed | 68 (`0x44`) | slider `(253, 75)`, max **6** | `WalkSpeed` | `g_cfgWalkSpeed` `9fa95e` (+6) | 0..6, default 1 |
| interrupt speech | 112 (`0x70`) | toggle `(253, 110)` | `TalkOnOff` | `9fa95a` (+2) | 1. The name is misleading. It does **not** turn speech off |
| show dialogue text | 156 (`0x9c`) | toggle `(253, 154)` | `DialogOnOff` | `g_dialogTextOn` `9fa95c` (+4) | 1 |
| show the bullet | 200 | toggle `(253, 198)` | `BulletOnOff` | `g_cfgBulletMenu` `9fa960` (+8) | 1 |
| back | | button `(170, 252)` | `MainMenu` | | |

Audio options, `Menu_AudioOptions` `0040a0b0`. The window is 520 × 380 (`0x208 × 0x17c`), at (60, 50).

| Control | Label y | Widget | Name | Field | Range, default |
|---|---|---|---|---|---|
| music volume | 68 | slider `(273, 75)`, max **64** | `MusicVol` | `9fa962` (+0x0a) | 0..64, `0x23` is 35 |
| effect volume | 112 | slider `(273, 119)` | `SFXVol` | `g_optSfxVol` `9fa964` (+0x0c) | `0x20` is 32 |
| speech volume | 156 | slider `(273, 163)` | `TalkVol` | `g_optTalkVol` `9fa966` (+0x0e) | `0x40` is 64 |
| reverse stereo | 200 | toggle `(370, 198)` | `RevStereoOnOff` | `g_optRevStereo` `9fa968` (+0x10) | 0 |
| pseudo surround | 244 (`0xf4`) | toggle `(370, 242)` | `SurroundOnOff` | `9fa96c` (+0x14) | 1 |
| duck music during dialogue | 288 (`0x120`) | toggle `(370, 288)` | `MusDownOnOff` | `9fa96e` (+0x16) | 1 |
| back | | button `(180, 330)` | `MainMenu` | | |

What a change does:

- `MusicVol`: the current music volume (`DAT_007a8bf4`) becomes the value. **A value below 5 while music is playing** calls `Music_Stop(0)` and sets `DAT_008f6894` to 1 (muted). **A value above 5 while that flag is set, and sound exists,** restarts the track: the marker `004f7194` means `TR02-22.PMS` (`Music_Start(…, 0, 1)`), otherwise the current track (`Music_BuildPath`, `Music_Start(…, 0, 0)`). See [music.md](music.md).
- `SFXVol` and `TalkVol` only store the field. It applies to the next sounds. See [sfx.md](sfx.md).
- `RevStereoOnOff` stores the new state **and** `00471fb0` does `DAT_00a00ac4 ^= 2`. The effect-channel map (`Sound_MapChannel` `00402e60`, 1 with 2, 3 with 4, 5 with 6) reads the field itself.
- `SurroundOnOff` stores the new state, and `DAT_00a00ac0` becomes that state.
- `MusDownOnOff` only stores the field. `Music_DuckDown` and `Music_DuckUp` (`00402fb0`, `004030a0`) lower the music during a line. See [dialog.md](dialog.md).

### Stereo swap and pseudo surround

Both settings act in one function, `00471430` (`Snd_CopyStereo`), called by `00471530` (the write into the DirectSound buffer, from the stream tick, the stream fill, and the buffer play) for every channel whose flag has `& 2` (stereo, `flags & 3` is the channel count). It copies 16-bit stereo samples `(L, R)`:

| `surround` (`a00ac0`, 0 or 1) plus `swap` (`a00ac4`, 0 or 2) | The sample |
|---|---|
| 0 | unchanged |
| 1 (surround only) | **`L' = −L`, `R' = R`**. The left channel is phase-inverted |
| 2 (swap only) | `L' = R`, `R' = L` |
| 3 (both) | `L' = R`, `R' = −L` |

(`−L` on an `int16`: negating `−32768` wraps. Web Audio does not have that problem.) **Pseudo surround is a phase inversion of the left channel** of the music, and of every other stereo stream. A stereo movie is a hypothesis, because the movie step uses its own buffer. Summed to mono, whatever sits in the center cancels. In the engine: `packages/engine/src/settings/stereo.ts`, `stereoMatrix(surround, reverse)`, and a graph of a splitter, four gains, and a merger, placed in front of the music output. Effects and speech are mono (the flag `& 2` is 0), so **they are not touched**. Their "stereo swap" is only the mapping of logical channels onto physical ones.

**The flags start uninitialized.** `DAT_00a00ac0` and `DAT_00a00ac4` (`.bss`, zero) are written **only** by the audio-options window (`0040a40d`, `00471fc1`). No other instruction writes them. So **after the game starts, the registry settings (surround defaults to on) do not affect the music** until the player toggles the option in that session. And `RevStereo` flips with a XOR, independent of the saved state: if the registry says on and the effect flag is 0, the first click from on to off *turns the swap on*, which is the opposite of the label. The engine applies both from the start. That is a departure.

## 7. Persistence

`g_config` (`0x9fa958`, 0x26 bytes) is loaded by `Reg_LoadConfig` `00469a30` and defaulted by `00469b70`. The map of the fields is the tables above, plus `+0x12` (play the intro on the first launch, cleared after it plays) and `+0`. `WinMain` overwrites `+0` with the "no sound" flag when `Sound_Init` fails. See [architecture.md](architecture.md).

The original writes the block to `HKLM\Software\TopWare Poland\Jack Orlando`, value `Config`, with `KEY_ALL_ACCESS`. On a normal account that fails silently, so the options do not survive a restart. The engine remembers them (`packages/engine/src/settings/store.ts`, `localStorage`, the key `jack-orlando.config`, written on leaving an options window, as the original intended). With no `localStorage` it runs on the defaults.

## 8. About, `Gui_ShowAbout` `0040af60`

A centered window of **460 × 340** (`0x1cc × 0x154`), at (90, 70). `DAT_007c7d08` and `DAT_008f6898` are 1, so the cursor stays visible (`Cursor_DrawOnPresent`). Pictures from `RESOURCE.PAK`: `JACBM.BM` (396 × 98) at `(32, 16)`, and `COPBM.BM` (340 × 27) at `(86, 94)` (`0045ee60`, color key 0). The button `AboutOk` is at `x` 180, `y` 290, 100 × 32.

The credits are a buffer `DAT_008ab5e4` of 400 × 160 (a header `u16 400, 160`), a sprite at `z` `0x79e`, on screen at **(120, 194)** (`g_scrollX + 0x78`), filled from `TEKST.COD` (`Text_Decrypt`, **280 lines**). The line format is in [text.md](../formats/text.md): a kind `=` is a 13 px line in the large font, `#` is 9 px in the small font, style `1` is yellow `0xFFE0`, anything else is white `0xFFFF`, and `!` is the white style plus a pause. The engine scrolls them with `CreditsScroller`. The wording of the credits is not copied here.

Esc here closes the about window **and the whole menu** (section 4).

## 9. Quit, `Menu_ConfirmQuit` `0040b510`

`Gui_MessageBox` `004649f0` asks, from string 31, with yes and no (strings 32 and 33, `BtOk` and the cancel). Yes ends the process. No, and Esc, return to the menu. Enter is button 1, which is yes. The cursor used for the confirm is the verb cursor, which is a quirk of the original.

## The host

```ts
const menu = new GuiMenu({ assets, texts, config, scene, persist: (c) => store.save(c),
  onAction: (a) => { /* resume, newGame, load, save, quit, setting, preview, settingsSaved */ } });
menu.open(); // F4. menu.open("quit") is F10
// each frame: menu.tick(ms); copy the scene, then menu.draw(frame)
// pointerDown / Move / Up in 640×480, keyDown / keyUp
```

`scene` is the 640×480 view **at the moment the menu opens**. The window snapshots it, darkens it, and draws the frame. A window open over another covers it. Actions: `resume` and `newGame` close the menu. `load` and `save` leave the menu up (after a load, call `close()`). `quit` follows yes. `setting` means the config field is already changed. `preview` is a volume slider (music live, the samples `SFX.S16` and `TALK.S16` for effects and speech). `settingsSaved` is the exit from an options window.

The darkening tables default to the exact tables carried with the engine. Without them, the formula is used (a difference of at most 1 LSB in 18 of about 4200 entries). Each frame pixel is darkened once. At the corners of the rings the listing does not settle whether the original darkens twice. The difference is one or two pixels.

Actions the host reports: `resume`, `newGame`, `load`, `save`, `quit`, `setting`, `preview`, `settingsSaved`.
