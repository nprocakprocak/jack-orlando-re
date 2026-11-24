# The studio logos, the intro, and the start screen

Code: `packages/engine/src/launcher/` (`logos.ts`, `intro.ts`, `intro-flag.ts`, `wipe.ts`, `wait-box.ts`) and `packages/engine/src/start/` (`flow.ts`, `screen.ts`, `modes.ts`, `session.ts`, `menu-music.ts`). The original has no start screen. The Director's Cut goes straight into the intro, and the easy version is chosen by the external launcher `JackStart.exe` ([easy.md](easy.md)).

## 1. The logos run once in the original, on the first launch

`g_cfgPlayIntro` is config `+0x12`. The map is in [gui.md](gui.md).

| Where | What |
|---|---|
| `Sys_InitConfigAndCd` `00469b70` | when `Reg_LoadConfig` `00469a30` finds no saved configuration (the first launch): `g_cfgPlayIntro = 1`, then `Reg_SaveConfig` |
| `Launcher_Run` `0046b020` (the `else` branch when `g_cfgPlayIntro` is not 0) | the buffer is filled with `_memset(…, 0x5ac8, 0x96000)` (memset takes a byte, so every byte is `0xc8` and the RGB565 pixel is `0xc8c8`, red), the wait window (`FUN_00469460`), the buffer is cleared, `Launcher_PlayIntro`, then `g_cfgPlayIntro = 0` |
| `Launcher_PlayIntro` `00469f40` | `Media_Open` of `MOVIES\INTRO.AVX` plus the `Media_Step` loop. At the end `g_cfgPlayIntro = 0` |
| `Media_Step` `00467c90`, state 5 | after the first block is loaded, when `DAT_009fc088` is not 0 (it is 1 in `Launcher_Run`): **always** the stripe blackout `FUN_00466a50` (§3). Only when `g_cfgPlayIntro` is not 0 does it close the window and show the three logos |
| `Reg_SaveConfigNow` `00469dd0` | on leaving the launcher (start, load, or quit) it writes the block with the flag 0 |

The logos are shown **once, on the first launch on a machine with no saved configuration**, before the movie `INTRO.AVX`. After that the flag stays 0 in the registry. The intro button in the menu calls `Launcher_PlayIntro` with the flag already 0, so there are no logos. The code is not dead, but a player with the game installed saw it once. A write to HKLM on an account without the rights fails quietly (see settings need an administrator). The flag then stayed 1 and the logos came back on every start.

**The engine, a departure kept on purpose:** the logos are shown **on every launch** (after Start on the start screen, skippable with Esc or a click), and `INTRO.AVX` by itself only on the first launch (the flag `jack-orlando.playIntro`). After that the intro plays from the introduction item and before every new game (§6). The original shows the logos and the intro together, once, and a new game has no intro.

## 2. The sequence (`Media_Step`, state 5)

In order, `LOGOTT.BM`, `LOGO.BM`, and `LOGOJW.BM` from `MENU.PAK` (614404 bytes each: a 4-byte header plus 640×480 RGB565). For each one:

1. the work buffer `DAT_009fadb8` is cleared (black). 32 times: `Timer_MarkFrameStart`, **`Blit_MixStep565(logo, buffer)`** (`0046e1a0`, the same function as a scene dissolve, `mixStep` in `packages/engine/src/render/transition.ts`), `Blit_ImageToScreen`, `Timer_WaitSinceFrameStart(0x32)`;
2. `Timer_Sleep(500)`;
3. the buffer is cleared. 32 times the other way: `Blit_MixStep565(black, logo)`, the display, `Timer_WaitSinceFrameStart(0x1e)`.

There is no alpha blending. One pass moves each channel of a pixel one step (green by 2) toward the target, so 32 passes give the full logo, or black. The game clock ticks every 5 ms, and the wait ends after *more than* `ms/5` ticks:

| Step | Wait | Ticks | ms |
|---|---|---|---|
| the fade in (×32) | `WaitSinceFrameStart(0x32)` | 11 | 55 |
| the hold | `Timer_Sleep(500)` | 101 | 505 |
| the fade out (×32) | `WaitSinceFrameStart(0x1e)` | 7 | 35 |

