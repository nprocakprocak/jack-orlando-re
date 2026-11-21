# Jack's turn animation

On every change of Jack's direction — a click, a corner of the path, `LOOKTO`, `ROTATETO`, `STAY` — the original plays a short turn animation before Jack moves on. This note says which frames, in what order, for how long, and what happens at the end. Implementation: `packages/engine/src/anim/turn.ts` (the frames, the rules, the playback) and `packages/engine/src/walk/turn.ts` (the wiring into the walk and the script commands).

## Frames

The turn animations are numbered 0…20 (`g_turnAnim` `0x6d6230`). 11 and 12 are never started. `Jack_LoadWalkFrames` `00416a90` loads them (in the uniform, `Jack_LoadWalkFramesUniform` `00417e40`) into `g_turnFrames` `0x6bd298[anim][frame]`. The hot spots `(xRight, xLeft, y)` go to `g_turnHotSpots` `0x7c0e60[anim][frame]`.

| Anim | Frames (`RESOURCE.PAK`) | Hot spots | When |
|---|---|---|---|
| 0…7 | `OBPL01`…`32` (anim·4 + 1…4) | `OBPL_<anim>.SFB` | a turn while walking, 45° or 90° |
| 8 | `PROPRO1`…`8` | `PROPRO.SFB` (9 entries, 8 used) | while walking: profile to profile (180°). The 9th triple has no frame. |
| 9 | `OBPLBF1`…`8` | `OBPLBF.SFB` | while walking: back to front |
| 10 | `OBPLFB1`…`8` | `OBPLFB.SFB` | while walking: front to back |
| 13…16 | `ROTP16`…`13`, `12`…`9`, `8`…`5`, `4`…`1` | `ROTP.SFB` (17 entries, reversed) | from a stand, "toward the front" |
| 17…20 | `ROTP02`…`05`, `06`…`09`, `10`…`13`, `14`…`17` | `ROTP.SFB` | from a stand, "toward the back" |

`ROTP01`…`17` is half a turn in 16 steps: `01` facing the player, `05` three-quarters front, `09` profile, `13` three-quarters back, `17` back. The other half is the mirror (`g_turnFacing` `0x7bf62e`). Animations 17…20 are animations 13…16 in reverse order, with `ROTP17` stuck on the end (the loops in `00416a90` copy the pointers). In the uniform the files are `ROTW01`…`17` and `ROTW.SFB`. Frames 0…10 are not reloaded, because in the uniform a turn is always from a stand (below). Walking and standing in the uniform are in [animation.md](animation.md). `tj.uniform` and `JackAnimator.uniform` are set together.

The frame size is `g_jackScale · g_turnScale[anim][frame]`, clamped to 1 (`Jack_DrawTurnFrame` `00427280`). The table `0x503e88` (in the uniform `0x504128`, the pointer `0x52a334`) has values 0.945…1.08 (`TURN_SCALE`). The placement is like a walk frame: `(ftol(x − hot·s), ftol(y − hotY·s))`, hot X according to the mirror, the mirror according to `g_turnFacing` (`00427602`…`0042762e`). The light is like Jack's other frames (the palette multiplied by `g_jackBrightness`).

## The sequence: `Turn_Start` `004107c0`

`Turn_Start(n, anim₁, frame₁, mirror₁, …)` is a function with a variable number of arguments. It copies `n` triples into `g_turnSeq` `0x534864`, sets `g_jackTurning` `0x7a849c = 1`, `g_turnStepSound` `0x7c7a50 = 1`, the position `g_turnSeqPos` `0x857b78 = 0`, and the current triple. `n > 200` means `n − 200` (the only use is `0xcc` in `Jack_WalkToPoint`, which gives the same 4 steps). The starting frame is always 0.

Who calls it:

- `Jack_WalkToPoint` `004114b0`, on every segment of a walk (a click, the next point of the path, again after a turn ends), after the new direction is computed, unless the target is "already reached" (then the direction goes back to the old one and nothing happens).
- `Jack_TurnFromTo` `00410900(newDir, newMirror, oldDir, oldMirror, whileWalking)`, from `Script_Stay` `0041a140` (`STAY`) and `Script_ExecStep` `0041a330`: `LOOKTO` (opcode `0x61`, case `0x60`) and `ROTATETO` (`0x77`, case `0x76`). It clears `g_jackWalking` when the direction changes. The last argument is always 0.

