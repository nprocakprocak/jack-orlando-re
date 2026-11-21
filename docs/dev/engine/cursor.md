# The mouse cursor and the presentation overlay

How the original draws and switches the cursor. Code: `packages/engine/src/cursor/` (`modes.ts` for the modes, hotspots, and file names; `cursor.ts` for the animation and the decision of what to draw; `overlay.ts` for the blit onto a finished frame; `lens.ts` for the lens; `frame.ts` for the frame around an item). The mouse position and the buttons are collected before this. This note is only what happens to the cursor **after** the position is known.

## Three functions, three places

| Function | When | What it does |
|---|---|---|
| `Game_Tick14ms` `00426c10` | the timer (slot 2, about 14 ms) | decides whether the system cursor is **in the window** (`g_mouseInWindow` `0x9d1b38`). It also moves `g_mouseX` together with the scroll (±4 px per tick) |
| `Cursor_AnimateStep` `004256e0` | `Game_Run` `0042b6d0`, when `g_cursorAnimCountdown` `0x6d9820` is below 1 (reload `g_cursorAnimPeriod` `0x504798` = 2, so a step every 3rd logic tick, about 41 ms) | picks the animation frame and the picture `g_cursorImage` `0x723e20` from the mode |
| `Cursor_UpdateHotspot` `0042b0f0` | `Game_Run` | computes the click point `g_clickX/Y` (`0x551606` / `0x551604`) = the mouse plus an offset that depends on the mode. It also writes that point into two script variables. In mode 1 it composes the lens picture |
| `Cursor_DrawOnPresent` `00426370` | the hook `g_onPresent` after every presentation of a frame (`0040162c` jumps to it) | when the cursor is in the window and the game is not suspended: the hit test, the mode-switch animation, `Sprite_SetOverlay` |

The listing of `Game_Run` is incomplete. The calls of `004256e0` and `0042b0f0` are known from the call graph. Their order against the rest of the frame was not settled from that listing alone.

### What `Game_Tick14ms` does (`GetCursorPos` / `PtInRect`)

When `g_videoFlags & 1` (a window), every 3rd call: `GetWindowRect` plus `GetCursorPos`, the window rectangle shrunk by the frame and the title bar (`GetSystemMetrics` 0x1f / 0x20 / 0x21), `PtInRect`:

- **inside** → `g_mouseInWindow = 1`, `PostMessage(WM_SETCURSOR)` (the window procedure hides the system cursor);
- **outside** → `g_mouseInWindow = 0`, `WM_SETCURSOR`, and the **buttons are cleared** (`g_mouseButtons`, the left and right flags `0x9d2820` / `0x9d2824`). Releasing a button outside the window does not stick.

When `g_videoFlags & 2` (full screen) `g_mouseInWindow` is always 1. In the engine a pointer outside the canvas is `inWindow = false`. Acquiring the mouse clears the buttons.

## Drawing: an overlay, not a scene sprite

The cursor has its own sprite `g_cursorSpriteId` (`0x8ab6b4`), but it is **not in the scene's sprite list**. `Sprite_SetOverlay` `00479540` is a copy of `Sprite_Set` with its own state (`0xa31bd8` and on, its own dirty rectangle). It remembers the previous rectangle, restores the background under it, and draws the picture with color key 0 through `Render_RedrawRectOverlay` `00477c00` (the same idea as `Render_RedrawRect`: a copy of the background `g_renderBg` / `g_bgWork` into a buffer, the sprites that intersect the rectangle, then the cursor, `Blit_ImageToScreen`). The rectangle is widened to an even width of at least 4. For the engine it is enough to draw the picture on the **finished frame** (`drawCursor` in `packages/engine/src/cursor/overlay.ts`). The overlay cannot leave traces, because the renderer composes the frame from scratch.

