# Scene persons

How the original walks and draws the other characters, and how it plays an `.ICS` insertion on them. The file format is [scene.md](../formats/scene.md) (`Scene_LoadPcs` `0044a000`). Jack's animations are [animation.md](animation.md). Jack's walk is [walk.md](walk.md). Persons use the same ideas (a hot spot, a scale from the perspective, brightness from the lights, volume from the position) and **their own tables**. They do not share Jack's code.

Code: `packages/engine/src/persons/` (`persons.ts` is `ScenePerson` and `ScenePersons`, `depth.ts` is the draw order, `avoid.ts` is the step aside, `shadow.ts` is the shadow).

## Data

Persons live in tables by index (up to 17. `00449db0` clears 17×8×18 frame pointers). A scene has at most 9 (155 persons in 64 scenes, 1850 frames).

- **Frames:** `0x851de0[person][direction 0..7][frame 0..17]`, pointers to `.PBM` files from the scene archive. Hot spots `0x7ca0d8[person][direction][frame]` are **3 shorts**, `(xRight, xLeft, y)`, from a line that names the file and three numbers (`0044a401`…`0044a456`). The third number in the `.PCS` is therefore **the y of the anchor (the feet)**, not a depth.
- For 1747 of 1850 frames, `xRight + xLeft` equals the picture width, as for Jack. The exceptions are 64 bird frames (`0 0 0`, so the bird's position is the top-left corner) and 39 that were placed by hand.
- The header `[NAME] n frames mode scale flag` (`0044a000`): `frames` goes to `0x7bf570` (frames per direction, the wrap of the counter). `mode` below 2 means a shadow-mask buffer of 12000 bytes, otherwise `mode·2` bytes (`0x553438`. The data has 800, 2100, 11000, and 12000). `scale` (a float, `0x652110`) **multiplies the light range**, not the picture scale (`1.0` for 78 of 155 persons). `flag` (`0x7cde84`) picks a draw through a pre-scaled picture (`0046f4c0`). The picture on screen is the same.
- Defaults at the start of a scene (`0042c568`…`0042c6af`): depth checking is on (`0x7cdecc` is 1), and the walk effects `0x8713f8[person][frame]` are −1. The position, the scale, the direction, the delay, and the speed are zeros from BSS until the first `SETPOSITION` or `SETPERSONDATA`. A person with no `SETPERSONDATA` has speed 0 and delay 0.

Most persons are drawn from one profile and a mirror.

## Script commands

A person in the interpreter is an index. `Script_FindPerson` `00412980`. `JACK` is `0x66`. Otherwise it is the **first** `.PCS` person of that name (`strcmp` from index 0). A missing name is −1. `Scene_LoadPcs` does not check for repeats. The only duplicate in the game is **SC083**, which has two `[GANGSTER]` sections. The script always hits the first. The second is unreachable. The engine used to keep the **last** (`Map.set` in a loop), so the gangster who walks out from behind the corner was drawn with the other section's frames, at half the size. `ScenePersons.find` keeps the first.

| Command | What it does |
|---|---|
| `SETPOSITION p x y` | `x` and `y` as floats. The scale is `(y−horizon)·refScale/(refY−horizon)`, clamped to **0.1…1**, unless `f` is 3.0 (`0x7bf6d4`). At `f` of 2.0 the scale is 1. `setPosition` |
| `SETPERSONDATA p n1 f n2 n3` | `n1` is the delay `0x8a7c38` (15 ms ticks). `n2` is `refY` `0x534888`. `n3` is the step length `0x8a2bc4`. `f` of 3.0 means the scale is not recomputed on a walk step. `f` of 2.0 means the scale is 1. Otherwise `refScale` is `f` and the scale is recomputed **with no clamp**. `setPersonData` |
| `SETPERSPY p y` | the person's horizon `0x69ea0c` (the default is the scene horizon). `setHorizon` |
| `MOVEP p dx dy` | `x += dx`, `y += dy` (float). `movePosition` |
| `WALKTO p x y` / `WALKTODIR` | `Person_StartWalk` `00412a30`. `0x8ab798[p]` is the macro. With `-` the macro waits. `startWalk(x, y, forced?)` |
| `RUNINSERTION p name f dir` (case 7, `0041b8f8`) | `Ins_Find` sets the frame range `0x89792c[p]`…`0x871b7c[p]` (the end is exclusive). `0x7cdf10` is 1. `0x534fe8[p]` is the macro. With `-`, `runnable` is 0 and `pending` increments. Direction 0 is +1, 1 is −1, 2 turns the person around. **It does not touch the scale `0x8707d0` or the counter `0x5640d8`.** The insertion keeps the scale from the last `SETPOSITION`, `SETPERSONDATA`, walk step, or `INITFIRST`, including after a `MOVEP`, and the first frame waits on the counter the last step left. `startInsertion(ins, dir)` |
| `INITFIRST p name dir` (case 2, `0041a8de`) | like `RUNINSERTION`, with no wait and no macro counter (`g_insReleaseEarly`, [frame.md](frame.md)). It **clears** the counter `0x5640d8` and recomputes the scale from `y` the way `SETPOSITION` does (clamped to 0.1…1, **1.0** when `f` is 2.0, and it does not check the flag `f` of 3.0). `startInsertion(ins, dir, true)` |
| `SETFRAME p k mode` | the frame `0x8a2658`. Mode 2: `k` when the facing is +1, otherwise `(k+6) mod 12`. Mode 4 is the same with the previous facing `0x8711b4`. `setFrame` |
| `SHOWFRAME p k` | `0x88f4a8` is 1, frame `k`. One drawing step, with no movement. `show` |
| `SETDIRWALK p v` | `0x88f664` is `v`. The frames run backward. `reverse` |
| `WALKEFFECT p frame sound … vol` | `0x8713f8[p][frame]` is a scene-sound slot, `0x6daa18` is the volume. `n` below 1 clears it. The second argument is not what an earlier reading thought. `setWalkEffect` |
| the shadow shift (case `0x8e`) | `0x851d08[p]` is dx, `0x851d34[p]` is dy of the shadow from the feet |
| `SETCHKPRIOR p v` | `0x7cdecc[p]` is `v`. Whether the draw order is checked. `checkDepth` |
| `CHKDISTANCE p v` | `0x6c1894[p]`. On every step, `0042a7f0(x, y, p)`. Jack stops or steps aside when the person walks too close. See [avoid.md](avoid.md). `checkDistance` |
| `HIDE p` | `Sprite_Remove` of the sprite `0x7cdea8[p]` and of the shadow `0x7bf0b4[p]` |

`RELATIVEMULP` writes a scale the later code does not read for Jack, and writes the person's light scale.

## Starting a walk: `Person_StartWalk` `00412a30`

1. The goal is stored as shorts (`0x722df4` / `0x722f04`). `0x55b080` is 1. The previous facing `0x8711b4` becomes `0x723854`, and the facing `0x723854` becomes 1.
2. The angle is Jack's angle: `atan(((cy − y)/0.3)/(cx − x))`, plus `3.141592` when `cx < x`, in integer degrees (`walkAngle`, the same function. `0.3` is `g_walkYSquash`).
3. The sector is not Jack's. There are 8 directions. The first `k` with `bounds[k] ≤ angle ≤ bounds[k+1]`. The bounds are `22 67 112 157 202 248 292 338`, and past them a read of the neighboring table gives `15408` (`0x504738` read as shorts). The direction is `(k + 7) & 7`. Angles 0…21° match no sector and give **6**, as if `k` were 7. The bounds are shared (an angle of 67 is sector 7, not 0). `forced` (`WALKTODIR`) uses the value from `g_walkDirForcedValue` as a direction number 0..7.
4. The directions: 0 faces the viewer (down), 1 is down-left, 2 is left, 3 is up-left, 4 is the back (up), 5 is up-right, 6 is right, 7 is down-right. The angle grows toward the bottom of the screen.
5. When the person has frames for that direction, it is used. Otherwise the replacement table `0x504710` (8 rows of 5, `100` means skip, a **negative** value means use `|v|` with a mirror, `0x723854` is −1):

  `0:[1,7] 1:[−7,0,2,−6] 2:[−6,1,3,−5,−7] 3:[−5,2,4,−6] 4:[3,5] 5:[−3,4,6,−2] 6:[−2,5,7,−1,−3] 7:[−1,0,6,−2]`

  That is why 69 persons have only direction 2 (left, and right is the mirror) and 19 have only 6. When nothing matches, the direction **stays the previous one** (facing 1). In the data, 139 of 155 persons have no frames for some angle, and the game then draws the old direction.
6. The speed: `vx = cos(angle)·n3`, `vy = sin(angle)·n3·0.3` (the angle in radians, stored as float32). `0x8711e0` and `0x79deec` are 10000 (distance markers the loop **does not read**).

The walk-speed option applies only to Jack. A person's speed is whatever `SETPERSONDATA` gave. Jack ignores a speed change in SC083.

## A walk step (`Game_Run` `00433d96`…`00435150`)

For each person `i` below `0x6d504e`, every frame of `Game_Run`:

- **The condition:** `(0x55b080 and 0x5640d8 ≤ 0 and not 0x7cdf10) or 0x88f4a8`. An insertion holds the walk, unless `SHOWFRAME` is set. The counter `0x5640d8` falls in `Game_TimerTick` (`00426990`, every 15 ms tick, beside the `.ACI` counters) down to 0.
- The frame is `0x8a2658`. The counter reloads to the delay. `|dx|` is `|ftol(x−cx)|`, `|dy|` is `|ftol(y−cy)|`.
- **Arrival:** `|dx| < 10` and `|dy| < 5` and not `SHOWFRAME` clears `0x55b080`, sets `0x79deec` and `0x8711e0` to 10000, decrements `g_macroPending[0x8ab798[i]]`, and at 0 or below sets `g_macroRunnable` to 1. **The step still runs** (the person moves once more and draws a frame).
- **The scale:** `0x8a1770` means 1. Otherwise, when `0x7bf6d4` is clear, `(y−horizon)·refScale/(refY−horizon)`, clamped to **0.01…1**. `SETPOSITION` clamps to 0.1. That difference is in the original.
- **The move** (when not `SHOWFRAME`): `x += vx·scale`, `y += vy·scale` (float32). When `0x6c1894[i]` is set (and not `0x6bb278`), `0042a7f0` runs. See [avoid.md](avoid.md).
- **The light** is Jack's light ([animation.md](animation.md)): the nearest source, `dy` times 3, the range is `trunc(scale·300·pcsScale)`, the brightness is `g_sceneBrightness + (range−distance)/range`. Below 1, the frame's palette is scaled (`brightenPbm`). The engine: `personBrightness`.
- **The picture:** `Pbm_Unpack`. The position is `x' = ftol(x − hotX·scale)`, `y' = ftol(y − hotY·scale)`, where `hotX` is `xRight` (facing +1) or `xLeft` (−1). `Sprite_Set(0x7cdea8[i], x', y', picture, facing·scale)`. A negative scale is a mirror. There is **no** `+0.5` (Jack's insertions round). The two branches of the PCS flag produce the same sprite.
- **The sound:** when `0x8713f8[i][frame]` is at least 0, `Sound_PlayIndexed` twice, channels 1 and 2, at volumes `trunc(vol·scale·(640−x+scroll)/(scroll+640))` and `trunc(vol·scale·x/(scroll+640))`, the same split as Jack's steps. The engine: `effectVolumes`. The split leans right when the view is scrolled. Two persons who step in the same frame cut each other's sounds.
- **The draw order**, when `0xa00cc0` is above 0 and `0x7cdecc[i]` is set. Below.
- **The shadow**, when `g_shadowsOn`: `Person_DrawShadow` `00428d50`. See [shadows.md](shadows.md).
- **The next frame:** `0x88f664` means −1, and below 0 it becomes `frames−1`. Otherwise +1, and at or above `frames` it becomes 0. Then `0x88f4a8` is 0.

After arrival the person **is not redrawn**. The sprite stays on the last frame. A person who is "standing" in the data is the last walk frame or the last insertion frame. The shadow is also refreshed at the remembered position (`0x6d5f10` / `0x6c186c`) when there is no insertion and no walk and the shadow is on (`004363a8`).

The initial `z` of a person's sprite is the person's index. Later depth moves it. See [render.md](render.md).

## Insertions (`Game_Run` `00435155`…`004363e1`)

The condition is `0x7cdf10` and `0x5640d8` at most 0. The frame record is `g_insFrames[0x89792c[i]]` (`0x71a840 + n·0x22`, the same record as Jack's).

1. **The effect** of the record (`+0x1c` at least 0): channel 0 means channels 1 and 2, otherwise the channel is `+0x1e`, and the volume is `+0x20`. This happens **before** the end test, as for Jack.
2. The insertion facing `0x51f824`: `hotX` is `a` when the facing is 1, otherwise `b`. `hotY` is `c`.
3. `cur + 1 > end` is the end. `0x7cdf10` becomes 0, `g_macroPending[0x534fe8[i]]` decrements, and at 0 the macro runs. Nothing is drawn.
4. Otherwise the counter becomes `0x8a7c38[i]` (the same delay as the walk, **not** `g_insFrameDelay`). The picture comes from the scene archive. The light, then `Sprite_Set` at `ftol(x − hotX·scale)`, `ftol(y − hotY·scale)`, scale `facing·scale`, **with no** `+0.5`.
5. The draw order, then the shadow (when `d` is below 1000: `x ± d·scale` depending on the facing, `y + e·scale`. When `0x8a1770` is set, there is no `scale`). `0x56409c[i]` increments.
6. `cur++`.

An insertion does not cancel a walk in progress. `0x55b080` stays, and the walk resumes when the insertion ends. In the data the person is usually standing after `RUNINSERTION`.

`0x51f848` (`g_jackScaleSaved`) is only a scratch copy of **this** person's own scale: `00435799` stores `0x8707d0[i]` there, `noScale` (`0x8a1770`) sets `0x8707d0[i]` to 1.0 for the draw, and `00435a94` restores `0x8707d0[i]` from the scratch. The person's scale does not change. A frame at `f` of 2 is drawn at scale 1.0, but the brightness (before the scratch) and the shadow (after the restore) use the person's **own** scale. That scale is 1.0 after `INITFIRST`, `SETPOSITION`, or a walk step at `f` of 2, but after a bare `RUNINSERTION` it stays the scale from before `f` of 2. An earlier reading that copied Jack's last insertion scale onto the person was wrong.

The flag `0x8f5dcc` is set only by `INITFIRST` (`0041a88c` / `0041aa1e`). On Jack's path (`00433cc8`) it releases the macro `0x54d6e0` after the first frame. In the person loop (`00436328`) it does the same for `0x534fe8[i]`, but the first insertion that draws a frame consumes the flag. See [frame.md](frame.md).

`SETPOSITION` clamps the scale to 0.1, a walk step clamps to 0.01, and `SETPERSONDATA` does not clamp at all.

A person's `RUNINSERTION` does not clear the step counter. The original does not either. `INITFIRST` does clear it. See [play.md](play.md) and [frame.md](frame.md).

## Draw order (`004349a6`…`00434fd5`, and after an insertion `00435a9b`…`00436040`)

When `0x7cdecc[i]` is set (1 by default), after a frame is drawn the game walks the sprite list `0xa00cd0` (the count `0xa00cc0`). For each sprite `s`:

- It skips special sprites (the cursor, captions, and the ids `0x8ab6b4`, `0x88f640`, `0x652154`, `0x528984`, `0x55b092`, `0x51fc5a`, `0x52a32e`, `0x551558`, `0x54d868`), the shadows (Jack's and the persons', when shadows are on), and the speech balloon (`0x7c1252`, while a conversation `0x8f6924` is running).
- **Jack** (`0x6bd1fa`) and **another person:** a comparison of the feet `y` (float). `y` of this person below the other's `y` means this person should be **behind**. If this sprite is higher in the list, `Sprite_MoveBack` by the difference of the indices. Greater means **in front**, `Sprite_MoveFront`. Equal means no change (`behindByY`).
- **A scene object** (`Object_FindBySprite` `00413370`), **after a walk step:** only two edge tests of the quad, `Depth_AboveQuadEdge` `004032c0` and `Depth_BelowQuadEdge` `004034f0`. Above an edge and not below one means behind. The reverse means in front. Otherwise no change (`personObjectDepth`). The "every corner" tests Jack uses (`004031c0`, `00403240`) are not here.
- **A scene object after an insertion frame** (`00435f02`…`0043603b`): **no edge tests**. Only comparisons of the feet `y` (float) with the `y` of corner 0 and corner 2 of the quad, plus the object's `y` (`0x86fc2a` / `0x86fc32` plus `g_sceneObjY` `0x7c7320`). Corner 0 below the feet means behind (`Sprite_MoveBack` when the person lies higher in the list). Then, with the indices from before that move, corner 2 above the feet means in front (`Sprite_MoveFront` when the person lies lower). A zero quad (most of the furniture) therefore compares against the object's `y` alone (`personObjectDepthInsertion`, `ScenePlayer.arrangePerson(i, insertion)`).

The engine: `arrangePerson` returns a new order. Jack is checked against persons separately (`packages/engine/src/walk/depth.ts`, `personDepth`). The original compares against the sprites touched by the last redraw. The engine compares visible sprites whose rectangles overlap. See [play.md](play.md).

## The host

```ts
const persons = new ScenePersons(scene.persons.map(personDef), { horizon });
const bob = persons.get("GANGSTER"); // the first of that name
bob.setPersonData(delay, refY, refScale, step);
bob.setPosition(x, y);
bob.startWalk(x, y);
bob.startInsertion(insertion, dir);
const updates = persons.tick(env); // one 15 ms tick, after the logic tick
```

A frame's picture comes from the scene archive (`source: "scene"`). A global insertion comes from `GLOBAL.PAK`. When `brightness` is below 1, `brightenPbm` scales the palette (`packages/engine/src/anim/light.ts`). The host creates the sprites, handles `HIDE`, releases the macro on `walkArrived` and `insertionEnded`, keeps the draw order, and draws the shadow (`PersonShadow`).

Two persons who take a step in the same frame each play on channels 1 and 2, so the second cuts the first. The engine keeps that.