### Rules

Both functions have the same set of about 30 `if` conditions (not `else if`) on the pair (old direction, new direction) and the product of the mirrors. Each match calls `Turn_Start` again, so **the last match wins**. The full table is `RULES` in `packages/engine/src/anim/turn.ts`. The "while walking" variant (frames 0…10) is chosen by `bVar1` from `004114b0`:

```
whileWalking = (g_jackWalking || g_jackMoving at 0x851d04) && !POINTROTATE (0x8979cf) && !g_jackUniform
```

Every walk segment sets `g_jackMoving`. `Jack_Stand` `004150f0`, `FUN_004146e0`, `FUN_00415960`, and `LOOKTO` / `ROTATETO` clear it. `POINTROTATE` does not turn the turn off (an earlier note said it did). It forces the from-a-stand frames.

**A path with corners always turns from a stand.** A click (`Game_Run` around `0042fe02`) and `Jack_WalkTo` `0042a370`, when the path has **more than 2 points** (`2 < g_walkPathLen`, the start plus at least one corner), store `0x51f920 = 0x8979cf` and set `0x8979cf = 1` (`POINTROTATE`) before the first `Jack_WalkToPoint`. The value comes back on reaching the last point (the step in `Game_Run`: `0x8979cf = 0x51f920` beside `g_jackWalking = 0`) and in `Script_InterruptOutMacros` `00427800`, which both places call at the start of click handling. The effect:

- a click from a stand → a turn from a stand (`ROTP`), then the walk;
- every corner of the path → a turn from a stand (`ROTP`; while walking, animations 15 and 16 are cut short), with no shift;
- the "while walking" frames (`OBPL…`, `PROPRO`, `OBPLBF` / `FB`, with `TURN_SHIFT`) play only for a walk of 2 points (straight to the target, or a direct walk with no path) that was started **while Jack is already walking**. That is a second click during a walk, in another direction, with no corners on the way.

Play confirms that a click during a walk gives a different turn from a turn from a stand. Jack turns to the requested direction first, then walks, then turns in place every time the direction changes. An earlier reading, without the forced `0x8979cf`, assigned the `OBPL` frames to corners. That was wrong. In `00410900` the last argument is always 0, so a script always turns from a stand. For a few pairs (for example 3 → 4 with the same mirror, and 0 → 4) there is no while-walking variant. The from-a-stand frames are used in both cases.

Checked for all 56 changes (8 states: 0 and 2 with no mirror; 1, 3, and 4 times ±1):

- every change has an animation (both variants). No change means no animation;
- a turn from a stand starts on the frame next to the old pose (for example `ROTP02` from the front), goes frame by frame, and ends exactly on the pose of the new direction (`01` / `05` / `09` / `13` / `17`). The mirror of the last frame is the walk mirror for directions 1 and 3, and the opposite for 4. The mirror changes only on a passage through the front or the back;
- **the direction of the turn** is the shorter way inside the half-turn drawn in `ROTP`, through the profile on the side Jack is facing. A profile-to-profile turn (180°) goes through the front (16 frames, `ROTP08`…`01`…`09`). Front to back goes through the profile (16 frames). 45° is 4 frames. 90° is 8.

## A turn started by the second call is not played

After a turn ends, `Game_Run` calls `Jack_WalkToPoint` for the same target (`0043170c`), and immediately afterwards `g_jackTurning = 0` (`00431782`, unconditionally). A turn that this call starts (for example after a sector change from the shift of the "while walking" frames, or after the forced direction of `WALKTODIR` is removed) is therefore not played. The new direction remains. `turningTick` (`packages/engine/src/walk/turn.ts`) does the same.

## The starting direction in a new scene

