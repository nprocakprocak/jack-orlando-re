# The transition between scenes (the dissolve)

`Scene_RefreshBackground` `0040dff0` has a second branch that dissolves the old picture into the new one in 32 steps. Implementation: `packages/engine/src/render/transition.ts` (`mixStep`, `SceneTransition`), tests in `packages/engine/src/render/transition.test.ts`.

## When it runs

**Numbering.** `Script_ExecStep` `0041a330` does `switch (code − 1)`, so a `case N` in a listing is **command code N+1**. The name table is in `Script_CompileMacros` `00440cb0` (`"MIXING"` → `0x80`, `"REFRESHSCREEN"` → `0x81`, `"CLEARANIMABUFFER"` → `0x82`, `"GOTOSCENE"` → `0x14`).

- The dissolve is chosen by the flag **`DAT_006bd688`** (`g_mixingPending`). The macro command **`REFRESHSCREEN`** sets it (code `0x81` = `case 0x80`). `Scene_RefreshBackground` clears it. It is also zero at initialization. The name is misleading. The command refreshes nothing. It only orders a dissolve at the next `Scene_RefreshBackground`.
- `MIXING` (code `0x80` = `case 0x7f`) is a different command, not this flag. `CLEARANIMABUFFER` (code `0x82` = `case 0x81`) does `memset` of the animation buffer.
- **`GoToScene`** (code `0x14` = `case 0x13`) does not set the flag: the scene name goes to `g_sceneName`, `Sprite_Remove` of the cursor, the object sprites are removed (`00449d50`), `g_sceneChange = 1`. `Game_Run` `0042b6d0` calls `Scene_RefreshBackground`. The listing of that function is incomplete, so the order after `g_sceneChange` was read from the call sites.
- **In the game `RefreshScreen` occurs in 2 scripts, always immediately before `GoToScene`:** `SC007.MCC` (`RefreshScreen` / `GoToScene SC008`) and `SC201A.MCC` (`RefreshScreen` / `GoToScene SC201`). Only those two transitions dissolve. Every other scene change is a hard cut. Scene `0xc9` (= 201, `DAT_008f68d0` is the scene number) draws an extra picture in the loop. That is the transition SC201A → SC201.
- Play confirms it: the smooth transitions are exactly two, night falling in the alley (SC007 → SC008) and the torches lighting in the cellars (SC201A → SC201). Every other scene change is a hard cut.
- A faithful playback runs `SceneTransition` only after `RefreshScreen` (the flag remembered at `GoToScene`). Everything else is a cut.

## The dissolve branch

1. `g_scrollX = g_bgScrollStart`, `g_renderIdle = 0` (the cursor is not drawn during the dissolve).
2. `g_bgWork = g_bigBlock`, the flag is cleared, `memmove(g_bigBlock, g_sceneBg, w·h·2 + 4)`: the **target** is the new scene's background. `g_renderToBgWork = 1`.
3. Scene objects (`g_sceneObjWasPbm16 == 0`) draw into `g_bgWork` through `Sprite_Set` (not onto the screen), so the target is the background plus the static objects. **Without Jack, the cursor, or object animations** (the ordinary branch draws animations; this one does not).
4. The **source** is what is on screen now. `0046da60(0, 0, 640, 480, pitch 640, 0, 0, g_bigBlock+1000000+4)` copies the left 640×480 of the work surface from `(0, 0)` (**not** from `g_scrollX`) into the buffer `g_bigBlock+1000000` with a header `640, 480`. It contains the old background, Jack, and the objects.
5. 32 times (`local_e = 0..31`): `Timer_MarkFrameStart`; `0046e1a0(target, buffer)` is one step; `Blit_ImageToScreen(0, 0, buffer)` (an ordinary copy with no key color, `0046cc70`); for scene `DAT_008f68d0 == 0xc9` also `Pak_LoadFile(GLOBAL, name_i)` plus `Blit_ImageToScreen(0x130, 0x3d)` — a picture from a table of 32 names, 15 bytes each, from `0x55b098` (zeroes in the file, filled at runtime; a hypothesis: a "loading" animation); `Sys_PumpMessages` (non-zero → `Sys_FatalExit`); a wait `Timer_WaitSinceFrameStart(50)` for scene `0xc9`, otherwise `(100)`.
6. After the loop: `Blit_ToScreen(0, 0, 640, 1, …, g_bigBlock+4)` copies **only the first row** of the target (a leftover, a hypothesis); `g_renderToBgWork = 0`.