- Position: the picture is **centered on the mouse**. The top-left corner is `mouse − (w/2, h/2)` (integer division), in world coordinates (`g_mouseX` includes the scroll).
- It is not drawn when `g_mouseInWindow` is 0 or `0x9c54a4` is not 0 (suspended). The sprite is then removed (`Sprite_Remove`). It is also not drawn until the flag `g_cursorEnabled` (`0x7cde78`, set by `00429ae0` and `Game_Main`) is set, in a condition with `0x8f6898` (the about window). Not every condition there was recognized.
- The initial picture is `WSK.BM` (`Game_Main`: `g_cursorImage` points at `DAT_0069c820`). `WSK_PLUS.BM` and `WSK_MIN.BM` are loaded beside it. Their use is unknown.

## Cursor modes (`g_cursorMode` `0x8f68f6`)

| Mode | Meaning | Pictures (from `RESOURCE.PAK`) | Hotspot = mouse + (dx, dy) |
|---|---|---|---|
| 0 | point (the default) | `WSK00`–`08` (18×25), 9 frames | (−9, −12), the top-left corner of the picture |
| 1 | look, the lens | `LUPA01`–`09` (30×30) plus `MASKA01`–`09` / `M00`–`04` (the lens shows a 1:1 fragment of the background, tinted — **it does not magnify**), `BLIR00`–`04` when over a reaction | (−4, −4) |
| 2 | strike, the fist | `FIS00`–`09` (54×38) | (−7, −10) |
| 3 | shoot, the sight | `KOLT01`–`04` (28×45) | (0, 0), the center of the picture |
| 4 | take, the hand | `HAN01`–`10` (50×33) | (−10, +8) |
| 5 | an item in hand | the item sprite's picture (`0x6d505c`) | (0, 0) |
| 10 | a zone: exit left | `LEFT001`–`015` (30×29) | (−9, −12) |
| 11 | a zone: exit right | `RIGHT01`–`15` (30×31) | (−9, −12) |
| 13 | a zone: down | `STDN0001`–`15` (14×31) | (−9, −12) |
| 14 | a zone: inside | `TOIN0001`–`15` (28×29) | (−9, −12) |
| 15 | a zone: up | `STUP0001`–`15` (16×31) | (−9, −12) |
| 17 | a zone: outside | `TOUT0001`–`15` (18×30) | (−9, −12) |
| 20 | an edge: scroll left | `SCLF0001`–`15` (32×17) | (0, 0) |
| 21 | an edge: scroll right | `SCRG0001`–`15` (30×15) | (0, 0) |
| 12, 16, 18, 19 | no picture set (the zone range 10–19 includes them) | the previous picture stays | (−9, −12) |

`Res_MakeNumberedName` in `Game_Main` (`0044d1d0`) builds the file names. The load order is the slot order, which is the frame order. A slot stride (for example `0x398` for `WSK`) is a few bytes larger than the file (904 bytes). That is the buffer size, not the format. The pictures are ordinary `.BM` RGB565, and color 0 is transparent ([bm.md](../formats/bm.md)).

The hotspot in `0042b0f0` also has a flag `0x6bc294`, which the code **never sets** (always 0 in the executable that was read). At 1, modes 4 and the defaults (5, 20, 21, and the rest) would have (−9, −12). The offset (−9, −12) for mode 0 makes the click point the **fingertip** in the top-left corner of the 18×25 picture (the picture is drawn at `mouse − (9, 12)`).

The mode (the verb) becomes a macro prefix. `Cursor_SetVerbName` `00427740` sets `g_verbName` (`0x8ab734`): 0 `POKAZANIE`, 1 `PATRZENIE`, 2 `UDERZENIE`, 3 `STRZELANIE`, 4 `BRANIE`, anything else `POKAZANIE`. Zone and object macros are named `<VERB>-<NAME>` (see [walk.md](walk.md), `Area_ClickMacro`). With an item in hand (`0x57a982`) the name tried first is `<item name>-<NAME>`, then `PIERDOLA-<NAME>`.

### What switches the mode