One logo is 677 ticks (3385 ms). The whole thing is 2031 ticks, **10155 ms**. The time spent displaying and converting a frame is ignored (in the original it overlaps the wait). In the original the sequence cannot be interrupted (`pump()` other than 0 only means the window was closed). The intro movie starts after the last fade to black.

## 3. The wait window and the diagonal blackout

**The window** (`FUN_00469460`, called from `Launcher_Run` on the first launch): the launcher's wait caption (`Lang_InitLauncherStrings` `0046a430`; the German and English builds have their own wording). The width is the text width plus 0x28, rounded to even. The height is 0x32 = 50. `x` is centered on 640. `y = center(0x120, 50) + 0x57 = 206`. The label is centered, `y = 13`, white with a black outline. It is an ordinary GUI window over a snapshot of the background. The background color is `0xc8c8` (see §1, memset by a byte). After the window is built the buffer is cleared, so on screen there is a red, frame-darkened window on black.

**The blackout** (`FUN_00466a50`, called from `Media_Step` state 5, before the logos, also when the flag is 0, and from `Launcher_PlayIntro` `00469f40` after the movie or an interrupted intro, after `JACK2.BM` is loaded): for `i` from 0 to `0x4b000` (640·480): `n = i·0x31`, `y = n / 640` (modulo 480 when above 0x1df), `x = n % 640`, and the pixel `(x, y)` becomes 0 (`FUN_0046d910`). Successive pixels are 49 columns apart and jump a row about every 13, which is why the stripes are diagonal. The set of pixels is a permutation of the whole screen. After a pixel with `i % 0xf00 == 0` (including `i = 0`) `Timer_Sleep(5)` is 2 ticks, 10 ms, 80 times (0.8 s), and at the end `Timer_Sleep(0x32)` is 11 ticks, 55 ms. Together **855 ms**. Pixel `i` is black after `ceil(i/0xf00)` sleeps.

Esc: in the original neither the logos nor the blackout can be interrupted. `Launcher_PlayIntro` after Esc in the movie (`Input_IsKeyDown(1)`) ends with `Media_Close` and **does the same blackout** before the menu. Interrupting the intro with that transition matches the original.

## 4. The engine

- `packages/engine/src/launcher/wipe.ts`: `wipePixel(i)`, `wipeOrder()`, `pixelsAt(ms)`, `StripeWipe(surface).advance(dt)`. It blacks the surface in place.
- `packages/engine/src/launcher/wait-box.ts`: `waitBoxGeometry`, `buildWaitScreen(assets)`, `LaunchSequence`: the window, then the blackout, then the logos, then the end. `skip()` (Esc or a click) during the logo phase blacks the current frame with the same pattern (`abort`). Outside the logo phase it does nothing.
- `packages/engine/src/launcher/logos.ts`: `positionAtTick(t)`, `LogoSequence(logos).advance(dtMs)`. A state machine. `surface` is the current frame. The same picture for small steps and for one jump.
- `packages/engine/src/launcher/intro-flag.ts`: `readStartupOptions(search, storage)` returns `{ logos, intro }`, and `markIntroShown(storage)` is the engine's `g_cfgPlayIntro` in `localStorage` (`jack-orlando.playIntro`; missing means 1). A departure from the original:
  - `logos` is always true. `?logos=0` turns it off;
  - `intro` (the intro by itself, after the logos): `?intro=1` or `?intro=0` wins, otherwise `?logos=1` or `?logos=0` (the old switch for the whole first-launch sequence), otherwise the flag. `GameFlow` clears the flag with `markIntroShown` at the moment that intro starts (the original: after the movie, in `Launcher_PlayIntro`).
- The host calls `begin(readStartupOptions(…))`. The wait window is up at once (the logos load behind it). The render loop advances `LaunchSequence` with game time and no pauses (a pause also holds the fade). At the end, `logosDone` goes to `GameFlow` (§6). A page opened with `?scene=` or `?start=1` skips the whole thing. If a logo fails to load, the flow continues after the blackout without it.
- `packages/engine/src/launcher/intro.ts`: `openIntro(read, settings)` opens `Movies/INTRO.AVX` in mode 1 with the captions `Movies/INTRO.DLG` (`DialogOnOff` → `dialogTextOn`; a missing or damaged DLG means no captions, a missing AVX means `null`). `IntroEscape`: Esc held from the previous screen (the one that skipped the logos) does not skip the movie until it is released.