`g_jackDir` `0x8f6916` and `g_jackFacing` `0x504780` are global. Only a walk, `STAY`, `LOOKTO` (`Jack_WalkToPoint`, `004146e0`), and loading a save (`g_restoreJackPose`, `Game_Run` around `0042c8b0`) write them. Entering a scene does **not** clear them. The first `WALKTO` of a scene therefore turns Jack from the pose in which he left the previous scene, not from the front. The engine used to create the walker with direction 0 on every scene, so for example the entry SC011 → SC005B (`LAST` 11, `WALKTO 612 385`) started with a needless turn. `Game.enter` now calls `ScenePlayer.inheritFacing` (apart from loading a save). That is not enough for SC011 → SC005B (the end of SC011 is direction 2, and the first segment is direction 4, so 2 → 4 would still turn). The real reason: Jack's `WALKTO` and `WALKTODIR` (`Script_ExecStep` `0041a330`, case 6 and 0x16), when `g_jackShown` `0x857b7a` is 0 — the flag is cleared at the start of a scene and set when Jack is first drawn (`Jack_Stand`, `STAY` with a name) — first call `Jack_FaceTowards(target, 1)` and set the flag. `Jack_WalkToPoint` then finds the direction already matching and **does not play a turn**. The engine: `ScenePlayer.faceBeforeWalk` (called from `SceneHost.walk`). Other entries whose first script step is a walk with no `STAY` and no `SETPOSITION` plus a direction get the same correction.

## `g_jackShown` is a real flag

`g_jackShown` `0x857b7a` is 0 at the start of a scene and becomes 1 only after `Jack_Stand` `004150f0` (the end of a walk, the end of a macro that ends with `WALKTO JACK`, `STAYDEF`, `LOOKTO` / `ROTATETO` with no turn), `FUN_004146e0` (**every** `STAY`, including one with `*`), `FUN_00415960` (a restored save pose), or a `WALKTO` / `WALKTODIR` that found it 0 (`Jack_FaceTowards`). **An insertion (`INITFIRST` / `RUNINSERTION`) does not set it.** The engine used to guess it from the visibility of Jack's sprite and a mode other than an insertion. `ScenePlayer.jackShown` now follows it directly (`standJack`, `stayJack`, `faceBeforeWalk`). Effects:

- `Script_Stay` with the flag 0 calls `FUN_004146e0(name, 1)`: Jack **stands** in the new direction, with no turn. With the flag 1: `Jack_TurnFromTo`, and when there is no turn (the direction did not change) and Jack was not walking, **nothing is drawn**.
- `ROTATETO` with the flag 0 **does nothing** (neither the direction nor a turn). `LOOKTO` does not check the flag.

**SC024, the exit after the talk** (`DIALOG_EXIT`: `RUNINSERTION JACK` of `JOUT1` / `2` / `3`, then `SETPOSITION JACK 386 388`, `STAY L`, `POINTROTATE 1`, and three `WALKTO`). The flag is still 0, so `STAY L` sets Jack side-on to the left with no turn. Only the first `WALKTO` turns him 180° through the front (animations 15…18 of `ROTP`, `POINTROTATE`), then two short turns of the path (1 → 4 → 1). An engine that took the flag from visibility also played a front-to-side turn before that (`STAY L` from direction 0): a circle in place, front, left, front again, right. After the correction one 180° turn remains, which is the original.

**The roof of SC003 after the ladder.** `SC000` show-up ends with `STAY RD` (3 / −1). `SC003` `[INIT]`, after the insertions `WSKOK` / `WSKOK1`, does `STAY RD` again. The direction is inherited, so it is equal. An engine with a "visible" flag saw Jack as already drawn, played no turn, and drew no stand. The last frame of `WSKOK1` remained (the arms spread). The original (flag 0) draws the stand.

## The pose after `STAY`

`Script_Stay` `0041a140` plus `FUN_004146e0` `004146e0` (L / R / U / D / LU / RU / LD / RD → `g_jackDir` / `g_jackFacing`: 1/+1, 1/−1, 2/+1, 0/+1, 4/−1, 4/+1, 3/+1, 3/−1) match the engine (`stayFacing`, `ScenePlayer.stayJack`). A report that in SC005B Jack ends at 1/+1 instead of `STAY LU` **is not a bug of `STAY`**. After the entry from SC011, `STAY LU` gives 4/−1 (about tick 51), and 1/+1 appears only about 500 ticks later, when `CHKDISTANCE` in `[PRE]` tells Jack to step out of the way of a woman who enters through the macro `KOBDZIIDA`. That is the avoid walk (`Jack_AvoidPerson`, [avoid.md](avoid.md)), which ends in the walk's direction.

