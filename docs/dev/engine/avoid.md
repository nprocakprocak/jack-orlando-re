# Scene transition (the dissolve)

`Scene_RefreshBackground` `0040dff0` has a second branch that dissolves the old picture into the new one in 32 steps. Implementation: `packages/engine/src/render/transition.ts` (`mixStep`, `SceneTransition`). Tests: `packages/engine/src/render/transition.test.ts`.

## When it runs

**Numbering:** `Script_ExecStep` `0041a330` does `switch (code − 1)`, so a decompiled `case N` is **command code N+1**. The name-to-code table is in `Script_CompileMacros` `00440cb0` (`"MIXING"` → `0x80`, `"REFRESHSCREEN"` → `0x81`, `"CLEARANIMABUFFER"` → `0x82`, `"GOTOSCENE"` → `0x14`).

- The dissolve is chosen by **flag `DAT_006bd688`** (`g_mixingPending`). The macro command **`REFRESHSCREEN`** sets it (code `0x81` = `case 0x80`). `Scene_RefreshBackground` clears it. It is also zero at initialization. The name is misleading. The command refreshes nothing. It only orders a dissolve on the next `Scene_RefreshBackground`.
- `MIXING` (code `0x80` = `case 0x7f`) is a different command, not this flag. `CLEARANIMABUFFER` (code `0x82` = `case 0x81`) does `memset` on the animation buffer.
- **`GoToScene`** (code `0x14` = `case 0x13`) does not set the flag. It writes the scene name into `g_sceneName`, `Sprite_Remove` on the cursor, removes object sprites (`00449d50`), and sets `g_sceneChange = 1`. `Game_Run` `0042b6d0` calls `Scene_RefreshBackground`. The order after `g_sceneChange` was not recovered as one procedure, so it was checked from the call graph.
- **In the game `RefreshScreen` occurs in 2 scripts, always immediately before `GoToScene`:** `SC007.MCC` (`RefreshScreen` then `GoToScene SC008`) and `SC201A.MCC` (`RefreshScreen` then `GoToScene SC201`). Only those two transitions dissolve. Every other scene change is a hard cut. Scene `0xc9` (= 201, `DAT_008f68d0` is the scene number) draws an extra picture in the loop. That is the transition SC201A → SC201.
- Confirmed in play: the smooth transitions are exactly two — night falling in the alley (SC007 → SC008) and the torch lighting in the cellars (SC201A → SC201). Every other scene change is a hard cut.
- A faithful playback runs `SceneTransition` only after `RefreshScreen` (the flag remembered at `GoToScene`). Everything else is a cut.

## The dissolve branch

1. `g_scrollX = g_bgScrollStart`, `g_renderIdle = 0` (the cursor is not drawn during the dissolve).
2. `g_bgWork = g_bigBlock`, the flag is cleared, `memmove(g_bigBlock, g_sceneBg, w·h·2 + 4)`: the **target** is the new scene's background. `g_renderToBgWork = 1`.
3. Scene objects (`g_sceneObjWasPbm16 == 0`) draw into `g_bgWork` through `Sprite_Set` (not to the screen), so the target is the background plus static objects. **No Jack, no cursor, no object animations** (the ordinary branch draws animations; this one does not).
4. The **source** is what is on screen now. `0046da60(0,0,640,480, pitch 640,0,0, g_bigBlock+1000000+4)` copies the left 640×480 of the work surface from `(0,0)` (**not** from `g_scrollX`) into `g_bigBlock+1000000` with a header `640, 480`. It contains the old background, Jack, and the objects.
5. 32 times (`local_e = 0..31`): `Timer_MarkFrameStart`; `0046e1a0(target, buffer)` — one step; `Blit_ImageToScreen(0,0,buffer)` (an ordinary copy with no color key, `0046cc70`); when the scene is `DAT_008f68d0 == 0xc9`, also `Pak_LoadFile(GLOBAL, name_i)` plus `Blit_ImageToScreen(0x130,0x3d)` — a picture from a table of 32 names of 15 bytes from `0x55b098` (zeroes in the executable file, filled at runtime; hypothesis: a loading animation); `Sys_PumpMessages` (non-zero → `Sys_FatalExit`); then `Timer_WaitSinceFrameStart(50)` for scene `0xc9`, otherwise `(100)`.
6. After the loop: `Blit_ToScreen(0,0,640,1,…, g_bigBlock+4)` copies **only the first row** of the target (a leftover). `g_renderToBgWork = 0`.

