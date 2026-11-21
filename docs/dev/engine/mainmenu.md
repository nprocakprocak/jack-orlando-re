# The main menu

Code: `packages/engine/src/mainmenu/` (`menu.ts` is the `MainMenu` state machine, `window.ts` the window, `smoke.ts` the smoke, `timing.ts` the effect times, `texts.ts`, `assets.ts`). The logos and the wait window on the first launch are in [launcher.md](launcher.md).

The main menu is `Launcher_Run` `0046b020`, called in a loop from `WinMain` `00451650`: `g_launcherResult = Launcher_Run(sound, window, Sys_PumpMessages)`. A result other than 1 goes to `Game_Main(1, 0)`, then the menu again. A result of 1 ends the program. After leaving the game (quit, or the end of `OUTRO`) the player therefore returns to this menu.

## 1. Assets (`Menu_OpenPak` `0046a900`, `MENU.PAK`)

| File | Size | What it is | Where |
|---|---|---|---|
| `JACK2.BM` | 640×480 | the background, the title poster | the background buffer `DAT_009fadb8` |
| `_SAMOCH1.BM` | 148×157 | the truck from the background, drawn **a few pixels shifted** (the cab and the star about 2–3 px higher; the headlights shine in both pictures). The second phase of the shake | a sprite at (0, 0x143 = 323), z = 0x6d6 |
| `D1.FLX` | 158×206, 192 frames | the smoke from Jack's cigarette. The frames are cut-outs of the background with the smoke painted in, half transparent (ordinary color keys, no blending) | a sprite at (0x135, 0x27) = (309, 39), z = 0x708 |
| `WSK00`–`08.BM` | 18×25 | the cursor: an **arrow** (the tip is in the top-left corner). In `RESOURCE.PAK` the `WSK*` pictures are the hand from the game | the cursor sprite, z = 0x79e |
| `CD00`–`39.BM` | 30×29 | a spinning disc, the wait cursor (the intro) | the same |
| `LADEN.BM` | 210×80 | the loading plate | (0xd7, 200) = (215, 200) |

z is the draw order (a larger z is on top). The GUI window has z = 1050, so **the smoke (1800) lies above the window**, and the truck (1750) does too. They do not cover the buttons (the smoke comes down to y = 245, the window starts at y = 190, and the buttons are at y = 250). The `LOGO*.BM` pictures are in the same archive ([launcher.md](launcher.md)). `COPYR.BM` (a 640×480 mark) is not loaded.

## 2. The menu window

In the `Launcher_Run` loop (every entry, and every return from the intro):

1. `Gui_CreateWindow(0xcd, 0xbe, 0xe6, 0xeb, 0)`. A window of 230×235 at (205, 190). A snapshot of the background, and the frame `Gui_DrawWindowFrame` as in [gui.md](gui.md). The launcher takes the **ordinary** branch of `Gui_CreateWindow`. `FUN_00469730` sets `g_renderBg` and `DAT_00b2bd78` to the same buffer (a hypothesis in the GUI note about a "branch for the launcher" is wrong). `DAT_009fc088 = 1` only gives its own buffer from `operator_new`.
2. `FUN_0045e9f0(window, 0x1f, 2)` goes to `Blit_TintRect16` `0046fb20`. Every non-zero pixel of the rectangle **(0, 0, w−4, h−4)** moves 2/32 of the way toward pure blue `0x001f` (the same blend tables as `blend565`). The right and bottom edges of 4 px stay untinted (the size matches an unused "+4×4" branch). The window stores the flag and the color (`+0x21`…`+0x24`), so `Gui_AddLabel` `0045eae0` and `Gui_DrawButton` `0045d4d0` tint the label and the buttons too: the scene, then (the label: a darkening of 16; the button: the frame), then the text's shadow, then **the tint**, then the text (the text itself is not tinted).
3. The label: `Gui_AddLabel` with a center, y `0x10`, an outline of 1, a fill of `0xffe0`, the large font. A yellow title.
4. Four buttons `Gui_AddButton` at `Gui_CenterOffset(0xe6, 0xb4) − 1 = 24`, 180×34, the large font, centered. `y` is 0x3c, 0x62, 0x88, 0xae (60, 98, 136, 174 inside the window).

