# Sprites and the renderer

How the original draws a scene: the sprite list, the redraw of dirty rectangles, the blitters, clipping, and scrolling. Implementation: `packages/engine/src/render/` (`renderer.ts`, `sprites.ts`, `surface.ts`, `present.ts`).

## Summary

- The game draws to **one work surface of 1024×480** (`g_ddsTarget` `0x9c5480`; in a window that is the work buffer, locked by `Video_LockTarget` `00451a90`: the pixels are `0x9c54a0`, and the pitch divided by 2 is `0x9c5490`). The screen shows a window of 640×480 from `g_scrollX` (`Video_Present` `00452310`).
- It is a **dirty-rectangle** renderer. There is no redraw of the whole frame. Every change of a sprite (`Sprite_Set`, `Sprite_Move`, `Sprite_Remove`, and the rest) immediately redraws the rectangle of the old position and of the new one: the background plus every overlapping sprite, in list order, composed in a temporary buffer and copied onto the surface (`Render_RedrawRect` `00475ee0`).
- The draw order is **the order of the list, sorted ascending by `z`** (not by Y. If the game sorts persons by Y, it does it by giving them a `z`. That was not traced). Among equal `z`, a newer sprite is inserted **before** the older ones, so it draws under them (`00479a20`).
- Clipping: every sprite has its own clip rectangle, by default `(0, 0, 1016, 480)`. 1016 is `0x3f8`, the greatest width of a scene background (22 backgrounds `DEK*.BM` are 1016×480, and none is wider). Scrolling runs `0..376` (`376 = 1016 − 640`), in steps of 4 px.

## The sprite list

`g_sprites` `0xb2add0`, 100 slots of `0x28` bytes (the list ends where `0xb2bd70` begins; `Render_RedrawAll` walks 100 slots). The count is `g_spriteCount` `0xb2bd7c`. The id counter is `g_spriteNextId` `0xb2bd80`.

| Offset | Type | Field | Set by |
|---|---|---|---|
| `+0x00` | u16 | the id (from the counter `0xb2bd80`, growing by 1) | `Sprite_Add` |
| `+0x02` / `+0x04` | s16 | x, y of the rectangle last drawn (coordinates of the 1024×480 buffer) | `Sprite_Set` |
| `+0x06` / `+0x08` | s16 | w, h of that rectangle (after scaling) | `Sprite_Set` |
| `+0x0a` | s16 | `z`, the sort key | `Sprite_Add` |
| `+0x0c` | s16 | the kind: `0x10` a 16-bit picture, `8` a scaled 8-bit picture, `0x12` a raw 16-bit buffer | `Sprite_Add`, `Sprite_AddRaw` |
| `+0x0e` | s16 | visible: 0 after adding and after `Sprite_Remove`, 1 after the first `Sprite_Set` | |
| `+0x10` | u16 | the scale step, the fraction (16.16) | `Sprite_Set` |
| `+0x12` | s16 | the step, the integer part. **Negative means a horizontal mirror** | `Sprite_Set` |
| `+0x14`…`+0x1a` | s16 ×4 | the clip rectangle: left, top, right, bottom (right and bottom are exclusive) | `Sprite_Add` |
| `+0x1c` | s16 | the row width (the stride) of the buffer, only kind `0x12` | `Sprite_AddRaw` |
| `+0x1e` | s16 | a flag from `Sprite_Add`. `Render_ComposeRegionNoFlag` `00475760` skips such sprites | |
| `+0x20` | float | the scale last given (with its sign) | `Sprite_Add`, `Sprite_Set` |
| `+0x24` | pointer | the picture: `u16 w, h` plus the pixels (16-bit), or an unpacked `.PBM` (8-bit, the palette from `+4`, the pixels from `+0x104`) | |

The arguments of `Sprite_Add` are the **whole clip rectangle** `left, top, right, bottom`. The position is given only by `Sprite_Set` (`00479a20`, the store to `+0x14`…`+0x1a`, and the functions `00474a70`…`00474c50`). Calls of `Sprite_Add` in the parts that were listed (`Game_Run` itself was not fully listed):

