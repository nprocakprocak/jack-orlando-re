# CHKDISTANCE — Jack steps out of a character's way

`Jack_AvoidPerson` (`0042a7f0`, called through the thunk `00401785`), `cdecl(short x, short y, short p)`. The recovered C drops the floating-point arguments (`__ftol()` with no parameters), so everything below follows the disassembly of `0042a7f0`..`0042ac8b`. Implementation: `packages/engine/src/persons/avoid.ts` (`avoidPerson`, `escapeCandidates`, `startAvoidWalk`, `applyStand`).

## The command and the calls

- `CHKDISTANCE person v` (opcode `0x97`) sets the byte `g_personCheckDistance` (`0x6c1894[p]`). Only "not zero" matters (`movsx` plus `test`). The value is not a threshold. In the scripts `v` is 1 (on) or 0 (off).
- The data has 11 uses in 7 scenes, all with `v` in {0, 1}: SC005B (`KOBD`, PRE), SC018 (`DZIAD`, `ROB`), SC032A (`POLB`), SC033 (`KOBIETA`, `MENHOT`, PRE), SC034 (`MZW`), SC037 (`SPRZATACZKA`, PRE), SC052 (`GOPA`, PRE). `PRE` macros turn the flag on for the whole scene. In SC018 (`DZIAD`) and SC032A (`POLB_ODCH`) a macro turns the flag on and later off. Hypothesis: it turns off as the character leaves.
- Two call sites in `Game_Run`, both `Jack_AvoidPerson(ftol(personX[p]), ftol(personY[p]), p)`, under `g_macroPlayerLocked == 0` and `checkDistance[p] ≠ 0`:
  1. `00434164` — a **character step** (`x += vx·scale`, `y += vy·scale`), only when not `SHOWFRAME`.
  2. `004352fb` — the **character insertion** loop (`g_personInserting[p]` and the frame counter `< 1`), so also during an insertion. Then `vx, vy` are the last values from the walk.
- The check has no counter of its own. It runs on every step and every insertion frame of the character.

## The algorithm (`x, y` integers, `p` the character, `J` Jack)

The character's reference point is **its shadow**: `dx = f32(shadowDx[p]·scale[p])`, `dy` the same (`0x851d08` / `0x851d34`, `SETSHADOW`), `px = ⌊x+dx⌋`, `py = ⌊y+dy⌋`. `R = f32(g_jackScale·200)` (`0x4f7ee0`). `jx, jy` are Jack's position truncated to integers.

1. **Condition:** `FUN_0047ec00(px,py,jx,jy) < R` and `g_jackAvoiding (0x6d5f0d) == 0`. The distance is `⌊√(Δx² + (3·Δy)²)⌋` — an ellipse, vertical ×3. Otherwise nothing. The test is **strict** (`<`).
2. `d1 = Geom_Dist(px,py,jx,jy)` (ordinary Euclidean). `d2` is the same for the position after **one more step** (`x+vx+dx`, `y+vy+dy`, `vx = 0x8f6828[p]`, `vy = 0x51f858[p]`). If `d1 < d2` (the character is moving away) → **`Jack_Stand(g_jackDir)`** (`004150f0`): Jack stops where he is (the walk is off, the rest of the path is dropped). Flag `0x6d5f0d` is **not** set. If `d1 ≥ d2` (approaching, or equal) → step 3.
3. **Four candidates** `{x, y, rank}` at `0x88f64c + 6·i`:
  - 0: `a = (⌊−vy⌋, ⌊vx⌋)` (a zero becomes 1), `n = f32(√(a₀²+a₁²))`; `(⌊a₀·R/n + Jx⌋, ⌊a₁·R/(3n) + Jy⌋)` — a point at distance `R` from Jack, perpendicular to the character's step (y flattened ×3). Rank = `Geom_Dist(candidate, px, py)`.
  - 1: the same with `a = (⌊vy⌋, ⌊−vx⌋)` (the other side; `n` from candidate 0). Rank the same way.
  - 2: `(⌊Jx − 250·s⌋, ⌊Jy⌋)` (`0x4f7ed8` = 250, `s = g_jackScale`). **Rank = ⌊250·s⌋**.
  - 3: `(⌊Jx + 250·s⌋, ⌊Jy⌋)`, rank `⌊250·s⌋`.
