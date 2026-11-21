# Shadows of the other characters

A person's shadow is a darkened rectangle of the background, not a sprite built from the character's picture and not a translucent blot. Jack's shadow uses the same darkening. See [animation.md](animation.md).

Code: `packages/engine/src/persons/shadow.ts` (`PersonShadow`, `darken`, `darkenPixel`) and `packages/engine/src/scene/shadow.ts`. The original is `Person_DrawShadow` `00428d50`, `Blit_ShadowDarken` `0046eac0` (and `0046ebdc`), and `Render_ComposeRegionNoFlag` `00475760`.

## What a shadow is

`0x553438[p]` (`g_personShadowMask`) is a **destination buffer**: a header `w`, `h` (two shorts) and `w·h` pixels of RGB565. Each call of `Person_DrawShadow`:

1. Picks the **mask picture**. The default is the round `CIEN1.BM` (`0x6d38d8`). After `SETSPECSHADOW p object` (opcode `0x9a`, case `0x99`, `0x6dae74[p]` is 1, `0x722f90[p]` is the object's sprite picture) it is that object's unpacked picture.
2. Computes the scale `s = 0x8707d0[p] · 0x652110[p]` (the person's scale times field 4 of the `.PCS`), at most `0.99` (`0x4f7e9c`). Field 4 of the `.PCS` therefore multiplies both the light range and the shadow.
3. The size is `w = ftol(width·s)`, `h = ftol(height·s)`. The position is `(ftol(x − 55·s), ftol(y − 14·s))` (the shifts `0x504758` and `0x50476c`, the same as Jack's round shadow, and the same for an object's own mask).
4. Copies the **background** under the shadow into the buffer (`Render_ComposeRegionNoFlag`). Without `SHADOWONE`, only the background bitmap (layer limit `−1`). With `SHADOWONE object` (`0x7cda60` is 1, `0x7c72e8`) also the sprites up to that object's layer. It skips this person's shadow sprite and sprites with the flag `+0x1e`. The part past the left edge of the screen stays empty (column `clamp(−x0)`).
5. **Darkens** the copied background under the non-zero pixels of the mask (`Blit_ShadowDarken`). The mask is scanned with a fixed-point step `P = ftol(65535 / s)`. The integer part is `P / 0xffff` (usually 1 when `s < 1`) and the fraction is `P % 0xffff`. **The division is by `0xffff`, not by `0x10000`**, as in the original. The destination pixel goes through three color tables (`0x504ae8` the blue bytes, `0x505b68` and `0x506be8` the green and red words, level `level·0x80` bytes), at `0046ebdc`. These are **the same tables as the face window**.
6. Stores `w` and `h` in the buffer header and sets it as the picture of the sprite `g_personShadowSprite` (`Sprite_Set` with `16.0`, the last argument `0x41800000`, as for Jack. What that argument means is unknown. A hypothesis: a flag, not a scale). With `SHADOWONE` the shadow sprite is moved with `Sprite_MoveFront` in front of the sprites between it and the object.

The shadow is therefore an **opaque rectangle** (the background, darkened), not a translucent blot. The level (`0x74b8cc[p]`) is the strength. The default is 8 (the start of a scene). `SETSHADOW p n` sets it to `n`.

The sprite is added at `z` 0, under every scene sprite. The depth tests and `PUNDERE` / `POVERE` do not move it. See [render.md](render.md).

## Script commands

The number in [scripts.md](scripts.md). In the code the `case` is the opcode minus 1.

| Opcode | Command | Effect |
|---|---|---|
| `0x13` | `SETSHADOW p n` | clears both fades. `n` of 0 turns the shadow off (`0x69c7a0` is 0, and `Sprite_Remove` of the shadow sprite when shadows are on). Otherwise it is on, and `0x74b8cc` is `n`. `SETSHADOW` of Jack does not remove the second shadow. |
| `0x8b` | `MINSHADOW n p` | a fade out: `0x85e020` is 1, the counter `0x55193c` is `n−1`, the step `0x71a708` is `1/n` |
| `0x8c` | `MAXSHADOW n p` | a fade in: `0x7a844c` is 1, the counter `0x8f67fc` is 0, the limit `0x51f9e0` is `n−1`, the step `0x88f680` is `1/n` |
| `0x8f` | `SHIFTSHADOWP p dx dy` | `g_personShadowDx` / `Dy[p]`. The host adds the shift to `x` and `y` before `Person_DrawShadow` (case `0x8e`) |
| `0x9a` | `SETSPECSHADOW p object` | the object's own mask (`0x6dae74`) |
| `0x9b` | `SHOWSHADOW p x y scale` | `0x88f5d0[p]` is 1. `004190f0` places the shadow at the point, at the scale **from the argument** (no person scale, and no limit of 0.99), with the anchor `(60, 15)` instead of `(55, 14)`, at level `0x74b8cc`. It remembers `(x, y)` in `0x6d5f10` / `0x6c186c`. `p` of `EXTRA` (−1) goes to `004194c0` (the shadow of an extra sprite). |
| `0x9c` / `0x9d` | `SHADOWSTATUS p 0/1`, `HIDESHADOW p` | `0x88f5d0[p]` is 0 or 1. `HIDESHADOW` draws the shadow at `(0, 500)` and scale 1, which is off screen |
| `0x9e` | `SHADOWONE object` | compose the background together with the sprites |

The initial state: `0x69c7a0` comes from the `.PCS` header (`mode` below 2 is the mode itself, `2` means **off**, above 2 means on). The buffer is 12000 bytes, or `mode·2` bytes (the data has 800, 2100, and 11000). The game **does not check** that the shadow fits in the buffer.

`Person_DrawShadow`, when `g_shadowsOn`:

- **Normal** (`0x69c7a0`, and neither fade flag): the scale as above, the level `0x74b8cc`.
- **Fading out** (`0x69c7a0` and `0x85e020`): `s = scale·field4·counter·step`, with the counter **before** it is decremented. The shadow **shrinks and fades**. The table level falls toward 0, and level 0 does not change the color, so the fade is real. The counter decrements. Below 1, both flags (`0x85e020` and `0x69c7a0`) go out. The level is `ftol(0x74b8cc · counter · step)` with the counter **after** the decrement, so the last frame has level 0, and level 0 of the tables does not change the color.
- **Fading in** (`0x7a844c`, whether or not `0x69c7a0`): `s = scale·field4·counter·step`. The counter increments **after** the computation. When `counter` reaches the limit the flag goes out and `0x69c7a0` becomes 1. The level does not change. The first frame has `s` of 0 (a width of 0, so `Blit_ShadowDarken` returns at once, `w < 1`).

Jack (`0x66`) has his own fade variables. See [animation.md](animation.md).

In play, a fallen figure whose shadow was set with `SetSpecShadow` and `ShowShadow` has a shadow in the shape of that object's picture. A person whose mask is one object picture has no animation of the shadow. It moves with the person, shifted by `ShiftShadowP`.

`ANIMASHADOW` outside Jack is dead. A walk shadow is one frame ahead of the pose. A turn's shadow is taken from uninitialized storage.

## The engine

`PersonShadow(mode)` is the state of one person: `setShadow`, `fadeOut`, `fadeIn`, `useObjectMask`, `reset`. `draw(shadowsOn, input)` returns a `ShadowDraw` (the size, the position, the level, the steps, and the parameters of the background copy) or `null`. `darken(backdrop, draw, mask, tables)` is `Blit_ShadowDarken` on a `w×h` buffer and an `Image16` mask. `PersonShadow.show(input, scale)` is `ShowShadow`. `shadowEnabledByMode` and `maskBufferPixels` match the header rule.

The scene player draws the shadow after the person's frame, at `z` 0. `SETSHADOW`, `MINSHADOW`, `MAXSHADOW`, `SHIFTSHADOWP`, `SETSPECSHADOW`, `SHOWSHADOW`, `HIDESHADOW`, and `SHADOWONE` go through the host. A script shadow of an object (not a person) is the same darkening, placed by the object commands in `packages/engine/src/scene/`.