The button names the code compares (`Gui_NameIs`) are `Intro`, `Start`, `Load`, and `Quit`. `Lang_InitLauncherStrings` `0046a430` fills the captions for the build's language, read from the executable in Mazovia. From the top: the introduction, a new game, load, and quit. The title is letter-spaced. `/2` is a spacing of 2 px, and `=` is an empty glyph of 3 px ([gui.md](gui.md), [fnt.md](../formats/fnt.md)). A diamond in the title is byte 4, a diamond glyph in the `JACK` font.

**Opening** (the loop `DAT_009e6794 = 0, 3, … 30`, below `0x21`): the window is copied to `DAT_009e6a8c`. On each step `Render_ComposeRegion(…, maxZ 0x10)` pastes only the background into the window's buffer, and `FUN_0046f8e0(level, copy, buffer)` moves the buffer's pixels `level/32` of the way toward the copy (where the copy is not 0). The step waits for one presentation of a frame: `DAT_009fc078 = level + 2`, the hook `FUN_0046bea0` moves the window's sprite into place and clears the variable. 11 steps are 11 presentations. **The level ends at 30/32**, and `Gui_RunWindow` does not redraw the window. The window stays at 30/32 for the whole time the menu is up. The buttons are separate sprites, hidden until `Gui_RunWindow` (`Sprite_AddRaw` creates an invisible sprite, `+0x0c = 0`; `Gui_RunWindow` `00462620` moves them and shows them). **They appear all at once after the window has emerged.** At 60 Hz the emergence lasts about 0.18 s, so the window and the buttons look as if they appear together. That matches play. On the way out, the window and the buttons disappear first, then the rest of the menu (the close below, then `Gui_CloseWindow`).

**Closing:** a copy of the current window (already at 30/32), a loop `0x1e, 0x1b, … 0` with the same blend. The buttons stay visible until the end, then `Gui_CloseWindow` removes everything.

## 3. Handling

`Gui_RunWindow` ([gui.md](gui.md)): a click is a press over a button (drawn pressed for as long as the mouse is over it), and a release over it yields the name. Sliding off cancels. **Enter is button number 1, the introduction.** **Esc** yields `"/0"`, `g_guiKeepGoing` becomes 0, the loop leaves, no name matches, and the path is "not the intro" with no Start and no Load. Then `Launcher_CloseAnim`, and the result is 1. **Esc leaves the game with no question**, the same as quit. Closing the program's window (the pump is not 0) does the same. A hit uses the raw mouse (`g_mouseX/Y`), and the cursor is drawn **from the mouse position to the right and down** (`Sprite_SetOverlay` in `FUN_0046bea0`, with no subtraction of half the picture, unlike the game). The tip of the arrow is exactly the hit point.

The result (`g_launcherResult` `0x6da5a8`): the introduction goes to the intro and back to the menu (the loop), a new game is 2, load is 3, quit or Esc is 1. In the engine `MainMenuResult` is `intro | newGame | load | quit`.

## 4. The course and the times

The launcher's clock: `Timer_Start(1, 0x11, Launcher_TimerTick 0046c090, 1)`, **every 17 ms** (not 5 ms; the 5 ms clock only counts the times of `Timer_Sleep`). Presentations: `Video_PresentIfDue` once per refresh of the monitor (the engine: 60 Hz). `Timer_Sleep(ms)` waits `ms/5 + 1` ticks of 5 ms (pumping messages).

The entry (the branch `g_cfgPlayIntro == 0`, every ordinary entry):