## 5. Departures

- The window is visible for at least `WAIT_MIN_MS` = 600 ms. The original shows it until the first block of `INTRO.AVX`. A page loads the logos at once and the window would flash.
- **Esc skips the logos.** The original did not allow it. A left click does too. The blackout cannot be skipped, as in the original.
- **A click skips movies.** The original's movie loops (`Launcher_PlayIntro` `00469f40`; `RUNAVX` in `Game_Run` `0042b6d0`: `Media_Step` → `Sys_PumpMessages` → `Input_IsKeyDown`) end only on a key (Esc). They do not read the mouse. The engine adds a left click for `INTRO.AVX` and `RUNAVX` (`ClickSkip`, `packages/engine/src/launcher/intro.ts`). The click becomes a one-shot Esc for that frame of the movie and is consumed. It does not reach the menu or the scene after the movie (it does not start a walk). **`RUNFILMP` (`Film_Play` `0040f450`) cannot be skipped.** The loop reads no input, neither a key nor the mouse, so the engine does not skip it either.
- The start screen's main button is a start action. The new-game caption stays in the F4 menu and in the slot window.
- **Logos on every launch, and the intro by itself only on the first.** The original shows both together, and only once (§1).
- The time spent displaying frames is ignored (in the original it overlaps the wait).

## 6. The program flow

The state machine `GameFlow` (`packages/engine/src/start/flow.ts`, no DOM) follows `WinMain` `00451650` plus `Launcher_Run` `0046b020`. The host feeds it events and carries out the commands.

```
start screen --Start--> wait window → blackout → logos (Esc or a click)
  ├─ first launch: INTRO.AVX → stripe blackout → main menu
  └─ later: ----------------------------------------→ main menu
menu: introduction → loading (≥ 1000 ms) → INTRO.AVX (Esc skips) → stripe blackout → menu
  new game → loading (≥ 1000 ms) → INTRO.AVX (Esc or a click skips; the game is created in the background) → stripe blackout → SC001 from scratch
  load → loading (≥ 1000 ms) → SC001 from scratch, and on the first frame the load window over the scene (cancel is an ordinary new game)
  quit / Esc → a 455 ms close → the start screen
in game: quit from F4, or OUTRO.AVX → the main menu (the last frame of the game is blacked the way the previous screen is)
```

