# Jack's gestures: `PICKUP`, `GIVE`, `SHOOTF`, `SLAPF`

Four script commands play a short **global insertion** of Jack (a section of `GLOBAL.ICS`, pictures from `GLOBAL.PAK`) and make the macro wait for it to end. Code: `packages/engine/src/gestures/gestures.ts`. The host is `packages/engine/src/play/host.ts`.

| Command | code | `Script_ExecStep` `0041a330` | Uses (every scene) |
|---|---|---|---|
| `PICKUP n` | 0x90 | case 0x8f | `n` = 0: 81, 1: 82 |
| `GIVE n` | 0x92 | case 0x91 | 0: 223, 1: 185, 2: 38, 3: 87 |
| `SHOOTF n` | 0x93 | case 0x92 | 0: 76, 1: 76 |
| `SLAPF n` | 0x94 | case 0x93 | 0: 74, 1: 74, 2: 75 |

`n` is `a[0]` (`[0x29]` of the command record). Counted across every scene archive. No other `n` occurs in the data.

## Starting an insertion: `Ins_StartGlobal` `00403110`

`Ins_StartGlobal(name, direction, scaleMultiplier)` loads the section (`Ics_LoadSection`), sets `g_jackInsFrame`…`g_jackInsEnd`, `g_jackInsFromScene = 0` (a global insertion), `g_jackInsDir = direction`, `g_jackInsActive = 1`, the scale multiplier `0x69ece0`, and the **full** delay `g_jackInsDelay = g_insFrameDelay`. The first frame comes after one delay ([animation.md](animation.md)).

The gesture scale multiplier is always **1.0** (`push 0x3f800000`), including the continuation in `Game_Run` (`00432c1a`: `68 00 00 80 3f … e8`, `add esp, 0xc`; the recovered listing drops the third argument there). The frame scale is Jack's scale × 1, clamped to 0.1…1 (`0043302c`, [animation.md](animation.md)). Calls go through the stub `00401974` (a jump to `00403110`).

All 102 names below exist in `GLOBAL.ICS`.

## Choosing the insertion

`g_jackDir` (`0x8f6916`): 0 front (D), 1 profile (L), 2 back (U), 3 three-quarter front (LD, "34P"), 4 three-quarter back (RU, "34T"). `g_jackFacing` (`0x504780`, ±1) is the mirror. `g_jackUniform` (`0x8f68d9`) is the uniform.

**`PICKUP n`** (insertion direction = `g_jackFacing`). The suffix is `0` when `n == 0`, and `1` for **every other** `n`:

| dir | civilian | uniform |
|---|---|---|
| 0 | `PP_D0/1` | `PM_D0/1` |
| 1 | `PP_L0/1` | `PM_L0/1` |
| 2 | `PP_U0/1` | `PM_U0/1` |
| 3 | `SC34P0/1` | `PM_LD0/1` |
| 4 | `PP_RU0/1` | `PM_RU0/1` |

`0` is the bend, `1` is the return. Taking the bottle is `PICKUP`, then `TAKE`, then `PICKUP 1`.

The column is `g_jackUniform`. The engine takes it from `turning.uniform` (`SceneHost.jackInfo`), which `EXTRA 6` and `EXTRA 8` set together with the walk and stand frame set (`JackAnimator.uniform`, [animation.md](animation.md), the uniform).

**`GIVE n`** (direction = `g_jackFacing`): `<phase>_<DP|DM>_<D|L|U|LD|RU>`. The phase is `DAJE_DO_WYC` when `n == 0` (reach into the pocket and hand it over), `CHOWA_WYC` when `n == 1` (put it away), `STAY_DO_WYC` when `n == 2`, and **every other** `n` is `OPUSZCZA_WYC` (lower the hand). `DP` is civilian, `DM` is the uniform.

**`SHOOTF n`** — only for `g_jackDir` 1, 3, and 4, and only `n` 0 (aim) or 1 (lower). The side is in the name, and the insertion direction is **always 1**:

| dir | `g_jackFacing == 1` | otherwise |
|---|---|---|
| 1 | `SPPRL<n>` | `SPPRP<n>` |
| 3 | `SPSPL<n>` | `SPSPP<n>` |
| 4 | `SPSTP<n>` | `SPSTL<n>` |

In direction 4 the letters are reversed relative to directions 1 and 3. That is what the code does. The uniform uses `SW…` instead of `SP…`.

**`SLAPF n`** — only for `g_jackDir` 1, 3, and 4. `n` 0 raises the fist, 1 is the guard (looping), 2 lowers it. Direction = `g_jackFacing`: dir 1 `BOPRO<n>`, 3 `BO34P<n>`, 4 `BO34T<n>`. The uniform uses `BW…`.

## State `0x6d5060` (`g_gestureState`)

0 is nothing, 1 is a gesture insertion in progress, 2 is a global insertion that has finished, 3 is `SLAPF 1`: the guard looping. `Game_Run` clears it at the start of a scene (`0042b6d0`).

**`PICKUP`, `GIVE`, `SHOOTF`** (the same code in three cases; `SHOOTF` at dir 0 or 2 does nothing and the macro continues, state unchanged):

1. State 1 → `pc − 1` (the macro repeats the command on the next frame).
2. State 0 → `Ins_StartGlobal(…)`, `pc − 1`, state 1.
3. State 2 → state 0. `pc` is unchanged. The macro continues.

State 3 matches no condition. The command does nothing and the macro continues (the guard keeps looping).

**`SLAPF`** (only dir 1, 3, or 4; otherwise nothing):

1. State 1 → `pc − 1`.
2. State 0 **or 3** → `SLAP = 1` (the game variable, `g_varValues[0x723d9e]`), state 1, start the insertion of phase `n`. When `n == 1`, also `pc + 1` and state 3. At the end, `pc − 1`. Net: `n == 1` means the macro **continues at once**. `n` 0 or 2 waits.
3. State 2 → state 0, and the macro continues.

`SLAPF 2` in state 3 breaks the guard loop (a new insertion replaces the current one) and waits for it to end.

**The end of a global insertion** (`Game_Run` `004328bc`…`00433cff`, when `cur + 1 > end` and `g_jackInsFromScene == 0`) applies to **every** global insertion of Jack, including idle (`KLPRO`, `MONETA`, and the rest): `g_jackIdleIns = 0`, `g_jackInsActive = 0`, `g_jackInsFromScene = 1`, `SLAP = 0`, `SHOOT = 0` (`g_varValues[0x8a1782]`), then:

- State 3 → start the continuation `BOPRO1` / `BO34P1` / `BO34T1` (uniform `BW…`) for the current `g_jackDir` (another direction: nothing, the state stays 3), direction `g_jackFacing`, scale 1.0.
- Otherwise → state 2.

A **scene** insertion (`RUNINSERTION JACK`) ends on a different branch (`pending−−`) and does not touch the state.

### When the macro continues

The command checks the state at step 20 of the frame. The insertion ends at step 28 ([frame.md](frame.md)). An insertion of `k` frames: it starts in frame N (step 20), the first picture is after `g_insFrameDelay`, and the "end" step (`cur + 1 > end`) is one delay after the last picture. On the next frame the command sees state 2 and the macro runs the next command. `JackAnimator` counts the exact number of frames (the same as `RUNINSERTION JACK`, except the start uses the full delay). The macro moves **one frame after** `insertionEnded`.

### What the chapter-1 macros do

- **The bottle (SC009 / SC010):** `PICKUP` (he bends and waits), `TAKE`, `PICKUP 1` (he stands and waits). Jack bends for the bottle.
- **`STRZELANIE-*`:** `SHOOTF` (he aims and waits), `TALKRANDOM` (the other character speaks one line), `SHOOTF 1` (he lowers the gun). Jack aims the revolver and the other character answers with one line.
- **`UDERZENIE-*`:** `SLAPF` (the fist goes up and waits), `SLAPF 1` (the guard loops and **does not wait**), `TALKRANDOM` (the other character speaks while Jack holds the guard), `SLAPF 2` (he lowers it and waits). The guard and one line of reaction.

