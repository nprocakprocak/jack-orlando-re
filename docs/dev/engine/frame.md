# Who finishes an "async" operation in a `Game_Run` frame

For every macro command the macro can wait on: who increments `g_macroPending` `0x723c70[i]` and clears `g_macroRunnable` `0x6c26b8[i]`, who releases them, on which event, and in which step of the frame. The frame steps and the full list of writes in `Game_Run` are in [game_loop.md](game_loop.md). Waiting itself is in [scripts.md](scripts.md).

## The rule

- **Start** (step 20, `Script_ExecStep` `0041a330`): the command increments the macro's counter and, usually only with the `-` flag, clears `runnable`. A macro with `runnable = 0` is skipped in step 20.
- **End** (steps 25–31, after the interpreter): `pending−−`; if `pending < 1` then `runnable = 1`. The released macro runs its next command in step 20 of the **next** frame.
- The counter belongs to the macro, not to the operation. An actor remembers one macro, the last one that started its operation (`g_jackWalkMacro` `0x8aca1a`, `g_jackInsMacro` `0x54d6e0`, `g_jackTurnMacro` `0x851d00`, `g_personWalkMacro[p]` `0x8ab798`, `g_personInsMacro[p]` `0x534fe8`, `g_objAnimMacro[a]` `0x51f8a0`, `g_talkMacro` `0x7c7a52`). A new operation of the same actor overwrites the index. The earlier macro never gets its `pending−−`.
- Only the start of a macro (`Script_FindMacro` `0040d8b0`, through `Script_StartMacro` `004247c0`) and `REACTIVESELF` (`0041a330` case 0x94, `0042197e`) zero the counter. The counter can go below zero (the operation ends after the macro restarted). The test `< 1` still releases the macro.

## Command → who finishes it

"Start" is the write in `Script_ExecStep` (`runnable = 0` / `pending++`). "End" is the write of `pending−−` / `runnable = 1` in `Game_Run` (`0042b6d0`). "Frame" is when the macro runs its next command relative to the frame in which the operation ended.

