# Movement: the path, the step, the direction, the draw order

How the original walks Jack across a scene's walk area: from a click, through the search and the smoothing of a path, to a step every few ticks, the choice of a direction, and the placement of the character against objects. The inputs (the triangles of the walk area, the object quads, the perspective, the `.ACE` zones) are in [scene.md](../formats/scene.md).

Implementation: `packages/engine/src/walk/` (`pathfind.ts`, `smooth.ts`, `geometry.ts`, `walker.ts`, `depth.ts`, `objects.ts`, `turn.ts`). The logic has no DOM and no animation frames. Those are in [animation.md](animation.md) and [turn.md](turn.md).

The code counts on x87. Values stored in `float` variables are rounded to float32. Intermediate expressions stay in double (a hypothesis: MSVC 53-bit precision). Conversion to integers is `__ftol` (truncation toward zero. NaN and overflow become `0x80000000`, and a store to a `short` keeps the low 16 bits). The engine reproduces that (`f32`, `ftol`, `s16` in `packages/engine/src/walk/geometry.ts`), because decisions on edges depend on it.

## A click

`Game_Run` `0042fd7e`…`004300ed`, when the player clicks the left button in the walking mode (no dialog, the state flags `0x8979ce` and `0x7cde78`, the cursor mode is not 20 or 21, and the rest of the conditions):