Checked across the scenes and the `LAST` values their scripts use: 155 calls of `STAY` with a name that took effect, and the walker's direction matched the code in every one. The sprite differed in the sign of the mirror from the walker in 18 cases (RU / LU / U after a turn). That matches the description above: after a turn from `STAY`, Jack stays in the pose of the last `ROTP` frame, and that frame has the mirror from the `Turn_Start` sequence (for direction 4, the opposite), until something draws a stand.

## Playback: `Game_Run` `0043083d`…`004315f8`

The counter is Jack's shared counter `g_jackInsDelay` `0x8713f4` (decremented every 15 ms tick). When `g_jackTurning`, the counter is ≤ 0, and no insertion is running (`g_jackInsActive` `0x8ab6b3`):

1. The counter is reloaded: `ftol(g_insFrameDelay · 1.3 − WalkSpeed)`, at least 1. With `JACKTEMPO` (`0x6d9842`), `ftol(g_insFrameDelay · 1.3)` (`0x4f8078` is 1.3, `00430873`). By default `5 · 1.3 − 1` is **5 ticks (75 ms) per frame**, slower than a walk step (4 ticks).
2. The frame is drawn (`Jack_DrawTurnFrame`), Jack is moved in the sprite list as during a walk, and the shadow is drawn (below).
3. On frame 2 of the first animation (`g_turnStepSound`), the step sound `Jack_PlayStep`.
4. `frame++`. The animation ends when `frame` equals `g_turnFramesWalking[anim]` (`0x503db4`) and Jack is walking, or `g_turnFramesStanding[anim]` (`0x503de0`) and he is not. Both tables have 4 or 8, but **while walking, animations 15 and 16 have 2 and 3 frames**. The from-a-stand turn toward the front, before he sets off, is cut short (`ROTP08, 07` and `ROTP04, 03, 02`). A script (`ROTATETO`) plays the full 4.
5. At the end of an animation (`00431265`): for animations 0…10, Jack is shifted `x += dx·mirror·scale`, `y += dy·scale` (`TURN_SHIFT`, [walk.md](walk.md)), and the walk frame `g_jackWalkFrame` is set (3, 9, 6, 0; for 1 and 5: 9 or 3 when the mirror is −1). Then `g_jackScale` is recomputed from the new `y`. The next triple of the sequence, or the end of the sequence.
6. The end of the sequence: when Jack is walking, `Jack_WalkToPoint(target)` once more (a new speed from the shifted position; if the shift changed the direction, another turn starts), then `g_jackTurning = 0`. When a macro is waiting (`ROTATETO` / `STAY`, `0x55155e`), the macro at `0x851d00` resumes.

**The walk waits for the end of the turn.** A step (`004317dc`) requires `!g_jackTurning`. After the last frame, the first step comes after a full turn-frame delay. The first frame of a turn: after a corner of the path, `Game_Run` zeroes the counter (`0043170c`), so it appears on the next tick.

After a turn from a stand (Jack is not walking) **nothing draws a standing frame**. The sprite stays on the last `ROTP` frame until something else draws Jack (`STAY`, a walk, an insertion, idle). Play confirms it: on a turn by itself (for example looking with the lens) Jack stays in that pose after the turn.

### The shadow during a turn

`Game_Run` `00430f2b`…`004311b0`:

- animations 0…10: `Jack_DrawShadow(g_jackDir, the walk mirror, ftol(x ± dx·s), ftol(y + dy·s), 0, 3, −1, −1)`, with `dx = g_turnShadowDx[anim][frame]` (`0x5043c8`, the sign according to `g_turnFacing`) and `dy` from `0x504478`. Frame 6 instead of 3 for `PROPRO`. A directional shadow requires the flag `0x8f5dd4`, which only `Jack_Stand` sets. In practice the round `CIEN1.BM`. That is a hypothesis, as for insertions ([animation.md](animation.md));
- animations 13…20: `Jack_DrawShadow(0, g_turnFacing, ftol(x ± b·s), ftol(y + c·s), 0, 0, anim, frame)`, with the mask `SHROT01`…`17` (`g_turnShadowFrames` `0x7c7a68`, the same layout as `ROTP`, loaded by `Game_Main` `0044e2f9`). `c` is the bytes `0x504763 + anim` (0, 0, 10, 12, 12, 10, 0, 0), and `b` is the bytes `0x8f68f7 + anim`, which is `0x8f6904`…`0x8f690b` in uninitialized BSS that nothing writes. The horizontal shift is therefore 0. The further placement of the `SHROT` mask inside `Jack_DrawShadow` (`p7 ≠ −1`) was not settled.