| Step | Function | Time |
|---|---|---|
| blacking the previous screen: for `r = 0…239`, row `2r` and `479−2r`, `Timer_Sleep(5)` after `r % 6 == 0` (40 times), and at the end `Timer_Sleep(0x32)` | `FUN_0046c510` (a copy of `Launcher_CloseAnim`) | 40·10 + 55 = **455 ms** |
| `MENU.PAK`, the buffers, the sprites (hidden), the start of the 17 ms clock | | — |
| `Menu_FlxStep` (the first chunk of smoke, the sprite still hidden) | `004692b0` | — |
| the music: stop channel 5, `TR02-22.PMS` at volume 0, then 0, 1, … `vol−1` every `Timer_Sleep(10)`, and at the end `vol` | `FUN_0046a240` | `vol`·15 ms (35 is **525 ms**) |
| revealing the background, pixel by pixel in the order of the diagonal blackout ([launcher.md](launcher.md)), `Timer_Sleep(5)` after `i % 0x1900 == 0` | `FUN_00469620` | 48·10 = **480 ms** |
| `g_onPresent = FUN_0046bea0`, the window, the opening | | 11 presentations (about 183 ms at 60 Hz) |

The music and the wait run only when sound is on (`DAT_009fc07e`). The string passed as a track name lands only in a local. The file is `TR02-22.PMS` (the same pointer `Menu_AudioOptions` reads). The launcher calls `Music_StartStream(5, file, 0, 0, 0x1016, 0xac44, 0x7f)`. The last argument is 0x7f instead of 0 in the game ([music.md](music.md)). What it means was not settled.

The exit (after the window closes, for every result): `FUN_0046a390(2)`. The volume goes `vol, vol−2, …` while it is above 2, every 15 ms, then a stop (35 is 17 steps, **255 ms**). Then:

- **The introduction.** `Sprite_Set` of the loading plate at (215, 200) (z = 18, under the window). `Launcher_PlayIntro` `00469f40`: `DAT_009fc06e = 1`, so the cursor becomes the disc. The movie `INTRO.AVX` (Esc skips it), `JACK2.BM`, the stripe blackout (855 ms, [launcher.md](launcher.md)), the counters are cleared, `Menu_FlxStep` from the start of the file, the music as on entry, the background is revealed, the loading plate is removed, and the window again.
- **A new game, load, or quit.** `Reg_SaveConfigNow`, the pack is closed, the clock is stopped, the cursor, the truck, and the smoke sprites are removed, **the last frame of smoke is pasted straight onto the screen** (`Blit_KeyedToScreen(0x135, 0x27, …)`). For start and load, `Blit_ImageToScreen(0xd7, 200, LADEN.BM)`. The loading plate stays on screen until `Game_Main` draws the game. The result is 2 or 3. Quit: `Launcher_CloseAnim` (455 ms), result 1.

The loading plate is a picture on the menu (not a separate screen) after every choice except quit. For the introduction it is a sprite at z = 18. For start and load it is pasted onto the screen. In the engine `readyToLeave` in the phases `loading` and `intro` is after **at least 1000 ms** (`LOADING_MIN_MS`). The original shows the plate only for as long as the load takes. It applies to all three buttons. The switch into the game, and the movie before a new game, are in [launcher.md](launcher.md).

## 5. The menu's animations (`Launcher_TimerTick` `0046c090`, the hook `FUN_0046bea0`)

They run only when `DAT_009fc07c` is 1 (from the end of opening the window until the start of closing it):

