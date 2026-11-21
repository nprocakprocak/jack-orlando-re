# Animations: Jack and the scene objects

How the original plays Jack's animations (standing, walking, the `.ICS` insertions, the idle animations, the shadows, the step sounds, and the effect sounds) and the scene-object animations from `.ACI`.

Code: `packages/engine/src/anim/` (`jack.ts` is the constants and the frame placement, `animator.ts` is `JackAnimator`, `objects.ts` is `ObjectAnimation`, `light.ts` is the brightness). Formats: [global.md](../formats/global.md) (ICS, SFB) and [scene.md](../formats/scene.md) (ACI, CCG). The renderer is [render.md](render.md). Persons are [persons.md](persons.md).

## Time

Every animation of Jack uses one counter, `g_jackInsDelay` (`0x8713f4`), which `Game_TimerTick` (`00426990`) decrements every third call, a logic tick of 15 ms. `Game_Run` checks it on every frame of its own (5–10 ms) and, when it is at most 0, takes an animation step and reloads the counter. In the engine a step is `JackAnimator.tick()` once per tick.

- An insertion: the counter is `g_insFrameDelay` (`0x504794`), at `00432af3`. `.data` holds 4. `00427800` and the script (`SetPersonData JACK 5 …`, `Script_ExecStep` case 3, the first argument) set 5. At 5 ticks a frame lasts 75 ms. The first frame of a global insertion appears after a full delay (`Ins_StartGlobal` `00403110` loads the counter). An insertion from a scene script (`INITFIRST`, `RUNINSERTION` in `Script_ExecStep` `0041a330`) clears `g_jackInsDelay`, so its first frame appears on the next tick. The animation ends one delay after the last frame.
- A walk: the counter is `g_insFrameDelay − WalkSpeed` (`g_cfgWalkSpeed` `0x9fa95e`, the menu option, 1 by default), at least 1, at `0043182d`. Two flags change it (`0x6d9842` means the full delay, `0x6d5f0d` means 2). What they mean is a hypothesis (a run, or a scripted walk).
- Objects from `.ACI` have their own counters `0x54d6e8[k]` (also in `Game_TimerTick`), loaded from the delay the `Anima` command gave.

## Direction, the mirror, and the frame series

`g_jackDir` (`0x8f6916`) is one of five poses. `g_jackFacing` (`0x504780`, ±1) is the mirror.

| dir | Pose | Walk (`RESOURCE.PAK`) | Stand | Walk shadow | Stand anchor X, Y | Stand scale |
|---|---|---|---|---|---|---|
| 0 | front | `FRON1`..`12` | `SSFR2.PBM` | `SH_FR01`..`12` | 46, 264 | 0.978 |
| 1 | profile | `PROF1`..`12` | `SSPR2.PBM` | `SH_PR01`..`12` | 23, 262 | 1 |
| 2 | back | `BACK1`..`12` | `SSBA2.PBM` | `SH_BA01`..`12` | 50, 266 | 0.988 |
| 3 | front three-quarter | `SKFR1`..`12` | `SSSP2.PBM` | `SHSFR01`..`12` | 36, 264 | 0.988 |
| 4 | back three-quarter | `SKBA1`..`12` | `SSST2.PBM` | `SHSBA01`..`12` | 46, 260 | 1.015 |

### The uniform

`Jack_LoadWalkFramesUniform` (`00417e40`, `EXTRA 6`) loads a second set **into the same buffers**. `Jack_LoadWalkFrames` (`00416a90`, `EXTRA 8`) restores the civilian set. Both set `g_turnScaleTable` (`0x503e88` / `0x504128`), the variable `JACKISWOJ` (0 or 1), and `g_jackUniform` (`0x8f68d9`). All of the files are in `RESOURCE.PAK`.

| dir | Walk (numbers 01..12) | Stand | Stand anchor X, Y | Stand scale |
|---|---|---|---|---|
| 0 | `FRONW01`..`12` | `STFRW13.PBM` | 47, 268 | 0.978 |
| 1 | `PROFW01`..`12` | `STPRW13.PBM` | 24, 262 | 1 |
| 2 | `BACKW01`..`12` | `STBAW13.PBM` | 46, 264 | 1 |
| 3 | `SKFRW01`..`12` | `STSFW13.PBM` | 39, 266 | 1 |
| 4 | `SKBAW01`..`12` | `STSBW13.PBM` | 49, 263 | 1.014 |