1. `Area_ClickMacro` `004243a0` of the click. A click in an `.ACE` zone. Zones are scanned **from the last**. The point test is `Area_Contains` `00412e40` (the half-planes of the zone's triangles, **with no** bounding rectangle, and the zone must be enabled, `0x871ad8` / `0x6aeefc`). In cursor modes 10–19 (`00424360`) only exit zones count (`Area_IsEnabledExit` `004242e0`). A hit starts the macro `<action>-<NAME>`, and **Jack does not walk**. A missing macro with the flag `0x57a982` starts the catch-all macro of that name. A zone named `WALKAREA` sets `0x7c7d1c` and blocks a walk from a click (SC085 and SC086. SC085 enables it with `IgnoreArea WALKAREA 0` and calls the show macro of that zone).
2. The clicked point must lie in the walk area (`Walk_FindTriangle`). **A click outside the area is ignored.** There is no projection onto the nearest point.
3. `0042feb4`: `xor eax,eax; test eax,eax; je`. A dead branch that would have walked straight to the click.
4. The start is Jack's truncated position (`g_jackX` / `Y` `0x7c7a54` / `0x7c7a60`). `Walk_FindPath(start, click)`.
5. No path means `Walk_NearestWalkable` `004056e0` from Jack's position (Jack is standing outside the area, for example after walking in from off screen), the flag `g_walkFromOutside` `0x6d505a`, and a second `Walk_FindPath`.
6. Still no path means `Jack_WalkToPoint(click)`: **a straight walk** to the goal, through anything (for example into a cut-off part of the area). It does not occur in the data. Every pair of triangle centers in every scene is connected.
7. A path means `Walk_SmoothPath(1)` `00405920`, then `Walk_InsertBlockedDetours` `0041a090` (dead, below). If the start was outside the area, `Walk_PathInsert(-1)` inserts Jack's position at the front.
8. `g_walkPathIndex` `0x6bd294` is 1, and `Jack_WalkToPoint(path[1])`. When the point is "already reached" (`g_walkSkipPoint` `0x7b3c20`), the same happens once more for `path[2]`.

**A `WALKTO` goal outside the walk area** (`Script_ExecStep` `0041a330` case 6, `0041b32c`…, `Jack_WalkTo` `0042a370`): the goal is **not** moved into the area. `Walk_FindPath` finds no path to a goal outside the area. `Walk_NearestWalkable` then moves only the **start**. The second `Walk_FindPath` also fails, and Jack walks **in a straight line** to the goal (`Jack_WalkToPoint`). That is how he leaves the alley of SC009: the show macro of the inward exit walks to a point inside the area, then to a point outside it (x below 447). Jack turns diagonally up and disappears behind the corner of the wall (the window `CHWINDOW JACK`). The engine used to move the goal to the nearest point of the area, so Jack stopped at the wall under the window. The engine: `planWalk(…, {anyGoal: true})`, `ScenePlayer.walkJackTo`.

`Jack_WalkTo` `0042a370` is the same procedure as a function (called by `0042a7f0`, `0042aef0`, and `0042afb0`, the approach to an object before an action), without condition 2. The script command `WalkTo` (`Script_ExecStep` `0041b32c`…) has its own copy of this logic.

The engine: `planWalk(world, from, click)` returns `{path, direct, fromOutside}` or `null` (point 2, or a cancel inside `Walk_SmoothPath`). `followPlan(walker, plan)` is point 8. Point 1, for exits only, is `exitAt(areas, p)`.

## Finding a path: `Walk_FindPath` `00459450`

The walk area is **hand-drawn, overlapping triangles**, not a grid. Neighboring triangles rarely share vertices. There are often gaps or overlaps between them (SC064, SC071). The graph is not built in advance. Crossing points between triangles are created during the search, from edge intersections.

`Walk_FindPath(start, goal)`:

1. For every triangle it computes the y range (`g_walkTriYRange` `0x9d1488`). `Walk_FindTriangle` uses it.
2. `g_walkBestLen` `0x9d16f0` is `0x7fff`, `g_walkFoundCount` `0x9d1620` is 0, `g_walkTriVisited` is cleared (400 bytes, 100 triangles), and `g_walkSearchDeadline` is `g_ticks14ms + 100`.
3. If the **goal** lies in the area: `Walk_SearchRec(start)` with that goal.
4. If the **start** also lies in the area: a second search the other way (`Walk_SearchRec(goal)`, the goal is the start), limited by the best length so far. If it found a shorter path, the result is reversed (`Point_Swap` `0045a450`).
5. The result is `g_walkPath` `0x898108` (packed `short x, y`) and `g_walkPathLen` `0x722ef8`. The first point is the start. The last is the goal.

### `Walk_SearchRec(p)` `00459700`

A depth-first search with pruning, over points:

```
if (nothing found yet, or g_ticks14ms < deadline) and depth < 100:
  push p (g_walkSearchStack 0x9d16f8), the segment length (Point_Dist 0045a020) into 0x9d1628
  if the stack length (Walk_StackLength 004593e0) + |p→goal| < the best:
  for each unvisited triangle t that contains p (Walk_FindTriangle from t+1):
  visited[t] = 1
  if the goal lies in t (the first triangle at or after t that contains the goal is t):
  push the goal, record the path (Walk_RecordPath 0045a0a0: a copy of the stack,
  best := length, found++), pop, visited[t] = 0, stop the loop over t
  for each edge of t: q = the intersection of the segment p→goal with the edge (00459d80)
  for each unvisited triangle that contains q: Walk_SearchRec(q)
  for each unvisited triangle u (all of them, not only the neighbors):
  candidates = vertices of u that lie in t, vertices of t that lie in u,
  intersections of every edge of t with every edge of u (00459d80)
  Walk_SpreadCandidates(candidates, p) (0045a110)
  for each: Walk_SearchRec(candidate)
  visited[t] = 0
pop p
```

- "Visited" applies only to the current branch. This is not Dijkstra. The search is exponential, limited by the length and by the time limit.
- **The time limit:** until something has been found, the search runs without end. After the first path it stops 100 ticks of `Game_Tick14ms` (1.4 s) after the start of `Walk_FindPath`. The result therefore depends on the speed of the computer. The engine: `findPath(..., {budget})` counts calls instead of time. The default has no limit (a full search). On the data a full search is at most about 214 thousand calls for one pair (SC209), and usually under 2 thousand.
- The length is the sum of truncated segment lengths (`short`).
- `Walk_SpreadCandidates` `0045a110`: each candidate is shifted by `1/(n+20)` toward the sum of all of them (`(Σ + 20·p) / (n + 20)`, integer division), which pulls points off the edges into the interior. Points within a distance of 2 of one already accepted are rejected. Then **one** pass of a bubble sort by the distance from `p` (not a full sort).
- The candidate array on the stack frame (`ebp-0x2c`) safely holds 8 points. The 9th overwrites the pointer to triangle `t`, and the ones after that overwrite the loop variables. The data has at most 7.
- Segment intersection `Geom_SegmentIntersect` `00459d80`: lines `y = m·x + c` (float32). A vertical segment gets `dx = 1/256`. Equal slopes mean no intersection. The result is truncated and checked against the rectangles of both segments (`Geom_InSegmentBox` `00459fb0`). Because of the truncation, an intersection with a vertical segment is sometimes lost and sometimes not, depending on the direction of the segment.

### A point in a triangle

`Walk_FindTriangle` (`004039e0`, described in [scene.md](../formats/scene.md)): the x range `x1`…`x3`, the y range, and three half-planes `Geom_PointBelowLine` (`00403430`). Edges are partly inclusive. The shared diagonal of a square belongs to one of the two triangles. `Geom_PointBelowLine` compares the product `(px−ax)·slope` **without** rounding to float32 (the disassembly at `00403480`: `fild; fmul; fild; fcompp`). `triangleContains` in the scene module rounds it (`f32`), which changes the result for a point exactly on an edge (for example a slope of 1/3 and the point (3, 1)). `packages/engine/src/walk/` therefore has its own `walkTriangleContains` and `findWalkTriangle`.

## Smoothing: `Walk_SmoothPath(mode)` `00405920`

On a path from `Walk_FindPath`:

1. `Walk_DropNearLine` `00403e60`: while some middle point lies closer than `g_walkNearLine` `0x503bac`, which is **6** px, to the line through its neighbors, remove it. The distance is `Geom_DistFromLine` `0047ecd0`: `|sin(atan(slope a→c) − atan(slope a→b)) · floor(|ab|)|` (truncated twice. A point 10 px from the line can measure 9).
2. A start inside an object's quad (`Object_FindAtPoint` `00405480`, valid quads only): replace it with the point from `Walk_EscapeQuad` `00404620` (the perpendicular projection onto the nearest edge, ±5 px on each axis outward). The original point returns to the front at the end of the smoothing.
3. A goal inside a quad: mode **1** (a click) means **an empty path, and Jack does not walk**. Mode 0 is like the start (the original goal is appended at the end).
4. **Detours around objects.** For each segment `i`:
  - `Walk_FindQuadEntry` `00404160`: the intersection of the segment with an edge of **any** object's quad that is nearest to `path[i]` (including an invalid quad, with no check of `0x5575a8`. That does not occur in the data), skipping the object of the last detour (`g_walkLastDetourObj` `0x534810`). The intersection test is `Walk_SegmentCrossesQuadEdge` `00403660`: float lines, and only the x range of both segments is checked. The entry point is pulled back by `50·s` px in x and `50·s·|round(slope)|` in y (`s` is `Persp_ScaleAtY`, the scale divided by 3).
  - `Walk_FindQuadExit` `004043f0`: the next intersection of the same quad on the segments `i, i+1, …` (not on the entry edge). The exit point is pushed `50·s` further.
  - `Walk_ChooseDetour` `00405140`: a forward detour (`004049c0`, the corners from the entry edge plus 1 to the exit edge) and a backward one (`00404d80`). Corners are pushed away from the center of the quad (the intersection of the diagonals, `g_sceneObjQuadCX` / `CY`) by `50·s` px. The cost is the length plus **2000** for each point outside the walk area. The cheaper one wins (a tie goes backward).
  - The path points between the entry and the exit are removed, the detour list is inserted (`Walk_PathDeleteRange` `00403f70`, `Walk_PathInsert` `00403fd0`), and the search continues from the exit point.
  - No exit (the segment ends inside the quad) means the original reads uninitialized variables. The engine skips the detour. It does not occur in the data.
5. **Shortcuts** (string pulling): for each `a`, and `b` from `a`: if the segment `path[a] → path[b+2]` is clear (`Walk_SegmentClear` `00405520`: points every 4 px from `path[a]`, not including the end point, outside the quads and inside the walk area), remove `path[a+1 … b+1]` and start `b` again.

Detours and their points may leave the walk area (the penalty of 2000 only discourages it). Jack then walks outside the triangles for a moment. In a simulation of every pair of triangle centers that is common near objects at the edge of the area (SC006, SC057).

`Walk_InsertBlockedDetours` `0041a090` walks triples of points and would insert a detour if `Walk_SegmentBlocked` `0041a070` returned anything. That function is a stub that returns 0. Dead code.

## The nearest point of the area: `Walk_NearestWalkable` `004056e0`

16 rays every 23° (0, 23, …, 345), a step of 5 px (`x += r·5·sin α`, `y += r·5·cos α`, sine for x), at most 200 steps. The first direction with the smallest step count wins. When no ray hits, the result angle is uninitialized. The engine returns `null`.

## A walk segment: `Jack_WalkToPoint(tx, ty)` `004114b0`

1. It remembers the direction and the mirror (`g_jackFacing` `0x504780` into `g_jackFacingPrev` `0x50478c`), and the segment goal `g_walkTargetX` / `Y` `0x7c739a` / `0x7c791a`.
2. The angle: `a = atan(((ty − y) / 0.3) / (tx − x))`, plus `3.141592` when `tx < x`. Degrees are `floor(a·180/3.141592)`, brought into 0…360 (0 is to the right, 90 is down). The multiplier 0.3 (`g_walkYSquash` `0x5046e4`) flattens the floor: a move of 10 px to the right and 3 px down is 45°.
3. The direction `g_jackDir` (`0x8f6916`) and the mirror come from the sectors `g_dirBound0`…`7` (`0x723c24`…, set at the start of a scene by `0042c205`: 22, 67, 112, 157, 202, 248, 292, 338):

 | Angle | `g_jackDir` | Mirror | On screen |
 |---|---|---|---|
 | 22…67 | 3 | −1 | down-right |
 | 68…111 | 0 | 1 | down (toward the player) |
 | 112…157 | 3 | 1 | down-left |
 | 157…202 | 1 | 1 | left |
 | 202…248 | 4 | −1 | up-left |
 | 248…292 | 2 | 1 | up (away from the player) |
 | 292…338 | 4 | 1 | up-right |
 | the rest | 1 | −1 | right |

  The bounds are inclusive, checked in this order. Natively, direction 1 looks left, 3 looks down-left, and 4 looks up-right. A script can force a direction (`g_walkDirForced` `0x86f986`, the code `g_walkDirForcedValue` `0x7c7a4e`: −3, 0, 3, 1, −4, 2, 4, and anything else goes to `forcedFacing`). A hypothesis: the commands `SetDirWalk` and `WalkToDir`.

  **The force lasts only until the first `Jack_WalkToPoint`.** `WALKTODIR` (`Script_ExecStep` `0041a330`, case `0x16`) sets `g_walkDirForced` just before the call and clears it just after. The call again at the end of a turn animation (`Game_Run` `0043170c`), and the later points, compute the direction from the angle. The init of SC033 with `LAST` equal to 63 (`WALKTODIR` toward the up-left, direction 4) forces a direction that contradicts the motion: Jack turns first (animation 4/−1 to 4/+1), and after the turn the direction returns to up-left, so he walks correctly. The engine used to hold the force until the end of the walk. `followPlanTurning` now clears it after the first start of a segment.

  **A turn started by the second call is cut off.** After `Jack_WalkToPoint` at the end of a turn (`0043170c`), `Game_Run` sets `g_jackTurning` to 0 unconditionally (`00431782`), so a turn that this call started (`Turn_Start`) never plays. Only the new direction and the mirror remain, and Jack walks on at once, with no shifts. In SC033 with `LAST` equal to 63: one turn in place (4/−1 to 4/+1, the animations `0x14` and `0xd`, about 35 ticks), then the direction from the angle (4/−1) with no second turn. The engine used to play that turn. `turningTick` now drops it (`tj.turn = null`).
4. The speed of a step: `vx = 12·cos a`, `vy = 12·sin a·0.3` (`g_jackVX` / `VY` `0x564004` / `0x5640c0`, `g_walkSpeed` `0x5046e2` is 12, set at the start of a scene by `0042c1d9`. A script can change it).
5. "Already there": `|tx − x| < 15·scale` and `|ty − y| < 6·scale` means Jack stands exactly on the goal, **recovers the previous direction and mirror**, and the walk does not start. If this is not the last point, `g_walkSkipPoint` is set.
6. Otherwise the "previous distance" is 10000, `g_jackWalking` `0x8f691c` is 1, and, when the direction changed, a turn animation starts (`004107c0`, with parameters that depend on the old and the new direction). See [turn.md](turn.md).

**The direction changes only at the start of a segment** (each point of the path) and after a turn animation ends (`Game_Run` `0043170c` calls `Jack_WalkToPoint` again for the same goal). It does not change during the walk.

## A step: `Game_Run` `004317dc`…`00431c1e`

A step runs when Jack is walking, the counter `0x8713f4` is at most 0, and no turn animation is playing (`0x7a849c`).

1. Reloading the counter: `g_insFrameDelay − WalkSpeed` (`g_insFrameDelay` `0x504794` is 4 in `.data`, but `00427800` sets 5 before a scene. `WalkSpeed` is the menu option, `g_cfgWalkSpeed` `0x9fa95e` is config +6, 1 by default), at least 1. It is `4` when a script set `0x6d9842`, and `2` when approaching an object (`0x6d5f0d`, `0042a7f0`). `Game_TimerTick` decrements the counter every 15 ms logic tick. At the defaults, **a step every 4 ticks (60 ms)**. An earlier description said `4 − WalkSpeed` (3 ticks), because it used the value from `.data`. The bytes at `00431800` settle it. The same counter also times insertion frames and walk frames.
2. `cur` is `|floor(x − tx)|` and `|floor(y − ty)|`. `next` is `|floor(x + 4·vx·scale − tx)|`, and the same for y (four steps ahead).
3. If `next` in x **or** in y is greater than the "previous distance" (`g_walkPrevDx` / `Dy` `0x7c7a58` / `0x7a9a14`, which is `cur` from the previous step): the segment goal will be passed in 2–3 steps.
  - The last point: Jack **stands exactly on the goal** (`x = tx`, `y = ty`), `g_jackWalking` is 0, and the stand animation plays (`004150f0(g_jackDir)`).
  - Otherwise: the next point (`Jack_WalkToPoint`), the counter is 0 (the next step is immediate, on the next frame), and **there is no movement on this step**.
4. The "previous distance" becomes `cur`.
5. The scale `g_jackScale` `0x504700` is `(y − horizon)·refScale/(refY − horizon)` (float32), clamped to 0.1…1, **with no** division by 3 (`Persp_ScaleAtY` divides. This code does not).
6. `x += vx·scale`, `y += vy·scale`.

The speed therefore depends on the perspective, linearly. At scale 1 that is 12 px horizontally and 3.6 px vertically per step, so at a step every 60 ms about 200 px/s and about 60 px/s. At scale 0.5 it is half. The scale is computed from `y` before the step.

Compared with scrolling: `Game_Tick14ms` moves the view by 4 px every 14 ms (about 286 px/s. In the engine, 4 px per logic tick, about 290 px/s), which is faster than Jack (about 200–220 px/s at scale 1 and a step every 4 ticks. A step every tick is about 800 px/s). The scroll direction (`g_noControlDir`) is set by the script (`SCROLLRIGHT` / `SCROLLLEFT`) or by `walkScrollDirection` after Jack's step. Both speeds in the engine match the code. The mismatch was elsewhere: `SHOWFACE` waits for the scroll to end. See [dialog.md](dialog.md).

The engine: `walkStep(walker, world)` is one step. `walkTick(walker, world, ticksPerStep)` is one 15 ms tick, with the counter. `stepTicks(walkSpeedOption)` is the gap.

### Shifts after a turn animation

When a turn animation `0x6d6230` in 0…10 reaches its last frame, `Game_Run` (`00431272`…`004315f8`) moves Jack by `(dx·mirror·scale, dy·scale)`: 0 (−40, 2), 1 (−38, 14), 2 (12, 25), 3 (45, 10), 4 (43, −6), 5 (28, −23), 6 (−26, −18), 7 (−37, −13), 8 (85, 0), 9 (−50, −10), 10 (50, 5). The table is `TURN_SHIFT`.

## Stopping, and leaving a scene

- A walk ends only on reaching the last point (step 3), or when a script takes Jack over. There is no stop on an obstacle. Obstacles are already walked around in the path.
- A new click during a walk computes a new path from the current (truncated) position.
- **Exits** (`LEWO`, `PRAWO`, `DOL`, `TO_IN`, `UP`, `TO_OUT`) work **by a click** in the zone, not by Jack walking into the zone. The click starts the zone's macro. In the code there is no test of Jack's position against an exit zone. `g_exitAreas` is read only by `Scene_LoadAce` and `Area_IsEnabledExit` (a click, `00424640` and `00424820`, the cursor).

## Jack's draw order

`00415960` prepares a character frame with the darkening from the lights. It does not sort. The sort is inline in `Game_Run`, twice a frame: `00430972`…`00430f26`, and after the step `004322b2`…`0043283b`.

- The list of sprites redrawn in Jack's rectangle (`g_renderTouched` `0xa00cd0`, the count `0xa00cc0`). Special sprites (the shadow, the cursor, and the rest, the id list `0x8ab6b4`, `0x88f640`, … in `0x430a34`…`0x430b87`) are skipped.
- A scene person (`0x7cdea8[]`): Jack is behind when `y` of Jack is below `y` of the person (float), and in front when it is greater.
- An object (`Object_FindBySprite` `00413370`) with a valid quad, the point being Jack's truncated feet:
  1. every corner has `y` at or above Jack's `y` (`Depth_QuadAllBelow` `004031c0`): Jack is behind the object;
  2. every corner has `y` at or below Jack's `y` (`Depth_QuadAllAbove` `00403240`): Jack is in front;
  3. otherwise: above some edge that runs to the right (`x` of the corner is below `x` of the next, `004032c0`) and not below any edge that runs to the left (`004034f0`) means behind. The reverse means in front. Both, or neither, means no change.
- The game **does not sort**. When the order on the sprite list is wrong, it moves Jack's sprite by as many places as it takes to stand just under (`Sprite_MoveBack` `0047a8f0`) or just over (`Sprite_MoveFront` `0047aa00`) that sprite. Objects with no valid quad stay in the order from the scene file (`z` is the object's number).

