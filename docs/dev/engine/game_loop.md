# The frame loop of `Game_Run` (`0042b6d0`)

A map of the function `Game_Run` (`0042b6d0`…`0043bdf6`, 67367 bytes): scene setup, the steps of one frame in the order they run, the modal screens, and leaving a scene. The detail of each step is in the note that owns it. This note is the order and the pointers. The picture of the three loops (scene, frame, exit) is in [architecture.md](architecture.md). The addresses below are the first instruction of each block.

## The skeleton

```
0042b6d0 prologue (once per call of Game_Run)
0042bb86 ┌ the SCENE loop: scene setup, [PRE], scene exceptions, [INIT]
0042cb30 │ ┌ the FRAME loop
  │ │ A. entry, the cursor, the keys, the verb menu
0042ec9b │ │ B. the world logic; the frame returns here after the F4 menu
004381ba │ │ C. modal screens: the map (M), the coat (F1)
0043b2b7 │ │ D. the autosave (the first frame of a scene), the end of the frame
0043b37a │ └ leaving the scene (g_sceneChange or g_quit)
0043bc3f └ repeat the scene, or the end of the game
```

## The prologue and the scene setup

| Range | What it does |
|---|---|
| `0042b6d0`…`0042bb85` | once: `g_gameFinished = 0`, the UI sprites (the frame, the arrows, the bar, the bullet menu `0x88f640` plus 5 icons, the faces), `g_cursorMode = g_verbMode = 0`, the variables `LANVER` and `ISSOUND` (`Var_Set`), and in the easy version `Cursor_LoadSet2` |
| `0042bb86`…`0042bc1d` | the start of the scene loop: `LIGHTVER`, and `JACKISMENU` into `0x8f687c` |
| `0042bc3a`…`0042bc7a` | a state save to `tempjs` (`00408560(path, 1)`). The format is [save.md](../formats/save.md) |
| `0042bc7a`…`0042c836` | a reset of about 200 scene variables, including the macro counters: for 150 macros `active = 0`, `g_macroRunnable = 1`, `g_macroPending = 0` (`0042c618`, `0042c623`). Jack's sprite and the shadows, the persons, the object animations, `g_macroTimer = 2999`, `g_jackX/Y = 320/240` |
| `0042c836`…`0042c870` | `[PRE]` runs to the end in a loop, with no frames. [scripts.md](scripts.md) |
| `0042c876` | `Scene_RefreshBackground` (the dissolve, [transition.md](transition.md)) |
| `0042c8b0`…`0042caf8` | the scene exceptions `SC000D` / `SC008B` (`0x653170` is a scene with no control of Jack), `SC000C` / `SC002` / `SC005B` (no save, `0x87165e = 0`), and the restore of Jack's position after a load (`0x79dfc8`) |
| `0042cafd` | `Script_StartMacro("INIT")`. It runs in the frames |

## A frame, in order

One frame is one pass of `0042cb30`…`0043b365`.