The walk anchors come from `FRONW.SFB` through `SKBAW.SFB`. The turn in place is `ROTW01`..`17` plus `ROTW.SFB`. See [turn.md](turn.md). These are **not** reloaded: the shadows `SH_*` (the same in the uniform), and the start-of-walk frames `OBPL*` / `PROPRO` (in the uniform a turn is always in place, `Jack_WalkToPoint` `004114b0`). The ninth `PROPRO` entry is unused.

The switch is `Script_ExecStep` case `0x24`. `EXTRA 6` runs only when `g_jackUniform` is 0. `EXTRA 8` runs only when it is not 0. A repeated `EXTRA 6` does nothing, including one that only sets `JACKISWOJ`. The picture changes on Jack's next frame (`Jack_Stand`, or a walk step). In `SC105`, the take-the-uniform macro, Jack is hidden (`HIDE JACK`. The change of clothes is played by the persons `JACK1` and `JACK2`), and `SETPOSITION JACK` shows him already in the uniform. The set and the flag survive a scene change (they are global buffers). `EXTRA 8` occurs in no script. `EXTRA 7`, `EXTRA 8`, and `EXTRA 9` as idle triggers are dead.

A load (`Save_LoadState` `00409090`): when `g_jackUniform` is 0 and `JACKISWOJ` is 1, `00417e40`. When it is not 0 and `JACKISWOJ` is 0, `00416a90`. Any other pair leaves the set (the engine: `uniformAfterLoad`). A new game (`004098f0`, `Menu_InGameOptions` `0040b580`) and the start of `Game_Run` return to civilian clothes.

The engine: `loadWalkFrames` reads both sets (`WalkFrames.uniform`). `JackAnimator.uniform` picks the files, the anchors, and the scale. `EXTRA 6` and `EXTRA 8` set it (`SceneHost`), `PlayGame.loadScene` carries it between scenes, and a load restores it. `HAVEGUN` and `NOHAVEGUN` do **not** change the stand scale. The portrait that follows the uniform is Jack's wartime face. After the change, the hand cursor is the one that follows the uniform.

The walk frames: `Jack_LoadWalkFrames` (`00416a90`) loads the series into `g_jackWalkImages` (`0x71a750 + dir·0x30`). The anchors come from `<series>.SFB`. For all 60 frames, `xRight + xLeft` equals the width. The stand pictures sit in blocks of `0x36b6` bytes from `0x878a70`. The anchor is fixed: `xRight` from a table, `xLeft` is the width minus `xRight` (`00416a90`, at the end). The stand scale is the perspective scale times `Jack_StandScale(dir)` (`00414620`. In the uniform, `g_jackUniform`: 0.978, 1, 1, 1, 1.014), clamped to 0.1…1.

`g_jackFacing` of 1 is the picture as stored (the profile looks right). `−1` is a mirror (a negative scale step in `Sprite_Set`). Insertions have their own direction `g_jackInsDir` (`0x51f730`, ±1). Their shadows are mirrored by `g_jackFacing`, below.

The frames `DP_*`, `DM_*`, `PP_*`, and `PM_*` (for example `DP_L02`) are not a walk. They are **sections of `GLOBAL.ICS`** (handing an item over, putting it away, the windshield).

## Placing a frame on the anchor

Jack's position is the floats `g_jackX` and `g_jackY` (`0x7c7a54` / `0x7c7a60`, the 1024×480 buffer). The frame's anchor lands on that point.

```
hx = (facing == 1) ? xRight : xLeft // ICS: a / b. SFB and the stand: [0] / [1]
x = ftol(g_jackX − hx·s [+ 0.5])
y = ftol(g_jackY − hy·s [+ 0.5]) // hy is c (ICS) or [2] (SFB, the stand)
```

`ftol` truncates toward zero. Only insertion frames have the `+0.5` (`004331f8`, `00433223`). The walk (`004321e8`) and the stand (`004156e3`) truncate. The frame size is `trunc(w·s)` by `trunc(h·s)`. The game scales the picture itself (`0046f4c0`, the step `65535/s` divided by `0xffff`, as in `Sprite_Set`) and sets the sprite at scale `16.0`. `Sprite_Set` at scale `±s` does the same. The other path, with no pre-scale, is dead.

The scale `s` (`g_jackScale` `0x504700`):