### Original quirks (reproduced, with one fix)

- Every finished global insertion sets state 2, including idle. If the player waits until Jack finishes an idle animation, the next gesture command sees state 2: it clears it and **skips the gesture** (for example `PICKUP` with no bend, then `PICKUP 1` only stands up). Picking up the bottle after idle cuts the bend. The engine does not reproduce this by default. `globalInsertionEnd` sets state 2 only when a gesture is waiting (state 1). In state 0 it stays 0, so a gesture after idle plays in full. `SLAP` and `SHOOT` are cleared as in the original. The original behavior is `new Gestures({ originalIdleBug: true })`.
- `SHOOTF n` with `n > 1`, or `SLAPF n` with `n > 2`, sets state 1 with no insertion. The macro hangs. It does not occur in the data.
- `SLAP = 1` is visible only until the end of the first insertion. In the guard loop it is already 0.
- `RUNINSERTION JACK` during a gesture (state 1) would replace the global insertion with a scene one. The end takes the scene branch, the state stays 1, and the gesture macro hangs. That follows from the code. It was not searched for in the data.

### Idle and gestures

Jack's automatic idle (`g_idleFrames` > 1500, [animation.md](animation.md)) is a **separate** mechanism in `Game_Run` (`0042cd90`…`0042cfed`), not a gesture command. It does not touch `g_gestureState`. It starts a global insertion with the same `Ins_StartGlobal`. They share only the end of a global insertion, which is where the "gesture skipped after idle" bug comes from, and where `Gestures` fixes it. In the engine, idle is `ScenePlayer.idleCheck`. Its end reaches `globalInsertionEnd` through `GameHost.jackInsertionEnded`, like every global insertion.

## API (`packages/engine/src/gestures`)

```ts
const g = new Gestures(); // one per game; g.reset() at the start of a scene
const jack: JackInfo = { dir, facing, uniform };

// in host.command for codes 0x90, 0x92, 0x93, 0x94:
const s = g.command(cmd.code, cmd.a[0], jack); // undefined for other codes
if (s.vars) for (const [k, v] of Object.entries(s.vars)) setVar(k, v);
if (s.start) animator.startInsertion(globalInsertion(globalIcs, s.start.name, s.start.facing, s.start.scaleMul)!);
return s.result; // "repeat" | "done"

// when JackAnimator reports insertionEnded for a global insertion (any of them, including idle):
const e = g.globalInsertionEnd(jack);
setVars(e.vars); // SLAP = 0, SHOOT = 0
if (e.start) animator.startInsertion(globalInsertion(...e.start)!);
```

Pure functions: `pickupInsertion`, `giveInsertion`, `shootInsertion`, `slapInsertion` (`null` means no insertion), `weaponDir`, `allGestureInsertions()`. `GESTURE_CODES` is the command codes. The host starts the insertion (`globalInsertion` from `packages/engine/src/anim/assets.ts`). `GlobalInsertionRequest.facing` is `g_jackInsDir`.

Report the end of **every** global insertion of Jack (a gesture, the guard, idle) to `globalInsertionEnd`. Clearing `SLAP` / `SHOOT` and the guard loop depend on it, as in the original. The idle-bug fix lives in the module (`new Gestures()` by default). The host does not have to tell insertions apart. Do not pass `originalIdleBug: true`. Do not report scene insertions (`RUNINSERTION JACK`). The guard continuation starts in the same step the previous insertion ended (no gap frame).

## Tests

`packages/engine/src/gestures/gestures.test.ts` is synthetic, with no game files: every variant (directions, the uniform, the side, an unknown `n`), the state machine with a stand-in host (the bottle, aiming, the slap with the guard loop), state 3 when the direction changes, a gesture skipped after state 2, and a hang on a bad `n`.