- The UI and the menus (`Game_Main`, `Launcher_Run`, `0040af60`, `0040bf90`, `0040c940`, `00429dd0`): scale `16.0`, clip `(0, 0, 0x3f8, 0x1e0)`, `z` from `0x12` to `2000` (for example `Game_Main` uses `z = 1999` and `z = 2000` for the animation at `0x723e20`, the frames `CD00`…`CD38.BM`).
- **Scene objects** (`00449c00`, while a scene loads): `Sprite_Add(picture[i], z = i, …)`. `z` is the **object's number in the scene**. The scale is `16.0` when the object's type (`0x652158[i]`) is `0x10`, otherwise `0x57a988[i]` (an 8-bit object). The clip is shared for the scene, from `0x88f4bc`, `0x88f63e`, `0x88f4c8`, `0x88f644` (L, T, R, B). The id goes to `0x54b278[i]`. The positions are given later by `Scene_RefreshBackground` (`Sprite_Set` from `0x7c1258[i]` and `0x7c7320[i]`).
- **A refresh after `[PRE]`.** `CHWINDOW` (`Sprite_SetClip` `0047ab30`) only stores the clip rectangle. It does not redraw, and a later `Sprite_Set` in the same place redraws only the area inside the clip. An object drawn at the point from the `.CCG` before `[PRE]` would therefore leave a ghost outside the window. The original composes the scene from scratch (a `Blit_ImageToScreen` of the background, plus `Sprite_Set` of the objects with the current positions and clips). The engine does that on a `CHWINDOW` in `[PRE]` (before the first tick: `ScenePlayer.setClip` then `refreshBackground`, which is `Renderer.redrawAll`). During the scene a clip redraws nothing, as in the original. It mattered for SC000 (a paper on the right wall, whose sprite should emerge from an animation behind the wall) and SC000B (the inspector's car, which was drawn on the wall of the alley and should drive in from the edge of the window). The store of the clip is in the code. The order "refresh after `[PRE]`" is a conclusion, because `Game_Run` was not fully listed, and it matches play.
- Only objects whose type is not `−8` and that have no `.ACI` animation get a sprite (with an animation, the sprite is the animation's frame at `x + dx`). Type `−8` stays invisible until an animation step shows it ([shadows.md](shadows.md)).
- **Shadows** (`Game_Run` `0042b6d0`): `Sprite_Add(…, z = 0, …)` after the objects, so **under every** scene sprite (two shadows for Jack and one per person). The depth test and `PUNDERE` / `POVERE` do not move them.

### Functions

| Address | Name | What it does |
|---|---|---|
| `00479a20` | `Sprite_Add(img, z, scale, clipL, clipT, clipR, clipB, flag)` | inserts before the first element with `z` at or above the new `z` (`memmove` of the rest). The kind is `0x10` when `scale` equals `16.0` (a bit compare with `0x41800000`), otherwise `8`. Invisible. Returns the id |
| `00479c60` | `Sprite_AddRaw(buf, z, w, h, stride)` | kind `0x12`, the default clip, `w` and `h` written at once to `+0x06` / `+0x08`. Used by `Gui_CreateWindow` and the GUI windows |
| `00478910` | `Sprite_Set(id, x, y, img, scale)` | below |
| `00479e80` | `Sprite_Move(id, x, y)` | like `Sprite_Set`, with no change of the picture, the size, or the step. On the "two rectangles" path it does not clip them to `0x3f8` / `0x1e0` |
| `0047abc0` | `Sprite_Remove(id)` | **hides** it (the sprite stays on the list). Redraws its rectangle without itself. `+0x0e = 0` |
| `0047ad40` | `Sprite_Show(id)` | `+0x0e = 1`, and redraws the remembered rectangle with itself |
| `0047a530` | `Sprite_Delete(id)` | like `Sprite_Remove` (if it is visible), then removes it from the list |
| `00478fa0` | `Sprite_Refresh(index)` | redraws the sprite in place (no store of the state) |
| `0047af40` | `Render_RedrawAll(zLimit)` | `Blit_ImageToScreen(0, 0, g_renderBg)`, then `Sprite_Refresh` of every visible sprite with `z < zLimit + 2000` (kind `0x12` goes through `0047a200`, which was not taken apart). Called by `Game_Run`, `Sys_PumpMessages`, and `Video_OnSurfacesRestored` |
| `0047b010` / `0047b0d0` | `Sprite_HideWorld` / `Sprite_RestoreWorld` | sprites with `z < 2000` (not `0x12`) get `y = 700` (off screen), or come back. `z` at or above 2000 stays. A hypothesis: the UI layer |
| `00478890` | `Sprite_FindIndex(id)` | the index, or −1. Every function that takes an id ignores an unknown id |

### `Sprite_Set` `00478910`

1. `scale < 0` means a mirror, and the rest uses `|scale|`.
2. Kind 8 and `scale == 16.0`: "keep the scale". When the sprite is visible, the scale is recovered from the stored step: `s = 65536.0 / ((s16)int << 16 + (s16)frac)` (`00478a1d`…`00478a78`, omitted from a listing), then `s > 1` becomes `1.0` and `s < 0.05` becomes `0.05`. Both halves are read signed (`movsx`), so for `frac` at or above `0x8000` (for example a scale of 0.6) the result is `s > 1` and becomes 1.0, and for a mirrored sprite (a negative integer part) it becomes 0.05. That is an original bug, reproduced in `keptScale()`. When the sprite is invisible: the step is `1.0` and the scale is `1.0`.
3. The size: kind 8 is `w = trunc(img.w × s)`, `h = trunc(img.h × s)`. The others take `w` and `h` from the picture's header, and `s` is 1.
4. The step: `v = trunc(65535.0 / s)` (`0x4f7464` is 65535.0), `frac = v % 0xffff`, `int = v / 0xffff` times the sign. The divisor is **`0xffff`, not `0x10000`**. A scale of 0.75 gives the step `1:21845`, which is 87381/65536. `s` is a `float` (hence `Math.fround`).
5. The first show (`+0x0e` is 0): the old rectangle is `(x, y, 0, 0)`, and `+0x0e` becomes 1.
6. The union of the old rectangle and the new one, clipped to the sprite's clip (`Render_Clamp*` `00474a70` / `b10` / `bb0` / `c50`). Every clip sets `g_renderClipped` `0xa00bf4`.
7. If `|Δx|` is at most `(new_x < old_x ? new width : old width)`, and the same vertically, one `Render_RedrawRect(the union, drawCurrent = 1)`. Otherwise two: the new rectangle (with the current sprite) and the old one (without), both limited to `[clip.left, min(·, 0x3f8)]` by `[clip.top, min(·, 0x1e0)]`.
8. Store `x, y, w, h`, the step, and the picture into the list element.

`g_renderEnabled` `0x51b56d` (a byte, 1 in the data, never written) gates step 7. In practice it is always on.

## `Render_RedrawRect(L, T, R, B, drawCurrent)` `00475ee0`

The current sprite: the index `g_spriteCurrent` `0xb2bd72`. Its new state is in `0xa00cc2` / `cc4` (x, y), `0xa00bee` / `bd8` (w, h), `0xa00bdc` / `bda` (the step), `0xa00e90` (the picture), and `0xa00be4` / `be8` (the shift inside the rectangle: `new x − old x`, negatives clamped to 0 by the blitter; 0 on the "two rectangles" path).

1. `w = R − L`, `h = B − T`. Nothing when either is ≤ 0. An odd `w` becomes `w+1, R+1`. While `w < 4`, `w+1, R+1`. Then `w = min(w, the background's width)` (`R` is unchanged).
2. If the current sprite is not kind `0x12`, or it is visible: a copy of the background rectangle `g_renderBg` `0xb2bd74` (that is `g_sceneBg`, set by `Scene_Load`) into the buffer `g_renderScratch` `0xa36b90` with a row width of `w` (`Blit_Copy16` `0046dd50`), then **the sprites with an index below the current one**, visible and overlapping the rectangle.
3. The current sprite (when `drawCurrent`), from the new state. When `g_renderClipped`, the intersection with its clip. Otherwise the whole sprite, at `(be4, be8)`, and, when `g_softEdges` `0x503b70` (initially 1; `0040bf90`, `0040c550`, and `0040c940` clear it for a moment), **edge softening** (`Blit_SoftenEdges` `00470500`; for kind 8 only when `w × h < 100000`, on a copy of the sprite drawn to `0xa00e9c`; never for `0x12`).
4. **Sprites with an index above** the current one, up to the one before the last, and only kinds `0x10` and `8` (kind `0x12`, the GUI windows, is not drawn above the current sprite).
5. **The last sprite of the list**, separately: only when it is not the current one, it is visible, and it is kind `0x10` (an 8-bit last sprite is not refreshed when something changes under it).
6. The temporary buffer goes to the surface at `(L, T)` (`Blit_ToScreen` `0046db00`, then `0046d000` for 565 and `0046d120` for 555), or to `g_bgWork` when `g_renderToBgWork` `0xb2bd7e` (`Scene_RefreshBackground` `0040dff0` composes the scene that way for the transition).

Drawing another sprite: the intersection test is `max(x, clipL) < R && min(x+w, clipR) > L` (and the same vertically). The visible part is `ix = max(L, x, clipL)`, `vw = min(x+w, R, clipR) − ix`, and the destination is `(ix − L, iy − T)`. When `drawCurrent`, the id of every sprite that was drawn goes to `g_renderTouched` `0xa00cd0` (the count is `0xa00cc0`; `00415960` refers to them, and that was not taken apart).

During a redraw `g_renderIdle` `0x51b56c` is 0 (`Cursor_DrawOnPresent` checks it, among others).

### Consequences

- The picture on the surface always equals the composition "background plus the visible sprites in list order", with exceptions: point 5 (an 8-bit last sprite), point 4 (windows of kind `0x12`), and the softening (only the sprite that just changed is softened; when someone else redraws it, the edges go back to sharp). A test of random updates against a full composition checks that equivalence.
- There is no separate "frame". The tempo of the picture is set by the logic (a 15 ms tick), and the presentation copies whatever is on the surface.

## Blitters

| Address | Name | What it does |
|---|---|---|
| `0046dd50` | `Blit_Copy16(sx, sy, w, h, srcStride, src, dx, dy, dstStride, dst)` | a copy of a 16-bit block |
| `0046de50` | `Blit_Keyed16` (the same arguments) | the same, skipping color 0 |
| `0046d250` | `Blit_Rgb565Keyed(dx, dy, w, h, srcStride, sx, sy, src)` | a copy with color key 0 onto the locked surface |
| `0046d000` | `Blit_ToScreen565` | the same with no key (by dwords) |
| `0046ee70` | `Blit_Pal8Keyed(w, h, frac, int, sx, sy, img, dstStride, dx, dy, dst)` | an 8-bit scale with a mirror, skipping color 0 |
| `00470500` | `Blit_SoftenEdges(w, h, sprite, dx, dy, dstStride, dst)` | edge softening |

All of them clamp **negative** coordinates to 0 (`if (v < 1) v = 0`) and do not check the right or the bottom edge.

**The scale `0046ee70`.** The step is `k = |int| · 65536 + frac` (16.16). Destination column `c` (from 0) reads source column `floor(k · m / 65536)`, where `m = sx + c`, and with a mirror (`int < 0`) `m = sx + w − 1 − c`. The accumulator starts at `k · (sx + w − 1)` and subtracts `k` (a borrow is an extra pixel). Rows are the same, with no mirror. The color is `*(u16 *)(img + 4 + the byte)`, and 0 is skipped. With a mirror and a clip, `sx` is counted from the **right** edge of the sprite: `sx = (x + w) − min(x + w, R, clipR)`. For the current sprite on the clipped path the original chooses that formula when `int < 1` (not `< 0`). The difference matters only for a scale above 1, which the game does not use (the recovered scale is limited to 1.0). That last point is a hypothesis.

**The softening `00470500`** (`00470500`…`00470731`). For every opaque pixel of the sprite that is at least 2 px from its edge:

- if the left or the right neighbor in the sprite is 0, soften the destination pixel, and also soften the destination pixel in the place of each transparent neighbor;
- the same vertically, but the upper neighbor counts as transparent only when it **and the pixel to its right** are 0 (a `dword` compare instead of a `word`, at `004705f8`).

Softening a pixel `P` (`00470646`), separately for the fields `0xf800`, `0x07e0`, and `0x001f`: `P = ((the sum of the 4 diagonal neighbors >> 2) + P) >> 1`, masked. It works in place, in scan order (later pixels see the results of earlier ones). The effect: sprites (mostly a person in motion) have slightly blurred outlines against the background.

## Scrolling

- `g_scrollX` `0x9c5494` (plus `g_scrollY`, always 0 in the game) is the start of the 640×480 window in the buffer. The window procedure adds it to the mouse position.
- Script commands in `Script_ExecStep` `0041a330` (the case is the code minus 1): `SETSHIFTX` `0x2b` sets the scroll (below 0 becomes 0, above 376 becomes 376, otherwise down to a multiple of 4). `SCROLLLEFT` / `SCROLLRIGHT` `0x2f` / `0x30` set the direction to −1 or +1 (`0x55347c`). `SETSCROLLX1` `0x31` is the minimum (`0x8f68e8`, below 0 becomes 0, down to 4). `SETSCROLLX2` `0x32` is the maximum (`0x504686`, above 376 becomes 376, down to 4).
- **The limit when a scene loads** (`Scene_LoadCcg` `004486d0`): a background marked `+` in the `.CCG` (`g_bgWide`) gets `g_bgScrollMax = width − 640`, down to a multiple of 4, at most `0x178`. Other scenes stay at `0x178`. Only `SETSCROLLX2` changes that. The engine: `initialScrollMax` (`packages/engine/src/scene/scroll.ts`). A limit that was always 376 made SC010 (`DEK010.BM`, 872 px, the limit is 232) scroll past the end of the background (a black band).
- The timer tick `Game_Tick14ms` (`00426c10`): with direction +1 and `scroll < max`, add 4 (the mouse too). With −1 and `min < scroll`, subtract 4. The condition is `0x8a7c62`.
- The flag `DAT_00870cf8` means "the view moved on this tick". The edge cursor reads it (`packages/engine/src/play/edgescroll.ts`), and so does **`SHOWFACE`**, which waits while the view is moving (`Script_ExecStep` case `0x17`, [dialog.md](dialog.md)).
- `Scene_RefreshBackground` sets `g_scrollX` from `0x6da628` (the position stored by `SETSHIFTX`).

## The engine

| File | Contents |
|---|---|
| `packages/engine/src/render/surface.ts` | `Surface16` (RGB565, an optional stride; `Image16` from the BM and PBM decoders fits), `blitCopy`, `blitKeyed`, `blitScaled` (`0046ee70`), `softenEdges` (`00470500`), `windowToRgba` |
| `packages/engine/src/render/sprites.ts` | `SpriteList` (insertion by `z`, ids, a limit of 100), `stepForScale`, `keptScale`, the constants |
| `packages/engine/src/render/renderer.ts` | `Renderer`: `add`, `addRaw`, `set`, `move`, `hide`, `show`, `remove`, `refresh`, `redrawAll`. The functions above, with a 1024×480 frame buffer |
| `packages/engine/src/render/present.ts` | `presentRgba(fb, scrollX)` (a 640×480 window to RGBA), `alignScroll`, `scrollLimits`, `scrollTick`, `screenToBuffer` |

The API takes finished pictures (`decodeBm` / `decodePbm`) and positions. 8-bit pictures are passed after the palette has been applied. That is equivalent, because the original also checks the color value, not the index.

Departures, on purpose (in these places the original reads or writes past the buffer, or uses unspecified data):

- pixels outside the surface or the picture are skipped (the original does not check the right or the bottom edge; a rectangle can run past a background that is narrower than `L + w`);
- for an invisible current sprite of kind `0x12` the background is copied (the original leaves the previous contents in the temporary buffer);
- `Render_ComposeRegion`, the overlay path, mode 555, and the write to `g_bgWork` are only partly covered. The dissolve uses `packages/engine/src/render/transition.ts`. The cursor overlay is `packages/engine/src/cursor/overlay.ts`.

A picture in a scene archive is decoded by the object's type in the scene file (`8` or `-8` means a PBM) or by the contents, not by the extension (`decodeSceneImage`, [scene.md](../formats/scene.md)). Files whose names do not end in `.BM` used to go to the BM decoder, the exception was swallowed, and the object did not exist. The doors of SC011 were that case.

## Tests

`packages/engine/src/render` tests cover the blitters (color key 0, the stride, clipping, the step `0xffff`, a mirror with a shift), the softening (values computed by hand, the dword test), the list (the order at equal `z`, the limit), the scale (`fround`, the `keptScale` bugs), the dirty rectangle (the width rounded up, only the rectangle is overwritten), hiding, showing, and deleting, the clip of 1016 and a custom clip, the quirks (an 8-bit last sprite, windows of kind `0x12`, softening only the current sprite), and random sequences compared with a full composition. The tests build their own bytes.

## SC087: the guard's body under the cornice

After the guard is stunned, the engine used to show the body in full above the cornice `GZYMS.PBM`, and only the macro that ties the anchor covered it. In the original the body is partly hidden by the cornice. The cause was **not** the order of the objects:

- The body visible just after the blow is the **last frame of the insertion `JACKUDERZ2`** (`JKUD33.PBM`, 90×84, Jack and the fallen guard in one picture), not the object `LEZYG.PBM`. After the insertion nothing draws Jack again (`g_jackMoving` is set only by `Jack_WalkToPoint`, and `Script_Stay` `0041a140` draws a pose only on a move or a turn), so the frame stays on screen. `SETPOSITIONE LEZYG` lays the object (`z` is 7) **under** the cornice (`z` is 8; `Scene_AddObjectSprites` `00449c00`, and `Sprite_Set` does not move the list), and nobody sees it, because Jack lies above them.
- `POVERE JACK GZYMS.PBM` in the shoot macro puts Jack above the cornice, but **after every frame of Jack's insertion** `Game_Run` (the block at `0043331f`) places him against the overlapping sprites. For an object with a quad, only two edge tests (`Depth_AboveQuadEdge` `004032c0`, `Depth_BelowQuadEdge` `004034f0`, with no all-below or all-above test). For a person, by `y`. The block runs when `DAT_00851d03` (`SETCHKPRIOR JACK`, 1 at the start of a scene) is not 0. Jack at `(302, 100)` stands above every edge of the quad of `GZYMS.PBM`, so he is "behind", and `Sprite_MoveBack` moves him just under the cornice. From the first frame of `JACKUDERZ2` the frame with the body is therefore under the cornice, and its lower part is hidden.
- The engine used to do this only after a walk step and a turn frame, not after an insertion frame (`ScenePlayer.jackTick`). The correction is `arrangeJack(true)` after an insertion frame (the edge tests, as in `personObjectDepth`) and the flag `jackCheckDepth` for `SETCHKPRIOR JACK` (`Script_ExecStep` case `0x33`; all three of Jack's blocks in `Game_Run` are gated by it). `packages/engine/src/play/host.ts` passes the flag. `SETCHKPRIOR JACK` used to be skipped.