- A walk: `(y − horizon)·refScale / (refY − horizon)`, clamped to 0.1…1 (`00431b68`). It is not computed when `SetPersonData` gave a scale of 3.0 (`g_jackFixedScale` `0x7c1250`). That is `perspectiveScale`.
- A stand: the same, times `Jack_StandScale`. `SetPersonData` with a scale of 2.0 (`g_jackNoScale` `0x8a267a`) means 1 (`00415531`).
- An insertion (`0043302c`): `s` is remembered (`0x51f848`, for the shadows). `g_jackNoScale` means 1. A global insertion is multiplied by `g_jackInsScaleMul` (`0x69ece0`, the third argument of `Ins_StartGlobal`) and clamped to 0.1…1. The walk path does not check `g_jackNoScale`.

`JackAnimator` receives the scale from outside (`JackPose.scale`).

`SETPERSONDATA JACK` with `f` of 3.0 keeps the scale from the moment of the command (the step uses the recomputed one). `f` of 2.0 sets `refScale` to 1000, and the scale is 1 by truncation. Jack's stand brightness is taken from the previous frame.

## A walk

`Game_Run` `004317dc`…`0043289b`, when `g_jackWalking` (`0x8f691c`) and the counter is at most 0. The movement itself is [walk.md](walk.md).

1. Reload the counter (above), and clear the idle counter.
2. The move: the next point of the path, or the end of the path (`Jack_Stand`). `g_jackX += stepX·s`, `g_jackY += stepY·s` (`00431bf4`), then the new scale.
3. The picture `g_jackWalkImages[dir][f]`, the light (below), the sprite.
4. A step sound when `f` is 0 or 6 (`Jack_PlayStep` `00427a10`, when the scene has `KROK1.SND` and `KROK2.SND`): alternating `KROK2` and `KROK1` (`0x51f918`), channel 2 at `ftol(64·s·x/(scroll+640))`, channel 1 at `ftol(64·s·(640−x+scroll)/(scroll+640))`.
5. `f = (f + 1) mod 12` (`0043282e`).
6. Shadow 1: `Jack_DrawShadow(dir, facing, ftol(x), ftol(y), 0, −1, …)`. The shadow frame is already the **new** `f`. Shadow 2, if it was there, disappears (`0043289b`).

After `Jack_Stand` (`004150f0`), `f` is 3, so a walk starts at `FRON4` and the matching frame of the other directions.

`JackAnimator.walk()`, then `tick(pose, move)`. `move` is called on the walk step, before the draw. `JackUpdate.walkFrame` is the frame that was shown.

## Insertions (`.ICS`)

The start is `Ins_StartGlobal(name, direction, scaleMultiplier)` (`00403110`, a section of `GLOBAL.ICS`, pictures from `GLOBAL.PAK`) or `Ins_Find(…, jack=1)` (`0040dbd0`, a section of the scene, pictures from the scene archive). The range is `g_jackInsFrame`…`g_jackInsEnd` (the end is exclusive). `Ins_Find` compares names with `strcmp` (exact) and takes the first matching section.

A step (`Game_Run` `004328bc`…`00433cff`), when `g_jackInsActive` and the counter is at most 0:

1. The effect of the record `g_insFrames[cur]` (`+0x1c` at least 0). A scene effect is `Sound_PlayIndexed(channel, index, volume)`. Channel 0 means channels 1 and 2. A `GLOBAL.ICS` effect is `Sound_PlayTalk` with the name from the shared buffer. This happens **before** the end test.
2. `g_jackHotX` is `a` when `g_jackInsDir` is 1, otherwise `b`. `g_jackHotY` is `c`. The counter becomes `g_insFrameDelay`.
3. `cur + 1 > end` is the end. `g_jackInsActive` becomes 0. For a global insertion, `g_jackInsFromScene` also becomes 1, two game variables are cleared, and when `0x6d5060` is 3 (the weapon) a continuation starts: `BWPRO1` / `BOPRO1` (dir 1), `BW34P1` / `BO34P1` (dir 3), `BW34T1` / `BO34T1` (dir 4), depending on `g_jackUniform`. Nothing is drawn.
4. Otherwise: load the picture, the light, the scale, the sprite (`placeFrame`, with the `+0.5`).
5. The shadows, when `g_shadowsOn` (`0x7a9a0c`) and an idle insertion is not running (`0x5531f8`). For `d` below 1000, the position is `(ftol(x ± d·s), ftol(y + e·s))` (minus when `g_jackInsDir` is −1, and with no `·s` when `g_jackNoScale`). For `d` at or above 1000, the shadow sprite is removed if it was there. The same for `(f, g)` and shadow 2 (`004337b7`…`00433cc1`).
6. `cur++`.