Timing: `Timer_WaitSinceFrameStart(ms)` (`0045cb80`) waits until **more than `ms/5`** ticks of 5 ms have passed, so 21 ticks ≈ **105 ms** (usual) or 11 ≈ **55 ms** (scene `0xc9`). The whole dissolve is about 3.4 s (1.8 s). During it **game logic is stopped**. Only the message pump runs.

## The mix `0046e1a0` (checked on the executable bytes)

`mix(target = param_1 + 4, current = param_2 + 4)`. The pixel count is `current.w × current.h` (the buffer header, 307200). For a pixel: `c` is current, `t` is target. Equal pixels are left alone. The word is 16-bit **RGB565**. There is no 555 variant (the masks would be wrong when `g_videoIs555` is set):

| Channel | Mask | Rule |
|---|---|---|
| red (5 bits) | `0xf800` | `c < t` → `+0x800`; `c > t` → `−0x800` |
| green (6 bits) | `0x07e0` | `c < t` → `+0x20`, and if `c+0x20 < t` another `+0x20`; `c > t` → `−0x20`, and if `t < c−0x20` another `−0x20` (so ±1 when the target is 1 step away, otherwise ±2) |
| blue (5 bits) | `0x001f` | `c < t` → `+1`; `c > t` → `−1` |

Order: red, green, blue, each on the extracted bits, so channels do not carry. There is no linear interpolation and no rounding. It is "catch the target by a fixed step". The worst case is green 63 → 0: 31 steps of 2 and one of 1 = **exactly 32**, which is why there are 32 steps. After them the picture equals the target for every pair of colors (the test `converges within 32 passes`).

**The red step is not a literal.** The code does `sub/add dx,[0x9c5490]` **twice** (a 16-bit operand; `g_targetPitch` is the pixels in a row of the work surface). At a pitch of **1024** that is `2·1024 = 0x800` (a decompiler shows `g_targetPitch * 2`). It works only because the surface happens to be 1024 pixels wide. In TS: `RED_STEP = 0x800`.

### Original bug: the target is read linearly

The loop reads the target as a flat array of 640·480 pixels from `g_bigBlock+4`, ignoring the background's width. A background 640 wide gives a good result. A wider one (most scenes are 1016) makes the target "skewed": row *r* of the buffer gets linear pixels from `r·640` of a picture whose row is 1016. Neither transition that actually runs has this. `DEK008.BM` and `DEK201.BM` are 640×480, so it is invisible in play. `SceneTransition` by default takes the left 640 columns (`flatTarget: false`). `flatTarget: true` reproduces the original.

## Engine API

- `mixStep(cur, target, count?, redStep?)` is a pure function, one step on a `Uint16Array`. It returns how many pixels still differed from the target.
- `new SceneTransition(from, to, {stepMs?, flatTarget?})` copies its inputs (640×480 from the top-left, missing pixels black). `advance(dtMs)` takes the first step immediately and later steps every `stepMs`, and returns whether the picture changed. `current` is a 640×480 surface to copy to the screen the way `Blit_ImageToScreen(0,0,…)` does. `step` and `finished` (after 32 steps and the last wait).
- Wiring: `from` is the left 640×480 of the work buffer, `to` is the new scene's background with static objects (no Jack, no cursor). Do not run scripts or draw the cursor during the dissolve. After `finished`, resume ordinary drawing. Constants: `STEP_MS = 105`, `STEP_MS_SCENE_C9 = 55`, `FADE_STEPS = 32`.

## Open

- The call from `Game_Run`: what calls `Scene_RefreshBackground` after `g_sceneChange`. That function was not recovered as one procedure.
- Where the name table `0x55b098` and the pictures of scene `0xc9` come from.
- The look on screen was not compared with a running game. Only the algorithm from the code and the executable bytes was checked.