| # | Range | Step | Where the detail is |
|---|---|---|---|
| 1 | `0042cb30` | `Timer_MarkFrameStart` | [architecture.md](architecture.md) |
| 2 | `0042cb35`…`0042cba8` | the mouse at the left or right edge (outside mode 0) | |
| 3 | `0042cbae`, `0042cbb3` | `Cursor_UpdateHotspot`, `Cursor_AnimateStep` | [cursor.md](cursor.md) |
| 4 | `0042cbb8`…`0042cbfe` | the last key; when the player is not locked, a copy of Jack's pose | |
| 5 | `0042cc03` | `Sound_ReleaseIdleChannels` | [sfx.md](sfx.md) |
| 6 | `0042cc0f`…`0042cc2c` | the animation of the **message bar** `0x563f20` (unroll `0042a0d0`, roll up `0042a1f0`) | below |
| 7 | `0042cc35`…`0042cd0c` | sprite `0x551558` at the mouse (when the cursor is idle) | [cursor.md](cursor.md) |
| 8 | `0042cd0c`…`0042cfe5` | `g_idleFrames++` (when the logic is not frozen), cleared on mouse motion; after 1500 frames, Jack's idle insertion | [animation.md](animation.md) |
| 9 | `0042cff9`…`0042da0a` | the **keys**: Backspace, P, F5, F6, F10, F2, F3 | [keys.md](keys.md) |
| 10 | `0042da38`…`0042da4d` | the caption's time runs out (`0x8ab5e8` is 0) → `Caption_Hide` | [play.md](play.md) |
| 11 | `0042da52`…`0042dbad` | the cursor mode over an exit (`LEWO`, `PRAWO`, `DOL`, `TO_IN`, `UP`, `TO_OUT`) | [areas.md](areas.md) |
| 12 | `0042dbcd`…`0042def2` | the **right button**: the verb menu or the bullet menu | [bulletmenu.md](bulletmenu.md) |
| 13 | `0042def2`…`0042e763` | the open bullet menu (5 icons, the highlight, the choice of a mode) | [bulletmenu.md](bulletmenu.md) |
| 14 | `0042e778`…`0042ec9a` | **dead**: sliding the bar out (`0x6bc294`) | [inventory.md](inventory.md) |
| — | `0042ec9b` | the **entry of the `do` loop**. The frame returns here after the F4 menu | |
| 15 | `0042ec9b`…`0042fa5f` | **dead**: handling the item bar | [inventory.md](inventory.md) |
| 16 | `0042fa60`…`0042faeb` | the timed macros `CO60` / `CO30` / `CO10`, `ACTIVEMACROAT` | [scripts.md](scripts.md), timed macros |
| 17 | `0042faf0`…`0042fb20` | `g_macroPlayerLocked` is set when an active macro has no `UNLOCK` | [scripts.md](scripts.md) |
| 18 | `0042fb91`…`0042fd6f` | cursor modes 0x14 and 0x15 (scrolling by the edge) | [areas.md](areas.md) |
| 19 | `0042fd7e`…`0043013a` | the **left click**: zones, sprites (they start macros), a walk, a refusal | [areas.md](areas.md), [walk.md](walk.md) |
| 20 | `0043014a`…`004301ba` | the **macro interpreter**: for `i = 0…g_macroCount−1`, one command when the macro is active and `g_macroRunnable[i]` and the logic is not frozen (and `0x8f6913` is 0, which it always is; see the bar) | [scripts.md](scripts.md) |
| 21 | `004301bf`…`00430299` | `g_macroPlayerLocked` again; hiding and showing the cursor | |
| 22 | `0043029f` | the **only place a scene changes**: `g_sceneChange` goes to `0043b37a` | below |
| 23 | `004302b0`…`004304fb` | a scene with no control (`0x653170`): the direction; choosing an answer in a dialogue (`Dialog_MenuPointer`, `Talk_Begin`) | [dialog.md](dialog.md) |
| 24 | `00430516`…`004307fe` | the speakers' faces, blinking | [dialog.md](dialog.md) |
| 25 | `004307fe`…`00430826` | the speech step `Talk_FaceStep` (`00413e20`), the end of a line | [dialog.md](dialog.md) |
| 26 | `0043082b`…`004317d5` | **Jack's turn** (when `g_jackTurning` and the counter is ≤ 0) | [turn.md](turn.md) |
| 27 | `004317dc`…`0043289b` | **Jack's walk step** | [animation.md](animation.md), [walk.md](walk.md) |
| 28 | `004328bc`…`00433cff` | **Jack's insertion step**, Jack's shadow | [animation.md](animation.md), [shadows.md](shadows.md) |
| 29 | `00433d96`…`00435150` | **a person's walk step** (every person in order), `Jack_AvoidPerson` | [persons.md](persons.md), [avoid.md](avoid.md) |
| 30 | `00435155`…`004363e1` | **a person's insertions** (every person in order), the persons' shadows | [persons.md](persons.md), [shadows.md](shadows.md) |
| 31 | `004363ec`…`00437ffe` | **object animations** (`ANIMA`, index `0x51f91a`), `.FLX` | [animation.md](animation.md) |
| 32 | `00438003`…`004380dd` | `0x6d504c` (the launcher's load result) → the load window `0040b430` | [launcher.md](launcher.md) |
| 33 | `00438113`…`004381b5` | the **options menu**: F4 (without Alt) or the request `g_optionsRequest` (`0x8f6914`) → `Menu_InGameOptions` (`0040b580`), then a jump to `0042eb34` and back to `0042ec9b` | [gui.md](gui.md) |
| 34 | `004381ba`…`00438644` | the **M** key (without Ctrl) → the map `MAP2.BM` | [minimap.md](minimap.md) |
| 35 | `00438644`…`0043b29b` | **F1**, or the right button with an item in hand, or the middle button → the coat screen, its own loop | [inventory.md](inventory.md) |
| 36 | `0043b2b7`…`0043b333` | the first frame of a scene: the autosave (`Save_CopyTemp`) | [savegame.md](savegame.md) |
| 37 | `0043b33b`…`0043b365` | `g_frameCounter++`, `g_quit` or `Sys_PumpMessages` leaves, `Timer_WaitSinceFrameStart` | [architecture.md](architecture.md) |

**Drawing is not its own step.** Every `Sprite_Set` in steps 19–31 redraws the changed rectangle in the work buffer at once ([render.md](render.md)), and the picture reaches the screen in `Video_PresentIfDue`, called from `Sys_PumpMessages` (step 37, and every wait inside a modal screen). Sound has no step either. Steps and effects start at the event, and a thread `Sound_MixerTick` tops up the streams ([sfx.md](sfx.md), [music.md](music.md)).

**The tempo of the steps.** Steps 25–31 do not run every frame. They run when their counter (`g_jackInsDelay`, `g_personTimer[i]`, `g_objAnimCounter[i]`, `g_talkClock`) has fallen to ≤ 0. `Game_TimerTick` (`00426990`) decrements the counters on the 15 ms logic tick ([architecture.md](architecture.md)). The frame loop turns 100–200 times a second, so on most frames steps 25–31 do nothing.

## Who decrements `g_macroPending` and sets `g_macroRunnable`

`g_macroPending` `0x723c70` (`int16[150]`) and `g_macroRunnable` `0x6c26b8` (`int8[150]`). What they mean is in [scripts.md](scripts.md) and [frame.md](frame.md). Every write inside `Game_Run`:

| Step | Address (counter / flag) | Macro (the index) | Event |
|---|---|---|---|
| init | `0042c623` / `0042c618` | all of them | the start of a scene: `pending = 0`, `runnable = 1` |
| 20 | reads `0x6c26b8[i]` | | `Script_ExecStep(i)` only when `runnable` |
| 26 | `00431759` / `0043177b` | `0x8aca1a` (Jack's walk macro) | the turn sequence ended, Jack was going to walk (`g_jackWalking`), calling `Jack_WalkToPoint` again finished the walk at once (`0x8ab668` is 0), and the counter had been bumped (`0x8a1781`) |
| 26 | `004317ae` / `004317d0` | `0x851d00` (the turn macro) | the turn sequence ended, when `g_turnMacroWaits` (`ROTATETO` / `STAY`, [turn.md](turn.md)) |
| 27 | `004319f6` / `00431a18` | `0x8aca1a` | Jack's walk reached the last point of the path (`g_walkPathIndex ≥ len−1`), the macro is active, and `0x8ab668` |
| 28 | `00432b42` / `00432b64` | `0x54d6e0` (Jack's insertion macro) | Jack's insertion ended (`g_jackInsActive = 0`) |
| 28 | flag only, `00433ce1` | `0x54d6e0` | `0x8f5dcc` (an insertion with the "do not wait" flag): **only** `runnable = 1` after the first frame, with no change of the counter |
| 29 | `00433f70` / `00433f9c` | `g_personWalkMacro[p]` `0x8ab798` | person `p` reached the target (the distance is under 10 and under 5, and not `SHOWFRAME`) |
| 30 | `004353ba` / `004353e6` | `g_personInsMacro[p]` `0x534fe8` | the person's insertion ended (`cur + 1` past the end) |
| 30 | flag only, `0043634a` | `g_personInsMacro[p]` | `0x8f5dcc`, as above, for a person |
| 31 | `0043767a` / `004376ac` | `g_objAnimMacro[a]` `0x51f8a0` | a `.FLX` animation in mode 5: the frame counter `0x871ad4` reached `0x8ab8d0` |
| 31 | `00437aa7` / `00437ad9` | `g_objAnimMacro[a]` | a `.REC` in mode 3: the position is at or past the length (a positive step). **Not** when `STOPAT` hit the position |
| 31 | `00437b8f` / `00437bc1` | `g_objAnimMacro[a]` | a `.REC` in mode 3: the position is below 0 (a negative step) |
| 31 | `00437ece` / `00437f00` | `g_objAnimMacro[a]` | pictures in mode 1: the picture is at or past the picture count |
| 31 | `00437f94` / `00437fc6` | `g_objAnimMacro[a]` | pictures in mode 1: the picture is below 0 |

Every write has the form `pending[m]−−; if (pending[m] < 1) runnable[m] = 1`, except the two "flag only" rows. Outside `Game_Run`: `Talk_FaceStep` `00413e20` (step 25, the end of a line: `runnable[0x7c7a52] = 1` when `!g_talkNoResume`), `Script_StartMacro`, `Area_ClickMacro`, `Sprite_ClickMacro` (they start a macro), `Script_FindMacro` (`pending = 0`), and `Script_ExecStep` / `Script_Stay` (the start of an operation: `pending++`, and with `-` also `runnable = 0`).

**The order in a frame:**

1. Step 19 (a click) and step 16 (the timed macros) can **start** a macro. It runs its first command in step 20 of **the same frame**.
2. Step 20 runs one command of the macros `0…n−1`, in index order. A macro started by another macro's command (`ACTIVEMACRO`) still runs in this frame if it has a higher index, and in the next frame if it has a lower one.
3. Steps 25–31 finish operations **after** step 20. A macro whose operation ended in frame N runs its next command in step 20 of frame N+1. Inside one frame the order of the endings is: the line, Jack's turn, Jack's walk, Jack's insertion, person walks 0…k, person insertions 0…k, object animations 0…a.
4. The start of an operation in step 20 and its first step can fall in the same frame. `WALKTO JACK` clears `g_jackInsDelay`, so step 27 of that frame already walks.
5. An exception to "one step 20 per frame": after the F4 menu (step 33) a jump to `0042ec9b` repeats steps 15–33 with no new `Timer_MarkFrameStart`. The interpreter then runs a second command in the same frame. The practical effect is none. The menu lasts a long time anyway.
6. `g_logicFrozen` `0x79dfcc` stops step 20 and every counter in `Game_TimerTick` (steps 25–31 stand still). That is the logic pause for modal screens and transitions.

Two paths in `Script_ExecStep` bump Jack's walk counter. One only when `0x8ab668` (the walk actually started). The other always, and it always sets `0x8a1781 = 1`. When Jack is already at the target, `Jack_WalkToPoint` clears `0x8ab668` and does not start a walk, so step 27 does not decrement the counter. Whether a macro with `-` can stick is settled in [frame.md](frame.md). A `.REC` in mode 3 stopped by `STOPAT` on the final position does not decrement the counter. `0x8f5dcc` is one flag for Jack and every person. It releases the first insertion that takes a step (Jack before the persons).

## Keys

DirectInput codes from the `push` before `Input_KeyPressedOnce` or `Input_IsKeyDown`. The exception: P and Esc in the wait loops compare a **character** from `Input_GetLastKey` (`ToAsciiEx`; Esc is `0x1b`). The behavior is in [keys.md](keys.md).

| Key | Address | What it does |
|---|---|---|
| Backspace (`0x0e`) | `0042cff9` | a jump from the tables `0x856020` / `0x8573a8` (the index is `0x8f68d0`, a condition on a variable). A table of 69 entries, built by `0044cb20`: leave a sub-scene for the parent scene and set `LAST` |
| P (the character `0x19` from `Input_GetLastKey`) | `0042d239` | would set `g_logicFrozen = 1` and toggle channels 1–4 around an empty `00406ed0`. **It does not work.** `Input_GetLastKey` returns a **character** from `ToAsciiEx` (`0045b560`, called from `0045b320`), not a DirectInput code. `0x19` is `DIK_P`, but as a character it is Ctrl+Y, and the Ctrl state for `ToAsciiEx` is overwritten by the right Alt (`0x9d2841 = g_keys[0xb8]`). P produces `'p'`, so the condition never holds. |
| F5 (`0x3f`) | `0042d260` | the quick save: the message bar shows the quick-save caption, the name comes from the date (`00408320`), and the save is `00408560` or `Save_CopyTemp` when the scene does not allow a save |
| F6 (`0x40`) | `0042d34d` | the quick load: a scan of the save directory (`_findfirst` `00487ed0`), a comparison of the dates taken from the file names (`atoi` on the pieces), and a load through `00409090` |
| F10 (`0x44`) | `0042d6cc` | the quit-confirmation window (`0040b510`), not with an item in hand |
| F2 (`0x3c`) | `0042d7e5` | the save window (`0040b330`) |
| F3 (`0x3d`) | `0042d8c4` | the load window (`0040b430`) |
| Esc (`0x01`) | `0042dbcd` | closes the bullet menu (`00419f50`) |
| F4 (`0x3e`, without Alt `0xfa`) | `00438113` | the options menu `Menu_InGameOptions` |
| M (`0x32`, without Ctrl `0x1d`) | `004381d3` | the map |
| F1 (`0x3b`) | `0043867e` | the coat |
| the arrows, PgUp, PgDn, Home, End | `00439d18`…`00439ddc` | scrolling on the coat screen |

Shared conditions (different subsets): no talk face (`g_faceLeft` and `g_faceRight` are −1), the game variable `0x7cde80` is not 0, the bullet menu is closed, no macro is active (`Script_AnyMacroActive`), and the cursor is enabled.

## The message bar `0x563f20` is not the inventory

`00429dd0(y, text)` builds a bar with text (`Text_PrintfWidth`, sprite `0x57a984`, z = 1600) at height `y`, and sets `0x563f20 = 1` (visible), `0x88f646 = 1`, `0x8f68dc = 1`. Step 6, every frame, calls `0042a0d0` (unroll by 2 px up to 0x20, then `0x8f68dc = 2`) or `0042a1f0` (roll up, and at the end `0x563f20 = 0`). Uses: F5 (`y = 0x1cc`, the quick-save caption, set by `Game_Main` for the build's language), the dead bar (`0042f2ff`), and the coat screen (`0043964e`, `y = 0x190`, the text at `0x57a860` is the name of the item under the cursor, `y = 400`). Modal screens wait until the bar has rolled up (`while (0x563f20) 0042a1f0()`).

## The verb menu and the right button

`0x9d2824` is the right button held. `0x89829a` is "it was released" (the edge). When there is no item in hand, no talk, the scene has control, and the cursor is enabled:

- the option `BulletOnOff` (`0x9fa960`, the registry, `00409c60`; the default is 1, `Sys_InitConfigAndCd`) **equal to 0** opens the text `Cursor_VerbMenu` (`00416780`) at the mouse (the width depends on the language);
- **not 0** opens the graphic bullet menu: `g_cursorZoneSuspended = 1` (`0x51f919` means "the bullet menu is open"), sprite `0x88f640` with the picture `0x69ece8` at the mouse. Step 13 handles the 5 icons. Esc or a choice closes it (`00419f50`).

There is no "rotate the cursor with the right button" in `Game_Run`. The right button opens a menu. With an item in hand (mode 5) it opens the coat (step 35). See [bulletmenu.md](bulletmenu.md).