Timing: `Timer_WaitSinceFrameStart(ms)` (`0045cb80`) waits until **more than `ms/5`** ticks of 5 ms have passed, so 21 ticks is about **105 ms** (the usual case) or 11 ticks is about **55 ms** (scene `0xc9`). The whole thing is about 3.4 s (1.8 s). During that time **the game logic stands still**. Only the message pump runs.

## The mix `0046e1a0`, checked on the executable's bytes

`mix(target = param_1 + 4, current = param_2 + 4)`. The pixel count is `current.w × current.h` (the buffer header, 307200). For a pixel: `c` is current, `t` is the target. Equal pixels are left alone. The word is 16-bit **RGB565**. There is no 555 variant (with `g_videoIs555` the masks would be wrong):

| Channel | Mask | Rule |
|---|---|---|
| red (5 bits) | `0xf800` | `c < t` → `+0x800`; `c > t` → `−0x800` |
| green (6 bits) | `0x07e0` | `c < t` → `+0x20`, and if `c+0x20 < t` then another `+0x20`; `c > t` → `−0x20`, and if `t < c−0x20` then another `−0x20` (so ±1 when the target is 1 away, otherwise ±2) |
| blue (5 bits) | `0x001f` | `c < t` → `+1`; `c > t` → `−1` |

The order is red, green, blue, each on the extracted bits, so the channels do not carry. There is no linear interpolation and no rounding. It is "catch the target by a constant step". The worst case is green 63 → 0: 31 steps of 2 and one step of 1, which is **exactly 32**, hence 32 steps. After them the picture equals the target for every pair of colors (the test `converges within 32 passes`).

**The red step is not a literal.** The code does `sub`/`add dx, [0x9c5490]` **twice** (a 16-bit operand; `g_targetPitch` is the pixels in a row of the work surface). At a pitch of **1024** that is `2·1024 = 0x800` (a listing shows `g_targetPitch * 2`). It works only because the surface happens to be 1024 pixels wide. In TypeScript: `RED_STEP = 0x800`.

### The original reads the target linearly

The loop reads the target as a continuous array of 640·480 pixels from `g_bigBlock+4`, ignoring the width of the background picture. A background of width 640 gives a good result, but a wider one (most scenes are 1016) gives a skewed target: row *r* of the buffer gets the linear pixels from `r·640` of a picture whose row is 1016. Neither of the two transitions that actually run has this: `DEK008.BM` and `DEK201.BM` are 640×480, so it is invisible in the game. `SceneTransition` takes the left 640 columns by default (`flatTarget: false`). `flatTarget: true` reproduces the original.

## The engine API

- `mixStep(cur, target, count?, redStep?)` is a pure function, one step on a `Uint16Array`. It returns how many pixels still differed from the target.
- `new SceneTransition(from, to, {stepMs?, flatTarget?})` copies the inputs (640×480 from the top-left corner, missing pixels black). `advance(dtMs)` takes the first step at once and the later ones every `stepMs`, and returns whether the picture changed. `current` is a 640×480 `Surface16` to copy onto the screen the way `Blit_ImageToScreen(0, 0, …)` does. `step` and `finished` (after 32 steps and the last wait).
- Wiring: `from` is the left 640×480 of the work buffer, `to` is the new scene's background with the static objects (without Jack and the cursor). During the dissolve, do not run scripts and do not draw the cursor. After `finished`, resume ordinary drawing. Constants: `STEP_MS = 105`, `STEP_MS_SCENE_C9 = 55`, `FADE_STEPS = 32`.

## Not settled

- The call from `Game_Run`: what calls `Scene_RefreshBackground` after `g_sceneChange`. The function's listing is incomplete.
- Where the name table `0x55b098` and the pictures of scene `0xc9` come from.
- The look on screen was not compared with a running game. Only the algorithm from the code and the executable's bytes was.