### Between two insertions, `SETPOSITION JACK` and `MOVEP JACK` draw nothing

`Script_ExecStep` case 1 (`SETPOSITION`) changes only `g_jackX`, `g_jackY`, the script variables, and `g_jackScale`. Case `0x37` (`MOVEP`) only adds to `g_jackX` and `g_jackY`. There is **no** `Jack_Stand` and no `Sprite_Set`. Jack's sprite therefore stays, after an insertion ends, where the last frame left it, until the next frame (an insertion, a step, or `STAY`). An earlier engine drew a standing frame on those commands. In SC001 (the arrest: one insertion, then `MOVEP JACK`, then the next insertion, then `SETPOSITION JACK`) a `SETPERSONDATA JACK` with `f` of 2 (`noScale`, so the scale is 1) put a large standing Jack on screen for one frame. `ScenePlayer.setJackPosition` no longer draws. A small difference remains: `MOVEP JACK` in the original does not recompute `g_jackScale`. The engine does. It is invisible when `noScale` is set.

### After the last insertion, Jack stands only on `STAY`

The end of an insertion draws nothing (above). `STAY` draws a stand only when `g_jackShown` is 0 or Jack was moving. See [turn.md](turn.md). An insertion does not set the flag, so a `STAY` right after the insertions (SC003: the jump, then `STAY`) always places Jack, even in the same direction.

A person's scale after one of Jack's insertions is the person's own scale, not Jack's. See [persons.md](persons.md).

## Shadows (`Jack_DrawShadow` `00427b20`)

The arguments are `(dir, facing, x, y, number 0 or 1, frame, p7, p8)`. `frame` of −1 is a walk. `3` is a stand and an insertion. `p7` not equal to −1 picks the turn frames `0x7c7a68` (13…20 times 4). That path was not taken apart. The turn shadow reads uninitialized storage.