4. `FUN_0042a640` sorts them **by rank, descending** (bubble sort, 4×3 comparisons, a swap only on a strict `>`, so ties keep the order 0, 1, 2, 3). Ranks 2 and 3 are constant (250·s). Ranks 0 and 1 are real distances of at most about `R`, so in practice **the side candidates (left, then right) come first**, and the perpendicular ones only when the side ones are blocked. Whether that order was intended is unknown. Jack always tries the side first.
5. The first candidate for which `Object_FindAtPoint(x,y)` finds nothing (not inside an object's outline) and `Walk_FindTriangle(x,y) ≠ 0` (on the walk area): `Jack_WalkTo(x,y)` (`0042a370` — the same path as a click: `Walk_FindPath`, falling back to the nearest walk point, then smoothing) and **`0x6d5f0d = 1`**. No free candidate → nothing (the flag stays 0, so the character's next step tries again).

## Flag `0x6d5f0d` (`g_jackAvoiding`)

Set only here. Cleared on scene init (`Game_Run`), on a **click** that starts a new walk, and on **reaching the end of the path**. Besides blocking further avoids, it sets `g_jackInsDelay = 2` instead of `g_insFrameDelay − WalkSpeed`. Jack walks aside **faster** (a step every 2 ticks instead of 4; see [walk.md](walk.md)). An avoid is one walk until he arrives. After that the flag returns to 0 and the next approach starts another.

## In the engine

`avoidPerson(jack, person, world, busy)` returns `none | stand | walk{target}` with no side effects. After every character step and every frame of that character's insertion, when the player is not locked and `person.checkDistance` is set:

- `stand` stops the walker and plays the standing pose of `walker.dir`.
- `walk` starts the avoid walk and sets `jackAvoiding`. Set the flag even when `startAvoidWalk` returns false. The original sets the flag after `Jack_WalkTo` unconditionally. Clear it when a click starts a walk and when that walk ends. While `jackAvoiding`, Jack's step counter is 2 (`stepTicks`). `person.velX` / `velY` are `cos·speed` and `sin·speed·0.3` (see [persons.md](persons.md)).

Not in the engine: `Script_InterruptOutMacros` from `Jack_WalkTo` is wired separately (below), and `DAT_0051f920` / `008979cf` (remembering the pose) are not.

## Open

- Whether `x, y` passed to `Jack_WalkTo` are computed before `Walk_FindTriangle` in the same scale. They are the same `short`. `Walk_FindTriangle` "≠ 0" means index + 1 (`004039e0`).
- How it looks in play (who passes whom) was left for a playing session. The side-first order is what the code does.

## An avoid and an action macro

`Jack_WalkTo` (`0042a370`) starts with `g_clickArmed = 0` and `Script_InterruptOutMacros(-1)` (`00427800`), always, even when there is no path. The "step aside" branch (step 5) goes through `Jack_WalkTo`, so **every sidestep ends the running `OUTMACRO` macros** and starts their destructor (`MACRODESTRUCTOR` or `~NAME`), the same as a click. The "stand" branch (`Jack_Stand`) does not touch macros. The macro keeps waiting for a click. In the engine the scene event `jackAvoidWalk` (`ScenePlayer.checkAvoid`) leads to `interruptOutMacros(-1)` in `packages/engine/src/play/game.ts`. The man from the lift (`MZW` in `SC034`) only triggers the ordinary avoid: Jack sidesteps and cannot be approached there. That matches the code. `MZW` has only `CHKDISTANCE`, no separate block. The effect on a macro depends on the branch (stand or step aside).