The engine: `objectDepth(obj, feet)`, `personDepth(yJack, yPerson)`, `reorderJack(list, jack, other, relation)`.

## Scale and perspective

| Where | Formula |
|---|---|
| Jack, drawing and the step (`0x504700`, `00431b68`) | `clamp(f32((y − h)·refScale/(refY − h)), 0.1, 1)` |
| `Persp_ScaleAtY` `00403d20` (detours, `Script_ExecStep`) | the same for an integer `y`, divided by 3 |

## The engine

```ts
const world = walkWorld(scene)!;
const jack = createWalker(start.x, start.y, world);
const plan = planWalk(world, jack, click); // null means the click was ignored or cancelled
if (plan) followPlan(jack, plan);
for (const ev of walkTick(jack, world)) if (ev.arrived) { /* standing */ }
// jack.x, jack.y, jack.scale, jack.dir, jack.mirror, jack.walking
exitAt(scene.areas, click)
objectDepth(world.objects[i], { x: Math.trunc(jack.x), y: Math.trunc(jack.y) })
```

## Tests

`packages/engine/src/walk` tests cover `__ftol` and `short`, the half-planes and the inclusive edges, intersections (including ones lost on a vertical segment), `Geom_DistFromLine`, the scales, paths in a square and in an L-shaped corridor, no path (the goal or the start outside, disconnected parts), the call budget, `Walk_SpreadCandidates` (the shift, the duplicates, one sort pass), the nearest point, dropping collinear points, quads (containment, the escape, intersections), a detour both ways with the penalty of 2000, smoothing (a detour plus shortcuts, a goal inside an object in modes 1 and 0, a start inside an object), the direction sectors and their bounds, a forced direction, the angle with 0.3, the speed 12 and 3.6, "already there", the step and the stop 2–3 steps before the goal, the scale inside a step, the tick counter, a multi-point path, a start outside the area, a direct walk, the draw order, and the exits. The tests build their own bytes.

## Open

- An FPU precision of 53 bits is a hypothesis. At 64 bits (the x87 default) the results on edges could differ.
- The time limit of `Walk_SearchRec` is replaced by a call budget. On a slow computer the original could stop the search for a shorter path sooner.
- The center of a quad with parallel diagonals: the engine uses (0, 0). A hypothesis. Detours of such objects do not occur in the data.
- Turn animations (`004107c0`), the choice of step frames, and the step sounds (`WalkEffect`, `KROK1` / `KROK2`) are in [turn.md](turn.md), [animation.md](animation.md), and [sfx.md](sfx.md).