| Command | Start: when it counts, whether it waits | Start | Who finishes it, and the event | End | Step | Frame |
|---|---|---|---|---|---|---|
| `WALKTO JACK` (0x07) | `pending++` only when `Jack_WalkToPoint` started (`g_jackWalkStarted` `0x8ab668`); with `-`, `runnable = 0`; `g_jackWalkCounted` `0x8a1781 = 1` | `0041b3d4` / `0041b3f3` | Jack's walk: the step in which Jack is at the last point of the path (`g_walkPathIndex ≥ len−1`, the distance stopped shrinking) — the position is the target; the macro at `0x8aca1a` is active and `0x8ab668` | `004319f6` / `00431a18` | 27 | next |
| same, the turn before the last segment | as above | as above | the turn sequence ends while Jack is "walking", and calling `Jack_WalkToPoint` again did not start (Jack is already at the target), `0x8a1781` and the macro is active | `00431759` / `0043177b` | 26 | next |
| `WALKTODIR JACK` (0x17) | **always** `pending++` (no `Walk_FindPath`, straight `Jack_WalkToPoint`); with `-`, `runnable = 0` | `0041b7a5` / `0041b8b1` | like `WALKTO JACK` (steps 27 / 26) | `004319f6`, `00431759` | 27 / 26 | next |
| `WALKTO` / `WALKTODIR` of a person | `pending++` when the person was found (`a ≥ 0`); with `-`, `runnable = 0` | `0041b4bc` / `0041b4db`, `0041b923` / `0041b99a` | the person's walk step: at the start of the step `|dx| < 10` and `|dy| < 5` and not `SHOWFRAME` → `g_personMoving = 0`. The step still moves the person and draws a frame ([persons.md](persons.md)) | `00433f70` / `00433f9c` | 29 | next |
| `RUNINSERTION JACK` (0x08) | when `Ins_Find` found the section: with `-`, `runnable = 0`, `pending++`, `g_jackInsDelay = 0` | `0041b5ed` / `0041b60c` | Jack's insertion: the step **after** the last frame (`cur + 1 > end`), one delay of `g_insFrameDelay` after it was drawn. It draws nothing | `00432b42` / `00432b64` | 28 | next |
| `RUNINSERTION` of a person | the same (the person's step counter is not cleared) | `0041b6fa` / `0041b719` | the person's insertion: the step after the last frame (`cur + 1 > end`). It draws nothing | `004353ba` / `004353e6` | 30 | next |
| `INITFIRST` Jack / person (0x03) | **does not count and does not wait**. Sets `g_insReleaseEarly` `0x8f5dcc = 1` | `0041a88c`, `0041aa1e` | the first insertion step that draws a frame turns the insertion off and sets `runnable[the insertion's macro] = 1` without `pending−−` (point 3) | `00433ce1`, `0043634a` | 28 / 30 | — |
| `ANIMA` mode 1 (0x05) | **always** `pending++` (the flag does not matter); with `-`, `runnable = 0` | `0041afd7` / `0041b020` | the animation step draws the picture and adds the step to the picture index. At or past the picture count, or below 0, it ends **in the same step** as the last picture | `00437ece`, `00437f94` | 31 | next |
| `ANIMA` mode 3 (`.REC`) | as above | as above | draws the picture, adds the step to the position. At or past the length, or below 0, it ends in the same step as the last picture. **No** release when `STOPANIMAFRAME` or `STOPANIMANEG` stops it (point 2) | `00437aa7`, `00437b8f` | 31 | next |
| `ANIMA` mode 5 (`.FLX`) | as above | as above | the FLX frame counter `0x871ad4` (zero at the start, `0041ae28`) reached the frame count from the header `0x8ab8d0` (`0041ae4c`), in the step that decodes the last frame | `0043767a` / `004376ac` | 31 | next |
| `ANIMA` modes 2/4/6 | does not count (an endless loop); with `-`, `runnable = 0`, so the macro waits **forever**. In the data only `+` occurs | `0041afd7` | nobody | — | — | — |
| `ROTATETO` (0x77) | when the turn started (`g_jackTurning`): **always** `runnable = 0`, `pending++`, `g_turnMacroWaits` `0x55155e = 1`. The `-` flag does not matter | `0041fdfb` / `0041fe1a`, `0041fe2c` | the turn sequence ends (the last animation, [turn.md](turn.md)), when `0x55155e` | `004317ae` / `004317d0` | 26 | next |
| `STAY` (0x4a, `Script_Stay` `0041a140`) | when a turn from the old direction started: like `ROTATETO` (apart from a call with `9999`) | `0041a239` / `0041a258`, `0041a26a` | as above | `004317ae` | 26 | next |
| `TALK` / `TALKRANDOM` / `TALKRANDOMINDEX` with `-` | `runnable = 0` (no counter), `g_talkNoResume = 0`, `g_talkMacro` | `0041bd89`, `0041cfb6`, `0041d310` | the line ends in `Talk_FaceStep` `00413e20`: `runnable[g_talkMacro] = 1` when `!g_talkNoResume` | `Talk_FaceStep` | 25 | next |
| `DIALOG` (0x0c) | always `runnable = 0`, `g_talkNoResume = 0`, `g_talkMacro = i` | `0041bede` | choosing an answer (step 23, `Dialog_MenuPointer`) starts the answer's line (`Talk_Begin`). The macro runs at the **end of that line** (step 25) | `Talk_FaceStep` | 23 → 25 | next |
| repeating (`SHOWFACE`, `MUSIC`, `WAITWHILE…`, `DONOTHING`, `PAUSE`, `PICKUP`, `GIVE`, `SHOOTF`, `SLAPF`) | `pc − 1`, no counter | — | the command itself checks the condition in step 20. State changed in steps 25–31 of frame N is seen in step 20 of frame N+1 | — | 20 | next |
| `RUNAVX`, `GOTOSCENE`, `RUNFILMP` / `RUNGLOBALFILMP`, `EFFECT`, `ANIMAEFFECT` | they do not wait on the counter: a scene change (step 22), or a movie played inside the command (the game loop stands still), or a sound with no wait | — | — | — | — | — |

Every release from `Game_Run` is **after** step 20, so no macro runs in the frame in which its operation ended. The order of releases in one frame: the line (25) → Jack's turn (26) → Jack's walk (27) → Jack's insertion (28) → person walks 0…k (29) → person insertions 0…k (30) → object animations 0…a (31). That order matters only for the flag `0x8f5dcc` (point 3). Every other release finishes before the next step 20, so their order does not change the result.

**The start and the first step are in the same frame.** The interpreter (step 20) is before steps 26–31, and `WALKTO JACK`, `WALKTODIR JACK`, `RUNINSERTION JACK`, `INITFIRST` (Jack: `g_jackInsDelay = 0`; a person: `g_personTimer = 0`) and `STAY` with a turn clear the step counter. The first step of the operation (an insertion frame, a walk step) falls in the **same** frame as the command. A person's `RUNINSERTION` and `ANIMA` do not clear the counter (`ANIMA`: the counter is the delay). The first step comes after a full delay.

## 1. `WALKTO JACK` when Jack is already at the target does not stick. `WALKTODIR` does

`Jack_WalkToPoint` (`004114b0`) when the distance to the target is under 15 times the scale and under 6 times the scale puts Jack on the target, sets `g_jackWalkStarted = 0` (`00411992`), and returns without starting a walk (and without changing `g_jackWalking`).

- `WALKTO JACK`: `pending++` and `runnable = 0` are **inside** `if (g_jackWalkStarted)`. When the walk did not start, the macro counts nothing and runs the next command on the next frame. It does not stick.
- `WALKTODIR JACK`: `Jack_WalkToPoint` with no path, then **always** `pending++` (with `-` also `runnable = 0`) and `g_jackWalkCounted = 1`. When Jack is already at the target and is not walking (step 27 requires `g_jackWalking`) and is not turning (step 26), nobody decrements the counter. A macro with `-` **waits until a restart**. With `+` it is left with a counter of 1 and sticks on the next command that has `-`. In the data `WALKTODIR JACK` occurs 232 times, always with `-`. Whether any call hits Jack already standing at the target was not checked.
- The step-26 path (`00431759`) is the second "already at the target" case: the turn before a segment moved Jack (`TURN_SHIFT`), and calling `Jack_WalkToPoint` again after the turn did not start. Then `g_jackWalkCounted` counts (set by both commands, cleared by a player click `004300ed` and by `Jack_WalkTo` `0042a370`). Step 27 does not fire, because it requires `g_jackWalkStarted` (`004319d1`). The two paths exclude each other. There is no double `pending−−`.
- Step 27 releases only an **active** macro (`g_macroActive[0x8aca1a]`). The walk of a `+` macro that has already finished does not change the counter, but a restart zeroes it anyway. The player cannot click a walk in the meantime (a macro without `UNLOCK` blocks the player). With `UNLOCK`, a walk from a click arrives with `g_jackWalkStarted = 1` and decrements the macro under `0x8aca1a`. That practical effect is a hypothesis. It was not met in the data.

## 2. `STOPAT` on the last `.REC` position does not occur in the data

"STOPAT" is `STOPANIMAFRAME` (0x39, `g_objAnimStopAtOn` `0x722f28`, `g_objAnimStopAt` `0x6d5f38`). In step 31, after `position += step`, the stop test is **before** the end test. When `position == stopAt` the animation stops (`active = 0`, the state is remembered as for `STOPANIMA`), and the end branch with `pending−−` does not run at all, even when `stopAt` is the last position or a position past the end. `STOPANIMANEG` (0x3b, `g_objAnimStopAtMarker`) does the same: a negative picture in the `.REC` stops the animation without `pending−−`. `STOPANIMA` does not change the counter either. A waiting macro (`-`) on an `ANIMA` in mode 1, 3, or 5 that was stopped by any of these waits until a restart. With `+` it is left with the counter.

In the data `STOPANIMAFRAME` has 0 uses. `STOPANIMANEG` (309 uses) always stops a looping animation (mode 4, started with `+` in `[INIT]`), then the macro waits with `WAITWHILEANIMA` and only then starts `ANIMA … 3 … -` (for example SC076 and SC031). The marker therefore does not hit a counted animation, provided the loop is active at the moment of `STOPANIMANEG` and the `.REC` has a negative value. The marker is not cleared by a new `ANIMA` (case 4 does not zero it). Stopping a counted animation does not occur in practice. It is a dead path, not a bug of the game.

## 3. The shared flag `0x8f5dcc` is set only by `INITFIRST`

`g_insReleaseEarly` `0x8f5dcc` has three writes of one or zero outside steps 28 and 30: `INITFIRST JACK` (`0041a88c`), `INITFIRST` of a person (`0041aa1e`), and the clear at the start of a scene (`0042c801`). `RUNINSERTION` does not set it. Steps 28 (`00433cc8`) and 30 (`00436328`) read it, both **after drawing an insertion frame**: `active = 0`, `runnable[the insertion's macro] = 1`, the flag = 0. `INITFIRST` means "show the first frame of the insertion and stop".

- The **first insertion that draws a frame in this frame** consumes the flag. Jack is before the persons, and the persons are in index order. A person's `INITFIRST` clears her step counter, so her first frame falls in step 30 of the same frame. The flag is still there for her, unless a step of Jack's insertion ran in step 28 of that frame.
- The macro the flag "releases" is the index stored on the actor. `INITFIRST JACK` does **not** set `g_jackInsMacro` (a person's does: `0x534fe8[p] = i`). What is released is the macro of the last `RUNINSERTION JACK` (or none, because the `INITFIRST` macro was not waiting), without `pending−−`.
- Collisions, matching the code, occurrence in the game not checked.
  - two `INITFIRST` before the first frame (both in `[PRE]`, for example SC116) or in two macros in the same frame: only the first insertion stops. The second plays to the end (and at the end does `pending−−` on a macro that did not count — a negative counter);
  - a person's `INITFIRST` in a frame where a step of Jack's `RUNINSERTION` is running (or of a person with a lower index): someone else's insertion takes the flag. It is cut after the current frame, its macro starts (`runnable = 1`) with the counter still ≥ 1, so it sticks at the next `-`, and the `INITFIRST` insertion plays to the end.

## Other cases that change the order of events

- **A turn cancelled by a walk.** `Jack_WalkToPoint` at the start of a walk (`00411a08`) and `Jack_TurnFromTo` (`00410909`) clear `g_turnMacroWaits`. When, during a turn from `ROTATETO` or `STAY`, another macro (or a corner of the path) starts a walk or a new turn, the end of the sequence does not release the turn's macro. It waits until a restart.
- **A second operation of the same actor** before the first one ends (for example SC007: `RUNINSERTION … +`, `DONOTHING 120`, `RUNINSERTION … -`): the counter is 2, and only one end arrives, so the macro waits until a restart. Whether the first insertion finishes in time depends on the frames per tick (`DONOTHING` counts frames). The original does this too.
- **The last line overwrites `g_talkMacro`.** See [play.md](play.md).

## Compared with the engine

The engine (`packages/engine/src/play/game.ts`, `packages/engine/src/play/host.ts`, `packages/engine/src/scene/player.ts`, `packages/engine/src/script/interpreter.ts`): `update()` every 15 ms tick — `ScenePlayer.tick()` (Jack, persons, animations), then the events `jackArrived` / `jackInsertionEnded` / `personArrived` / `personInsertionEnded` / `animEnded` / `jackTurnEnded` → `SceneHost.finish(key)` → `Interpreter.complete(macro)` (`pending` minus 1; at 0 the macro runs). Then `frame()` — lines (`DialogController.frame`), the click, **one step of the macros** (`Interpreter.tick`), and after it `ScenePlayer.firstSteps()` — the first step of operations started in this step (like steps 26–31 after step 20). The event key (`jack:walk`, `jack:ins`, `jack:turn`, `person:i:walk`, `person:i:ins`, `anim:NAME`) remembers one macro, the last one that started the operation, like the actor indexes in the game. The order of finishing operations matches `Game_Run`. See [play.md](play.md).

| Command | The engine | Match |
|---|---|---|
| `WALKTO JACK` | waits only when the walk started; the end is `jackArrived` in the walk step | matches |
| `WALKTODIR JACK` | straight to the point, always waits; Jack at the target → the macro hangs | matches (including the original bug) |
| a person's walk | `walkArrived` from `walkStep` (the condition `|dx| < 10` and `|dy| < 5` at the start of the step; the step continues) | matches |
| `RUNINSERTION` Jack / person | `insertionEnded` on the step after the last frame (`cur + 1 > end`) | matches. A person's `RUNINSERTION` leaves the step counter alone, as the original does |
| `INITFIRST` | the shared flag `0x8f5dcc`; the first insertion that drew a frame stops, and the macro in the slot gets `runnable = 1` without `pending−−` and without an end event | matches (the collisions in point 3 too) |
| `ANIMA` 1/3 | `animEnded` "end" in the step of the last picture | matches |
| `ANIMA` 5 (FLX) | `animEnded` after `play.step().finished` | matches as to the step (not checked frame by frame) |
| `ANIMA` stopped (`STOPANIMANEG`, `stopAt`) | "stop" does not release the macro | matches |
| `ANIMA` 2/4/6 with `-` | `done`, the macro does not wait | **different**: the original clears `runnable` forever. Absent from the data |
| `ROTATETO` / `STAY` | the turn, the macro blocked regardless of the flag until `jackTurnEnded`; a new walk or turn cancels the wait | matches |
| `TALK …-`, `DIALOG` | `DialogController`: the release is in `frame()` **before** the macro step | the order relative to step 20 differs (below). The result is the same |
| a negative counter | `complete` clamps to 0 (`Math.max(0, …)`) | **different** only when a macro restarts during its own operation (the original: −1, and the next `-` releases after the first end) |

What remains:

1. **The release after a line is before the macro step.** In the game `Talk_FaceStep` (step 25) is after step 20, so the macro runs on the next frame. In the engine `DialogController.frame` is before `Interpreter.tick` of the same frame. Between them in the game there are no steps that could change anything (steps 26–31 of that frame do not concern the line's macro), so the difference is one game frame (at least 10 ms), with no change of order.
2. **`ANIMA` 2/4/6 with `-`** and **a negative counter**, as in the table. No effect in the data.

The order of releases among actors in one engine tick (Jack: insertion and walk → each person: walk then insertion → objects) differs from the game (every person's walk before every insertion). No release depends on another except the flag `0x8f5dcc`, which the engine reproduces in the game's order (Jack `00433ce1`, then the persons `0043634a`).