- **Start.** The event `begin { logos, intro }` comes from `readStartupOptions` (§4). The logos always run (unless `?logos=0`). After them the intro runs only on the first launch (`markIntroShown` stores the flag), then `StripeWipe` (855 ms) and the menu from black. Later launches: logos, then the menu from black. The original: the logos and the intro together, only on the first launch. Outside that, Start goes straight to the menu (§1).
- **The intro from the menu.** `MainMenu` shows the loading plate and the disc cursor itself (the `intro` phase). The host opens `INTRO.AVX` in the background, and after `readyToLeave` **and** an open movie it plays it (the menu stands still, and its clock does not run). After the end or Esc, `menu.returnFromIntro(lastFrame)`. A missing `INTRO.AVX` means the menu returns with no movie.
- **Loading lasts at least 1000 ms** (`LOADING_MIN_MS`, [mainmenu.md](mainmenu.md)) for all three buttons. The original shows it only for as long as the load takes.
- **A new game.** The original starts SC001 with no movie. The engine, after the loading plate, plays `INTRO.AVX` (`prepareIntro` and `prepareGame` together: the movie opens, and the game is created in the background). Esc or a click skips the movie. After the movie, whether it was skipped or played to the end (the same as the introduction item), the last frame is blacked with stripes (`StripeWipe`, 855 ms; the `wipe` stage), and only then SC001. When the game is not ready yet after the fade, the screen stays black (`afterIntro`). The original: `Launcher_PlayIntro` `00469f40` does no fade after the movie (it rebuilds the menu and `Launcher_RevealBackground`), and a new game does not play the movie at all, so the fade is a departure. A missing `INTRO.AVX` means the game starts right after the loading plate. Esc that skipped the movie does not reach the game (`input.escape` is cleared in `enterGame`).
- The game is created during the loading plate. Entry waits until 1000 ms have passed (and the new-game movie has finished) **and** the game is ready (`PlayGame.create` of SC001). A failed create returns to the menu (`openMenu` with the menu's last frame).
- **Load.** `Game_Main` `0044d1d0`, when the launcher's result is 3, sets `g_loadOnStart` `0x6d504c` and enters `Game_Run` on `SC001`. On the first frame of the scene `g_loadOnStart` starts the music `TR02-22.PMS`, sets cursor mode 0, and calls **`Menu_Load` `0040b430`** (the system file window over the scene). A loaded save sets `g_sceneChange`. **Cancelling leaves the game in SC001** (the branch `g_newGameRequest` is dead, [savegame.md](savegame.md)). The engine: `PlayGame.openLoadWindow()` (the same window as F3) is called by the host when the game has entered `playing`. The engine starts from the ordinary music of SC001. It does not force the current-track name to `TR02-22.PMS`.
- **The slot mode.** The slot window `004098f0` has no caller ([savegame.md](savegame.md)), so the code does not say what Load from the menu did in an older version. That is a hypothesis. The engine does the same as in the file mode: SC001, and there the load window in the game's save mode (`SlotWindow` when `saveMode` is `"slots"`, because `fileWindow` decides the mode). The new-game button of the slot window (the dead branch `g_newGameRequest`) is, here, simply closing the window.
- **Menu music** (`TR02-22.PMS`): `MenuMusic` runs the `music` events on its own `Mixer` over the same backend (channel 5). The game has a separate `Mixer`. A pause covers both.
- Returning from the game goes to the menu, not to the start screen, like the `WinMain` loop (a result other than 1 goes to `Game_Main`, then the menu again). That includes a game started with `?scene=` or `?start=1`.
- `?scene=` and `?start=1` skip the start screen, the logos, and the menu (the game starts at once). `?start=0` forces the screen even with `?scene=`.

A save from the other version, chosen in the window, is rejected quietly, as in `00409090` (the game stays in SC001). Esc and a click during the logos skip them (§5). Logos on every launch, the intro by itself only on the first, the intro before a new game, and a loading plate of at least 1000 ms are departures.

## 7. The start screen

`packages/engine/src/start/screen.ts` (`StartScreen`) draws a window with the in-game menu components (the frame, the buttons, the Resource.pak fonts) over `SETUP_OK.BM`. The host feeds the input. There is no DOM inside the screen. Neither executable contains the file name `SETUP_OK.BM`. A missing file, or a decode error, is a black background. Transparent pixels (color 0) are black, because the picture is drawn on a black surface.

| Row | Values | Stored as | In the game |
|---|---|---|---|
| inventory | the coat, or the old top bar | `jack-orlando.modes` (`inventory`: `coat` or `bar`) | the coat is the Director's Cut screen. The bar is the dead top bar of older releases ([inventory.md](inventory.md)) |
| easy version | off or on | `jack-orlando.modes` (`easy`) | chosen only here. A change means a new game ([easy.md](easy.md)) |
| saves | files on disk, or slots | `jack-orlando.modes` (`saves`: `files` or `slots`) | [savegame.md](savegame.md) |
| pause when the window loses focus | on or off | `jack-orlando.pauseOnBlur`, `"1"` or `"0"`, default `"1"` | [pause.md](pause.md) |

`packages/engine/src/start/modes.ts`: `GameModes`, `sanitizeModes`, `cycleMode`, `StartStore`, `skipStartScreen`. A mode listed in `MODE_PENDING` is greyed out, does not react to a click, and keeps its default. The three rows above are wired (`null`). There is no right-button cursor rotation. The Director's Cut executable does not have it ([bulletmenu.md](bulletmenu.md)). The bullet-menu switch stays in the in-game options (`jack-orlando.config`), not on this screen. The window is 356 px tall, and the start button is at `y = 256`. The title asks which mode to play. A small line under the Start button says that F toggles fullscreen.

From the start screen the audio context is created and resumed inside the Start click, so sound plays from the first frame. A page opened with `?scene=` or `?start=1` starts the game at once, and the audio context then waits for the first click or key.