- **The truck.** The counter `DAT_009fc07a` adds 1 per tick. At 6, `DAT_009fc076` becomes 1. At 12 it becomes 0 and the counter is 0. The hook, every presentation, shows or hides the sprite `_SAMOCH1.BM`: alternately 6 ticks (102 ms) of the shifted truck and 6 ticks of the truck from the background. **The truck shakes like an engine idling** (about 4.9 Hz). An earlier description that said the headlights flash was wrong. The headlights shine in both pictures (a pixel comparison with `JACK2.BM`: about 57% identical, and the rest is the shifted drawing). On closing, the shake freezes in the current phase.
- **The smoke.** `DAT_00504ad8` subtracts 1 per tick (from 10 after the entry). The hook, at zero, sets 3 and calls `Menu_FlxStep` (after the last frame it returns to `0x14`). A step is 3 ticks from a presentation (the first after 0–17 ms) plus a wait for the next presentation, so 34–68 ms, about 51 ms on average. One call is one chunk (plus a palette). A rectangle (type 3) takes the whole call. 192 frames plus 188 rectangles is 380 steps, about 19 s per loop. The first visible step is 10 ticks (153–170 ms) after the window opens. Until then there is no smoke. The frame buffer is not cleared. Drawing: `Sprite_Add(…, 0x41800000 = 16.0, …)` gives kind 0x10, an ordinary 16-bit picture with color key 0 and no blending. The smoke is painted into the frames (lighter streaks on the background colors). In motion it is clearly visible. The decode was checked on `D1.FLX` (about 3000 pixels per frame that differ from the background).
- **The cursor** (always, when the hook is running and the mouse is in the window): every 7th tick (119 ms), outside the wait mode, the arrow frame `DAT_009fc06c` runs 0…8. A mouse to the right of the previous read is +1, to the left is −1, and with no motion it drifts to 4 (the same logic as the hand in the game, [cursor.md](cursor.md)). In the wait mode (`DAT_009fc06e` is 1, the intro) every 2nd tick (34 ms) the next disc `CD00`…`CD39`.

## 6. The engine

```ts
const menu = new MainMenu(assets, { sound, musicVolume: config.musicVol, previous: lastScreen,
  onEvent: (e) => { /* e.kind "music": stop / start TR02-22.PMS / volume v (game units, the channel is 2v); "result" */ } });
// every frame: menu.advance(dtMs); the picture is menu.frame() (640×480 RGB565)
// input: pointerMove/Down/Up(x, y) in screen pixels, pointerLeave(), keyDown/keyUp ("Enter", "Escape")
// a result "newGame" or "load": the phase "loading", wait for menu.readyToLeave (≥ 1000 ms) and for the game to load
// a result "intro": play INTRO.AVX (menu.advance keeps animating the disc cursor), then menu.returnFromIntro(lastFrame)
// a result "quit": after 455 ms of blackout the phase is "done", the start screen
```

The phases are `blackout → musicIn → reveal → open → menu → close → musicOut → intro | loading | quitting → done`. After `returnFromIntro`: `wipe → musicIn → reveal → open → …`.

## 7. Departures

- Presentations every 1/60 s (the original: the monitor's refresh). The tempo of the window opening and of the smoke depends on it.
- The cursor is not drawn during the blackout and the reveal. A hypothesis: on entry the cursor hook is not running yet (`g_onPresent` is set after the reveal). After the intro the hook is running, but the effects write straight to the screen. What is visible was not checked.
- **The cursor on the loading plate.** A departure. The original: after the introduction, `DAT_009fc07c` becomes 0 (the truck freezes in the current phase), and `Launcher_PlayIntro` sets `DAT_009fc06e = 1` (the code switches the cursor to the `CD` disc from the next 2nd tick). After start or load the truck, the smoke, and the cursor sprites are removed, the 17 ms clock is stopped (`Timer_Stop(1)`), and the loading plate is pasted onto the screen. Play of the original: the truck freezes, and **the cursor disappears** (the code does not explain that for the introduction; a hypothesis is that opening the movie takes the screen before the disc is drawn). The engine: the truck is as in the code (frozen after the introduction, the one from the background after start or load), and **the cursor is immediately the spinning disc `CD00`–`39`** (every 2 ticks, 34 ms) in all three cases. On start or load the 17 ms clock keeps ticking only for the disc.
- `DAT_009fc076` (the shake phase) starts at 0. A hypothesis. `Launcher_Run` does not clear it. After a return from the game the state from before entering the game remains, a difference of one shake phase.
- Mouse motion before the window opens counts toward the arrow's frame (the clock ticks from the start of the music), which matches the code.