## Script commands

| Command | What it does with the turn |
|---|---|
| `LOOKTO x y` (`0x61`) | `Jack_FaceTowards` `004104a0(x, y, 1)` computes the direction (the walk sectors, without lifting the point by 150·scale). When Jack is walking and the direction did not change, `Jack_Stand`. Otherwise `Jack_TurnFromTo` (a change ends the walk and turns from a stand). The macro **does not wait** |
| `ROTATETO x y` (`0x77`) | the same, but only when `g_jackShown` `0x857b7a` (Jack has already been drawn in the scene; also the condition `0x79dfc8`). When a turn started, the macro waits for its end (`g_macroPending++`, `0x55155e = 1`) |
| `STAY` (`Script_Stay`) | when `g_jackShown` is 0, only the pose from the name, with no turn. Otherwise the pose with no drawing (`FUN_004146e0(…, 0)`) and a turn from the old direction to the new one, waiting like `ROTATETO` (apart from `param_2 == 9999`). The counter is cleared (the first frame on the next tick). When there is no turn and Jack was moving (`g_jackMoving`), it draws the pose |
| `POINTROTATE n` (`0x6d`) | non-zero means turns while walking are played with the from-a-stand frames |

## Persons in `.PCS`

Scene persons **have no turn animation**. Only `Jack_WalkToPoint` and `Jack_TurnFromTo` call `Turn_Start`. The turn state is Jack's single variables, and a person's frames are `[person][direction 0…7][frame]` with no transition frames ([persons.md](persons.md)). A person changes direction in a jump, which is what the engine already does.

## The TypeScript API

`turnSequence(oldDir, oldMirror, newDir, newMirror, whileWalking)` returns `TurnStep[]` (the rules of `004114b0` and `00410900`). `new TurnPlayer(steps, uniform).step(jackWalking, scale)` returns the frame, the step sound, and the end of the animation. `turnFrameTicks(walkSpeedOption, insFrameDelay, jackTempo)` is the ticks per frame. `turnFrameFile`, `turnHotSpotRef`, `turnShadowFile`, `turnShadow`, and `placeTurnFrame` name the files and place a frame. `turningJack(walker, { uniform, pointRotate })`, `followPlanTurning`, `turningTick`, and `turnTo` wire the walk (`LOOKTO`, `ROTATETO`, `STAY` return `{ stand, waits, steps }`).

## Tests

`packages/engine/src/anim/turn.test.ts`: the rules for all 56 changes (the pose, the continuity of the frames, the mirror, the direction of the turn, the length), "the last rule wins", the while-walking variants (`PROPRO`, `OBPLBF` / `FB`, `0xcc`), the ticks per frame (the option, `JACKTEMPO`, a minimum of 1), the file numbers and names, the hot spots, the frame placement, the final shifts, the shadows, and the playback (the frame order, the step sound once, animations 15 and 16 cut short while walking, the scale from the table clamped to 1, the uniform, an empty sequence is an error). `packages/engine/src/walk/turn.test.ts`: a click from a stand, a corner of the path, a second click while walking with no corners, `POINTROTATE` and the uniform, no turn (the same direction, already there), a restart of the sequence, `g_jackMoving` on arrival, and `turnTo`.

## Open

- The placement of the `SHROT` mask and its shifts inside `Jack_DrawShadow` (`p7 ≠ −1`).
- `ROTATETO` during a turn that is already running: `Turn_Start` starts the sequence over, and the old waiting macro (`0x55155e`) is overwritten. Whether the scripts do this was not checked on the data.