- The picture: `dir` of 16 is the round `CIEN1.BM`. A walk is `g_jackShadowFrames[dir][g_jackWalkFrame]` (`0x855240`). Frame 3 is the directional `SH_*04`, **only** when `g_jackShadowDirectional` (`0x8f5dd4`) is set and `g_jackTwoShadows` (`0x69d7c0`) is not, otherwise `CIEN1.BM`. Only `Jack_Stand` and two related functions (`004146e0`, `00415960`) set `0x8f5dd4`, around the shadow call. **Insertion shadows are always round.** A bad direction or frame falls back to `SH_FR04` and prints a run of exclamation marks (`Debug_PrintAt`).
- The scale: `s·g_jackShadowScale` (`0x652108`, 1 by default, script command `0x89` for a person `f`), times 0.7 for `CIEN1.BM` with no second shadow, at most 0.99 (`00428198`).
- The position: `(x − ox·sc, y − oy·sc)`, truncated. `(ox, oy)` comes from byte tables indexed by `Jack_ShadowDirIndex(dir, facing)` (`0047ea20`: `dir·facing` of 1 is 2, 2 is 4, 3 is 1, 4 is 5, −4 is 3, −3 is 7, −1 is 6, and anything else is 0. −2, the mirrored back, gets the front's shifts).

 | Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | Round |
 |---|---|---|---|---|---|---|---|---|---|
 | Walk X (`0x504748`) | 48 | 60 | 60 | 40 | 50 | 60 | 60 | 45 | 55 |
 | Walk Y (`0x50475c`) | 20 | 15 | 15 | 25 | 19 | 23 | 15 | 21 | 14 |
 | Stand or insertion X (`0x504750`) | 48 | 55 | 60 | 42 | 50 | 65 | 60 | 55 | 55 |
 | Stand or insertion Y (`0x504764`) | 25 | 20 | 15 | 22 | 30 | 23 | 15 | 20 | 14 |

- The mirror is the sign of `facing` (`g_jackFacing`, for insertions too).
- The draw: `Render_ComposeRegionNoFlag` (`00475760`) composes the background under the shadow, and `Blit_ShadowDarken` (`0046eac0`) darkens it under the non-zero pixels of the scaled mask and sets that as the sprite (`g_jackShadowSprite1` / `2`, `0x6b1630` / `0x7a837e`). The darkening strength comes from `0x8ab669`. That last point is a hypothesis. The function also has fade-out and fade-in states (the counters `0x551602` / `0x722efc`, the commands `SetShadow`, `MaxShadow`, and `MinShadow`). `SETSHADOW` of Jack does not remove the second shadow. See [shadows.md](shadows.md).

## Light

Before a frame is drawn (a walk at `00431d8f`, an insertion at `00432d03`, a stand at `004150f0`) the game computes Jack's distance from the nearest light (`dx = x − lx`, `dy = 3·(y − ly)`, `trunc` of the square root, starting from 1000) and the brightness `g_jackBrightness` (`0x50477c`) as `g_sceneBrightness` (`0x6d6234`, command `0x35`) plus `(range − distance)/range`, when the distance is below `range = trunc(300·s)`. When the brightness is below 1, each of the 128 palette colors of the frame (`.PBM` bytes 4…`0x103`) has its RGB565 components multiplied and truncated, and not below 1 (color 0 is unchanged). The engine: `jackBrightness`, `brightenPbm`. The default of `g_sceneBrightness` before a script command is unknown. A hypothesis: 1.

## Idle

`g_idleFrames` (`0x6c2754`) counts frames of `Game_Run` (not ticks) with no input (`0042cd90`…`0042cfed`).

1. **It grows** by 1 every frame when `g_logicFrozen` is 0. The F4 menu, the coat, the verb window, and the map do not grow it.
2. **It is cleared**, right after that, every frame: the left button down (`g_mouseLeftDown`), or the right or middle button (`g_mouseRight`), or a mouse position different from the previous frame (`g_mouseX` is the screen plus the scroll, so scrolling the background clears it too. The previous position is `DAT_008a7240` / `DAT_008ab5e0`), or a macro that holds the player (`g_macroPlayerLocked`: cutscenes, dialogs, exits). **Every walk step** also clears it (`004317dc`…). The start of a scene does not clear the counter. The entry macro usually does.
3. **The check:** `g_idleFrames` above 1500 (`0x5dc`), `g_sceneNoControl` is 0 (not on the map `SC000D` or `SC008B`), and Jack is not turning (`g_jackTurning` is 0). The code does **not** look at whether Jack is shown or hidden, whether he is walking, or whether another insertion is running. An idle insertion would replace it.
4. **The reaction**, from `g_jackDir`, `g_jackFacing`, and the uniform (`g_jackUniform`):

| dir | Civilian | Scale | In the uniform |
|---|---|---|---|
| 0 | `KLFR` when the random value is odd or `GUN` is 0, otherwise `KOLT`. Direction 1 | 0.97 / 0.985 | `STAY` down-left |
| 1 | `KLPRO` | 1 | `STAY` down-left (facing 1) or down-right (facing −1) |
| 2 | `KLTYL`, direction 1 | 0.975 | `STAY` down-left (facing 1. Facing −1 cannot happen, so nothing) |
| 3 | an odd random value is `34PKL`, otherwise `MONETA` | 0.98 | `MOW34` |
| 4 | `34TKL` | 1 | `STAY` down-right (facing 1) or down-left |

The insertion branch sets `g_jackIdleIns` to 1 (`0x5531f8`), calls `Ins_StartGlobal(name, direction)` (`00403110`), and the counter becomes **700**. The next reaction is 800 frames later. `rand()` (`00487ea0`) is called only in civilian clothes, at dir 0 and 3 (one number per reaction when there is no uniform), and `GUN` is read only after an even number at dir 0. `STAY` (`0041a140`) is called with a second argument of **9999** (`push 0x270f` at `0042ce16` and `0042ce64`): Jack turns to the down-left or down-right pose, no macro waits on the turn, and the step counter is 0. That branch does **not** change the idle counter, so when the turn ends the next frame (already dir 3) plays `MOW34`. The idle exists in the uniform too, including in `SC105`. `MOW34` is the coin toss in the uniform (the civilian equivalent is `MONETA`).

Facing the back (dir 2), Jack always has facing 1. Every store of `g_jackFacing` (`0x504780`) is `Jack_FaceTowards` `004104a0`, the walk direction `004114b0` (facing starts at 1, and −1 only for dir 1, 3, and 4), `STAY` `004146e0` (`U` means dir 2 and facing 1), the restore of the previous pair on a short step (`004119eb`), or a load (`0042c9e0`). In the uniform, idle while facing away is therefore always a `STAY` down-left (a turn diagonally forward to the left), and after the turn `MOW34`. The branch that would start nothing for dir 2 and facing −1 in the uniform (it sets `g_jackIdleIns` to 1 and the counter to 700, and starts no insertion) is dead. There is no idle while facing away with no stand.

`g_jackIdleIns` turns off the shadows of insertion frames (the shadow step in `004328bc`…`00433cff` requires `g_shadowsOn` and not `g_jackIdleIns`). The previous frame's shadows stay where they were. The end of a **global** insertion clears it (the same step as a slap or a shot, [gestures.md](gestures.md)), and so does the start of a scene.

The tempo: the original limits frames to one per more than one 5 ms tick (`Timer_WaitSinceFrameStart`, [architecture.md](architecture.md)), so in practice about 100 frames a second, and 1500 frames is about **15 s**. A slower computer takes longer. A browser draws one frame per refresh, so the engine adds `IDLE_FRAMES_PER_TICK` of 1.5 frames per 15 ms logic tick (100 frames a second). The thresholds 1500 and 700 are unchanged.

The engine: `ScenePlayer.idleCount` (the tick of `PlayGame.update`, outside the states where `g_logicFrozen` is set), `idleInput`, and `idleCheck` (the frame of `PlayGame.frame`, after the cursor, before the keys and the macros. `random` is the scripts' `rand()`, the same stream as `RAND` and `TALKRANDOM`). A walk step clears it. `idleIns` (the insertion shadows) is in `jackTick`. `stayJack(name, macro = false)` is a `STAY` with no macro. The choice is `idleChoice` (`packages/engine/src/anim/jack.ts`). The end of an idle insertion goes through `Gestures.globalInsertionEnd`, like every global insertion. That is also the fix for a gesture skipped after an idle. The engine does not reproduce that skip unless `originalIdleBug` is set. See [gestures.md](gestures.md).

`EXTRA 7` and `EXTRA 9` (case `0x24`) are the same table, called from a script, with no `STAY` (in the uniform, only `MOW34` at dir 3). `9` takes `KOLT` or `MONETA` instead of the random choice. No script uses them. The engine does not handle them.

## Scene objects (`.ACI`)

`SceneAnim_LoadObject` (`00447c20`) creates animation `k` for a scene object that has a section in the `.ACI`. Image 0 is the object's picture. Images 1…n come from the file, with shifts `(dx, dy)` from the object's position. Sequences `REC` (up to 15, of 300 values each). Mode 3, inactive.

The command `Anima` (`Script_ExecStep` case 4): the arguments are the direction (0 is forward), the delay, the mode, the object, the `REC` number, and `-` (do not wait). A start forward: the image is 0 (modes 1 and 2) or `REC[0] − 1`, and the position is 0. Backward: the image is `n` or `REC[last] − 1` (with no `abs`), and the position is the last index.

A step (`Game_Run` `004363ec`…`00437ffe`), for an active animation whose counter is at most 0:

1. `AnimaEffect` entries that match (the REC position or the image, and the REC number). The sound is as in an ICS.
2. The counter becomes the delay. The image `g_objAnimImage` is drawn if it changed (or it is an FLX). An 8-bit object is `Sprite_Set(sprite, objX + dx, objY + dy, image, 16.0)`. A 16-bit object is composed with the background.
3. Modes 3 and 4: `position += step`. A stop on a position (`0x38`). Past the end: mode 3 ends (the macro counter), mode 4 starts over (backward is the same idea). The image is `|REC[position]| − 1`. A negative value stops when `0x3a` is on.
4. Modes 1 and 2: `image += step`. Past the end, mode 1 ends and mode 2 starts over.
5. Modes 5 and 6 are `.FLX` animations. See [media.md](../formats/media.md).

`REC` counts images from 1 (`1` is the object's own picture). In the data the values are 1…n, apart from two errors. The engine: `ObjectAnimation`, with `start`, `stop`, `setFrame`, `stopAt`, `stopAtMarker`, `effects`, and `tick`. A bad number makes `image()` return `file: null`. After the end of mode 3 the game reads the value past the sequence. The engine takes the last one.

`ANIMA` of modes 2, 4, and 6 with `-` and a negative pending differ from the original. There is no effect in the data. An animation stopped with `STOPANIMANEG` or `STOPANIMAFRAME` does not release the macro. Only the real end does. See [play.md](play.md) and [frame.md](frame.md).

**`SETPOSITIONE` on an FLX slot.** `Script_ExecStep` case `0x2c` stores `g_sceneObjX` and `Y` and, unless the object is type −8 or the position is `(0, 500)`, calls `Sprite_Set` of the animation's sprite at `(x, y)` with the picture the sprite already has (`Sprite_FindIndex`). An `FLXn` slot is not type −8, so the command moves its sprite together with the object. Scripts use this as a cleanup after an FLX animation: the init of `SC006` (leaving the car) and the cut of `SC038` do not hide the animation. They slide the last frame under the screen (`SETPOSITIONE FLX0 0 500`). The engine used to skip the FLX sprite in `setObjectPosition`, so the last frame stayed (two Jacks in SC006, and a figure left in the elevator of SC038). The sprite now follows the object (`packages/engine/src/scene/player.ts`).

An FLX of SC090 has no animation. A two-byte FLX delta is a bug of the format.

## Object commands on `ScenePlayer`

Six commands of `Script_ExecStep` `0041a330` (the `case` is the code minus 1). The methods are on `ScenePlayer` (`packages/engine/src/scene/player.ts`, the pixels in `packages/engine/src/scene/objfx.ts`). The name `anim` or `object` is the scene object's name. An unknown name returns false and does nothing.

| Command | Method | What the original does | The engine |
|---|---|---|---|
| `SHOWANIMAFRAME anim n` (`0x1c` / `0x1b`) | `showAnimFrame(name, n)` | the animation's sprite gets image `n` at the object's point plus the image's shift (`Sprite_Set`. Type 8 goes through `Pbm_Unpack`). `g_objAnimImage[anim]` becomes `n`. It does not check that the animation is running | image `n` (0 is the object's own picture) is drawn at once, and `anim.index` is `n`. An FLX slot, or an `n` past the list, returns false |
| `SETDARKNESSANIMA anim f` (`0x68` / `0x67`) | `setAnimDarkness(name, f)` | `0x897950[anim]` becomes `0047d5c0(0xffff, 0, f)`. The default is `0xffff`, set when the animation is created. It is read **only** on the draw branch of type −8 objects in `Game_Run` | the type −8 darkening, below |
| `BRIGHTNESSE object f` (`0x41` / `0x40`) | `brightenObject(name, f)` | rewrites the palette (128 entries from `+4`) of the object's sprite picture: the channels times `f`, truncated, at least 1, and color 0 stays | `ObjectSprite.light` times `f` (float32). The picture is recomputed by `brightenImage` (a copy. The picture cache is untouched). Later calls stack. A new animation frame, unpacked again, clears the brightness |
| `CLEARANIMABUFFER anim` (`0x82` / `0x81`) | `clearAnimBuffer(name)` | `memset` of the animation's picture buffer, **including the header** (the width and the height), `0x6da4e0[anim] · 200` bytes | the sprite is empty (hidden) until the next frame draws it. Only animations that have a buffer (type 8, type −8, FLX slots). The rest return false. The FLX decoder's frame buffer is not cleared |
| `MOVEEP object dx dy` (`0x4c` / `0x4b`) | `moveObjectPoint(name, dx, dy)` | `g_sceneObjX` and `Y` gain `dx` and `dy`, **and nothing else** (`MOVEE`, case `0x3f`, also moves the sprite) | moves the object's `x`, `y`, and quad. The sprite follows on the next frame (animation steps take the position from `g_sceneObjX` and `Y`) |
| `RELATIVEMULP person f` (`0x8a` / `0x89`) | `setPersonLightScale(person, f)` | a person: `g_personLightScale[p]` is `f`. Jack (`0x66`): `g_jackShadowScale` is `f` | a person: `PersonDef.lightScale` is `f32(f)`, the same field as field 4 of the `.PCS`. It multiplies the light range and the shadow scale. Jack: `JackAnimator.shadowScale` is `f32(f)` |

`MOVEEP` in the sweeping macro of SC013, between phases of `ANIMA` of the broom, steps the object 17 px to the right three times and 17 px to the left three times. The broom shifts left and right. The command moves an object. It is not a person command.

Type −8 is an object that stays invisible until an animation step shows it, and `SETDARKNESSANIMA` darkens that draw. See [render.md](render.md) and [shadows.md](shadows.md). `CHWINDOW` of `CAR1` and `CAR2` in the prologue of SC001 names objects the scene does not have.