| Source | Effect |
|---|---|
| the verb menu `Cursor_VerbMenu` `00416780` (five captions; the last one only when `g_varValues[0x5046ec]` is 1, which is `GUN`) | pointer → 0, take → 4, strike → 2, examine → 1, the revolver → 3 |
| `Cursor_ResetMode` `00419740` (from `Game_Run` and `Script_ExecStep`, among others) | mode 0, the item leaves the hand, `g_verbName` is the point prefix |
| the script command `CURSORAS` (code `0x53`; the listing's `case` is `0x52`, because `Script_ExecStep` switches on `code − 1`) | mode 3 plus the shoot prefix (the argument is unused). Unused in the game data |
| `HAVEGUN` (`0x43`) / `NOHAVEGUN` (`0x44`) | `HAVEGUN` calls `Cursor_LoadSet2` (the cursors with the weapon). `NOHAVEGUN` calls `Cursor_LoadSet1` (the `*_1.BM` sets). Only when `g_cursorMode` is 3: the mode **and** `g_verbMode` become 0 (`Script_ExecStep`, `0041eb12`) |
| the start of a scene (`Game_Run`) | `if (g_verbMode == 0) { g_cursorMode = 0; g_cursorModePrev = 0; }`. With another verb the mode **stays** (the engine: `Cursor.sceneStart`) |
| `Cursor_EnableDraw` `00429ae0` (opening the bullet menu, `DIALOG`, `TAKE`, unlocking the player in step 21, the F2 and F3 windows) | only in mode 0: `g_verbMode = 0` and the picture `WSK`. Always `g_cursorEnabled = 1` (the engine: `enableDrawVerb` in `packages/engine/src/cursor/verb.ts`) |
| taking an item into the hand (`TAKE`, code `0x22`) | mode 5, `g_itemInHand` (`0x57a982`), `Cursor_LoadSet2`, and the start of the "growing" animation (scale 0.2, step 0.1) |
| **modes 10–21** | `Game_Run` sets them. Step 11 is the exit cursors 10, 11, 13, 14, 15, and 17 (`0042dadb`…`0042db8b`). Step 18 is the screen edge 0x14 / 0x15 (`0042fbed`, `0042fc2c`). Details are in [areas.md](areas.md) and [bulletmenu.md](bulletmenu.md) |

### The mode and the verb after a scene change

`g_cursorMode` and `g_verbMode` can drift apart. The exit arrows (step 11, [areas.md](areas.md)) require `g_verbMode == 0`, so a pointer (mode 0) with a verb other than 0 never shows them. After changing into the uniform (`SC105`, the take-uniform macro, a click with the take verb, and the macro ends the scene itself) the cursor in `SC104` was an ordinary pointer with no arrows, until the ladle was picked up. The cause: on entering a scene the engine used to call `Cursor_ResetMode` (mode 0) without the verb (it stayed 4), and opening the bullet menu cleared only the mode. According to the code:

- the start of a scene clears the mode only when `g_verbMode` is 0. After the uniform Jack has the **hand** in `SC104` (mode 4), as in the original. `g_cursorModeSaved` (`0x8f68ec`) is not cleared;
- opening the bullet menu: mode 0 plus `Cursor_EnableDraw` sets the verb to 0, so after the menu closes the arrows come back;
- step 21 (`g_cursorEnabled`): a macro that blocks the player turns the cursor off (not while the answer menu is open). The first free frame calls `Cursor_EnableDraw` (also the first frame of every scene, because the end of a scene clears the flag). Under the answer menu the engine takes the mode from before the menu.

Play confirms it: after the uniform the cursor stays the hand, and in the next scene the pointer has to be chosen from the bullet menu.

The fist from the cell SC026 stays after the chain SC024 → SC011. An exit arrow after a scene change appears only from the pointer, from a zone, or from an item.

### The cursor over the answer menu

The code does not switch the mode when the `DIALOG` menu opens (`Cursor_EnableDraw` works only in mode 0, and the animation stands still while `g_menuOpen`). The engine shows the arrow (mode 0) regardless of the mode the click was in, which matches play. See [play.md](play.md).

## Which modes concern zones

- `Cursor_IsMode10to19` `00424360`: **10–19 are the zone modes**. In `Area_ClickMacro` (`004243a0`) and in the cursor test (`00424640`), in such a mode a zone counts only if it is an **exit** (`Area_IsEnabledExit` `004242e0`: the list `g_exitAreas`, names from `g_exitAreaNames`, active according to `0x871ad8`). `Area_Contains` `00412e40` lets a zone through only when it is active (`0x871ad8`) **or** the mode is not 0 (and then it has to be enabled in `0x6aeefc`).
- Modes 20 and 21 (`SCLF` / `SCRG`) are **not** in the range 10–19. The hotspot is the ordinary one. They are the edge-scroll cursors (the scroll is drawn by `Game_Tick14ms`: ±4 px per tick, `g_scrollX`).
- The hotspot (`g_clickX/Y`) for zones is the same point as in mode 0: `mouse + (−9, −12)`. Use `Cursor.clickPoint()`, not the raw mouse position.
- The hit tests (`Cursor_HitTestSprites` `00424f10`, `Cursor_HitTestAreas` `00424640`) are called **from `Cursor_DrawOnPresent` every frame**. They check the sprites under the hotspot (a pixel other than 0 in the sprite's picture, skipping Jack's sprite `0x551558`), then the `.ACE` zones from the last to the first. They build `VERB-NAME` and ask `Macro_Exists` `0040d7d0` (the table `0x54d870`, an entry of 0x46 bytes). The result is "there is a reaction". Along the way they write `<VERB> <name>` into the status bar (`0x563f98`). In the engine the result goes to `Cursor.setTargets(overReaction, overObject)`.

## Animation (`Cursor_AnimateStep`)

`g_cursorIdle` (`0x89c6ec`): 0 means the cursor is over something that reacts to the current verb. It is computed in `Cursor_DrawOnPresent`: mode 5 means "there is some sprite under the hotspot"; modes 0–4 mean "there is a reaction"; otherwise 1. Every pattern below is implemented in `Cursor.animate`.

- **Mode 0.** Over a reaction the hand pulses 0…8…0 (it bounces at above 7 to 8, and below 1 to 0). Away from a reaction the frame follows the mouse's horizontal motion: right is +1 (max 8), left is −1 (min 0), and with no motion it drifts to 4 (`motionFrame`). The picture is `WSK` of `frame % 9`. The same logic is duplicated in `Cursor_DrawOnPresent` (every 3rd call, when `0x7c7a4c` or `0x8f68d8`).
- **Mode 1.** Over a reaction: frames 9…13 (`BLIR00`–`04`), a step every 2nd call. Away from one: the lens `LUPA` follows the mouse motion, like mode 0. `0042b0f0` composes a 30×30 lens picture (`packages/engine/src/cursor/lens.ts`):
  1. `Render_ComposeRegion` `00474ff0`: the scene background without the cursor, a rectangle the size of the mask at `mouse − 12`;
  2. `Cursor_TintLensRegion` `0046f7f0` (level 9): a pixel under a non-zero palette color of the mask moves 9/32 of the way toward that color (the glass and the glint; color 0 is transparent);
  3. `Blit_ClearRect16` `0046e080` zeroes a 30×30 buffer, and `Blit_Copy16` pastes the region at (3, 3);
  4. `Blit_Keyed16` lays the `LUPA` frame on top. The whole thing is drawn at `mouse − 15`, so the background is 1:1 under the glass.
  Over a reaction the `BLIR` frames 9…13 use the masks `M00`–`M04` (14…10 px). Away from a reaction the region follows `MASKA01` (14 px) and the mask follows the motion frame. At the left or top edge the source is clipped to 0 with no shift of the destination. **The lens does not magnify.** A face window and captions enter the lens background because they are already in the frame. Whether `Render_ComposeRegion` includes them was not checked.
- **Mode 2** (`FIS`, 10 frames): it rests on frame 4 when `g_cursorIdle` and the frame is 4. Otherwise a ping-pong 0…9, a step on 3 of 4 calls.
- **Mode 3** (`KOLT`, 4 frames): it rests on 0. A ping-pong 0…3, a step on 9 of 10 calls.
- **Mode 4** (`HAN`, 10 frames): it rests on 0 (unless `0x563f20` is not 0 and `0x8f68e0` is 0, `Cursor.takeKeepsMoving`). A ping-pong 0…9, a step on 3 of 4.
- **Mode 5:** the item's picture, with no animation. Over a place where the item can be used (`g_cursorIdle` is 0), `Game_Run` draws `RAMKA.BM` around it. The condition (`Game_Run` `0042b6d0`): `g_cursorIdle` is 0, the bar, the menu, the caption, and the bullet menu are closed, and the mode is not 0–4. Then `Sprite_Set` of the frame sprite at `mouseX − 0x18`, `mouseY − 0x14`, `RAMKA`. Otherwise the sprite stands at (0, 500). In the engine the frame is drawn **whether or not the old bar exists**. `PlayGame.create` always loads `RAMKA.BM`. `Cursor_DrawOnPresent` `00426370` sets `g_cursorIdle = 1` on the first draw after a mode change and for the whole switch zoom, so the frame appears only together with the item's picture. `TAKE` sets mode 5 at once, and during the pickup macro (the player is blocked) the cursor is not drawn. An old `g_cursorIdle` of 0 (from before the click) showed an empty frame. The engine: `Cursor.frameIdle` (idle, or a zoom in progress, or the mode is not the one last drawn) feeds `frameOverlay`. After a click with an item on a zone that has a macro `<item>-<zone>`, the player is blocked, `Cursor_DrawOnPresent` is not called (the cursor is invisible), and `g_cursorIdle` stays 0. The condition in `Game_Run` does not include the player lock, so the **original probably** draws the frame alone then (no other condition hides it; this was not checked in the game). The engine also treats `frameIdle` as true when there has been no `present()` since the previous read (the cursor was not drawn this frame). The frame appears only together with the item's picture. The getter has a side effect (it consumes the `present()` counter) and is read once per frame. In mode 5, `g_cursorIdle` is 0 when any sprite under the hotspot (a pixel or the rectangle flag, see [areas.md](areas.md)) or a zone sets `g_cursorOverReaction`.
- **Modes 10–21 (sets of 15 frames):** a ping-pong 0…14 every step, with no rest.
- While a scene is loading (`g_sceneLoadingCursor` `0xa00bde`): instead of the mode, a clock `CD00, CD02, … CD18`. `CD00`…`CD38` are loaded every 2, and the loop uses the first 10 (`frame % 10`).

### Switching a mode, the "zoom"

A change of `g_cursorMode` (different from `g_cursorModePrev` `0x8f68f8`) starts an animation in `Cursor_DrawOnPresent`. The scale (a float) goes from 1.0 down by 0.08 per presentation. Below 0.25 the step changes sign and the drawn picture becomes the new one. It grows back to 1.0 (about 20 presentations). The picture is scaled (`Cursor_BoxScale` `0046f2a0`: a destination pixel averages a block of the source over the pixels that are not 0; `zoomImage` in `overlay.ts`; the frame itself is scaled, not the composed lens) to `trunc(w·scale)`, centered on the mouse. On the last step (scale ≥ 1) nothing is drawn, and during the animation `g_cursorIdle` is 1. Picking up an item sets the scale to 0.2 and the step to +0.1 (it grows with no shrink phase). The scaler loops when the step is below 1.

Modes 10–21 are set by `Game_Run`, as above. The hit tests and the macros are in [areas.md](areas.md). The item picture in mode 5 is supplied by whoever holds the item. `Cursor_LoadSet1` and `Cursor_LoadSet2` load the sets `LUPA_*`, `PIESC_*`, `REKA_*`, `STRZA_*`, and `POCISK*`, the mode icons. Where those icons are drawn was not checked.

## A click and the highlighting of sprites

The hand's highlight (`Cursor_HitTestSprites` `00424f10`) skips sprites that have no macro, while a click in the original (`Sprite_ClickMacro` `004248d0`) stops on the first hit. That is why the spoon in SC026 can be clicked only in the exact place. The engine, a departure kept on purpose, clicks the way the cursor test does. The details are in [areas.md](areas.md).
